"""Tests for Gekko mobile Telegram deeplink sign-in (MONEY-PATH):

  POST /v1/mobile/auth/telegram/start  — bot/services/mobile_pairing_service.py
  POST /v1/mobile/auth/telegram/poll   — same
  bot/handlers/start.py's `/start gekko_<code>` binding
  POST /v1/mobile/events               — analytics sink validation/redaction

Covers: happy path, expired code, unknown code (identical response to
expired), single-use enforcement, no raw code in logs, per-IP rate limits,
binding to the Telegram-resolved user (not client input), and the events
endpoint's name/prop validation + redaction.
"""

import logging
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routes.mobile as mobile_mod
from bot.models.mobile_pairing import MobilePairing
from bot.services.mobile_pairing_service import (
    CODE_PREFIX,
    MobilePairingError,
    mobile_pairing_service,
)
from database.db import get_session

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


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
    mobile_mod._pairing_poll_limiter._user_requests.clear()
    mobile_mod._events_limiter._user_requests.clear()
    yield
    mobile_mod._pairing_start_limiter._user_requests.clear()
    mobile_mod._pairing_poll_limiter._user_requests.clear()
    mobile_mod._events_limiter._user_requests.clear()


# ── POST /auth/telegram/start ───────────────────────────────────────────


def test_start_pairing_returns_code_and_deeplink(client):
    resp = client.post("/v1/mobile/auth/telegram/start")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["code"]) >= 32  # secrets.token_urlsafe(32) is well over 128 bits
    assert body["deeplink"].startswith("https://t.me/")
    assert body["deeplink"].endswith(f"?start={CODE_PREFIX}{body['code']}")
    assert body["expiresAt"]


def test_start_pairing_no_auth_required(client):
    # Deliberately no Authorization header — this route must work unauthenticated.
    resp = client.post("/v1/mobile/auth/telegram/start")
    assert resp.status_code == 200


def test_start_pairing_rate_limited_per_ip(client, monkeypatch):
    # Isolate the request-rate limiter from the (lower) service-level pending
    # cap, which is covered separately below — otherwise this loop would trip
    # the pending cap (5) before ever reaching the rate limiter (10).
    import bot.services.mobile_pairing_service as pairing_service_mod

    monkeypatch.setattr(pairing_service_mod, "_MAX_PENDING_PER_IP", 1000)

    for _ in range(10):
        resp = client.post("/v1/mobile/auth/telegram/start")
        assert resp.status_code == 200

    resp = client.post("/v1/mobile/auth/telegram/start")
    assert resp.status_code == 429


def test_start_pairing_enforces_pending_cap_per_ip(client, monkeypatch):
    # Rate limiter (10/min) is generous enough to hit the service-level pending
    # cap (5) first — confirm the cap itself is enforced with a 429.
    monkeypatch.setattr(mobile_mod._pairing_start_limiter, "max_requests", 100)

    for _ in range(5):
        resp = client.post("/v1/mobile/auth/telegram/start")
        assert resp.status_code == 200

    resp = client.post("/v1/mobile/auth/telegram/start")
    assert resp.status_code == 429


# ── POST /auth/telegram/poll ────────────────────────────────────────────


def test_poll_pending_code_returns_pending(client):
    pending = mobile_pairing_service.create_pending(request_ip="1.1.1.1")

    resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code})

    assert resp.status_code == 200
    assert resp.json() == {"status": "pending"}


def test_poll_unknown_code_returns_expired(client):
    resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": "totally-made-up-code"})

    assert resp.status_code == 200
    assert resp.json() == {"status": "expired"}


def test_poll_expired_code_returns_expired_identically(client):
    pending = mobile_pairing_service.create_pending(request_ip="2.2.2.2")

    # Force-expire the row directly (bypassing the 5-minute TTL) so this test
    # doesn't need to sleep.
    with get_session() as session:
        row = session.query(MobilePairing).first()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    resp_expired = client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code})
    resp_unknown = client.post("/v1/mobile/auth/telegram/poll", json={"code": "never-existed"})

    assert resp_expired.status_code == resp_unknown.status_code == 200
    assert resp_expired.json() == resp_unknown.json() == {"status": "expired"}


def test_poll_ready_mints_jwt_and_is_single_use(client, monkeypatch):
    from bot.models.user import User

    pending = mobile_pairing_service.create_pending(request_ip="3.3.3.3")

    with get_session() as session:
        user = User(telegram_id=999888, username="gekkouser", tos_accepted=True)
        session.add(user)
        session.flush()
        user_id = user.id

    approved = mobile_pairing_service.approve(pending.code, user_id)
    assert approved is True

    resp1 = client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code})
    assert resp1.status_code == 200
    body = resp1.json()
    assert body["status"] == "ready"
    assert body["userId"] == user_id
    decoded = jwt.decode(body["token"], _SECRET, algorithms=["HS256"])
    assert decoded["user_id"] == user_id
    assert decoded["src"] == "telegram"

    # Single-use: an identical second poll must NOT hand back another token.
    resp2 = client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code})
    assert resp2.status_code == 200
    assert resp2.json() == {"status": "expired"}


def test_poll_rate_limited_per_ip(client):
    for _ in range(60):
        resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": "x"})
        assert resp.status_code == 200

    resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": "x"})
    assert resp.status_code == 429


