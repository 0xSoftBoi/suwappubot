"""Tests for /claim and /unlink (bot/handlers/claim_agent.py).

Uses an in-memory sqlite database with a real ``users`` table (via the
User ORM model, since the handler queries it through SQLAlchemy ORM) plus
raw ``agents`` / ``agent_link_codes`` tables that mirror the shared schema
(api-ts's agents.ts / agentLinkCodes.ts + database/db.py's Python-side
migrations for the same tables).
"""

import hashlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.db import Base
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from bot.models.subscription import Subscription
from bot.handlers import claim_agent as claim_agent_module
from bot.handlers.claim_agent import claim_agent_command, unlink_agent_command

CALLER_TG_ID = 111222
OTHER_TG_ID = 333444


def _make_session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Real users table (ORM-mapped) since the handler does ORM queries against
    # it, plus wallets/swaps/subscriptions since User.wallets/subscription use
    # lazy="selectin" and would otherwise try to SELECT from tables that don't
    # exist the moment any User row is loaded via the ORM.
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Wallet.__table__,
            SwapTransaction.__table__,
            Subscription.__table__,
        ],
    )

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE agents ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "name TEXT NOT NULL, "
                "owner_user_id INTEGER)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE agent_link_codes ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "agent_id INTEGER NOT NULL, "
                "code_hash VARCHAR(64) NOT NULL UNIQUE, "
                "expires_at TIMESTAMP NOT NULL, "
                "used_at TIMESTAMP, "
                "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
        )
    return sessionmaker(bind=engine)


def _seed_agent(SessionLocal, name="TestAgent", owner_user_id=None):
    session = SessionLocal()
    result = session.execute(
        text("INSERT INTO agents (name, owner_user_id) VALUES (:n, :o)"),
        {"n": name, "o": owner_user_id},
    )
    session.commit()
    agent_id = result.lastrowid
    session.close()
    return agent_id


def _seed_code(
    SessionLocal, agent_id, code="raw-code-123", expires_delta=timedelta(minutes=10), used=False
):
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    session = SessionLocal()
    expires_at = datetime.now(timezone.utc) + expires_delta
    used_at = datetime.now(timezone.utc) if used else None
    session.execute(
        text(
            "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at, used_at) "
            "VALUES (:a, :h, :e, :u)"
        ),
        {"a": agent_id, "h": code_hash, "e": expires_at, "u": used_at},
    )
    session.commit()
    session.close()
    return code, code_hash


def _patch_get_session(monkeypatch, SessionLocal):
    @contextmanager
    def _fake_get_session():
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(claim_agent_module, "get_session", _fake_get_session)


def _make_update(tg_id, args):
    update = MagicMock()
    update.effective_user = MagicMock(id=tg_id)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    # Fresh limiter state per test so the 5/60s cap doesn't bleed across tests.
    claim_agent_module._claim_limiter._user_requests.clear()
    yield


@pytest.mark.asyncio
async def test_claim_happy_path_via_returning(monkeypatch):
    SessionLocal = _make_session_factory()
    agent_id = _seed_agent(SessionLocal, name="Alpha")
    code, _ = _seed_code(SessionLocal, agent_id)
    _patch_get_session(monkeypatch, SessionLocal)

    update, context = _make_update(CALLER_TG_ID, [code])
    await claim_agent_command(update, context)

    text_out = update.message.reply_text.call_args[0][0]
    assert "Alpha" in text_out
    assert "✅" in text_out

    session = SessionLocal()
    row = session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :a"), {"a": agent_id}
    ).fetchone()
    user_row = session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": CALLER_TG_ID}
    ).fetchone()
    assert user_row is not None
    assert row[0] == user_row[0]
    used_row = session.execute(
        text("SELECT used_at FROM agent_link_codes WHERE agent_id = :a"), {"a": agent_id}
    ).fetchone()
    assert used_row[0] is not None
    session.close()


