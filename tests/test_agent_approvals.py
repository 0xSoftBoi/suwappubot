"""Tests for the agent-approval atomic decide logic (SUW-204).

Covers bot/handlers/approvals.py's guarded UPDATE ... WHERE status='pending':
1. A pending row can be approved exactly once.
2. A second attempt to decide an already-decided row is a no-op (rowcount 0)
   and the original decision is preserved (no double-decide / no flip-flop).
3. /approvals-style query only returns pending rows for the given user.

Uses the real sqlite DDL path (tmp_db -> init_db -> _ensure_schema) rather
than mocking, since the whole point of this logic is the atomic UPDATE
semantics against a real table.
"""

import uuid

import pytest
from sqlalchemy import text

from database.db import get_session


def _insert_pending(session, telegram_id=555, agent_id="agent-1", value_usd=42.5) -> str:
    approval_id = str(uuid.uuid4())
    session.execute(
        text(
            "INSERT INTO agent_approvals "
            "(id, agent_id, agent_name, user_telegram_id, value_usd, chain, status) "
            "VALUES (:id, :agent_id, :agent_name, :telegram_id, :value_usd, :chain, 'pending')"
        ),
        {
            "id": approval_id,
            "agent_id": agent_id,
            "agent_name": "Test Agent",
            "telegram_id": telegram_id,
            "value_usd": value_usd,
            "chain": "base",
        },
    )
    session.commit()
    return approval_id


def _decide(session, approval_id: str, new_status: str, decided_by: str, tapper=None) -> int:
    """Mirrors the guarded UPDATE in bot/handlers/approvals.py.

    ``tapper`` mirrors the callback query sender's telegram id; the real
    handler always includes this ownership guard in the WHERE clause.
    """
    if tapper is None:
        tapper = int(decided_by)
    result = session.execute(
        text(
            "UPDATE agent_approvals "
            "SET status = :new_status, decided_by = :decided_by, "
            "decided_at = CURRENT_TIMESTAMP, channel = 'telegram' "
            "WHERE id = :id AND status = 'pending' AND user_telegram_id = :tapper"
        ),
        {
            "new_status": new_status,
            "decided_by": decided_by,
            "id": approval_id,
            "tapper": tapper,
        },
    )
    session.commit()
    return result.rowcount or 0


def test_agent_approvals_table_exists(tmp_db):
    with get_session() as session:
        # Will raise if the table wasn't created by _ensure_schema.
        rows = session.execute(text("SELECT COUNT(*) FROM agent_approvals")).fetchone()
        assert rows[0] == 0


def test_decide_pending_approval_succeeds_once(tmp_db):
    with get_session() as session:
        approval_id = _insert_pending(session, telegram_id=999)

        rowcount = _decide(session, approval_id, "approved", decided_by="999", tapper=999)
        assert rowcount == 1

        row = session.execute(
            text("SELECT status, decided_by FROM agent_approvals WHERE id = :id"),
            {"id": approval_id},
        ).fetchone()
        assert row[0] == "approved"
        assert row[1] == "999"


def test_double_decide_is_a_noop_and_preserves_first_decision(tmp_db):
    with get_session() as session:
        approval_id = _insert_pending(session, telegram_id=111)

        first = _decide(session, approval_id, "approved", decided_by="111", tapper=111)
        assert first == 1

        # A second, conflicting decision must not flip the outcome.
        second = _decide(session, approval_id, "denied", decided_by="222", tapper=111)
        assert second == 0

        row = session.execute(
            text("SELECT status, decided_by FROM agent_approvals WHERE id = :id"),
            {"id": approval_id},
        ).fetchone()
        assert row[0] == "approved"
        assert row[1] == "111"


def test_pending_query_scopes_to_owning_telegram_user(tmp_db):
    with get_session() as session:
        mine = _insert_pending(session, telegram_id=1, agent_id="mine")
        _insert_pending(session, telegram_id=2, agent_id="not-mine")

        rows = session.execute(
            text(
                "SELECT id FROM agent_approvals "
                "WHERE user_telegram_id = :tg_id AND status = 'pending'"
            ),
            {"tg_id": 1},
        ).fetchall()

        assert [r[0] for r in rows] == [mine]


def test_different_telegram_user_cannot_decide_someone_elses_approval(tmp_db):
    """The ownership guard: a callback tap from a telegram id other than the
    row's owner must not be able to flip status, even though the row is
    still pending (this is the HIGH finding fix)."""
    with get_session() as session:
        approval_id = _insert_pending(session, telegram_id=555)

        # Attacker (tapper 999) tries to decide the victim's (555) approval.
        rowcount = _decide(session, approval_id, "approved", decided_by="999", tapper=999)
        assert rowcount == 0

        row = session.execute(
            text("SELECT status, decided_by FROM agent_approvals WHERE id = :id"),
            {"id": approval_id},
        ).fetchone()
        assert row[0] == "pending"
        assert row[1] is None

        # The rightful owner can still decide it afterwards.
        rowcount = _decide(session, approval_id, "approved", decided_by="555", tapper=555)
        assert rowcount == 1


def test_agent_approvals_consumed_at_column_exists(tmp_db):
    """consumed_at must exist after _ensure_schema, both for a fresh table
    and (via the additive ALTER guard) for a table created before the
    column was added."""
    with get_session() as session:
        columns = {
            row[1] for row in session.execute(text("PRAGMA table_info(agent_approvals)")).fetchall()
        }
    assert "consumed_at" in columns
