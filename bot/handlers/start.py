"""Start and help command handlers."""

import asyncio
import logging
from telegram import Message, Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler
from datetime import datetime, timezone

from bot import __version__
from bot.models.user import User, Wallet
from database.db import get_session
from bot.services.tos_service import tos_service, TOS_TEXT
from bot.services.referral_service import referral_service
from bot.services.wallet import WalletService
from bot.utils.templates import HELP_MESSAGE, TOS_KEYBOARD
from bot.i18n import get_text, get_user_lang

logger = logging.getLogger(__name__)
wallet_service = WalletService()


def _build_main_keyboard() -> InlineKeyboardMarkup:
    """Build the compact main menu keyboard.

    Action-first, like the leading bots — but the second row surfaces our
    differentiators (perps + prediction markets) one tap away instead of
    burying them behind typed commands.
    """
    keyboard = [
        [InlineKeyboardButton(f"━━ 🌸 SUWAPPU v{__version__} ━━", callback_data="noop")],
        [
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            InlineKeyboardButton("⚡ Quick Swap", callback_data="quickswap_menu"),
        ],
        [
            InlineKeyboardButton("📈 Perps", callback_data="perps_open"),
            InlineKeyboardButton("🔮 Predictions", callback_data="predict_open"),
        ],
        [
            InlineKeyboardButton("🏦 Savings (Earn)", callback_data="save_menu"),
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
        ],
        [
            InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu"),
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
        ],
        [
            InlineKeyboardButton("💼 Positions", callback_data="positions_menu"),
            InlineKeyboardButton("📜 History", callback_data="history_menu"),
        ],
        [
            InlineKeyboardButton("📂 More...", callback_data="more_menu"),
            InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu"),
        ],
    ]
    return InlineKeyboardMarkup(keyboard)


def _build_more_keyboard() -> InlineKeyboardMarkup:
    """Build the 'More Features' sub-menu keyboard."""
    keyboard = [
        [InlineKeyboardButton("━━ 📂 More Features ━━", callback_data="noop")],
        [
            InlineKeyboardButton("📈 Limit Orders", callback_data="limit_orders_menu"),
            InlineKeyboardButton("🔁 DCA", callback_data="dca_menu"),
        ],
        [
            InlineKeyboardButton("🎯 Snipe", callback_data="snipe_menu"),
            InlineKeyboardButton("🔔 Price Alerts", callback_data="alerts_menu"),
        ],
        [
            InlineKeyboardButton("📋 Copy Trading", callback_data="copy_menu"),
            InlineKeyboardButton("🪙 Token / Staking", callback_data="token_menu"),
        ],
        [
            InlineKeyboardButton("⭐ Favorites", callback_data="favorites_menu"),
            InlineKeyboardButton("⛽ Gas Tracker", callback_data="gas_menu"),
        ],
        [
            InlineKeyboardButton("🏦 Custodial", callback_data="custodial_menu"),
            InlineKeyboardButton("🎁 Referrals", callback_data="ref_menu"),
        ],
        [
            InlineKeyboardButton("✨ Points", callback_data="points_menu"),
            InlineKeyboardButton("🏆 Leaderboard", callback_data="xp_leaderboard"),
        ],
        [
            InlineKeyboardButton("📊 Dashboard", callback_data="dashboard_menu"),
            InlineKeyboardButton("📝 Tax Export", callback_data="tax_menu"),
        ],
        [
            InlineKeyboardButton("🛡️ Safety Check", callback_data="paste_check_hint"),
            InlineKeyboardButton("₿ BTC Bridge", callback_data="btc_menu"),
        ],
        [
            InlineKeyboardButton("🏦 Borrow", callback_data="borrow_menu"),
            InlineKeyboardButton("🔥 Trending", callback_data="trending_open"),
        ],
        [InlineKeyboardButton("📖 Help", callback_data="help")],
        [InlineKeyboardButton("« Back to Main", callback_data="main_menu")],
    ]
    return InlineKeyboardMarkup(keyboard)


# Per-user locks so a concurrent double-/start can't double-provision wallets
_wallet_locks: dict[int, asyncio.Lock] = {}


def _get_wallet_lock(user_id: int) -> asyncio.Lock:
    lock = _wallet_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _wallet_locks[user_id] = lock
    return lock


async def _ensure_wallets(user_id: int) -> dict:
    """Auto-create EVM, Solana, and TRON wallets if user doesn't have them.

    Returns dict with 'evm', 'solana', and 'tron' wallet addresses (or None if creation failed).
    """
    async with _get_wallet_lock(user_id):
        return await _ensure_wallets_inner(user_id)


