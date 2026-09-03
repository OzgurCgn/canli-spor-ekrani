import asyncio
import time
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx

from app.config import TEAM_LOGO_OVERRIDES, clean_team_name
from app.utils.formatting import ISTANBUL, format_match_time, parse_espn_datetime


class ESPNServiceError(RuntimeError):
    pass


class TTLCache:
    def __init__(self) -> None:
        self._items: Dict[str, Dict[str, Any]] = {}

    def get(self, key: str, ttl: int) -> Optional[Any]:
        item = self._items.get(key)
        if item and time.monotonic() - item["created_at"] < ttl:
            return item["value"]
        return None

    def get_stale(self, key: str, max_age: int) -> Optional[Any]:
        item = self._items.get(key)
        if item and time.monotonic() - item["created_at"] < max_age:
            return item["value"]
        self._items.pop(key, None)
        return None

    def set(self, key: str, value: Any) -> None:
        self._items[key] = {"created_at": time.monotonic(), "value": value}


def _logo_url(team: Dict[str, Any]) -> str:
    team_id = str(team.get("id") or "")
    if team_id in TEAM_LOGO_OVERRIDES:
        return TEAM_LOGO_OVERRIDES[team_id]
    logos = team.get("logos") or []
    if logos and logos[0].get("href"):
        return logos[0]["href"]
    return f"https://a.espncdn.com/i/teamlogos/soccer/500/{team_id}.png" if team_id else ""


