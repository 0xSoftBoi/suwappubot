"""Quickbuy preset handler for one-tap trading.

Provides preset amount buttons (0.1/0.5/1/5 SOL) for instant
token purchases without going through the full swap wizard.
"""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CallbackQueryHandler

from bot.models.user import User, Wallet
from bot.services.swap_engine import SwapEngine
from bot.services.price_service import price_service
from bot.services.token_security.goplus_service import goplus_service
from bot.config.tokens import get_token_address
from bot.utils.rate_limiter import swap_limiter, enforce_rate_limit_for_update
from database.db import get_session

logger = logging.getLogger(__name__)

swap_engine = SwapEngine()

# Preset amounts in SOL (can extend to ETH)
SOL_PRESETS = [0.1, 0.5, 1.0, 5.0]
ETH_PRESETS = [0.01, 0.05, 0.1, 0.5]


async def quickbuy_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show quickbuy menu with token input prompt."""
    query = update.callback_query
    if query:
        await query.answer()

    text = (
        "\u26a1 *Quick Buy*\n\n"
        "Paste a token address or symbol to buy instantly "
        "with preset amounts.\n\n"
        "Or choose a popular token:"
    )

    keyboard = [
        [
            InlineKeyboardButton("SOL Tokens", callback_data="qb_chain_solana"),
            InlineKeyboardButton("ETH Tokens", callback_data="qb_chain_ethereum"),
        ],
        [
            InlineKeyboardButton("BASE Tokens", callback_data="qb_chain_base"),
            InlineKeyboardButton("ARB Tokens", callback_data="qb_chain_arbitrum"),
        ],
        [InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="main_menu")],
    ]

    if query:
        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )


async def quickbuy_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show quickbuy preset buttons for a specific chain."""
    query = update.callback_query
    await query.answer()

    chain = query.data.replace("qb_chain_", "")
    is_solana = chain == "solana"
    presets = SOL_PRESETS if is_solana else ETH_PRESETS
    native = "SOL" if is_solana else "ETH"

    # Popular tokens per chain
    popular = {
        "solana": ["BONK", "WIF", "JTO", "PYTH"],
        "ethereum": ["PEPE", "SHIB", "UNI", "LINK"],
        "base": ["DEGEN", "BRETT", "AERO"],
        "arbitrum": ["ARB", "GMX", "MAGIC"],
    }

    tokens = popular.get(chain, [])

    text = (
        f"\u26a1 *Quick Buy on {chain.title()}*\n\n"
        f"Select a token, then choose your {native} amount:"
    )

    keyboard = []
    for token in tokens:
        keyboard.append([
            InlineKeyboardButton(
                f"Buy {token}",
                callback_data=f"qb_token_{chain}_{token}",
            )
        ])

    keyboard.append([InlineKeyboardButton("\u2b05\ufe0f Back", callback_data="quickbuy_menu")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def quickbuy_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show preset amount buttons for a selected token."""
    query = update.callback_query
    await query.answer()

    # Parse: qb_token_solana_BONK
    parts = query.data.replace("qb_token_", "").split("_", 1)
    chain = parts[0]
    token = parts[1]

    is_solana = chain == "solana"
    presets = SOL_PRESETS if is_solana else ETH_PRESETS
    native = "SOL" if is_solana else "ETH"

    # Get token price
    prices = await price_service.get_prices([token])
    token_price = prices.get(token, 0)
    price_str = f"${token_price:.6f}" if token_price < 1 else f"${token_price:.2f}"

    # Get safety score
    token_addr = get_token_address(token, chain)
    safety_text = ""
    if token_addr:
        try:
            report = await goplus_service.get_token_security(token_addr, chain)
            safety_text = f"\n{goplus_service.format_safety_badge(report)}"
        except Exception:
            pass

    text = (
        f"\u26a1 *Quick Buy ${token}*\n\n"
        f"Price: {price_str}{safety_text}\n"
        f"Chain: {chain.title()}\n\n"
        f"Select amount to spend:"
    )

    keyboard = []
    row = []
    for amount in presets:
        row.append(
            InlineKeyboardButton(
                f"{amount} {native}",
                callback_data=f"qb_exec_{chain}_{token}_{amount}",
            )
        )
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)

    keyboard.append([InlineKeyboardButton("\u2b05\ufe0f Back", callback_data=f"qb_chain_{chain}")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def quickbuy_execute(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Execute a quickbuy with the selected preset amount."""
    query = update.callback_query
    await query.answer()

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return

    # Parse: qb_exec_solana_BONK_0.5
    parts = query.data.replace("qb_exec_", "").split("_")
    chain = parts[0]
    token = parts[1]
    amount = float(parts[2])

    is_solana = chain == "solana"
    native = "SOL" if is_solana else "ETH"

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("\u274c Please use /start first.")
            return

        chain_type = "solana" if is_solana else "evm"
        wallet = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.chain_type == chain_type,
            Wallet.is_active == True,
        ).first()

        if not wallet:
            await query.edit_message_text(
                f"\u274c No {chain_type} wallet found. Create one with /w first."
            )
            return

        wallet_id = wallet.id
        wallet_address = wallet.address
        user_id = db_user.id

    await query.edit_message_text(
        f"\u23f3 Getting quote for {amount} {native} \u2192 {token} on {chain.title()}..."
    )

    try:
        quote = await swap_engine.get_quote(
            from_chain=chain,
            to_chain=chain,
            from_token=native,
            to_token=token,
            amount=amount,
            from_address=wallet_address,
            slippage=0.5,
        )

        to_amount = getattr(quote, "to_amount_human", 0)
        rate_text = f"{amount} {native} \u2192 {to_amount:.4f} {token}" if to_amount else ""

        text = (
            f"\u26a1 *Quick Buy Confirm*\n\n"
            f"{rate_text}\n"
            f"Chain: {chain.title()}\n"
            f"Provider: {quote.provider}\n\n"
            f"Confirm to execute:"
        )

        # Store quote in context for execution
        context.user_data["quickbuy_quote"] = quote
        context.user_data["quickbuy_wallet_id"] = wallet_id
        context.user_data["quickbuy_user_id"] = user_id

        keyboard = [
            [InlineKeyboardButton(
                f"\u2705 Buy {token} for {amount} {native}",
                callback_data="qb_confirm",
            )],
            [InlineKeyboardButton("\u274c Cancel", callback_data="quickbuy_menu")],
        ]

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )

    except Exception as e:
        logger.error(f"Quickbuy quote error: {e}")
        await query.edit_message_text(
            f"\u274c Failed to get quote: {str(e)[:200]}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("\u2b05\ufe0f Try Again", callback_data="quickbuy_menu")]
            ]),
        )


