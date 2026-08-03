"""Real-Postgres integration tests for the agent control plane.

These call the REAL bot functions (never re-implement their SQL here) against
a real scratch Postgres database (see conftest.py). Each test class notes
which historical bug class it regression-guards:

  BUG (a): ``agents.uuid`` (native Postgres uuid) joined against
  ``approval_requests.agent_id`` (varchar) requires an explicit
  ``CAST(a.uuid AS TEXT) = ap.agent_id`` -- a bare ``uuid = text`` comparison
  raises ``UndefinedFunctionError`` on Postgres but silently "passes" on
  SQLite (both stored as TEXT there).

  BUG (b): Postgres-only SQL (``now()``, ``IS NOT DISTINCT FROM``,
  ``(:delay || ' seconds')::interval``) either errors or is silently
  unsupported by the sqlite test driver, which caused whole test bodies to
  skip cleanly instead of actually running.
"""

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Shared seed helpers
# ---------------------------------------------------------------------------


def _seed_user(pg_db, telegram_id: int) -> int:
    with pg_db.get_session() as session:
        row = session.execute(
            text("INSERT INTO users (telegram_id) VALUES (:tg) RETURNING id"),
            {"tg": telegram_id},
        ).fetchone()
        return row[0]


def _seed_agent(
    pg_db,
    *,
    name: str,
    callback_url: str | None = None,
    api_key_hash: str = "cd" * 32,
    owner_user_id: int | None = None,
) -> tuple[int, str]:
    """Returns (agents.id, agents.uuid)."""
    with pg_db.get_session() as session:
        row = session.execute(
            text(
                "INSERT INTO agents (name, api_key, api_key_hash, callback_url, owner_user_id) "
                "VALUES (:name, :key, :hash, :cb, :owner) "
                "RETURNING id, uuid"
            ),
            {
                "name": name,
                "key": f"key-{uuid.uuid4().hex}",
                "hash": api_key_hash,
                "cb": callback_url,
                "owner": owner_user_id,
            },
        ).fetchone()
        return row[0], str(row[1])


def _seed_approval(
    pg_db,
    *,
    agent_uuid: str,
    user_id: int | None = None,
    status: str = "pending",
    expires_in_min: int = 15,
    payload_hash: str = "deadbeef",
) -> str:
    approval_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_in_min)
    with pg_db.get_session() as session:
        session.execute(
            text(
                "INSERT INTO approval_requests "
                "(id, agent_id, user_id, action_type, payload, payload_hash, status, expires_at) "
                "VALUES (:id, :agent_id, :user_id, 'swap_execute', :payload, :payload_hash, "
                ":status, :expires_at)"
            ),
            {
                "id": approval_id,
                "agent_id": agent_uuid,
                "user_id": user_id,
                "payload": json.dumps({"valueUsd": 42.0}),
                "payload_hash": payload_hash,
                "status": status,
                "expires_at": expires_at,
            },
        )
    return approval_id


# ---------------------------------------------------------------------------
# bot/services/approval_webhook.py -- notify_approval_decided
#
# Regression-guards BUG (a): the join in notify_approval_decided's lookup
# query (CAST(a.uuid AS TEXT) = ap.agent_id) must actually return a row on
# real Postgres. A bare `a.uuid = ap.agent_id` raises
# `operator does not exist: uuid = character varying` here -- SQLite hides
# this entirely.
# ---------------------------------------------------------------------------


