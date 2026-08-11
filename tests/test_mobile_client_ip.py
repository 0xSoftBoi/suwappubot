"""Tests for api/routes/mobile.py::_client_ip — the per-IP rate-limit/pending-
cap identity fix (HIGH finding: previously request.client.host collapsed to
one shared peer IP behind Railway's edge, since uvicorn wasn't told to trust
X-Forwarded-For, making `_MAX_PENDING_PER_IP` a GLOBAL cap for every user).

Covers: rightmost (trusted-proxy-appended) hop wins over a spoofable leftmost
hop, and two distinct clients get genuinely isolated per-IP buckets end to
end through POST /v1/mobile/auth/telegram/start.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import api.routes.mobile as mobile_mod

_SECRET = "test-secret"


def _request_with_xff(xff: str) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-for", xff.encode())] if xff else [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "scheme": "http",
        "query_string": b"",
    }
    return Request(scope)


def test_client_ip_uses_rightmost_hop():
    req = _request_with_xff("1.2.3.4, 5.6.7.8, 9.9.9.9")
    assert mobile_mod._client_ip(req) == "9.9.9.9"


def test_client_ip_ignores_spoofed_leftmost_hop():
    """A client that sends its own fake `X-Forwarded-For: 6.6.6.6` gets that
    value APPENDED to (not replacing) by a real trusted proxy, so the
    resulting header a request actually arrives with looks like
    "6.6.6.6, <real-edge-observed-ip>". Trusting the leftmost entry (the old
    behavior, and some frameworks' default) would let the attacker pick any
    identity they want; only the rightmost, proxy-appended entry may be
    trusted."""
    spoofed_and_real = "6.6.6.6, 203.0.113.99"
    req = _request_with_xff(spoofed_and_real)
    assert mobile_mod._client_ip(req) == "203.0.113.99"


def test_client_ip_falls_back_to_peer_when_no_xff():
    req = _request_with_xff("")
    assert mobile_mod._client_ip(req) == "127.0.0.1"


# ── end-to-end per-IP isolation through the pairing-start route ────────────


def app_client():
    app = FastAPI()
    app.include_router(mobile_mod.router)
    return TestClient(app)


@pytest.fixture()
def client(monkeypatch, tmp_db):
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    return app_client()


@pytest.fixture(autouse=True)
def _reset_pairing_limiters():
    mobile_mod._pairing_start_limiter._user_requests.clear()
    yield
    mobile_mod._pairing_start_limiter._user_requests.clear()


def test_two_clients_get_isolated_pending_caps(client, monkeypatch):
    """BLOCKER regression: before the fix, both of these clients would share
    ONE global bucket (request.client.host is a fixed placeholder under
    TestClient regardless of headers), so client B would already be locked
    out by client A's requests. After the fix, `_client_ip` reads the
    per-request X-Forwarded-For header, so each gets its own bucket."""
    import bot.services.mobile_pairing_service as pairing_service_mod

    monkeypatch.setattr(pairing_service_mod, "_MAX_PENDING_PER_IP", 3)
    monkeypatch.setattr(mobile_mod._pairing_start_limiter, "max_requests", 1000)

    headers_a = {"X-Forwarded-For": "203.0.113.10"}
    headers_b = {"X-Forwarded-For": "203.0.113.20"}

    for _ in range(3):
        resp = client.post("/v1/mobile/auth/telegram/start", headers=headers_a)
        assert resp.status_code == 200

    # Client A is now at its cap.
    resp = client.post("/v1/mobile/auth/telegram/start", headers=headers_a)
    assert resp.status_code == 429

    # Client B, a genuinely different real IP, must NOT be blocked by A's cap.
    resp = client.post("/v1/mobile/auth/telegram/start", headers=headers_b)
    assert resp.status_code == 200


def test_spoofed_leftmost_hop_cannot_bypass_the_cap(client, monkeypatch):
    """An attacker varying the fake first X-Forwarded-For hop on every
    request (while the trusted proxy keeps appending the SAME real observed
    IP as the last hop) must still hit one bucket, not a fresh one each
    time."""
    import bot.services.mobile_pairing_service as pairing_service_mod

    monkeypatch.setattr(pairing_service_mod, "_MAX_PENDING_PER_IP", 3)
    monkeypatch.setattr(mobile_mod._pairing_start_limiter, "max_requests", 1000)

    real_edge_observed_ip = "203.0.113.77"
    for i in range(3):
        headers = {"X-Forwarded-For": f"6.6.6.{i}, {real_edge_observed_ip}"}
        resp = client.post("/v1/mobile/auth/telegram/start", headers=headers)
        assert resp.status_code == 200

    headers = {"X-Forwarded-For": f"6.6.6.250, {real_edge_observed_ip}"}
    resp = client.post("/v1/mobile/auth/telegram/start", headers=headers)
    assert resp.status_code == 429
