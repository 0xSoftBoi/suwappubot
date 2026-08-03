"""Tests for the approval_requests atomic decide + expiry-sweep logic.

Covers bot/handlers/approvals.py's guarded UPDATE ... WHERE status='pending'
AND user_id=:caller_user_id, and bot/services/approval_notifier.py's expiry
sweep. approval_requests is owned/created by api-ts (schema at
api-ts/src/db/schema/approvals.ts); these tests build a SQLite-compatible
shadow table (plus a minimal users table so the telegram_id -> users.id ->
approval_requests.user_id ownership chain is exercised for real) rather than
mocking, since the whole point of this logic is the atomic UPDATE semantics.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import bot.handlers.approvals as approvals_module
from bot.handlers.approvals import (
    _consume_step_up_challenge,
    _decide_approval,
    _issue_step_up_challenge,
)

OWNER_TG_ID = 555  # matches the seeded users row for the owning user
OTHER_TG_ID = 999  # a different Telegram user, no approval ownership


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(text("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id BIGINT UNIQUE
                )
                """))
        conn.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": OWNER_TG_ID})
        conn.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": OTHER_TG_ID})
        conn.execute(text("""
                CREATE TABLE approval_requests (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    organization_id TEXT,
                    user_id INTEGER REFERENCES users(id),
                    action_type TEXT NOT NULL,
                    payload TEXT,
                    payload_hash TEXT,
                    policy_decision_id INTEGER,
                    reason TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    expires_at TIMESTAMP NOT NULL,
                    decided_by INTEGER REFERENCES users(id),
                    decided_at TIMESTAMP,
                    consumed_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    notified_at TIMESTAMP,
                    notify_chat_id INTEGER,
                    notify_message_id INTEGER
                )
                """))
        conn.execute(text("""
                CREATE TABLE agents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT UNIQUE,
                    name TEXT
                )
                """))
        conn.execute(text("""
                CREATE TABLE approval_step_up_challenges (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    approval_id TEXT NOT NULL REFERENCES approval_requests(id),
                    challenge TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    used_at TIMESTAMP
                )
                """))
        conn.commit()
    return sessionmaker(bind=engine)()


def _resolve_user_id(session, telegram_id: int):
    row = session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": telegram_id}
    ).fetchone()
    return row[0] if row else None


def _insert_pending(session, owner_telegram_id=OWNER_TG_ID, agent_id="agent-1", expires_in_min=15):
    approval_id = str(uuid.uuid4())
    owner_user_id = _resolve_user_id(session, owner_telegram_id)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=expires_in_min)).replace(
        tzinfo=None
    )
    session.execute(
        text(
            "INSERT INTO approval_requests "
            "(id, agent_id, user_id, action_type, payload, status, expires_at) "
            "VALUES (:id, :agent_id, :user_id, 'swap_execute', '{}', 'pending', :expires_at)"
        ),
        {
            "id": approval_id,
            "agent_id": agent_id,
            "user_id": owner_user_id,
            "expires_at": expires_at,
        },
    )
    session.commit()
    return approval_id


def _decide(session, approval_id: str, new_status: str, tapper_telegram_id: int) -> int:
    """Mirrors the guarded UPDATE in bot/handlers/approvals.py: the caller's
    Telegram id is resolved to users.id first, then used as the ownership
    guard against approval_requests.user_id (an integer FK, not a raw
    Telegram id)."""
    caller_user_id = _resolve_user_id(session, tapper_telegram_id)
    if caller_user_id is None:
        return 0
    result = session.execute(
        text(
            "UPDATE approval_requests "
            "SET status = :new_status, decided_by = :decided_by, "
            "decided_at = CURRENT_TIMESTAMP "
            "WHERE id = :id AND status = 'pending' AND user_id = :caller_user_id"
        ),
        {
            "new_status": new_status,
            "decided_by": caller_user_id,
            "id": approval_id,
            "caller_user_id": caller_user_id,
        },
    )
    session.commit()
    return result.rowcount or 0