class TestNotifyApprovalDecidedPostgresJoin:
    @pytest.mark.asyncio
    async def test_uuid_text_join_resolves_and_delivers(self, pg_db, monkeypatch):
        from bot.services import approval_webhook

        monkeypatch.setattr(approval_webhook, "get_session", pg_db.get_session)

        agent_id, agent_uuid = _seed_agent(
            pg_db, name="AgentA", callback_url="https://agent.example.com/hook"
        )
        approval_id = _seed_approval(pg_db, agent_uuid=agent_uuid, status="approved")

        async def fake_post_once(callback_url, raw_body, headers, approval_id):
            return True

        monkeypatch.setattr(approval_webhook, "is_callback_url_safe", lambda u: True)
        monkeypatch.setattr(approval_webhook, "_post_once", fake_post_once)

        # If the CAST(a.uuid AS TEXT) = ap.agent_id join were reverted to a
        # bare uuid = text comparison, this call would raise inside the
        # try/except SQLAlchemyError block and silently return -- so the
        # delivery row would never be created. Asserting it WAS created
        # proves the join actually matched a row on real Postgres.
        await approval_webhook.notify_approval_decided(approval_id, "approved", None)

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT status FROM agent_webhook_deliveries WHERE approval_id = :aid"),
                {"aid": approval_id},
            ).fetchone()
        assert row is not None
        assert row[0] == "delivered"

    @pytest.mark.asyncio
    async def test_no_callback_url_is_a_silent_noop(self, pg_db, monkeypatch):
        from bot.services import approval_webhook

        monkeypatch.setattr(approval_webhook, "get_session", pg_db.get_session)

        _agent_id, agent_uuid = _seed_agent(pg_db, name="AgentNoCallback", callback_url=None)
        approval_id = _seed_approval(pg_db, agent_uuid=agent_uuid, status="approved")

        # Must not raise, and must not enqueue any delivery row.
        await approval_webhook.notify_approval_decided(approval_id, "approved", None)

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT status FROM agent_webhook_deliveries WHERE approval_id = :aid"),
                {"aid": approval_id},
            ).fetchone()
        assert row is None


# ---------------------------------------------------------------------------
# bot/handlers/approvals.py -- approval_decision_callback
# ---------------------------------------------------------------------------


class TestApprovalDecisionCallback:
    @pytest.mark.asyncio
    async def test_atomic_single_decide(self, pg_db, monkeypatch):
        from bot.handlers import approvals as approvals_module

        monkeypatch.setattr(approvals_module, "get_session", pg_db.get_session)
        monkeypatch.setattr(approvals_module, "notify_approval_decided", _noop_notify)

        owner_tg = 555001
        owner_user_id = _seed_user(pg_db, owner_tg)
        _agent_id, agent_uuid = _seed_agent(pg_db, name="AgentDecide")
        approval_id = _seed_approval(pg_db, agent_uuid=agent_uuid, user_id=owner_user_id)

        update, context = _make_callback_update(owner_tg, f"apprv:{approval_id}:yes")
        await approvals_module.approval_decision_callback(update, context)

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT status, decided_by FROM approval_requests WHERE id = :id"),
                {"id": approval_id},
            ).fetchone()
        assert row[0] == "approved"
        assert row[1] == owner_user_id

        # A second tap (even by the owner) must be a no-op -- status unchanged.
        update2, context2 = _make_callback_update(owner_tg, f"apprv:{approval_id}:no")
        await approvals_module.approval_decision_callback(update2, context2)
        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT status FROM approval_requests WHERE id = :id"),
                {"id": approval_id},
            ).fetchone()
        assert row[0] == "approved"  # still approved, not flipped to denied

    @pytest.mark.asyncio
    async def test_non_owner_cannot_decide(self, pg_db, monkeypatch):
        from bot.handlers import approvals as approvals_module

        monkeypatch.setattr(approvals_module, "get_session", pg_db.get_session)
        monkeypatch.setattr(approvals_module, "notify_approval_decided", _noop_notify)

        owner_tg = 555002
        attacker_tg = 555003
        owner_user_id = _seed_user(pg_db, owner_tg)
        _seed_user(pg_db, attacker_tg)
        _agent_id, agent_uuid = _seed_agent(pg_db, name="AgentGuard")
        approval_id = _seed_approval(pg_db, agent_uuid=agent_uuid, user_id=owner_user_id)

        update, context = _make_callback_update(attacker_tg, f"apprv:{approval_id}:yes")
        await approvals_module.approval_decision_callback(update, context)

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT status, decided_by FROM approval_requests WHERE id = :id"),
                {"id": approval_id},
            ).fetchone()
        assert row[0] == "pending"
        assert row[1] is None

        reply_text = update.callback_query.edit_message_text.call_args[0][0]
        assert reply_text == "This approval belongs to another user."


