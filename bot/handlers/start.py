"""Start and help command handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler
from datetime import datetime

from bot.models.user import User
from database.db import get_session
from bot.services.tos_service import tos_service, TOS_TEXT
from bot.services.referral_service import referral_service
from bot.utils.templates import WELCOME_MESSAGE, HELP_MESSAGE, TOS_KEYBOARD


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command.
    
    Supports deeplinks for referrals: /start REFERRAL_CODE
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
            db_user.last_active_at = datetime.utcnow()
            if user.username:
                db_user.username = user.username
        
        user_id = db_user.id
        tos_accepted = db_user.tos_accepted
    
    # Process referral code if present and user is new
    referral_message = ""
    if referral_code and is_new_user:
        success, msg = referral_service.process_referral(user_id, referral_code)
        if success:
            referral_message = "\n\n🎁 _Referral code applied! Your referrer will earn rewards._"

    # Check TOS
    if not tos_accepted:
        await update.message.reply_text(
            TOS_TEXT,
            parse_mode="Markdown",
            reply_markup=TOS_KEYBOARD
        )
        return

    # Compact 3-row menu
    keyboard = [
        [
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
            InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu"),
        ],
        [
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
            InlineKeyboardButton("🔔 Alerts", callback_data="alerts_menu"),
            InlineKeyboardButton("📈 Orders", callback_data="limit_orders_menu"),
        ],
        [
            InlineKeyboardButton("📜 History", callback_data="history_menu"),
            InlineKeyboardButton("More...", callback_data="menu_more"),
        ],
    ]

    # Add first-trade prompt for new users
    if is_new_user:
        keyboard.insert(0, [
            InlineKeyboardButton("🚀 Make Your First Trade!", callback_data="first_trade"),
        ])

    reply_markup = InlineKeyboardMarkup(keyboard)

    welcome_text = WELCOME_MESSAGE + referral_message
    await update.message.reply_text(
        welcome_text,
        parse_mode="Markdown",
        reply_markup=reply_markup,
    )


async def tos_accept_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle TOS acceptance callback."""
    query = update.callback_query
    await query.answer("Terms accepted! 🌸")
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if db_user:
            db_user.tos_accepted = True
            db_user.tos_accepted_at = datetime.utcnow()
    
    # Redirect to main menu (reuse existing function)
    await main_menu_callback(update, context)


async def tos_decline_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle TOS decline callback."""
    query = update.callback_query
    await query.answer()
    
    await query.edit_message_text(
        "❌ *Terms Declined*\n\nYou must accept the Terms of Service to use Suwappu Bot\\. If you change your mind, use /start to try again\\.",
        parse_mode="MarkdownV2"
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
    """Handle main menu callback."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not tos_service.is_accepted_telegram(user.id):
        await query.edit_message_text(
            TOS_TEXT,
            parse_mode="Markdown",
            reply_markup=TOS_KEYBOARD
        )
        return

    # Compact 3-row menu
    keyboard = [
        [
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
            InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu"),
        ],
        [
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
            InlineKeyboardButton("🔔 Alerts", callback_data="alerts_menu"),
            InlineKeyboardButton("📈 Orders", callback_data="limit_orders_menu"),
        ],
        [
            InlineKeyboardButton("📜 History", callback_data="history_menu"),
            InlineKeyboardButton("More...", callback_data="menu_more"),
        ],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # If coming from a photo (QR code), delete and send new message
    if query.message.photo:
        await query.message.delete()
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=WELCOME_MESSAGE,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )
    else:
        await query.edit_message_text(
            WELCOME_MESSAGE,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )


async def more_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle More... menu callback - shows remaining features."""
    query = update.callback_query
    await query.answer()

    keyboard = [
        [
            InlineKeyboardButton("🎯 Snipe", callback_data="snipe_menu"),
            InlineKeyboardButton("📋 Copy Trading", callback_data="copy_menu"),
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
            InlineKeyboardButton("📊 Dashboard", callback_data="dashboard_menu"),
        ],
        [
            InlineKeyboardButton("📝 Tax Export", callback_data="tax_menu"),
            InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu"),
        ],
        [
            InlineKeyboardButton("📖 Help", callback_data="help"),
        ],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await query.edit_message_text(
        "🌸 *More Features*",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def first_trade_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle first-trade button — pre-fills a popular swap pair and redirects to swap flow."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        context.user_data["user_id"] = db_user.id

    # Pre-fill with SOL -> USDC on Solana as a popular beginner pair
    context.user_data["swap"] = {
        "from_chain": "solana",
        "from_token": "SOL",
        "to_chain": "solana",
        "to_token": "USDC",
    }

    quickbuy_row = [
        InlineKeyboardButton(f"{amt} SOL", callback_data=f"swap_qb_{amt}")
        for amt in [0.1, 0.5, 1.0, 5.0]
    ]

    keyboard = [
        quickbuy_row,
        [
            InlineKeyboardButton("25%", callback_data="swap_pct_25"),
            InlineKeyboardButton("50%", callback_data="swap_pct_50"),
            InlineKeyboardButton("75%", callback_data="swap_pct_75"),
            InlineKeyboardButton("Max", callback_data="swap_pct_100"),
        ],
        [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")],
    ]

    await query.edit_message_text(
        "🚀 *Your First Trade!*\n\n"
        "We've set up a popular pair for you:\n"
        "☀️ *SOL* → *USDC* on Solana\n\n"
        "Pick an amount or type one:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def noop_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle divider buttons that do nothing."""
    query = update.callback_query
    await query.answer()


# Create handlers
start_handler = CommandHandler("start", start_command)
help_handler = CommandHandler("h", help_command)