@pytest.fixture()
def session():
    s = _make_session()
    yield s
    s.close()


def test_decide_pending_approval_succeeds_once(session):
    approval_id = _insert_pending(session)

    rowcount = _decide(session, approval_id, "approved", tapper_telegram_id=OWNER_TG_ID)
    assert rowcount == 1

    row = session.execute(
        text("SELECT status, decided_by FROM approval_requests WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row[0] == "approved"
    assert row[1] == _resolve_user_id(session, OWNER_TG_ID)


def test_double_decide_is_a_noop_and_preserves_first_decision(session):
    approval_id = _insert_pending(session)

    first = _decide(session, approval_id, "approved", tapper_telegram_id=OWNER_TG_ID)
    assert first == 1

    # A second, conflicting decision (even by the rightful owner) must not
    # flip an already-decided row.
    second = _decide(session, approval_id, "denied", tapper_telegram_id=OWNER_TG_ID)
    assert second == 0

    row = session.execute(
        text("SELECT status FROM approval_requests WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row[0] == "approved"


def test_non_owner_cannot_decide(session):
    """The ownership guard: a callback tap from a telegram id other than the
    row's owner must not be able to flip status, even though the row is
    still pending."""
    approval_id = _insert_pending(session, owner_telegram_id=OWNER_TG_ID)

    # Attacker (OTHER_TG_ID) tries to decide the victim's (OWNER_TG_ID) approval.
    rowcount = _decide(session, approval_id, "approved", tapper_telegram_id=OTHER_TG_ID)
    assert rowcount == 0

    row = session.execute(
        text("SELECT status, decided_by FROM approval_requests WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row[0] == "pending"
    assert row[1] is None

    # The rightful owner can still decide it afterwards.
    rowcount = _decide(session, approval_id, "approved", tapper_telegram_id=OWNER_TG_ID)
    assert rowcount == 1


def test_unlinked_telegram_user_cannot_decide(session):
    """A Telegram user with no users row at all (caller_user_id is None) can
    never match the guard, regardless of the row's actual owner."""
    approval_id = _insert_pending(session)
    rowcount = _decide(session, approval_id, "approved", tapper_telegram_id=1234567)
    assert rowcount == 0


def test_pending_query_scopes_to_owning_user(session):
    mine = _insert_pending(session, owner_telegram_id=OWNER_TG_ID, agent_id="mine")
    _insert_pending(session, owner_telegram_id=OTHER_TG_ID, agent_id="not-mine")

    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)
    rows = session.execute(
        text("SELECT id FROM approval_requests WHERE user_id = :uid AND status = 'pending'"),
        {"uid": owner_user_id},
    ).fetchall()

    assert [r[0] for r in rows] == [mine]


def test_expiry_sweep_flips_pending_past_expiry_to_expired(session):
    """Mirrors approval_notifier.py's _expire_stale: a still-pending row past
    expires_at is flipped to 'expired'; a not-yet-expired row is untouched."""
    expired_id = _insert_pending(session, expires_in_min=-5)  # already past expiry
    live_id = _insert_pending(session, expires_in_min=15)  # still has time left

    rows = session.execute(
        text(
            "SELECT id FROM approval_requests "
            "WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP"
        )
    ).fetchall()
    ids = [r[0] for r in rows]
    assert expired_id in ids
    assert live_id not in ids

    session.execute(
        text("UPDATE approval_requests SET status = 'expired' WHERE id IN :ids").bindparams(
            __import__("sqlalchemy").bindparam("ids", expanding=True)
        ),
        {"ids": ids},
    )
    session.commit()

    expired_row = session.execute(
        text("SELECT status FROM approval_requests WHERE id = :id"), {"id": expired_id}
    ).fetchone()
    live_row = session.execute(
        text("SELECT status FROM approval_requests WHERE id = :id"), {"id": live_id}
    ).fetchone()
    assert expired_row[0] == "expired"
    assert live_row[0] == "pending"

    # An expired row can no longer be decided by anyone, including the owner.
    rowcount = _decide(session, expired_id, "approved", tapper_telegram_id=OWNER_TG_ID)
    assert rowcount == 0


# --- bot/handlers/approvals.py's real _decide_approval / step-up helpers ---
# (as opposed to the hand-rolled _decide() mirror above, which predates the
# expires_at guard and the step-up two-tap flow)


def test_decide_approval_rejects_lapsed_but_unswept_row(session):
    """_decide_approval (the actual function used by the Telegram callback)
    must not flip a row that is still status='pending' in the DB but whose
    expires_at has already passed and simply hasn't been swept yet -- the
    guard is `AND expires_at > CURRENT_TIMESTAMP` on the UPDATE itself, not
    reliant on the sweep having run first."""
    approval_id = _insert_pending(session, expires_in_min=-1)  # lapsed, still 'pending' in DB
    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)

    decided_now, row = _decide_approval(
        session, approval_id=approval_id, caller_user_id=owner_user_id, new_status="approved"
    )

    assert decided_now is False
    status = row[0]
    assert status == "pending"  # untouched -- the expiry guard blocked the flip


def test_decide_approval_succeeds_for_live_row(session):
    approval_id = _insert_pending(session, expires_in_min=15)
    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)

    decided_now, row = _decide_approval(
        session, approval_id=approval_id, caller_user_id=owner_user_id, new_status="approved"
    )

    assert decided_now is True
    assert row[0] == "approved"


def test_step_up_challenge_is_single_use_and_owner_scoped(session):
    approval_id = _insert_pending(session)
    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)
    other_user_id = _resolve_user_id(session, OTHER_TG_ID)

    token = _issue_step_up_challenge(session, user_id=owner_user_id, approval_id=approval_id)

    # Wrong user can't consume someone else's challenge.
    assert (
        _consume_step_up_challenge(
            session, user_id=other_user_id, approval_id=approval_id, token=token
        )
        is False
    )
    # Wrong token doesn't match.
    assert (
        _consume_step_up_challenge(
            session, user_id=owner_user_id, approval_id=approval_id, token="not-the-token"
        )
        is False
    )
    # Correct owner + token consumes it exactly once.
    assert (
        _consume_step_up_challenge(
            session, user_id=owner_user_id, approval_id=approval_id, token=token
        )
        is True
    )
    # A second attempt with the same (now-used) token fails.
    assert (
        _consume_step_up_challenge(
            session, user_id=owner_user_id, approval_id=approval_id, token=token
        )
        is False
    )


def test_decide_approval_uses_utc_correct_expiry_guard(session, monkeypatch):
    """Regression for the timezone-skew bug: _decide_approval's guard must
    compare against a UTC-anchored "now", not a bare CURRENT_TIMESTAMP that a
    non-UTC Postgres session TimeZone would skew against the naive
    ``expires_at`` column. Simulate the Postgres branch (_is_postgres() ->
    True) against the sqlite test engine: sqlite doesn't understand
    ``now() at time zone 'utc'``, so if approvals.py ever regressed to using
    that expression unconditionally (or _is_postgres() mis-detected), this
    would raise instead of silently succeeding -- proving the dialect switch
    is actually exercised for the Postgres branch and produces a
    UTC-anchored comparison, not a session-local one.
    """
    import bot.handlers.approvals as approvals_mod

    approval_id = _insert_pending(session, expires_in_min=15)
    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)

    # Force the Postgres SQL branch and confirm it's genuinely
    # `(now() at time zone 'utc')`, not CURRENT_TIMESTAMP.
    monkeypatch.setattr(approvals_mod, "_is_postgres", lambda: True)
    assert approvals_mod._now_utc_sql() == "(now() at time zone 'utc')"

    # And confirm the sqlite (non-Postgres) path used by these tests really
    # is CURRENT_TIMESTAMP.
    monkeypatch.setattr(approvals_mod, "_is_postgres", lambda: False)
    assert approvals_mod._now_utc_sql() == "CURRENT_TIMESTAMP"

    decided_now, row = _decide_approval(
        session, approval_id=approval_id, caller_user_id=owner_user_id, new_status="approved"
    )
    assert decided_now is True
    assert row[0] == "approved"


def test_step_up_challenge_expires(session):
    approval_id = _insert_pending(session)
    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)

    token = _issue_step_up_challenge(session, user_id=owner_user_id, approval_id=approval_id)
    # Force it into the past, simulating the 2-minute TTL having elapsed.
    session.execute(
        text("UPDATE approval_step_up_challenges SET expires_at = :past WHERE challenge = :c"),
        {"past": datetime.now(timezone.utc) - timedelta(seconds=1), "c": token},
    )
    session.commit()

    assert (
        _consume_step_up_challenge(
            session, user_id=owner_user_id, approval_id=approval_id, token=token
        )
        is False
    )


