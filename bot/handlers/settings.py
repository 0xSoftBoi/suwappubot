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
from bot.utils.telegram_safe import safe_md, send_md_safe
from bot.services.x402_service import x402_service
from bot.models.subscription import SubscriptionTier
from bot.config.settings import settings as global_settings
from database.db import get_session


# Conversation states
SET_SLIPPAGE, SET_LIMIT, SET_RECOVERY_EMAIL, SET_OUTPUT_TOKEN = range(4)

# Valid transaction speed presets
_SPEED_PRESETS = ("slow", "normal", "fast")

# Chains users can pick as default
_SUPPORTED_CHAINS = (
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "solana",
    "avalanche",
    "tron",
)

# Common output token choices
_OUTPUT_TOKEN_CHOICES = ("USDC", "USDT", "ETH", "BNB", "SOL")


def _get_or_create_settings(session, telegram_id: int) -> tuple:
    """Return (db_user, user_settings) or (None, None) if user not found."""
    db_user = session.query(User).filter(User.telegram_id == telegram_id).first()
    if not db_user:
        return None, None
    user_settings = session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
    if not user_settings:
        user_settings = UserSettings(user_id=db_user.id)
        session.add(user_settings)
        session.flush()
    return db_user, user_settings


def _build_settings_text(user_settings: UserSettings) -> str:
    slippage = user_settings.default_slippage_bps / 100
    per_swap_limit = user_settings.per_swap_limit_usd
    daily_limit = user_settings.daily_limit_usd
    require_2fa = user_settings.require_2fa_above_usd
    notify_complete = user_settings.notify_on_complete
    panic_sell = user_settings.panic_sell_enabled
    mev = getattr(user_settings, "mev_protection_enabled", True)
    speed = safe_md(getattr(user_settings, "tx_speed_preset", "normal") or "normal")
    output_tok = safe_md(
        getattr(user_settings, "default_output_token", None) or global_settings.default_output_token
    )
    chain = safe_md(user_settings.default_chain or "any")

    return (
        "*Settings*\n\n"
        "*Trading:*\n"
        f"  Slippage: {slippage}%\n"
        f"  Speed: {speed}\n"
        f"  Output token: {output_tok}\n"
        f"  Preferred chain: {chain}\n\n"
        "*Anti-Rug:*\n"
        f"  Panic Sell (frontrun): {'Enabled' if panic_sell else 'Disabled'}\n"
        f"  MEV Protection (Pro): {'Enabled' if mev else 'Disabled'}\n\n"
        "*Limits:*\n"
        f"  Per Swap: ${per_swap_limit:,.0f}\n"
        f"  Daily: ${daily_limit:,.0f}\n"
        f"  2FA Required Above: ${require_2fa:,.0f}\n\n"
        "*Notifications:*\n"
        f"  Swap Complete: {'On' if notify_complete else 'Off'}\n\n"
        "*Alerts:*\n"
        f"  Manage your price alerts below."
    )


def _build_settings_keyboard(user_settings: UserSettings) -> InlineKeyboardMarkup:
    panic_sell = user_settings.panic_sell_enabled
    notify_complete = user_settings.notify_on_complete
    mev = getattr(user_settings, "mev_protection_enabled", True)
    speed = getattr(user_settings, "tx_speed_preset", "normal") or "normal"

    keyboard = [
        [
            InlineKeyboardButton("Set Slippage", callback_data="settings_slippage"),
            InlineKeyboardButton("Set Limits", callback_data="settings_limits"),
        ],
        [
            InlineKeyboardButton(
                f"Speed: {speed.upper()}",
                callback_data="settings_speed_menu",
            ),
        ],
        [
            InlineKeyboardButton("Set Output Token", callback_data="settings_output_token"),
            InlineKeyboardButton("Set Chain", callback_data="settings_chain_menu"),
        ],
        [
            InlineKeyboardButton(
                f"{'Disable' if panic_sell else 'Enable'} Panic Sell",
                callback_data="settings_toggle_panic",
            )
        ],
        [
            InlineKeyboardButton(
                f"{'Disable' if mev else 'Enable'} MEV Protection",
                callback_data="settings_toggle_mev",
            )
        ],
        [
            InlineKeyboardButton(
                f"{'Mute' if notify_complete else 'Unmute'} Notifications",
                callback_data="settings_toggle_notify",
            )
        ],
        [InlineKeyboardButton("Manage Alerts", callback_data="alerts_menu")],
        [InlineKeyboardButton("Recovery", callback_data="settings_recovery")],
        [InlineKeyboardButton("Back", callback_data="main_menu")],
    ]
    return InlineKeyboardMarkup(keyboard)


