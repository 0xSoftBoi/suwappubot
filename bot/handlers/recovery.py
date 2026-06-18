"""/recover — DKIM-email social recovery.

From a NEW Telegram account that lost access:
    /recover you@email.com   →  starts a time-locked recovery to this account.

From your existing account:
    /recover                 →  shows recovery setup + any in-flight request,
                                with a button to cancel a fraudulent one.

The approval email is DKIM-verified by bot/services/dkim_verifier; an email
worker calls social_recovery_service.submit_approval_email on receipt and, once
the time-lock elapses, finalize_recovery transfers the account.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.models.user import User
from bot.services.social_recovery import social_recovery_service
from database.db import get_session

logger = logging.getLogger(__name__)


def _instructions(req: dict) -> str:
    delay_h = round((req.get("delay_seconds") or 0) / 3600, 1)
    return (
        "🔑 *Account Recovery Started*\n\n"
        "To approve, send an email *from your recovery address* "
        f"(`{req['guardian_email']}`) with this code anywhere in the subject:\n\n"
        f"`{req['challenge']}`\n\n"
        "We verify the email's DKIM signature, so only a genuine message from "
        "your provider counts.\n\n"
        f"⏳ For your safety, recovery executes *{delay_h}h after approval* — the "
        "original owner can cancel during that window from their account with "
        "/recover."
    )


async def recover_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    tg_user = update.effective_user
    if not tg_user:
        return

    # `/recover <email>` — initiate from a new account.
    if context.args:
        email = context.args[0].strip().lower()
        req, msg = social_recovery_service.request_recovery(email, new_telegram_id=tg_user.id)
        if not req:
            await update.message.reply_text(f"❌ {msg}")
            return
        await update.message.reply_text(_instructions(req), parse_mode="Markdown")
        return

    # `/recover` — status for the current account.
    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        recovery_email = user.recovery_email if user else None
        user_id = user.id if user else None

    if not user_id:
        await update.message.reply_text(
            "To recover a lost account, run:\n`/recover your@recovery-email.com`\n\n"
            "from the new account, using the email you registered for recovery.",
            parse_mode="Markdown",
        )
        return

    active = social_recovery_service.get_active_request_for_user(user_id)
    if active:
        text = (
            "⚠️ *A recovery is in progress for your account.*\n\n"
            f"Status: *{active['status']}*\n"
            f"Transfer target (Telegram id): `{active['new_telegram_id']}`\n\n"
            "If this wasn't you, cancel it now — it will execute after the "
            "time-lock otherwise."
        )
        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "🛑 Cancel recovery", callback_data=f"recover_cancel_{active['id']}"
                    )
                ]
            ]
        )
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)
        return

    if recovery_email:
        local, sep, domain = recovery_email.partition("@")
        masked = (local[:3] + "***" + sep + domain) if sep else recovery_email
        await update.message.reply_text(
            f"🔑 *Account Recovery*\n\nRecovery email: `{masked}`\n"
            "No recovery is in progress. If you lose access, run "
            "`/recover <that email>` from your new account.",
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text(
            "🔑 *Account Recovery*\n\nYou haven't set a recovery email yet. "
            "Add one in /set so you can recover your account by email later.",
            parse_mode="Markdown",
        )


async def recover_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Cancel a recovery — only the original owner (current telegram_id) may."""
    query = update.callback_query
    await query.answer()
    try:
        request_id = int(query.data.rsplit("_", 1)[1])
    except (ValueError, IndexError):
        return

    tg_id = update.effective_user.id
    # Authorize: the caller must currently own the account being recovered.
    from bot.models.recovery import RecoveryRequest

    with get_session() as session:
        req = session.query(RecoveryRequest).filter(RecoveryRequest.id == request_id).first()
        if not req:
            await query.edit_message_text("Recovery request not found.")
            return
        owner = session.query(User).filter(User.id == req.user_id).first()
        if not owner or owner.telegram_id != tg_id:
            await query.answer("Only the account owner can cancel this.", show_alert=True)
            return

    ok, msg = social_recovery_service.cancel_recovery(request_id)
    await query.edit_message_text(f"{'✅' if ok else '❌'} {msg}")


recover_handler = CommandHandler("recover", recover_command)
recover_cancel_handler = CallbackQueryHandler(recover_cancel_callback, pattern="^recover_cancel_")
