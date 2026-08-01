"""Real-Postgres integration tests for the agent control plane (SUW-204).

Runs the ACTUAL bot functions (never re-implements their SQL) against a
scratch Postgres database whose api-ts-owned tables (agents, users,
agent_link_codes, policy_kill_switches) are pre-created with the real
Drizzle column types. See tests/integration/conftest.py for why this
matters and exactly what it reproduces.

Covers, and the historical/would-be-caught bug for each:

- approval_webhook.notify_approval_decided's agents/agent_approvals JOIN
  -> the uuid(native) = text join that errors on every real Postgres call
     (sqlite's TEXT-only agents.uuid column hid this for months).
- admin_killswitch activate/list/deactivate (known + unknown admin)
  -> the 6 assertions test_admin_killswitch.py silently SKIPS on most
     sqlite builds because `now()` / `IS NOT DISTINCT FROM` aren't
     supported there.
- claim_agent / unlink_agent atomic UPDATE...RETURNING paths
  -> would catch any Postgres-only RETURNING/casting regression in the
     claim flow (sqlite's RETURNING support is version-dependent and
     already causes a silent fallback branch in the handler itself).
- approvals.approval_decision_callback's atomic decide + ownership guard
  -> exercises the real handler (not a hand-rolled UPDATE) against
     Postgres semantics for CURRENT_TIMESTAMP / boolean coercion.
- webhook_dispatcher backoff/dead-letter
  -> the Postgres-only `CURRENT_TIMESTAMP + (:delay || ' seconds')::interval`
     branch in webhook_dispatcher.py's `_record_failure`, which sqlite
     never touches (it takes the `datetime(...)` fallback branch instead)
     and so was never actually executed by the sqlite suite.
"""

import hashlib
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Shared seed helpers
# ---------------------------------------------------------------------------


def _insert_user(session, telegram_id: int) -> int:
    session.execute(
        text("INSERT INTO users (telegram_id) VALUES (:tg) ON CONFLICT DO NOTHING"),
        {"tg": telegram_id},
    )
    session.commit()
    return session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": telegram_id}
    ).fetchone()[0]


def _insert_agent(session, name=None, callback_url=None) -> tuple[int, str]:
    """Returns (agents.id, agents.uuid as str)."""
    name = name or f"agent-{uuid.uuid4().hex[:8]}"
    api_key = f"key-{uuid.uuid4().hex}"
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    row = session.execute(
        text(
            "INSERT INTO agents (name, callback_url, api_key, api_key_hash, is_active) "
            "VALUES (:name, :callback_url, :api_key, :api_key_hash, true) "
            "RETURNING id, uuid"
        ),
        {
            "name": name,
            "callback_url": callback_url,
            "api_key": api_key,
            "api_key_hash": api_key_hash,
        },
    ).fetchone()
    session.commit()
    return row[0], str(row[1])


def _insert_approval(session, agent_uuid: str, telegram_id: int, agent_name="Test Agent") -> str:
    approval_id = str(uuid.uuid4())
    session.execute(
        text(
            "INSERT INTO agent_approvals "
            "(id, agent_id, agent_name, user_telegram_id, value_usd, chain, status) "
            "VALUES (:id, :agent_id, :agent_name, :tg, 42.5, 'base', 'pending')"
        ),
        {"id": approval_id, "agent_id": agent_uuid, "agent_name": agent_name, "tg": telegram_id},
    )
    session.commit()
    return approval_id


def _insert_link_code(
    session, agent_id: int, code: str, expires_delta=timedelta(hours=1), used=False
):
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    session.execute(
        text(
            "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at, used_at) "
            "VALUES (:agent_id, :code_hash, now() + :delta, NULL)"
        ),
        {"agent_id": agent_id, "code_hash": code_hash, "delta": expires_delta},
    )
    session.commit()
    if used:
        session.execute(
            text("UPDATE agent_link_codes SET used_at = now() WHERE code_hash = :h"),
            {"h": code_hash},
        )
        session.commit()
    return code_hash