async def settings_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /settings command."""
    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return

        text = _build_settings_text(user_settings)
        keyboard = _build_settings_keyboard(user_settings)

    await send_md_safe(update, text, reply_markup=keyboard, edit_on_callback=False)


async def settings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle settings_menu callback — refresh the settings screen."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return

        text = _build_settings_text(user_settings)
        keyboard = _build_settings_keyboard(user_settings)

    await send_md_safe(update, text, reply_markup=keyboard)


# ---------------------------------------------------------------------------
# Toggle: notifications
# ---------------------------------------------------------------------------


async def toggle_notify_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle notification settings."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if db_user and user_settings:
            user_settings.notify_on_complete = not user_settings.notify_on_complete

    await settings_callback(update, context)


# ---------------------------------------------------------------------------
# Toggle: panic sell (Pro gate)
# ---------------------------------------------------------------------------


async def toggle_panic_sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle Panic Sell protection (Pro tier required)."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            return

        tier = await x402_service.get_tier(db_user.id)
        if tier not in [
            SubscriptionTier.PRO,
            SubscriptionTier.PREMIUM,
            SubscriptionTier.ENTERPRISE,
        ]:
            await query.answer("Pro Tier required for Panic Sell protection", show_alert=True)
            return

        if user_settings:
            user_settings.panic_sell_enabled = not user_settings.panic_sell_enabled
            status = "enabled" if user_settings.panic_sell_enabled else "disabled"
            await query.answer(f"Panic Sell {status}!")

    await settings_callback(update, context)


# ---------------------------------------------------------------------------
# Toggle: MEV protection (Pro gate)
# ---------------------------------------------------------------------------


async def toggle_mev_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Toggle MEV protection (Pro tier required)."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            return

        tier = await x402_service.get_tier(db_user.id)
        if tier not in [
            SubscriptionTier.PRO,
            SubscriptionTier.PREMIUM,
            SubscriptionTier.ENTERPRISE,
        ]:
            await query.answer("Pro Tier required for MEV Protection", show_alert=True)
            return

        if user_settings:
            current = getattr(user_settings, "mev_protection_enabled", True)
            user_settings.mev_protection_enabled = not current
            status = "enabled" if user_settings.mev_protection_enabled else "disabled"
            await query.answer(f"MEV Protection {status}!")

    await settings_callback(update, context)


# ---------------------------------------------------------------------------
# Transaction speed: pick-list
# ---------------------------------------------------------------------------


async def speed_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show speed-preset picker."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return
        current = getattr(user_settings, "tx_speed_preset", "normal") or "normal"

    keyboard = [
        [
            InlineKeyboardButton(
                f"{'> ' if current == s else ''}{'Slow' if s == 'slow' else 'Normal' if s == 'normal' else 'Fast'}",
                callback_data=f"settings_speed_{s}",
            )
            for s in _SPEED_PRESETS
        ],
        [InlineKeyboardButton("Back", callback_data="settings_menu")],
    ]
    await send_md_safe(
        update,
        "*Transaction Speed*\n\nPick a priority-fee preset.\n\n"
        "Slow: lower fee, may be slower.\n"
        "Normal: balanced.\n"
        "Fast: higher fee for quick inclusion.",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def speed_set_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Persist the chosen speed preset."""
    query = update.callback_query
    preset = query.data.replace("settings_speed_", "")
    if preset not in _SPEED_PRESETS:
        await query.answer("Unknown preset.")
        return

    await query.answer(f"Speed set to {preset}.")
    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if db_user and user_settings:
            user_settings.tx_speed_preset = preset

    await settings_callback(update, context)


# ---------------------------------------------------------------------------
# Default chain: pick-list
# ---------------------------------------------------------------------------


