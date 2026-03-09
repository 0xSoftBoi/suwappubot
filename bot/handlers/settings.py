"""User settings handlers."""

import re
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User, Wallet
from bot.models.favorites import UserSettings
from bot.utils.validators import validate_slippage, validate_amount
from bot.services.x402_service import x402_service
from bot.models.subscription import SubscriptionTier
from database.db import get_session


# Conversation states
SET_SLIPPAGE, SET_LIMIT, SET_RECOVERY_EMAIL = range(3)


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

        # MEV protection from User model
        mev_enabled = getattr(db_user, "mev_protection_enabled", True)
        tip_priority = getattr(db_user, "jito_tip_priority", "medium")

    mev_icon = "🛡️" if mev_enabled else "⚡"
    mev_label = "Secure (MEV Protected)" if mev_enabled else "Fast (Standard)"

    text = (
        "⚙️ *Settings*\n\n"
        f"*MEV Protection:*\n"
        f"  • Mode: {mev_icon} {mev_label}\n"
        f"  • Jito Tip: {tip_priority.title()}\n\n"
        f"*Trading:*\n"
        f"  • Default Slippage: {slippage}%\n\n"
        f"*Anti-Rug:*\n"
        f"  • Panic Sell (frontrun): {'🛡️ Enabled' if panic_sell else '❌ Disabled'}\n\n"
        f"*Limits:*\n"
        f"  • Per Swap: ${per_swap_limit:,.0f}\n"
        f"  • Daily: ${daily_limit:,.0f}\n"
        f"  • 2FA Required Above: ${require_2fa:,.0f}\n\n"
        f"*Notifications:*\n"
        f"  • Swap Complete: {'✅' if notify_complete else '❌'}\n"
    )

    keyboard = [
        [InlineKeyboardButton(f"{mev_icon} MEV: {mev_label}", callback_data="settings_toggle_mev"),
         InlineKeyboardButton(f"💰 Jito Tip: {tip_priority.title()}", callback_data="settings_cycle_tip")],
        [InlineKeyboardButton("📊 Set Slippage", callback_data="settings_slippage"),
         InlineKeyboardButton("💰 Set Limits", callback_data="settings_limits")],
        [InlineKeyboardButton(f"{'🛡️' if not panic_sell else '❌'} {'Enable' if not panic_sell else 'Disable'} Panic Sell", callback_data="settings_toggle_panic")],
        [InlineKeyboardButton(f"{'🔔' if notify_complete else '🔕'} Toggle Notifications", callback_data="settings_toggle_notify")],
        [InlineKeyboardButton("🔑 Recovery", callback_data="settings_recovery")],
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

        # MEV protection from User model
        mev_enabled = getattr(db_user, "mev_protection_enabled", True)
        tip_priority = getattr(db_user, "jito_tip_priority", "medium")

    mev_icon = "🛡️" if mev_enabled else "⚡"
    mev_label = "Secure (MEV Protected)" if mev_enabled else "Fast (Standard)"

    text = (
        "⚙️ *Settings*\n\n"
        f"*MEV Protection:*\n"
        f"  • Mode: {mev_icon} {mev_label}\n"
        f"  • Jito Tip: {tip_priority.title()}\n\n"
        f"*Trading:*\n"
        f"  • Default Slippage: {slippage}%\n\n"
        f"*Anti-Rug:*\n"
        f"  • Panic Sell (frontrun): {'🛡️ Enabled' if panic_sell else '❌ Disabled'}\n\n"
        f"*Limits:*\n"
        f"  • Per Swap: ${per_swap_limit:,.0f}\n"
        f"  • Daily: ${daily_limit:,.0f}\n"
        f"  • 2FA Required Above: ${require_2fa:,.0f}\n\n"
        f"*Notifications:*\n"
        f"  • Swap Complete: {'✅' if notify_complete else '❌'}\n"
    )

    keyboard = [
        [InlineKeyboardButton(f"{mev_icon} MEV: {mev_label}", callback_data="settings_toggle_mev"),
         InlineKeyboardButton(f"💰 Jito Tip: {tip_priority.title()}", callback_data="settings_cycle_tip")],
        [InlineKeyboardButton("📊 Set Slippage", callback_data="settings_slippage"),
         InlineKeyboardButton("💰 Set Limits", callback_data="settings_limits")],
        [InlineKeyboardButton(f"{'🛡️' if not panic_sell else '❌'} {'Enable' if not panic_sell else 'Disable'} Panic Sell", callback_data="settings_toggle_panic")],
        [InlineKeyboardButton(f"{'🔔' if notify_complete else '🔕'} Toggle Notifications", callback_data="settings_toggle_notify")],
        [InlineKeyboardButton("🔑 Recovery", callback_data="settings_recovery")],
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


# === Recovery Handlers ===


async def recovery_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /recovery command - show recovery status."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return

        has_turnkey = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.wallet_provider == "turnkey",
        ).first() is not None

        recovery_email = db_user.recovery_email
        recovery_setup_at = db_user.recovery_setup_at

    if not has_turnkey:
        await update.message.reply_text(
            "🔑 *Wallet Recovery*\n\n"
            "Recovery is only available for Turnkey (passkey) wallets.\n\n"
            "Your current wallet uses local key storage. "
            "To use Turnkey wallets, create one via the webapp.",
            parse_mode="Markdown",
        )
        return

    if recovery_email:
        masked = recovery_email[:3] + "***" + recovery_email[recovery_email.index("@"):]
        text = (
            "🔑 *Wallet Recovery*\n\n"
            f"*Status:* Recovery set up\n"
            f"*Email:* `{masked}`\n"
            f"*Since:* {recovery_setup_at.strftime('%Y-%m-%d') if recovery_setup_at else 'Unknown'}\n\n"
            "If you lose access, use this email to recover your wallet."
        )
        keyboard = [
            [InlineKeyboardButton("Update Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("« Settings", callback_data="settings_menu")],
        ]
    else:
        text = (
            "🔑 *Wallet Recovery*\n\n"
            "No recovery email set up yet.\n\n"
            "Set up a recovery email to protect your wallet. "
            "If you lose access to your Telegram or passkey device, "
            "you can recover your wallet using this email."
        )
        keyboard = [
            [InlineKeyboardButton("Set Up Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("« Settings", callback_data="settings_menu")],
        ]

    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def recovery_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle recovery menu callback from settings."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return

        has_turnkey = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.wallet_provider == "turnkey",
        ).first() is not None

        recovery_email = db_user.recovery_email
        recovery_setup_at = db_user.recovery_setup_at

    if not has_turnkey:
        await query.edit_message_text(
            "🔑 *Wallet Recovery*\n\n"
            "Recovery is only available for Turnkey (passkey) wallets.\n\n"
            "Your current wallet uses local key storage.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Settings", callback_data="settings_menu")],
            ]),
        )
        return

    if recovery_email:
        masked = recovery_email[:3] + "***" + recovery_email[recovery_email.index("@"):]
        text = (
            "🔑 *Wallet Recovery*\n\n"
            f"*Status:* Recovery set up\n"
            f"*Email:* `{masked}`\n"
            f"*Since:* {recovery_setup_at.strftime('%Y-%m-%d') if recovery_setup_at else 'Unknown'}\n\n"
            "If you lose access, use this email to recover your wallet."
        )
        keyboard = [
            [InlineKeyboardButton("Update Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("« Settings", callback_data="settings_menu")],
        ]
    else:
        text = (
            "🔑 *Wallet Recovery*\n\n"
            "No recovery email set up yet.\n\n"
            "Set up a recovery email to protect your wallet. "
            "If you lose access to your Telegram or passkey device, "
            "you can recover your wallet using this email."
        )
        keyboard = [
            [InlineKeyboardButton("Set Up Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("« Settings", callback_data="settings_menu")],
        ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def recovery_setup_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start recovery email setup flow."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "🔑 *Set Recovery Email*\n\n"
        "Enter your recovery email address:\n\n"
        "This email will be used to recover your wallet if you "
        "lose access to your Telegram account or passkey device.\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )

    return SET_RECOVERY_EMAIL


async def recovery_email_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle recovery email input."""
    user = update.effective_user
    email = update.message.text.strip()

    # Basic email validation
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        await update.message.reply_text(
            "Invalid email address. Please enter a valid email.\n"
            "Send /cancel to abort."
        )
        return SET_RECOVERY_EMAIL

    from bot.services.wallet_recovery import WalletRecoveryService
    recovery_service = WalletRecoveryService()
    success = await recovery_service.setup_email_recovery(user.id, email)

    if success:
        masked = email[:3] + "***" + email[email.index("@"):]
        await update.message.reply_text(
            f"Recovery email set to `{masked}`\n\n"
            "You can now recover your wallet using this email if you lose access.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu")],
            ]),
        )
    else:
        await update.message.reply_text(
            "Failed to set recovery email. Make sure you have a Turnkey wallet.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu")],
            ]),
        )

    return ConversationHandler.END


# === Limits Handlers ===


async def limits_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start limits setting flow."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return ConversationHandler.END

        user_settings = session.query(UserSettings).filter(
            UserSettings.user_id == db_user.id
        ).first()
        per_swap = user_settings.per_swap_limit_usd if user_settings else 5000
        daily = user_settings.daily_limit_usd if user_settings else 50000

        # Check for Turnkey wallets
        has_turnkey = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.wallet_provider == "turnkey",
        ).first() is not None

    turnkey_note = ""
    if has_turnkey:
        turnkey_note = (
            "\n_Turnkey wallets: limits are also enforced at the "
            "infrastructure level. Changes sync automatically._\n"
        )

    await query.edit_message_text(
        "*Set Spending Limits*\n\n"
        f"Current limits:\n"
        f"  Per Swap: ${per_swap:,.0f}\n"
        f"  Daily: ${daily:,.0f}\n"
        f"{turnkey_note}\n"
        "Enter new limits in format:\n"
        "`per_swap daily`\n\n"
        "Examples:\n"
        "  `5000 50000` - $5k per swap, $50k daily\n"
        "  `1000 10000` - $1k per swap, $10k daily\n\n"
        "Send /cancel to abort.",
        parse_mode="Markdown",
    )

    return SET_LIMIT


async def limits_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle limits input."""
    user = update.effective_user
    text = update.message.text.strip()

    # Parse "per_swap daily" format
    parts = text.split()
    if len(parts) != 2:
        await update.message.reply_text(
            "Please enter two numbers: per_swap daily\n"
            "Example: `5000 50000`\n"
            "Send /cancel to abort.",
            parse_mode="Markdown",
        )
        return SET_LIMIT

    try:
        per_swap = float(parts[0])
        daily = float(parts[1])
    except ValueError:
        await update.message.reply_text(
            "Invalid numbers. Please enter two numbers.\n"
            "Send /cancel to abort."
        )
        return SET_LIMIT

    if per_swap <= 0 or daily <= 0:
        await update.message.reply_text(
            "Limits must be positive numbers.\n"
            "Send /cancel to abort."
        )
        return SET_LIMIT

    if per_swap > daily:
        await update.message.reply_text(
            "Per-swap limit cannot exceed daily limit.\n"
            "Send /cancel to abort."
        )
        return SET_LIMIT

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return ConversationHandler.END

        user_settings = session.query(UserSettings).filter(
            UserSettings.user_id == db_user.id
        ).first()

        if user_settings:
            user_settings.per_swap_limit_usd = per_swap
            user_settings.daily_limit_usd = daily
        db_user_id = db_user.id

    # Sync to Turnkey if applicable
    from bot.services.security import sync_limits_to_turnkey
    await sync_limits_to_turnkey(db_user_id)

    await update.message.reply_text(
        f"Limits updated:\n"
        f"  Per Swap: ${per_swap:,.0f}\n"
        f"  Daily: ${daily:,.0f}",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("Settings", callback_data="settings_menu")]
        ]),
    )

    return ConversationHandler.END


async def limits_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /limits command - show current limits and Turnkey policy status."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return

        user_settings = session.query(UserSettings).filter(
            UserSettings.user_id == db_user.id
        ).first()
        per_swap = user_settings.per_swap_limit_usd if user_settings else 5000
        daily = user_settings.daily_limit_usd if user_settings else 50000
        require_2fa = user_settings.require_2fa_above_usd if user_settings else 1000

        turnkey_wallets = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.wallet_provider == "turnkey",
            Wallet.is_active == True,
        ).all()

    text = (
        "*Spending Limits*\n\n"
        f"*App-Level:*\n"
        f"  Per Swap: ${per_swap:,.0f}\n"
        f"  Daily: ${daily:,.0f}\n"
        f"  2FA Above: ${require_2fa:,.0f}\n"
    )

    if turnkey_wallets:
        text += (
            f"\n*Turnkey Infrastructure:*\n"
            f"  {len(turnkey_wallets)} wallet(s) with policy enforcement\n"
            f"  Limits synced to Turnkey enclaves\n"
        )

        # List policies per wallet
        from bot.services.turnkey_policies import turnkey_policy_service
        for tw in turnkey_wallets:
            policies = await turnkey_policy_service.get_wallet_policies(tw)
            addr_short = tw.address[:6] + "..." + tw.address[-4:]
            if policies:
                policy_lines = []
                for p in policies:
                    if p.policy_type == "spending_limit":
                        window = "hourly" if p.time_window_seconds == 3600 else "daily"
                        policy_lines.append(f"    Spending limit ({window})")
                    elif p.policy_type == "address_whitelist":
                        policy_lines.append(f"    Address whitelist")
                text += f"\n  `{addr_short}`:\n" + "\n".join(policy_lines) + "\n"
            else:
                text += f"\n  `{addr_short}`: No policies\n"

    keyboard = [
        [InlineKeyboardButton("Edit Limits", callback_data="settings_limits")],
        [InlineKeyboardButton("Settings", callback_data="settings_menu")],
    ]

    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
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


# Conversation handler for recovery email
recovery_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(recovery_setup_start, pattern="^recovery_setup$"),
    ],
    states={
        SET_RECOVERY_EMAIL: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, recovery_email_set),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", settings_cancel),
    ],
    per_message=False,
    per_chat=True,
)


