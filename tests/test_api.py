from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "3.3.0"}

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
    assert manifest.json()["short_name"] == "CanlıSpor"
    assert client.get("/sw.js").status_code == 200
    assert client.get("/images/app-icon-192.png").status_code == 200
    assert client.get("/images/app-icon-512.png").status_code == 200
