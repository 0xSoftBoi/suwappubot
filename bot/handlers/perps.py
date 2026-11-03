"""Telegram handler for perpetual trading commands."""

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

from bot.services.perps_service import perps_service
from bot.services.hyperliquid_client import hyperliquid_client
from bot.utils.region_gate import derivatives_region_allowed, derivatives_blocked_message
from bot.utils.telegram_safe import safe_md, send_md_safe

logger = logging.getLogger(__name__)

# Conversation states
PERPS_MENU, PERPS_MARKET, PERPS_SIDE, PERPS_AMOUNT, PERPS_LEVERAGE, PERPS_CONFIRM = range(6)
PERPS_SETUP_KEY, PERPS_SETUP_SECRET = range(10, 12)
PERPS_TPSL_INPUT = 20  # Text input state for TP/SL price entry


async def _send_perps(update: Update, text: str, keyboard: list):
    """Render perps output whether invoked from a command or a callback query.

    On a callback update ``update.message`` is None, so the original code's
    ``update.message.reply_text`` raised AttributeError when Back/Cancel routed
    through perps_command. This edits the message for callbacks, replies for
    commands.
    """
    markup = InlineKeyboardMarkup(keyboard)
    if update.callback_query is not None:
        await update.callback_query.edit_message_text(
            text,
            reply_markup=markup,
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text(
            text,
            reply_markup=markup,
            parse_mode="Markdown",
        )


async def perps_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /perps command or the 'perps_open' menu button — show perps menu."""
    if update.callback_query:
        await update.callback_query.answer()
    if not derivatives_region_allowed(update.effective_user.id):
        await update.effective_message.reply_text(derivatives_blocked_message())
        return ConversationHandler.END
    account = perps_service.get_account(update.effective_user.id)

    if not account:
        keyboard = [
            [
                InlineKeyboardButton(
                    "\U0001f511 Setup HyperLiquid Account", callback_data="perps_setup"
                )
            ],
            [
                InlineKeyboardButton(
                    "\u2139\ufe0f What is Perps Trading?", callback_data="perps_info"
                )
            ],
            [InlineKeyboardButton("\U0001f519 Back", callback_data="main_menu")],
        ]
        await _send_perps(
            update,
            "\U0001f4ca **Perpetual Trading**\n\n"
            "Trade perpetual futures with up to 100x leverage on HyperLiquid (per-market limit).\n\n"
            "To get started, set up your HyperLiquid account first.",
            keyboard,
        )
        return PERPS_MENU

    # Show positions and trading menu
    positions = await perps_service.get_positions(update.effective_user.id)

    text = "\U0001f4ca **Perpetual Trading**\n\n"

    if positions:
        text += "**Open Positions:**\n"
        for pos in positions:
            pnl = float(pos.unrealized_pnl or 0)
            pnl_emoji = "\U0001f7e2" if pnl >= 0 else "\U0001f534"
            text += (
                f"{pnl_emoji} {pos.market} {pos.side.upper()} {pos.leverage}x\n"
                f"   Size: {float(pos.size):.4f} | Entry: ${float(pos.entry_price):,.2f}\n"
                f"   PnL: ${pnl:,.2f}\n"
            )
        text += "\n"
    else:
        text += "No open positions.\n\n"

    keyboard = [
        [
            InlineKeyboardButton("\U0001f4c8 Open Long", callback_data="perps_long"),
            InlineKeyboardButton("\U0001f4c9 Open Short", callback_data="perps_short"),
        ],
        [InlineKeyboardButton("\U0001f4cb My Positions", callback_data="perps_positions")],
        [InlineKeyboardButton("\U0001f4b0 Deposit / Fund", callback_data="fund_menu")],
        [InlineKeyboardButton("\U0001f4dc Order History", callback_data="perps_history")],
        [InlineKeyboardButton("\u2699\ufe0f Account Settings", callback_data="perps_settings")],
        [InlineKeyboardButton("\U0001f519 Back", callback_data="main_menu")],
    ]

    await update.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return PERPS_MENU


async def perps_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle perps menu callbacks."""
    query = update.callback_query
    await query.answer()
    if not derivatives_region_allowed(update.effective_user.id):
        await query.edit_message_text(derivatives_blocked_message())
        return ConversationHandler.END
    data = query.data

    if data == "perps_setup":
        await query.edit_message_text(
            "\U0001f511 **HyperLiquid Account Setup**\n\n"
            "To connect your HyperLiquid account:\n"
            "1. Go to app.hyperliquid.xyz\n"
            "2. Create an API key\n"
            "3. Send your API key below\n\n"
            "Your credentials are encrypted and stored securely.",
            parse_mode="Markdown",
        )
        return PERPS_SETUP_KEY

    elif data == "perps_info":
        await query.edit_message_text(
            "\u2139\ufe0f **What is Perps Trading?**\n\n"
            "Perpetual futures let you trade with leverage \u2014 "
            "amplifying gains (and losses) without expiration dates.\n\n"
            "**Key Terms:**\n"
            "\u2022 **Long** \u2014 Profit when price goes up\n"
            "\u2022 **Short** \u2014 Profit when price goes down\n"
            "\u2022 **Leverage** \u2014 Multiplier (1x up to per-market max on HyperLiquid)\n"
            "\u2022 **Liquidation** \u2014 Position auto-closed if losses exceed margin\n"
            "\u2022 **TP/SL** \u2014 Auto-close at profit target or loss limit\n\n"
            "\u26a0\ufe0f Higher leverage = higher risk. Start small!",
            parse_mode="Markdown",
        )
        return PERPS_MENU

    elif data in ("perps_long", "perps_short"):
        context.user_data["perps_side"] = "long" if data == "perps_long" else "short"

        # Show market selection
        markets = list(hyperliquid_client.MARKETS.keys())
        keyboard = []
        row = []
        for market in markets:
            row.append(InlineKeyboardButton(market, callback_data=f"perps_market_{market}"))
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
        keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="perps_back")])

        side = context.user_data["perps_side"]
        side_emoji = "\U0001f4c8" if side == "long" else "\U0001f4c9"
        await query.edit_message_text(
            f"{side_emoji} **Open {side.title()} Position**\n\n" "Select a market:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return PERPS_MARKET

    elif data == "perps_positions":
        positions = await perps_service.get_positions(query.from_user.id)

        if not positions:
            await query.edit_message_text("No open positions.")
            return PERPS_MENU

        text = "\U0001f4cb **Open Positions**\n\n"
        keyboard = []

        for pos in positions:
            pnl = float(pos.unrealized_pnl or 0)
            pnl_emoji = "\U0001f7e2" if pnl >= 0 else "\U0001f534"
            text += (
                f"{pnl_emoji} **{pos.market}** {pos.side.upper()} {pos.leverage}x\n"
                f"   Size: {float(pos.size):.4f} | Entry: ${float(pos.entry_price):,.2f}\n"
                f"   Mark: ${float(pos.mark_price or 0):,.2f} | PnL: ${pnl:,.2f}\n"
            )
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"Close {pos.market}", callback_data=f"perps_close_{pos.id}"
                    ),
                    InlineKeyboardButton("TP/SL", callback_data=f"perps_tpsl_{pos.id}"),
                ]
            )

        keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="perps_back")])

        await query.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return PERPS_MENU

    elif data == "perps_back":
        # Redirect to perps menu
        return await perps_command(update, context)

    return PERPS_MENU


