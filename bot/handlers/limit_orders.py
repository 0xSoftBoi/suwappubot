"""Limit order and DCA handlers."""

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
from bot.models.advanced import OrderStatus, OrderType, DCAStatus
from bot.services.orders import order_service
from bot.services.price_service import price_service
from bot.services.wallet import WalletService
from bot.utils.gating import require_tier
from bot.models.subscription import SubscriptionTier
from bot.utils.formatters import escape_markdown
from database.db import get_session


from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.tokens import get_tokens_for_chain, get_token_address, get_token_decimals

# Module-level wallet service singleton (matches the pattern used in other
# handlers, e.g. balance.py / swap.py). Previously `wallet_service` was
# referenced in dca_confirm() and lo_confirm() without ever being defined,
# which raised NameError and crashed every order confirmation.
wallet_service = WalletService()

# States
LO_TYPE, LO_FROM_CHAIN, LO_FROM_TOKEN, LO_TO_CHAIN, LO_TO_TOKEN, LO_AMOUNT, LO_PRICE, LO_CONFIRM = (
    range(8)
)
DCA_TOKEN, DCA_AMOUNT, DCA_INTERVAL, DCA_CONFIRM = range(100, 104)
TS_TOKEN, TS_AMOUNT, TS_PCT, TS_CONFIRM = range(200, 204)


