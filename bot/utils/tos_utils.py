"""Utilities for enforcing Terms of Service acceptance."""

import functools
from telegram import Update
from telegram.ext import ContextTypes

from bot.services.tos_service import tos_service, TOS_TEXT
from bot.utils.templates import TOS_KEYBOARD

def enforce_tos(func):
    """Decorator to check if user has accepted TOS before executing a handler."""
    @functools.wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        user = update.effective_user
        if not user:
            return await func(update, context, *args, **kwargs)
            
        if not tos_service.is_accepted_telegram(user.id):
            message_text = (
                "⚠️ *Terms of Service Required*\n\n"
                "Before using Suwappu Bot, you must read and accept our Terms of Service\\.\n\n"
                "Please use /start to review and accept the terms\\."
            )
            
            if update.callback_query:
                await update.callback_query.answer("Please accept TOS first!", show_alert=True)
                await update.callback_query.edit_message_text(
                    TOS_TEXT,
                    parse_mode="Markdown",
                    reply_markup=TOS_KEYBOARD
                )
            elif update.message:
                await update.message.reply_text(
                    TOS_TEXT,
                    parse_mode="Markdown",
                    reply_markup=TOS_KEYBOARD
                )
            return
            
        return await func(update, context, *args, **kwargs)
    return wrapper

