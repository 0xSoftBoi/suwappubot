"""Agent approval decision handlers (SUW-204: agent control-plane human-in-the-loop).

- Inline ``✅ Approve`` / ``❌ Deny`` buttons DM'd by
  ``bot/services/approval_notifier.py`` carry callback data
  ``apprv:<id>:yes`` / ``apprv:<id>:no``. ``approval_decision_callback``
  atomically flips a still-pending row so a double-tap (or a race with the
  expiry sweep) can only ever decide it once.
- ``/approvals`` lists the caller's own pending approval requests.

The ``agent_approvals`` table is shared with api-ts (agent-control-plane
writes new rows); every query here tolerates the table not existing yet.
"""

import asyncio
import logging
from datetime import datetime, timezone

from telegram import Update
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from bot.services.approval_webhook import notify_approval_decided
from database.db import get_session

logger = logging.getLogger(__name__)


def _table_missing(e: Exception) -> bool:
    msg = str(e).lower()
    return "does not exist" in msg or "no such table" in msg


async def approval_decision_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle apprv:<id>:yes / apprv:<id>:no callback taps."""
    query = update.callback_query
    if not query or not query.data:
        return
    await query.answer()

    try:
        _, approval_id, decision = query.data.split(":", 2)
    except ValueError:
        return

    new_status = "approved" if decision == "yes" else "denied"
    user = update.effective_user
    decided_by = str(user.id) if user else "unknown"

    tapper_id = user.id if user else None
    if tapper_id is None:
        await query.edit_message_text("Couldn't identify who tapped this button. Try again.")
        return

    try:
        with get_session() as session:
            # Atomic guarded UPDATE: only flips a row that is STILL pending AND
            # owned by the tapping user, so a double-tap or a race with the
            # expiry-sweep can only decide it once, and a callback payload that
            # leaks/gets forwarded to someone else can never flip it for them.
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
                    "tapper": tapper_id,
                },
            )
            decided_now = (result.rowcount or 0) > 0
            session.commit()

            # Re-read the row's current status (whatever decided it) for the reply.
            row = session.execute(
                text(
                    "SELECT status, decided_by, agent_name, agent_id, user_telegram_id, "
                    "intent_hash FROM agent_approvals WHERE id = :id"
                ),
                {"id": approval_id},
            ).fetchone()
    except SQLAlchemyError as e:
        if _table_missing(e):
            await query.edit_message_text("This approval system isn't set up yet.")
            return
        logger.error("Failed to decide agent approval %s: %s", approval_id, e)
        await query.edit_message_text("Something went wrong recording your decision. Try again.")
        return

    if not row:
        await query.edit_message_text("This approval request no longer exists.")
        return

    status, existing_decided_by, agent_name, agent_id, owner_telegram_id, intent_hash = row
    label = agent_name or agent_id

    if decided_now:
        # Fire-and-forget: never await the network call inline so a slow/dead
        # callback_url can't delay the human's Telegram confirmation.
        asyncio.create_task(notify_approval_decided(approval_id, new_status, intent_hash))

    if not decided_now and status == "pending" and owner_telegram_id != tapper_id:
        # Row is still pending but the tapper isn't the owner (or the row has
        # no bound owner at all, in which case NO Telegram tapper may decide
        # it — that decision must come through whatever other channel bound
        # it). Don't reveal any details about the request.
        await query.edit_message_text("This approval belongs to another user.")
        return

    if decided_now:
        outcome = "✅ Approved" if new_status == "approved" else "❌ Denied"
        await query.edit_message_text(f"{outcome} — agent `{label}`.", parse_mode="Markdown")
    elif status in ("approved", "denied"):
        await query.edit_message_text(
            f"Already {status} (by {existing_decided_by or 'someone'}) — agent `{label}`.",
            parse_mode="Markdown",
        )
    elif status == "expired":
        await query.edit_message_text(
            f"⌛ This request expired — agent `{label}`.", parse_mode="Markdown"
        )
    else:
        await query.edit_message_text(f"This request is already {status}.")


async def approvals_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/approvals — list the caller's own pending agent-approval requests."""
    user = update.effective_user
    if not user or not update.message:
        return

    try:
        with get_session() as session:
            rows = session.execute(
                text(
                    "SELECT id, agent_name, agent_id, chain, value_usd, expires_at "
                    "FROM agent_approvals "
                    "WHERE user_telegram_id = :tg_id AND status = 'pending' "
                    "ORDER BY created_at DESC LIMIT 20"
                ),
                {"tg_id": user.id},
            ).fetchall()
    except SQLAlchemyError as e:
        if _table_missing(e):
            await update.message.reply_text("No pending agent approvals.")
            return
        logger.error("Failed to list agent approvals for %s: %s", user.id, e)
        await update.message.reply_text("Couldn't load approvals right now, try again shortly.")
        return

    if not rows:
        await update.message.reply_text("No pending agent approvals.")
        return

    lines = [f"🤖 *Pending agent approvals* — {len(rows)}\n"]
    now = datetime.now(timezone.utc)
    for approval_id, agent_name, agent_id, chain, value_usd, expires_at in rows:
        label = agent_name or agent_id
        value_str = f"${float(value_usd):,.2f}" if value_usd is not None else "?"
        if expires_at:
            exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            mins_left = max(int((exp - now).total_seconds() // 60), 0)
            expiry_str = f"{mins_left}m left"
        else:
            expiry_str = "no expiry"
        lines.append(
            f"• `{label}` on {chain or 'unknown'} — {value_str} ({expiry_str})\n"
            f"  id: `{approval_id}`"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


approval_decision_handler = CallbackQueryHandler(approval_decision_callback, pattern=r"^apprv:")
approvals_command_handler = CommandHandler("approvals", approvals_command)
