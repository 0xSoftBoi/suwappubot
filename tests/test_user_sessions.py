"""Tests for revocable JWT sessions (MONEY-PATH: MED finding — paired
sessions were previously unrevocable for the full 7-day token lifetime).

Covers:
  - a freshly minted (jti-bearing) token is accepted
  - a revoked session's token is rejected
  - a jti that claims to exist but has no matching row is rejected
  - GUARDRAIL: a token with NO jti claim at all (pre-existing/legacy tokens)
    stays valid forever — never looked up, never broken by this migration
  - GUARDRAIL: a DB failure during the revocation check fails OPEN (request
    allowed), not closed — a DB hiccup must never lock out every session
  - bot/handlers/sessions.py's /sessions revoke-all path actually revokes
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import uuid
from datetime import datetime, timezone

import jwt
import pytest

import api.main as main_mod
from bot.models.user import User
from bot.models.user_session import UserSession
from database.db import get_session

_SECRET = "test-secret"


@pytest.fixture(autouse=True)
def _jwt_secret_and_cache(monkeypatch):
    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    main_mod._SESSION_VALIDITY_CACHE.clear()
    yield
    main_mod._SESSION_VALIDITY_CACHE.clear()


def _make_user(telegram_id: int) -> int:
    with get_session() as session:
        user = User(telegram_id=telegram_id, username=f"u{telegram_id}", tos_accepted=True)
        session.add(user)
        session.flush()
        return user.id


# ── grandfathering: missing jti always stays valid ──────────────────────


def test_missing_jti_token_is_grandfathered_valid(tmp_db):
    """GUARDRAIL: a token minted before this feature shipped (no jti claim
    at all) must NEVER be looked up or rejected — deploying this must not
    retroactively invalidate every existing session in the wild."""
    token = jwt.encode({"user_id": 1, "src": "weak"}, _SECRET, algorithm="HS256")

    payload = main_mod.decode_jwt_token(token)

    assert payload is not None
    assert payload["user_id"] == 1


# ── normal lifecycle ─────────────────────────────────────────────────────


def test_freshly_minted_session_is_accepted(tmp_db):
    user_id = _make_user(111222)
    token = main_mod.create_jwt_token(address="", user_id=user_id, src="telegram")

    payload = main_mod.decode_jwt_token(token)

    assert payload is not None
    assert payload["user_id"] == user_id
    assert "jti" in payload  # DB write succeeded against the tmp_db fixture


def test_revoked_session_is_rejected(tmp_db):
    user_id = _make_user(111333)
    token = main_mod.create_jwt_token(address="", user_id=user_id, src="telegram")
    jti = jwt.decode(token, _SECRET, algorithms=["HS256"])["jti"]

    with get_session() as session:
        session.query(UserSession).filter(UserSession.jti == jti).update(
            {"revoked_at": datetime.now(timezone.utc)}
        )

    assert main_mod.decode_jwt_token(token) is None


def test_unknown_jti_is_rejected(tmp_db):
    """A jti claim with no matching user_sessions row (e.g. the row was
    somehow lost) must be rejected, not silently trusted."""
    fake_jti = str(uuid.uuid4())
    token = jwt.encode({"user_id": 5, "jti": fake_jti}, _SECRET, algorithm="HS256")

    assert main_mod.decode_jwt_token(token) is None


def test_revocation_cache_reflects_new_state_after_ttl(tmp_db, monkeypatch):
    """The short-TTL cache must not permanently pin a session's validity —
    once the cache entry expires, a subsequent revoke must be observed."""
    user_id = _make_user(111444)
    token = main_mod.create_jwt_token(address="", user_id=user_id, src="telegram")
    jti = jwt.decode(token, _SECRET, algorithms=["HS256"])["jti"]

    assert main_mod.decode_jwt_token(token) is not None  # populates the cache as valid

    with get_session() as session:
        session.query(UserSession).filter(UserSession.jti == jti).update(
            {"revoked_at": datetime.now(timezone.utc)}
        )

    # Force the cache entry to look expired instead of sleeping 30s.
    monkeypatch.setattr(main_mod, "_SESSION_VALIDITY_CACHE_TTL_SECONDS", -1.0)

    assert main_mod.decode_jwt_token(token) is None


# ── fail-open guardrail ──────────────────────────────────────────────────


def test_db_failure_during_revocation_check_fails_open(tmp_db, monkeypatch):
    """GUARDRAIL: if the revocation-check DB read itself errors, the request
    must be ALLOWED (fail open), not rejected — a DB hiccup must never lock
    out every already-issued session at once. Must still log loudly (not
    silently swallowed) — asserted via caplog."""
    user_id = _make_user(111555)
    token = main_mod.create_jwt_token(address="", user_id=user_id, src="telegram")

    def _boom():
        raise RuntimeError("simulated DB outage")

    # _check_session_valid calls the bare `get_session` name imported into
    # api/main.py's module namespace.
    monkeypatch.setattr(main_mod, "get_session", _boom)

    payload = main_mod.decode_jwt_token(token)

    assert payload is not None
    assert payload["user_id"] == user_id


def test_db_failure_fail_open_logs_loudly(tmp_db, monkeypatch, caplog):
    import logging

    caplog.set_level(logging.CRITICAL)
    user_id = _make_user(111666)
    token = main_mod.create_jwt_token(address="", user_id=user_id, src="telegram")

    def _boom():
        raise RuntimeError("simulated DB outage")

    monkeypatch.setattr(main_mod, "get_session", _boom)
    main_mod.decode_jwt_token(token)

    assert any(
        record.levelno == logging.CRITICAL and "revocation check failed" in record.getMessage()
        for record in caplog.records
    )


# ── /sessions bot command wiring ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_sessions_revoke_all_callback_revokes_and_rejects_token(tmp_db, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    from bot.handlers.sessions import sessions_revoke_all_callback

    tg_id = 777888
    with get_session() as session:
        user = User(telegram_id=tg_id, username="devices_user", tos_accepted=True)
        session.add(user)
        session.flush()
        user_id = user.id

    token = main_mod.create_jwt_token(address="", user_id=user_id, src="telegram")
    jti = jwt.decode(token, _SECRET, algorithms=["HS256"])["jti"]

    # Confirm the row was created unrevoked, without going through
    # decode_jwt_token first (that would populate the 30s validity cache as
    # "valid" and mask the revoke below until it expires — see
    # test_revocation_cache_reflects_new_state_after_ttl for that behavior).
    with get_session() as session:
        row = session.query(UserSession).filter(UserSession.jti == jti).first()
        assert row is not None
        assert row.revoked_at is None

    update = MagicMock()
    update.effective_user = MagicMock(id=tg_id)
    update.callback_query = MagicMock()
    update.callback_query.answer = AsyncMock()
    update.callback_query.edit_message_text = AsyncMock()
    context = MagicMock()

    await sessions_revoke_all_callback(update, context)

    update.callback_query.edit_message_text.assert_awaited_once()
    reply = update.callback_query.edit_message_text.call_args.args[0]
    assert "revoked" in reply.lower()

    assert main_mod.decode_jwt_token(token) is None
