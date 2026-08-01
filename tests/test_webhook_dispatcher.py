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
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import text

from bot.services import approval_webhook
from bot.services.approval_notifier import ApprovalNotifier
from bot.services.webhook_dispatcher import (
    BACKOFF_SCHEDULE_SECONDS,
    MAX_ATTEMPTS,
    STALE_SENDING_RECLAIM_SECONDS,
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


@pytest.mark.asyncio
async def test_web_expired_approval_gets_expiry_webhook(tmp_db, monkeypatch):
    """api-ts's lazy web-path expiry (GET /webapp/approvals, POST /decide)
    flips a stale pending row straight to status='expired' without going
    through the bot's own _expire_stale sweep. _catch_web_expired must pick
    that row up (no delivery row exists yet for it) and enqueue the
    approval.expired webhook exactly once."""
    agent_uuid = str(uuid.uuid4())
    approval_id = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        # Simulate api-ts's web path: row is already 'expired', never passed
        # through this bot's _expire_stale.
        session.execute(
            text(
                "INSERT INTO agent_approvals "
                "(id, agent_id, agent_name, user_telegram_id, value_usd, chain, status) "
                "VALUES (:id, :agent_id, 'Test Agent', 1, 10, 'base', 'expired')"
            ),
            {"id": approval_id, "agent_id": agent_uuid},
        )
        session.commit()

    spawned = []

    def _fake_spawn(approval_id_arg, status, intent_hash):
        spawned.append((approval_id_arg, status))

    import bot.services.approval_notifier as notifier_module

    monkeypatch.setattr(notifier_module, "_spawn_webhook_task", _fake_spawn)

    notifier = ApprovalNotifier()
    await notifier._catch_web_expired()

    assert spawned == [(approval_id, "expired")]

    # Idempotency: simulate the webhook path having enqueued a delivery row
    # for this approval (what a real notify_approval_decided call would do)
    # and confirm a second sweep does NOT re-spawn.
    with get_session() as session:
        session.execute(
            text(
                "INSERT INTO agent_webhook_deliveries "
                "(id, approval_id, agent_id, url, payload_json, signature_ts, status, attempts) "
                "VALUES (:id, :approval_id, :agent_id, 'https://example.com/hook', "
                "'{}', '123', 'pending', 0)"
            ),
            {"id": str(uuid.uuid4()), "approval_id": approval_id, "agent_id": agent_uuid},
        )
        session.commit()

    spawned.clear()
    await notifier._catch_web_expired()
    assert spawned == []


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

    # Attempts 1..MAX_ATTEMPTS must stay pending, scheduled with the matching
    # backoff delay (all 5 entries in BACKOFF_SCHEDULE_SECONDS are used).
    # Between iterations we force the row "due" by clearing next_attempt_at
    # and resetting status back to 'pending' (the claim step flips it to
    # 'sending' mid-attempt), standing in for time having passed.
    for expected_attempt_index in range(MAX_ATTEMPTS):
        await dispatcher._process_due()
        with get_session() as session:
            status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
        assert status == "pending"
        assert attempts == expected_attempt_index + 1
        assert next_attempt_at is not None
        with get_session() as session:
            session.execute(
                text(
                    "UPDATE agent_webhook_deliveries SET next_attempt_at = NULL, "
                    "status = 'pending' WHERE id = :id"
                ),
                {"id": delivery_id},
            )
            session.commit()

    # The (MAX_ATTEMPTS + 1)-th failure must dead-letter instead of
    # scheduling another retry.
    await dispatcher._process_due()

    with get_session() as session:
        status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
    assert status == "failed"
    assert attempts == MAX_ATTEMPTS + 1
    assert BACKOFF_SCHEDULE_SECONDS == [30, 120, 480, 1800, 7200]


@pytest.mark.asyncio
async def test_dispatcher_poison_payload_backs_off_instead_of_wedging(tmp_db, monkeypatch):
    """A malformed payload_json must not raise out of _process_due — it must
    be treated as a failed attempt (backoff/dead-letter) so the row behind it
    in the queue keeps getting processed on every subsequent poll."""
    agent_uuid = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        delivery_id = str(uuid.uuid4())
        session.execute(
            text(
                "INSERT INTO agent_webhook_deliveries "
                "(id, approval_id, agent_id, url, payload_json, signature_ts, status, attempts) "
                "VALUES (:id, 'a1', :agent_id, :url, :payload, '123', 'pending', 0)"
            ),
            {
                "id": delivery_id,
                "agent_id": agent_uuid,
                "url": "https://example.com/hook",
                "payload": "{not valid json",
            },
        )
        session.commit()

    import bot.services.webhook_dispatcher as wd_module

    monkeypatch.setattr(wd_module, "is_callback_url_safe", lambda url: True)

    dispatcher = WebhookDispatcher()
    # Must not raise.
    await dispatcher._process_due()

    with get_session() as session:
        status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
    assert status == "pending"
    assert attempts == 1
    assert next_attempt_at is not None
    assert "bad payload" in (last_error or "")


@pytest.mark.asyncio
async def test_dispatcher_claim_prevents_double_delivery(tmp_db, monkeypatch):
    """Simulates a second poller racing the same due row: the loser of the
    claim must not also POST to the callback_url."""
    agent_uuid = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        delivery_id = _make_pending_delivery(session, agent_id=agent_uuid)

    import bot.services.webhook_dispatcher as wd_module

    post_calls = []

    class _FakeResponse:
        status_code = 200

    class _CountingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *args, **kwargs):
            post_calls.append(1)
            return _FakeResponse()

    monkeypatch.setattr(wd_module, "is_callback_url_safe", lambda url: True)
    monkeypatch.setattr(wd_module.httpx, "AsyncClient", lambda **kw: _CountingClient())

    dispatcher = WebhookDispatcher()
    # First claim succeeds.
    claimed = dispatcher._claim(delivery_id)
    assert claimed is not None
    # A second racing claim attempt on the same (now 'sending') row must lose.
    claimed_again = dispatcher._claim(delivery_id)
    assert claimed_again is None

    # Only the winner proceeds to attempt delivery.
    await dispatcher._attempt_one(
        delivery_id=claimed["id"],
        approval_id=claimed["approval_id"],
        agent_id=claimed["agent_id"],
        url=claimed["url"],
        payload_json=claimed["payload_json"],
        signature_ts=claimed["signature_ts"],
        attempts=claimed["attempts"] or 0,
    )
    assert len(post_calls) == 1

    with get_session() as session:
        status, attempts, next_attempt_at, last_error = _delivery_row(session, delivery_id)
    assert status == "delivered"
    assert attempts == 1


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


