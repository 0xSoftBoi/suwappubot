"""User settings handlers — trading, security (2FA, whitelist, limits)."""

from datetime import datetime

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
from bot.services.security import (
    two_factor_auth, audit_logger, whitelist_service, backup_codes_service,
)
from database.db import get_session


# Conversation states
(SET_SLIPPAGE, SET_LIMIT, SECURITY_2FA_VERIFY, SECURITY_2FA_BACKUP_VERIFY,
 SECURITY_WHITELIST_CHAIN, SECURITY_WHITELIST_ADDRESS, SECURITY_WHITELIST_LABEL,
 SECURITY_LIMIT_PER_SWAP, SECURITY_LIMIT_DAILY, SECURITY_LIMIT_2FA_THRESHOLD,
) = range(10)


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
        [InlineKeyboardButton("🔐 Security", callback_data="settings_security")],
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
        [InlineKeyboardButton("🔐 Security", callback_data="settings_security")],
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


# ---------------------------------------------------------------------------
# Security submenu
# ---------------------------------------------------------------------------

async def security_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show security settings submenu."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END

        tfa_enabled = db_user.two_fa_enabled
        user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        per_swap = user_settings.per_swap_limit_usd if user_settings else 5000
        daily = user_settings.daily_limit_usd if user_settings else 50000
        tfa_threshold = user_settings.require_2fa_above_usd if user_settings else 1000
        db_user_id = db_user.id

    # Get whitelist count
    addresses = await whitelist_service.get_addresses(db_user_id)

    text = (
        "🔐 *Security Settings*\n\n"
        f"*Two-Factor Auth:* {'✅ Enabled' if tfa_enabled else '❌ Disabled'}\n\n"
        f"*Spending Limits:*\n"
        f"  • Per Swap: ${per_swap:,.0f}\n"
        f"  • Daily: ${daily:,.0f}\n"
        f"  • 2FA Required Above: ${tfa_threshold:,.0f}\n\n"
        f"*Withdrawal Whitelist:* {len(addresses)} address(es)\n"
    )

    keyboard = []
    if tfa_enabled:
        keyboard.append([
            InlineKeyboardButton("🔓 Disable 2FA", callback_data="sec_2fa_disable"),
            InlineKeyboardButton("🔑 View Backup Codes", callback_data="sec_2fa_backup"),
        ])
    else:
        keyboard.append([InlineKeyboardButton("🔒 Enable 2FA", callback_data="sec_2fa_setup")])

    keyboard.append([InlineKeyboardButton("💰 Set Spending Limits", callback_data="sec_limits")])
    keyboard.append([InlineKeyboardButton(f"📋 Whitelist ({len(addresses)})", callback_data="sec_whitelist")])
    keyboard.append([InlineKeyboardButton("« Back to Settings", callback_data="settings_menu")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return ConversationHandler.END


# -- 2FA Setup ---------------------------------------------------------------

async def tfa_setup_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start 2FA setup — generate TOTP secret and show provisioning URI."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END

        if db_user.two_fa_enabled:
            await query.edit_message_text("2FA is already enabled.")
            return ConversationHandler.END

        username = db_user.username or str(db_user.telegram_id)
        secret, uri = two_factor_auth.generate_totp_secret(db_user.id, username)

        # Store secret temporarily in context until verified
        context.user_data["totp_secret_pending"] = secret
        context.user_data["db_user_id"] = db_user.id

    await query.edit_message_text(
        "🔒 *Setup Two-Factor Authentication*\n\n"
        "1. Open your authenticator app (Google Authenticator, Authy, etc.)\n"
        "2. Add a new account and enter this secret key:\n\n"
        f"`{secret}`\n\n"
        f"Or scan this URI in your app:\n`{uri}`\n\n"
        "3. Enter the 6-digit code from your app to verify:",
        parse_mode="Markdown",
    )
    return SECURITY_2FA_VERIFY


async def tfa_verify_code(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the TOTP code to complete 2FA setup."""
    code = update.message.text.strip()
    secret = context.user_data.get("totp_secret_pending")
    db_user_id = context.user_data.get("db_user_id")

    if not secret or not db_user_id:
        await update.message.reply_text("❌ Session expired. Please start 2FA setup again from /set.")
        return ConversationHandler.END

    if not two_factor_auth.verify_totp(secret, code):
        await update.message.reply_text(
            "❌ Invalid code. Make sure the code is current and try again.\n"
            "Send /cancel to abort."
        )
        return SECURITY_2FA_VERIFY

    # Code verified — save secret and enable 2FA
    with get_session() as session:
        db_user = session.query(User).filter(User.id == db_user_id).first()
        if db_user:
            db_user.totp_secret = secret
            db_user.two_fa_enabled = True

    # Generate backup codes
    backup_codes = await backup_codes_service.generate_codes(db_user_id)
    codes_text = "\n".join(f"  `{c}`" for c in backup_codes)

    await audit_logger.log_event(db_user_id, "2fa_enabled")

    # Cleanup
    context.user_data.pop("totp_secret_pending", None)
    context.user_data.pop("db_user_id", None)

    await update.message.reply_text(
        "✅ *2FA Enabled!*\n\n"
        "Save these backup codes somewhere safe. Each can be used once if you lose your authenticator:\n\n"
        f"{codes_text}\n\n"
        "⚠️ *These codes will not be shown again.*",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")]
        ]),
    )
    return ConversationHandler.END


async def tfa_disable_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Prompt for TOTP code to disable 2FA."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user or not db_user.two_fa_enabled:
            await query.edit_message_text("2FA is not enabled.")
            return ConversationHandler.END

        context.user_data["db_user_id"] = db_user.id
        context.user_data["2fa_action"] = "disable"

    await query.edit_message_text(
        "🔓 *Disable Two-Factor Auth*\n\n"
        "Enter your 6-digit authenticator code to confirm:\n"
        "(or a backup code)\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return SECURITY_2FA_BACKUP_VERIFY


async def tfa_backup_view(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Regenerate and show new backup codes (requires TOTP verification)."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user or not db_user.two_fa_enabled:
            await query.edit_message_text("2FA is not enabled.")
            return ConversationHandler.END

        context.user_data["db_user_id"] = db_user.id
        context.user_data["2fa_action"] = "backup"

    await query.edit_message_text(
        "🔑 *Regenerate Backup Codes*\n\n"
        "Enter your 6-digit authenticator code to confirm:\n\n"
        "⚠️ This will invalidate your old backup codes.\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return SECURITY_2FA_BACKUP_VERIFY


async def tfa_backup_verify(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify TOTP/backup code for disable or backup regeneration."""
    code = update.message.text.strip()
    db_user_id = context.user_data.get("db_user_id")
    action = context.user_data.get("2fa_action")

    if not db_user_id:
        await update.message.reply_text("❌ Session expired. Use /set to start again.")
        return ConversationHandler.END

    # Try TOTP first, then backup code
    with get_session() as session:
        db_user = session.query(User).filter(User.id == db_user_id).first()
        secret = db_user.totp_secret if db_user else None

    verified = False
    if secret and two_factor_auth.verify_totp(secret, code):
        verified = True
    elif await backup_codes_service.verify_backup_code(db_user_id, code):
        verified = True

    if not verified:
        await update.message.reply_text(
            "❌ Invalid code. Try again or send /cancel to abort."
        )
        return SECURITY_2FA_BACKUP_VERIFY

    if action == "disable":
        with get_session() as session:
            db_user = session.query(User).filter(User.id == db_user_id).first()
            if db_user:
                db_user.two_fa_enabled = False
                db_user.totp_secret = None

        await audit_logger.log_event(db_user_id, "2fa_disabled")

        await update.message.reply_text(
            "✅ 2FA has been disabled.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")]
            ]),
        )

    elif action == "backup":
        backup_codes = await backup_codes_service.generate_codes(db_user_id)
        codes_text = "\n".join(f"  `{c}`" for c in backup_codes)

        await update.message.reply_text(
            "🔑 *New Backup Codes*\n\n"
            "Your old codes have been invalidated. Save these:\n\n"
            f"{codes_text}\n\n"
            "⚠️ *These codes will not be shown again.*",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")]
            ]),
        )

    context.user_data.pop("2fa_action", None)
    context.user_data.pop("db_user_id", None)
    return ConversationHandler.END