# --- full approval_decision_callback tests (sqlite shadow session) ---


def _make_callback_update(telegram_id: int, callback_data: str):
    query = MagicMock()
    query.data = callback_data
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()

    update = MagicMock()
    update.callback_query = query
    update.effective_user = MagicMock(id=telegram_id)
    context = MagicMock()
    return update, context


class _NoCloseSessionCtx:
    """Wraps an already-open test session as the ``with get_session() as s``
    context manager approvals.py expects, without closing the shared
    per-test sqlite session between the handler's internal ``with``
    blocks."""

    def __init__(self, session):
        self._session = session

    def __call__(self):
        return self

    def __enter__(self):
        return self._session

    def __exit__(self, *exc):
        return False


async def _noop_notify(*args, **kwargs):
    return None


@pytest.mark.asyncio
async def test_owner_taps_lapsed_unswept_row_gets_expired_reply(session, monkeypatch):
    """MEDIUM fix: an OWNER tapping a row that is still status='pending' in
    the DB but whose expires_at has already passed (the notifier's expiry
    sweep hasn't caught it yet) must get a clear "expired" reply instead of
    the confusing generic "already pending" fallback."""
    monkeypatch.setattr(approvals_module, "get_session", _NoCloseSessionCtx(session))
    monkeypatch.setattr(approvals_module, "notify_approval_decided", _noop_notify)

    approval_id = _insert_pending(session, expires_in_min=-1)

    update, context = _make_callback_update(OWNER_TG_ID, f"apprv:{approval_id}:yes")
    await approvals_module.approval_decision_callback(update, context)

    row = session.execute(
        text("SELECT status FROM approval_requests WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row[0] == "pending"  # untouched -- the expiry guard blocked the flip

    reply_text = update.callback_query.edit_message_text.call_args[0][0]
    assert "expired" in reply_text.lower()
    assert "already" not in reply_text.lower()


@pytest.mark.asyncio
async def test_non_owner_learns_nothing_about_a_decided_row(session, monkeypatch):
    """MEDIUM info-leak fix: the ownership check must fire BEFORE the status
    branches, so a non-owner tapping an already-decided row learns nothing --
    not the agent name, not who decided it."""
    monkeypatch.setattr(approvals_module, "get_session", _NoCloseSessionCtx(session))
    monkeypatch.setattr(approvals_module, "notify_approval_decided", _noop_notify)

    approval_id = _insert_pending(session, owner_telegram_id=OWNER_TG_ID, agent_id="agent-secret")
    owner_user_id = _resolve_user_id(session, OWNER_TG_ID)
    session.execute(
        text("UPDATE approval_requests SET status = 'approved', decided_by = :d WHERE id = :id"),
        {"d": owner_user_id, "id": approval_id},
    )
    session.commit()

    update, context = _make_callback_update(OTHER_TG_ID, f"apprv:{approval_id}:yes")
    await approvals_module.approval_decision_callback(update, context)

    reply_text = update.callback_query.edit_message_text.call_args[0][0]
    assert reply_text == "This approval belongs to another user."
    assert "agent-secret" not in reply_text
    assert str(owner_user_id) not in reply_text