async def perps_market_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle market selection."""
    query = update.callback_query
    await query.answer()

    market = query.data.replace("perps_market_", "")
    context.user_data["perps_market"] = market

    # Get current price
    price = await hyperliquid_client.get_mark_price(market)
    price_str = f"${price:,.2f}" if price else "N/A"

    side = context.user_data.get("perps_side", "long")
    side_emoji = "\U0001f4c8" if side == "long" else "\U0001f4c9"

    await query.edit_message_text(
        f"{side_emoji} **{side.title()} {market}**\n\n"
        f"Current Price: {price_str}\n\n"
        f"Enter the position size (in USD):\n"
        f"Example: `100` for $100",
        parse_mode="Markdown",
    )
    return PERPS_AMOUNT


async def perps_amount_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle amount input."""
    try:
        amount = float(update.message.text.strip().replace("$", "").replace(",", ""))
        if amount < perps_service.MIN_MARGIN_USD:
            await update.message.reply_text(
                f"Minimum position size is ${perps_service.MIN_MARGIN_USD:.0f}"
            )
            return PERPS_AMOUNT

        context.user_data["perps_amount"] = amount

        # Fetch the per-market max leverage from HyperLiquid's meta so the
        # button grid reflects the real exchange cap. Use the same fallback
        # constant that execution enforces (perps_service.FALLBACK_MAX_LEVERAGE)
        # so a meta outage can never offer a leverage button the order path
        # will then reject.
        market = context.user_data.get("perps_market", "ETH-USD")
        asset = market.split("-")[0] if "-" in market else market
        try:
            from bot.services.hyperliquid_client import hyperliquid_client as _hl_client

            market_max_lev = await _hl_client.get_market_max_leverage(
                asset, perps_service.FALLBACK_MAX_LEVERAGE
            )
        except Exception:
            market_max_lev = perps_service.FALLBACK_MAX_LEVERAGE

        # Build leverage options that span from conservative to the market maximum.
        # Include fixed steps and the market max so users always see the ceiling.
        base_options = [1, 2, 3, 5, 10, 15, 20, 25, 50, 75]
        leverage_options = sorted(set(o for o in base_options if o <= market_max_lev))
        if market_max_lev not in leverage_options:
            leverage_options.append(market_max_lev)

        keyboard = []
        row = []
        for lev in leverage_options:
            row.append(InlineKeyboardButton(f"{lev}x", callback_data=f"perps_lev_{lev}"))
            if len(row) == 4:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)

        await update.message.reply_text(
            f"\U0001f4aa **Select Leverage**\n\n"
            f"Position margin: ${amount:,.0f}\n"
            f"Market max: **{market_max_lev}x** (HyperLiquid)\n\n"
            f"\u26a0\ufe0f Higher leverage = higher risk of liquidation",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return PERPS_LEVERAGE

    except ValueError:
        await update.message.reply_text("Please enter a valid number.")
        return PERPS_AMOUNT


async def perps_leverage_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle leverage selection."""
    query = update.callback_query
    await query.answer()

    try:
        leverage = int(query.data.replace("perps_lev_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid leverage.")
        return PERPS_MENU
    context.user_data["perps_leverage"] = leverage

    market = context.user_data.get("perps_market", "ETH-USD")
    side = context.user_data.get("perps_side", "long")
    amount = context.user_data.get("perps_amount", 0)

    price = await hyperliquid_client.get_mark_price(market)
    size = (amount * leverage) / price if price else 0
    liq_estimate = (
        price * (1 - 1 / leverage) if side == "long" else price * (1 + 1 / leverage) if price else 0
    )
    liq_distance_pct = (abs(price - liq_estimate) / price * 100) if price else 0

    keyboard = [
        [
            InlineKeyboardButton("\u2705 Confirm", callback_data="perps_exec"),
            InlineKeyboardButton("\u274c Cancel", callback_data="perps_back"),
        ],
    ]

    # Build the confirm message with risk detail proportional to leverage chosen.
    confirm_text = (
        f"\U0001f4ca **Confirm Position**\n\n"
        f"Market: **{market}**\n"
        f"Side: **{side.upper()}**\n"
        f"Size: **{size:.4f}** ({amount:,.0f} USD \u00d7 {leverage}x)\n"
        f"Leverage: **{leverage}x**\n"
        f"Entry Price: ~${price:,.2f}\n"
        f"Est. Liquidation: ~${liq_estimate:,.2f} "
        f"({liq_distance_pct:.1f}% from entry)\n\n"
        f"\u26a0\ufe0f You can lose up to ${amount:,.0f} (your full margin)"
    )

    # High-leverage additional warning (>25x): quantify how little the price
    # needs to move before the position is liquidated.
    if leverage > 25:
        confirm_text += (
            f"\n\n\U0001f6a8 **HIGH LEVERAGE WARNING**\n"
            f"At {leverage}x, a {liq_distance_pct:.1f}% adverse move "
            f"liquidates your entire margin (${amount:,.0f}).\n"
            f"Ensure you have a stop-loss or can absorb full loss."
        )

    await query.edit_message_text(
        confirm_text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return PERPS_CONFIRM


async def perps_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Execute the perps trade."""
    query = update.callback_query
    await query.answer("Opening position...")

    market = context.user_data.get("perps_market")
    side = context.user_data.get("perps_side")
    amount = context.user_data.get("perps_amount", 0)
    leverage = context.user_data.get("perps_leverage", 1)

    price = await hyperliquid_client.get_mark_price(market)
    size = (amount * leverage) / price if price else 0

    try:
        position = await perps_service.open_position(
            user_id=query.from_user.id,
            market=market,
            side=side,
            size=size,
            leverage=leverage,
        )

        if position:
            await query.edit_message_text(
                f"\u2705 **Position Opened!**\n\n"
                f"Market: {market} {side.upper()} {leverage}x\n"
                f"Size: {size:.4f}\n"
                f"Entry: ${float(position.entry_price):,.2f}\n\n"
                f"Use /perps to manage your positions.",
                parse_mode="Markdown",
            )
        else:
            await query.edit_message_text("\u274c Failed to open position. Please try again.")
    except Exception as e:
        logger.error(f"Error in perps_confirm_position: {e}", exc_info=True)
        await query.edit_message_text("\u274c An unexpected error occurred. Please try again.")

    return ConversationHandler.END


async def perps_setup_key(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle API key input during setup."""
    api_key = update.message.text.strip()
    context.user_data["hl_api_key"] = api_key

    await update.message.reply_text(
        "Now send your API secret:",
    )
    # Delete the message with API key for security
    try:
        await update.message.delete()
    except Exception:
        pass

    return PERPS_SETUP_SECRET


async def perps_setup_secret(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle API secret input and complete setup."""
    api_secret = update.message.text.strip()
    api_key = context.user_data.get("hl_api_key", "")

    # Delete the message with secret
    try:
        await update.message.delete()
    except Exception:
        pass

    try:
        from bot.utils.encryption import encrypt_private_key
        from bot.config.settings import settings

        key = settings.encryption_key
        encrypted_key = encrypt_private_key(api_key, key)
        encrypted_secret = encrypt_private_key(api_secret, key)

        # Derive the HyperLiquid account address from the private key (api_secret).
        # Required for position sync / monitoring: clearinghouseState is keyed by
        # address. Without it, get_open_positions("") and the perps monitor are
        # no-ops for every user.
        hl_address = ""
        try:
            from eth_account import Account

            hl_address = Account.from_key(api_secret).address
        except Exception as e:
            logger.warning(f"Could not derive HL address from key: {e}")

        account = perps_service.setup_account(  # noqa: F841
            user_id=update.effective_user.id,
            hl_address=hl_address,
            api_key_encrypted=encrypted_key,
            api_secret_encrypted=encrypted_secret,
        )

        await update.message.reply_text(
            "\u2705 **HyperLiquid Account Connected!**\n\n"
            "You can now trade perpetual futures.\n"
            "Use /perps to get started.",
            parse_mode="Markdown",
        )
    except Exception as e:
        await update.message.reply_text(f"\u274c Setup failed: {str(e)}")

    # Clean up
    context.user_data.pop("hl_api_key", None)
    return ConversationHandler.END


async def perps_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle position close."""
    query = update.callback_query
    await query.answer()

    try:
        position_id = int(query.data.replace("perps_close_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid position.")
        return PERPS_MENU

    keyboard = [
        [
            InlineKeyboardButton("25%", callback_data=f"perps_closeamt_{position_id}_25"),
            InlineKeyboardButton("50%", callback_data=f"perps_closeamt_{position_id}_50"),
            InlineKeyboardButton("75%", callback_data=f"perps_closeamt_{position_id}_75"),
            InlineKeyboardButton("100%", callback_data=f"perps_closeamt_{position_id}_100"),
        ],
        [InlineKeyboardButton("\U0001f519 Back", callback_data="perps_positions")],
    ]

    await query.edit_message_text(
        "How much of the position do you want to close?",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return PERPS_MENU


async def perps_close_amount_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Execute position close."""
    query = update.callback_query
    await query.answer("Closing position...")

    try:
        parts = query.data.replace("perps_closeamt_", "").split("_")
        position_id = int(parts[0])
        percent = float(parts[1])
    except (IndexError, ValueError):
        await query.edit_message_text("❌ Invalid action. Please try again.")
        return PERPS_MENU

    try:
        result = await perps_service.close_position(
            user_id=query.from_user.id,
            position_id=position_id,
            percent=percent,
        )

        if result:
            pnl = result["pnl"]
            pnl_emoji = "\U0001f7e2" if pnl >= 0 else "\U0001f534"
            await query.edit_message_text(
                f"\u2705 **Position Closed ({percent:.0f}%)**\n\n"
                f"Market: {result['market']} {result['side'].upper()}\n"
                f"Close Price: ${result['close_price']:,.2f}\n"
                f"Realized PnL: {pnl_emoji} ${pnl:,.2f}\n",
                parse_mode="Markdown",
            )
    except Exception as e:
        await query.edit_message_text(f"\u274c Error closing position: {str(e)}")

    return PERPS_MENU


async def perps_tpsl_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show TP/SL setup prompt for a position."""
    query = update.callback_query
    await query.answer()

    try:
        position_id = int(query.data.replace("perps_tpsl_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid position.")
        return PERPS_MENU

    # Verify position belongs to this user
    positions = await perps_service.get_positions(query.from_user.id)
    position = next((p for p in positions if p.id == position_id), None)
    if not position:
        await query.edit_message_text("❌ Position not found.")
        return PERPS_MENU

    context.user_data["perps_tpsl_position_id"] = position_id
    context.user_data["perps_tpsl_step"] = "tp"

    current_tp = float(position.tp_price) if position.tp_price else None
    current_sl = float(position.sl_price) if position.sl_price else None
    mark = float(position.mark_price or position.entry_price or 0)

    tp_str = f"${current_tp:,.2f}" if current_tp else "not set"
    sl_str = f"${current_sl:,.2f}" if current_sl else "not set"

    market_safe = safe_md(position.market)
    text = (
        f"⚙️ *TP/SL for {market_safe} {position.side.upper()}*\n\n"
        f"Mark price: ${mark:,.2f}\n"
        f"Current TP: {tp_str}\n"
        f"Current SL: {sl_str}\n\n"
        f"Enter *take profit price* (or `skip` to keep current):"
    )
    keyboard = [[InlineKeyboardButton("❌ Cancel", callback_data="perps_tpsl_cancel")]]
    await send_md_safe(update, text, reply_markup=InlineKeyboardMarkup(keyboard))
    return PERPS_TPSL_INPUT


async def perps_tpsl_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel TP/SL entry and return to positions."""
    query = update.callback_query
    await query.answer()
    context.user_data.pop("perps_tpsl_position_id", None)
    context.user_data.pop("perps_tpsl_step", None)
    context.user_data.pop("perps_tpsl_tp", None)
    return await perps_menu_callback(update, context)


async def perps_tpsl_input_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle TP and SL price text inputs."""
    text = update.message.text.strip().lower()
    step = context.user_data.get("perps_tpsl_step")
    position_id = context.user_data.get("perps_tpsl_position_id")

    if step == "tp":
        # Parse TP price
        if text == "skip":
            context.user_data["perps_tpsl_tp"] = None
        else:
            try:
                tp = float(text.replace("$", "").replace(",", ""))
                context.user_data["perps_tpsl_tp"] = tp
            except ValueError:
                await update.message.reply_text(
                    "Invalid price. Enter a number or `skip`:",
                    parse_mode="Markdown",
                    reply_markup=InlineKeyboardMarkup(
                        [[InlineKeyboardButton("❌ Cancel", callback_data="perps_tpsl_cancel")]]
                    ),
                )
                return PERPS_TPSL_INPUT

        context.user_data["perps_tpsl_step"] = "sl"
        await update.message.reply_text(
            "Now enter *stop loss price* (or `skip` to keep current):",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("❌ Cancel", callback_data="perps_tpsl_cancel")]]
            ),
        )
        return PERPS_TPSL_INPUT

    elif step == "sl":
        # Parse SL price
        if text == "skip":
            sl = None
        else:
            try:
                sl = float(text.replace("$", "").replace(",", ""))
            except ValueError:
                await update.message.reply_text(
                    "Invalid price. Enter a number or `skip`:",
                    parse_mode="Markdown",
                    reply_markup=InlineKeyboardMarkup(
                        [[InlineKeyboardButton("❌ Cancel", callback_data="perps_tpsl_cancel")]]
                    ),
                )
                return PERPS_TPSL_INPUT

        tp = context.user_data.pop("perps_tpsl_tp", None)
        context.user_data.pop("perps_tpsl_position_id", None)
        context.user_data.pop("perps_tpsl_step", None)

        try:
            await perps_service.modify_tp_sl(
                user_id=update.effective_user.id,
                position_id=position_id,
                tp_price=tp,
                sl_price=sl,
            )
            tp_str = f"${tp:,.2f}" if tp is not None else "cleared"
            sl_str = f"${sl:,.2f}" if sl is not None else "cleared"
            await update.message.reply_text(
                f"✅ *TP/SL updated*\n\nTake Profit: {safe_md(tp_str)}\nStop Loss: {safe_md(sl_str)}",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [
                            InlineKeyboardButton(
                                "\U0001f4cb Back to Positions", callback_data="perps_positions"
                            )
                        ]
                    ]
                ),
            )
        except Exception as e:
            logger.error(f"Error setting TP/SL: {e}", exc_info=True)
            await update.message.reply_text(f"❌ Failed to update TP/SL: {safe_md(str(e))}")

        return PERPS_MENU

    return PERPS_TPSL_INPUT


# Conversation handler
perps_conversation_handler = ConversationHandler(
    name="perps",
    persistent=True,
    entry_points=[
        CommandHandler("perps", perps_command),
        # Inline-button entry from the main menu ("📈 Perps").
        CallbackQueryHandler(perps_command, pattern="^perps_open$"),
    ],
    states={
        PERPS_MENU: [
            # Specific patterns must come before the catch-all ^perps_ to avoid shadowing.
            CallbackQueryHandler(perps_tpsl_callback, pattern=r"^perps_tpsl_\d+$"),
            CallbackQueryHandler(perps_tpsl_cancel_callback, pattern="^perps_tpsl_cancel$"),
            CallbackQueryHandler(perps_close_callback, pattern="^perps_close_"),
            CallbackQueryHandler(perps_close_amount_callback, pattern="^perps_closeamt_"),
            CallbackQueryHandler(perps_menu_callback, pattern="^perps_"),
        ],
        PERPS_TPSL_INPUT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, perps_tpsl_input_handler),
            CallbackQueryHandler(perps_tpsl_cancel_callback, pattern="^perps_tpsl_cancel$"),
        ],
        PERPS_MARKET: [
            CallbackQueryHandler(perps_market_callback, pattern="^perps_market_"),
        ],
        PERPS_AMOUNT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, perps_amount_handler),
        ],
        PERPS_LEVERAGE: [
            CallbackQueryHandler(perps_leverage_callback, pattern="^perps_lev_"),
        ],
        PERPS_CONFIRM: [
            CallbackQueryHandler(perps_execute_callback, pattern="^perps_exec$"),
            CallbackQueryHandler(perps_menu_callback, pattern="^perps_back$"),
        ],
        PERPS_SETUP_KEY: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, perps_setup_key),
        ],
        PERPS_SETUP_SECRET: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, perps_setup_secret),
        ],
    },
    fallbacks=[
        CommandHandler("perps", perps_command),
        CallbackQueryHandler(perps_menu_callback, pattern="^main_menu$"),
    ],
)

# Callback handlers for outside conversation
perps_menu_callback_handler = CallbackQueryHandler(perps_menu_callback, pattern="^perps_menu$")
