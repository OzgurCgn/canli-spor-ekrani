import asyncio

from app.services.espn import ESPNService, parse_fixtures, parse_match_detail, parse_standings


LEAGUE = {"slug": "tur.1", "name": "Trendyol Süper Lig"}


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
        "rank": "1", "team": "Galatasaray", "logo": "gal.png", "played": "3",
        "wins": "3", "draws": "0", "losses": "0", "goalDifference": "+7", "points": "9",
    }
