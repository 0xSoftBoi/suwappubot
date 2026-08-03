"""Agent approval decision handlers — the maker-checker human-in-the-loop side.

- Inline ``✅ Approve`` / ``❌ Deny`` buttons DM'd by
  ``bot/services/approval_notifier.py`` carry callback data
  ``apprv:<id>:yes`` / ``apprv:<id>:no``. ``approval_decision_callback``
  atomically flips a still-pending row so a double-tap (or a race with the
  expiry sweep) can only ever decide it once, and only the owning human can
  decide it.
- ``/approvals`` lists the caller's own pending approval requests.

The ``approval_requests`` table is owned by api-ts (schema at
``api-ts/src/db/schema/approvals.ts``); Python never creates it and only
reads it or updates the decision columns (status/decided_at/decided_by) here.
Every query tolerates the table (or the Python-owned notification columns)
not existing yet.
"""

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
    """True only for genuine missing-table/column signals.

    Deliberately does NOT match generic ``"does not exist"`` substrings —
    Postgres also uses that phrase for type-mismatch errors (e.g.
    ``operator does not exist: uuid = character varying``), which is a real
    bug, not a not-yet-migrated table, and must not be swallowed into a
    misleading "not set up yet" reply.
    """
    msg = str(e).lower()
    if "no such table" in msg or "no such column" in msg:
        return True
    if "relation" in msg and "does not exist" in msg:
        return True
    if "column" in msg and "does not exist" in msg:
        return True
    pgcode = getattr(getattr(e, "orig", None), "pgcode", None)
    return pgcode in ("42P01", "42703")  # undefined_table / undefined_column


def _resolve_user_id(session, telegram_id: int):
    row = session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"),
        {"tg": telegram_id},
    ).fetchone()
    return row[0] if row else None


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
    if user is None:
        await query.edit_message_text("Couldn't identify who tapped this button. Try again.")
        return

    try:
        with get_session() as session:
            caller_user_id = _resolve_user_id(session, user.id)
            if caller_user_id is None:
                # No linked Suwappu account for this Telegram user — can never
                # own an approval_requests row (user_id is a real FK), so no
                # guarded UPDATE can possibly match. Don't leak row existence.
                await query.edit_message_text("This approval belongs to another user.")
                return

            # Atomic guarded UPDATE: only flips a row that is STILL pending
            # AND owned by the tapping user (resolved to users.id), so a
            # double-tap, a race with the expiry sweep, or a forwarded
            # callback payload can never decide it more than once or for
            # someone else.
            result = session.execute(
                text(
                    "UPDATE approval_requests "
                    "SET status = :new_status, decided_by = :decided_by, "
                    "decided_at = CURRENT_TIMESTAMP "
                    "WHERE id = :id AND status = 'pending' AND user_id = :caller_user_id"
                ),
                {
                    "new_status": new_status,
                    "decided_by": caller_user_id,
                    "id": approval_id,
                    "caller_user_id": caller_user_id,
                },
            )
            decided_now = (result.rowcount or 0) > 0
            session.commit()

            # Re-read the row's current status (whatever decided it) for the reply.
            row = session.execute(
                text(
                    "SELECT ar.status, ar.decided_by, a.name, ar.agent_id, ar.user_id "
                    "FROM approval_requests ar "
                    "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
                    "WHERE ar.id = :id"
                ),
                {"id": approval_id},
            ).fetchone()
    except SQLAlchemyError as e:
        if _table_missing(e):
            await query.edit_message_text("This approval system isn't set up yet.")
            return
        logger.error("Failed to decide approval %s: %s", approval_id, e)
        await query.edit_message_text("Something went wrong recording your decision. Try again.")
        return

    if not row:
        await query.edit_message_text("This approval request no longer exists.")
        return

    status, existing_decided_by, agent_name, agent_id, owner_user_id = row
    label = agent_name or agent_id

    if not decided_now and status == "pending" and owner_user_id != caller_user_id:
        # Row is still pending but the tapper isn't the owner. Distinguish
        # "not yours" from "already decided" without leaking any other detail.
        await query.edit_message_text("This approval belongs to another user.")
        return

    if decided_now:
        outcome = "✅ Approved" if new_status == "approved" else "❌ Denied"
        await query.edit_message_text(f"{outcome} — agent `{label}`.", parse_mode="Markdown")
        # Fire the agent's decision webhook (durable — enqueued first inside
        # notify_approval_decided so the decision is never lost even if the
        # inline POST attempt fails). Never blocks/crashes this handler.
        try:
            await notify_approval_decided(approval_id, new_status, None)
        except Exception as e:  # noqa: BLE001 — webhook delivery must never break the decide flow
            logger.warning("approval webhook dispatch failed for %s: %s", approval_id, e)
    elif status in ("approved", "denied"):
        await query.edit_message_text(
            f"Already {status} (by user #{existing_decided_by or 'someone'}) — agent `{label}`.",
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
            caller_user_id = _resolve_user_id(session, user.id)
            if caller_user_id is None:
                await update.message.reply_text("No pending agent approvals.")
                return

            rows = session.execute(
                text(
                    "SELECT ar.id, a.name, ar.agent_id, ar.action_type, ar.payload, "
                    "ar.expires_at "
                    "FROM approval_requests ar "
                    "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
                    "WHERE ar.user_id = :uid AND ar.status = 'pending' "
                    "ORDER BY ar.created_at DESC LIMIT 20"
                ),
                {"uid": caller_user_id},
            ).fetchall()
    except SQLAlchemyError as e:
        if _table_missing(e):
            await update.message.reply_text("No pending agent approvals.")
            return
        logger.error("Failed to list approvals for %s: %s", user.id, e)
        await update.message.reply_text("Couldn't load approvals right now, try again shortly.")
        return

    if not rows:
        await update.message.reply_text("No pending agent approvals.")
        return

    lines = [f"🤖 *Pending agent approvals* — {len(rows)}\n"]
    now = datetime.now(timezone.utc)
    for approval_id, agent_name, agent_id, action_type, payload, expires_at in rows:
        label = agent_name or agent_id
        value_usd = payload.get("valueUsd") if isinstance(payload, dict) else None
        value_str = f"${float(value_usd):,.2f}" if value_usd is not None else "?"
        if expires_at:
            exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            mins_left = max(int((exp - now).total_seconds() // 60), 0)
            expiry_str = f"{mins_left}m left"
        else:
            expiry_str = "no expiry"
        lines.append(
            f"• `{label}` — {action_type} — {value_str} ({expiry_str})\n" f"  id: `{approval_id}`"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


approval_decision_handler = CallbackQueryHandler(approval_decision_callback, pattern=r"^apprv:")
approvals_command_handler = CommandHandler("approvals", approvals_command)