async def _ensure_wallets_inner(user_id: int) -> dict:
    result = {"evm": None, "solana": None, "tron": None}

    for chain_type in ("evm", "solana", "tron"):
        existing = wallet_service.get_user_wallets(user_id, chain_type=chain_type)
        if existing:
            result[chain_type] = existing[0].address
            continue
        try:
            wallet = await wallet_service.create_wallet(
                user_id=user_id,
                name=f"Default {chain_type.upper()}",
                chain_type=chain_type,
            )
            result[chain_type] = wallet.address
            # Set as default
            with get_session() as session:
                w = session.query(Wallet).filter(Wallet.id == wallet.id).first()
                if w:
                    w.is_default = True
            logger.info(
                f"Auto-created {chain_type} wallet for user {user_id}: {wallet.address[:10]}..."
            )
        except Exception as e:
            logger.error(f"Failed to auto-create {chain_type} wallet for user {user_id}: {e}")

    return result


def _format_address(addr: str | None) -> str:
    """Format address for display: 0x1234...abcd"""
    if not addr:
        return "❌ _not created_"
    return f"`{addr[:6]}...{addr[-4:]}`"


def _build_wallet_info(wallets: dict, show_deposit_hint: bool) -> str:
    """Build the '👛 Your Wallets' block for the welcome message."""
    wallet_info = ""
    if wallets["evm"] or wallets["solana"] or wallets["tron"]:
        wallet_info = (
            "\n\n👛 *Your Wallets*\n"
            f"  EVM: {_format_address(wallets['evm'])}\n"
            f"  SOL: {_format_address(wallets['solana'])}\n"
            f"  TRX: {_format_address(wallets['tron'])}"
        )
        if show_deposit_hint:
            wallet_info += "\n_Deposit funds to start trading!_"
    return wallet_info


async def _provision_wallets_and_update(
    user_id: int,
    message: Message,
    suffix: str,
    reply_markup: InlineKeyboardMarkup,
    lang: str = "en",
) -> None:
    """Background task: create wallets, then edit the already-sent welcome message.

    Used on the first-/start fast path so the menu appears instantly instead of
    blocking ~3s on sequential KMS create_wallet calls.
    """
    try:
        wallets = await _ensure_wallets(user_id)
        wallet_info = _build_wallet_info(wallets, show_deposit_hint=True)
        if not wallet_info:
            wallet_info = "\n\n" + get_text("wallet_failed", lang)
        await message.edit_text(
            get_text("welcome", lang) + wallet_info + suffix,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )
    except Exception:
        logger.exception(f"Background wallet provisioning failed for user {user_id}")
        try:
            await message.edit_text(
                get_text("welcome", lang) + "\n\n" + get_text("wallet_failed", lang) + suffix,
                parse_mode="Markdown",
                reply_markup=reply_markup,
            )
        except Exception:
            logger.exception(f"Failed to edit welcome message for user {user_id}")


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command.

    Supports deeplinks for referrals: /start REFERRAL_CODE
    Auto-creates EVM and Solana wallets for new users.
    """
    user = update.effective_user

    # Check for referral code in deeplink arguments
    referral_code = None
    if context.args and len(context.args) > 0:
        referral_code = context.args[0].upper()

    # Create or update user in database
    is_new_user = False
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if db_user is None:
            is_new_user = True
            db_user = User(
                telegram_id=user.id,
                username=user.username,
                first_name=user.first_name,
                last_name=user.last_name,
            )
            session.add(db_user)
            session.commit()  # Commit to get db_user.id
        else:
            db_user.last_active_at = datetime.now(timezone.utc)
            if user.username:
                db_user.username = user.username

        user_id = db_user.id
        tos_accepted = db_user.tos_accepted

    # Process referral code if present and user is new
    referral_message = ""
    if referral_code and is_new_user:
        success, msg = referral_service.process_referral(user_id, referral_code)
        if success:
            # Referee-side welcome bonus: a one-time XP grant so joining via a
            # friend is actually rewarding for the new user (not just the
            # referrer). 100 XP ≈ 2x the daily-first-swap bonus (50) and matches
            # the level-up bonus — meaningful (10% of the way to Silver) without
            # being farmable: process_referral only links a brand-new user once,
            # so this branch runs at most once per account.
            try:
                from bot.services.points_service import points_service

                points_service.award_points(
                    user_id=user_id,
                    action="referral_welcome_bonus",
                    amount=100,
                    description="Welcome bonus for joining via a referral link",
                )
                referral_message = (
                    "\n\n🎁 _You joined via a friend — *+100 XP* welcome bonus added!_"
                )
            except Exception as e:
                logger.warning(f"Failed to award referee welcome XP bonus: {e}")
                referral_message = (
                    "\n\n🎁 _Referral code applied! Your referrer will earn rewards._"
                )

    # Check TOS
    if not tos_accepted:
        await update.message.reply_text(TOS_TEXT, parse_mode="Markdown", reply_markup=TOS_KEYBOARD)
        return

    reply_markup = _build_main_keyboard()

    lang = get_user_lang(user)

    # Fast path: no wallets yet → reply instantly, create wallets in the background
    if not wallet_service.get_user_wallets(user_id):
        sent = await update.message.reply_text(
            get_text("welcome", lang)
            + "\n\n"
            + get_text("wallet_creating", lang)
            + referral_message,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )
        asyncio.create_task(
            _provision_wallets_and_update(user_id, sent, referral_message, reply_markup, lang=lang)
        )
        return

    # Existing users: ensure wallets exist (fast — they already do), then show
    # the LIVE home hub instead of the static welcome. render-instant-then-edit
    # keeps the first paint instant; balances fill in via background edit.
    await _ensure_wallets(user_id)

    from bot.handlers.home import send_home

    if referral_message:
        # Surface the one-time referral bonus once; the hub follows.
        await update.message.reply_text(
            get_text("welcome", lang) + referral_message,
            parse_mode="Markdown",
        )

    async def _send(text, parse_mode, reply_markup):
        return await update.message.reply_text(
            text, parse_mode=parse_mode, reply_markup=reply_markup
        )

    await send_home(user_id, send_func=_send)


async def tos_accept_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle TOS acceptance callback. Auto-creates wallets after acceptance."""
    query = update.callback_query
    await query.answer("Terms accepted! 🌸")

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if db_user:
            db_user.tos_accepted = True
            db_user.tos_accepted_at = datetime.now(timezone.utc)
            user_id = db_user.id

    reply_markup = _build_main_keyboard()

    lang = get_user_lang(update.effective_user)

    # Fast path: no wallets yet → show the menu instantly, create wallets in background
    if not wallet_service.get_user_wallets(user_id):
        sent = await query.edit_message_text(
            get_text("welcome", lang) + "\n\n" + get_text("wallet_creating", lang),
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )
        if isinstance(sent, Message):
            asyncio.create_task(
                _provision_wallets_and_update(user_id, sent, "", reply_markup, lang=lang)
            )
        return

    # Wallets already exist — keep the synchronous path
    await _ensure_wallets(user_id)

    # Redirect to main menu
    await main_menu_callback(update, context)