# ---------------------------------------------------------------------------
# 1. approval_webhook JOIN — the uuid(native) = text historical bug
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approval_webhook_join_returns_row_on_real_postgres(pg_session, monkeypatch):
    """This is THE regression test for the uuid-vs-text join bug: agents.uuid
    here is a REAL Postgres `uuid` column (see conftest DDL), and
    agent_approvals.agent_id is TEXT. Without the CAST(a.uuid AS TEXT) fix in
    approval_webhook.notify_approval_decided, Postgres raises
    `operator does not exist: uuid = text` and this call would silently no-op
    (caught by the broad except-and-log in the real function) instead of
    posting the webhook — so we assert the POST actually happens.
    """
    from bot.services import approval_webhook
    import socket

    agent_id, agent_uuid = _insert_agent(
        pg_session, callback_url="https://agent.example.com/webhook"
    )
    approval_id = _insert_approval(pg_session, agent_uuid, telegram_id=555)

    monkeypatch.setattr(
        approval_webhook.socket,
        "getaddrinfo",
        lambda *a, **kw: [(socket.AF_INET, None, None, None, ("93.184.216.34", 443))],
    )

    posted = {}

    class _CapturingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, content=None, headers=None, **kw):
            posted["url"] = url
            posted["content"] = content
            posted["headers"] = headers
            return SimpleNamespace(status_code=200)

    monkeypatch.setattr(approval_webhook.httpx, "AsyncClient", lambda **kw: _CapturingClient())

    await approval_webhook.notify_approval_decided(approval_id, "approved", "0xhash")

    assert posted.get("url") == "https://agent.example.com/webhook", (
        "the agents/agent_approvals JOIN returned no row on Postgres — this is "
        "exactly the uuid=text bug (CAST missing or reverted)"
    )

    row = pg_session.execute(
        text("SELECT status FROM agent_webhook_deliveries WHERE approval_id = :a"),
        {"a": approval_id},
    ).fetchone()
    assert row is not None and row[0] == "delivered"


@pytest.mark.asyncio
async def test_approval_webhook_join_no_callback_url_skips_silently(pg_session, monkeypatch):
    """Sanity counterpart: when callback_url is NULL the join still succeeds
    (proving the join itself works), but no POST is attempted."""
    from bot.services import approval_webhook

    _, agent_uuid = _insert_agent(pg_session, callback_url=None)
    approval_id = _insert_approval(pg_session, agent_uuid, telegram_id=1)

    called = False

    class _ShouldNotBeCalledClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            nonlocal called
            called = True
            return SimpleNamespace(status_code=200)

    monkeypatch.setattr(
        approval_webhook.httpx, "AsyncClient", lambda **kw: _ShouldNotBeCalledClient()
    )

    await approval_webhook.notify_approval_decided(approval_id, "approved", "0xhash")
    assert called is False


# ---------------------------------------------------------------------------
# 2. admin_killswitch — the 6 sqlite-skipped assertions, for real
# ---------------------------------------------------------------------------


ADMIN_TG_ID = 700111
UNKNOWN_TG_ID = 700999


def test_killswitch_activate_and_list_global_known_admin(pg_session):
    from bot.handlers.admin_killswitch import activate_kill_switch, list_active_kill_switches

    _insert_user(pg_session, ADMIN_TG_ID)

    activate_kill_switch(
        pg_session, scope="global", scope_id=None, reason="incident", admin_telegram_id=ADMIN_TG_ID
    )
    switches = list_active_kill_switches(pg_session)
    assert len(switches) == 1
    assert switches[0]["scope"] == "global"
    assert switches[0]["reason"] == "incident"

    row = pg_session.execute(
        text("SELECT activated_by FROM policy_kill_switches WHERE scope = 'global'")
    ).fetchone()
    expected_user_id = pg_session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": ADMIN_TG_ID}
    ).fetchone()[0]
    assert row[0] == expected_user_id


def test_killswitch_activate_unknown_admin_sets_null_and_tags_reason(pg_session):
    from bot.handlers.admin_killswitch import activate_kill_switch

    activate_kill_switch(
        pg_session,
        scope="global",
        scope_id=None,
        reason="incident",
        admin_telegram_id=UNKNOWN_TG_ID,
    )
    row = pg_session.execute(
        text("SELECT activated_by, reason FROM policy_kill_switches WHERE scope = 'global'")
    ).fetchone()
    assert row[0] is None
    assert row[1] == f"incident [tg:{UNKNOWN_TG_ID}]"


def test_killswitch_activate_agent_scope_list_and_deactivate(pg_session):
    from bot.handlers.admin_killswitch import (
        activate_kill_switch,
        deactivate_kill_switch,
        list_active_kill_switches,
    )

    _insert_user(pg_session, ADMIN_TG_ID)
    activate_kill_switch(
        pg_session,
        scope="agent",
        scope_id="agent-123",
        reason="bad behavior",
        admin_telegram_id=ADMIN_TG_ID,
    )
    switches = list_active_kill_switches(pg_session)
    assert any(s["scope"] == "agent" and s["scope_id"] == "agent-123" for s in switches)

    changed = deactivate_kill_switch(pg_session, scope="agent", scope_id="agent-123")
    assert changed is True
    switches = list_active_kill_switches(pg_session)
    assert not any(s["scope"] == "agent" and s["scope_id"] == "agent-123" for s in switches)