# -- Spending Limits ---------------------------------------------------------

async def limits_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show spending limits configuration."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END

        user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        per_swap = user_settings.per_swap_limit_usd if user_settings else 5000
        daily = user_settings.daily_limit_usd if user_settings else 50000
        tfa_threshold = user_settings.require_2fa_above_usd if user_settings else 1000

    text = (
        "💰 *Spending Limits*\n\n"
        f"• Per Swap: ${per_swap:,.0f}\n"
        f"• Daily: ${daily:,.0f}\n"
        f"• 2FA Required Above: ${tfa_threshold:,.0f}\n\n"
        "Choose a limit to change:"
    )

    keyboard = [
        [InlineKeyboardButton("Per Swap Limit", callback_data="sec_limit_perswap")],
        [InlineKeyboardButton("Daily Limit", callback_data="sec_limit_daily")],
        [InlineKeyboardButton("2FA Threshold", callback_data="sec_limit_2fa")],
        [InlineKeyboardButton("« Back to Security", callback_data="settings_security")],
    ]

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return ConversationHandler.END


async def limit_perswap_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Prompt for new per-swap limit."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "💰 *Per Swap Limit*\n\n"
        "Enter the maximum USD amount allowed per swap (100 - 1,000,000):\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return SECURITY_LIMIT_PER_SWAP