async def tos_decline_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle TOS decline callback."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "❌ *Terms Declined*\n\nYou must accept the Terms of Service to use Suwappu Bot\\. If you change your mind, use /start to try again\\.",
        parse_mode="MarkdownV2",
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /help command."""
    keyboard = [
        [
            InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start"),
            InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu"),
        ],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        HELP_MESSAGE,
        parse_mode="Markdown",
        reply_markup=reply_markup,
    )


async def help_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle help button callback."""
    query = update.callback_query
    await query.answer()

    keyboard = [
        [
            InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start"),
            InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu"),
        ],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await query.edit_message_text(
        HELP_MESSAGE,
        parse_mode="Markdown",
        reply_markup=reply_markup,
    )


async def main_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle main menu callback — renders the live home hub."""
    from bot.handlers.home import send_home

    query = update.callback_query
    await query.answer()

    user = update.effective_user
    if not tos_service.is_accepted_telegram(user.id):
        await query.edit_message_text(TOS_TEXT, parse_mode="Markdown", reply_markup=TOS_KEYBOARD)
        return

    user_id = None
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if db_user:
            user_id = db_user.id

    lang = get_user_lang(user)

    # No DB user / no wallets yet → fall back to the static welcome menu.
    if user_id is None or not wallet_service.get_user_wallets(user_id):
        reply_markup = _build_main_keyboard()
        if query.message.photo:
            await query.message.delete()
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=get_text("welcome", lang),
                parse_mode="Markdown",
                reply_markup=reply_markup,
            )
        else:
            await query.edit_message_text(
                get_text("welcome", lang),
                parse_mode="Markdown",
                reply_markup=reply_markup,
            )
        return

    # If coming from a photo (QR code), the message can't be edited into text —
    # send a fresh hub message instead.
    if query.message.photo:
        await query.message.delete()

        async def _send(text, parse_mode, reply_markup):
            return await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=text,
                parse_mode=parse_mode,
                reply_markup=reply_markup,
            )

        await send_home(user_id, send_func=_send)
    else:
        await send_home(user_id, edit_message=query.message)


async def more_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'More...' button — shows advanced features sub-menu."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "📂 *More Features*\n\nTap any option below, or go back to the main menu.",
        parse_mode="Markdown",
        reply_markup=_build_more_keyboard(),
    )


async def noop_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle divider buttons that do nothing."""
    query = update.callback_query
    await query.answer()


# Create handlers
start_handler = CommandHandler("start", start_command)
help_handler = CommandHandler("h", help_command)