def test_killswitch_deactivate_nonexistent_returns_false(pg_session):
    from bot.handlers.admin_killswitch import deactivate_kill_switch

    changed = deactivate_kill_switch(pg_session, scope="org", scope_id="no-such-org")
    assert changed is False


def test_killswitch_activate_is_idempotent_upsert(pg_session):
    from bot.handlers.admin_killswitch import activate_kill_switch, list_active_kill_switches

    _insert_user(pg_session, ADMIN_TG_ID)
    activate_kill_switch(
        pg_session, scope="global", scope_id=None, reason="first", admin_telegram_id=ADMIN_TG_ID
    )
    activate_kill_switch(
        pg_session, scope="global", scope_id=None, reason="second", admin_telegram_id=ADMIN_TG_ID
    )
    switches = list_active_kill_switches(pg_session)
    assert len(switches) == 1
    assert switches[0]["reason"] == "second"


def test_killswitch_org_scope_isolated_from_global(pg_session):
    """IS NOT DISTINCT FROM correctness: a NULL-scope_id global switch and a
    scoped org switch must not collide/overwrite each other."""
    from bot.handlers.admin_killswitch import activate_kill_switch, list_active_kill_switches

    _insert_user(pg_session, ADMIN_TG_ID)
    activate_kill_switch(
        pg_session, scope="global", scope_id=None, reason="g", admin_telegram_id=ADMIN_TG_ID
    )
    activate_kill_switch(
        pg_session, scope="org", scope_id="org-1", reason="o", admin_telegram_id=ADMIN_TG_ID
    )
    switches = list_active_kill_switches(pg_session)
    assert len(switches) == 2


# ---------------------------------------------------------------------------
# 3. claim_agent.py — real handler, real Update/context mocks
# ---------------------------------------------------------------------------


def _fake_update_message():
    update = MagicMock()
    update.effective_user = SimpleNamespace(id=None)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    return update


def _fake_context(args):
    return SimpleNamespace(args=args)


@pytest.mark.asyncio
async def test_claim_happy_path_links_agent_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import claim_agent

    monkeypatch.setattr(claim_agent._claim_limiter, "check", AsyncMock(return_value=None))

    agent_id, _ = _insert_agent(pg_session)
    code_hash = _insert_link_code(pg_session, agent_id, "s3cr3t-code")
    assert (
        pg_session.execute(
            text("SELECT used_at FROM agent_link_codes WHERE code_hash = :h"), {"h": code_hash}
        ).fetchone()[0]
        is None
    )

    telegram_id = 900555
    update = _fake_update_message()
    update.effective_user = SimpleNamespace(id=telegram_id)
    context = _fake_context(["s3cr3t-code"])

    await claim_agent.claim_agent_command(update, context)

    update.message.reply_text.assert_awaited_once()
    (msg,), _ = update.message.reply_text.call_args
    assert "linked to you" in msg

    owner = pg_session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :id"), {"id": agent_id}
    ).fetchone()[0]
    user_id = pg_session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": telegram_id}
    ).fetchone()[0]
    assert owner == user_id


@pytest.mark.asyncio
async def test_claim_reuse_is_rejected_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import claim_agent

    monkeypatch.setattr(claim_agent._claim_limiter, "check", AsyncMock(return_value=None))

    agent_id, _ = _insert_agent(pg_session)
    _insert_link_code(pg_session, agent_id, "one-shot-code")

    telegram_id = 900556
    update1 = _fake_update_message()
    update1.effective_user = SimpleNamespace(id=telegram_id)
    await claim_agent.claim_agent_command(update1, _fake_context(["one-shot-code"]))
    update1.message.reply_text.assert_awaited_once()
    assert "linked to you" in update1.message.reply_text.call_args[0][0]

    update2 = _fake_update_message()
    update2.effective_user = SimpleNamespace(id=telegram_id + 1)
    await claim_agent.claim_agent_command(update2, _fake_context(["one-shot-code"]))
    update2.message.reply_text.assert_awaited_once()
    assert "invalid, already used, or expired" in update2.message.reply_text.call_args[0][0]


@pytest.mark.asyncio
async def test_claim_expired_code_is_rejected_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import claim_agent

    monkeypatch.setattr(claim_agent._claim_limiter, "check", AsyncMock(return_value=None))

    agent_id, _ = _insert_agent(pg_session)
    _insert_link_code(pg_session, agent_id, "old-code", expires_delta=timedelta(hours=-1))

    update = _fake_update_message()
    update.effective_user = SimpleNamespace(id=900557)
    await claim_agent.claim_agent_command(update, _fake_context(["old-code"]))
    update.message.reply_text.assert_awaited_once()
    assert "invalid, already used, or expired" in update.message.reply_text.call_args[0][0]