# Conversation handler for limits
limits_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(limits_start, pattern="^settings_limits$"),
    ],
    states={
        SET_LIMIT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, limits_set),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", settings_cancel),
    ],
    per_message=False,
    per_chat=True,
)


# === MEV Protection Toggles ===


async def toggle_mev_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle MEV protection on/off."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            return
        current = getattr(db_user, "mev_protection_enabled", True)
        db_user.mev_protection_enabled = not current
        status = "enabled" if not current else "disabled"
        await query.answer(f"🛡️ MEV protection {status}!", show_alert=False)

    await settings_callback(update, context)


async def cycle_tip_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Cycle Jito tip priority: low -> medium -> high -> urgent."""
    query = update.callback_query
    await query.answer()

    tip_cycle = ["low", "medium", "high", "urgent"]

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            return
        current = getattr(db_user, "jito_tip_priority", "medium")
        idx = tip_cycle.index(current) if current in tip_cycle else 1
        new_tip = tip_cycle[(idx + 1) % len(tip_cycle)]
        db_user.jito_tip_priority = new_tip

    await settings_callback(update, context)


# Create handlers
settings_handler = CommandHandler("set", settings_command)
recovery_handler = CommandHandler("recovery", recovery_command)
limits_handler = CommandHandler("limits", limits_command)
toggle_notify_handler = CallbackQueryHandler(toggle_notify_callback, pattern="^settings_toggle_notify$")
toggle_panic_handler = CallbackQueryHandler(toggle_panic_sell_callback, pattern="^settings_toggle_panic$")
toggle_mev_handler = CallbackQueryHandler(toggle_mev_callback, pattern="^settings_toggle_mev$")
cycle_tip_handler = CallbackQueryHandler(cycle_tip_callback, pattern="^settings_cycle_tip$")
settings_menu_callback = CallbackQueryHandler(settings_callback, pattern="^settings_menu$")
recovery_menu_callback = CallbackQueryHandler(recovery_callback, pattern="^settings_recovery$")

