import asyncio
from datetime import date

from fastapi.testclient import TestClient

from app.main import app
from app.services.espn import ESPNService, ESPNServiceError, fixture_cache_policy, parse_fixtures, parse_match_detail, parse_standings, parse_team_detail


LEAGUE = {"slug": "tur.1", "name": "Trendyol Süper Lig"}


def test_fixture_cache_policy_varies_for_past_today_and_future():
    current = date(2026, 9, 3)

    assert fixture_cache_policy("2026-09-02", current) == (21600, 604800)
    assert fixture_cache_policy("2026-09-03", current) == (15, 1800)
    assert fixture_cache_policy("2026-09-04", current) == (900, 21600)


def test_fixture_parser_includes_logos_and_date():
    payload = {
        "events": [
            {
                "id": "42",
                "date": "2026-09-01T17:00Z",
                "status": {"type": {"state": "pre", "shortDetail": ""}},
                "season": {"week": 4},
                "competitions": [{"competitors": [
                    {"id": "1", "homeAway": "home", "score": "0", "team": {"id": "1", "displayName": "Fenerbahce", "logos": [{"href": "home.png"}]}},
                    {"id": "2", "homeAway": "away", "score": "0", "team": {"id": "2", "displayName": "Besiktas", "logos": [{"href": "away.png"}]}},
                ]}],
            }
        ]
    }

    match = parse_fixtures(payload, LEAGUE)[0]

    assert match["homeTeam"] == "Fenerbahçe"
    assert match["awayTeam"] == "Beşiktaş"
    assert match["homeLogo"] == "home.png"
    assert match["startTime"] == "2026-09-01T17:00Z"
    assert match["matchDate"] == "2026-09-01"
    assert match["score"] == "vs"
    assert match["homeScore"] == "0"
    assert match["awayScore"] == "0"


def test_fixture_parser_uses_local_logo_overrides_for_missing_espn_assets():
    payload = {
        "events": [{
            "id": "missing-logos",
            "date": "2026-08-31T17:00Z",
            "status": {"type": {"state": "post", "shortDetail": "FT"}},
            "competitions": [{"competitors": [
                {"id": "132335", "homeAway": "home", "score": "2", "team": {"id": "132335", "displayName": "Amed SFK"}},
                {"id": "21446", "homeAway": "away", "score": "1", "team": {"id": "21446", "displayName": "Al-Faisaly"}},
            ]}],
        }]
    }

    match = parse_fixtures(payload, LEAGUE)[0]

    assert match["homeLogo"] == "/images/team-logos/amed-sfk.png"
    assert match["awayLogo"] == "/images/team-logos/al-faisaly.png"