# ── binding to the Telegram-resolved user (not client-supplied) ────────


@pytest.mark.asyncio
async def test_start_gekko_binds_to_telegram_resolved_user(tmp_db):
    """`/start gekko_<code>` must bind to the users.id the bot itself
    resolved from update.effective_user — never anything the client could
    supply. This is the actual account-takeover boundary."""
    from bot.handlers.start import start_command
    from bot.models.user import User

    tg_id = 555111222
    with get_session() as session:
        user = User(telegram_id=tg_id, username="realowner", tos_accepted=True)
        session.add(user)
        session.flush()
        expected_user_id = user.id

    pending = mobile_pairing_service.create_pending(request_ip="4.4.4.4")

    update = MagicMock()
    update.effective_user = MagicMock(
        id=tg_id, username="realowner", first_name="Real", last_name=None
    )
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = [f"{CODE_PREFIX}{pending.code}"]

    await start_command(update, context)

    result = mobile_pairing_service.poll_and_consume(pending.code)
    assert result == {"status": "ready", "user_id": expected_user_id}

    update.message.reply_text.assert_awaited_once()
    reply_text = update.message.reply_text.call_args.args[0]
    assert "signed in" in reply_text.lower()


@pytest.mark.asyncio
async def test_start_gekko_unknown_code_gives_neutral_reply(tmp_db):
    from bot.handlers.start import start_command
    from bot.models.user import User

    tg_id = 555111333
    with get_session() as session:
        session.add(User(telegram_id=tg_id, username="someone", tos_accepted=True))

    update = MagicMock()
    update.effective_user = MagicMock(id=tg_id, username="someone", first_name="S", last_name=None)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = [f"{CODE_PREFIX}not-a-real-code"]

    await start_command(update, context)

    update.message.reply_text.assert_awaited_once()
    reply_text = update.message.reply_text.call_args.args[0]
    assert "invalid or has expired" in reply_text.lower()


# ── raw code never appears in logs ──────────────────────────────────────


def test_pairing_code_never_logged(client, caplog):
    caplog.set_level(logging.DEBUG)

    resp = client.post("/v1/mobile/auth/telegram/start")
    code = resp.json()["code"]

    client.post("/v1/mobile/auth/telegram/poll", json={"code": code})
    mobile_pairing_service.approve(code, telegram_resolved_user_id=1)

    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert code not in log_text


# ── service-level: pending cap raises, not silently ignored ────────────


def test_create_pending_raises_over_ip_cap(tmp_db):
    for _ in range(5):
        mobile_pairing_service.create_pending(request_ip="9.9.9.9")

    with pytest.raises(MobilePairingError):
        mobile_pairing_service.create_pending(request_ip="9.9.9.9")


# ── POST /v1/mobile/events ──────────────────────────────────────────────


def test_events_requires_auth(client):
    resp = client.post("/v1/mobile/events", json={"events": [{"name": "app_opened"}]})
    assert resp.status_code == 401


def test_events_accepts_valid_batch(client):
    resp = client.post(
        "/v1/mobile/events",
        json={
            "events": [
                {"name": "app_opened", "props": {"screen": "home"}},
                {"name": "swap_tapped", "ts": "2026-08-11T12:00:00Z"},
            ]
        },
        headers=auth_headers(),
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "accepted": 2}


def test_events_rejects_bad_name_but_keeps_valid_ones(client):
    resp = client.post(
        "/v1/mobile/events",
        json={
            "events": [
                {"name": "Bad-Name!"},  # invalid: uppercase + punctuation
                {"name": "ok"},  # invalid: too short (needs 3-49 chars)
                {"name": "valid_event_name"},
            ]
        },
        headers=auth_headers(),
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "accepted": 1}


def test_events_rejects_over_50_per_request(client):
    events = [{"name": "valid_event_name"} for _ in range(51)]
    resp = client.post("/v1/mobile/events", json={"events": events}, headers=auth_headers())

    assert resp.status_code == 400


def test_events_redacts_address_and_tx_hash_like_props(client):
    from bot.models.mobile_event import MobileEvent

    resp = client.post(
        "/v1/mobile/events",
        json={
            "events": [
                {
                    "name": "wallet_viewed",
                    "props": {
                        "wallet": "0x" + "ab" * 20,  # EVM address shape
                        "txHash": "0x" + "cd" * 32,  # tx hash shape
                        "note": "x" * 250,  # oversized string
                        "screen": "wallet",  # clean
                        "count": 3,  # clean
                    },
                }
            ]
        },
        headers=auth_headers(user_id=42),
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "accepted": 1}

    with get_session() as session:
        row = session.query(MobileEvent).filter(MobileEvent.user_id == 42).first()
        assert row is not None
        assert row.props == {"screen": "wallet", "count": 3}


def test_events_rate_limited_per_user(client):
    for _ in range(60):
        resp = client.post(
            "/v1/mobile/events",
            json={"events": [{"name": "ping_event"}]},
            headers=auth_headers(user_id=7),
        )
        assert resp.status_code == 200

    resp = client.post(
        "/v1/mobile/events",
        json={"events": [{"name": "ping_event"}]},
        headers=auth_headers(user_id=7),
    )
    assert resp.status_code == 429