@require_tier(SubscriptionTier.PRO)
async def orders_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /orders command. PRO+ feature."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    orders = order_service.get_user_orders(user_id)

    if not orders:
        text = "📋 *Limit Orders*\n\n_No active orders._"
    else:
        lines = ["📋 *Your Orders*\n"]
        for order in orders[:10]:
            icon = {"pending": "⏳", "executed": "✅", "cancelled": "❌"}.get(order.status, "❓")
            if order.order_type == OrderType.TRAILING_STOP.value:
                price_str = f"trailing {order.trailing_percent or 0:.0f}%"
            else:
                price_str = f"@${order.trigger_price:.2f}"
            lines.append(f"{icon} {order.from_token}→{order.to_token} {price_str}")
        text = "\n".join(lines)

    keyboard = [
        [
            InlineKeyboardButton("🟢 Limit Buy", callback_data="lo_buy"),
            InlineKeyboardButton("🔴 Limit Sell", callback_data="lo_sell"),
        ],
        [InlineKeyboardButton("🛑 Stop Loss", callback_data="lo_stop")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


@require_tier(SubscriptionTier.PRO)
async def dca_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /dca command or the 'dca_menu' menu button.

    Callback-safe: on a button press update.message is None, so reply via
    effective_message for the guard and edit the menu message for the render.
    """
    user = update.effective_user
    if update.callback_query:
        await update.callback_query.answer()

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.effective_message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    orders = order_service.get_user_dca_orders(user_id)

    keyboard = []
    if orders:
        text = f"📊 *Your DCA Orders* ({len(orders)})\n\nSelect an order to view details:"
        for order in orders:
            icon = "🟢" if order.status == DCAStatus.ACTIVE.value else "⏸"
            btn_text = f"{icon} {order.to_token}: ${order.amount_per_execution}"
            keyboard.append([InlineKeyboardButton(btn_text, callback_data=f"dca_view_{order.id}")])
    else:
        text = "📊 *DCA Orders*\n\nNo active DCA orders. Create one to start dollar-cost averaging!"

    keyboard.append([InlineKeyboardButton("➕ Create DCA", callback_data="dca_create")])
    keyboard.append([InlineKeyboardButton("« Back", callback_data="main_menu")])

    markup = InlineKeyboardMarkup(keyboard)
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=markup
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)


@require_tier(SubscriptionTier.PRO)
async def dca_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start DCA creation."""
    query = update.callback_query
    await query.answer()

    tokens = ["ETH", "BTC", "SOL", "USDC", "LINK"]
    keyboard = [
        [InlineKeyboardButton(t, callback_data=f"dcat_{t}") for t in tokens[:3]],
        [InlineKeyboardButton(t, callback_data=f"dcat_{t}") for t in tokens[3:]],
        [InlineKeyboardButton("❌ Cancel", callback_data="dca_cancel")],
    ]

    await query.edit_message_text(
        "📊 *New DCA Plan*\n\nSelect the token you want to accumulate:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return DCA_TOKEN


async def dca_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle DCA token selection."""
    query = update.callback_query
    await query.answer()

    token = query.data.replace("dcat_", "")
    context.user_data["dca_token"] = token

    await query.edit_message_text(
        f"Token: *{escape_markdown(token)}*\n\nEnter amount per execution (in USDC):",
        parse_mode="Markdown",
    )
    return DCA_AMOUNT


async def dca_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle DCA amount entry."""
    try:
        amount = float(update.message.text.strip())
        context.user_data["dca_amount"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid amount.")
        return DCA_AMOUNT

    keyboard = [
        [
            InlineKeyboardButton("Every 1h", callback_data="dcai_1"),
            InlineKeyboardButton("Every 4h", callback_data="dcai_4"),
        ],
        [
            InlineKeyboardButton("Every 12h", callback_data="dcai_12"),
            InlineKeyboardButton("Daily", callback_data="dcai_24"),
        ],
        [InlineKeyboardButton("❌ Cancel", callback_data="dca_cancel")],
    ]

    await update.message.reply_text(
        f"Amount: ${amount} USDC\n\nHow often should we buy?",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return DCA_INTERVAL


async def dca_interval(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle DCA interval selection."""
    query = update.callback_query
    await query.answer()

    try:
        interval = int(query.data.replace("dcai_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid interval.")
        return ConversationHandler.END
    context.user_data["dca_interval"] = interval

    token = context.user_data.get("dca_token")
    amount = context.user_data.get("dca_amount")
    if not token or amount is None:
        await query.edit_message_text("❌ Session expired. Please start again with /dca")
        return ConversationHandler.END

    keyboard = [
        [InlineKeyboardButton("🚀 Start DCA", callback_data="dca_confirm")],
        [InlineKeyboardButton("❌ Cancel", callback_data="dca_cancel")],
    ]

    await query.edit_message_text(
        f"📊 *Confirm DCA plan*\n\n"
        f"Buy: *{token}*\n"
        f"Amount: *${amount} USDC*\n"
        f"Frequency: Every *{interval}* hours\n\n"
        f"The first trade will execute immediately.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return DCA_CONFIRM


async def dca_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute/Save DCA plan."""
    query = update.callback_query
    await query.answer()

    dca_token = context.user_data.get("dca_token")
    dca_amount = context.user_data.get("dca_amount")
    dca_interval = context.user_data.get("dca_interval")
    if not all([dca_token, dca_amount is not None, dca_interval is not None]):
        await query.edit_message_text("❌ Session expired. Please start again with /dca")
        return ConversationHandler.END

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
        user_id = db_user.id

    wallet = wallet_service.get_default_wallet(user_id, "evm")
    if not wallet:
        await query.edit_message_text("❌ No EVM wallet found.")
        return ConversationHandler.END

    # Amount is denominated in USDC. Use the real token decimals so the raw
    # amount matches what _execute_dca_order() decodes via get_token_decimals
    # (USDC = 6 on ethereum). Hardcoding 10**18 here caused a 10^12x mismatch.
    usdc_decimals = get_token_decimals("USDC", "ethereum")
    order_service.create_dca_order(
        user_id=user_id,
        wallet_id=wallet.id,
        from_chain="ethereum",
        from_token="USDC",
        to_chain="ethereum",
        to_token=dca_token,
        amount_per_execution=str(int(dca_amount * 10**usdc_decimals)),
        interval_hours=dca_interval,
    )

    await query.edit_message_text(
        "✅ *DCA Plan Started!*\n\nYou can manage it anytime with /dca",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="main_menu")]]
        ),
    )
    return ConversationHandler.END


async def dca_view_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """View details of an active DCA."""
    query = update.callback_query
    await query.answer()

    try:
        dca_id = int(query.data.replace("dca_view_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid order.")
        return
    with get_session() as session:
        from bot.models.advanced import DCAOrder

        order = session.query(DCAOrder).filter(DCAOrder.id == dca_id).first()
        if not order:
            await query.edit_message_text("❌ DCA not found.")
            return

        status = "🟢 Active" if order.status == "active" else "⏸ Paused"
        from_decimals = get_token_decimals(order.from_token, order.from_chain)
        text = (
            f"📊 *DCA Details*\n\n"
            f"Pair: {order.from_token} → {order.to_token}\n"
            f"Amount: ${float(order.amount_per_execution) / 10 ** from_decimals:.2f} {order.from_token}\n"
            f"Frequency: every {order.interval_hours}h\n"
            f"Status: {status}\n"
            f"Executions: {order.executions_completed}\n"
            f"Next buy: {order.next_execution_at.strftime('%Y-%m-%d %H:%M')} UTC"
        )

        keyboard = []
        if order.status == "active":
            keyboard.append([InlineKeyboardButton("⏸ Pause", callback_data=f"dca_pause_{dca_id}")])
        else:
            keyboard.append(
                [InlineKeyboardButton("▶️ Resume", callback_data=f"dca_resume_{dca_id}")]
            )

        keyboard.append(
            [InlineKeyboardButton("🗑 Cancel Plan", callback_data=f"dca_cancel_plan_{dca_id}")]
        )
        keyboard.append([InlineKeyboardButton("« Back", callback_data="dca_menu")])

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )


async def dca_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle pause/resume/cancel actions."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    try:
        if query.data.startswith("dca_pause_"):
            dca_id = int(query.data.replace("dca_pause_", ""))
            order_service.pause_dca(dca_id, user_id)
            await query.edit_message_text("⏸ DCA Paused.")
        elif query.data.startswith("dca_resume_"):
            dca_id = int(query.data.replace("dca_resume_", ""))
            order_service.resume_dca(dca_id, user_id)
            await query.edit_message_text("▶️ DCA Resumed.")
        elif query.data.startswith("dca_cancel_plan_"):
            dca_id = int(query.data.replace("dca_cancel_plan_", ""))
            order_service.cancel_dca(dca_id, user_id)
            await query.edit_message_text("🗑 DCA Plan Cancelled.")
    except ValueError:
        await query.edit_message_text("❌ Invalid order.")
        return

    # Re-show menu after action
    # For now, just back to main DCA command text
    await dca_command(update, context)


@require_tier(SubscriptionTier.PRO)
async def lo_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start limit order creation."""
    query = update.callback_query
    await query.answer()

    order_type = query.data.replace("lo_", "")
    context.user_data["lo"] = {"type": order_type}

    # 1. Select From Chain
    text = f"📋 *New {order_type.title()} Order*\n\nSelect source chain:"
    keyboard = []
    row = []
    for name, chain in CHAINS.items():
        if chain.is_testnet:
            continue
        row.append(
            InlineKeyboardButton(
                f"{chain.logo_emoji} {chain.display_name}", callback_data=f"lofc_{name}"
            )
        )
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return LO_FROM_CHAIN


async def lo_from_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle source chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("lofc_", "")
    context.user_data["lo"]["from_chain"] = chain_name

    # 2. Select From Token
    tokens = get_tokens_for_chain(chain_name)
    text = f"Chain: *{chain_name.upper()}*\n\nSelect token to sell/spend:"
    keyboard = []
    row = []
    for t in tokens:
        row.append(InlineKeyboardButton(t.symbol, callback_data=f"loft_{t.symbol}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return LO_FROM_TOKEN


async def lo_from_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle source token selection."""
    query = update.callback_query
    await query.answer()

    token_symbol = query.data.replace("loft_", "")
    context.user_data["lo"]["from_token"] = token_symbol

    # 3. Select To Chain
    text = "Select destination chain:"
    keyboard = []
    row = []
    for name, chain in CHAINS.items():
        if chain.is_testnet:
            continue
        row.append(
            InlineKeyboardButton(
                f"{chain.logo_emoji} {chain.display_name}", callback_data=f"lotc_{name}"
            )
        )
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return LO_TO_CHAIN


async def lo_to_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle destination chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("lotc_", "")
    context.user_data["lo"]["to_chain"] = chain_name

    # 4. Select To Token
    tokens = get_tokens_for_chain(chain_name)
    text = f"To Chain: *{chain_name.upper()}*\n\nSelect token to receive:"
    keyboard = []
    row = []
    for t in tokens:
        row.append(InlineKeyboardButton(t.symbol, callback_data=f"lott_{t.symbol}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return LO_TO_TOKEN


async def lo_to_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle destination token selection."""
    query = update.callback_query
    await query.answer()

    token_symbol = query.data.replace("lott_", "")
    lo = context.user_data.get("lo")
    if not lo:
        await query.edit_message_text("❌ Order session expired. Start again with /o")
        return ConversationHandler.END
    lo["to_token"] = token_symbol
    await query.edit_message_text(
        f"Pair: *{lo['from_token']} ({lo['from_chain'].upper()})* → *{lo['to_token']} ({lo['to_chain'].upper()})*\n\n"
        "Enter the amount to swap:",
        parse_mode="Markdown",
    )
    return LO_AMOUNT


async def lo_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle token selection."""
    query = update.callback_query
    await query.answer()

    token = query.data.replace("lot_", "")
    context.user_data["lo_token"] = token

    prices = await price_service.get_prices([token])
    context.user_data["lo_price"] = prices.get(token, 0)

    await query.edit_message_text(
        f"Token: *{escape_markdown(token)}* (${prices.get(token, 0):.2f})\n\nEnter amount:",
        parse_mode="Markdown",
    )
    return LO_AMOUNT


async def lo_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount entry."""
    try:
        amount = float(update.message.text.strip())
        lo = context.user_data.get("lo")
        if not lo:
            await update.message.reply_text("❌ Order session expired. Start again with /o")
            return ConversationHandler.END
        lo["amount_human"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid number.")
        return LO_AMOUNT

    await update.message.reply_text(f"Amount: {amount}\n\nEnter trigger price in USD:")
    return LO_PRICE


async def lo_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle price entry."""
    try:
        price = float(update.message.text.strip().replace("$", ""))
        lo = context.user_data.get("lo")
        if not lo:
            await update.message.reply_text("❌ Order session expired. Start again with /o")
            return ConversationHandler.END
        lo["trigger_price"] = price
    except ValueError:
        await update.message.reply_text("❌ Invalid price.")
        return LO_PRICE

    keyboard = [
        [
            InlineKeyboardButton("✅ Confirm Order", callback_data="lo_confirm"),
            InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel"),
        ]
    ]

    text = (
        f"📋 *Confirm Limit Order*\n\n"
        f"Type: *{lo['type'].upper()}*\n"
        f"Route: {lo['from_token']} ({lo['from_chain'].upper()}) → {lo['to_token']} ({lo['to_chain'].upper()})\n"
        f"Amount: {lo['amount_human']} {lo['from_token']}\n"
        f"Trigger: ${price:.2f}"
    )

    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return LO_CONFIRM


async def lo_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm and save limit order."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    lo = context.user_data.get("lo")
    if not lo:
        await query.edit_message_text("❌ Order session expired. Start again with /o")
        return ConversationHandler.END

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
        user_id = db_user.id

    # Get wallet for the source chain
    chain_type = "solana" if lo["from_chain"] == "solana" else "evm"
    wallet = wallet_service.get_default_wallet(user_id, chain_type)

    if not wallet:
        await query.edit_message_text(f"❌ No {chain_type.upper()} wallet found.")
        return ConversationHandler.END

    # Calculate raw amount
    from bot.config.tokens import get_token_decimals

    decimals = get_token_decimals(lo["from_token"], lo["from_chain"])
    amount_raw = str(int(lo["amount_human"] * (10**decimals)))

    _order_type_map = {"buy": "limit_buy", "sell": "limit_sell", "stop": "stop_loss"}
    order_service.create_limit_order(
        user_id=user_id,
        wallet_id=wallet.id,
        order_type=_order_type_map.get(lo["type"], f"limit_{lo['type']}"),
        from_chain=lo["from_chain"],
        from_token=lo["from_token"],
        to_chain=lo["to_chain"],
        to_token=lo["to_token"],
        amount=amount_raw,
        trigger_price=lo["trigger_price"],
    )

    await query.edit_message_text(
        f"✅ *Order Created!*\n\n{lo['from_token']} → {lo['to_token']} @ ${lo['trigger_price']:.2f}",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="main_menu")]]
        ),
    )
    return ConversationHandler.END


