"""Limit order and DCA handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler,
    ConversationHandler, MessageHandler, filters
)

from bot.models.user import User
from bot.models.advanced import OrderStatus, OrderType, DCAStatus
from bot.services.orders import order_service
from bot.services.price_service import price_service
from bot.services.wallet import WalletService
from bot.utils.gating import require_tier
from bot.models.subscription import SubscriptionTier
from database.db import get_session


from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.tokens import get_tokens_for_chain, get_token_address

# States
LO_TYPE, LO_FROM_CHAIN, LO_FROM_TOKEN, LO_TO_CHAIN, LO_TO_TOKEN, LO_AMOUNT, LO_PRICE, LO_CONFIRM = range(8)
DCA_TOKEN, DCA_AMOUNT, DCA_INTERVAL, DCA_CONFIRM = range(100, 104)
TRAIL_CHAIN, TRAIL_TOKEN, TRAIL_AMOUNT, TRAIL_PERCENT, TRAIL_CONFIRM = range(200, 205)
BUYDIP_CHAIN, BUYDIP_TOKEN, BUYDIP_AMOUNT, BUYDIP_PERCENT, BUYDIP_CONFIRM = range(300, 305)
MTP_CHAIN, MTP_TOKEN, MTP_AMOUNT, MTP_LEVELS, MTP_CONFIRM = range(400, 405)

wallet_service = WalletService()


async def orders_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /orders command."""
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
            extra = ""
            if order.order_type == OrderType.TRAILING_STOP.value and order.highest_price_seen:
                extra = f" (high: ${order.highest_price_seen:.2f})"
            lines.append(f"{icon} {order.order_type}: {order.from_token}→{order.to_token} @${order.trigger_price:.2f}{extra}")
        text = "\n".join(lines)

    keyboard = [
        [InlineKeyboardButton("🟢 Limit Buy", callback_data="lo_buy"),
         InlineKeyboardButton("🔴 Limit Sell", callback_data="lo_sell")],
        [InlineKeyboardButton("🛑 Stop Loss", callback_data="lo_stop")],
        [InlineKeyboardButton("📉 Trailing Stop", callback_data="lo_trailing"),
         InlineKeyboardButton("💰 Buy Dip", callback_data="lo_buydip")],
        [InlineKeyboardButton("🎯 Multi Take-Profit", callback_data="lo_multitp")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await update.message.reply_text(text, parse_mode="Markdown",
                                     reply_markup=InlineKeyboardMarkup(keyboard))


async def dca_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /dca command."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
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

    await update.message.reply_text(text, parse_mode="Markdown",
                                     reply_markup=InlineKeyboardMarkup(keyboard))


async def dca_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start DCA creation."""
    query = update.callback_query
    await query.answer()
    
    tokens = ["ETH", "BTC", "SOL", "USDC", "LINK"]
    keyboard = [[InlineKeyboardButton(t, callback_data=f"dcat_{t}") for t in tokens[:3]],
                [InlineKeyboardButton(t, callback_data=f"dcat_{t}") for t in tokens[3:]],
                [InlineKeyboardButton("❌ Cancel", callback_data="dca_cancel")]]
    
    await query.edit_message_text(
        "📊 *New DCA Plan*\n\nSelect the token you want to accumulate:",
        parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return DCA_TOKEN


async def dca_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle DCA token selection."""
    query = update.callback_query
    await query.answer()
    
    token = query.data.replace("dcat_", "")
    context.user_data["dca_token"] = token
    
    await query.edit_message_text(f"Token: *{token}*\n\nEnter amount per execution (in USDC):",
                                   parse_mode="Markdown")
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
        [InlineKeyboardButton("Every 1h", callback_data="dcai_1"),
         InlineKeyboardButton("Every 4h", callback_data="dcai_4")],
        [InlineKeyboardButton("Every 12h", callback_data="dcai_12"),
         InlineKeyboardButton("Daily", callback_data="dcai_24")],
        [InlineKeyboardButton("❌ Cancel", callback_data="dca_cancel")]
    ]
    
    await update.message.reply_text(f"Amount: ${amount} USDC\n\nHow often should we buy?",
                                     reply_markup=InlineKeyboardMarkup(keyboard))
    return DCA_INTERVAL


async def dca_interval(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle DCA interval selection."""
    query = update.callback_query
    await query.answer()
    
    interval = int(query.data.replace("dcai_", ""))
    context.user_data["dca_interval"] = interval
    
    token = context.user_data["dca_token"]
    amount = context.user_data["dca_amount"]
    
    keyboard = [[InlineKeyboardButton("🚀 Start DCA", callback_data="dca_confirm")],
                [InlineKeyboardButton("❌ Cancel", callback_data="dca_cancel")]]
    
    await query.edit_message_text(
        f"📊 *Confirm DCA plan*\n\n"
        f"Buy: *{token}*\n"
        f"Amount: *${amount} USDC*\n"
        f"Frequency: Every *{interval}* hours\n\n"
        f"The first trade will execute immediately.",
        parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return DCA_CONFIRM


async def dca_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute/Save DCA plan."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id
        
    wallet = wallet_service.get_default_wallet(user_id, "evm")
    if not wallet:
        await query.edit_message_text("❌ No EVM wallet found.")
        return ConversationHandler.END
        
    order_service.create_dca_order(
        user_id=user_id,
        wallet_id=wallet.id,
        from_chain="ethereum", # Defaulting to ethereum for now
        from_token="USDC",
        to_chain="ethereum",
        to_token=context.user_data["dca_token"],
        amount_per_execution=str(int(context.user_data["dca_amount"] * 10**18)), # Raw 18 decimals
        interval_hours=context.user_data["dca_interval"]
    )
    
    await query.edit_message_text("✅ *DCA Plan Started!*\n\nYou can manage it anytime with /dca",
                                   parse_mode="Markdown",
                                   reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="main_menu")]]))
    return ConversationHandler.END


async def dca_view_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """View details of an active DCA."""
    query = update.callback_query
    await query.answer()
    
    dca_id = int(query.data.replace("dca_view_", ""))
    with get_session() as session:
        from bot.models.advanced import DCAOrder
        order = session.query(DCAOrder).filter(DCAOrder.id == dca_id).first()
        if not order:
            await query.edit_message_text("❌ DCA not found.")
            return
            
        status = "🟢 Active" if order.status == "active" else "⏸ Paused"
        text = (
            f"📊 *DCA Details*\n\n"
            f"Pair: {order.from_token} → {order.to_token}\n"
            f"Amount: ${float(order.amount_per_execution)/10**18:.2f} USDC\n"
            f"Frequency: every {order.interval_hours}h\n"
            f"Status: {status}\n"
            f"Executions: {order.executions_completed}\n"
            f"Next buy: {order.next_execution_at.strftime('%Y-%m-%d %H:%M')} UTC"
        )
        
        keyboard = []
        if order.status == "active":
            keyboard.append([InlineKeyboardButton("⏸ Pause", callback_data=f"dca_pause_{dca_id}")])
        else:
            keyboard.append([InlineKeyboardButton("▶️ Resume", callback_data=f"dca_resume_{dca_id}")])
            
        keyboard.append([InlineKeyboardButton("🗑 Cancel Plan", callback_data=f"dca_cancel_plan_{dca_id}")])
        keyboard.append([InlineKeyboardButton("« Back", callback_data="dca_menu")])
        
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))


async def dca_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle pause/resume/cancel actions."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id
        
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
        
    # Re-show menu after action
    # For now, just back to main DCA command text
    await dca_command(update, context)


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
        row.append(InlineKeyboardButton(f"{chain.logo_emoji} {chain.display_name}", callback_data=f"lofc_{name}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row: keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])
    
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
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
    if row: keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])
    
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
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
        row.append(InlineKeyboardButton(f"{chain.logo_emoji} {chain.display_name}", callback_data=f"lotc_{name}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row: keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])
    
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
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
    if row: keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])
    
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return LO_TO_TOKEN


async def lo_to_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle destination token selection."""
    query = update.callback_query
    await query.answer()
    
    token_symbol = query.data.replace("lott_", "")
    context.user_data["lo"]["to_token"] = token_symbol
    
    lo = context.user_data["lo"]
    await query.edit_message_text(
        f"Pair: *{lo['from_token']} ({lo['from_chain'].upper()})* → *{lo['to_token']} ({lo['to_chain'].upper()})*\n\n"
        "Enter the amount to swap:",
        parse_mode="Markdown")
    return LO_AMOUNT


async def lo_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle token selection."""
    query = update.callback_query
    await query.answer()
    
    token = query.data.replace("lot_", "")
    context.user_data["lo_token"] = token
    
    prices = await price_service.get_prices([token])
    context.user_data["lo_price"] = prices.get(token, 0)
    
    await query.edit_message_text(f"Token: *{token}* (${prices.get(token, 0):.2f})\n\nEnter amount:",
                                   parse_mode="Markdown")
    return LO_AMOUNT


async def lo_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount entry."""
    try:
        amount = float(update.message.text.strip())
        context.user_data["lo"]["amount_human"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid number.")
        return LO_AMOUNT
    
    await update.message.reply_text(f"Amount: {amount}\n\nEnter trigger price in USD:")
    return LO_PRICE


async def lo_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle price entry."""
    try:
        price = float(update.message.text.strip().replace("$", ""))
        context.user_data["lo"]["trigger_price"] = price
    except ValueError:
        await update.message.reply_text("❌ Invalid price.")
        return LO_PRICE
    
    lo = context.user_data["lo"]
    keyboard = [[InlineKeyboardButton("✅ Confirm Order", callback_data="lo_confirm"),
                 InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")]]
    
    text = (
        f"📋 *Confirm Limit Order*\n\n"
        f"Type: *{lo['type'].upper()}*\n"
        f"Route: {lo['from_token']} ({lo['from_chain'].upper()}) → {lo['to_token']} ({lo['to_chain'].upper()})\n"
        f"Amount: {lo['amount_human']} {lo['from_token']}\n"
        f"Trigger: ${price:.2f}"
    )
    
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return LO_CONFIRM


async def lo_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm and save limit order."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    lo = context.user_data["lo"]
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
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
    amount_raw = str(int(lo["amount_human"] * (10 ** decimals)))
    
    order_service.create_limit_order(
        user_id=user_id,
        wallet_id=wallet.id,
        order_type=f"limit_{lo['type']}",
        from_chain=lo["from_chain"],
        from_token=lo["from_token"],
        to_chain=lo["to_chain"],
        to_token=lo["to_token"],
        amount=amount_raw,
        trigger_price=lo["trigger_price"]
    )
    
    await query.edit_message_text(f"✅ *Order Created!*\n\n{lo['from_token']} → {lo['to_token']} @ ${lo['trigger_price']:.2f}",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="main_menu")]]))
    return ConversationHandler.END


# ============ TRAILING STOP FLOW ============

async def lo_trailing_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start trailing stop creation."""
    query = update.callback_query
    await query.answer()

    context.user_data["trail"] = {}

    text = "📉 *New Trailing Stop*\n\nSelect chain:"
    keyboard = []
    row = []
    for name, chain in CHAINS.items():
        row.append(InlineKeyboardButton(f"{chain.logo_emoji} {chain.display_name}", callback_data=f"trfc_{name}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return TRAIL_CHAIN


async def trail_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle trailing stop chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("trfc_", "")
    context.user_data["trail"]["chain"] = chain_name

    tokens = get_tokens_for_chain(chain_name)
    text = f"Chain: *{chain_name.upper()}*\n\nSelect token to sell (trailing stop protects this):"
    keyboard = []
    row = []
    for t in tokens:
        row.append(InlineKeyboardButton(t.symbol, callback_data=f"trft_{t.symbol}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return TRAIL_TOKEN


async def trail_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle trailing stop token selection."""
    query = update.callback_query
    await query.answer()

    token = query.data.replace("trft_", "")
    context.user_data["trail"]["token"] = token

    prices = await price_service.get_prices([token])
    current_price = prices.get(token, 0)
    context.user_data["trail"]["current_price"] = current_price

    await query.edit_message_text(
        f"Token: *{token}* (${current_price:.4f})\n\nEnter amount to sell:",
        parse_mode="Markdown")
    return TRAIL_AMOUNT


async def trail_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle trailing stop amount entry."""
    try:
        amount = float(update.message.text.strip())
        context.user_data["trail"]["amount"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid amount.")
        return TRAIL_AMOUNT

    await update.message.reply_text(
        f"Amount: {amount}\n\nEnter trailing percentage (e.g. 5 for 5%):")
    return TRAIL_PERCENT


async def trail_percent(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle trailing stop percent entry."""
    try:
        pct = float(update.message.text.strip().replace("%", ""))
        if pct <= 0 or pct >= 100:
            raise ValueError
        context.user_data["trail"]["percent"] = pct
    except ValueError:
        await update.message.reply_text("❌ Enter a valid percentage (1-99).")
        return TRAIL_PERCENT

    trail = context.user_data["trail"]
    trigger = trail["current_price"] * (1 - pct / 100)

    keyboard = [[InlineKeyboardButton("✅ Confirm", callback_data="trail_confirm"),
                 InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")]]

    text = (
        f"📉 *Confirm Trailing Stop*\n\n"
        f"Token: *{trail['token']}* ({trail['chain'].upper()})\n"
        f"Amount: {trail['amount']}\n"
        f"Trailing: {pct}%\n"
        f"Current price: ${trail['current_price']:.4f}\n"
        f"Initial trigger: ${trigger:.4f}\n\n"
        f"_The trigger will rise as the price rises._"
    )

    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return TRAIL_CONFIRM


async def trail_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm and create trailing stop order."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    trail = context.user_data["trail"]

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id

    chain_type = "solana" if trail["chain"] == "solana" else "evm"
    wallet = wallet_service.get_default_wallet(user_id, chain_type)

    if not wallet:
        await query.edit_message_text(f"❌ No {chain_type.upper()} wallet found.")
        return ConversationHandler.END

    from bot.config.tokens import get_token_decimals
    decimals = get_token_decimals(trail["token"], trail["chain"])
    amount_raw = str(int(trail["amount"] * (10 ** decimals)))

    order_service.create_trailing_stop(
        user_id=user_id,
        wallet_id=wallet.id,
        from_chain=trail["chain"],
        from_token=trail["token"],
        to_chain=trail["chain"],
        to_token="USDC",
        amount=amount_raw,
        trailing_percent=trail["percent"],
        current_price=trail["current_price"],
    )

    await query.edit_message_text(
        f"✅ *Trailing Stop Created!*\n\n{trail['token']} trailing {trail['percent']}%",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="main_menu")]]))
    return ConversationHandler.END


# ============ BUY DIP FLOW ============

async def lo_buydip_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start buy-the-dip order creation."""
    query = update.callback_query
    await query.answer()

    context.user_data["buydip"] = {}

    text = "💰 *New Buy-the-Dip*\n\nSelect chain:"
    keyboard = []
    row = []
    for name, chain in CHAINS.items():
        row.append(InlineKeyboardButton(f"{chain.logo_emoji} {chain.display_name}", callback_data=f"bdfc_{name}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return BUYDIP_CHAIN


async def buydip_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle buy dip chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("bdfc_", "")
    context.user_data["buydip"]["chain"] = chain_name

    tokens = get_tokens_for_chain(chain_name)
    text = f"Chain: *{chain_name.upper()}*\n\nSelect token to buy on the dip:"
    keyboard = []
    row = []
    for t in tokens:
        row.append(InlineKeyboardButton(t.symbol, callback_data=f"bdft_{t.symbol}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return BUYDIP_TOKEN


async def buydip_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle buy dip token selection."""
    query = update.callback_query
    await query.answer()

    token = query.data.replace("bdft_", "")
    context.user_data["buydip"]["token"] = token

    prices = await price_service.get_prices([token])
    current_price = prices.get(token, 0)
    context.user_data["buydip"]["current_price"] = current_price

    await query.edit_message_text(
        f"Token: *{token}* (${current_price:.4f})\n\nEnter amount in USDC to spend:",
        parse_mode="Markdown")
    return BUYDIP_AMOUNT


async def buydip_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle buy dip amount entry."""
    try:
        amount = float(update.message.text.strip())
        context.user_data["buydip"]["amount"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid amount.")
        return BUYDIP_AMOUNT

    await update.message.reply_text(
        f"Amount: ${amount} USDC\n\nEnter dip percentage to trigger buy (e.g. 10 for -10%):")
    return BUYDIP_PERCENT


async def buydip_percent(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle buy dip percent entry."""
    try:
        pct = float(update.message.text.strip().replace("%", ""))
        if pct <= 0 or pct >= 100:
            raise ValueError
        context.user_data["buydip"]["percent"] = pct
    except ValueError:
        await update.message.reply_text("❌ Enter a valid percentage (1-99).")
        return BUYDIP_PERCENT

    bd = context.user_data["buydip"]
    trigger = bd["current_price"] * (1 - pct / 100)

    keyboard = [[InlineKeyboardButton("✅ Confirm", callback_data="buydip_confirm"),
                 InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")]]

    text = (
        f"💰 *Confirm Buy-the-Dip*\n\n"
        f"Buy: *{bd['token']}* ({bd['chain'].upper()})\n"
        f"Spend: ${bd['amount']} USDC\n"
        f"Dip: {pct}%\n"
        f"Current price: ${bd['current_price']:.4f}\n"
        f"Trigger at: ${trigger:.4f}"
    )

    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return BUYDIP_CONFIRM


async def buydip_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm and create buy dip order."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    bd = context.user_data["buydip"]

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id

    chain_type = "solana" if bd["chain"] == "solana" else "evm"
    wallet = wallet_service.get_default_wallet(user_id, chain_type)

    if not wallet:
        await query.edit_message_text(f"❌ No {chain_type.upper()} wallet found.")
        return ConversationHandler.END

    from bot.config.tokens import get_token_decimals
    decimals = get_token_decimals("USDC", bd["chain"])
    amount_raw = str(int(bd["amount"] * (10 ** decimals)))

    order_service.create_buy_dip(
        user_id=user_id,
        wallet_id=wallet.id,
        from_chain=bd["chain"],
        from_token="USDC",
        to_chain=bd["chain"],
        to_token=bd["token"],
        amount=amount_raw,
        dip_percent=bd["percent"],
        current_price=bd["current_price"],
    )

    await query.edit_message_text(
        f"✅ *Buy-the-Dip Created!*\n\nBuy {bd['token']} when it drops {bd['percent']}%",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="main_menu")]]))
    return ConversationHandler.END


# ============ MULTI TAKE-PROFIT FLOW ============

async def lo_multitp_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start multi take-profit creation."""
    query = update.callback_query
    await query.answer()

    context.user_data["mtp"] = {"levels": []}

    text = "🎯 *Multi Take-Profit*\n\nSelect chain:"
    keyboard = []
    row = []
    for name, chain in CHAINS.items():
        row.append(InlineKeyboardButton(f"{chain.logo_emoji} {chain.display_name}", callback_data=f"mtfc_{name}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return MTP_CHAIN


async def mtp_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle multi-TP chain selection."""
    query = update.callback_query
    await query.answer()

    chain_name = query.data.replace("mtfc_", "")
    context.user_data["mtp"]["chain"] = chain_name

    tokens = get_tokens_for_chain(chain_name)
    text = f"Chain: *{chain_name.upper()}*\n\nSelect token to sell at take-profit levels:"
    keyboard = []
    row = []
    for t in tokens:
        row.append(InlineKeyboardButton(t.symbol, callback_data=f"mtft_{t.symbol}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return MTP_TOKEN


async def mtp_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle multi-TP token selection."""
    query = update.callback_query
    await query.answer()

    token = query.data.replace("mtft_", "")
    context.user_data["mtp"]["token"] = token

    await query.edit_message_text(
        f"Token: *{token}*\n\nEnter total amount to sell across all levels:",
        parse_mode="Markdown")
    return MTP_AMOUNT


async def mtp_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle multi-TP amount entry."""
    try:
        amount = float(update.message.text.strip())
        context.user_data["mtp"]["amount"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid amount.")
        return MTP_AMOUNT

    await update.message.reply_text(
        f"Amount: {amount}\n\n"
        "Enter take-profit levels as `price,percent` pairs, one per line.\n"
        "Example:\n"
        "`2.00,25`\n"
        "`3.00,50`\n"
        "`5.00,25`\n\n"
        "_Percentages must add up to 100._",
        parse_mode="Markdown")
    return MTP_LEVELS


async def mtp_levels(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle multi-TP levels entry."""
    lines = update.message.text.strip().split("\n")
    levels = []
    total_pct = 0

    for line in lines:
        line = line.strip()
        if not line:
            continue
        parts = line.split(",")
        if len(parts) != 2:
            await update.message.reply_text("❌ Each line must be `price,percent`. Try again.")
            return MTP_LEVELS
        try:
            price = float(parts[0].strip().replace("$", ""))
            pct = float(parts[1].strip().replace("%", ""))
            levels.append({"price": price, "percent": pct})
            total_pct += pct
        except ValueError:
            await update.message.reply_text("❌ Invalid number in levels. Try again.")
            return MTP_LEVELS

    if not levels:
        await update.message.reply_text("❌ No levels entered. Try again.")
        return MTP_LEVELS

    if abs(total_pct - 100) > 0.01:
        await update.message.reply_text(f"❌ Percentages add up to {total_pct}%, must be 100%. Try again.")
        return MTP_LEVELS

    context.user_data["mtp"]["levels"] = levels

    mtp = context.user_data["mtp"]
    levels_text = "\n".join([f"  ${l['price']:.2f} → {l['percent']}%" for l in levels])

    keyboard = [[InlineKeyboardButton("✅ Confirm", callback_data="mtp_confirm"),
                 InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")]]

    text = (
        f"🎯 *Confirm Multi Take-Profit*\n\n"
        f"Token: *{mtp['token']}* ({mtp['chain'].upper()})\n"
        f"Total amount: {mtp['amount']}\n\n"
        f"Levels:\n{levels_text}"
    )

    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return MTP_CONFIRM


async def mtp_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm and create multi take-profit orders."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    mtp = context.user_data["mtp"]

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id

    chain_type = "solana" if mtp["chain"] == "solana" else "evm"
    wallet = wallet_service.get_default_wallet(user_id, chain_type)

    if not wallet:
        await query.edit_message_text(f"❌ No {chain_type.upper()} wallet found.")
        return ConversationHandler.END

    from bot.config.tokens import get_token_decimals
    decimals = get_token_decimals(mtp["token"], mtp["chain"])
    amount_raw = str(int(mtp["amount"] * (10 ** decimals)))

    order_service.create_multi_tp(
        user_id=user_id,
        wallet_id=wallet.id,
        from_chain=mtp["chain"],
        from_token=mtp["token"],
        to_chain=mtp["chain"],
        to_token="USDC",
        amount=amount_raw,
        levels=mtp["levels"],
    )

    await query.edit_message_text(
        f"✅ *Multi Take-Profit Created!*\n\n{len(mtp['levels'])} levels set for {mtp['token']}",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="main_menu")]]))
    return ConversationHandler.END


async def lo_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel order creation."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("❌ Cancelled.",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="main_menu")]]))
    return ConversationHandler.END


# Conversation handlers
limit_order_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(lo_start, pattern="^lo_(buy|sell|stop)$"),
        CallbackQueryHandler(dca_start, pattern="^dca_create$"),
        CallbackQueryHandler(lo_trailing_start, pattern="^lo_trailing$"),
        CallbackQueryHandler(lo_buydip_start, pattern="^lo_buydip$"),
        CallbackQueryHandler(lo_multitp_start, pattern="^lo_multitp$"),
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
        # Trailing Stop
        TRAIL_CHAIN: [CallbackQueryHandler(trail_chain, pattern="^trfc_")],
        TRAIL_TOKEN: [CallbackQueryHandler(trail_token, pattern="^trft_")],
        TRAIL_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, trail_amount)],
        TRAIL_PERCENT: [MessageHandler(filters.TEXT & ~filters.COMMAND, trail_percent)],
        TRAIL_CONFIRM: [CallbackQueryHandler(trail_confirm, pattern="^trail_confirm$")],
        # Buy Dip
        BUYDIP_CHAIN: [CallbackQueryHandler(buydip_chain, pattern="^bdfc_")],
        BUYDIP_TOKEN: [CallbackQueryHandler(buydip_token, pattern="^bdft_")],
        BUYDIP_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, buydip_amount)],
        BUYDIP_PERCENT: [MessageHandler(filters.TEXT & ~filters.COMMAND, buydip_percent)],
        BUYDIP_CONFIRM: [CallbackQueryHandler(buydip_confirm, pattern="^buydip_confirm$")],
        # Multi Take-Profit
        MTP_CHAIN: [CallbackQueryHandler(mtp_chain, pattern="^mtfc_")],
        MTP_TOKEN: [CallbackQueryHandler(mtp_token, pattern="^mtft_")],
        MTP_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, mtp_amount)],
        MTP_LEVELS: [MessageHandler(filters.TEXT & ~filters.COMMAND, mtp_levels)],
        MTP_CONFIRM: [CallbackQueryHandler(mtp_confirm, pattern="^mtp_confirm$")],
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
            extra = ""
            if order.order_type == OrderType.TRAILING_STOP.value and order.highest_price_seen:
                extra = f" (high: ${order.highest_price_seen:.2f})"
            lines.append(f"{icon} {order.order_type}: {order.from_token}→{order.to_token} @${order.trigger_price:.2f}{extra}")
        text = "\n".join(lines)

    keyboard = [
        [InlineKeyboardButton("🟢 Limit Buy", callback_data="lo_buy"),
         InlineKeyboardButton("🔴 Limit Sell", callback_data="lo_sell")],
        [InlineKeyboardButton("🛑 Stop Loss", callback_data="lo_stop")],
        [InlineKeyboardButton("📉 Trailing Stop", callback_data="lo_trailing"),
         InlineKeyboardButton("💰 Buy Dip", callback_data="lo_buydip")],
        [InlineKeyboardButton("🎯 Multi Take-Profit", callback_data="lo_multitp")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await query.edit_message_text(text, parse_mode="Markdown",
                                   reply_markup=InlineKeyboardMarkup(keyboard))


# Individual callbacks for existing DCAs
dca_view_handler = CallbackQueryHandler(dca_view_callback, pattern="^dca_view_")
dca_actions_handler = CallbackQueryHandler(dca_action_callback, pattern="^dca_(pause|resume|cancel_plan)_")
dca_menu_callback = CallbackQueryHandler(dca_command, pattern="^dca_menu$")
limit_orders_menu_callback_handler = CallbackQueryHandler(limit_orders_menu_callback, pattern="^limit_orders_menu$")

orders_handler = CommandHandler("o", orders_command)
dca_handler = CommandHandler("dca", dca_command)

