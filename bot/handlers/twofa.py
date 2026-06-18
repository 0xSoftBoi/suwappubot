"""/2fa — enroll, verify, and disable TOTP two-factor auth for large swaps."""

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User
from bot.services.spending_limits import spending_limit_service
from bot.services.twofa import twofa_service
from database.db import get_session

logger = logging.getLogger(__name__)

TWOFA_MENU, TWOFA_ENROLL_CODE, TWOFA_DISABLE_CODE = range(3)

MAX_CODE_ATTEMPTS = 3


def _resolve_user_id(update: Update) -> int:
    """Map the Telegram user to our DB user id (None if not registered)."""
    tg_user = update.effective_user
    if not tg_user:
        return None
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        return db_user.id if db_user else None


async def twofa_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show 2FA status and enable/disable actions."""
    user_id = _resolve_user_id(update)
    if not user_id:
        await update.message.reply_text("❌ Please /start the bot first.")
        return ConversationHandler.END

    context.user_data["twofa_user_id"] = user_id
    enabled = twofa_service.is_2fa_enabled(user_id)

    if enabled:
        threshold = spending_limit_service.effective_2fa_threshold(user_id)
        text = (
            "🔐 *Two-Factor Authentication*\n\n"
            "Status: ✅ *Enabled*\n"
            f"Required for swaps at/above: *${threshold:,.0f}*\n\n"
            "_Change the threshold via /set → Limits._"
        )
        keyboard = [
            [InlineKeyboardButton("🚫 Disable 2FA", callback_data="twofa_disable")],
            [InlineKeyboardButton("✖️ Close", callback_data="twofa_close")],
        ]
    else:
        text = (
            "🔐 *Two-Factor Authentication*\n\n"
            "Status: ❌ *Disabled*\n\n"
            "Enable 2FA to require a 6-digit authenticator code "
            "(Google Authenticator, Authy, 1Password, ...) before large swaps execute."
        )
        keyboard = [
            [InlineKeyboardButton("✅ Enable 2FA", callback_data="twofa_enable")],
            [InlineKeyboardButton("✖️ Close", callback_data="twofa_close")],
        ]

    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return TWOFA_MENU


async def twofa_enable_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start enrollment: generate a secret and ask for a confirmation code."""
    query = update.callback_query
    await query.answer()

    user_id = context.user_data.get("twofa_user_id")
    if not user_id:
        await query.edit_message_text("❌ Session expired. Run /2fa again.")
        return ConversationHandler.END

    try:
        secret, uri = twofa_service.begin_enrollment(user_id)
    except ValueError as e:
        await query.edit_message_text(f"❌ {e}")
        return ConversationHandler.END

    context.user_data["twofa_attempts"] = 0
    msg = await query.edit_message_text(
        "🔐 *Set up your authenticator*\n\n"
        "1. Add this secret to your authenticator app:\n"
        f"`{secret}`\n\n"
        "or open this link on a device with the app installed:\n"
        f"`{uri}`\n\n"
        "2. Then send me the 6-digit code it shows.\n\n"
        "⚠️ _This message self-destructs once 2FA is activated — save the "
        "secret in your authenticator first._",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="twofa_close")]]
        ),
    )
    # Remember the secret message so it can be deleted after activation.
    context.user_data["twofa_secret_msg_id"] = getattr(msg, "message_id", None)
    return TWOFA_ENROLL_CODE


async def twofa_enroll_code(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the first code and activate 2FA."""
    user_id = context.user_data.get("twofa_user_id")
    if not user_id:
        await update.message.reply_text("❌ Session expired. Run /2fa again.")
        return ConversationHandler.END

    code = (update.message.text or "").strip()
    if not twofa_service.confirm_enrollment(user_id, code):
        attempts = context.user_data.get("twofa_attempts", 0) + 1
        context.user_data["twofa_attempts"] = attempts
        if attempts >= MAX_CODE_ATTEMPTS:
            await update.message.reply_text(
                "🚫 Too many invalid codes. 2FA was NOT enabled — run /2fa to retry."
            )
            return ConversationHandler.END
        await update.message.reply_text(
            f"❌ Invalid code. {MAX_CODE_ATTEMPTS - attempts} attempt(s) left — try again:"
        )
        return TWOFA_ENROLL_CODE

    # Best-effort cleanup of the message containing the raw secret.
    secret_msg_id = context.user_data.pop("twofa_secret_msg_id", None)
    if secret_msg_id and update.effective_chat:
        try:
            await context.bot.delete_message(
                chat_id=update.effective_chat.id, message_id=secret_msg_id
            )
        except Exception as e:
            logger.debug(f"Could not delete 2FA secret message: {e}")

    threshold = spending_limit_service.effective_2fa_threshold(user_id)
    await update.message.reply_text(
        "✅ *2FA enabled!*\n\n"
        f"Swaps at/above *${threshold:,.0f}* now require an authenticator code.\n"
        "_Change the threshold via /set → Limits._",
        parse_mode="Markdown",
    )
    return ConversationHandler.END


async def twofa_disable_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Ask for a code before disabling."""
    query = update.callback_query
    await query.answer()

    context.user_data["twofa_attempts"] = 0
    await query.edit_message_text(
        "🔐 To disable 2FA, enter the current 6-digit code from your authenticator app:",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="twofa_close")]]
        ),
    )
    return TWOFA_DISABLE_CODE


async def twofa_disable_code(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the code and disable 2FA."""
    user_id = context.user_data.get("twofa_user_id")
    if not user_id:
        await update.message.reply_text("❌ Session expired. Run /2fa again.")
        return ConversationHandler.END

    code = (update.message.text or "").strip()
    if not twofa_service.disable_2fa(user_id, code):
        attempts = context.user_data.get("twofa_attempts", 0) + 1
        context.user_data["twofa_attempts"] = attempts
        if attempts >= MAX_CODE_ATTEMPTS:
            await update.message.reply_text("🚫 Too many invalid codes. 2FA stays enabled.")
            return ConversationHandler.END
        await update.message.reply_text(
            f"❌ Invalid code. {MAX_CODE_ATTEMPTS - attempts} attempt(s) left — try again:"
        )
        return TWOFA_DISABLE_CODE

    await update.message.reply_text("✅ 2FA disabled. Re-enable any time with /2fa.")
    return ConversationHandler.END


async def twofa_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Close the 2FA menu."""
    query = update.callback_query
    if query:
        await query.answer()
        await query.edit_message_text("🔐 2FA menu closed. Run /2fa to reopen.")
    return ConversationHandler.END


twofa_conversation = ConversationHandler(
    name="twofa",
    persistent=True,
    entry_points=[CommandHandler("2fa", twofa_command)],
    states={
        TWOFA_MENU: [
            CallbackQueryHandler(twofa_enable_callback, pattern="^twofa_enable$"),
            CallbackQueryHandler(twofa_disable_callback, pattern="^twofa_disable$"),
        ],
        TWOFA_ENROLL_CODE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, twofa_enroll_code),
        ],
        TWOFA_DISABLE_CODE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, twofa_disable_code),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(twofa_close_callback, pattern="^twofa_close$"),
        CommandHandler("cancel", twofa_close_callback),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)