def _noop_notify(*args, **kwargs):
    async def _inner():
        return None

    return _inner()


def _make_callback_update(telegram_id: int, callback_data: str):
    from unittest.mock import AsyncMock, MagicMock

    query = MagicMock()
    query.data = callback_data
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()

    update = MagicMock()
    update.callback_query = query
    update.effective_user = MagicMock(id=telegram_id)
    context = MagicMock()
    return update, context


# ---------------------------------------------------------------------------
# bot/handlers/claim_agent.py
# ---------------------------------------------------------------------------


class TestClaimAgent:
    @pytest.mark.asyncio
    async def test_claim_happy_path(self, pg_db, monkeypatch):
        from bot.handlers import claim_agent as claim_agent_module

        monkeypatch.setattr(claim_agent_module, "get_session", pg_db.get_session)
        claim_agent_module._claim_limiter._user_requests.clear()

        agent_id, _agent_uuid = _seed_agent(pg_db, name="ClaimAgentA")
        code, code_hash = "raw-code-happy", None
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at) "
                    "VALUES (:a, :h, :e)"
                ),
                {
                    "a": agent_id,
                    "h": code_hash,
                    "e": datetime.now(timezone.utc) + timedelta(minutes=10),
                },
            )

        caller_tg = 700001
        update, context = _make_command_update(caller_tg, [code])
        await claim_agent_module.claim_agent_command(update, context)

        reply = update.message.reply_text.call_args[0][0]
        assert "✅" in reply

        with pg_db.get_session() as session:
            agent_row = session.execute(
                text("SELECT owner_user_id FROM agents WHERE id = :a"), {"a": agent_id}
            ).fetchone()
            user_row = session.execute(
                text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": caller_tg}
            ).fetchone()
            used_row = session.execute(
                text("SELECT used_at FROM agent_link_codes WHERE agent_id = :a"), {"a": agent_id}
            ).fetchone()
        assert agent_row[0] == user_row[0]
        assert used_row[0] is not None

    @pytest.mark.asyncio
    async def test_claim_reuse_rejected(self, pg_db, monkeypatch):
        from bot.handlers import claim_agent as claim_agent_module

        monkeypatch.setattr(claim_agent_module, "get_session", pg_db.get_session)
        claim_agent_module._claim_limiter._user_requests.clear()

        agent_id, _agent_uuid = _seed_agent(pg_db, name="ClaimAgentReuse")
        code = "raw-code-reuse"
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at) "
                    "VALUES (:a, :h, :e)"
                ),
                {
                    "a": agent_id,
                    "h": code_hash,
                    "e": datetime.now(timezone.utc) + timedelta(minutes=10),
                },
            )

        update1, context1 = _make_command_update(700002, [code])
        await claim_agent_module.claim_agent_command(update1, context1)

        update2, context2 = _make_command_update(700003, [code])
        await claim_agent_module.claim_agent_command(update2, context2)

        reply2 = update2.message.reply_text.call_args[0][0]
        assert "invalid, already used, or expired" in reply2

    @pytest.mark.asyncio
    async def test_claim_expired_rejected(self, pg_db, monkeypatch):
        from bot.handlers import claim_agent as claim_agent_module

        monkeypatch.setattr(claim_agent_module, "get_session", pg_db.get_session)
        claim_agent_module._claim_limiter._user_requests.clear()

        agent_id, _agent_uuid = _seed_agent(pg_db, name="ClaimAgentExpired")
        code = "raw-code-expired"
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at) "
                    "VALUES (:a, :h, :e)"
                ),
                {
                    "a": agent_id,
                    "h": code_hash,
                    "e": datetime.now(timezone.utc) - timedelta(minutes=5),
                },
            )

        update, context = _make_command_update(700004, [code])
        await claim_agent_module.claim_agent_command(update, context)

        reply = update.message.reply_text.call_args[0][0]
        assert "invalid, already used, or expired" in reply

    @pytest.mark.asyncio
    async def test_claim_already_linked_rejected(self, pg_db, monkeypatch):
        from bot.handlers import claim_agent as claim_agent_module

        monkeypatch.setattr(claim_agent_module, "get_session", pg_db.get_session)
        claim_agent_module._claim_limiter._user_requests.clear()

        other_owner = _seed_user(pg_db, 700099)
        agent_id, _agent_uuid = _seed_agent(
            pg_db, name="ClaimAgentLinked", owner_user_id=other_owner
        )
        code = "raw-code-linked"
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_link_codes (agent_id, code_hash, expires_at) "
                    "VALUES (:a, :h, :e)"
                ),
                {
                    "a": agent_id,
                    "h": code_hash,
                    "e": datetime.now(timezone.utc) + timedelta(minutes=10),
                },
            )

        update, context = _make_command_update(700005, [code])
        await claim_agent_module.claim_agent_command(update, context)

        reply = update.message.reply_text.call_args[0][0]
        assert "already linked to an owner" in reply

    @pytest.mark.asyncio
    async def test_unlink_scoped_to_owner(self, pg_db, monkeypatch):
        from bot.handlers import claim_agent as claim_agent_module

        monkeypatch.setattr(claim_agent_module, "get_session", pg_db.get_session)

        owner_tg = 700006
        owner_user_id = _seed_user(pg_db, owner_tg)
        agent_id, _agent_uuid = _seed_agent(pg_db, name="UnlinkAgent", owner_user_id=owner_user_id)

        # Non-owner attempt first -- must be a no-op.
        attacker_tg = 700007
        _seed_user(pg_db, attacker_tg)
        update_bad, context_bad = _make_command_update(attacker_tg, ["UnlinkAgent"])
        await claim_agent_module.unlink_agent_command(update_bad, context_bad)
        reply_bad = update_bad.message.reply_text.call_args[0][0]
        assert "Couldn't find" in reply_bad

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT owner_user_id FROM agents WHERE id = :a"), {"a": agent_id}
            ).fetchone()
        assert row[0] == owner_user_id  # untouched

        # Rightful owner succeeds.
        update_ok, context_ok = _make_command_update(owner_tg, ["UnlinkAgent"])
        await claim_agent_module.unlink_agent_command(update_ok, context_ok)
        reply_ok = update_ok.message.reply_text.call_args[0][0]
        assert "unlinked" in reply_ok

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT owner_user_id FROM agents WHERE id = :a"), {"a": agent_id}
            ).fetchone()
        assert row[0] is None


