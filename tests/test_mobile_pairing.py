"""Tests for Gekko mobile Telegram deeplink sign-in (MONEY-PATH):

  POST /v1/mobile/auth/telegram/start  — bot/services/mobile_pairing_service.py
  POST /v1/mobile/auth/telegram/poll   — same
  bot/handlers/start.py's `/start gekko_<code>` staging + Approve/Not me
  POST /v1/mobile/events               — analytics sink validation/redaction

Covers: happy path (stage -> approve -> poll), expired code, unknown code
(identical response to expired), single-use enforcement (incl. atomic
double-poll), no raw code in logs, per-IP rate limits, binding to the
Telegram-resolved user (not client input), the staged-but-not-approved
"pending" gate (a bare deeplink tap must NOT be enough to sign in), "Not me"
rejection, the verification word (returned by /start, stable, non-revealing),
the TOS-gate-doesn't-eat-the-code path, and the events endpoint's
name/prop validation + redaction.
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
    # the pending cap before ever reaching the rate limiter (10).
    import bot.services.mobile_pairing_service as pairing_service_mod

    monkeypatch.setattr(pairing_service_mod, "_MAX_PENDING_PER_IP", 1000)

    for _ in range(10):
        resp = client.post("/v1/mobile/auth/telegram/start")
        assert resp.status_code == 200

    resp = client.post("/v1/mobile/auth/telegram/start")
    assert resp.status_code == 429


def test_start_pairing_enforces_pending_cap_per_ip(client, monkeypatch):
    # Rate limiter (10/min) is generous enough to hit the service-level pending
    # cap first — confirm the cap itself is enforced with a 429. Imports the
    # real constant rather than a hardcoded literal so this can't drift out of
    # sync if `_MAX_PENDING_PER_IP` is re-tuned again later.
    from bot.services.mobile_pairing_service import _MAX_PENDING_PER_IP

    monkeypatch.setattr(mobile_mod._pairing_start_limiter, "max_requests", 100)

    for _ in range(_MAX_PENDING_PER_IP):
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

    staged = mobile_pairing_service.stage(pending.code, user_id)
    assert staged is True
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


def test_poll_staged_but_not_approved_stays_pending(client):
    """The core account-takeover fix: opening the deeplink alone (staging)
    must NOT be enough for poll to hand back a session — only an explicit
    Approve does."""
    from bot.models.user import User

    pending = mobile_pairing_service.create_pending(request_ip="5.5.5.1")
    with get_session() as session:
        user = User(telegram_id=111000222, username="staged_only", tos_accepted=True)
        session.add(user)
        session.flush()
        user_id = user.id

    staged = mobile_pairing_service.stage(pending.code, user_id)
    assert staged is True

    resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code})
    assert resp.status_code == 200
    assert resp.json() == {"status": "pending"}


def test_reject_prevents_approval_and_poll_never_ready(client):
    """ "Not me" must permanently kill the code — a subsequent Approve call
    (e.g. a delayed/duplicate tap) must not resurrect it, and poll must
    never see it as ready."""
    from bot.models.user import User

    pending = mobile_pairing_service.create_pending(request_ip="5.5.5.2")
    with get_session() as session:
        user = User(telegram_id=111000333, username="rejector", tos_accepted=True)
        session.add(user)
        session.flush()
        user_id = user.id

    assert mobile_pairing_service.stage(pending.code, user_id) is True
    assert mobile_pairing_service.reject(pending.code, user_id) is True

    # A later Approve attempt for the same code must fail — the row is gone.
    assert mobile_pairing_service.approve(pending.code, user_id) is False

    resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code})
    assert resp.status_code == 200
    assert resp.json() == {"status": "expired"}


def test_approve_requires_same_user_the_code_was_staged_to():
    """Even reaching the callback layer, approve() must reject a mismatched
    user id — defense in depth beyond the callback handler resolving its own
    users.id from the Telegram update."""
    from bot.models.user import User

    pending = mobile_pairing_service.create_pending(request_ip="5.5.5.3")
    with get_session() as session:
        victim = User(telegram_id=222000111, username="victim", tos_accepted=True)
        attacker = User(telegram_id=222000222, username="attacker", tos_accepted=True)
        session.add_all([victim, attacker])
        session.flush()
        victim_id, attacker_id = victim.id, attacker.id

    assert mobile_pairing_service.stage(pending.code, victim_id) is True
    # A different user id trying to approve the same staged code must fail.
    assert mobile_pairing_service.approve(pending.code, attacker_id) is False
    # The legitimate staged user can still approve it.
    assert mobile_pairing_service.approve(pending.code, victim_id) is True


def test_atomic_double_poll_yields_exactly_one_token(client):
    """MED fix: poll_and_consume must be an atomic conditional claim, not
    check-then-act — two polls racing for the same approved code must not
    both mint a JWT."""
    from bot.models.user import User

    pending = mobile_pairing_service.create_pending(request_ip="6.6.6.6")
    with get_session() as session:
        user = User(telegram_id=333000111, username="racer", tos_accepted=True)
        session.add(user)
        session.flush()
        user_id = user.id

    assert mobile_pairing_service.stage(pending.code, user_id) is True
    assert mobile_pairing_service.approve(pending.code, user_id) is True

    results = [
        client.post("/v1/mobile/auth/telegram/poll", json={"code": pending.code}).json()
        for _ in range(2)
    ]
    ready_results = [r for r in results if r.get("status") == "ready"]
    expired_results = [r for r in results if r.get("status") == "expired"]

    assert len(ready_results) == 1, f"expected exactly one 'ready', got {results}"
    assert len(expired_results) == 1


def test_poll_rate_limited_per_ip(client):
    for _ in range(60):
        resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": "x"})
        assert resp.status_code == 200

    resp = client.post("/v1/mobile/auth/telegram/poll", json={"code": "x"})
    assert resp.status_code == 429


# ── binding to the Telegram-resolved user (not client-supplied) ────────


@pytest.mark.asyncio
async def test_start_gekko_stages_only_does_not_grant_session(tmp_db):
    """`/start gekko_<code>` must ONLY stage — binding to the users.id the
    bot itself resolved from update.effective_user, never anything the
    client could supply — and a bare deeplink tap must NOT be enough for
    poll to hand back a session. This is the BLOCKER fix: one-tap
    phishing must not equal account takeover."""
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

    # Staged, NOT approved — poll must still say "pending", not "ready".
    result = mobile_pairing_service.poll_and_consume(pending.code)
    assert result == {"status": "pending"}

    update.message.reply_text.assert_awaited_once()
    reply_text = update.message.reply_text.call_args.args[0]
    reply_markup = update.message.reply_text.call_args.kwargs.get("reply_markup")
    assert "sign-in request" in reply_text.lower()
    assert "verification word" in reply_text.lower()
    assert reply_markup is not None  # Approve/Not me keyboard shown

    # Now drive the explicit Approve callback — only THIS grants a session.
    from bot.handlers.start import gekko_approve_callback, GEKKO_APPROVE_PREFIX

    approve_update = MagicMock()
    approve_update.effective_user = MagicMock(id=tg_id)
    approve_update.callback_query = MagicMock()
    approve_update.callback_query.data = f"{GEKKO_APPROVE_PREFIX}{pending.code}"
    approve_update.callback_query.answer = AsyncMock()
    approve_update.callback_query.edit_message_text = AsyncMock()

    await gekko_approve_callback(approve_update, context)

    approve_update.callback_query.edit_message_text.assert_awaited_once()
    approve_reply = approve_update.callback_query.edit_message_text.call_args.args[0]
    assert "signed in" in approve_reply.lower()

    ready = mobile_pairing_service.poll_and_consume(pending.code)
    assert ready == {"status": "ready", "user_id": expected_user_id}


@pytest.mark.asyncio
async def test_start_gekko_not_me_rejects_and_poll_never_ready(tmp_db):
    """The "Not me" callback must reject a staged request, and poll must
    never subsequently return ready for it."""
    from bot.handlers.start import start_command, gekko_reject_callback, GEKKO_REJECT_PREFIX
    from bot.models.user import User

    tg_id = 555111444
    with get_session() as session:
        session.add(User(telegram_id=tg_id, username="rejector", tos_accepted=True))

    pending = mobile_pairing_service.create_pending(request_ip="4.4.4.5")

    update = MagicMock()
    update.effective_user = MagicMock(id=tg_id, username="rejector", first_name="R", last_name=None)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = [f"{CODE_PREFIX}{pending.code}"]

    await start_command(update, context)

    reject_update = MagicMock()
    reject_update.effective_user = MagicMock(id=tg_id)
    reject_update.callback_query = MagicMock()
    reject_update.callback_query.data = f"{GEKKO_REJECT_PREFIX}{pending.code}"
    reject_update.callback_query.answer = AsyncMock()
    reject_update.callback_query.edit_message_text = AsyncMock()

    await gekko_reject_callback(reject_update, context)

    reject_update.callback_query.edit_message_text.assert_awaited_once()
    reject_reply = reject_update.callback_query.edit_message_text.call_args.args[0]
    assert "rejected" in reject_reply.lower()

    result = mobile_pairing_service.poll_and_consume(pending.code)
    assert result == {"status": "expired"}


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


@pytest.mark.asyncio
async def test_start_gekko_tos_gate_does_not_silently_eat_code(tmp_db):
    """LOW fix: a first-time user (no TOS acceptance yet) tapping the
    deeplink must be told to retry sign-in after accepting, not have the
    code silently dropped with no explanation."""
    from bot.handlers.start import start_command
    from bot.models.user import User

    tg_id = 555111555
    # No User row at all yet — brand-new user, tos_accepted defaults False.
    pending = mobile_pairing_service.create_pending(request_ip="4.4.4.6")

    update = MagicMock()
    update.effective_user = MagicMock(id=tg_id, username="newbie", first_name="N", last_name=None)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = [f"{CODE_PREFIX}{pending.code}"]

    await start_command(update, context)

    update.message.reply_text.assert_awaited_once()
    reply_text = update.message.reply_text.call_args.args[0]
    assert "terms" in reply_text.lower()
    assert "gekko" in reply_text.lower()
    assert "again" in reply_text.lower()

    # The code must still be untouched (still "pending") — TOS gate must not
    # have consumed/staged it.
    with get_session() as session:
        row = session.query(MobilePairing).first()
        assert row.status == "pending"
        assert row.user_id is None


# ── verification word ───────────────────────────────────────────────────


def test_verification_word_returned_and_stable_and_non_revealing(client):
    resp = client.post("/v1/mobile/auth/telegram/start")
    body = resp.json()

    assert "verificationWord" in body
    word = body["verificationWord"]
    assert isinstance(word, str) and len(word) == 5

    from bot.services.mobile_pairing_service import derive_verification_word

    # Stable: recomputing from the raw code (as the bot does independently)
    # gives the exact same word.
    assert derive_verification_word(body["code"]) == word

    # Non-revealing: the word must not literally appear inside the code
    # (a trivial substring leak would let it "reconstruct" part of the code).
    assert word not in body["code"]
    assert body["code"] not in word


# ── raw code never appears in logs ──────────────────────────────────────


def test_pairing_code_never_logged(client, caplog):
    caplog.set_level(logging.DEBUG)

    resp = client.post("/v1/mobile/auth/telegram/start")
    code = resp.json()["code"]

    client.post("/v1/mobile/auth/telegram/poll", json={"code": code})
    mobile_pairing_service.stage(code, telegram_resolved_user_id=1)
    mobile_pairing_service.approve(code, telegram_confirming_user_id=1)

    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert code not in log_text


# ── service-level: pending cap raises, not silently ignored ────────────


def test_create_pending_raises_over_ip_cap(tmp_db):
    from bot.services.mobile_pairing_service import _MAX_PENDING_PER_IP

    for _ in range(_MAX_PENDING_PER_IP):
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


def test_events_caps_prop_key_count(client):
    """MED fix: props were only capped by string length, not by NUMBER of
    keys — an authenticated user could grow mobile_events unbounded by
    sending many distinct tiny keys per event."""
    from bot.models.mobile_event import MobileEvent

    many_props = {f"k{i}": i for i in range(40)}
    resp = client.post(
        "/v1/mobile/events",
        json={"events": [{"name": "prop_flood", "props": many_props}]},
        headers=auth_headers(user_id=901),
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "accepted": 1}

    with get_session() as session:
        row = session.query(MobileEvent).filter(MobileEvent.user_id == 901).first()
        assert row is not None
        assert len(row.props) <= 20


def test_events_drops_non_finite_floats_instead_of_500ing(client):
    """MED fix: Python's json module accepts NaN/Infinity on the way in, but
    Postgres JSON/JSONB rejects them at flush — this previously 500'd an
    otherwise-valid batch. Non-finite values must be dropped, not stored.

    httpx's `json=` kwarg refuses to even encode a NaN/Infinity float
    client-side (`ValueError: Out of range float values are not JSON
    compliant`) — so this sends the raw JSON body (which DOES allow those as
    an extension, same as Python's own `json.dumps`/`json.loads` defaults)
    to reproduce exactly what a real client can send over the wire."""
    from bot.models.mobile_event import MobileEvent

    raw_body = (
        '{"events": [{"name": "bad_number", "props": '
        '{"nan_val": NaN, "inf_val": Infinity, "neg_inf_val": -Infinity, "fine": 3.5}}]}'
    )
    headers = {**auth_headers(user_id=902), "Content-Type": "application/json"}
    resp = client.post("/v1/mobile/events", content=raw_body, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "accepted": 1}

    with get_session() as session:
        row = session.query(MobileEvent).filter(MobileEvent.user_id == 902).first()
        assert row is not None
        assert row.props == {"fine": 3.5}


def test_events_rejects_oversized_body(client):
    """MED fix: a Content-Length guard rejects an obviously oversized batch
    before it's persisted."""
    huge_note = "x" * 100  # under the 200-char single-string cap...
    events = [
        {"name": "flood_event", "props": {f"k{i}": huge_note for i in range(20)}} for _ in range(50)
    ]  # ...but 50 events x 20 props each pushes the whole body well past 64KB.
    resp = client.post(
        "/v1/mobile/events",
        json={"events": events},
        headers=auth_headers(user_id=903),
    )

    assert resp.status_code == 413


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