async def lo_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel order creation."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "❌ Cancelled.",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="main_menu")]]
        ),
    )
    return ConversationHandler.END


# Conversation handlers
limit_order_conversation = ConversationHandler(
    name="limit_order",
    persistent=True,
    entry_points=[
        CallbackQueryHandler(lo_start, pattern="^lo_(buy|sell|stop)$"),
        CallbackQueryHandler(dca_start, pattern="^dca_create$"),
    ],
    states={
        # Limit Orders
        LO_TYPE: [CallbackQueryHandler(lo_start, pattern="^lo_(buy|sell|stop)$")],
        LO_FROM_CHAIN: [CallbackQueryHandler(lo_from_chain, pattern="^lofc_")],
        LO_FROM_TOKEN: [CallbackQueryHandler(lo_from_token, pattern="^loft_")],
        LO_TO_CHAIN: [CallbackQueryHandler(lo_to_chain, pattern="^lotc_")],
        LO_TO_TOKEN: [CallbackQueryHandler(lo_to_token, pattern="^lott_")],
        LO_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, lo_amount)],
        LO_PRICE: [MessageHandler(filters.TEXT & ~filters.COMMAND, lo_price)],
        LO_CONFIRM: [CallbackQueryHandler(lo_confirm, pattern="^lo_confirm$")],
        # DCA
        DCA_TOKEN: [CallbackQueryHandler(dca_token, pattern="^dcat_")],
        DCA_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, dca_amount)],
        DCA_INTERVAL: [CallbackQueryHandler(dca_interval, pattern="^dcai_")],
        DCA_CONFIRM: [CallbackQueryHandler(dca_confirm, pattern="^dca_confirm$")],
    },
    fallbacks=[
        CallbackQueryHandler(lo_cancel, pattern="^lo_cancel$"),
        CallbackQueryHandler(lo_cancel, pattern="^dca_cancel$"),
    ],
)


