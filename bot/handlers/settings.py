"""User settings handlers."""

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
from bot.models.favorites import UserSettings
from bot.models.advanced import RugMonitor
from bot.utils.validators import validate_slippage, validate_amount
from bot.services.x402_service import x402_service
from bot.models.subscription import SubscriptionTier
from database.db import get_session


# Conversation states
SET_SLIPPAGE, SET_LIMIT = range(2)


async def settings_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /settings command."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        
        user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        if not user_settings:
            user_settings = UserSettings(user_id=db_user.id)
            session.add(user_settings)
            session.flush()
        
        slippage = user_settings.default_slippage_bps / 100
        per_swap_limit = user_settings.per_swap_limit_usd
        daily_limit = user_settings.daily_limit_usd
        require_2fa = user_settings.require_2fa_above_usd
        notify_complete = user_settings.notify_on_complete
        panic_sell = user_settings.panic_sell_enabled

        # Count active rug monitors
        active_monitors = session.query(RugMonitor).filter(
            RugMonitor.user_id == db_user.id,
            RugMonitor.is_active == True,
        ).count()

    text = (
        "⚙️ *Settings*\n\n"
        f"*Trading:*\n"
        f"  • Default Slippage: {slippage}%\n\n"
        f"*Anti-Rug:*\n"
        f"  • Panic Sell (frontrun): {'🛡️ Enabled' if panic_sell else '❌ Disabled'}\n"
        f"  • Rug Monitors: {active_monitors} active\n\n"
        f"*Limits:*\n"
        f"  • Per Swap: ${per_swap_limit:,.0f}\n"
        f"  • Daily: ${daily_limit:,.0f}\n"
        f"  • 2FA Required Above: ${require_2fa:,.0f}\n\n"
        f"*Notifications:*\n"
        f"  • Swap Complete: {'✅' if notify_complete else '❌'}\n"
    )

    keyboard = [
        [InlineKeyboardButton("📊 Set Slippage", callback_data="settings_slippage"),
         InlineKeyboardButton("💰 Set Limits", callback_data="settings_limits")],
        [InlineKeyboardButton(f"{'🛡️' if not panic_sell else '❌'} {'Enable' if not panic_sell else 'Disable'} Panic Sell", callback_data="settings_toggle_panic")],
        [InlineKeyboardButton(f"🛡️ Anti-Rug ({active_monitors})", callback_data="settings_antirug")],
        [InlineKeyboardButton(f"{'🔔' if notify_complete else '🔕'} Toggle Notifications", callback_data="settings_toggle_notify")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")]
    ]

    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))


async def settings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle settings menu callback."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        
        user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        if not user_settings:
            user_settings = UserSettings(user_id=db_user.id)
            session.add(user_settings)
            session.flush()
        
        slippage = user_settings.default_slippage_bps / 100
        per_swap_limit = user_settings.per_swap_limit_usd
        daily_limit = user_settings.daily_limit_usd
        require_2fa = user_settings.require_2fa_above_usd
        notify_complete = user_settings.notify_on_complete
        panic_sell = user_settings.panic_sell_enabled

        # Count active rug monitors
        active_monitors = session.query(RugMonitor).filter(
            RugMonitor.user_id == db_user.id,
            RugMonitor.is_active == True,
        ).count()

    text = (
        "⚙️ *Settings*\n\n"
        f"*Trading:*\n"
        f"  • Default Slippage: {slippage}%\n\n"
        f"*Anti-Rug:*\n"
        f"  • Panic Sell (frontrun): {'🛡️ Enabled' if panic_sell else '❌ Disabled'}\n"
        f"  • Rug Monitors: {active_monitors} active\n\n"
        f"*Limits:*\n"
        f"  • Per Swap: ${per_swap_limit:,.0f}\n"
        f"  • Daily: ${daily_limit:,.0f}\n"
        f"  • 2FA Required Above: ${require_2fa:,.0f}\n\n"
        f"*Notifications:*\n"
        f"  • Swap Complete: {'✅' if notify_complete else '❌'}\n"
    )

    keyboard = [
        [InlineKeyboardButton("📊 Set Slippage", callback_data="settings_slippage"),
         InlineKeyboardButton("💰 Set Limits", callback_data="settings_limits")],
        [InlineKeyboardButton(f"{'🛡️' if not panic_sell else '❌'} {'Enable' if not panic_sell else 'Disable'} Panic Sell", callback_data="settings_toggle_panic")],
        [InlineKeyboardButton(f"🛡️ Anti-Rug ({active_monitors})", callback_data="settings_antirug")],
        [InlineKeyboardButton(f"{'🔔' if notify_complete else '🔕'} Toggle Notifications", callback_data="settings_toggle_notify")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")]
    ]

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))


