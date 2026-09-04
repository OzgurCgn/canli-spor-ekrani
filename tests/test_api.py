from fastapi.testclient import TestClient

from app.main import app
from app.services.push import notification_events


client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "4.0.0"}

    monitor_response = client.get("/health")
    assert monitor_response.status_code == 200
    assert monitor_response.json() == response.json()

    monitor_head_response = client.head("/health")
    assert monitor_head_response.status_code == 200
    assert monitor_head_response.content == b""


def test_unknown_league_is_rejected_without_upstream_request():
    response = client.get("/api/fixtures?league=unknown&date=2026-09-01")
    assert response.status_code == 422


def test_invalid_date_is_rejected():
    response = client.get("/api/fixtures?league=superlig&date=01-09-2026")
    assert response.status_code == 422


def test_invalid_team_detail_parameters_are_rejected():
    assert client.get("/api/team-detail?team_id=abc&league_slug=tur.1").status_code == 422
    assert client.get("/api/team-detail?team_id=432&league_slug=unknown").status_code == 422


def test_invalid_insight_parameters_are_rejected():
    assert client.get("/api/leaders?league=unknown").status_code == 422
    assert client.get("/api/head-to-head?home_id=abc&away_id=2&league_slug=eng.1").status_code == 422
    assert client.get("/api/head-to-head?home_id=1&away_id=2&league_slug=unknown").status_code == 422


def test_pwa_manifest_service_worker_and_icons_are_served():
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert manifest.json()["short_name"] == "Nabız90"
    assert client.get("/sw.js").status_code == 200
    assert client.get("/images/app-icon-192.png").status_code == 200
    assert client.get("/images/app-icon-512.png").status_code == 200


def test_push_public_key_reports_disabled_without_server_configuration():
    response = client.get("/api/push/public-key")
    assert response.status_code == 200
    assert response.json() == {"enabled": False, "publicKey": ""}


def test_push_preferences_validate_endpoints_and_match_metadata():
    payload = {
        "subscription": {"endpoint": "http://insecure.example/push", "keys": {"p256dh": "a" * 24, "auth": "b" * 12}},
        "allMatches": True,
        "followedMatches": [],
    }
    assert client.post("/api/push/preferences", json=payload).status_code == 422


def test_notification_transitions_cover_background_match_updates():
    previous = {
        "status": "NS", "score": "vs", "homeScore": "0", "awayScore": "0",
        "homeRedCards": 0, "awayRedCards": 0, "statusDetail": "Scheduled",
    }
    live = {
        "status": "LIVE", "score": "1 - 0", "homeScore": "1", "awayScore": "0",
        "homeRedCards": 0, "awayRedCards": 0, "statusDetail": "12'", "minute": "12'",
        "homeTeam": "Ev", "awayTeam": "Deplasman", "league": "Lig",
    }
    events = notification_events(previous, live)
    assert [event["kind"] for event in events] == ["kickoff", "goal"]

    full_time = {**live, "status": "FT", "statusDetail": "Full Time", "minute": "MS"}
    assert [event["kind"] for event in notification_events(live, full_time)] == ["full-time"]