def _make_command_update(telegram_id: int, args: list[str]):
    from unittest.mock import AsyncMock, MagicMock

    update = MagicMock()
    update.effective_user = MagicMock(id=telegram_id)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


# ---------------------------------------------------------------------------
# bot/services/webhook_dispatcher.py -- _process_due / _record_failure
#
# Regression-guards BUG (b): (:delay || ' seconds')::interval and the stale-
# 'sending' reclaim's INTERVAL arithmetic are Postgres-only syntax.
# ---------------------------------------------------------------------------


class TestWebhookDispatcherPostgresIntervalArithmetic:
    def test_backoff_progression_through_dead_letter(self, pg_db, monkeypatch):
        from bot.services import webhook_dispatcher

        monkeypatch.setattr(webhook_dispatcher, "get_session", pg_db.get_session)
        monkeypatch.setattr(webhook_dispatcher, "_is_postgres", lambda: True)

        _agent_id, agent_uuid = _seed_agent(pg_db, name="DispatchAgent")
        approval_id = _seed_approval(pg_db, agent_uuid=agent_uuid, status="approved")
        delivery_id = str(uuid.uuid4())
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_webhook_deliveries "
                    "(id, approval_id, agent_id, url, payload_json, status, attempts) "
                    "VALUES (:id, :aid, :agent, :url, '{}', 'pending', 0)"
                ),
                {
                    "id": delivery_id,
                    "aid": approval_id,
                    "agent": agent_uuid,
                    "url": "https://agent.example.com/hook",
                },
            )

        dispatcher = webhook_dispatcher.WebhookDispatcher()

        for expected_attempt in range(1, webhook_dispatcher.MAX_ATTEMPTS + 1):
            # This is the exact call whose SQL uses
            # `CURRENT_TIMESTAMP + (:delay || ' seconds')::interval` on
            # Postgres -- would raise a syntax error against real Postgres if
            # the branch were wrong, which SQLite could never catch.
            dispatcher._record_failure(delivery_id, expected_attempt - 1, "boom")
            with pg_db.get_session() as session:
                row = session.execute(
                    text(
                        "SELECT status, attempts, next_attempt_at FROM agent_webhook_deliveries "
                        "WHERE id = :id"
                    ),
                    {"id": delivery_id},
                ).fetchone()
            assert row[0] == "pending"
            assert row[1] == expected_attempt
            assert row[2] is not None  # interval arithmetic actually produced a timestamp

        dispatcher._record_failure(delivery_id, webhook_dispatcher.MAX_ATTEMPTS, "boom")
        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT status, attempts FROM agent_webhook_deliveries WHERE id = :id"),
                {"id": delivery_id},
            ).fetchone()
        assert row[0] == "failed"
        assert row[1] == webhook_dispatcher.MAX_ATTEMPTS + 1

    def test_stranded_sending_row_reclaimed_via_pg_interval(self, pg_db, monkeypatch):
        from bot.services import webhook_dispatcher

        monkeypatch.setattr(webhook_dispatcher, "get_session", pg_db.get_session)
        monkeypatch.setattr(webhook_dispatcher, "_is_postgres", lambda: True)

        _agent_id, agent_uuid = _seed_agent(pg_db, name="StrandedAgent")
        approval_id = _seed_approval(pg_db, agent_uuid=agent_uuid, status="approved")
        delivery_id = str(uuid.uuid4())
        stale_claimed_at = datetime.now(timezone.utc) - timedelta(seconds=600)
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_webhook_deliveries "
                    "(id, approval_id, agent_id, url, payload_json, status, attempts, claimed_at) "
                    "VALUES (:id, :aid, :agent, :url, '{}', 'sending', 1, :claimed_at)"
                ),
                {
                    "id": delivery_id,
                    "aid": approval_id,
                    "agent": agent_uuid,
                    "url": "https://x",
                    "claimed_at": stale_claimed_at,
                },
            )

        dispatcher = webhook_dispatcher.WebhookDispatcher()
        # _claim's WHERE clause uses
        # `claimed_at < CURRENT_TIMESTAMP - INTERVAL '300 seconds'` on
        # Postgres -- exercising the real interval-comparison branch.
        reclaimed = dispatcher._claim(delivery_id)
        assert reclaimed is not None
        assert reclaimed["id"] == delivery_id

        # A freshly-claimed row must NOT be reclaimed.
        delivery_id2 = str(uuid.uuid4())
        with pg_db.get_session() as session:
            session.execute(
                text(
                    "INSERT INTO agent_webhook_deliveries "
                    "(id, approval_id, agent_id, url, payload_json, status, attempts, claimed_at) "
                    "VALUES (:id, :aid, :agent, :url, '{}', 'sending', 1, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": delivery_id2,
                    "aid": approval_id,
                    "agent": agent_uuid,
                    "url": "https://x",
                },
            )
        result = dispatcher._claim(delivery_id2)
        assert result is None


