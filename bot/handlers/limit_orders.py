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
from database.db import get_session


wallet_service = WalletService()

# States
LO_TOKEN, LO_AMOUNT, LO_PRICE, LO_CONFIRM = range(4)
DCA_TOKEN, DCA_AMOUNT, DCA_INTERVAL, DCA_CONFIRM = range(100, 104)


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
            lines.append(f"{icon} {order.from_token}→{order.to_token} @${order.trigger_price:.2f}")
        text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("🟢 Limit Buy", callback_data="lo_buy"),
         InlineKeyboardButton("🔴 Limit Sell", callback_data="lo_sell")],
        [InlineKeyboardButton("🛑 Stop Loss", callback_data="lo_stop")],
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
    
    if not orders:
        text = "📊 *DCA Orders*\n\n_No active DCAs._\n\nAutomate regular purchases!"
    else:
        lines = ["📊 *Your DCAs*\n"]
        for order in orders:
            icon = "🟢" if order.status == DCAStatus.ACTIVE.value else "⏸"
            lines.append(f"{icon} {order.to_token}: ${order.amount_per_execution} every {order.interval_hours}h")
        text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("➕ Create DCA", callback_data="dca_create")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
    
    await update.message.reply_text(text, parse_mode="Markdown",
                                     reply_markup=InlineKeyboardMarkup(keyboard))


async def lo_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start limit order creation."""
    query = update.callback_query
    await query.answer()
    
    order_type = query.data.replace("lo_", "")
    context.user_data["lo_type"] = order_type
    
    tokens = ["ETH", "BTC", "SOL", "LINK", "UNI"]
    keyboard = [[InlineKeyboardButton(t, callback_data=f"lot_{t}") for t in tokens[:3]],
                [InlineKeyboardButton(t, callback_data=f"lot_{t}") for t in tokens[3:]],
                [InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")]]
    
    await query.edit_message_text(
        f"📋 *{order_type.title()} Order*\n\nSelect token:",
        parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return LO_TOKEN


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
        context.user_data["lo_amount"] = amount
    except ValueError:
        await update.message.reply_text("❌ Invalid number.")
        return LO_AMOUNT
    
    await update.message.reply_text(f"Amount: {amount}\n\nEnter trigger price:")
    return LO_PRICE


async def lo_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle price entry."""
    try:
        price = float(update.message.text.strip().replace("$", ""))
        context.user_data["lo_trigger"] = price
    except ValueError:
        await update.message.reply_text("❌ Invalid price.")
        return LO_PRICE
    
    token = context.user_data["lo_token"]
    amount = context.user_data["lo_amount"]
    
    keyboard = [[InlineKeyboardButton("✅ Confirm", callback_data="lo_confirm"),
                 InlineKeyboardButton("❌ Cancel", callback_data="lo_cancel")]]
    
    await update.message.reply_text(
        f"📋 *Confirm Order*\n\n{token}: {amount} @ ${price:.2f}",
        parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return LO_CONFIRM


async def lo_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm limit order."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id
    
    wallet = wallet_service.get_default_wallet(user_id)
    if not wallet:
        await query.edit_message_text("❌ No wallet found.")
        return ConversationHandler.END
    
    token = context.user_data["lo_token"]
    amount = context.user_data["lo_amount"]
    price = context.user_data["lo_trigger"]
    order_type = context.user_data["lo_type"]
    
    from_token = "USDC" if order_type == "buy" else token
    to_token = token if order_type == "buy" else "USDC"
    
    order_service.create_limit_order(
        user_id=user_id, wallet_id=wallet.id,
        order_type=f"limit_{order_type}", from_chain="ethereum",
        from_token=from_token, to_chain="ethereum", to_token=to_token,
        amount=str(int(amount * 10**18)), trigger_price=price)
    
    await query.edit_message_text(f"✅ Order created! {token} @ ${price:.2f}",
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
    entry_points=[CallbackQueryHandler(lo_start, pattern="^lo_(buy|sell|stop)$")],
    states={
        LO_TOKEN: [CallbackQueryHandler(lo_token, pattern="^lot_")],
        LO_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, lo_amount)],
        LO_PRICE: [MessageHandler(filters.TEXT & ~filters.COMMAND, lo_price)],
        LO_CONFIRM: [CallbackQueryHandler(lo_confirm, pattern="^lo_confirm$")],
    },
    fallbacks=[CallbackQueryHandler(lo_cancel, pattern="^lo_cancel$")],
)

orders_handler = CommandHandler("o", orders_command)
dca_handler = CommandHandler("dca", dca_command)

