import asyncio
import hashlib
import json
import logging
import os
import time
from contextlib import suppress
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode

from app.config import LEAGUE_MAP
from app.services.espn import ESPNService, ESPNServiceError, espn_service
from app.utils.formatting import ISTANBUL, parse_espn_datetime


logger = logging.getLogger(__name__)

SUBSCRIPTIONS_KEY = "nabiz90:push:subscriptions"
MATCH_STATES_KEY = "nabiz90:push:match-states"
LEAGUE_KEYS_BY_SLUG = {league["slug"]: key for key, league in LEAGUE_MAP.items()}


def _integer(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _phase(value: Any) -> str:
    return str(value or "").casefold().strip()


def notification_events(previous: Dict[str, Any], current: Dict[str, Any]) -> List[Dict[str, str]]:
    """Return user-visible transitions between two fixture snapshots."""
    home = str(current.get("homeTeam") or "Ev Sahibi")
    away = str(current.get("awayTeam") or "Deplasman")
    score = str(current.get("score") or "-")
    league = str(current.get("league") or "Nabız90")
    detail = str(current.get("minute") or current.get("time") or league)
    events: List[Dict[str, str]] = []

    old_status = str(previous.get("status") or "")
    status = str(current.get("status") or "")
    if old_status == "NS" and status == "LIVE":
        events.append({"kind": "kickoff", "title": "Maç başladı", "body": f"{home} - {away} • {league}"})

    old_total = _integer(previous.get("homeScore")) + _integer(previous.get("awayScore"))
    total = _integer(current.get("homeScore")) + _integer(current.get("awayScore"))
    if status != "NS" and score != previous.get("score"):
        title = "Gol!" if total > old_total else "Skor güncellendi"
        events.append({"kind": "goal", "title": title, "body": f"{home} {score} {away} • {detail}"})

    old_reds = _integer(previous.get("homeRedCards")) + _integer(previous.get("awayRedCards"))
    reds = _integer(current.get("homeRedCards")) + _integer(current.get("awayRedCards"))
    if reds > old_reds:
        events.append({"kind": "red-card", "title": "Kırmızı kart", "body": f"{home} - {away} • {detail}"})

    old_phase = _phase(previous.get("statusDetail"))
    phase = _phase(current.get("statusDetail"))
    halftime = phase == "ht" or "half time" in phase or "devre" in phase
    if phase != old_phase and halftime:
        events.append({"kind": "half-time", "title": "Devre arası", "body": f"{home} {score} {away}"})

    if old_status != "FT" and status == "FT":
        events.append({"kind": "full-time", "title": "Maç sona erdi", "body": f"{home} {score} {away}"})
    return events


class PushService:
    def __init__(self, football: ESPNService = espn_service) -> None:
        self.football = football
        self.redis_url = os.getenv("REDIS_URL", "").strip()
        self.public_key = os.getenv("VAPID_PUBLIC_KEY", "").strip()
        self.private_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()
        self.subject = os.getenv("VAPID_SUBJECT", "https://nabiz90.onrender.com").strip()
        self.poll_seconds = max(15, int(os.getenv("PUSH_POLL_SECONDS", "30")))
        self.discovery_seconds = max(120, int(os.getenv("PUSH_DISCOVERY_SECONDS", "300")))
        self._redis: Any = None
        self._task: Optional[asyncio.Task[None]] = None
        self._stopping = asyncio.Event()
        self._catalog: Dict[str, Dict[str, Any]] = {}
        self._catalog_date = ""
        self._catalog_signature = ""
        self._last_discovery = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.redis_url and self.public_key and self.private_key)

    @property
    def ready(self) -> bool:
        return bool(self.configured and self._redis is not None)

    async def start(self) -> None:
        if not self.configured:
            logger.info("Web Push is disabled because Redis or VAPID configuration is missing.")
            return
        try:
            from redis.asyncio import Redis

            self._redis = Redis.from_url(self.redis_url, decode_responses=True)
            await self._redis.ping()
        except Exception:
            logger.exception("Web Push storage could not be initialized.")
            if self._redis is not None:
                with suppress(Exception):
                    await self._redis.aclose()
            self._redis = None
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._watch_matches(), name="nabiz90-push-watcher")
        logger.info("Web Push match watcher started.")

    async def close(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._redis is not None:
            with suppress(Exception):
                await self._redis.aclose()
            self._redis = None

    @staticmethod
    def subscription_id(endpoint: str) -> str:
        return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()

    async def save_preferences(self, preferences: Dict[str, Any]) -> None:
        if not self.ready:
            raise RuntimeError("Bildirim servisi şu anda hazır değil.")
        endpoint = str(preferences["subscription"]["endpoint"])
        await self._redis.hset(
            SUBSCRIPTIONS_KEY,
            self.subscription_id(endpoint),
            json.dumps(preferences, ensure_ascii=False, separators=(",", ":")),
        )

    async def remove_subscription(self, endpoint: str) -> None:
        if self._redis is not None:
            await self._redis.hdel(SUBSCRIPTIONS_KEY, self.subscription_id(endpoint))

    async def _subscriptions(self) -> List[Dict[str, Any]]:
        if self._redis is None:
            return []
        values = await self._redis.hvals(SUBSCRIPTIONS_KEY)
        subscriptions = []
        for value in values:
            try:
                item = json.loads(value)
            except (TypeError, json.JSONDecodeError):
                continue
            if item.get("allMatches") or item.get("followedMatches"):
                subscriptions.append(item)
        return subscriptions

    @staticmethod
    def _requested_leagues(subscriptions: Iterable[Dict[str, Any]]) -> List[Dict[str, str]]:
        items = list(subscriptions)
        if any(item.get("allMatches") for item in items):
            return list(LEAGUE_MAP.values())
        slugs = {
            str(match.get("leagueSlug") or "")
            for item in items
            for match in item.get("followedMatches", [])
        }
        return [league for league in LEAGUE_MAP.values() if league["slug"] in slugs]

    async def _load_states(self, match_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
        ids = [str(match_id) for match_id in match_ids]
        if not ids or self._redis is None:
            return {}
        values = await self._redis.hmget(MATCH_STATES_KEY, ids)
        result: Dict[str, Dict[str, Any]] = {}
        for match_id, value in zip(ids, values):
            if not value:
                continue
            try:
                result[match_id] = json.loads(value)
            except json.JSONDecodeError:
                continue
        return result

    async def _save_states(self, matches: Iterable[Dict[str, Any]]) -> None:
        if self._redis is None:
            return
        mapping = {
            str(match["id"]): json.dumps(match, ensure_ascii=False, separators=(",", ":"))
            for match in matches
            if match.get("id")
        }
        if mapping:
            await self._redis.hset(MATCH_STATES_KEY, mapping=mapping)

    @staticmethod
    def _recipient_wants(subscription: Dict[str, Any], match_id: str) -> bool:
        if subscription.get("allMatches"):
            return True
        return any(str(item.get("id")) == match_id for item in subscription.get("followedMatches", []))

    @staticmethod
    def _match_url(match: Dict[str, Any]) -> str:
        league = LEAGUE_KEYS_BY_SLUG.get(str(match.get("leagueSlug") or ""), "all")
        query = urlencode({"date": match.get("matchDate") or "", "league": league, "match": match.get("id") or ""})
        return f"/?{query}"

    async def _deliver(self, subscription: Dict[str, Any], payload: Dict[str, Any]) -> None:
        try:
            from pywebpush import webpush

            await asyncio.to_thread(
                webpush,
                subscription_info=subscription["subscription"],
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=self.private_key,
                vapid_claims={"sub": self.subject},
                ttl=300,
            )
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                await self.remove_subscription(str(subscription["subscription"].get("endpoint") or ""))
            elif status is not None:
                logger.warning("Web Push delivery failed with status %s.", status)
            else:
                logger.exception("Unexpected Web Push delivery failure.")

    async def _process_matches(self, subscriptions: List[Dict[str, Any]], matches: List[Dict[str, Any]]) -> None:
        previous = await self._load_states(match.get("id", "") for match in matches)
        deliveries = []
        for match in matches:
            match_id = str(match.get("id") or "")
            old = previous.get(match_id)
            if not old:
                continue
            for event in notification_events(old, match):
                payload = {
                    **event,
                    "tag": f"{event['kind']}-{match_id}",
                    "url": self._match_url(match),
                    "icon": match.get("homeLogo") or match.get("awayLogo") or "/images/app-icon-192.png",
                }
                for subscription in subscriptions:
                    if self._recipient_wants(subscription, match_id):
                        deliveries.append(self._deliver(subscription, payload))
        if deliveries:
            await asyncio.gather(*deliveries)
        await self._save_states(matches)

    async def _watch_once(self) -> None:
        subscriptions = await self._subscriptions()
        if not subscriptions:
            return
        leagues = self._requested_leagues(subscriptions)
        if not leagues:
            return
        selected_date = datetime.now(ISTANBUL).date().isoformat()
        signature = ",".join(sorted(league["slug"] for league in leagues))
        discovery_due = (
            selected_date != self._catalog_date
            or signature != self._catalog_signature
            or time.monotonic() - self._last_discovery >= self.discovery_seconds
        )
        if discovery_due:
            data = await self.football.all_fixtures(leagues, selected_date)
            matches = data.get("matches", [])
            self._catalog = {str(match["id"]): match for match in matches if match.get("id")}
            self._catalog_date = selected_date
            self._catalog_signature = signature
            self._last_discovery = time.monotonic()
            await self._process_matches(subscriptions, matches)
            return

        followed_slugs = {
            str(match.get("leagueSlug") or "")
            for subscription in subscriptions
            for match in subscription.get("followedMatches", [])
            if match.get("matchDate") == selected_date
        }
        now = datetime.now(ISTANBUL)
        active_slugs = set(followed_slugs)
        for match in self._catalog.values():
            if match.get("status") == "LIVE":
                active_slugs.add(str(match.get("leagueSlug") or ""))
                continue
            start = parse_espn_datetime(str(match.get("startTime") or ""))
            if start and -3600 <= (start - now).total_seconds() <= 18000:
                active_slugs.add(str(match.get("leagueSlug") or ""))

        active_leagues = [league for league in leagues if league["slug"] in active_slugs]
        if not active_leagues:
            return
        data = await self.football.all_fixtures(active_leagues, selected_date)
        matches = data.get("matches", [])
        for match in matches:
            if match.get("id"):
                self._catalog[str(match["id"])] = match
        await self._process_matches(subscriptions, matches)

    async def _watch_matches(self) -> None:
        while not self._stopping.is_set():
            try:
                await self._watch_once()
            except asyncio.CancelledError:
                raise
            except ESPNServiceError:
                logger.warning("Push watcher could not refresh ESPN fixtures.")
            except Exception:
                logger.exception("Push watcher cycle failed.")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=self.poll_seconds)
            except asyncio.TimeoutError:
                pass


push_service = PushService()