async def limit_perswap_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle per-swap limit input."""
    try:
        amount = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if not 100 <= amount <= 1_000_000:
            raise ValueError
    except ValueError:
        await update.message.reply_text("❌ Enter a value between 100 and 1,000,000. Send /cancel to abort.")
        return SECURITY_LIMIT_PER_SWAP

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if db_user:
            user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
            if user_settings:
                user_settings.per_swap_limit_usd = amount
                await audit_logger.log_event(db_user.id, "limit_changed", {"type": "per_swap", "value": amount})

    await update.message.reply_text(
        f"✅ Per swap limit set to ${amount:,.0f}",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")]
        ]),
    )
    return ConversationHandler.END


async def limit_daily_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Prompt for new daily limit."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "💰 *Daily Limit*\n\n"
        "Enter the maximum USD amount allowed per day (100 - 10,000,000):\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return SECURITY_LIMIT_DAILY


async def limit_daily_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle daily limit input."""
    try:
        amount = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if not 100 <= amount <= 10_000_000:
            raise ValueError
    except ValueError:
        await update.message.reply_text("❌ Enter a value between 100 and 10,000,000. Send /cancel to abort.")
        return SECURITY_LIMIT_DAILY

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if db_user:
            user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
            if user_settings:
                user_settings.daily_limit_usd = amount
                await audit_logger.log_event(db_user.id, "limit_changed", {"type": "daily", "value": amount})

    await update.message.reply_text(
        f"✅ Daily limit set to ${amount:,.0f}",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")]
        ]),
    )
    return ConversationHandler.END


async def limit_2fa_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Prompt for 2FA threshold."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "💰 *2FA Threshold*\n\n"
        "Swaps above this USD amount will require 2FA confirmation.\n\n"
        "Enter amount (0 = always require 2FA, up to 100,000):\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return SECURITY_LIMIT_2FA_THRESHOLD


