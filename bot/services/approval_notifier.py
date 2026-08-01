"""Agent approval notifier (SUW-204: agent control-plane human-in-the-loop).

Background loop that DMs the owning Telegram user whenever an autonomous
agent files a pending row in the shared ``agent_approvals`` table (written by
api-ts's agent-control-plane). Mirrors ``bot/services/support_notifier.py``'s
poll-for-unnotified-rows pattern: pick up ``status='pending' AND
notified_at IS NULL``, send an Approve/Deny prompt, stamp ``notified_at`` plus
the message coordinates so the decide-handler can edit the message in place.

Also sweeps expired requests (``expires_at < now()`` and still ``pending``)
to ``status='expired'`` and best-effort edits the original prompt.

The table is written first by api-ts; this service must tolerate it not
existing yet (new deploy ordering, flag not yet rolled out anywhere) — every
DB call here is wrapped so a missing table degrades to "loop does nothing"
rather than crashing the background-service supervisor.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text, bindparam
from sqlalchemy.exc import SQLAlchemyError

from bot.config.settings import settings
from bot.services.approval_webhook import notify_approval_decided
from database.db import get_session

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 15

# Fire-and-forget webhook tasks must be held here — otherwise asyncio only
# holds a weak reference via the event loop and the task can be garbage
# collected mid-flight before the HTTP call completes.
_background_tasks: set = set()


def _spawn_webhook_task(approval_id: str, status: str, intent_hash) -> None:
    task = asyncio.create_task(notify_approval_decided(approval_id, status, intent_hash))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _fmt_expiry(expires_at) -> str:
    if not expires_at:
        return "no expiry set"
    now = datetime.now(timezone.utc)
    exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
    delta = (exp - now).total_seconds()
    if delta <= 0:
        return "expired"
    minutes = int(delta // 60)
    if minutes < 60:
        return f"~{max(minutes, 1)}m left"
    hours = minutes // 60
    return f"~{hours}h left"


def _intent_summary(intent_json) -> str:
    """Best-effort from/to token summary out of the agent's intent payload."""
    if not isinstance(intent_json, dict):
        return "—"
    from_sym = (
        intent_json.get("fromToken")
        or intent_json.get("from_token")
        or intent_json.get("fromSymbol")
        or "?"
    )
    to_sym = (
        intent_json.get("toToken")
        or intent_json.get("to_token")
        or intent_json.get("toSymbol")
        or "?"
    )
    amount = intent_json.get("fromAmount") or intent_json.get("from_amount")
    if amount:
        return f"{amount} {from_sym} → {to_sym}"
    return f"{from_sym} → {to_sym}"


def _build_message(row: dict) -> str:
    value_usd = row.get("value_usd")
    value_str = f"${float(value_usd):,.2f}" if value_usd is not None else "unknown value"
    return (
        "🤖 *Agent approval requested*\n\n"
        f"Agent: `{row.get('agent_name') or row.get('agent_id')}`\n"
        f"Chain: `{row.get('chain') or 'unknown'}`\n"
        f"Intent: {_intent_summary(row.get('intent_json'))}\n"
        f"Value: {value_str}\n"
        f"Expiry: {_fmt_expiry(row.get('expires_at'))}\n\n"
        "Approve this agent action?"
    )


def _build_keyboard(approval_id: str):
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ Approve", callback_data=f"apprv:{approval_id}:yes"),
                InlineKeyboardButton("❌ Deny", callback_data=f"apprv:{approval_id}:no"),
            ]
        ]
    )


