"""Price alert handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler,
    ConversationHandler, MessageHandler, filters
)

from bot.models.user import User
from bot.models.advanced import AdvancedPriceAlert as PriceAlert, AlertType
from bot.services.alerts import alert_service
from bot.services.price_service import price_service
from bot.utils.formatters import format_usd
from database.db import get_session


# Conversation states
SELECT_TOKEN, SELECT_TYPE, ENTER_PRICE = range(3)


async def alerts_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /alerts command - show user's alerts."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    alerts = alert_service.get_user_alerts(user_id)
    
    if not alerts:
        text = (
            "🔔 *Price Alerts*\n\n"
            "_No active alerts._\n\n"
            "Create alerts to get notified when prices change!"
        )
        keyboard = [
            [InlineKeyboardButton("➕ Create Alert", callback_data="alert_create")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
    else:
        lines = ["🔔 *Your Price Alerts*\n"]
        
        for alert in alerts:
            status = "✅" if alert.is_active else "⏸"
            
            if alert.alert_type == AlertType.PRICE_ABOVE.value:
                condition = f"above ${alert.target_price:.4f}"
            elif alert.alert_type == AlertType.PRICE_BELOW.value:
                condition = f"below ${alert.target_price:.4f}"
            else:
                condition = f"±{alert.percent_threshold}%"
            
            lines.append(f"{status} {alert.token_symbol} {condition}")
        
        text = "\n".join(lines)
        
        keyboard = [
            [InlineKeyboardButton("➕ Create Alert", callback_data="alert_create")],
            [InlineKeyboardButton("🗑 Manage Alerts", callback_data="alert_manage")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
    
    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def alert_create_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start alert creation flow."""
    query = update.callback_query
    await query.answer()
    
    text = (
        "🔔 *Create Price Alert*\n\n"
        "Enter the token symbol you want to track:\n\n"
        "Examples: `ETH`, `BTC`, `SOL`, `USDC`"
    )
    
    await query.edit_message_text(text, parse_mode="Markdown")
    return SELECT_TOKEN


async def alert_select_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle token selection."""
    token = update.message.text.strip().upper()
    
    # Validate token
    prices = await price_service.get_prices([token])
    if not prices.get(token):
        await update.message.reply_text(
            f"❌ Token `{token}` not found. Please try another.",
            parse_mode="Markdown",
        )
        return SELECT_TOKEN
    
    context.user_data["alert_token"] = token
    context.user_data["alert_current_price"] = prices[token]
    
    keyboard = [
        [
            InlineKeyboardButton("📈 Price Above", callback_data="alert_type_above"),
            InlineKeyboardButton("📉 Price Below", callback_data="alert_type_below"),
        ],
        [
            InlineKeyboardButton("📊 % Change", callback_data="alert_type_percent"),
        ],
        [InlineKeyboardButton("❌ Cancel", callback_data="alert_cancel")],
    ]
    
    await update.message.reply_text(
        f"🔔 *Alert for {token}*\n\n"
        f"Current price: ${prices[token]:.4f}\n\n"
        f"Select alert type:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return SELECT_TYPE


async def alert_select_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle alert type selection."""
    query = update.callback_query
    await query.answer()
    
    alert_type = query.data.replace("alert_type_", "")
    context.user_data["alert_type"] = alert_type
    
    token = context.user_data["alert_token"]
    current_price = context.user_data["alert_current_price"]
    
    if alert_type == "above":
        text = f"Enter the price above which you want to be alerted:\n\nCurrent {token}: ${current_price:.4f}"
    elif alert_type == "below":
        text = f"Enter the price below which you want to be alerted:\n\nCurrent {token}: ${current_price:.4f}"
    else:
        text = "Enter the percentage change to alert on (e.g., 5 for ±5%):"
    
    await query.edit_message_text(text)
    return ENTER_PRICE


async def alert_enter_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle price/percentage entry."""
    user = update.effective_user
    
    try:
        value = float(update.message.text.strip().replace("$", "").replace("%", ""))
    except ValueError:
        await update.message.reply_text("❌ Please enter a valid number.")
        return ENTER_PRICE
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id
    
    token = context.user_data["alert_token"]
    alert_type_key = context.user_data["alert_type"]
    
    # Map to AlertType
    type_map = {
        "above": AlertType.PRICE_ABOVE.value,
        "below": AlertType.PRICE_BELOW.value,
        "percent": AlertType.PERCENT_CHANGE.value,
    }
    
    alert_type = type_map[alert_type_key]
    
    # Create alert
    if alert_type_key == "percent":
        alert = alert_service.create_alert(
            user_id=user_id,
            token_symbol=token,
            alert_type=alert_type,
            percent_threshold=value,
        )
        condition = f"±{value}%"
    else:
        alert = alert_service.create_alert(
            user_id=user_id,
            token_symbol=token,
            alert_type=alert_type,
            target_price=value,
        )
        condition = f"{'above' if alert_type_key == 'above' else 'below'} ${value:.4f}"
    
    await update.message.reply_text(
        f"✅ *Alert Created!*\n\n"
        f"Token: {token}\n"
        f"Condition: {condition}\n\n"
        f"You'll be notified when triggered.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔔 View Alerts", callback_data="alerts_menu")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]),
    )
    
    # Clear context
    context.user_data.pop("alert_token", None)
    context.user_data.pop("alert_type", None)
    context.user_data.pop("alert_current_price", None)
    
    return ConversationHandler.END


async def alert_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel alert creation."""
    query = update.callback_query
    await query.answer()
    
    context.user_data.pop("alert_token", None)
    context.user_data.pop("alert_type", None)
    context.user_data.pop("alert_current_price", None)
    
    await query.edit_message_text(
        "❌ Alert creation cancelled.",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]),
    )
    return ConversationHandler.END


async def alerts_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show alerts menu (callback version)."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    alerts = alert_service.get_user_alerts(user_id)
    
    if not alerts:
        text = "🔔 *Price Alerts*\n\n_No active alerts._"
        keyboard = [
            [InlineKeyboardButton("➕ Create Alert", callback_data="alert_create")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
    else:
        lines = ["🔔 *Your Price Alerts*\n"]
        
        for alert in alerts:
            status = "✅" if alert.is_active else "⏸"
            
            if alert.alert_type == AlertType.PRICE_ABOVE.value:
                condition = f"above ${alert.target_price:.4f}"
            elif alert.alert_type == AlertType.PRICE_BELOW.value:
                condition = f"below ${alert.target_price:.4f}"
            else:
                condition = f"±{alert.percent_threshold}%"
            
            lines.append(f"{status} {alert.token_symbol} {condition}")
        
        text = "\n".join(lines)
        
        keyboard = [
            [InlineKeyboardButton("➕ Create Alert", callback_data="alert_create")],
            [InlineKeyboardButton("🗑 Manage Alerts", callback_data="alert_manage")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Create conversation handler
alert_conversation = ConversationHandler(
    entry_points=[CallbackQueryHandler(alert_create_callback, pattern="^alert_create$")],
    states={
        SELECT_TOKEN: [MessageHandler(filters.TEXT & ~filters.COMMAND, alert_select_token)],
        SELECT_TYPE: [CallbackQueryHandler(alert_select_type, pattern="^alert_type_")],
        ENTER_PRICE: [MessageHandler(filters.TEXT & ~filters.COMMAND, alert_enter_price)],
    },
    fallbacks=[
        CallbackQueryHandler(alert_cancel, pattern="^alert_cancel$"),
        CommandHandler("cancel", alert_cancel),
    ],
)

# Create handlers
alerts_handler = CommandHandler("alerts", alerts_command)