async def quickbuy_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Confirm and execute the quickbuy."""
    query = update.callback_query
    await query.answer()

    quote = context.user_data.get("quickbuy_quote")
    wallet_id = context.user_data.get("quickbuy_wallet_id")
    user_id = context.user_data.get("quickbuy_user_id")

    if not quote or not wallet_id:
        await query.edit_message_text("\u274c Quote expired. Please try again.")
        return

    await query.edit_message_text("\u23f3 Executing swap...")

    try:
        result = await swap_engine.execute_swap(
            quote=quote,
            wallet_id=wallet_id,
            user_id=user_id,
        )

        tx_hash = getattr(result, "tx_hash", None) or "pending"
        text = (
            f"\u2705 *Swap Executed!*\n\n"
            f"TX: `{tx_hash[:20]}...`\n\n"
            f"Your {quote.to_token} should arrive shortly."
        )

        keyboard = [
            [InlineKeyboardButton("\u26a1 Buy More", callback_data="quickbuy_menu")],
            [InlineKeyboardButton("\U0001f4bc Portfolio", callback_data="portfolio")],
        ]

        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )

    except Exception as e:
        logger.error(f"Quickbuy execution error: {e}")
        await query.edit_message_text(
            f"\u274c Swap failed: {str(e)[:200]}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("\u2b05\ufe0f Try Again", callback_data="quickbuy_menu")]
            ]),
        )

    # Clean up context
    context.user_data.pop("quickbuy_quote", None)
    context.user_data.pop("quickbuy_wallet_id", None)
    context.user_data.pop("quickbuy_user_id", None)


def get_quickbuy_handlers():
    """Get all quickbuy callback handlers."""
    return [
        CallbackQueryHandler(quickbuy_menu, pattern="^quickbuy_menu$"),
        CallbackQueryHandler(quickbuy_chain, pattern=r"^qb_chain_"),
        CallbackQueryHandler(quickbuy_token, pattern=r"^qb_token_"),
        CallbackQueryHandler(quickbuy_execute, pattern=r"^qb_exec_"),
        CallbackQueryHandler(quickbuy_confirm, pattern="^qb_confirm$"),
    ]
