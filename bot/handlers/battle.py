"""Telegram handler for /battle — Market Battle / Fun Trade.

Flow:
  /battle -> pick market (BTC/ETH/SOL) -> pick UP/DOWN -> pick stake ->
  pick duration -> (optional) pick backing -> confirm -> result.

Also exposes:
  battle_menu_callback_handler  — handles all ^battle_ callbacks outside the
                                   conversation (open battles list, result view).

Conventions mirror bot/handlers/perps.py.
"""

import logging
from decimal import Decimal, InvalidOperation
from datetime import timezone

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.services.battle_service import (
    battle_service,
    BATTLE_MARKETS,
    BATTLE_DURATIONS,
    BATTLE_MIN_STAKE_USD,
    BATTLE_MAX_STAKE_USD,
    PREDICTION_WIN_MULTIPLIER,
)

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------ #
#  Conversation states
# ------------------------------------------------------------------ #
(
    BATTLE_MARKET,
    BATTLE_DIRECTION,
    BATTLE_STAKE,
    BATTLE_DURATION,
    BATTLE_BACKING,
    BATTLE_CONFIRM,
) = range(6)


# ------------------------------------------------------------------ #
#  Helpers
# ------------------------------------------------------------------ #


def _market_display(market: str) -> str:
    """BTC-USD -> BTC"""
    return market.split("-")[0]


def _outcome_emoji(outcome: str) -> str:
    return {"win": "WIN", "loss": "LOSS", "void": "VOID"}.get(outcome, outcome.upper())


async def _reply_or_edit(update: Update, text: str, keyboard: list):
    """Edit if callback query, reply if command."""
    markup = InlineKeyboardMarkup(keyboard)
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=markup, parse_mode="Markdown"
        )
    else:
        await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")


# ------------------------------------------------------------------ #
#  Entry point
# ------------------------------------------------------------------ #


async def battle_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /battle — show market selection."""
    if update.callback_query:
        await update.callback_query.answer()

    keyboard = [
        [
            InlineKeyboardButton(f"{_market_display(m)}", callback_data=f"battle_market_{m}")
            for m in BATTLE_MARKETS
        ],
        [InlineKeyboardButton("My Battles", callback_data="battle_list")],
        [InlineKeyboardButton("Back", callback_data="main_menu")],
    ]
    await _reply_or_edit(
        update,
        "**Market Battle**\n\n"
        "Pick a market for your directional bet.\n"
        "One-tap UP or DOWN — settle in minutes.\n\n"
        "Select a market:",
        keyboard,
    )
    return BATTLE_MARKET


# ------------------------------------------------------------------ #
#  Market selection
# ------------------------------------------------------------------ #


async def battle_market_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    market = query.data.replace("battle_market_", "")
    if market not in BATTLE_MARKETS:
        await query.edit_message_text("Invalid market. Use /battle to restart.")
        return ConversationHandler.END

    context.user_data["battle_market"] = market

    try:
        from bot.services.hyperliquid_client import hyperliquid_client

        price = await hyperliquid_client.get_mark_price(market)
        price_str = f"${price:,.2f}" if price else "N/A"
    except Exception:
        price_str = "N/A"

    keyboard = [
        [
            InlineKeyboardButton("UP", callback_data="battle_dir_up"),
            InlineKeyboardButton("DOWN", callback_data="battle_dir_down"),
        ],
        [InlineKeyboardButton("Cancel", callback_data="battle_cancel")],
    ]
    await query.edit_message_text(
        f"**{_market_display(market)} — Market Battle**\n\n"
        f"Current price: {price_str}\n\n"
        f"Which direction do you bet?",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return BATTLE_DIRECTION


# ------------------------------------------------------------------ #
#  Direction selection
# ------------------------------------------------------------------ #


async def battle_direction_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    direction = query.data.replace("battle_dir_", "")
    if direction not in ("up", "down"):
        await query.edit_message_text("Invalid direction. Use /battle to restart.")
        return ConversationHandler.END

    context.user_data["battle_direction"] = direction
    dir_emoji = "UP" if direction == "up" else "DOWN"

    keyboard = [
        [
            InlineKeyboardButton("$5", callback_data="battle_stake_5"),
            InlineKeyboardButton("$10", callback_data="battle_stake_10"),
            InlineKeyboardButton("$25", callback_data="battle_stake_25"),
        ],
        [
            InlineKeyboardButton("$50", callback_data="battle_stake_50"),
            InlineKeyboardButton("$100", callback_data="battle_stake_100"),
            InlineKeyboardButton("Custom", callback_data="battle_stake_custom"),
        ],
        [InlineKeyboardButton("Back", callback_data="battle_back_market")],
    ]
    await query.edit_message_text(
        f"**{dir_emoji} bet on {_market_display(context.user_data['battle_market'])}**\n\n"
        f"Choose your stake (${float(BATTLE_MIN_STAKE_USD):.0f} – "
        f"${float(BATTLE_MAX_STAKE_USD):.0f} USD):",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return BATTLE_STAKE


# ------------------------------------------------------------------ #
#  Stake selection (buttons)
# ------------------------------------------------------------------ #


async def battle_stake_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    raw = query.data.replace("battle_stake_", "")
    if raw == "custom":
        await query.edit_message_text(
            "Enter your stake in USD (e.g. `15`):",
            parse_mode="Markdown",
        )
        return BATTLE_STAKE  # stay in stake state, wait for text

    try:
        stake = Decimal(raw)
    except InvalidOperation:
        await query.edit_message_text("Invalid stake. Use /battle to restart.")
        return ConversationHandler.END

    return await _proceed_to_duration(update, context, stake)


async def battle_stake_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle free-text stake entry."""
    raw = update.message.text.strip().replace("$", "").replace(",", "")
    try:
        stake = Decimal(raw)
    except InvalidOperation:
        await update.message.reply_text("Please enter a valid number, e.g. `25`.")
        return BATTLE_STAKE

    if stake < BATTLE_MIN_STAKE_USD:
        await update.message.reply_text(f"Minimum stake is ${float(BATTLE_MIN_STAKE_USD):.0f}.")
        return BATTLE_STAKE
    if stake > BATTLE_MAX_STAKE_USD:
        await update.message.reply_text(f"Maximum stake is ${float(BATTLE_MAX_STAKE_USD):.0f}.")
        return BATTLE_STAKE

    return await _proceed_to_duration(update, context, stake)