# ---------------------------------------------------------------------------
# bot/handlers/admin_killswitch.py
#
# Regression-guards BUG (b): `now()` and `IS NOT DISTINCT FROM` are
# Postgres-only -- the sqlite unit test module skips these assertions
# entirely when the driver doesn't support the syntax.
# ---------------------------------------------------------------------------


class TestAdminKillswitchRealPostgres:
    def test_activate_known_admin_resolves_activated_by(self, pg_db):
        from bot.handlers import admin_killswitch

        admin_tg = 800001
        admin_user_id = _seed_user(pg_db, admin_tg)

        with pg_db.get_session() as session:
            admin_killswitch.activate_kill_switch(
                session,
                scope="global",
                scope_id=None,
                reason="incident",
                admin_telegram_id=admin_tg,
            )
            session.commit()

        with pg_db.get_session() as session:
            row = session.execute(
                text("SELECT activated_by, reason FROM policy_kill_switches WHERE scope = 'global'")
            ).fetchone()
        assert row[0] == admin_user_id
        assert row[1] == "incident"

    def test_activate_unknown_admin_nulls_activated_by_and_tags_reason(self, pg_db):
        from bot.handlers import admin_killswitch

        unknown_tg = 800002  # deliberately never seeded into users

        with pg_db.get_session() as session:
            admin_killswitch.activate_kill_switch(
                session,
                scope="agent",
                scope_id="agent-xyz",
                reason="bad behavior",
                admin_telegram_id=unknown_tg,
            )
            session.commit()

        with pg_db.get_session() as session:
            row = session.execute(
                text(
                    "SELECT activated_by, reason FROM policy_kill_switches "
                    "WHERE scope = 'agent' AND scope_id = 'agent-xyz'"
                )
            ).fetchone()
        assert row[0] is None
        assert row[1] == f"bad behavior [tg:{unknown_tg}]"

    def test_list_and_deactivate(self, pg_db):
        from bot.handlers import admin_killswitch

        admin_tg = 800003
        _seed_user(pg_db, admin_tg)

        with pg_db.get_session() as session:
            admin_killswitch.activate_kill_switch(
                session, scope="org", scope_id="org-1", reason="r1", admin_telegram_id=admin_tg
            )
            session.commit()

        with pg_db.get_session() as session:
            switches = admin_killswitch.list_active_kill_switches(session)
        assert any(s["scope"] == "org" and s["scope_id"] == "org-1" for s in switches)

        # IS NOT DISTINCT FROM null-safe matching is exercised via the global
        # (scope_id NULL) upsert path in the previous test; here exercise the
        # non-null scope_id equality path through to deactivate.
        with pg_db.get_session() as session:
            changed = admin_killswitch.deactivate_kill_switch(
                session, scope="org", scope_id="org-1"
            )
            session.commit()
        assert changed is True

        with pg_db.get_session() as session:
            switches = admin_killswitch.list_active_kill_switches(session)
        assert not any(s["scope"] == "org" and s["scope_id"] == "org-1" for s in switches)

    def test_activate_upsert_uses_is_not_distinct_from_for_null_scope_id(self, pg_db):
        """Regression for BUG (b): a bare `scope_id = :scope_id` (instead of
        `IS NOT DISTINCT FROM`) would never match an existing NULL scope_id
        row on Postgres (NULL = NULL is NULL, not true), so re-activating the
        global switch would insert a duplicate row instead of upserting."""
        from bot.handlers import admin_killswitch

        admin_tg = 800004
        _seed_user(pg_db, admin_tg)

        with pg_db.get_session() as session:
            admin_killswitch.activate_kill_switch(
                session, scope="global", scope_id=None, reason="first", admin_telegram_id=admin_tg
            )
            session.commit()
        with pg_db.get_session() as session:
            admin_killswitch.activate_kill_switch(
                session, scope="global", scope_id=None, reason="second", admin_telegram_id=admin_tg
            )
            session.commit()

        with pg_db.get_session() as session:
            rows = session.execute(
                text("SELECT reason FROM policy_kill_switches WHERE scope = 'global'")
            ).fetchall()
        assert len(rows) == 1
        assert rows[0][0] == "second"