@pytest.mark.asyncio
async def test_claim_already_linked_agent_is_rejected_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import claim_agent

    monkeypatch.setattr(claim_agent._claim_limiter, "check", AsyncMock(return_value=None))

    agent_id, _ = _insert_agent(pg_session)
    existing_owner_id = _insert_user(pg_session, 900558)
    pg_session.execute(
        text("UPDATE agents SET owner_user_id = :o WHERE id = :id"),
        {"o": existing_owner_id, "id": agent_id},
    )
    pg_session.commit()
    _insert_link_code(pg_session, agent_id, "already-linked-code")

    update = _fake_update_message()
    update.effective_user = SimpleNamespace(id=900559)
    await claim_agent.claim_agent_command(update, _fake_context(["already-linked-code"]))
    update.message.reply_text.assert_awaited_once()
    assert "already linked to an owner" in update.message.reply_text.call_args[0][0]

    owner = pg_session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :id"), {"id": agent_id}
    ).fetchone()[0]
    assert owner == existing_owner_id


@pytest.mark.asyncio
async def test_unlink_scoped_to_owner_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import claim_agent

    agent_id, _ = _insert_agent(pg_session, name="MyBot")
    owner_id = _insert_user(pg_session, 900560)
    other_id = _insert_user(pg_session, 900561)
    pg_session.execute(
        text("UPDATE agents SET owner_user_id = :o WHERE id = :id"),
        {"o": owner_id, "id": agent_id},
    )
    pg_session.commit()

    # A different Telegram user cannot unlink someone else's agent.
    other_update = _fake_update_message()
    other_update.effective_user = SimpleNamespace(id=900561)
    await claim_agent.unlink_agent_command(other_update, _fake_context(["MyBot"]))
    other_update.message.reply_text.assert_awaited_once()
    assert "Couldn't find" in other_update.message.reply_text.call_args[0][0]

    owner = pg_session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :id"), {"id": agent_id}
    ).fetchone()[0]
    assert owner == owner_id  # untouched

    # The real owner can unlink it.
    owner_update = _fake_update_message()
    owner_update.effective_user = SimpleNamespace(id=900560)
    await claim_agent.unlink_agent_command(owner_update, _fake_context(["MyBot"]))
    owner_update.message.reply_text.assert_awaited_once()
    assert "unlinked" in owner_update.message.reply_text.call_args[0][0]

    owner = pg_session.execute(
        text("SELECT owner_user_id FROM agents WHERE id = :id"), {"id": agent_id}
    ).fetchone()[0]
    assert owner is None


# ---------------------------------------------------------------------------
# 4. approvals.py decide logic — real handler
# ---------------------------------------------------------------------------


def _fake_callback_update(approval_id: str, decision: str, tapper_id: int):
    update = MagicMock()
    query = MagicMock()
    query.data = f"apprv:{approval_id}:{decision}"
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()
    update.callback_query = query
    update.effective_user = SimpleNamespace(id=tapper_id)
    return update, query


