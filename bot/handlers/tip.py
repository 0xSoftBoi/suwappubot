"""Tip handler — /tip and reply-to-message tipping.

Usage:
  /tip @username 5 USDC           — tip a user by @handle
  /tip 5 USDC                     — tip the user you are replying to
  Reply to any message + /tip 5 USDC

All transfers use the custodial hot-wallet ledger (no on-chain tx).
"""

import logging
import re
from decimal import Decimal, InvalidOperation

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import CommandHandler, ContextTypes

from bot.services.community_service import DEFAULT_CHAIN, DEFAULT_TOKEN, send_tip
from bot.utils.tos_utils import enforce_tos
from database.db import get_session
from bot.models.user import User

logger = logging.getLogger(__name__)

# Supported tokens — keys must match hot_wallet_service token map
_SUPPORTED_TOKENS = {"USDC", "USDT", "ETH", "SOL", "BNB"}
_SUPPORTED_CHAINS = {
    "usdc": "base",
    "usdt": "base",
    "eth": "ethereum",
    "sol": "solana",
    "bnb": "bsc",
}

_USAGE = (
    "Usage:\n"
    "  /tip @username <amount> [TOKEN]\n"
    "  /tip <amount> [TOKEN]  (reply to a message)\n\n"
    "Supported tokens: USDC, USDT, ETH, SOL, BNB\n"
    "Default: USDC on Base"
)


def _parse_args(args: list[str]) -> tuple[str | None, Decimal | None, str, str]:
    """Parse command arguments into (username, amount, token, chain).

    Accepted forms:
      @user 5 USDC
      @user 5
      5 USDC
      5
    """
    username: str | None = None
    amount: Decimal | None = None
    token = DEFAULT_TOKEN
    chain = DEFAULT_CHAIN

    remaining = list(args)
    if remaining and remaining[0].startswith("@"):
        username = remaining.pop(0)

    if remaining:
        try:
            amount = Decimal(remaining[0])
            remaining.pop(0)
        except InvalidOperation:
            return username, None, token, chain

    if remaining:
        candidate = remaining[0].upper()
        if candidate in _SUPPORTED_TOKENS:
            token = candidate
            chain = _SUPPORTED_CHAINS.get(token.lower(), DEFAULT_CHAIN)

    return username, amount, token, chain


@enforce_tos
async def tip_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /tip command."""
    user = update.effective_user
    message = update.message

    args = context.args or []
    username, amount, token, chain = _parse_args(args)

    # Determine recipient from reply-to if not provided in args
    reply_to = message.reply_to_message if message else None
    reply_user = reply_to.from_user if reply_to else None

    if not username and not reply_user:
        await message.reply_text(f"Who do you want to tip?\n\n{_USAGE}")
        return

    if amount is None or amount <= 0:
        await message.reply_text(f"Please specify a valid amount.\n\n{_USAGE}")
        return

    # Prevent self-tipping
    if reply_user and reply_user.id == user.id:
        await message.reply_text("You cannot tip yourself.")
        return
    if username and username.lstrip("@").lower() == (user.username or "").lower():
        await message.reply_text("You cannot tip yourself.")
        return

    recipient_telegram_id: int | None = reply_user.id if reply_user else None
    recipient_username: str | None = username or (
        f"@{reply_user.username}" if reply_user and reply_user.username else None
    )

    chat_id = str(message.chat.id) if message else "0"

    ok, msg, tip_id = send_tip(
        sender_telegram_id=user.id,
        recipient_telegram_id=recipient_telegram_id,
        recipient_username=recipient_username,
        chat_id=chat_id,
        amount=amount,
        token=token,
        chain=chain,
    )

    if ok:
        display_recipient = recipient_username or (
            reply_user.first_name if reply_user else "unknown"
        )
        await message.reply_text(
            f"Tip sent: {amount} {token} to {display_recipient}",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("Check balance", callback_data="custodial_menu")]]
            ),
        )
    else:
        await message.reply_text(f"Could not send tip: {msg}")


# Handler exported for registration
tip_handler = CommandHandler("tip", tip_command)

__all__ = ["tip_handler"]
