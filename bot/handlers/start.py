"""Start and help command handlers."""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler
from datetime import datetime

from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)

BRANDING_BANNER_PATH = "assets/branding/suwappu-logo.svg"


WELCOME_MESSAGE = """
🌸 *suwappu* — fast cross-chain swaps with a native C\+\+ core\!

🔄 *Welcome to Suwappu Bot*

Cross-chain swaps made simple.

🎁 *Referral Blitz*: earn 50% of fees from friends + instant bonuses.
Use /referral to grab your link.

*Choose Your Mode:*

🔐 *Self\-Custody* \(Your Keys\)
You control your private keys
Pay your own gas fees

🏦 *Custodial* \(We Manage\)
No gas fees \- we pay for you
Instant deposits & withdrawals

━━━━━━━━━━━━━━━━━━━━

*Supported Chains:*
🔷 ETH • 🟣 Polygon • 🟡 BSC
🔵 Arbitrum • 🔴 Optimism • 🔵 Base • 🟢 Solana

Powered by Li\.Fi, Jupiter & LayerZero
"""

HELP_MESSAGE = """
🌸 *suwappu help*

📖 *Help Guide*

━━ 🔐 *SELF\-CUSTODY MODE* ━━
_You hold your private keys_

• /wallet \- Create/import your wallet
• /balance \- Check your balances
• /swap \- Swap with your wallet
• /history \- View transactions

⚠️ You pay gas fees from your wallet

━━ 🏦 *CUSTODIAL MODE* ━━
_We manage funds for you_

• /custodial \- View custodial account
  ↳ Deposit \- Send tokens to us
  ↳ Withdraw \- Get tokens back
  ↳ Swap \- Trade with zero gas

✅ We pay all gas fees for you\!

━━━━━━━━━━━━━━━━━━━━

*Other Commands:*
• /portfolio \- All holdings \+ USD value
• /gas \- Live gas prices
• /favorites \- Saved swap pairs
• /settings \- Preferences

*Fees:*
• 1% swap fee on all trades
• Gas sponsored in custodial mode
"""


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command."""
    user = update.effective_user
    
    # Create or update user in database
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if db_user is None:
            db_user = User(
                telegram_id=user.id,
                username=user.username,
                first_name=user.first_name,
                last_name=user.last_name,
            )
            session.add(db_user)
        else:
            db_user.last_active_at = datetime.utcnow()
            if user.username:
                db_user.username = user.username
    
    # Create inline keyboard with clear custodial vs non-custodial
    keyboard = [
        [InlineKeyboardButton("━━ 🌸 SUWAPPU • SELF-CUSTODY ━━", callback_data="noop")],
        [
            InlineKeyboardButton("👛 My Wallets", callback_data="wallet_menu"),
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
        ],
        [
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
        ],
        [InlineKeyboardButton("━━ 🏦 CUSTODIAL ━━", callback_data="noop")],
        [
            InlineKeyboardButton("🏦 Custodial Account", callback_data="custodial_menu"),
        ],
        [InlineKeyboardButton("━━━━━━━━━━━━", callback_data="noop")],
        [
            InlineKeyboardButton("🎁 Referral Blitz", callback_data="ref_menu"),
        ],
        [
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
            InlineKeyboardButton("📖 Help", callback_data="help"),
        ],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Send branding banner (document to ensure delivery even with SVG)
    try:
        with open(BRANDING_BANNER_PATH, "rb") as banner:
            await context.bot.send_document(
                chat_id=update.effective_chat.id,
                document=banner,
                filename="suwappu-banner.svg",
                caption="🌸 suwappu — cross-chain swaps with a native C++ core",
            )
    except FileNotFoundError:
        logger.warning("Branding banner not found at %s", BRANDING_BANNER_PATH)
    except Exception as exc:
        logger.warning("Failed to send branding banner: %s", exc)

    await update.message.reply_text(
        WELCOME_MESSAGE,
        parse_mode="Markdown",
        reply_markup=reply_markup,
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
    
    keyboard = [
        [InlineKeyboardButton("━━ 🌸 SUWAPPU • SELF-CUSTODY ━━", callback_data="noop")],
        [
            InlineKeyboardButton("👛 My Wallets", callback_data="wallet_menu"),
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
        ],
        [
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
        ],
        [InlineKeyboardButton("━━ 🏦 CUSTODIAL ━━", callback_data="noop")],
        [
            InlineKeyboardButton("🏦 Custodial Account", callback_data="custodial_menu"),
        ],
        [InlineKeyboardButton("━━━━━━━━━━━━", callback_data="noop")],
        [
            InlineKeyboardButton("🎁 Referral Blitz", callback_data="ref_menu"),
        ],
        [
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
            InlineKeyboardButton("📖 Help", callback_data="help"),
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


async def noop_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle divider buttons that do nothing."""
    query = update.callback_query
    await query.answer()


# Create handlers
start_handler = CommandHandler("start", start_command)
help_handler = CommandHandler("help", help_command)



