"""Portfolio and balance overview handlers."""

import asyncio
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.models.user import User, Wallet
from bot.services.wallet import WalletService
from bot.services.price_service import PriceService
from bot.utils.formatters import format_amount, format_usd, format_chain_name
from bot.config.chains import CHAINS, ChainType
from database.db import get_session
from bot.utils.tos_utils import enforce_tos


logger = logging.getLogger(__name__)

wallet_service = WalletService()
price_service = PriceService()


async def _build_portfolio_text(wallet_infos):
    """Fetch balances and build portfolio display text and total USD value."""
    all_balances = {}
    total_usd = 0.0

    for wallet_id, address, chain_type, name in wallet_infos:
        balances = await wallet_service.get_balances_by_address(address, chain_type)

        for chain, tokens in balances.items():
            if chain not in all_balances:
                all_balances[chain] = {}
            for token, amount in tokens.items():
                if token in all_balances[chain]:
                    all_balances[chain][token] += amount
                else:
                    all_balances[chain][token] = amount

    # Get USD values
    all_tokens = set()
    for tokens in all_balances.values():
        all_tokens.update(tokens.keys())

    prices = await price_service.get_prices(list(all_tokens))

    lines = ["\U0001f4bc *Your Portfolio*\n"]

    for chain_name in sorted(all_balances.keys()):
        tokens = all_balances[chain_name]
        if not tokens:
            continue

        chain_display = format_chain_name(chain_name)
        lines.append(f"\n*{chain_display}*")

        for token, amount in sorted(tokens.items()):
            if amount <= 0:
                continue

            price = prices.get(token, 0) or 0
            usd_value = amount * price
            total_usd += usd_value

            if usd_value > 0.01:
                lines.append(
                    f"  {format_amount(amount, symbol=token)} "
                    f"({format_usd(usd_value)})"
                )
            else:
                lines.append(f"  {format_amount(amount, symbol=token)}")

    lines.append(f"\n\U0001f4b0 *Total Value:* {format_usd(total_usd)}")

    return "\n".join(lines)


def _portfolio_keyboard():
    """Return standard portfolio keyboard."""
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("\U0001f504 Refresh", callback_data="portfolio_refresh"),
            InlineKeyboardButton("\U0001f504 Swap", callback_data="swap_start"),
        ],
        [InlineKeyboardButton("\u00ab Back", callback_data="main_menu")],
    ])


def _error_keyboard():
    """Return error/retry keyboard."""
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("\U0001f504 Retry", callback_data="portfolio_refresh")],
        [InlineKeyboardButton("\u00ab Back", callback_data="main_menu")],
    ])


@enforce_tos
async def portfolio_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /portfolio command - show full portfolio with USD values."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await update.message.reply_text(
                "\u274c Please use /start first to set up your account."
            )
            return

        wallets = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.is_active == True,
        ).all()

        if not wallets:
            keyboard = [[InlineKeyboardButton("\U0001f45b Add Wallet", callback_data="wallet_menu")]]
            await update.message.reply_text(
                "\U0001f45b Add a wallet first to view your portfolio!",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        wallet_infos = [(w.id, w.address, w.chain_type, w.name) for w in wallets]

    loading_msg = await update.message.reply_text("\U0001f4ca Loading portfolio...")

    try:
        text = await _build_portfolio_text(wallet_infos)
        await loading_msg.edit_text(
            text,
            parse_mode="Markdown",
            reply_markup=_portfolio_keyboard(),
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("Portfolio load failed")
        await loading_msg.edit_text(
            f"\u274c Error loading portfolio: {str(e)}",
            reply_markup=_error_keyboard(),
        )


@enforce_tos
async def portfolio_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle portfolio button callback."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text("\u274c Please use /start first.")
            return

        wallets = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.is_active == True,
        ).all()

        if not wallets:
            keyboard = [[InlineKeyboardButton("\U0001f45b Add Wallet", callback_data="wallet_menu")]]
            await query.edit_message_text(
                "\U0001f45b Add a wallet first!",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        wallet_infos = [(w.id, w.address, w.chain_type, w.name) for w in wallets]

    await query.edit_message_text("\U0001f4ca Loading portfolio...")

    try:
        text = await _build_portfolio_text(wallet_infos)
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=_portfolio_keyboard(),
        )
    except Exception as e:
        logger.error(f"Error in portfolio_callback: {e}", exc_info=True)
        await query.edit_message_text(
            "\u274c An unexpected error occurred. Please try again.",
            reply_markup=_error_keyboard(),
        )


# Create handlers
portfolio_handler = CommandHandler("p", portfolio_command)
