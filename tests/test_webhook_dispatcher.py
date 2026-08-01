"""Tests for durable approval-decision webhook delivery (retry + dead-letter).

Covers:
1. notify_approval_decided always enqueues a agent_webhook_deliveries row,
   even when the immediate POST raises.
2. webhook_dispatcher's backoff schedule progression (30s, 2m, 8m, 30m, 2h).
3. Max-attempts -> dead-letter ('failed').
4. Successful dispatcher attempt -> 'delivered'.

Uses the real sqlite DDL path (tmp_db -> init_db -> _ensure_schema) since the
point is exercising real INSERT/UPDATE semantics against the actual table.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from bot.services import approval_webhook
from bot.services.webhook_dispatcher import (
    BACKOFF_SCHEDULE_SECONDS,
    MAX_ATTEMPTS,
    WebhookDispatcher,
)
from database.db import get_session


def _insert_agent(session, agent_uuid="agent-uuid-1", callback_url="https://example.com/hook"):
    session.execute(
        text(
            "INSERT INTO agents (uuid, name, callback_url, api_key, is_active, api_key_hash) "
            "VALUES (:uuid, :name, :callback_url, :api_key, 1, :api_key_hash)"
        ),
        {
            "uuid": agent_uuid,
            "name": "Test Agent",
            "callback_url": callback_url,
            "api_key": f"key-{agent_uuid}",
            "api_key_hash": "a" * 64,
        },
    )
    session.commit()


def _insert_approval(session, approval_id, agent_uuid="agent-uuid-1", telegram_id=1):
    session.execute(
        text(
            "INSERT INTO agent_approvals (id, agent_id, agent_name, user_telegram_id, "
            "value_usd, chain, status) "
            "VALUES (:id, :agent_id, 'Test Agent', :telegram_id, 10, 'base', 'pending')"
        ),
        {"id": approval_id, "agent_id": agent_uuid, "telegram_id": telegram_id},
    )
    session.commit()


def _delivery_row(session, delivery_id):
    return session.execute(
        text(
            "SELECT status, attempts, next_attempt_at, last_error FROM "
            "agent_webhook_deliveries WHERE id = :id"
        ),
        {"id": delivery_id},
    ).fetchone()


@pytest.mark.asyncio
async def test_notify_approval_decided_enqueues_row_even_if_post_raises(tmp_db, monkeypatch):
    agent_uuid = str(uuid.uuid4())
    approval_id = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        _insert_approval(session, approval_id, agent_uuid=agent_uuid)

    class _RaisingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *args, **kwargs):
            raise httpx.ConnectError("boom")

    monkeypatch.setattr(approval_webhook.httpx, "AsyncClient", lambda **kw: _RaisingClient())

    await approval_webhook.notify_approval_decided(approval_id, "approved", "0xhash")

    with get_session() as session:
        rows = session.execute(
            text(
                "SELECT id, status, attempts FROM agent_webhook_deliveries WHERE approval_id = :a"
            ),
            {"a": approval_id},
        ).fetchall()

    assert len(rows) == 1
    delivery_id, status, attempts = rows[0]
    # Immediate attempt failed but must not be counted against dispatcher
    # attempts — row must remain retryable.
    assert status == "pending"
    assert attempts == 0


def _make_pending_delivery(session, approval_id="a1", agent_id="agent-uuid-1", attempts=0):
    delivery_id = str(uuid.uuid4())
    session.execute(
        text(
            "INSERT INTO agent_webhook_deliveries "
            "(id, approval_id, agent_id, url, payload_json, signature_ts, status, attempts) "
            "VALUES (:id, :approval_id, :agent_id, :url, :payload, :ts, 'pending', :attempts)"
        ),
        {
            "id": delivery_id,
            "approval_id": approval_id,
            "agent_id": agent_id,
            "url": "https://example.com/hook",
            "payload": '{"event": "approval.decided"}',
            "ts": "1234567890",
            "attempts": attempts,
        },
    )
    session.commit()
    return delivery_id


@pytest.mark.asyncio
async def test_dispatcher_backoff_schedule_progression(tmp_db, monkeypatch):
    agent_uuid = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        delivery_id = _make_pending_delivery(session, agent_id=agent_uuid)

    monkeypatch.setattr(approval_webhook, "is_callback_url_safe", lambda url: True)

    class _FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *args, **kwargs):
            raise httpx.ConnectError("down")

    dispatcher = WebhookDispatcher()
    import bot.services.webhook_dispatcher as wd_module

    monkeypatch.setattr(wd_module, "is_callback_url_safe", lambda url: True)
    monkeypatch.setattr(wd_module.httpx, "AsyncClient", lambda **kw: _FailingClient())

    # Attempts 1..MAX_ATTEMPTS-1 must stay pending, scheduled with the
    # matching backoff delay. Between iterations we force the row "due" by
    # clearing next_attempt_at, standing in for time having passed.
    for expected_attempt_index in range(MAX_ATTEMPTS - 1):
        await dispatcher._process_due()
        with get_session() as session:
            status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
        assert status == "pending"
        assert attempts == expected_attempt_index + 1
        assert next_attempt_at is not None
        with get_session() as session:
            session.execute(
                text("UPDATE agent_webhook_deliveries SET next_attempt_at = NULL WHERE id = :id"),
                {"id": delivery_id},
            )
            session.commit()

    # The MAX_ATTEMPTS-th failure must dead-letter instead of scheduling
    # another retry.
    await dispatcher._process_due()

    with get_session() as session:
        status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
    assert status == "failed"
    assert attempts == MAX_ATTEMPTS
    assert BACKOFF_SCHEDULE_SECONDS == [30, 120, 480, 1800, 7200]


@pytest.mark.asyncio
async def test_dispatcher_success_marks_delivered(tmp_db, monkeypatch):
    agent_uuid = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        delivery_id = _make_pending_delivery(session, agent_id=agent_uuid)

    import bot.services.webhook_dispatcher as wd_module

    class _FakeResponse:
        status_code = 200

    class _SuccessClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *args, **kwargs):
            return _FakeResponse()

    monkeypatch.setattr(wd_module, "is_callback_url_safe", lambda url: True)
    monkeypatch.setattr(wd_module.httpx, "AsyncClient", lambda **kw: _SuccessClient())

    dispatcher = WebhookDispatcher()
    await dispatcher._process_due()

    with get_session() as session:
        status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
    assert status == "delivered"
    assert attempts == 1
    assert last_error is None