@pytest.mark.asyncio
async def test_claim_reuse_rejected(monkeypatch):
    SessionLocal = _make_session_factory()
    agent_id = _seed_agent(SessionLocal, name="Alpha")
    code, _ = _seed_code(SessionLocal, agent_id)
    _patch_get_session(monkeypatch, SessionLocal)

    update1, context1 = _make_update(CALLER_TG_ID, [code])
    await claim_agent_command(update1, context1)

    update2, context2 = _make_update(OTHER_TG_ID, [code])
    await claim_agent_command(update2, context2)

    text_out = update2.message.reply_text.call_args[0][0]
    assert "invalid, already used, or expired" in text_out

    session = SessionLocal()
    other_user = session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": OTHER_TG_ID}
    ).fetchone()
    assert other_user is None  # reuse never got far enough to create a users row
    session.close()


@pytest.mark.asyncio
async def test_claim_expired_rejected(monkeypatch):
    SessionLocal = _make_session_factory()
    agent_id = _seed_agent(SessionLocal, name="Alpha")
    code, _ = _seed_code(SessionLocal, agent_id, expires_delta=timedelta(minutes=-5))
    _patch_get_session(monkeypatch, SessionLocal)

    update, context = _make_update(CALLER_TG_ID, [code])
    await claim_agent_command(update, context)

    text_out = update.message.reply_text.call_args[0][0]
    assert "invalid, already used, or expired" in text_out


@pytest.mark.asyncio
async def test_claim_already_linked_agent_rejected_and_code_rolled_back(monkeypatch):
    SessionLocal = _make_session_factory()
    # Agent is already owned by someone else (owner_user_id=999).
    agent_id = _seed_agent(SessionLocal, name="Alpha", owner_user_id=999)
    code, code_hash = _seed_code(SessionLocal, agent_id)
    _patch_get_session(monkeypatch, SessionLocal)

    update, context = _make_update(CALLER_TG_ID, [code])
    await claim_agent_command(update, context)

    text_out = update.message.reply_text.call_args[0][0]
    assert "already linked to an owner" in text_out

    # The code's used_at must be rolled back to NULL so a legitimate owner
    # isn't locked out by a burned code.
    session = SessionLocal()
    row = session.execute(
        text("SELECT used_at FROM agent_link_codes WHERE code_hash = :h"), {"h": code_hash}
    ).fetchone()
    assert row[0] is None
    session.close()


@pytest.mark.asyncio
async def test_unlink_scoped_to_owner(monkeypatch):
    SessionLocal = _make_session_factory()
    # Seed the caller's users row first so owner_user_id matches.
    session = SessionLocal()
    caller = User(telegram_id=CALLER_TG_ID)
    session.add(caller)
    session.commit()
    caller_id = caller.id
    session.close()

    agent_id = _seed_agent(SessionLocal, name="Alpha", owner_user_id=caller_id)
    _patch_get_session(monkeypatch, SessionLocal)

    update, context = _make_update(CALLER_TG_ID, ["Alpha"])
    await unlink_agent_command(update, context)

    text_out = update.message.reply_text.call_args[0][0]
    assert "unlinked" in text_out

    session = SessionLocal()
    row = session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :a"), {"a": agent_id}
    ).fetchone()
    assert row[0] is None
    session.close()


@pytest.mark.asyncio
async def test_unlink_by_non_owner_is_noop(monkeypatch):
    SessionLocal = _make_session_factory()
    session = SessionLocal()
    owner = User(telegram_id=CALLER_TG_ID)
    other = User(telegram_id=OTHER_TG_ID)
    session.add_all([owner, other])
    session.commit()
    owner_id = owner.id
    session.close()

    agent_id = _seed_agent(SessionLocal, name="Alpha", owner_user_id=owner_id)
    _patch_get_session(monkeypatch, SessionLocal)

    # OTHER_TG_ID tries to unlink an agent they don't own.
    update, context = _make_update(OTHER_TG_ID, ["Alpha"])
    await unlink_agent_command(update, context)

    text_out = update.message.reply_text.call_args[0][0]
    assert "Couldn't find" in text_out

    session = SessionLocal()
    row = session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :a"), {"a": agent_id}
    ).fetchone()
    assert row[0] == owner_id  # untouched
    session.close()
