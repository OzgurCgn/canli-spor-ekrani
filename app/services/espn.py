import asyncio
import time
from typing import Any, Dict, List, Optional

import httpx

from app.config import TEAM_LOGO_OVERRIDES, clean_team_name
from app.utils.formatting import format_match_time, parse_espn_datetime


class ESPNServiceError(RuntimeError):
    pass


class TTLCache:
    def __init__(self) -> None:
        self._items: Dict[str, Dict[str, Any]] = {}

    def get(self, key: str, ttl: int) -> Optional[Any]:
        item = self._items.get(key)
        if item and time.monotonic() - item["created_at"] < ttl:
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
        ("wonCorners", "Korner"),
        ("foulsCommitted", "Faul"),
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


class ESPNService:
    SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard"
    SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/summary"
    STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings"

    def __init__(self) -> None:
        self.cache = TTLCache()

    async def _fetch_json(self, url: str, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError, ImportError) as exc:
            raise ESPNServiceError("ESPN verisine şu anda ulaşılamıyor.") from exc

    async def fixtures(self, league: Dict[str, str], selected_date: str) -> Dict[str, Any]:
        key = f"fixtures:{league['slug']}:{selected_date}"
        cached = self.cache.get(key, 15)
        if cached is not None:
            return cached
        payload = await self._fetch_json(
            self.SCOREBOARD_URL.format(slug=league["slug"]),
            {"dates": selected_date.replace("-", "")},
        )
        result = {"league": league["name"], "date": selected_date, "matches": parse_fixtures(payload, league)}
        self.cache.set(key, result)
        return result

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
        cached = self.cache.get(key, 15)
        if cached is not None:
            return cached
        payload = await self._fetch_json(self.SUMMARY_URL.format(slug=league_slug), {"event": event_id})
        result = parse_match_detail(payload)
        self.cache.set(key, result)
        return result

    async def standings(self, league: Dict[str, str]) -> Dict[str, Any]:
        key = f"standings:{league['slug']}"
        cached = self.cache.get(key, 300)
        if cached is not None:
            return cached
        payload = await self._fetch_json(self.STANDINGS_URL.format(slug=league["slug"]))
        result = parse_standings(payload)
        self.cache.set(key, result)
        return result


espn_service = ESPNService()