async def chain_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show preferred-chain picker."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return
        current = user_settings.default_chain or ""

    rows = []
    row = []
    for chain in _SUPPORTED_CHAINS:
        label = f">{chain}" if chain == current else chain
        row.append(
            InlineKeyboardButton(label.capitalize(), callback_data=f"settings_chain_{chain}")
        )
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton("Any (no preference)", callback_data="settings_chain_any")])
    rows.append([InlineKeyboardButton("Back", callback_data="settings_menu")])

    await send_md_safe(
        update,
        "*Preferred Chain*\n\nSwaps will default to this chain when no chain is specified.",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def chain_set_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Persist the chosen default chain."""
    query = update.callback_query
    raw = query.data.replace("settings_chain_", "")
    chain = None if raw == "any" else raw

    await query.answer(f"Default chain: {chain or 'any'}.")
    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if db_user and user_settings:
            user_settings.default_chain = chain

    await settings_callback(update, context)


# ---------------------------------------------------------------------------
# Default output token: quick-pick buttons + freeform conversation
# ---------------------------------------------------------------------------


async def output_token_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show output-token quick-pick; also allows custom entry."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if not db_user:
            await query.edit_message_text("Please use /start first.")
            return ConversationHandler.END
        current = safe_md(
            getattr(user_settings, "default_output_token", None)
            or global_settings.default_output_token
        )

    quick_row = [
        InlineKeyboardButton(tok, callback_data=f"settings_outtok_{tok}")
        for tok in _OUTPUT_TOKEN_CHOICES
    ]
    keyboard = [
        quick_row,
        [InlineKeyboardButton("Back", callback_data="settings_menu")],
    ]
    await send_md_safe(
        update,
        f"*Default Output Token*\n\nCurrent: {current}\n\n"
        "Pick a common token or type any symbol and press Send.",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return SET_OUTPUT_TOKEN


async def output_token_quick_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle quick-pick button for output token."""
    query = update.callback_query
    token = query.data.replace("settings_outtok_", "").upper().strip()
    await query.answer(f"Output token set to {safe_md(token)}.")
    user = update.effective_user

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if db_user and user_settings:
            user_settings.default_output_token = token

    await settings_callback(update, context)
    return ConversationHandler.END


async def output_token_text_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle free-form token symbol entry."""
    user = update.effective_user
    token = update.message.text.strip().upper()

    if not re.match(r"^[A-Z0-9]{1,20}$", token):
        await update.message.reply_text(
            "Invalid token symbol. Use letters/digits only (max 20 chars).\n"
            "Send /cancel to abort."
        )
        return SET_OUTPUT_TOKEN

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if db_user and user_settings:
            user_settings.default_output_token = token

    await update.message.reply_text(
        f"Default output token set to {safe_md(token)}.",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Settings", callback_data="settings_menu")]]
        ),
    )
    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Slippage conversation
# ---------------------------------------------------------------------------


async def slippage_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start slippage setting flow."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "Set Default Slippage\n\n"
        "Enter slippage percentage (0.1 - 50):\n\n"
        "Examples:\n"
        "0.5 for 0.5%\n"
        "1 for 1%\n"
        "3 for 3%\n\n"
        "Send /cancel to abort.",
    )

    return SET_SLIPPAGE


async def slippage_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle slippage input."""
    user = update.effective_user
    slippage_bps = validate_slippage(update.message.text)

    if slippage_bps is None:
        await update.message.reply_text(
            "Invalid slippage. Enter a value between 0.1 and 50.\n" "Send /cancel to abort."
        )
        return SET_SLIPPAGE

    with get_session() as session:
        db_user, user_settings = _get_or_create_settings(session, user.id)
        if db_user and user_settings:
            user_settings.default_slippage_bps = slippage_bps

    slippage_pct = slippage_bps / 100

    await update.message.reply_text(
        f"Default slippage set to {slippage_pct}%",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Settings", callback_data="settings_menu")]]
        ),
    )

    return ConversationHandler.END