async def limit_orders_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle limit orders menu callback."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    orders = order_service.get_user_orders(user_id)

    if not orders:
        text = "📈 *Limit Orders*\n\n_No active orders._"
    else:
        lines = ["📈 *Your Orders*\n"]
        for order in orders[:10]:
            icon = {"pending": "⏳", "executed": "✅", "cancelled": "❌"}.get(order.status, "❓")
            if order.order_type == OrderType.TRAILING_STOP.value:
                price_str = f"trailing {order.trailing_percent or 0:.0f}%"
            else:
                price_str = f"@${order.trigger_price:.2f}"
            lines.append(f"{icon} {order.from_token}→{order.to_token} {price_str}")
        text = "\n".join(lines)

    keyboard = [
        [
            InlineKeyboardButton("🟢 Limit Buy", callback_data="lo_buy"),
            InlineKeyboardButton("🔴 Limit Sell", callback_data="lo_sell"),
        ],
        [InlineKeyboardButton("🛑 Stop Loss", callback_data="lo_stop")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


# ============ TRAILING STOP CONVERSATION ============

TRAILING_MIN_PCT = 1.0
TRAILING_MAX_PCT = 50.0


@require_tier(SubscriptionTier.PRO)
async def trailing_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /trailing command — start trailing stop creation flow. PRO+ feature."""
    context.user_data["ts"] = {}
    await update.message.reply_text(
        "🔁 *Trailing Stop Loss*\n\n"
        "Enter the token symbol or address you want to protect (e.g. ETH, SOL):",
        parse_mode="Markdown",
    )
    return TS_TOKEN


def _normalise_token_input(raw: str) -> str:
    """Uppercase if it looks like a symbol; preserve case if it looks like an address."""
    stripped = raw.strip()
    # EVM address: 0x + 40 hex chars; Solana base58: 32–44 chars with no "0x" prefix
    if stripped.startswith("0x") or (32 <= len(stripped) <= 44 and not stripped.startswith("0x")):
        return stripped  # preserve address case
    return stripped.upper()


async def ts_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive the token for the trailing stop."""
    token = _normalise_token_input(update.message.text)
    context.user_data["ts"]["from_token"] = token
    await update.message.reply_text(
        f"Amount of *{token}* to sell when triggered (e.g. 1.5):",
        parse_mode="Markdown",
    )
    return TS_AMOUNT


async def ts_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive the sell amount for the trailing stop."""
    raw = update.message.text.strip()
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("❌ Invalid amount. Enter a positive number:")
        return TS_AMOUNT

    context.user_data["ts"]["amount_human"] = amount
    await update.message.reply_text(
        f"Trailing percentage (1–50). Example: enter *10* to sell if price drops 10% from its peak:",
        parse_mode="Markdown",
    )
    return TS_PCT


async def ts_pct(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive the trailing % and ask for confirmation."""
    raw = update.message.text.strip()
    try:
        pct = float(raw)
        if not (TRAILING_MIN_PCT <= pct <= TRAILING_MAX_PCT):
            raise ValueError
    except ValueError:
        await update.message.reply_text(
            f"❌ Please enter a number between {int(TRAILING_MIN_PCT)} and {int(TRAILING_MAX_PCT)}:"
        )
        return TS_PCT

    ts = context.user_data["ts"]
    ts["trailing_percent"] = pct

    keyboard = [
        [
            InlineKeyboardButton("Confirm", callback_data="ts_confirm"),
            InlineKeyboardButton("Cancel", callback_data="ts_cancel"),
        ]
    ]
    await update.message.reply_text(
        f"*Trailing Stop Summary*\n\n"
        f"Token: {ts['from_token']}\n"
        f"Amount: {ts['amount_human']}\n"
        f"Trailing %: {pct}%\n\n"
        f"Sell {ts['amount_human']} {ts['from_token']} if price drops {pct}% from its peak.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return TS_CONFIRM


async def ts_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm and create the trailing stop order."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    ts = context.user_data.get("ts", {})

    if not ts:
        await query.edit_message_text("❌ Session expired. Start again with /trailing")
        return ConversationHandler.END

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
        user_id = db_user.id

    from_chain = "ethereum"  # Default chain; user can expand via full flow later
    to_chain = "ethereum"
    to_token = "USDC"

    # Validate that we can price the token before creating the order
    try:
        token_prices = await price_service.get_prices([ts["from_token"]])
        current_price = token_prices.get(ts["from_token"], 0) or 0
    except Exception:
        current_price = 0
    if current_price <= 0:
        await query.edit_message_text(
            "❌ Couldn't price that token. Please use a symbol (ETH, SOL) or verified contract address."
        )
        return ConversationHandler.END

    chain_type = "evm"
    wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not wallet:
        await query.edit_message_text("❌ No EVM wallet found. Create one with /w")
        return ConversationHandler.END

    from bot.config.tokens import get_token_decimals

    decimals = get_token_decimals(ts["from_token"], from_chain)
    amount_raw = str(int(ts["amount_human"] * (10**decimals)))

    order_service.create_trailing_stop_order(
        user_id=user_id,
        wallet_id=wallet.id,
        from_chain=from_chain,
        from_token=ts["from_token"],
        to_chain=to_chain,
        to_token=to_token,
        amount=amount_raw,
        trailing_percent=ts["trailing_percent"],
    )

    await query.edit_message_text(
        f"✅ *Trailing Stop Set!*\n\n"
        f"Sell {ts['amount_human']} {ts['from_token']} if price drops "
        f"{ts['trailing_percent']}% from its peak.\n\n"
        f"The trigger ratchets up as price rises.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="main_menu")]]
        ),
    )
    context.user_data.pop("ts", None)
    return ConversationHandler.END


async def ts_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel trailing stop creation."""
    query = update.callback_query
    await query.answer()
    context.user_data.pop("ts", None)
    await query.edit_message_text(
        "❌ Cancelled.",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="main_menu")]]
        ),
    )
    return ConversationHandler.END


trailing_stop_conversation = ConversationHandler(
    name="trailing_stop",
    persistent=True,
    entry_points=[CommandHandler("trailing", trailing_command)],
    states={
        TS_TOKEN: [MessageHandler(filters.TEXT & ~filters.COMMAND, ts_token)],
        TS_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, ts_amount)],
        TS_PCT: [MessageHandler(filters.TEXT & ~filters.COMMAND, ts_pct)],
        TS_CONFIRM: [CallbackQueryHandler(ts_confirm, pattern="^ts_confirm$")],
    },
    fallbacks=[CallbackQueryHandler(ts_cancel, pattern="^ts_cancel$")],
)


# Individual callbacks for existing DCAs
dca_view_handler = CallbackQueryHandler(dca_view_callback, pattern="^dca_view_")
dca_actions_handler = CallbackQueryHandler(
    dca_action_callback, pattern="^dca_(pause|resume|cancel_plan)_"
)
dca_menu_callback = CallbackQueryHandler(dca_command, pattern="^dca_menu$")
limit_orders_menu_callback_handler = CallbackQueryHandler(
    limit_orders_menu_callback, pattern="^limit_orders_menu$"
)

orders_handler = CommandHandler("o", orders_command)
dca_handler = CommandHandler("dca", dca_command)