def parse_fixtures(payload: Dict[str, Any], league: Dict[str, str]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for event in payload.get("events", []):
        competitions = event.get("competitions") or []
        if not competitions:
            continue
        competition = competitions[0]
        competitors = competition.get("competitors", [])
        home = next((team for team in competitors if team.get("homeAway") == "home"), {})
        away = next((team for team in competitors if team.get("homeAway") == "away"), {})
        home_team = home.get("team", {})
        away_team = away.get("team", {})

        status_type = event.get("status", {}).get("type", {})
        raw_date = event.get("date", "")
        time_meta = format_match_time(raw_date, status_type.get("state", "pre"), status_type.get("shortDetail", ""))
        match_dt = parse_espn_datetime(raw_date)
        score = f"{home.get('score', '0')} - {away.get('score', '0')}" if time_meta["type"] != "NS" else "vs"
        week = event.get("season", {}).get("week")

        matches.append(
            {
                "id": str(event.get("id", "")),
                "league": league["name"],
                "leagueSlug": league["slug"],
                "homeId": str(home.get("id") or home_team.get("id") or ""),
                "awayId": str(away.get("id") or away_team.get("id") or ""),
                "homeTeam": clean_team_name(home_team.get("displayName", "Ev Sahibi")),
                "awayTeam": clean_team_name(away_team.get("displayName", "Deplasman")),
                "homeLogo": _logo_url(home_team),
                "awayLogo": _logo_url(away_team),
                "homeScore": str(home.get("score", "0")),
                "awayScore": str(away.get("score", "0")),
                "score": score,
                "status": time_meta["type"],
                "minute": time_meta["display"],
                "time": time_meta["display"],
                "fullDate": time_meta["full_date"],
                "startTime": raw_date,
                "matchDate": match_dt.date().isoformat() if match_dt else "",
                "round": f"{week}. Hafta" if week else "",
            }
        )
    return matches


def _side_for_team(team_id: str, home_id: str, away_id: str) -> str:
    # ESPN assigns an own-goal event to the team that receives the goal,
    # not to the offending player's team. The event team therefore already
    # points at the correct side and must not be inverted.
    return "home" if team_id == home_id else "away"


def _participant_names(item: Dict[str, Any]) -> Dict[str, str]:
    scorer = ""
    assist = ""
    for index, participant in enumerate(item.get("participants", [])):
        role = str(participant.get("type", "")).lower()
        name = participant.get("athlete", {}).get("displayName", "")
        if not scorer and (role in ("", "scorer", "athlete") or index == 0):
            scorer = name
        elif role in ("assist", "assist2") or (index == 1 and not assist):
            assist = name
    if not scorer:
        scorer = item.get("athlete", {}).get("displayName", "") or item.get("text", "") or "Bilinmeyen Oyuncu"
    return {"scorer": scorer, "assist": assist}


def _participant_list(item: Dict[str, Any]) -> List[str]:
    return [
        participant.get("athlete", {}).get("displayName", "")
        for participant in item.get("participants", [])
        if participant.get("athlete", {}).get("displayName")
    ]


def _parse_event(item: Dict[str, Any], home_id: str, away_id: str) -> Optional[Dict[str, Any]]:
    type_text = str(item.get("type", {}).get("text", "")).lower()
    is_penalty = bool(item.get("penaltyKick")) or "penalty" in type_text
    is_own_goal = bool(item.get("ownGoal")) or "own goal" in type_text
    is_red = bool(item.get("redCard")) or "red card" in type_text
    is_yellow = bool(item.get("yellowCard")) or "yellow card" in type_text
    is_goal = bool(item.get("scoringPlay")) or "goal" in type_text
    is_substitution = "substitution" in type_text
    if not any((is_goal, is_penalty, is_red, is_yellow, is_substitution)):
        return None

    names = _participant_names(item)
    participants = _participant_list(item)
    player_out = participants[1] if is_substitution and len(participants) > 1 else ""
    if is_own_goal:
        icon, tag, event_type = "⚽", "K.K.", "own-goal"
    elif is_penalty:
        if "missed" in type_text:
            icon, tag, event_type = "🎯", "Penaltı Kaçtı", "penalty-missed"
        elif "saved" in type_text:
            icon, tag, event_type = "🧤", "Penaltı Kurtarıldı", "penalty-saved"
        else:
            icon, tag, event_type = "🎯", "Penaltı", "penalty"
    elif is_red:
        icon, tag, event_type = "🟥", "Kırmızı Kart", "red-card"
    elif is_yellow:
        icon, tag, event_type = "🟨", "Sarı Kart", "yellow-card"
    elif is_substitution:
        icon, tag, event_type = "🔁", "Oyuncu Değişikliği", "substitution"
    else:
        icon, tag, event_type = "⚽", "Gol", "goal"

    team_id = str(item.get("team", {}).get("id", ""))
    return {
        "clock": str(item.get("clock", {}).get("displayValue", "")),
        "icon": icon,
        "tag": tag,
        "type": event_type,
        "scorer": names["scorer"],
        "isOwnGoal": is_own_goal,
        "isPenalty": is_penalty,
        "assist": f"Asist: {names['assist']}" if names["assist"] and not is_own_goal and not is_substitution else "",
        "assistPlayer": names["assist"] if names["assist"] and not is_own_goal and not is_substitution else "",
        "detail": f"Çıkan: {player_out}" if player_out else "",
        "playerIn": names["scorer"] if is_substitution else "",
        "playerOut": player_out,
        "isImportant": bool(is_goal or is_red),
        "teamSide": _side_for_team(team_id, home_id, away_id),
    }


def _team_map(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for item in items:
        team_id = str(item.get("team", {}).get("id", ""))
        if team_id:
            result[team_id] = item
    return result


PLAYER_STAT_NAMES = {
    "totalGoals",
    "goalAssists",
    "totalShots",
    "shotsOnTarget",
    "yellowCards",
    "redCards",
    "foulsCommitted",
    "foulsSuffered",
    "ownGoals",
    "offsides",
    "saves",
    "goalsConceded",
    "shotsFaced",
}


def _related_events(player_name: str, events: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    badges: List[Dict[str, str]] = []
    event_labels = {
        "goal": ("⚽", "goal"),
        "own-goal": ("K.K.", "own-goal"),
        "yellow-card": ("🟨", "card"),
        "red-card": ("🟥", "card"),
        "penalty": ("⚽ P", "goal"),
    }
    for event in events:
        clock = event.get("clock", "")
        if event.get("assistPlayer") == player_name:
            badges.append({"label": f"A {clock}", "tone": "assist", "title": "Asist"})
        if event.get("type") == "substitution":
            if event.get("playerIn") == player_name:
                badges.append({"label": f"↗ {clock}", "tone": "sub-in", "title": "Oyuna girdi"})
            elif event.get("playerOut") == player_name:
                badges.append({"label": f"↘ {clock}", "tone": "sub-out", "title": "Oyundan çıktı"})
            continue
        if event.get("scorer") == player_name and event.get("type") in event_labels:
            label, tone = event_labels[event["type"]]
            badges.append({"label": f"{label} {clock}", "tone": tone, "title": event.get("tag", "")})
    return badges


def _jersey_image(athlete: Dict[str, Any]) -> str:
    images = athlete.get("jerseyImages") or []
    dark = next((image for image in images if "dark" in (image.get("rel") or [])), None)
    selected = dark or (images[0] if images else {})
    return str(selected.get("href", ""))


def _player_data(player: Dict[str, Any], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    athlete = player.get("athlete", {})
    name = athlete.get("displayName", "")
    position = player.get("position", {}) or athlete.get("position", {}) or {}
    stats = {
        stat.get("name"): stat.get("displayValue", "0")
        for stat in player.get("stats", [])
        if stat.get("name") in PLAYER_STAT_NAMES
    }
    return {
        "id": str(athlete.get("id", "")),
        "name": name,
        "shortName": athlete.get("shortName") or name,
        "jersey": str(player.get("jersey") or athlete.get("jersey") or ""),
        "jerseyImage": _jersey_image(athlete),
        "headshot": str((athlete.get("headshot") or {}).get("href", "")),
        "pos": str(position.get("abbreviation", "")),
        "positionName": str(position.get("displayName") or position.get("name") or ""),
        "formationPlace": str(player.get("formationPlace") or ""),
        "starter": bool(player.get("starter")),
        "subbedIn": bool(player.get("subbedIn")),
        "subbedOut": bool(player.get("subbedOut")),
        "eventBadges": _related_events(name, events),
        "stats": stats,
    }


def _lineup(roster: Dict[str, Any], events: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    all_players = roster.get("roster", [])
    players = [player for player in all_players if player.get("starter")]
    if not players:
        players = all_players[:11]
    return [_player_data(player, events or []) for player in players[:11]]


def _bench(roster: Dict[str, Any], events: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    players = [player for player in roster.get("roster", []) if not player.get("starter")]
    return [_player_data(player, events or []) for player in players]


def parse_match_detail(payload: Dict[str, Any]) -> Dict[str, Any]:
    competitions = payload.get("header", {}).get("competitions") or [{}]
    header = competitions[0]
    competitors = header.get("competitors", [])
    home_id = next((str(team.get("id")) for team in competitors if team.get("homeAway") == "home"), "")
    away_id = next((str(team.get("id")) for team in competitors if team.get("homeAway") == "away"), "")

    # keyEvents contains the full timeline (cards and substitutions included),
    # while header.details often contains only scoring plays.
    raw_events = payload.get("keyEvents") or header.get("details") or []
    events = [event for event in (_parse_event(item, home_id, away_id) for item in raw_events) if event]
    home_events = [event for event in events if event["teamSide"] == "home" and event["isImportant"]]
    away_events = [event for event in events if event["teamSide"] == "away" and event["isImportant"]]

    game_info = payload.get("gameInfo", {})
    venue_data = game_info.get("venue", {})
    venue = venue_data.get("fullName") or "Belirtilmedi"
    city = venue_data.get("address", {}).get("city", "")
    officials = game_info.get("officials", [])

    stats: List[Dict[str, str]] = []
    stats_by_team = _team_map(payload.get("boxscore", {}).get("teams", []))
    home_stats = {
        item.get("name"): item.get("displayValue", "-")
        for item in stats_by_team.get(home_id, {}).get("statistics", [])
    }
    away_stats = {
        item.get("name"): item.get("displayValue", "-")
        for item in stats_by_team.get(away_id, {}).get("statistics", [])
    }
    for key, title in (
        ("possessionPct", "Topla Oynama (%)"),
        ("totalShots", "Toplam Şut"),
        ("shotsOnTarget", "İsabetli Şut"),
        ("blockedShots", "Bloklanan Şut"),
        ("wonCorners", "Korner"),
        ("saves", "Kurtarış"),
        ("totalPasses", "Toplam Pas"),
        ("passPct", "Pas İsabeti (%)"),
        ("totalTackles", "Top Kapma"),
        ("interceptions", "Pas Arası"),
        ("totalClearance", "Uzaklaştırma"),
        ("offsides", "Ofsayt"),
        ("foulsCommitted", "Faul"),
        ("yellowCards", "Sarı Kart"),
        ("redCards", "Kırmızı Kart"),
    ):
        if key in home_stats or key in away_stats:
            stats.append({"title": title, "home": home_stats.get(key, "-"), "away": away_stats.get(key, "-")})

    rosters_by_team = _team_map(payload.get("rosters", []))
    home_roster = rosters_by_team.get(home_id, {})
    away_roster = rosters_by_team.get(away_id, {})
    lineups = {
        "home": _lineup(home_roster, events),
        "away": _lineup(away_roster, events),
        "homeBench": _bench(home_roster, events),
        "awayBench": _bench(away_roster, events),
        "homeFormation": home_roster.get("formation", ""),
        "awayFormation": away_roster.get("formation", ""),
        "isOfficial": bool(home_roster or away_roster),
    }

    return {
        "venue": f"{venue} ({city})" if city else venue,
        "referee": officials[0].get("displayName", "Belirtilmedi") if officials else "Belirtilmedi",
        "homeEvents": home_events,
        "awayEvents": away_events,
        "events": events,
        "stats": stats,
        "lineups": lineups,
    }


def parse_standings(payload: Dict[str, Any]) -> Dict[str, Any]:
    groups = []
    for child in payload.get("children", []):
        entries = child.get("standings", {}).get("entries", [])
        if not entries:
            continue
        rows = []
        for entry in entries:
            team = entry.get("team", {})
            values = {stat.get("name"): stat.get("displayValue", "-") for stat in entry.get("stats", [])}
            rows.append(
                {
                    "rank": values.get("rank", "-"),
                    "teamId": str(team.get("id", "")),
                    "team": clean_team_name(team.get("displayName", "Bilinmeyen Takım")),
                    "logo": _logo_url(team),
                    "played": values.get("gamesPlayed", "-"),
                    "wins": values.get("wins", "-"),
                    "draws": values.get("ties", "-"),
                    "losses": values.get("losses", "-"),
                    "goalDifference": values.get("pointDifferential", "-"),
                    "points": values.get("points", "-"),
                }
            )
        groups.append({"name": child.get("name", payload.get("name", "Puan Durumu")), "rows": rows})
    return {"league": payload.get("name", "Puan Durumu"), "groups": groups}


def _record_values(team: Dict[str, Any]) -> Dict[str, Any]:
    items = team.get("record", {}).get("items", [])
    stats = items[0].get("stats", []) if items else []
    return {stat.get("name"): stat.get("value", stat.get("displayValue", 0)) for stat in stats}


def _team_match(match: Dict[str, Any], team_id: str) -> Dict[str, Any]:
    is_home = match.get("homeId") == team_id
    team_score = match.get("homeScore") if is_home else match.get("awayScore")
    opponent_score = match.get("awayScore") if is_home else match.get("homeScore")
    result = ""
    if match.get("status") == "FT":
        try:
            result = "G" if int(team_score) > int(opponent_score) else ("M" if int(team_score) < int(opponent_score) else "B")
        except (TypeError, ValueError):
            result = ""
    return {
        "id": match.get("id", ""),
        "league": match.get("league", ""),
        "leagueSlug": match.get("leagueSlug", ""),
        "opponentId": match.get("awayId") if is_home else match.get("homeId"),
        "opponent": match.get("awayTeam") if is_home else match.get("homeTeam"),
        "opponentLogo": match.get("awayLogo") if is_home else match.get("homeLogo"),
        "isHome": is_home,
        "score": match.get("score", "vs"),
        "status": match.get("status", "NS"),
        "time": match.get("time", ""),
        "fullDate": match.get("fullDate", ""),
        "matchDate": match.get("matchDate", ""),
        "startTime": match.get("startTime", ""),
        "result": result,
    }


def parse_team_detail(
    team_payload: Dict[str, Any],
    roster_payload: Dict[str, Any],
    fixtures_payload: Dict[str, Any],
    league: Dict[str, str],
) -> Dict[str, Any]:
    team = team_payload.get("team", {})
    team_id = str(team.get("id", ""))
    record = _record_values(team)
    all_matches = [
        _team_match(match, team_id)
        for match in parse_fixtures(fixtures_payload, league)
        if team_id in (match.get("homeId"), match.get("awayId"))
    ]
    recent = sorted(
        (match for match in all_matches if match["status"] == "FT"),
        key=lambda match: match["startTime"],
        reverse=True,
    )[:5]
    upcoming = sorted(
        (match for match in all_matches if match["status"] != "FT"),
        key=lambda match: match["startTime"],
    )[:3]
    squad = []
    for athlete in roster_payload.get("athletes", []):
        position = athlete.get("position", {}) or {}
        squad.append({
            "id": str(athlete.get("id", "")),
            "name": athlete.get("displayName", ""),
            "shortName": athlete.get("shortName") or athlete.get("displayName", ""),
            "jersey": str(athlete.get("jersey") or ""),
            "position": position.get("abbreviation", ""),
            "positionName": position.get("displayName", ""),
            "headshot": str((athlete.get("headshot") or {}).get("href", "")),
            "age": athlete.get("age"),
            "country": athlete.get("citizenship", ""),
        })

    return {
        "team": {
            "id": team_id,
            "name": clean_team_name(team.get("displayName", "Bilinmeyen Takım")),
            "abbreviation": team.get("abbreviation", ""),
            "logo": _logo_url(team),
            "color": team.get("color", ""),
            "alternateColor": team.get("alternateColor", ""),
            "league": league["name"],
            "leagueSlug": league["slug"],
        },
        "record": {
            "rank": int(record.get("rank", 0) or 0),
            "played": int(record.get("gamesPlayed", 0) or 0),
            "wins": int(record.get("wins", 0) or 0),
            "draws": int(record.get("ties", 0) or 0),
            "losses": int(record.get("losses", 0) or 0),
            "goalsFor": int(record.get("pointsFor", 0) or 0),
            "goalsAgainst": int(record.get("pointsAgainst", 0) or 0),
            "goalDifference": int(record.get("pointDifferential", 0) or 0),
            "points": int(record.get("points", 0) or 0),
        },
        "recent": recent,
        "upcoming": upcoming,
        "squad": squad,
    }


class ESPNService:
    SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard"
    SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/summary"
    STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings"
    TEAM_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams/{team_id}"
    ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams/{team_id}/roster"

    def __init__(self) -> None:
        self.cache = TTLCache()
        self._client: Optional[httpx.AsyncClient] = None
        self._locks: Dict[str, asyncio.Lock] = {}

    def _client_instance(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=12.0, follow_redirects=True)
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def _fetch_json(self, url: str, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        last_error: Optional[Exception] = None
        for attempt in range(3):
            try:
                client = self._client_instance()
                response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError, ImportError) as exc:
                last_error = exc
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500 and exc.response.status_code != 429:
                    break
                if attempt < 2:
                    await asyncio.sleep(0.25 * (2 ** attempt))
        raise ESPNServiceError("ESPN verisine şu anda ulaşılamıyor.") from last_error

    async def _cached(
        self,
        key: str,
        ttl: int,
        loader: Callable[[], Awaitable[Dict[str, Any]]],
        stale_ttl: int = 1800,
    ) -> Dict[str, Any]:
        cached = self.cache.get(key, ttl)
        if cached is not None:
            return cached
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self.cache.get(key, ttl)
            if cached is not None:
                return cached
            try:
                result = await loader()
            except ESPNServiceError:
                stale = self.cache.get_stale(key, stale_ttl)
                if stale is not None:
                    return stale
                raise
            self.cache.set(key, result)
            return result

    async def fixtures(self, league: Dict[str, str], selected_date: str) -> Dict[str, Any]:
        key = f"fixtures:{league['slug']}:{selected_date}"
        async def load() -> Dict[str, Any]:
            payload = await self._fetch_json(
                self.SCOREBOARD_URL.format(slug=league["slug"]),
                {"dates": selected_date.replace("-", "")},
            )
            return {"league": league["name"], "date": selected_date, "matches": parse_fixtures(payload, league)}
        return await self._cached(key, 15, load)

    async def all_fixtures(self, leagues: List[Dict[str, str]], selected_date: str) -> Dict[str, Any]:
        results = await asyncio.gather(
            *(self.fixtures(league, selected_date) for league in leagues),
            return_exceptions=True,
        )
        successful = [result for result in results if isinstance(result, dict)]
        if not successful:
            raise ESPNServiceError("Liglerin maç verilerine şu anda ulaşılamıyor.")

        unique_matches: Dict[str, Dict[str, Any]] = {}
        for result in successful:
            for match in result.get("matches", []):
                match_id = str(match.get("id", ""))
                if match_id:
                    unique_matches.setdefault(match_id, match)

        status_order = {"LIVE": 0, "NS": 1, "FT": 2}
        matches = sorted(
            unique_matches.values(),
            key=lambda match: (
                status_order.get(str(match.get("status")), 3),
                str(match.get("startTime", "")),
                str(match.get("league", "")),
            ),
        )
        return {"league": "Tüm Ligler", "date": selected_date, "matches": matches}

    async def match_detail(self, event_id: str, league_slug: str) -> Dict[str, Any]:
        key = f"detail:{league_slug}:{event_id}"
        async def load() -> Dict[str, Any]:
            payload = await self._fetch_json(self.SUMMARY_URL.format(slug=league_slug), {"event": event_id})
            return parse_match_detail(payload)
        return await self._cached(key, 15, load)

    async def standings(self, league: Dict[str, str]) -> Dict[str, Any]:
        key = f"standings:{league['slug']}"
        async def load() -> Dict[str, Any]:
            payload = await self._fetch_json(self.STANDINGS_URL.format(slug=league["slug"]))
            return parse_standings(payload)
        return await self._cached(key, 300, load, stale_ttl=7200)

    async def team_detail(self, team_id: str, league: Dict[str, str]) -> Dict[str, Any]:
        key = f"team:{league['slug']}:{team_id}"

        async def load() -> Dict[str, Any]:
            today = datetime.now(ISTANBUL).date()
            date_range = f"{(today - timedelta(days=90)):%Y%m%d}-{(today + timedelta(days=90)):%Y%m%d}"
            team_result, roster_result, fixtures_result = await asyncio.gather(
                self._fetch_json(self.TEAM_URL.format(slug=league["slug"], team_id=team_id)),
                self._fetch_json(self.ROSTER_URL.format(slug=league["slug"], team_id=team_id)),
                self._fetch_json(self.SCOREBOARD_URL.format(slug=league["slug"]), {"dates": date_range, "limit": "1000"}),
                return_exceptions=True,
            )
            if isinstance(team_result, Exception):
                raise team_result
            roster_payload = roster_result if isinstance(roster_result, dict) else {}
            fixtures_payload = fixtures_result if isinstance(fixtures_result, dict) else {}
            return parse_team_detail(team_result, roster_payload, fixtures_payload, league)

        return await self._cached(key, 300, load, stale_ttl=7200)


espn_service = ESPNService()