@pytest.mark.asyncio
async def test_callback_url_less_expired_approval_claimed_once_never_reselected(
    tmp_db, monkeypatch
):
    """A HIGH-severity money-path fix: an approval whose agent has no
    callback_url never gets a agent_webhook_deliveries row from
    notify_approval_decided, so the old NOT-EXISTS-on-deliveries idempotency
    guard would re-select (and re-notify) it every single cycle forever.
    expiry_notified_at is the new atomic ledger — it must be claimed exactly
    once regardless of whether a delivery row ever materializes."""
    agent_uuid = str(uuid.uuid4())
    approval_id = str(uuid.uuid4())
    with get_session() as session:
        # Agent has NO callback_url — mirrors the exact wedge scenario.
        _insert_agent(session, agent_uuid=agent_uuid, callback_url=None)
        session.execute(
            text(
                "INSERT INTO agent_approvals "
                "(id, agent_id, agent_name, user_telegram_id, value_usd, chain, status) "
                "VALUES (:id, :agent_id, 'Test Agent', 1, 10, 'base', 'expired')"
            ),
            {"id": approval_id, "agent_id": agent_uuid},
        )
        session.commit()

    spawned = []
    import bot.services.approval_notifier as notifier_module

    monkeypatch.setattr(
        notifier_module, "_spawn_webhook_task", lambda aid, status, ih: spawned.append(aid)
    )

    notifier = ApprovalNotifier()
    await notifier._catch_web_expired()
    await notifier._catch_web_expired()
    await notifier._catch_web_expired()

    # Claimed exactly once across three consecutive cycles — no wedge.
    assert spawned == [approval_id]

    with get_session() as session:
        row = session.execute(
            text("SELECT expiry_notified_at FROM agent_approvals WHERE id = :id"),
            {"id": approval_id},
        ).fetchone()
    assert row[0] is not None


