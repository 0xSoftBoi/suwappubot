"""Balance checking handlers."""

import asyncio
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.models.user import User, Wallet
from bot.services.wallet import WalletService
from bot.utils.formatters import format_balance_list, format_amount, format_chain_name
from bot.utils.telegram_safe import safe_md
from bot.utils.templates import (
    LOADING_BALANCE,
    START_FIRST,
    NO_WALLETS,
    BALANCE_KEYBOARD,
    WALLET_ADD_KEYBOARD,
)
from database.db import get_session
from bot.utils.tos_utils import enforce_tos

logger = logging.getLogger(__name__)
wallet_service = WalletService()


@enforce_tos
async def balance_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /balance command."""
    user = update.effective_user

    # Get user from database
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await update.message.reply_text(START_FIRST)
            return

        # Get user's wallets
        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_active == True,
            )
            .all()
        )

        if not wallets:
            await update.message.reply_text(NO_WALLETS, reply_markup=WALLET_ADD_KEYBOARD)
            return

        # Store wallet info for later (to avoid detached instance issues)
        wallet_infos = [(w.id, w.address, w.chain_type, w.name) for w in wallets]

    # Send loading message immediately for perceived speed
    loading_msg = await update.message.reply_text(LOADING_BALANCE)

    try:
        # Fetch all wallet balances in parallel for speed
        async def fetch_wallet_balance(wallet_info):
            wallet_id, address, chain_type, name = wallet_info
            try:
                return await wallet_service.get_balances_by_address(address, chain_type)
            except Exception as e:
                logger.warning(f"Failed to fetch balance for {address} on {chain_type}: {e}")
                return {}

        balance_results = await asyncio.gather(
            *[fetch_wallet_balance(w) for w in wallet_infos], return_exceptions=True
        )

        # Build per-wallet display with full addresses
        text = _format_wallet_balances(wallet_infos, balance_results)

        await loading_msg.edit_text(
            text,
            parse_mode="Markdown",
            reply_markup=BALANCE_KEYBOARD,
        )

    except Exception as e:
        import traceback
        import logging

        logging.error(f"Balance fetch error: {traceback.format_exc()}")
        await loading_msg.edit_text(
            f"❌ Error fetching balances: {str(e)}\n\nPlease try again.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("🔄 Retry", callback_data="balance")],
                    [InlineKeyboardButton("« Back", callback_data="main_menu")],
                ]
            ),
        )


@enforce_tos
async def balance_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle balance button callback."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    # Get user from database
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text(
                "❌ Please use /start first to set up your account.",
            )
            return

        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_active == True,
            )
            .all()
        )

        if not wallets:
            keyboard = [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
            await query.edit_message_text(
                "👛 You don't have any wallets yet.\n\nAdd a wallet to check your balances!",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        wallet_infos = [(w.id, w.address, w.chain_type, w.name) for w in wallets]

    # Update message to show loading
    await query.edit_message_text("⏳ Fetching balances...")

    try:
        all_balances = {}

        # Fetch all wallet balances in parallel (same as balance_command)
        async def fetch_wallet_balance(wallet_info):
            wallet_id, address, chain_type, name = wallet_info
            try:
                return await wallet_service.get_balances_by_address(address, chain_type)
            except Exception as e:
                logger.warning(f"Failed to fetch balance for {address} on {chain_type}: {e}")
                return {}

        balance_results = await asyncio.gather(
            *[fetch_wallet_balance(w) for w in wallet_infos], return_exceptions=True
        )

        # Build per-wallet display with full addresses
        text = _format_wallet_balances(wallet_infos, balance_results)

        keyboard = [
            [
                InlineKeyboardButton("🔄 Refresh", callback_data="balance"),
                InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            ],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]

        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    except Exception as e:
        import traceback
        import logging

        logging.error(f"Balance callback error: {traceback.format_exc()}")
        await query.edit_message_text(
            f"❌ Error fetching balances: {str(e)}\n\nPlease try again.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("🔄 Retry", callback_data="balance")],
                    [InlineKeyboardButton("« Back", callback_data="main_menu")],
                ]
            ),
        )


def _format_wallet_balances(wallet_infos, balance_results) -> str:
    """Format balance results with clean, scannable layout."""
    total_usd = 0.0
    wallet_sections = []

    for wallet_info, balances in zip(wallet_infos, balance_results):
        wallet_id, address, chain_type, name = wallet_info

        fetch_failed = isinstance(balances, Exception)
        if fetch_failed:
            balances = {}

        icon = {"evm": "🔷", "solana": "🟣", "tron": "💎", "starknet": "🟣"}.get(chain_type, "🔷")
        short_addr = f"{address[:6]}···{address[-4:]}"
        section_lines = [f"{icon} *{safe_md(name)}*  `{short_addr}`"]

        if fetch_failed:
            section_lines.append("  _(data unavailable)_")
        elif balances:
            for chain, tokens in balances.items():
                chain_display = safe_md(format_chain_name(chain))
                # Filter to non-zero tokens
                nonzero = {s: a for s, a in tokens.items() if a > 0}
                if not nonzero:
                    continue
                section_lines.append(f"  ┌ {chain_display}")
                items = list(nonzero.items())
                for idx, (symbol, amount) in enumerate(items):
                    connector = "└" if idx == len(items) - 1 else "├"
                    section_lines.append(
                        f"  {connector} `{format_amount(amount)}` {safe_md(symbol)}"
                    )
            if len(section_lines) == 1:
                section_lines.append("  _Empty — deposit to start_")
        else:
            section_lines.append("  _Empty — deposit to start_")

        wallet_sections.append("\n".join(section_lines))

    header = "💰 *Your Balances*"
    body = "\n\n".join(wallet_sections) if wallet_sections else "_No wallets found_"
    return f"{header}\n\n{body}"


# Create handlers
balance_handler = CommandHandler("b", balance_command)