async def toggle_notify_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle notification settings."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if db_user:
            user_settings = session.query(UserSettings).filter(
                UserSettings.user_id == db_user.id
            ).first()
            
            if user_settings:
                user_settings.notify_on_complete = not user_settings.notify_on_complete
    
    # Refresh settings view
    await settings_callback(update, context)


async def toggle_panic_sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle Panic Sell protection."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    # Check tier
    tier = await x402_service.get_tier(user.id) # user.id here is telegram id, x402 handles it or needs DB id
    # Wait, x402_service usually works with DB user ID or Telegram ID?
    # Let's check x402_service again - it uses user_id which usually maps to DB ID in my code.
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user: return
        
        tier = await x402_service.get_tier(db_user.id)
        if tier not in [SubscriptionTier.PRO, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]:
            await query.answer("⭐ Pro Tier Required For Panic Sell Protection", show_alert=True)
            return

        user_settings = session.query(UserSettings).filter(
            UserSettings.user_id == db_user.id
        ).first()
        
        if user_settings:
            user_settings.panic_sell_enabled = not user_settings.panic_sell_enabled
            status = "enabled" if user_settings.panic_sell_enabled else "disabled"
            await query.answer(f"🛡️ Panic Sell {status}!")

    # Refresh settings view
    await settings_callback(update, context)


async def slippage_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start slippage setting flow."""
    query = update.callback_query
    await query.answer()
    
    await query.edit_message_text(
        "📊 *Set Default Slippage*\n\n"
        "Enter slippage percentage (0.1 - 50):\n\n"
        "Examples:\n"
        "• `0.5` for 0.5%\n"
        "• `1` for 1%\n"
        "• `3` for 3%\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    
    return SET_SLIPPAGE


async def slippage_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle slippage input."""
    user = update.effective_user
    slippage_bps = validate_slippage(update.message.text)
    
    if slippage_bps is None:
        await update.message.reply_text(
            "❌ Invalid slippage. Enter a value between 0.1 and 50.\n"
            "Send /cancel to abort."
        )
        return SET_SLIPPAGE
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if db_user:
            user_settings = session.query(UserSettings).filter(
                UserSettings.user_id == db_user.id
            ).first()
            
            if user_settings:
                user_settings.default_slippage_bps = slippage_bps
    
    slippage_pct = slippage_bps / 100
    
    await update.message.reply_text(
        f"✅ Default slippage set to {slippage_pct}%",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu")]
        ])
    )
    
    return ConversationHandler.END