@pytest.mark.asyncio
async def test_expire_stale_and_catch_web_expired_same_cycle_single_notification(
    tmp_db, monkeypatch
):
    """_expire_stale flips pending->expired (stamping expiry_notified_at in
    the same UPDATE) and _catch_web_expired runs immediately after in the
    same loop iteration (see ApprovalNotifier._loop). Before the fix, the
    fully-synchronous _catch_web_expired query would re-select the row
    _expire_stale just flipped (its fire-and-forget webhook task is only
    *scheduled*, not run, by that point) producing a second
    approval.expired webhook. The atomic expiry_notified_at claim must
    prevent that: exactly one notification total."""
    agent_uuid = str(uuid.uuid4())
    approval_id = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        session.execute(
            text(
                "INSERT INTO agent_approvals "
                "(id, agent_id, agent_name, user_telegram_id, value_usd, chain, status, "
                "expires_at) "
                "VALUES (:id, :agent_id, 'Test Agent', 1, 10, 'base', 'pending', "
                "datetime('now', '-1 minute'))"
            ),
            {"id": approval_id, "agent_id": agent_uuid},
        )
        session.commit()

    spawned = []
    import bot.services.approval_notifier as notifier_module

    monkeypatch.setattr(
        notifier_module, "_spawn_webhook_task", lambda aid, status, ih: spawned.append(aid)
    )

    notifier = ApprovalNotifier()
    # Mirrors _loop's ordering within a single cycle.
    await notifier._expire_stale()
    await notifier._catch_web_expired()

    assert spawned == [approval_id]

    with get_session() as session:
        status, expiry_notified_at = session.execute(
            text("SELECT status, expiry_notified_at FROM agent_approvals WHERE id = :id"),
            {"id": approval_id},
        ).fetchone()
    assert status == "expired"
    assert expiry_notified_at is not None


@pytest.mark.asyncio
async def test_stranded_sending_row_reclaimed_and_delivered(tmp_db, monkeypatch):
    """A row stuck at status='sending' with a stale claimed_at (process died
    between _claim() and the terminal _mark()/_record_failure() call) must be
    reclaimed by the poll and actually delivered — not stranded forever."""
    agent_uuid = str(uuid.uuid4())
    with get_session() as session:
        _insert_agent(session, agent_uuid=agent_uuid)
        delivery_id = str(uuid.uuid4())
        stale_claimed_at = datetime.now(timezone.utc) - timedelta(
            seconds=STALE_SENDING_RECLAIM_SECONDS + 60
        )
        session.execute(
            text(
                "INSERT INTO agent_webhook_deliveries "
                "(id, approval_id, agent_id, url, payload_json, signature_ts, status, "
                "attempts, claimed_at) "
                "VALUES (:id, 'a1', :agent_id, :url, :payload, '123', 'sending', 0, :claimed_at)"
            ),
            {
                "id": delivery_id,
                "agent_id": agent_uuid,
                "url": "https://example.com/hook",
                "payload": '{"event": "approval.decided"}',
                "claimed_at": stale_claimed_at.strftime("%Y-%m-%d %H:%M:%S"),
            },
        )
        session.commit()

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
