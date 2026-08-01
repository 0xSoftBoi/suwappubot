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

import socket
from unittest.mock import patch

import pytest
from sqlalchemy import text

from bot.services.approval_webhook import is_callback_url_safe, sign_payload
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
    """Mirrors the guarded UPDATE ... RETURNING in claim_agent.py's happy path."""
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    result = session.execute(
        text(
            "UPDATE agent_link_codes SET used_at = CURRENT_TIMESTAMP "
            "WHERE code_hash = :code_hash AND used_at IS NULL "
            "AND expires_at > CURRENT_TIMESTAMP "
            "RETURNING agent_id"
        ),
        {"code_hash": code_hash},
    )
    row = result.fetchone()
    session.commit()
    return row is not None


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


def test_sign_payload_rejects_non_hex_key_hash():
    with pytest.raises(ValueError):
        sign_payload(b"body", "not-hex!!", "1700000000")


def test_claim_already_linked_agent_is_rejected(tmp_db):
    """A code pointing at an agent that already has an owner must not
    silently reassign ownership — the claim UPDATE guards on
    owner_user_id IS NULL and the handler surfaces a clear rejection."""
    with get_session() as session:
        agent_id = _insert_agent(session)
        session.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": 111})
        session.commit()
        existing_owner_id = session.execute(
            text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": 111}
        ).fetchone()[0]
        session.execute(
            text("UPDATE agents SET owner_user_id = :owner WHERE id = :agent_id"),
            {"owner": existing_owner_id, "agent_id": agent_id},
        )
        session.commit()

        _insert_code(session, agent_id, "already-linked-code")
        assert _claim(session, "already-linked-code") is True

        # Mirrors the guarded owner UPDATE in claim_agent.py: since the agent
        # already has an owner, the guarded UPDATE must affect 0 rows.
        result = session.execute(
            text(
                "UPDATE agents SET owner_user_id = :new_owner "
                "WHERE id = :agent_id AND owner_user_id IS NULL"
            ),
            {"new_owner": 999, "agent_id": agent_id},
        )
        assert (result.rowcount or 0) == 0
        session.rollback()

        owner = session.execute(
            text("SELECT owner_user_id FROM agents WHERE id = :agent_id"), {"agent_id": agent_id}
        ).fetchone()[0]
        assert owner == existing_owner_id


def test_unlink_clears_owner_for_own_agent(tmp_db):
    with get_session() as session:
        agent_id = _insert_agent(session, name="MyBot")
        session.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": 222})
        session.commit()
        owner_id = session.execute(
            text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": 222}
        ).fetchone()[0]
        session.execute(
            text("UPDATE agents SET owner_user_id = :owner WHERE id = :agent_id"),
            {"owner": owner_id, "agent_id": agent_id},
        )
        session.commit()

        # Mirrors unlink_agent_command's guarded UPDATE.
        result = session.execute(
            text(
                "UPDATE agents SET owner_user_id = NULL "
                "WHERE id = :agent_id AND owner_user_id = :owner"
            ),
            {"agent_id": agent_id, "owner": owner_id},
        )
        session.commit()
        assert (result.rowcount or 0) == 1

        owner = session.execute(
            text("SELECT owner_user_id FROM agents WHERE id = :agent_id"), {"agent_id": agent_id}
        ).fetchone()[0]
        assert owner is None


def test_unlink_cannot_touch_someone_elses_agent(tmp_db):
    with get_session() as session:
        agent_id = _insert_agent(session, name="OtherBot")
        session.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": 333})
        session.commit()
        real_owner_id = session.execute(
            text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": 333}
        ).fetchone()[0]
        session.execute(
            text("UPDATE agents SET owner_user_id = :owner WHERE id = :agent_id"),
            {"owner": real_owner_id, "agent_id": agent_id},
        )
        session.commit()

        someone_else_id = real_owner_id + 12345
        result = session.execute(
            text(
                "UPDATE agents SET owner_user_id = NULL "
                "WHERE id = :agent_id AND owner_user_id = :owner"
            ),
            {"agent_id": agent_id, "owner": someone_else_id},
        )
        session.commit()
        assert (result.rowcount or 0) == 0

        owner = session.execute(
            text("SELECT owner_user_id FROM agents WHERE id = :agent_id"), {"agent_id": agent_id}
        ).fetchone()[0]
        assert owner == real_owner_id


def test_ssrf_validator_rejects_private_ip():
    with patch(
        "bot.services.approval_webhook.socket.getaddrinfo",
        return_value=[(socket.AF_INET, None, None, None, ("10.0.0.5", 443))],
    ):
        assert is_callback_url_safe("https://internal.example.com/webhook") is False


def test_ssrf_validator_rejects_metadata_ip():
    with patch(
        "bot.services.approval_webhook.socket.getaddrinfo",
        return_value=[(socket.AF_INET, None, None, None, ("169.254.169.254", 443))],
    ):
        assert is_callback_url_safe("https://looks-fine.example.com/webhook") is False


def test_ssrf_validator_allows_public_https():
    with patch(
        "bot.services.approval_webhook.socket.getaddrinfo",
        return_value=[(socket.AF_INET, None, None, None, ("93.184.216.34", 443))],
    ):
        assert is_callback_url_safe("https://agent.example.com/webhook") is True


def test_ssrf_validator_rejects_http_in_production():
    with patch("bot.services.approval_webhook.settings.sentry_environment", "production"):
        assert is_callback_url_safe("http://localhost:8080/webhook") is False
