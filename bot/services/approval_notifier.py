"""Agent approval notifier — Telegram half of the maker-checker control plane.

api-ts (Hono/Effect agent-control-plane) writes a row to the shared
``approval_requests`` table (schema: ``api-ts/src/db/schema/approvals.ts``)
whenever ``PolicyService.evaluate()`` returns ``require_approval`` for an
agent's deferred swap execute call. This background loop polls for rows this
Python side has not yet DM'd (``notified_at IS NULL``), sends the owning
Telegram user an Approve/Deny prompt built from the ``payload`` economic
terms (see ``api-ts/src/lib/approvalTerms.ts``'s ``EconomicTerms``), and
stamps the notification bookkeeping columns.

``notified_at`` / ``notify_chat_id`` / ``notify_message_id`` are Python-owned
columns added additively in ``database/db.py``'s ``_ensure_schema()`` — api-ts
must NOT write them (see the column comments there); every other column on
this table is api-ts-owned and Python only reads it or updates the decision
columns (status/decided_at/decided_by) via the atomic guarded UPDATE in
``bot/handlers/approvals.py``.

This table is written first by api-ts, so every DB call here tolerates the
table (or the notification columns) not existing yet — a missing table/column
degrades this loop to a no-op rather than crashing the background-service
supervisor.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text, bindparam
from sqlalchemy.exc import SQLAlchemyError

from bot.config.settings import settings
from database.db import get_session

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 15


def _table_missing(e: Exception) -> bool:
    msg = str(e).lower()
    return "does not exist" in msg or "no such table" in msg or "no such column" in msg


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


def _intent_summary(payload) -> str:
    """Best-effort from/to token + amount summary out of the EconomicTerms payload."""
    if not isinstance(payload, dict):
        return "—"
    from_token = payload.get("fromToken") or "?"
    to_token = payload.get("toToken") or "?"
    amount_in = payload.get("amountIn")
    if amount_in:
        return f"{amount_in} (raw units) {from_token} → {to_token}"
    return f"{from_token} → {to_token}"


def _build_message(row: dict) -> str:
    payload = row.get("payload") or {}
    value_usd = payload.get("valueUsd") if isinstance(payload, dict) else None
    value_str = f"${float(value_usd):,.2f}" if value_usd is not None else "unknown value"
    return (
        "🤖 *Agent approval requested*\n\n"
        f"Agent: `{row.get('agent_name') or row.get('agent_id')}`\n"
        f"Action: `{row.get('action_type')}`\n"
        f"Intent: {_intent_summary(payload)}\n"
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
    """Background task that fans out un-notified approval_requests to their owners."""

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
                await self._process_pending()
            except Exception as e:  # noqa: BLE001 — one bad cycle must not kill the loop
                logger.error("Agent approval notifier loop error: %s", e, exc_info=True)
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def _expire_stale(self) -> None:
        """Flip pending-but-past-expiry rows to 'expired' and edit their DMs."""
        try:
            with get_session() as session:
                rows = session.execute(
                    text(
                        "SELECT id, notify_chat_id, notify_message_id "
                        "FROM approval_requests "
                        "WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP"
                    )
                ).fetchall()
                if not rows:
                    return
                ids = [r[0] for r in rows]
                stmt = text(
                    "UPDATE approval_requests SET status = 'expired' WHERE id IN :ids"
                ).bindparams(bindparam("ids", expanding=True))
                session.execute(stmt, {"ids": ids})
                session.commit()
        except SQLAlchemyError as e:
            if _table_missing(e):
                if not self._table_missing_logged:
                    logger.info("approval_requests table/columns not present yet; notifier idling")
                    self._table_missing_logged = True
                return
            logger.error("Failed to expire stale approval_requests: %s", e)
            return

        if self._bot is None:
            return
        for row_id, chat_id, message_id in rows:
            if not (chat_id and message_id):
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

    async def _process_pending(self) -> None:
        try:
            with get_session() as session:
                result = session.execute(
                    text(
                        "SELECT ar.id, ar.agent_id, a.name, u.telegram_id, ar.payload, "
                        "ar.action_type, ar.expires_at "
                        "FROM approval_requests ar "
                        "LEFT JOIN agents a ON a.uuid = ar.agent_id "
                        "LEFT JOIN users u ON u.id = ar.user_id "
                        "WHERE ar.status = 'pending' AND ar.notified_at IS NULL "
                        "ORDER BY ar.created_at ASC LIMIT 20"
                    )
                ).fetchall()
        except SQLAlchemyError as e:
            if _table_missing(e):
                if not self._table_missing_logged:
                    logger.info("approval_requests table/columns not present yet; notifier idling")
                    self._table_missing_logged = True
                return
            logger.error("Failed to poll approval_requests: %s", e)
            return

        for r in result:
            row = {
                "id": r[0],
                "agent_id": r[1],
                "agent_name": r[2],
                "user_telegram_id": r[3],
                "payload": r[4],
                "action_type": r[5],
                "expires_at": r[6],
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
                "Approval request %s has no resolvable owner telegram_id; leaving for the "
                "web (owner) decision path",
                approval_id,
            )

        try:
            with get_session() as session:
                session.execute(
                    text(
                        "UPDATE approval_requests SET notified_at = CURRENT_TIMESTAMP, "
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