def test_local_logo_overrides_are_served():
    client = TestClient(app)

    for path in ("/images/team-logos/amed-sfk.png", "/images/team-logos/al-faisaly.png"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"


def test_all_fixtures_combines_leagues_and_prioritizes_live_matches():
    service = ESPNService()

    async def fake_fixtures(league, selected_date):
        status = "LIVE" if league["slug"] == "eng.1" else "NS"
        return {"matches": [{
            "id": league["slug"],
            "league": league["name"],
            "status": status,
            "startTime": "2026-09-01T19:00Z",
        }]}

    service.fixtures = fake_fixtures
    result = asyncio.run(service.all_fixtures(
        [{"slug": "tur.1", "name": "Süper Lig"}, {"slug": "eng.1", "name": "Premier League"}],
        "2026-09-01",
    ))

    assert result["league"] == "Tüm Ligler"
    assert [match["id"] for match in result["matches"]] == ["eng.1", "tur.1"]


def test_cached_response_falls_back_to_recent_stale_data():
    service = ESPNService()
    service.cache.set("sample", {"matches": ["cached"]})

    async def failing_loader():
        raise ESPNServiceError("upstream unavailable")

    result = asyncio.run(service._cached("sample", -1, failing_loader, stale_ttl=60))

    assert result == {"matches": ["cached"]}


def test_own_goal_uses_espn_scoring_team_without_inversion():
    payload = {
        "header": {"competitions": [{
            "competitors": [{"id": "home", "homeAway": "home"}, {"id": "away", "homeAway": "away"}],
            "details": [{
                "clock": {"displayValue": "31'"},
                # ESPN attributes own goals to the team receiving the goal.
                "team": {"id": "away"},
                "scoringPlay": True,
                "ownGoal": True,
                "participants": [{"athlete": {"displayName": "Oyuncu A"}}],
            }],
        }]}
    }

    result = parse_match_detail(payload)

    assert result["homeEvents"] == []
    assert result["awayEvents"][0]["scorer"] == "Oyuncu A"
    assert result["events"][0]["teamSide"] == "away"


def test_substitution_labels_outgoing_player_without_assist():
    payload = {
        "header": {"competitions": [{
            "competitors": [{"id": "home", "homeAway": "home"}, {"id": "away", "homeAway": "away"}],
        }]},
        "keyEvents": [{
            "clock": {"displayValue": "63'"},
            "team": {"id": "home"},
            "type": {"text": "Substitution"},
            "participants": [
                {"athlete": {"displayName": "Evann Guessand"}},
                {"athlete": {"displayName": "Jørgen Strand Larsen"}},
            ],
        }],
    }

    event = parse_match_detail(payload)["events"][0]

    assert event["scorer"] == "Evann Guessand"
    assert event["assist"] == ""
    assert event["detail"] == "Çıkan: Jørgen Strand Larsen"
    assert event["playerIn"] == "Evann Guessand"
    assert event["playerOut"] == "Jørgen Strand Larsen"


def test_full_timeline_prefers_key_events_over_goal_only_details():
    payload = {
        "header": {"competitions": [{
            "competitors": [{"id": "home", "homeAway": "home"}, {"id": "away", "homeAway": "away"}],
            "details": [{"team": {"id": "home"}, "scoringPlay": True, "participants": [{"athlete": {"displayName": "Golcü"}}]}],
        }]},
        "keyEvents": [
            {"clock": {"displayValue": "12'"}, "team": {"id": "home"}, "type": {"text": "Goal"}, "participants": [{"athlete": {"displayName": "Golcü"}}]},
            {"clock": {"displayValue": "30'"}, "team": {"id": "away"}, "type": {"text": "Yellow Card"}, "participants": [{"athlete": {"displayName": "Kartlı"}}]},
            {"clock": {"displayValue": "67'"}, "team": {"id": "home"}, "type": {"text": "Substitution"}, "participants": [{"athlete": {"displayName": "Oyuncu"}}]},
        ],
    }

    events = parse_match_detail(payload)["events"]

    assert [event["type"] for event in events] == ["goal", "yellow-card", "substitution"]


def test_rosters_and_stats_are_matched_by_team_id_not_array_order():
    payload = {
        "header": {"competitions": [{"competitors": [{"id": "h", "homeAway": "home"}, {"id": "a", "homeAway": "away"}]}]},
        "boxscore": {"teams": [
            {"team": {"id": "a"}, "statistics": [{"name": "totalShots", "displayValue": "4"}]},
            {"team": {"id": "h"}, "statistics": [{"name": "totalShots", "displayValue": "9"}]},
        ]},
        "rosters": [
            {"team": {"id": "a"}, "formation": "4-4-2", "roster": [{"starter": True, "jersey": "2", "athlete": {"displayName": "Away Player"}}]},
            {"team": {"id": "h"}, "formation": "4-3-3", "roster": [{"starter": True, "jersey": "1", "athlete": {"displayName": "Home Player"}}]},
        ],
    }

    result = parse_match_detail(payload)

    assert result["stats"][0] == {"title": "Toplam Şut", "home": "9", "away": "4"}
    assert result["lineups"]["home"][0]["name"] == "Home Player"
    assert result["lineups"]["awayFormation"] == "4-4-2"


def test_match_detail_includes_extended_team_statistics():
    payload = {
        "header": {"competitions": [{"competitors": [
            {"id": "h", "homeAway": "home"},
            {"id": "a", "homeAway": "away"},
        ]}]},
        "boxscore": {"teams": [
            {"team": {"id": "h"}, "statistics": [
                {"name": "totalPasses", "displayValue": "510"},
                {"name": "passPct", "displayValue": "88%"},
                {"name": "interceptions", "displayValue": "7"},
            ]},
            {"team": {"id": "a"}, "statistics": [
                {"name": "totalPasses", "displayValue": "320"},
                {"name": "passPct", "displayValue": "74%"},
                {"name": "interceptions", "displayValue": "12"},
            ]},
        ]},
    }

    stats = parse_match_detail(payload)["stats"]

    assert {item["title"] for item in stats} == {"Toplam Pas", "Pas İsabeti (%)", "Pas Arası"}
    assert {item["title"]: item["home"] for item in stats}["Toplam Pas"] == "510"


def test_visual_lineup_contains_pitch_data_bench_stats_and_event_badges():
    payload = {
        "header": {"competitions": [{"competitors": [
            {"id": "h", "homeAway": "home"},
            {"id": "a", "homeAway": "away"},
        ]}]},
        "keyEvents": [{
            "clock": {"displayValue": "63'"},
            "team": {"id": "h"},
            "type": {"text": "Substitution"},
            "participants": [
                {"athlete": {"displayName": "Giren Oyuncu"}},
                {"athlete": {"displayName": "Çıkan Oyuncu"}},
            ],
        }],
        "rosters": [{
            "team": {"id": "h"},
            "formation": "4-2-3-1",
            "roster": [
                {
                    "starter": True,
                    "jersey": "8",
                    "formationPlace": "7",
                    "subbedOut": True,
                    "position": {"abbreviation": "AM-R", "displayName": "Attacking Midfielder Right"},
                    "athlete": {
                        "id": "1",
                        "displayName": "Çıkan Oyuncu",
                        "shortName": "Ç. Oyuncu",
                        "jerseyImages": [
                            {"href": "light.png", "rel": ["full", "default"]},
                            {"href": "dark.png", "rel": ["full", "dark"]},
                        ],
                    },
                    "stats": [{"name": "totalShots", "displayValue": "3"}],
                },
                {
                    "starter": False,
                    "jersey": "19",
                    "subbedIn": True,
                    "position": {"abbreviation": "SUB", "displayName": "Substitute"},
                    "athlete": {"id": "2", "displayName": "Giren Oyuncu", "shortName": "G. Oyuncu"},
                },
            ],
        }],
    }

    lineups = parse_match_detail(payload)["lineups"]
    starter = lineups["home"][0]
    substitute = lineups["homeBench"][0]

    assert starter["formationPlace"] == "7"
    assert starter["jerseyImage"] == "dark.png"
    assert starter["stats"]["totalShots"] == "3"
    assert starter["eventBadges"] == [{"label": "↘ 63'", "tone": "sub-out", "title": "Oyundan çıktı"}]
    assert substitute["subbedIn"] is True
    assert substitute["eventBadges"] == [{"label": "↗ 63'", "tone": "sub-in", "title": "Oyuna girdi"}]


def test_standings_parser_returns_dashboard_columns():
    payload = {
        "name": "Turkish Super Lig",
        "children": [{
            "name": "2026/27",
            "standings": {"entries": [{
                "team": {"id": "432", "displayName": "Galatasaray", "logos": [{"href": "gal.png"}]},
                "stats": [
                    {"name": "rank", "displayValue": "1"},
                    {"name": "gamesPlayed", "displayValue": "3"},
                    {"name": "wins", "displayValue": "3"},
                    {"name": "ties", "displayValue": "0"},
                    {"name": "losses", "displayValue": "0"},
                    {"name": "pointDifferential", "displayValue": "+7"},
                    {"name": "points", "displayValue": "9"},
                ],
            }]},
        }],
    }

    row = parse_standings(payload)["groups"][0]["rows"][0]

    assert row == {
        "rank": "1", "teamId": "432", "team": "Galatasaray", "logo": "gal.png", "played": "3",
        "wins": "3", "draws": "0", "losses": "0", "goalDifference": "+7", "points": "9",
    }


def test_team_detail_parser_returns_record_form_schedule_and_squad():
    team_payload = {"team": {
        "id": "432", "displayName": "Galatasaray", "abbreviation": "GAL", "color": "aa0031",
        "logos": [{"href": "gal.png"}],
        "record": {"items": [{"stats": [
            {"name": "rank", "value": 1}, {"name": "gamesPlayed", "value": 3},
            {"name": "wins", "value": 2}, {"name": "ties", "value": 1},
            {"name": "losses", "value": 0}, {"name": "pointsFor", "value": 9},
            {"name": "pointsAgainst", "value": 4}, {"name": "pointDifferential", "value": 5},
            {"name": "points", "value": 7},
        ]}]},
    }}
    roster_payload = {"athletes": [{
        "id": "1", "displayName": "Oyuncu A", "shortName": "O. A", "jersey": "10", "age": 24,
        "citizenship": "Türkiye", "position": {"abbreviation": "AM", "displayName": "Midfielder"},
    }]}
    fixtures_payload = {"events": [
        {
            "id": "past", "date": "2026-08-29T18:30Z", "status": {"type": {"state": "post", "shortDetail": "FT"}},
            "competitions": [{"competitors": [
                {"id": "432", "homeAway": "home", "score": "3", "team": {"id": "432", "displayName": "Galatasaray"}},
                {"id": "789", "homeAway": "away", "score": "2", "team": {"id": "789", "displayName": "Goztepe"}},
            ]}],
        },
        {
            "id": "next", "date": "2026-09-04T17:00Z", "status": {"type": {"state": "pre", "shortDetail": ""}},
            "competitions": [{"competitors": [
                {"id": "101", "homeAway": "home", "score": "0", "team": {"id": "101", "displayName": "Basaksehir"}},
                {"id": "432", "homeAway": "away", "score": "0", "team": {"id": "432", "displayName": "Galatasaray"}},
            ]}],
        },
    ]}

    result = parse_team_detail(team_payload, roster_payload, fixtures_payload, LEAGUE)

    assert result["record"] == {
        "rank": 1, "played": 3, "wins": 2, "draws": 1, "losses": 0,
        "goalsFor": 9, "goalsAgainst": 4, "goalDifference": 5, "points": 7,
    }
    assert result["recent"][0]["result"] == "G"
    assert result["recent"][0]["opponent"] == "Göztepe"
    assert result["upcoming"][0]["opponent"] == "Başakşehir"
    assert result["squad"][0]["name"] == "Oyuncu A"
