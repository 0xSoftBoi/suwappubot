"""Support & bug-report handlers.

User commands:
- ``/support [message]`` — open a support ticket. With text after the command
  it's filed immediately; without, the bot prompts for the message.
- ``/bug [message]`` — same flow, filed as a bug report.

Admin commands (gated by bot.handlers.admin.is_admin):
- ``/tickets [open|bug|support|all]`` — list tickets (active by default).
- ``/ticket <id>`` — show one ticket in full.
- ``/treply <id> <message>`` — DM the reporter, mark the ticket in-progress.
- ``/tclose <id>`` — mark a ticket resolved.

Tickets persist in the ``support_tickets`` table so the team can keep track of
them across restarts and surfaces. New tickets DM every configured admin.
"""

import logging
from datetime import datetime

from telegram import Update
from telegram.ext import (
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.handlers.admin import is_admin
from bot.models.support import SupportTicket, TicketKind, TicketStatus
from bot.models.user import User
from bot.services.support_notifier import add_linear_comment
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation state
ASK_MESSAGE = 0

# Per-kind copy.
_KIND_META = {
    TicketKind.SUPPORT: {"emoji": "🆘", "noun": "support ticket", "verb": "need help with"},
    TicketKind.BUG: {"emoji": "🐞", "noun": "bug report", "verb": "ran into"},
}

MAX_MESSAGE_LEN = 2000


def _meta(kind: str) -> dict:
    return _KIND_META.get(kind, _KIND_META[TicketKind.SUPPORT])


async def _create_ticket(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    kind: str,
    message_text: str,
) -> None:
    """Persist a ticket and confirm to the user.

    Fan-out to admins / the support group / Linear is handled centrally by the
    support_notifier background service (it picks up tickets with notified_at
    NULL), so every filing surface gets identical routing.
    """
    tg_user = update.effective_user
    if not tg_user or not update.message:
        return

    message_text = (message_text or "").strip()
    if not message_text:
        await update.message.reply_text("Please include a short description.")
        return
    if len(message_text) > MAX_MESSAGE_LEN:
        message_text = message_text[:MAX_MESSAGE_LEN] + "…"

    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        ticket = SupportTicket(
            user_id=user.id if user else None,
            telegram_id=tg_user.id,
            username=tg_user.username,
            kind=kind,
            message=message_text,
            status=TicketStatus.OPEN,
        )
        session.add(ticket)
        session.commit()
        ticket_id = ticket.id

    meta = _meta(kind)
    await update.message.reply_text(
        f"{meta['emoji']} *{meta['noun'].title()} #{ticket_id} received.*\n\n"
        "Our team can see it now and will follow up here in this chat. "
        f"You can check or add more anytime with /support.",
        parse_mode="Markdown",
    )


# --------------------------------------------------------------------------- #
# User entry points
# --------------------------------------------------------------------------- #


async def support_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /support — file immediately if text given, else ask for it."""
    return await _start_ticket(update, context, TicketKind.SUPPORT)


async def bug_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /bug — file immediately if text given, else ask for it."""
    return await _start_ticket(update, context, TicketKind.BUG)


async def _start_ticket(update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str) -> int:
    if not update.message:
        return ConversationHandler.END

    inline = " ".join(context.args) if context.args else ""
    if inline.strip():
        await _create_ticket(update, context, kind, inline)
        return ConversationHandler.END

    context.user_data["ticket_kind"] = kind
    meta = _meta(kind)
    await update.message.reply_text(
        f"{meta['emoji']} *Tell us what you {meta['verb']}.*\n\n"
        "Send your message in one reply and I'll open a "
        f"{meta['noun']}. Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return ASK_MESSAGE


async def receive_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Second step of the conversation: capture the free-text message."""
    if not update.message:
        return ConversationHandler.END
    kind = context.user_data.pop("ticket_kind", TicketKind.SUPPORT)
    await _create_ticket(update, context, kind, update.message.text or "")
    return ConversationHandler.END


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.pop("ticket_kind", None)
    if update.message:
        await update.message.reply_text("Cancelled. Nothing was filed.")
    return ConversationHandler.END


# --------------------------------------------------------------------------- #
# Admin triage
# --------------------------------------------------------------------------- #


async def tickets_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """List tickets. Default: active (open + in-progress). Filters: open, bug, support, all."""
    user = update.effective_user
    if not user or not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return

    arg = context.args[0].lower() if context.args else "active"

    with get_session() as session:
        q = session.query(SupportTicket)
        if arg in ("bug", "bugs"):
            q = q.filter(SupportTicket.kind == TicketKind.BUG).filter(
                SupportTicket.status.in_(TicketStatus.ACTIVE)
            )
        elif arg == "support":
            q = q.filter(SupportTicket.kind == TicketKind.SUPPORT).filter(
                SupportTicket.status.in_(TicketStatus.ACTIVE)
            )
        elif arg == "open":
            q = q.filter(SupportTicket.status == TicketStatus.OPEN)
        elif arg == "all":
            pass
        else:  # "active" / unknown -> active
            q = q.filter(SupportTicket.status.in_(TicketStatus.ACTIVE))

        tickets = q.order_by(SupportTicket.created_at.desc()).limit(20).all()

        if not tickets:
            await update.message.reply_text(f"No tickets matching '{arg}'.")
            return

        lines = [f"🎫 *Tickets ({arg})* — showing {len(tickets)}\n"]
        for t in tickets:
            meta = _meta(t.kind)
            handle = f"@{t.username}" if t.username else f"id:{t.telegram_id}"
            snippet = (t.message or "").replace("\n", " ")
            if len(snippet) > 60:
                snippet = snippet[:60] + "…"
            lines.append(f"{meta['emoji']} *#{t.id}* `{t.status}` — {handle}\n   {snippet}")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def ticket_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show a single ticket in full: /ticket <id>."""
    user = update.effective_user
    if not user or not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return

    ticket_id = _parse_id(context.args)
    if ticket_id is None:
        await update.message.reply_text("Usage: /ticket <id>")
        return

    with get_session() as session:
        t = session.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
        if not t:
            await update.message.reply_text(f"No ticket #{ticket_id}.")
            return
        meta = _meta(t.kind)
        handle = f"@{t.username}" if t.username else f"id:{t.telegram_id}"
        created = t.created_at.strftime("%Y-%m-%d %H:%M UTC") if t.created_at else "?"
        lines = [
            f"{meta['emoji']} *{meta['noun'].title()} #{t.id}*",
            f"Status: `{t.status}`  •  From: {handle} (`{t.telegram_id}`)",
            f"Opened: {created}",
            "",
            t.message or "",
        ]
        if t.admin_reply:
            lines += ["", f"_Last reply:_ {t.admin_reply}"]
        lines += [
            "",
            f"Reply: `/treply {t.id} <message>`  •  Close: `/tclose {t.id}`",
        ]

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def treply_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply to the reporter and mark in-progress: /treply <id> <message>."""
    user = update.effective_user
    if not user or not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return

    if not context.args or len(context.args) < 2:
        await update.message.reply_text("Usage: /treply <id> <message>")
        return
    ticket_id = _parse_id(context.args[:1])
    if ticket_id is None:
        await update.message.reply_text("Usage: /treply <id> <message>")
        return
    reply_text = " ".join(context.args[1:]).strip()

    with get_session() as session:
        t = session.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
        if not t:
            await update.message.reply_text(f"No ticket #{ticket_id}.")
            return
        target_chat = t.telegram_id
        kind = t.kind
        linear_issue_id = t.linear_issue_id
        t.admin_reply = reply_text
        t.handled_by = user.id
        if t.status == TicketStatus.OPEN:
            t.status = TicketStatus.IN_PROGRESS
        session.commit()

    meta = _meta(kind)
    delivered = True
    try:
        await context.bot.send_message(
            chat_id=target_chat,
            text=(f"{meta['emoji']} *Re: your {meta['noun']} #{ticket_id}*\n\n" f"{reply_text}"),
            parse_mode="Markdown",
        )
    except Exception as e:  # noqa: BLE001
        delivered = False
        logger.error("Failed to deliver reply for ticket #%s: %s", ticket_id, e)

    # Mirror the reply into Linear, best-effort.
    await add_linear_comment(linear_issue_id, f"Replied to user (in-progress):\n\n{reply_text}")

    status_line = (
        "✅ Sent" if delivered else "⚠️ Saved but DM failed (user may have blocked the bot)"
    )
    await update.message.reply_text(f"{status_line} — ticket #{ticket_id} marked in-progress.")


async def tclose_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Mark a ticket resolved: /tclose <id>."""
    user = update.effective_user
    if not user or not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return

    ticket_id = _parse_id(context.args)
    if ticket_id is None:
        await update.message.reply_text("Usage: /tclose <id>")
        return

    with get_session() as session:
        t = session.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
        if not t:
            await update.message.reply_text(f"No ticket #{ticket_id}.")
            return
        t.status = TicketStatus.RESOLVED
        t.handled_by = user.id
        t.resolved_at = datetime.utcnow()
        linear_issue_id = t.linear_issue_id
        session.commit()

    await add_linear_comment(linear_issue_id, f"Ticket resolved by admin {user.id}.")
    await update.message.reply_text(f"✅ Ticket #{ticket_id} marked resolved.")


def _parse_id(args) -> int | None:
    if not args:
        return None
    raw = args[0].lstrip("#")
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------- #
# Handler objects (registered in bot/main.py)
# --------------------------------------------------------------------------- #

support_conversation_handler = ConversationHandler(
    name="support_ticket",
    persistent=False,
    entry_points=[
        CommandHandler("support", support_command),
        CommandHandler("bug", bug_command),
    ],
    states={
        ASK_MESSAGE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_message),
        ],
    },
    fallbacks=[CommandHandler("cancel", cancel_command)],
    allow_reentry=True,
    per_chat=True,
)

tickets_handler = CommandHandler("tickets", tickets_command)
ticket_handler = CommandHandler("ticket", ticket_command)
treply_handler = CommandHandler("treply", treply_command)
tclose_handler = CommandHandler("tclose", tclose_command)
