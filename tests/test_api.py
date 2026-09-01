from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "2.0.0"}


def test_unknown_league_is_rejected_without_upstream_request():
    response = client.get("/api/fixtures?league=unknown&date=2026-09-01")
    assert response.status_code == 422


def test_invalid_date_is_rejected():
    response = client.get("/api/fixtures?league=superlig&date=01-09-2026")
    assert response.status_code == 422
