"""Lucky-box (red packet) handler.

Usage:
  /luckybox <total> <count> [random|even] [TOKEN]

Example:
  /luckybox 10 5 random USDC   — 10 USDC split randomly among 5 claimers
  /luckybox 10 5               — defaults: random split, USDC on Base

Members tap the "Claim" inline button; the claim is atomic and race-safe
(SELECT FOR UPDATE + UNIQUE constraint).  Expired boxes are refunded to the
creator via a background call to community_service.expire_lucky_boxes().
"""

import logging
from decimal import Decimal, InvalidOperation

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.models.community import LuckyBox
from bot.services.community_service import (
    DEFAULT_CHAIN,
    DEFAULT_TOKEN,
    claim_lucky_box,
    create_lucky_box,
)
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)

_SUPPORTED_TOKENS = {"USDC", "USDT", "ETH", "SOL", "BNB"}
_CHAIN_MAP = {
    "usdc": "base",
    "usdt": "base",
    "eth": "ethereum",
    "sol": "solana",
    "bnb": "bsc",
}

_USAGE = (
    "Usage: /luckybox <total_amount> <count> [random|even] [TOKEN]\n"
    "Example: /luckybox 10 5 random USDC\n"
    "Default split mode: random | Default token: USDC on Base"
)


def _parse_args(args: list[str]) -> tuple[Decimal | None, int | None, str, str, str]:
    """Parse into (total_amount, count, split_mode, token, chain)."""
    total: Decimal | None = None
    count: int | None = None
    split_mode = "random"
    token = DEFAULT_TOKEN
    chain = DEFAULT_CHAIN

    remaining = list(args)

    if remaining:
        try:
            total = Decimal(remaining.pop(0))
        except InvalidOperation:
            return None, None, split_mode, token, chain

    if remaining:
        try:
            count = int(remaining.pop(0))
        except ValueError:
            return total, None, split_mode, token, chain

    for item in remaining:
        if item.lower() in ("random", "even"):
            split_mode = item.lower()
        elif item.upper() in _SUPPORTED_TOKENS:
            token = item.upper()
            chain = _CHAIN_MAP.get(token.lower(), DEFAULT_CHAIN)

    return total, count, split_mode, token, chain


def _make_box_keyboard(box_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Claim", callback_data=f"lbclaim_{box_id}")]]
    )


@enforce_tos
async def luckybox_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /luckybox command."""
    user = update.effective_user
    message = update.message

    args = context.args or []
    total, count, split_mode, token, chain = _parse_args(args)

    if total is None or count is None:
        await message.reply_text(f"Invalid arguments.\n\n{_USAGE}")
        return

    if total <= 0:
        await message.reply_text("Amount must be greater than 0.")
        return

    if count < 1 or count > 200:
        await message.reply_text("Count must be between 1 and 200.")
        return

    chat_id = str(message.chat.id)

    ok, msg, box_id = create_lucky_box(
        creator_telegram_id=user.id,
        chat_id=chat_id,
        total_amount=total,
        total_count=count,
        split_mode=split_mode,
        token=token,
        chain=chain,
    )

    if not ok:
        await message.reply_text(f"Could not create lucky box: {msg}")
        return

    await message.reply_text(
        f"Lucky box #{box_id} opened!\n"
        f"{total} {token} — {count} slots — {split_mode} split\n\n"
        f"Tap Claim to grab your share!",
        reply_markup=_make_box_keyboard(box_id),
    )


@enforce_tos
async def luckybox_claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'Claim' button press for a lucky box.

    SECURITY: claimer_telegram_id is taken from update.effective_user.id —
    NEVER from callback_data.
    """
    query = update.callback_query
    await query.answer()

    claimer_telegram_id = update.effective_user.id

    # Parse box_id from callback data (format: lbclaim_<int>)
    raw = query.data or ""
    if not raw.startswith("lbclaim_"):
        await query.answer("Invalid claim data.", show_alert=True)
        return

    try:
        box_id = int(raw.split("_", 1)[1])
    except (IndexError, ValueError):
        await query.answer("Invalid lucky box ID.", show_alert=True)
        return

    ok, msg, payout = claim_lucky_box(
        box_id=box_id,
        claimer_telegram_id=claimer_telegram_id,
    )

    if ok:
        # Refresh the box to update the keyboard/caption
        with get_session() as session:
            box = session.query(LuckyBox).filter(LuckyBox.id == box_id).first()
            if box and box.status == "exhausted":
                try:
                    await query.edit_message_text(
                        query.message.text + "\n\nAll slots claimed!",
                    )
                except Exception:
                    pass  # Message already updated or not editable
        await query.answer(msg, show_alert=True)
    else:
        await query.answer(msg, show_alert=True)


# Handlers exported for registration
luckybox_handler = CommandHandler("luckybox", luckybox_command)
luckybox_claim_handler = CallbackQueryHandler(luckybox_claim_callback, pattern=r"^lbclaim_\d+$")

__all__ = ["luckybox_handler", "luckybox_claim_handler"]