async def _proceed_to_duration(update: Update, context: ContextTypes.DEFAULT_TYPE, stake: Decimal):
    if stake < BATTLE_MIN_STAKE_USD or stake > BATTLE_MAX_STAKE_USD:
        msg = (
            f"Stake must be between ${float(BATTLE_MIN_STAKE_USD):.0f} and "
            f"${float(BATTLE_MAX_STAKE_USD):.0f}."
        )
        if update.callback_query:
            await update.callback_query.edit_message_text(msg)
        else:
            await update.message.reply_text(msg)
        return BATTLE_STAKE

    context.user_data["battle_stake"] = str(stake)

    keyboard = [
        [
            InlineKeyboardButton(label, callback_data=f"battle_dur_{minutes}")
            for label, minutes in BATTLE_DURATIONS.items()
        ],
        [InlineKeyboardButton("Back", callback_data="battle_back_dir")],
    ]
    text = f"**Stake: ${float(stake):,.2f}**\n\n" "How long should the battle run?"
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown"
        )
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown"
        )
    return BATTLE_DURATION


# ------------------------------------------------------------------ #
#  Duration selection
# ------------------------------------------------------------------ #


async def battle_duration_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    try:
        minutes = int(query.data.replace("battle_dur_", ""))
    except ValueError:
        await query.edit_message_text("Invalid duration. Use /battle to restart.")
        return ConversationHandler.END

    if minutes not in BATTLE_DURATIONS.values():
        await query.edit_message_text("Invalid duration. Use /battle to restart.")
        return ConversationHandler.END

    context.user_data["battle_duration"] = minutes

    keyboard = [
        [
            InlineKeyboardButton("Perps (real HyperLiquid)", callback_data="battle_back_perps"),
            InlineKeyboardButton("Prediction (simulated)", callback_data="battle_back_prediction"),
        ],
        [InlineKeyboardButton("Back", callback_data="battle_back_stake")],
    ]
    await query.edit_message_text(
        "**Choose backing**\n\n"
        "**Perps** — opens a real HyperLiquid position with leverage.\n"
        "  Requires a HyperLiquid account.\n\n"
        f"**Prediction** — settles against the oracle price.\n"
        f"  No exchange account needed. Win = {float(PREDICTION_WIN_MULTIPLIER):.1f}x stake.\n"
        f"  Stake is debited from your custodial balance at entry.",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return BATTLE_BACKING


# ------------------------------------------------------------------ #
#  Backing selection + confirm
# ------------------------------------------------------------------ #


async def battle_backing_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    raw = query.data.replace("battle_back_", "")
    if raw not in ("perps", "prediction"):
        await query.edit_message_text("Invalid backing. Use /battle to restart.")
        return ConversationHandler.END

    context.user_data["battle_backing"] = raw
    return await _show_confirm(update, context)


async def _show_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Render the confirmation card."""
    market = context.user_data.get("battle_market", "BTC-USD")
    direction = context.user_data.get("battle_direction", "up")
    stake = Decimal(context.user_data.get("battle_stake", "10"))
    minutes = context.user_data.get("battle_duration", 5)
    backing = context.user_data.get("battle_backing", "prediction")

    dir_label = "UP" if direction == "up" else "DOWN"
    dur_label = next((k for k, v in BATTLE_DURATIONS.items() if v == minutes), f"{minutes}m")
    payout_note = (
        f"{float(PREDICTION_WIN_MULTIPLIER):.1f}x stake on win (stake debited now)"
        if backing == "prediction"
        else "real PnL (2x leverage)"
    )

    try:
        from bot.services.hyperliquid_client import hyperliquid_client

        price = await hyperliquid_client.get_mark_price(market)
        price_str = f"${price:,.2f}" if price else "N/A"
    except Exception:
        price_str = "N/A"

    text = (
        f"**Confirm Battle**\n\n"
        f"Market:    {_market_display(market)}\n"
        f"Direction: {dir_label}\n"
        f"Stake:     ${float(stake):,.2f}\n"
        f"Duration:  {dur_label}\n"
        f"Backing:   {backing.title()}\n"
        f"Entry:     ~{price_str}\n"
        f"Payout:    {payout_note}\n\n"
        f"Ready to fight?"
    )
    keyboard = [
        [
            InlineKeyboardButton("Confirm", callback_data="battle_exec"),
            InlineKeyboardButton("Cancel", callback_data="battle_cancel"),
        ],
    ]
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown"
        )
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown"
        )
    return BATTLE_CONFIRM


# ------------------------------------------------------------------ #
#  Execution
# ------------------------------------------------------------------ #


async def battle_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Open the battle — triggered by 'Confirm' button."""
    query = update.callback_query
    await query.answer("Opening battle...")

    # All user_id references come from the authenticated Telegram update object,
    # never from callback data. MONEY-PATH: user_id bound to caller.
    user_id = query.from_user.id

    market = context.user_data.get("battle_market")
    direction = context.user_data.get("battle_direction")
    stake = Decimal(context.user_data.get("battle_stake", "0"))
    minutes = context.user_data.get("battle_duration", 5)
    backing = context.user_data.get("battle_backing", "prediction")

    if not market or not direction or stake <= 0:
        await query.edit_message_text("Missing battle parameters. Use /battle to restart.")
        return ConversationHandler.END

    try:
        battle = await battle_service.open_battle(
            user_id=user_id,
            market=market,
            direction=direction,
            stake_usd=stake,
            backing=backing,
            duration_minutes=minutes,
        )

        from datetime import timezone as _tz

        dur_label = next((k for k, v in BATTLE_DURATIONS.items() if v == minutes), f"{minutes}m")
        expiry_str = battle.expiry_at.replace(tzinfo=_tz.utc).strftime("%H:%M UTC")

        await query.edit_message_text(
            f"**Battle #{battle.id} opened!**\n\n"
            f"Market:    {_market_display(market)}\n"
            f"Direction: {'UP' if direction == 'up' else 'DOWN'}\n"
            f"Stake:     ${float(stake):,.2f}\n"
            f"Backing:   {backing.title()}\n"
            f"Entry:     ${float(battle.entry_price):,.2f}\n"
            f"Settles:   {expiry_str} ({dur_label})\n\n"
            f"Auto-settled at expiry. Use /battle to track.",
            parse_mode="Markdown",
        )
    except ValueError as e:
        await query.edit_message_text(f"Validation error: {e}")
    except Exception as e:
        logger.error("battle_execute error user=%s: %s", user_id, e, exc_info=True)
        await query.edit_message_text("Failed to open battle. Please try again later.")

    return ConversationHandler.END


# ------------------------------------------------------------------ #
#  Cancel / back callbacks
# ------------------------------------------------------------------ #


async def battle_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data.clear()
    await query.edit_message_text("Battle cancelled. Use /battle to start again.")
    return ConversationHandler.END


async def battle_back_market_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Go back to market selection."""
    return await battle_command(update, context)


async def battle_back_dir_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Go back to direction selection — re-trigger market callback."""
    query = update.callback_query
    await query.answer()
    market = context.user_data.get("battle_market", "BTC-USD")
    query.data = f"battle_market_{market}"
    return await battle_market_callback(update, context)


async def battle_back_stake_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Go back to stake selection."""
    query = update.callback_query
    await query.answer()
    direction = context.user_data.get("battle_direction", "up")
    query.data = f"battle_dir_{direction}"
    return await battle_direction_callback(update, context)


# ------------------------------------------------------------------ #
#  Battle list (open + recent)
# ------------------------------------------------------------------ #


async def battle_list_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show the user's open and recent settled battles."""
    query = update.callback_query
    await query.answer()

    # MONEY-PATH: user_id from authenticated Telegram object only.
    user_id = query.from_user.id
    open_battles = battle_service.get_user_battles(user_id, status="open", limit=5)
    recent = battle_service.get_user_battles(user_id, limit=10)

    lines = ["**My Battles**\n"]

    if open_battles:
        lines.append("**Open:**")
        for b in open_battles:
            exp = b.expiry_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            remaining = exp - __import__("datetime").datetime.now(timezone.utc)
            secs = max(0, int(remaining.total_seconds()))
            mins, s = divmod(secs, 60)
            time_str = f"{mins}m {s}s"
            lines.append(
                f"  #{b.id} {_market_display(b.market)} "
                f"{'UP' if b.direction == 'up' else 'DOWN'} "
                f"${float(b.stake_usd):.0f} — {time_str} left"
            )
        lines.append("")

    settled = [b for b in recent if b.status in ("settled", "voided")][:5]
    if settled:
        lines.append("**Recent results:**")
        for b in settled:
            pnl = float(b.pnl_usd or 0)
            sign = "+" if pnl >= 0 else ""
            lines.append(
                f"  #{b.id} {_market_display(b.market)} "
                f"{'UP' if b.direction == 'up' else 'DOWN'} "
                f"{_outcome_emoji(b.outcome or 'void')} {sign}${pnl:.2f}"
            )

    if not open_battles and not settled:
        lines.append("No battles yet. Use /battle to start!")

    keyboard = [[InlineKeyboardButton("New Battle", callback_data="battle_new")]]
    await query.edit_message_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return ConversationHandler.END


# ------------------------------------------------------------------ #
#  Handler registrations
# ------------------------------------------------------------------ #

battle_conversation_handler = ConversationHandler(
    entry_points=[
        CommandHandler("battle", battle_command),
        CallbackQueryHandler(battle_command, pattern="^battle_new$"),
    ],
    states={
        BATTLE_MARKET: [
            CallbackQueryHandler(battle_market_callback, pattern="^battle_market_"),
        ],
        BATTLE_DIRECTION: [
            CallbackQueryHandler(battle_direction_callback, pattern="^battle_dir_"),
            CallbackQueryHandler(battle_back_market_callback, pattern="^battle_back_market$"),
            CallbackQueryHandler(battle_cancel_callback, pattern="^battle_cancel$"),
        ],
        BATTLE_STAKE: [
            CallbackQueryHandler(battle_stake_callback, pattern="^battle_stake_"),
            CallbackQueryHandler(battle_back_dir_callback, pattern="^battle_back_dir$"),
            CallbackQueryHandler(battle_cancel_callback, pattern="^battle_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, battle_stake_text),
        ],
        BATTLE_DURATION: [
            CallbackQueryHandler(battle_duration_callback, pattern="^battle_dur_"),
            CallbackQueryHandler(battle_back_stake_callback, pattern="^battle_back_stake$"),
            CallbackQueryHandler(battle_cancel_callback, pattern="^battle_cancel$"),
        ],
        BATTLE_BACKING: [
            CallbackQueryHandler(
                battle_backing_callback, pattern="^battle_back_(perps|prediction)$"
            ),
            CallbackQueryHandler(battle_back_stake_callback, pattern="^battle_back_stake$"),
            CallbackQueryHandler(battle_cancel_callback, pattern="^battle_cancel$"),
        ],
        BATTLE_CONFIRM: [
            CallbackQueryHandler(battle_execute_callback, pattern="^battle_exec$"),
            CallbackQueryHandler(battle_cancel_callback, pattern="^battle_cancel$"),
        ],
    },
    fallbacks=[
        CommandHandler("battle", battle_command),
        CallbackQueryHandler(battle_cancel_callback, pattern="^battle_cancel$"),
    ],
    name="battle_conversation",
    persistent=False,
)

# Standalone callback handler for the battle list (outside the conversation).
battle_menu_callback_handler = CallbackQueryHandler(battle_list_callback, pattern="^battle_list$")