@pytest.mark.asyncio
async def test_approval_decide_atomic_single_decide_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import approvals

    monkeypatch.setattr(approvals, "_spawn_webhook_task", MagicMock())

    _, agent_uuid = _insert_agent(pg_session)
    approval_id = _insert_approval(pg_session, agent_uuid, telegram_id=800111)

    update, query = _fake_callback_update(approval_id, "yes", tapper_id=800111)
    await approvals.approval_decision_callback(update, SimpleNamespace())

    query.edit_message_text.assert_awaited_once()
    assert "Approved" in query.edit_message_text.call_args[0][0]

    row = pg_session.execute(
        text("SELECT status, decided_by FROM agent_approvals WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row[0] == "approved"
    assert row[1] == "800111"

    # A second tap (even from the rightful owner) must not flip / re-fire.
    update2, query2 = _fake_callback_update(approval_id, "no", tapper_id=800111)
    await approvals.approval_decision_callback(update2, SimpleNamespace())
    assert "Already approved" in query2.edit_message_text.call_args[0][0]

    row2 = pg_session.execute(
        text("SELECT status FROM agent_approvals WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row2[0] == "approved"


@pytest.mark.asyncio
async def test_approval_decide_non_owner_cannot_decide_via_real_handler(pg_session, monkeypatch):
    from bot.handlers import approvals

    monkeypatch.setattr(approvals, "_spawn_webhook_task", MagicMock())

    _, agent_uuid = _insert_agent(pg_session)
    approval_id = _insert_approval(pg_session, agent_uuid, telegram_id=800222)

    # Attacker/other Telegram user (not the approval's owner) taps the button.
    update, query = _fake_callback_update(approval_id, "yes", tapper_id=999888)
    await approvals.approval_decision_callback(update, SimpleNamespace())

    query.edit_message_text.assert_awaited_once()
    assert "belongs to another user" in query.edit_message_text.call_args[0][0]

    row = pg_session.execute(
        text("SELECT status, decided_by FROM agent_approvals WHERE id = :id"), {"id": approval_id}
    ).fetchone()
    assert row[0] == "pending"
    assert row[1] is None

    # The rightful owner can still decide it afterwards.
    update2, query2 = _fake_callback_update(approval_id, "yes", tapper_id=800222)
    await approvals.approval_decision_callback(update2, SimpleNamespace())
    assert "Approved" in query2.edit_message_text.call_args[0][0]


# ---------------------------------------------------------------------------
# 5. webhook_dispatcher — backoff / dead-letter against real Postgres
#    timestamptz semantics (the `::interval` branch sqlite never exercises)
# ---------------------------------------------------------------------------


def _make_pending_delivery(session, approval_id, agent_id, attempts=0):
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


def _delivery_row(session, delivery_id):
    return session.execute(
        text(
            "SELECT status, attempts, next_attempt_at, last_error "
            "FROM agent_webhook_deliveries WHERE id = :id"
        ),
        {"id": delivery_id},
    ).fetchone()


@pytest.mark.asyncio
async def test_dispatcher_backoff_progression_and_dead_letter_real_pg(pg_session, monkeypatch):
    from bot.services import approval_webhook
    from bot.services.webhook_dispatcher import (
        BACKOFF_SCHEDULE_SECONDS,
        MAX_ATTEMPTS,
        WebhookDispatcher,
    )
    import bot.services.webhook_dispatcher as wd_module

    agent_id, agent_uuid = _insert_agent(pg_session)
    approval_id = _insert_approval(pg_session, agent_uuid, telegram_id=1)
    delivery_id = _make_pending_delivery(pg_session, approval_id, agent_uuid)

    monkeypatch.setattr(wd_module, "is_callback_url_safe", lambda url: True)

    class _FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            raise httpx.ConnectError("down")

    monkeypatch.setattr(wd_module.httpx, "AsyncClient", lambda **kw: _FailingClient())

    dispatcher = WebhookDispatcher()

    for expected_attempt_index in range(MAX_ATTEMPTS):
        await dispatcher._process_due()
        status, attempts, next_attempt_at, last_error = _delivery_row(pg_session, delivery_id)
        assert status == "pending"
        assert attempts == expected_attempt_index + 1
        # Real Postgres timestamptz arithmetic: the ::interval branch must
        # have actually computed a future timestamp, not raised/no-op'd.
        assert next_attempt_at is not None
        # The claim step flips status to 'sending' mid-attempt; a retryable
        # failure must reset it back to 'pending' or the row would wedge.
        pg_session.execute(
            text(
                "UPDATE agent_webhook_deliveries SET next_attempt_at = NULL, "
                "status = 'pending' WHERE id = :id"
            ),
            {"id": delivery_id},
        )
        pg_session.commit()

    await dispatcher._process_due()
    status, attempts, next_attempt_at, last_error = _delivery_row(pg_session, delivery_id)
    assert status == "failed"
    assert attempts == MAX_ATTEMPTS + 1
    assert BACKOFF_SCHEDULE_SECONDS == [30, 120, 480, 1800, 7200]


@pytest.mark.asyncio
async def test_dispatcher_success_marks_delivered_real_pg(pg_session, monkeypatch):
    from bot.services.webhook_dispatcher import WebhookDispatcher
    import bot.services.webhook_dispatcher as wd_module

    agent_id, agent_uuid = _insert_agent(pg_session)
    approval_id = _insert_approval(pg_session, agent_uuid, telegram_id=1)
    delivery_id = _make_pending_delivery(pg_session, approval_id, agent_uuid)

    class _FakeResponse:
        status_code = 200

    class _SuccessClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            return _FakeResponse()

    monkeypatch.setattr(wd_module, "is_callback_url_safe", lambda url: True)
    monkeypatch.setattr(wd_module.httpx, "AsyncClient", lambda **kw: _SuccessClient())

    dispatcher = WebhookDispatcher()
    await dispatcher._process_due()

    status, attempts, next_attempt_at, last_error = _delivery_row(pg_session, delivery_id)
    assert status == "delivered"
    assert attempts == 1
    assert last_error is None
