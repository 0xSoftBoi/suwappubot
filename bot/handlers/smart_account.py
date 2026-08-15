"""/sa — ERC-4337 smart-account address viewer.

Read-only bot surface over the api-ts SmartAccountService (Kernel v0.3.1 via
permissionless.js + viem). Shows the counterfactual smart-account address and
on-chain deployment status for the user's default EVM wallet, on a chain the
user can switch between.

Moving funds through smart accounts is NOT wired here yet — that depends on
SmartAccountService.sendUserOperation, which needs a bundler key and a testnet
verification first. This command is purely informational.
"""

import logging
from typing import Optional, Tuple

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.models.user import User, Wallet
from bot.services.api_client import APIClientError, api_client
from database.db import get_session

logger = logging.getLogger(__name__)

# Must stay in sync with api-ts SUPPORTED_SMART_ACCOUNT_CHAIN_IDS.
SA_CHAINS: list[Tuple[int, str]] = [
    (8453, "Base"),
    (42161, "Arbitrum"),
    (10, "Optimism"),
    (137, "Polygon"),
    (1, "Ethereum"),
    (56, "BNB"),
]
SA_CHAIN_NAMES = dict(SA_CHAINS)
DEFAULT_SA_CHAIN_ID = 8453


def _get_default_evm_wallet(telegram_id: int) -> Optional[Tuple[str, str]]:
    """Return (wallet_name, address) for the user's default EVM wallet, or None."""
    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == telegram_id).first()
        if not user:
            return None
        base_q = session.query(Wallet).filter(
            Wallet.user_id == user.id,
            Wallet.is_active == True,  # noqa: E712 — SQLAlchemy boolean column
            Wallet.chain_type == "evm",
        )
        wallet = base_q.filter(Wallet.is_default == True).first() or base_q.first()  # noqa: E712
        if not wallet:
            return None
        return (wallet.name or "Wallet", wallet.address)


def _chain_keyboard(active_chain_id: int) -> InlineKeyboardMarkup:
    """Inline keyboard of supported chains, marking the active one."""
    buttons = []
    row = []
    for chain_id, label in SA_CHAINS:
        text = f"• {label} •" if chain_id == active_chain_id else label
        row.append(InlineKeyboardButton(text, callback_data=f"sa_chain_{chain_id}"))
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return InlineKeyboardMarkup(buttons)


async def _render(
    owner_name: str, owner_address: str, chain_id: int
) -> Tuple[str, InlineKeyboardMarkup]:
    """Build the message text + keyboard for one wallet on one chain."""
    chain_name = SA_CHAIN_NAMES.get(chain_id, str(chain_id))
    keyboard = _chain_keyboard(chain_id)

    try:
        res = await api_client.predict_smart_account(chain_id, owner_address)
    except APIClientError as e:
        logger.warning(f"smart-account predict failed for {owner_address} on {chain_id}: {e}")
        text = (
            "🦾 *Smart Account*\n\n"
            "⚠️ Couldn't reach the smart-account service right now. Please try again shortly."
        )
        return text, keyboard

    sa_address = res.get("smart_account_address", "?")
    is_deployed = bool(res.get("is_deployed"))
    status = "✅ Deployed" if is_deployed else "🆕 Not deployed yet (counterfactual)"

    text = (
        f"🦾 *Smart Account* — {chain_name}\n\n"
        f"*Owner wallet:* {owner_name}\n"
        f"`{owner_address}`\n\n"
        f"*Smart-account address:*\n"
        f"`{sa_address}`\n\n"
        f"*Status:* {status}\n\n"
        f"_An ERC-4337 (Kernel) account controlled by your wallet. The address is "
        f"the same across all chains and exists before deployment — it deploys "
        f"automatically on its first transaction._\n\n"
        f"Switch chain below. Spending through smart accounts is coming soon."
    )
    return text, keyboard


async def smart_account_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/sa — show the default EVM wallet's smart-account address."""
    tg_user = update.effective_user
    if not tg_user:
        return

    wallet = _get_default_evm_wallet(tg_user.id)
    if not wallet:
        await update.message.reply_text(
            "You don't have an EVM wallet yet. Create one with /w, then run /sa."
        )
        return

    name, address = wallet
    context.user_data["sa_wallet"] = {"name": name, "address": address}

    text, keyboard = await _render(name, address, DEFAULT_SA_CHAIN_ID)
    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=keyboard, disable_web_page_preview=True
    )


async def smart_account_chain_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Re-render the smart account for a different chain."""
    query = update.callback_query
    await query.answer()

    try:
        chain_id = int(query.data.rsplit("_", 1)[1])
    except (ValueError, IndexError):
        return
    if chain_id not in SA_CHAIN_NAMES:
        return

    wallet = context.user_data.get("sa_wallet")
    if not wallet:
        resolved = _get_default_evm_wallet(update.effective_user.id)
        if not resolved:
            await query.edit_message_text("Session expired. Run /sa again.")
            return
        wallet = {"name": resolved[0], "address": resolved[1]}
        context.user_data["sa_wallet"] = wallet

    text, keyboard = await _render(wallet["name"], wallet["address"], chain_id)
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=keyboard, disable_web_page_preview=True
    )


smart_account_handler = CommandHandler("sa", smart_account_command)
smart_account_chain_handler = CallbackQueryHandler(
    smart_account_chain_callback, pattern="^sa_chain_"
)