class ApprovalNotifier:
    """Background task that fans out un-notified agent_approvals to their owners."""

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None
        self._table_missing_logged = False

    async def start(self, bot=None) -> None:
        if not settings.agent_approvals_enabled:
            logger.info("Agent approval notifier disabled (AGENT_APPROVALS_ENABLED=false)")
            return
        if self._running:
            logger.warning("Agent approval notifier already running")
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Agent approval notifier started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Agent approval notifier stopped")

    async def _loop(self) -> None:
        await asyncio.sleep(10)  # let the app finish booting
        while self._running:
            try:
                await self._expire_stale()
                await self._catch_web_expired()
                await self._process_pending()
            except Exception as e:  # noqa: BLE001 — one bad cycle must not kill the loop
                logger.error("Agent approval notifier loop error: %s", e, exc_info=True)
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    def _table_missing(self, e: Exception) -> bool:
        msg = str(e).lower()
        return "does not exist" in msg or "no such table" in msg

    async def _expire_stale(self) -> None:
        """Flip pending-but-past-expiry rows to 'expired' and edit their DMs.

        Also stamps ``expiry_notified_at`` in the SAME UPDATE that flips
        ``status`` so ``_catch_web_expired``'s claim can never re-select a row
        this method already handled — without that, the fully-synchronous
        UPDATE here (status flips to 'expired' before the fire-and-forget
        webhook task set up below has even run) races
        ``_catch_web_expired``'s query later in the same loop iteration and
        both would fire an ``approval.expired`` webhook + message edit for
        the same row.
        """
        try:
            with get_session() as session:
                rows = session.execute(
                    text(
                        "SELECT id, notify_chat_id, notify_message_id, intent_hash "
                        "FROM agent_approvals "
                        "WHERE status = 'pending' AND expires_at IS NOT NULL "
                        "AND expires_at < CURRENT_TIMESTAMP"
                    )
                ).fetchall()
                if not rows:
                    return
                ids = [r[0] for r in rows]
                stmt = text(
                    "UPDATE agent_approvals SET status = 'expired', "
                    "expiry_notified_at = CURRENT_TIMESTAMP WHERE id IN :ids"
                ).bindparams(bindparam("ids", expanding=True))
                session.execute(stmt, {"ids": ids})
                session.commit()
        except SQLAlchemyError as e:
            if self._table_missing(e):
                if not self._table_missing_logged:
                    logger.info("agent_approvals table not present yet; notifier idling")
                    self._table_missing_logged = True
                return
            logger.error("Failed to expire stale agent approvals: %s", e)
            return

        for row_id, chat_id, message_id, intent_hash in rows:
            # Fire-and-forget the agent's decision webhook regardless of
            # whether we also have a Telegram message to edit.
            _spawn_webhook_task(row_id, "expired", intent_hash)

            if self._bot is None or not (chat_id and message_id):
                continue
            try:
                await self._bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=message_id,
                    text="⌛ This agent approval request expired.",
                    parse_mode="Markdown",
                )
            except Exception as e:  # noqa: BLE001
                logger.debug("Could not edit expired approval message %s: %s", row_id, e)

    async def _catch_web_expired(self) -> None:
        """Pick up rows already flipped to 'expired' by api-ts's lazy web-path expiry.

        api-ts's GET /webapp/approvals and POST /decide both lazily flip
        stale ``status='pending'`` rows straight to ``status='expired'`` on
        read (see api-ts/src/routes/webapp.ts). ``_expire_stale`` above only
        selects rows still ``status='pending'`` — once the web path beats it
        to the flip, that row is invisible to ``_expire_stale`` forever, so
        the owning agent never gets an ``approval.expired`` webhook and just
        hangs until its own client-side timeout.

        This scans already-``expired`` rows with ``expiry_notified_at IS
        NULL`` and atomically claims each one (``UPDATE ... WHERE
        expiry_notified_at IS NULL RETURNING id``) before enqueueing its
        webhook. ``expiry_notified_at`` — not "does a delivery row exist" —
        is the idempotency ledger: an agent with no ``callback_url`` never
        gets a delivery row from ``notify_approval_decided``, so the old
        NOT-EXISTS-on-``agent_webhook_deliveries`` guard treated such rows as
        perpetually unhandled, respawning a webhook task + Telegram edit
        every cycle forever and — with LIMIT 20 oldest-first — starving real
        web-expired rows out of the window. The atomic claim here also means
        ``_expire_stale`` (which stamps ``expiry_notified_at`` in the same
        UPDATE that flips status) can never be double-notified by this pass,
        even when both run in the same loop iteration.
        """
        try:
            with get_session() as session:
                candidate_ids = session.execute(
                    text(
                        "SELECT id FROM agent_approvals "
                        "WHERE status = 'expired' AND expiry_notified_at IS NULL "
                        "ORDER BY created_at ASC LIMIT 20"
                    )
                ).fetchall()
        except SQLAlchemyError as e:
            if self._table_missing(e):
                if not self._table_missing_logged:
                    logger.info("agent_approvals not present yet; web-expiry catch-up idling")
                    self._table_missing_logged = True
                return
            logger.error("Failed to scan web-expired agent_approvals: %s", e)
            return

        for (candidate_id,) in candidate_ids:
            claimed = self._claim_expiry_notification(candidate_id)
            if claimed is None:
                # Lost the race (another poller, or _expire_stale already
                # claimed it in this same cycle) — skip, don't double-notify.
                continue

            row_id, chat_id, message_id, intent_hash = (
                claimed["id"],
                claimed["notify_chat_id"],
                claimed["notify_message_id"],
                claimed["intent_hash"],
            )
            _spawn_webhook_task(row_id, "expired", intent_hash)

            if self._bot is None or not (chat_id and message_id):
                continue
            try:
                await self._bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=message_id,
                    text="⌛ This agent approval request expired.",
                    parse_mode="Markdown",
                )
            except Exception as e:  # noqa: BLE001
                logger.debug("Could not edit web-expired approval message %s: %s", row_id, e)

    def _claim_expiry_notification(self, approval_id: str) -> dict | None:
        """Atomically claim an already-expired row for the expiry webhook path.

        Returns the claimed row's notification fields, or None if another
        actor (another replica, or ``_expire_stale`` in this same cycle)
        already claimed it.
        """
        try:
            with get_session() as session:
                row = session.execute(
                    text(
                        "UPDATE agent_approvals SET expiry_notified_at = CURRENT_TIMESTAMP "
                        "WHERE id = :id AND status = 'expired' AND expiry_notified_at IS NULL "
                        "RETURNING id, notify_chat_id, notify_message_id, intent_hash"
                    ),
                    {"id": approval_id},
                ).fetchone()
                session.commit()
        except SQLAlchemyError as e:
            logger.warning("Failed to claim expiry notification for %s: %s", approval_id, e)
            return None
        if row is None:
            return None
        return {
            "id": row[0],
            "notify_chat_id": row[1],
            "notify_message_id": row[2],
            "intent_hash": row[3],
        }

    async def _process_pending(self) -> None:
        try:
            with get_session() as session:
                result = session.execute(
                    text(
                        "SELECT id, agent_id, agent_name, user_telegram_id, intent_json, "
                        "value_usd, chain, expires_at FROM agent_approvals "
                        "WHERE status = 'pending' AND notified_at IS NULL "
                        "ORDER BY created_at ASC LIMIT 20"
                    )
                ).fetchall()
        except SQLAlchemyError as e:
            if self._table_missing(e):
                if not self._table_missing_logged:
                    logger.info("agent_approvals table not present yet; notifier idling")
                    self._table_missing_logged = True
                return
            logger.error("Failed to poll agent_approvals: %s", e)
            return

        for r in result:
            row = {
                "id": r[0],
                "agent_id": r[1],
                "agent_name": r[2],
                "user_telegram_id": r[3],
                "intent_json": r[4],
                "value_usd": r[5],
                "chain": r[6],
                "expires_at": r[7],
            }
            await self._notify_one(row)

    async def _notify_one(self, row: dict) -> None:
        approval_id = row["id"]
        telegram_id = row.get("user_telegram_id")

        chat_id = None
        message_id = None
        if self._bot is not None and telegram_id:
            try:
                sent = await self._bot.send_message(
                    chat_id=telegram_id,
                    text=_build_message(row),
                    parse_mode="Markdown",
                    reply_markup=_build_keyboard(approval_id),
                )
                chat_id = sent.chat_id
                message_id = sent.message_id
            except Exception as e:  # noqa: BLE001 — never block on one bad DM target
                logger.warning(
                    "Failed to DM agent approval %s to telegram_id=%s: %s",
                    approval_id,
                    telegram_id,
                    e,
                )
        elif not telegram_id:
            logger.info(
                "Agent approval %s has no user_telegram_id; leaving for another channel",
                approval_id,
            )

        try:
            with get_session() as session:
                session.execute(
                    text(
                        "UPDATE agent_approvals SET notified_at = CURRENT_TIMESTAMP, "
                        "notify_chat_id = :chat_id, notify_message_id = :message_id "
                        "WHERE id = :id"
                    ),
                    {"chat_id": chat_id, "message_id": message_id, "id": approval_id},
                )
                session.commit()
        except SQLAlchemyError as e:
            logger.error("Failed to stamp notified_at for approval %s: %s", approval_id, e)


# Module-level singleton (mirrors support_notifier / alert_service).
approval_notifier = ApprovalNotifier()
