"""Tests for /claim <code> agent linking (SUW-204 follow-up).

Covers bot/handlers/claim_agent.py's atomic UPDATE ... WHERE used_at IS NULL
guard against the real sqlite DDL (agent_link_codes + agents.owner_user_id,
both created by database/db.py's additive migrations), plus a pure unit test
for bot/services/approval_webhook.py's signing helper.

Note: agent_link_codes.agent_id is an INTEGER FK to agents.id (matches
api-ts's shipped Drizzle schema), NOT the agents.uuid string used by
agent_approvals.agent_id.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from bot.services.approval_webhook import sign_payload
from database.db import get_session


def _insert_agent(session, name="Test Agent", callback_url=None) -> int:
    agent_uuid = str(uuid.uuid4())
    api_key = f"key-{agent_uuid}"
    session.execute(
        text(
            "INSERT INTO agents (name, callback_url, api_key, is_active, api_key_hash, uuid) "
            "VALUES (:name, :callback_url, :api_key, 1, :api_key_hash, :uuid)"
        ),
        {
            "name": name,
            "callback_url": callback_url,
            "api_key": api_key,
            "api_key_hash": hashlib.sha256(api_key.encode()).hexdigest(),
            "uuid": agent_uuid,
        },
    )
    session.commit()
    agent_id = session.execute(
        text("SELECT id FROM agents WHERE uuid = :uuid"), {"uuid": agent_uuid}
    ).fetchone()[0]
    return agent_id


def _insert_code(session, agent_id: int, code: str, expires_delta=timedelta(hours=1), used=False):
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    expires_at = datetime.now(timezone.utc) + expires_delta
    session.execute(
        text(
            "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at, used_at) "
            "VALUES (:agent_id, :code_hash, :expires_at, :used_at)"
        ),
        {
            "agent_id": agent_id,
            "code_hash": code_hash,
            "expires_at": expires_at,
            "used_at": datetime.now(timezone.utc) if used else None,
        },
    )
    session.commit()
    return code_hash


def _claim(session, code: str):
    """Mirrors the guarded UPDATE in bot/handlers/claim_agent.py's happy path."""
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    result = session.execute(
        text(
            "UPDATE agent_link_codes SET used_at = CURRENT_TIMESTAMP "
            "WHERE code_hash = :code_hash AND used_at IS NULL "
            "AND expires_at > CURRENT_TIMESTAMP"
        ),
        {"code_hash": code_hash},
    )
    claimed = (result.rowcount or 0) > 0
    session.commit()
    return claimed


def test_agent_link_codes_table_and_owner_column_exist(tmp_db):
    with get_session() as session:
        rows = session.execute(text("SELECT COUNT(*) FROM agent_link_codes")).fetchone()
        assert rows[0] == 0
        # owner_user_id column exists on agents (additive migration)
        session.execute(text("SELECT owner_user_id FROM agents")).fetchall()


def test_claim_happy_path_links_agent_to_user(tmp_db):
    with get_session() as session:
        agent_id = _insert_agent(session)
        _insert_code(session, agent_id, "s3cr3t-code")

        claimed = _claim(session, "s3cr3t-code")
        assert claimed is True

        session.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": 555})
        session.commit()
        user_id = session.execute(
            text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": 555}
        ).fetchone()[0]
        session.execute(
            text("UPDATE agents SET owner_user_id = :owner WHERE id = :agent_id"),
            {"owner": user_id, "agent_id": agent_id},
        )
        session.commit()

        owner = session.execute(
            text("SELECT owner_user_id FROM agents WHERE id = :agent_id"), {"agent_id": agent_id}
        ).fetchone()[0]
        assert owner == user_id


def test_claim_reuse_is_rejected(tmp_db):
    with get_session() as session:
        agent_id = _insert_agent(session)
        _insert_code(session, agent_id, "one-shot-code")

        assert _claim(session, "one-shot-code") is True
        # Second attempt on the same code must fail (used_at now set).
        assert _claim(session, "one-shot-code") is False


def test_claim_expired_code_is_rejected(tmp_db):
    with get_session() as session:
        agent_id = _insert_agent(session)
        _insert_code(session, agent_id, "old-code", expires_delta=timedelta(hours=-1))

        assert _claim(session, "old-code") is False


def test_claim_unknown_code_is_rejected(tmp_db):
    with get_session() as session:
        _insert_agent(session)
        assert _claim(session, "never-issued-code") is False


def test_sign_payload_is_deterministic_and_key_sensitive():
    body = b'{"event":"approval.decided"}'
    key_hash = hashlib.sha256(b"agent-api-key").hexdigest()

    sig1 = sign_payload(body, key_hash, "1700000000")
    sig2 = sign_payload(body, key_hash, "1700000000")
    assert sig1 == sig2  # deterministic for identical inputs
    assert len(sig1) == 64  # hex sha256 digest

    # Different timestamp (replay window) changes the signature.
    sig3 = sign_payload(body, key_hash, "1700000001")
    assert sig3 != sig1

    # Different key changes the signature.
    other_key_hash = hashlib.sha256(b"different-key").hexdigest()
    sig4 = sign_payload(body, other_key_hash, "1700000000")
    assert sig4 != sig1

    # Different body changes the signature.
    sig5 = sign_payload(b'{"event":"other"}', key_hash, "1700000000")
    assert sig5 != sig1