async def settings_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel settings flow."""
    await update.message.reply_text(
        "Settings change cancelled.",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Settings", callback_data="settings_menu")]]
        ),
    )
    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Recovery handlers
# ---------------------------------------------------------------------------


async def recovery_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /recovery command - show recovery status."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return

        has_turnkey = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.wallet_provider == "turnkey",
            )
            .first()
            is not None
        )

        recovery_email = db_user.recovery_email
        recovery_setup_at = db_user.recovery_setup_at

    if not has_turnkey:
        await update.message.reply_text(
            "*Wallet Recovery*\n\n"
            "Recovery is only available for Turnkey (passkey) wallets.\n\n"
            "Your current wallet uses local key storage. "
            "To use Turnkey wallets, create one via the webapp.",
            parse_mode="Markdown",
        )
        return

    if recovery_email:
        local, sep, domain = recovery_email.partition("@")
        masked = local[:3] + "***" + sep + domain if sep else recovery_email
        text = (
            "*Wallet Recovery*\n\n"
            f"*Status:* Recovery set up\n"
            f"*Email:* `{masked}`\n"
            f"*Since:* {recovery_setup_at.strftime('%Y-%m-%d') if recovery_setup_at else 'Unknown'}\n\n"
            "If you lose access, use this email to recover your wallet."
        )
        keyboard = [
            [InlineKeyboardButton("Update Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("Settings", callback_data="settings_menu")],
        ]
    else:
        text = (
            "*Wallet Recovery*\n\n"
            "No recovery email set up yet.\n\n"
            "Set up a recovery email to protect your wallet. "
            "If you lose access to your Telegram or passkey device, "
            "you can recover your wallet using this email."
        )
        keyboard = [
            [InlineKeyboardButton("Set Up Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("Settings", callback_data="settings_menu")],
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

        has_turnkey = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.wallet_provider == "turnkey",
            )
            .first()
            is not None
        )

        recovery_email = db_user.recovery_email
        recovery_setup_at = db_user.recovery_setup_at

    if not has_turnkey:
        await query.edit_message_text(
            "*Wallet Recovery*\n\n"
            "Recovery is only available for Turnkey (passkey) wallets.\n\n"
            "Your current wallet uses local key storage.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("Settings", callback_data="settings_menu")],
                ]
            ),
        )
        return

    if recovery_email:
        local, sep, domain = recovery_email.partition("@")
        masked = local[:3] + "***" + sep + domain if sep else recovery_email
        text = (
            "*Wallet Recovery*\n\n"
            f"*Status:* Recovery set up\n"
            f"*Email:* `{masked}`\n"
            f"*Since:* {recovery_setup_at.strftime('%Y-%m-%d') if recovery_setup_at else 'Unknown'}\n\n"
            "If you lose access, use this email to recover your wallet."
        )
        keyboard = [
            [InlineKeyboardButton("Update Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("Settings", callback_data="settings_menu")],
        ]
    else:
        text = (
            "*Wallet Recovery*\n\n"
            "No recovery email set up yet.\n\n"
            "Set up a recovery email to protect your wallet."
        )
        keyboard = [
            [InlineKeyboardButton("Set Up Recovery Email", callback_data="recovery_setup")],
            [InlineKeyboardButton("Settings", callback_data="settings_menu")],
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
        "*Set Recovery Email*\n\n"
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

    if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
        await update.message.reply_text(
            "Invalid email address. Please enter a valid email.\n" "Send /cancel to abort."
        )
        return SET_RECOVERY_EMAIL

    from bot.services.wallet_recovery import WalletRecoveryService

    recovery_service = WalletRecoveryService()
    success = await recovery_service.setup_email_recovery(user.id, email)

    if success:
        local, sep, domain = email.partition("@")
        masked = local[:3] + "***" + sep + domain if sep else email
        await update.message.reply_text(
            f"Recovery email set to `{masked}`\n\n"
            "You can now recover your wallet using this email if you lose access.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("Settings", callback_data="settings_menu")],
                ]
            ),
        )
    else:
        await update.message.reply_text(
            "Failed to set recovery email. Make sure you have a Turnkey wallet.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("Settings", callback_data="settings_menu")],
                ]
            ),
        )

    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Limits handlers
# ---------------------------------------------------------------------------


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

        user_settings = (
            session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        )
        per_swap = user_settings.per_swap_limit_usd if user_settings else 5000
        daily = user_settings.daily_limit_usd if user_settings else 50000

        has_turnkey = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.wallet_provider == "turnkey",
            )
            .first()
            is not None
        )

    turnkey_note = ""
    if has_turnkey:
        turnkey_note = (
            "\nTurnkey wallets: limits are also enforced at the "
            "infrastructure level. Changes sync automatically.\n"
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
            "Invalid numbers. Please enter two numbers.\n" "Send /cancel to abort."
        )
        return SET_LIMIT

    if per_swap <= 0 or daily <= 0:
        await update.message.reply_text(
            "Limits must be positive numbers.\n" "Send /cancel to abort."
        )
        return SET_LIMIT

    if per_swap > daily:
        await update.message.reply_text(
            "Per-swap limit cannot exceed daily limit.\n" "Send /cancel to abort."
        )
        return SET_LIMIT

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return ConversationHandler.END

        user_settings = (
            session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        )

        if user_settings:
            user_settings.per_swap_limit_usd = per_swap
            user_settings.daily_limit_usd = daily
        db_user_id = db_user.id

    from bot.services.security import sync_limits_to_turnkey

    await sync_limits_to_turnkey(db_user_id)

    await update.message.reply_text(
        f"Limits updated:\n" f"  Per Swap: ${per_swap:,.0f}\n" f"  Daily: ${daily:,.0f}",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Settings", callback_data="settings_menu")]]
        ),
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

        user_settings = (
            session.query(UserSettings).filter(UserSettings.user_id == db_user.id).first()
        )
        per_swap = user_settings.per_swap_limit_usd if user_settings else 5000
        daily = user_settings.daily_limit_usd if user_settings else 50000
        require_2fa = user_settings.require_2fa_above_usd if user_settings else 1000

        turnkey_wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.wallet_provider == "turnkey",
                Wallet.is_active == True,
            )
            .all()
        )

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


# ---------------------------------------------------------------------------
# Conversation handlers
# ---------------------------------------------------------------------------

slippage_conversation = ConversationHandler(
    name="slippage",
    persistent=True,
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

recovery_conversation = ConversationHandler(
    name="recovery",
    persistent=True,
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

limits_conversation = ConversationHandler(
    name="limits",
    persistent=True,
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


async def _output_token_back(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle Back button inside output-token conversation — end conversation and show settings."""
    await settings_callback(update, context)
    return ConversationHandler.END


