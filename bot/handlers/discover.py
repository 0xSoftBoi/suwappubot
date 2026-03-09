"""Token discovery handler - trending tokens, gainers, new pools, smart money."""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CallbackQueryHandler, CommandHandler

from bot.services.token_discovery import discovery_service

logger = logging.getLogger(__name__)


async def discover_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /discover command - show token discovery menu."""
    text = (
        "\U0001f50d *Token Discovery*\n\n"
        "Find your next trade:"
    )

    keyboard = [
        [
            InlineKeyboardButton("\U0001f525 Trending", callback_data="discover_trending"),
            InlineKeyboardButton("\U0001f4c8 Top Gainers", callback_data="discover_gainers"),
        ],
        [
            InlineKeyboardButton("\U0001f4c9 Top Losers", callback_data="discover_losers"),
            InlineKeyboardButton("\U0001f195 New Pools", callback_data="discover_new_pools"),
        ],
        [
            InlineKeyboardButton("\U0001f9e0 Smart Money", callback_data="discover_smart_money"),
        ],
        [InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="main_menu")],
    ]

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )


async def discover_trending_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show trending tokens."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text("\u23f3 Loading trending tokens...")

    tokens = await discovery_service.get_trending(limit=10)
    text = discovery_service.format_discovery_message(tokens, "\U0001f525 Trending Tokens")

    keyboard = _build_token_keyboard(tokens)
    keyboard.append([InlineKeyboardButton("\U0001f504 Refresh", callback_data="discover_trending")])
    keyboard.append([InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="discover_menu")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def discover_gainers_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show top gainers."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text("\u23f3 Loading top gainers...")

    tokens = await discovery_service.get_top_gainers(limit=10)
    text = discovery_service.format_discovery_message(tokens, "\U0001f4c8 Top Gainers (24h)")

    keyboard = _build_token_keyboard(tokens)
    keyboard.append([InlineKeyboardButton("\U0001f504 Refresh", callback_data="discover_gainers")])
    keyboard.append([InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="discover_menu")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def discover_losers_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show top losers."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text("\u23f3 Loading top losers...")

    tokens = await discovery_service.get_top_losers(limit=10)
    text = discovery_service.format_discovery_message(tokens, "\U0001f4c9 Top Losers (24h)")

    keyboard = _build_token_keyboard(tokens)
    keyboard.append([InlineKeyboardButton("\U0001f504 Refresh", callback_data="discover_losers")])
    keyboard.append([InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="discover_menu")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def discover_new_pools_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show new pools/launches."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text("\u23f3 Loading new pools...")

    tokens = await discovery_service.get_new_pools(limit=10)

    if tokens:
        lines = ["*\U0001f195 New Pools*\n"]
        for i, t in enumerate(tokens, 1):
            age = f"{t.age_hours:.0f}h" if t.age_hours else "new"
            liq = f"${t.liquidity_usd:,.0f}" if t.liquidity_usd else "?"
            lines.append(f"{i}. *{t.symbol}* - {t.name[:20]} ({age} old, {liq} liq)")
        text = "\n".join(lines)
    else:
        text = "*\U0001f195 New Pools*\n\n_No recent launches detected._"

    keyboard = [
        [InlineKeyboardButton("\U0001f504 Refresh", callback_data="discover_new_pools")],
        [InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="discover_menu")],
    ]

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def discover_smart_money_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show smart money activity."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text("\u23f3 Loading smart money activity...")

    tokens = await discovery_service.get_smart_money_buys(limit=10)
    text = discovery_service.format_discovery_message(tokens, "\U0001f9e0 Smart Money Buys")

    keyboard = _build_token_keyboard(tokens)
    keyboard.append([InlineKeyboardButton("\U0001f504 Refresh", callback_data="discover_smart_money")])
    keyboard.append([InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="discover_menu")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


def _build_token_keyboard(tokens, max_buttons: int = 5) -> list:
    """Build inline keyboard with buy buttons for top tokens."""
    keyboard = []
    row = []
    for token in tokens[:max_buttons]:
        row.append(
            InlineKeyboardButton(
                f"Buy {token.symbol}",
                callback_data=f"qb_token_{token.chain}_{token.symbol}",
            )
        )
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    return keyboard


discover_handler = CommandHandler("discover", discover_command)

discover_callbacks = [
    CallbackQueryHandler(discover_command, pattern="^discover_menu$"),
    CallbackQueryHandler(discover_trending_callback, pattern="^discover_trending$"),
    CallbackQueryHandler(discover_gainers_callback, pattern="^discover_gainers$"),
    CallbackQueryHandler(discover_losers_callback, pattern="^discover_losers$"),
    CallbackQueryHandler(discover_new_pools_callback, pattern="^discover_new_pools$"),
    CallbackQueryHandler(discover_smart_money_callback, pattern="^discover_smart_money$"),
]
