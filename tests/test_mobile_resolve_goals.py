"""Tests for the newer Gekko mobile read/CRUD endpoints in api/routes/mobile.py:

  GET    /v1/mobile/resolve      — ENS forward resolution (read-only)
  GET    /v1/mobile/goals        — list the caller's savings goals
  POST   /v1/mobile/goals        — create a savings goal
  DELETE /v1/mobile/goals/{id}   — delete the caller's savings goal

No money movement. /resolve mocks at the `_resolve_ens_sync` boundary (never
hits a real RPC); goals CRUD hits a real (tmp) SQLite DB through the ORM.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from unittest.mock import MagicMock

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routes.mobile as mobile_mod

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(mobile_mod.router)
    return TestClient(app)


@pytest.fixture()
def client(monkeypatch):
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    return app_client()


@pytest.fixture(autouse=True)
def _reset_resolve_limiter():
    mobile_mod._resolve_action_limiter._user_requests.clear()
    yield
    mobile_mod._resolve_action_limiter._user_requests.clear()


# ── /resolve ─────────────────────────────────────────────────────────────


def test_resolve_requires_auth(client):
    resp = client.get("/v1/mobile/resolve", params={"name": "vitalik.eth"})
    assert resp.status_code == 401


@pytest.mark.parametrize(
    "bad_name",
    [
        "not-a-name",
        "vitalik.com",
        "has space.eth",
        "a" * 260 + ".eth",
        "",
        "..eth",
        "vitalik.eth.",
        "vitalik._eth",
    ],
)
def test_resolve_rejects_invalid_names(client, bad_name):
    resp = client.get("/v1/mobile/resolve", params={"name": bad_name}, headers=auth_headers())
    assert resp.status_code in (400, 422)


def test_resolve_happy_path(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_ens_sync", MagicMock(return_value="0x" + "ab" * 20))
    resp = client.get("/v1/mobile/resolve", params={"name": "Vitalik.eth"}, headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "vitalik.eth"
    # Checksummed — mixed case, not all-lowercase raw hex.
    assert body["address"].lower() == "0x" + "ab" * 20
    assert body["address"] != "0x" + "ab" * 20


def test_resolve_not_found(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_ens_sync", MagicMock(return_value=None))
    resp = client.get(
        "/v1/mobile/resolve", params={"name": "doesnotexist123456.eth"}, headers=auth_headers()
    )
    assert resp.status_code == 404


def test_resolve_rpc_failure_returns_503(client, monkeypatch):
    def _boom(name):
        raise ConnectionError("rpc down")

    monkeypatch.setattr(mobile_mod, "_resolve_ens_sync", _boom)
    resp = client.get("/v1/mobile/resolve", params={"name": "vitalik.eth"}, headers=auth_headers())
    assert resp.status_code == 503


def test_resolve_rate_limited(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_ens_sync", MagicMock(return_value="0x" + "ab" * 20))
    for _ in range(30):
        resp = client.get(
            "/v1/mobile/resolve", params={"name": "vitalik.eth"}, headers=auth_headers()
        )
        assert resp.status_code == 200
    resp = client.get("/v1/mobile/resolve", params={"name": "vitalik.eth"}, headers=auth_headers())
    assert resp.status_code == 429


# ── /goals ───────────────────────────────────────────────────────────────


def test_goals_list_requires_auth(client):
    resp = client.get("/v1/mobile/goals")
    assert resp.status_code == 401


def test_goals_create_requires_auth(client):
    resp = client.post("/v1/mobile/goals", json={"name": "Trip", "targetUsd": 500})
    assert resp.status_code == 401


def test_goals_crud_happy_path(client, tmp_db):
    resp = client.get("/v1/mobile/goals", headers=auth_headers())
    assert resp.status_code == 200
    assert resp.json() == {"goals": []}

    resp = client.post(
        "/v1/mobile/goals",
        json={"name": " New laptop ", "targetUsd": 1500},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    created = resp.json()
    assert created["name"] == "New laptop"
    assert created["targetUsd"] == 1500.0
    assert created["id"] is not None
    assert created["createdAt"] is not None

    resp = client.get("/v1/mobile/goals", headers=auth_headers())
    assert resp.status_code == 200
    goals = resp.json()["goals"]
    assert len(goals) == 1
    assert goals[0]["id"] == created["id"]

    resp = client.delete(f"/v1/mobile/goals/{created['id']}", headers=auth_headers())
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    resp = client.get("/v1/mobile/goals", headers=auth_headers())
    assert resp.json() == {"goals": []}


def test_goals_create_validates_name(client, tmp_db):
    resp = client.post(
        "/v1/mobile/goals", json={"name": "   ", "targetUsd": 100}, headers=auth_headers()
    )
    assert resp.status_code == 400

    resp = client.post(
        "/v1/mobile/goals", json={"name": "x" * 65, "targetUsd": 100}, headers=auth_headers()
    )
    assert resp.status_code == 400


@pytest.mark.parametrize("bad_target", [0, -5, 10_000_001])
def test_goals_create_validates_target(client, tmp_db, bad_target):
    resp = client.post(
        "/v1/mobile/goals",
        json={"name": "Goal", "targetUsd": bad_target},
        headers=auth_headers(),
    )
    assert resp.status_code == 400


def test_goals_create_enforces_max_per_user(client, tmp_db):
    for i in range(10):
        resp = client.post(
            "/v1/mobile/goals",
            json={"name": f"Goal {i}", "targetUsd": 100},
            headers=auth_headers(),
        )
        assert resp.status_code == 200

    resp = client.post(
        "/v1/mobile/goals",
        json={"name": "Goal 11", "targetUsd": 100},
        headers=auth_headers(),
    )
    assert resp.status_code == 400

    # A different user is unaffected by user 1's cap.
    resp = client.post(
        "/v1/mobile/goals",
        json={"name": "Other user goal", "targetUsd": 100},
        headers=auth_headers(user_id=2),
    )
    assert resp.status_code == 200


def test_goals_delete_unknown_id_returns_404(client, tmp_db):
    resp = client.delete("/v1/mobile/goals/999999", headers=auth_headers())
    assert resp.status_code == 404


def test_goals_delete_ownership_isolation(client, tmp_db):
    """User A cannot delete user B's goal."""
    resp = client.post(
        "/v1/mobile/goals",
        json={"name": "B's goal", "targetUsd": 250},
        headers=auth_headers(user_id=2),
    )
    assert resp.status_code == 200
    goal_id = resp.json()["id"]

    resp = client.delete(f"/v1/mobile/goals/{goal_id}", headers=auth_headers(user_id=1))
    assert resp.status_code == 404

    resp = client.get("/v1/mobile/goals", headers=auth_headers(user_id=2))
    assert len(resp.json()["goals"]) == 1

    resp = client.delete(f"/v1/mobile/goals/{goal_id}", headers=auth_headers(user_id=2))
    assert resp.status_code == 200