output_token_conversation = ConversationHandler(
    name="output_token",
    persistent=True,
    entry_points=[
        CallbackQueryHandler(output_token_menu_callback, pattern="^settings_output_token$"),
    ],
    states={
        SET_OUTPUT_TOKEN: [
            # Back button exits cleanly
            CallbackQueryHandler(_output_token_back, pattern="^settings_menu$"),
            # Quick-pick buttons handled inside the conversation
            CallbackQueryHandler(output_token_quick_callback, pattern="^settings_outtok_"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, output_token_text_set),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", settings_cancel),
    ],
    per_message=False,
    per_chat=True,
)


# ---------------------------------------------------------------------------
# Exported handler objects
# ---------------------------------------------------------------------------

settings_handler = CommandHandler("set", settings_command)
recovery_handler = CommandHandler("recovery", recovery_command)
limits_handler = CommandHandler("limits", limits_command)

toggle_notify_handler = CallbackQueryHandler(
    toggle_notify_callback, pattern="^settings_toggle_notify$"
)
toggle_panic_handler = CallbackQueryHandler(
    toggle_panic_sell_callback, pattern="^settings_toggle_panic$"
)
toggle_mev_handler = CallbackQueryHandler(toggle_mev_callback, pattern="^settings_toggle_mev$")
settings_menu_callback = CallbackQueryHandler(settings_callback, pattern="^settings_menu$")
recovery_menu_callback = CallbackQueryHandler(recovery_callback, pattern="^settings_recovery$")
speed_menu_handler = CallbackQueryHandler(speed_menu_callback, pattern="^settings_speed_menu$")
speed_set_handler = CallbackQueryHandler(
    speed_set_callback, pattern="^settings_speed_(slow|normal|fast)$"
)
chain_menu_handler = CallbackQueryHandler(chain_menu_callback, pattern="^settings_chain_menu$")
chain_set_handler = CallbackQueryHandler(
    chain_set_callback,
    pattern="^settings_chain_(ethereum|bsc|polygon|arbitrum|optimism|base|solana|avalanche|tron|any)$",
)