async def settings_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel settings flow."""
    await update.message.reply_text(
        "❌ Settings change cancelled.",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu")]
        ])
    )
    return ConversationHandler.END


async def antirug_settings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show anti-rug protection settings with monitored tokens."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return

        monitors = session.query(RugMonitor).filter(
            RugMonitor.user_id == db_user.id,
            RugMonitor.is_active == True,
        ).order_by(RugMonitor.created_at.desc()).limit(10).all()

    if not monitors:
        text = (
            "🛡️ *Anti-Rug Protection*\n\n"
            "No active monitors.\n\n"
            "Tokens are automatically monitored after you buy them. "
            "If a rug pull is detected, you'll be alerted and your "
            "position can be auto-sold."
        )
        keyboard = [[InlineKeyboardButton("« Back to Settings", callback_data="settings_menu")]]
    else:
        text = f"🛡️ *Anti-Rug Protection*\n\n*{len(monitors)} Active Monitors:*\n\n"
        keyboard = []

        for m in monitors:
            token_short = f"{m.token_address[:6]}...{m.token_address[-4:]}"
            auto_sell_icon = "🟢" if m.auto_sell_enabled else "🔴"
            text += (
                f"• `{token_short}` ({m.chain}) "
                f"Auto-sell: {auto_sell_icon}\n"
            )
            keyboard.append([
                InlineKeyboardButton(
                    f"{'🔴' if m.auto_sell_enabled else '🟢'} Toggle {token_short}",
                    callback_data=f"rug_toggle_{m.id}",
                ),
                InlineKeyboardButton(
                    f"🗑 Remove",
                    callback_data=f"rug_disable_{m.id}",
                ),
            ])

        keyboard.append([InlineKeyboardButton("« Back to Settings", callback_data="settings_menu")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))


async def rug_toggle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle auto-sell for a specific rug monitor."""
    query = update.callback_query
    user = update.effective_user

    # Extract monitor ID from callback data
    monitor_id = int(query.data.split("_")[-1])

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("User not found.")
            return

    from bot.services.rug_monitor import rug_monitor_service
    new_state = rug_monitor_service.toggle_auto_sell(db_user.id, monitor_id)

    if new_state is None:
        await query.answer("Monitor not found.")
        return

    status = "enabled" if new_state else "disabled"
    await query.answer(f"Auto-sell {status}!")

    # Refresh the anti-rug settings view
    await antirug_settings_callback(update, context)


async def rug_disable_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Disable a rug monitor."""
    query = update.callback_query
    user = update.effective_user

    monitor_id = int(query.data.split("_")[-1])

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("User not found.")
            return

    from bot.services.rug_monitor import rug_monitor_service
    success = rug_monitor_service.deactivate_monitor(db_user.id, monitor_id)

    if success:
        await query.answer("Monitor disabled.")
    else:
        await query.answer("Monitor not found.")

    # Refresh the anti-rug settings view
    await antirug_settings_callback(update, context)


async def rug_sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle manual sell from rug alert."""
    query = update.callback_query
    await query.answer("Executing emergency sell...")
    user = update.effective_user

    monitor_id = int(query.data.split("_")[-1])

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            return

        monitor = session.query(RugMonitor).filter(
            RugMonitor.id == monitor_id,
            RugMonitor.user_id == db_user.id,
        ).first()

    if not monitor:
        await query.edit_message_text("Monitor not found.")
        return

    from bot.services.rug_monitor import rug_monitor_service
    sell_tx_id = await rug_monitor_service.execute_emergency_sell(monitor)

    if sell_tx_id:
        await query.edit_message_text(
            f"✅ Emergency sell executed (TX #{sell_tx_id}).\n"
            f"Check your wallet for the proceeds."
        )
    else:
        await query.edit_message_text(
            "❌ Emergency sell failed. Check your balance or try manually."
        )


# Conversation handler for slippage
slippage_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(slippage_start, pattern="^settings_slippage$"),
    ],
    states={
        SET_SLIPPAGE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, slippage_set),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", settings_cancel),
    ],
    per_message=False,
    per_chat=True,
)


# Create handlers
settings_handler = CommandHandler("set", settings_command)
toggle_notify_handler = CallbackQueryHandler(toggle_notify_callback, pattern="^settings_toggle_notify$")
toggle_panic_handler = CallbackQueryHandler(toggle_panic_sell_callback, pattern="^settings_toggle_panic$")
settings_menu_callback = CallbackQueryHandler(settings_callback, pattern="^settings_menu$")
antirug_handler = CallbackQueryHandler(antirug_settings_callback, pattern="^settings_antirug$")
rug_toggle_handler = CallbackQueryHandler(rug_toggle_callback, pattern=r"^rug_toggle_\d+$")
rug_disable_handler = CallbackQueryHandler(rug_disable_callback, pattern=r"^rug_disable_\d+$")
rug_sell_handler = CallbackQueryHandler(rug_sell_callback, pattern=r"^rug_sell_\d+$")