async def limit_2fa_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle 2FA threshold input."""
    try:
        amount = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if not 0 <= amount <= 100_000:
            raise ValueError
    except ValueError:
        await update.message.reply_text("❌ Enter a value between 0 and 100,000. Send /cancel to abort.")
        return SECURITY_LIMIT_2FA_THRESHOLD

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if db_user:
            user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
            if user_settings:
                user_settings.require_2fa_above_usd = amount
                await audit_logger.log_event(db_user.id, "limit_changed", {"type": "2fa_threshold", "value": amount})

    if amount == 0:
        msg = "✅ 2FA will be required for all swaps"
    else:
        msg = f"✅ 2FA threshold set to ${amount:,.0f}"

    await update.message.reply_text(
        msg,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")]
        ]),
    )
    return ConversationHandler.END


# -- Withdrawal Whitelist ----------------------------------------------------

async def whitelist_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show withdrawal whitelist."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
        db_user_id = db_user.id

    addresses = await whitelist_service.get_addresses(db_user_id)
    now = datetime.utcnow()

    if not addresses:
        text = (
            "📋 *Withdrawal Whitelist*\n\n"
            "No whitelisted addresses.\n\n"
            "Add addresses to restrict withdrawals to known destinations only. "
            "New addresses have a 24-hour cooldown before they become active."
        )
    else:
        text = f"📋 *Withdrawal Whitelist* ({len(addresses)})\n\n"
        for a in addresses:
            addr_short = f"{a['address'][:8]}...{a['address'][-6:]}"
            label = f" ({a['label']})" if a.get("label") else ""
            cooldown = a.get("cooldown_until")
            if cooldown:
                cooldown_dt = datetime.fromisoformat(cooldown)
                if cooldown_dt > now:
                    remaining = cooldown_dt - now
                    hours = remaining.total_seconds() / 3600
                    status = f"⏳ {hours:.0f}h cooldown"
                else:
                    status = "✅ Active"
            else:
                status = "✅ Active"
            text += f"• `{addr_short}`{label} [{a['chain']}] — {status}\n"

    keyboard = [[InlineKeyboardButton("➕ Add Address", callback_data="sec_wl_add")]]

    # Add remove buttons for each address
    for a in addresses:
        addr_short = f"{a['address'][:6]}...{a['address'][-4:]}"
        label = a.get("label") or addr_short
        keyboard.append([InlineKeyboardButton(f"🗑 Remove {label}", callback_data=f"sec_wl_rm_{a['id']}")])

    keyboard.append([InlineKeyboardButton("« Back to Security", callback_data="settings_security")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    return ConversationHandler.END


async def whitelist_add_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start adding a whitelist address — choose chain."""
    query = update.callback_query
    await query.answer()

    keyboard = [
        [InlineKeyboardButton("Ethereum", callback_data="sec_wl_chain_ethereum"),
         InlineKeyboardButton("Base", callback_data="sec_wl_chain_base")],
        [InlineKeyboardButton("Arbitrum", callback_data="sec_wl_chain_arbitrum"),
         InlineKeyboardButton("Polygon", callback_data="sec_wl_chain_polygon")],
        [InlineKeyboardButton("BSC", callback_data="sec_wl_chain_bsc"),
         InlineKeyboardButton("Solana", callback_data="sec_wl_chain_solana")],
        [InlineKeyboardButton("« Back", callback_data="sec_whitelist")],
    ]

    await query.edit_message_text(
        "➕ *Add Whitelist Address*\n\nSelect the chain:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return SECURITY_WHITELIST_CHAIN


async def whitelist_chain_selected(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle chain selection for whitelist."""
    query = update.callback_query
    await query.answer()

    chain = query.data.replace("sec_wl_chain_", "")
    context.user_data["wl_chain"] = chain

    await query.edit_message_text(
        f"➕ *Add Whitelist Address — {chain.title()}*\n\n"
        "Enter the wallet address:\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )
    return SECURITY_WHITELIST_ADDRESS


async def whitelist_address_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle address input for whitelist."""
    address = update.message.text.strip()

    # Basic validation
    chain = context.user_data.get("wl_chain", "")
    if chain == "solana":
        if len(address) < 32 or len(address) > 44:
            await update.message.reply_text("❌ Invalid Solana address. Try again or /cancel.")
            return SECURITY_WHITELIST_ADDRESS
    else:
        if not address.startswith("0x") or len(address) != 42:
            await update.message.reply_text("❌ Invalid EVM address (must start with 0x, 42 chars). Try again or /cancel.")
            return SECURITY_WHITELIST_ADDRESS

    context.user_data["wl_address"] = address

    await update.message.reply_text(
        "Enter a label for this address (e.g. 'My Coinbase', 'Hardware Wallet'):\n\n"
        "Or send `.` to skip.",
        parse_mode="Markdown",
    )
    return SECURITY_WHITELIST_LABEL


async def whitelist_label_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle label input and save whitelist entry."""
    label = update.message.text.strip()
    if label == ".":
        label = None

    chain = context.user_data.get("wl_chain")
    address = context.user_data.get("wl_address")
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ User not found.")
            return ConversationHandler.END
        db_user_id = db_user.id

    result = await whitelist_service.add_address(db_user_id, chain, address, label)
    await audit_logger.log_event(db_user_id, "whitelist_added", {"chain": chain, "address": address})

    addr_short = f"{address[:8]}...{address[-6:]}"
    label_str = f" ({label})" if label else ""

    # Cleanup
    context.user_data.pop("wl_chain", None)
    context.user_data.pop("wl_address", None)

    await update.message.reply_text(
        f"✅ *Address Whitelisted*\n\n"
        f"`{addr_short}`{label_str} [{chain}]\n\n"
        f"⏳ 24-hour cooldown until: {result['cooldown_until']}\n"
        f"Withdrawals to this address will be allowed after the cooldown.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("📋 View Whitelist", callback_data="sec_whitelist")],
            [InlineKeyboardButton("🔐 Security Settings", callback_data="settings_security")],
        ]),
    )
    return ConversationHandler.END


async def whitelist_remove_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Remove an address from the whitelist."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    whitelist_id = int(query.data.replace("sec_wl_rm_", ""))

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            return
        db_user_id = db_user.id

    success = await whitelist_service.remove_address(db_user_id, whitelist_id)
    if success:
        await audit_logger.log_event(db_user_id, "whitelist_removed", {"whitelist_id": whitelist_id})
        await query.answer("Address removed.")
    else:
        await query.answer("Address not found.")

    # Refresh whitelist view
    await whitelist_menu_callback(update, context)


# -- Security conversation handler -------------------------------------------

security_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(security_menu_callback, pattern="^settings_security$"),
        CallbackQueryHandler(tfa_setup_start, pattern="^sec_2fa_setup$"),
        CallbackQueryHandler(tfa_disable_callback, pattern="^sec_2fa_disable$"),
        CallbackQueryHandler(tfa_backup_view, pattern="^sec_2fa_backup$"),
        CallbackQueryHandler(limits_menu_callback, pattern="^sec_limits$"),
        CallbackQueryHandler(limit_perswap_start, pattern="^sec_limit_perswap$"),
        CallbackQueryHandler(limit_daily_start, pattern="^sec_limit_daily$"),
        CallbackQueryHandler(limit_2fa_start, pattern="^sec_limit_2fa$"),
        CallbackQueryHandler(whitelist_menu_callback, pattern="^sec_whitelist$"),
        CallbackQueryHandler(whitelist_add_chain, pattern="^sec_wl_add$"),
    ],
    states={
        SECURITY_2FA_VERIFY: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, tfa_verify_code),
        ],
        SECURITY_2FA_BACKUP_VERIFY: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, tfa_backup_verify),
        ],
        SECURITY_WHITELIST_CHAIN: [
            CallbackQueryHandler(whitelist_chain_selected, pattern="^sec_wl_chain_"),
        ],
        SECURITY_WHITELIST_ADDRESS: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, whitelist_address_input),
        ],
        SECURITY_WHITELIST_LABEL: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, whitelist_label_input),
        ],
        SECURITY_LIMIT_PER_SWAP: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, limit_perswap_set),
        ],
        SECURITY_LIMIT_DAILY: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, limit_daily_set),
        ],
        SECURITY_LIMIT_2FA_THRESHOLD: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, limit_2fa_set),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", settings_cancel),
        CallbackQueryHandler(settings_callback, pattern="^settings_menu$"),
        CallbackQueryHandler(security_menu_callback, pattern="^settings_security$"),
    ],
    per_message=False,
    per_chat=True,
)

# Whitelist removal (stateless callback, outside conversation)
whitelist_remove_handler = CallbackQueryHandler(whitelist_remove_callback, pattern=r"^sec_wl_rm_\d+$")


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

