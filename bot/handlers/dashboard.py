"""Dashboard command handler for opening the Telegram Mini App."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ContextTypes, CommandHandler

from bot.config.settings import settings


async def dashboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /dashboard command - opens the Mini App.

    This provides an inline way to open the dashboard webapp,
    as an alternative to the menu button.
    """
    keyboard = [
        [
            InlineKeyboardButton(
                text="📊 Open Dashboard", web_app=WebAppInfo(url=settings.webapp_url)
            )
        ]
    ]

    await update.message.reply_text(
        "🌸 *Suwappu Dashboard*\n\n"
        "View your portfolio and swap history in the Mini App.\n\n"
        "Tap the button below to open:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def dashboard_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle dashboard menu callback."""
    query = update.callback_query
    await query.answer()

    keyboard = [
        [
            InlineKeyboardButton(
                text="📊 Open Dashboard", web_app=WebAppInfo(url=settings.webapp_url)
            )
        ],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await query.edit_message_text(
        "🌸 *Suwappu Dashboard*\n\n"
        "View your portfolio and swap history in the Mini App.\n\n"
        "Tap the button below to open:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Export the handler
dashboard_handler = CommandHandler("dashboard", dashboard_command)
