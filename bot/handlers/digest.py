"""Handler for /digest command — toggle weekly portfolio digest on/off."""

import logging
from telegram import Update
from telegram.ext import ContextTypes, CommandHandler

from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


async def digest_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle the user's weekly portfolio digest subscription."""
    tg_user = update.effective_user
    if not tg_user:
        return

    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        if not user:
            await update.message.reply_text("Please use /start first to set up your account.")
            return

        user.weekly_digest = not user.weekly_digest
        session.commit()
        enabled = user.weekly_digest

    if enabled:
        await update.message.reply_text(
            "✅ *Weekly digest on.*\n\nYou'll receive a portfolio summary every 7 days.",
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text(
            "🔕 *Weekly digest off.*\n\nYou won't receive weekly summaries anymore.",
            parse_mode="Markdown",
        )


digest_handler = CommandHandler("digest", digest_command)
