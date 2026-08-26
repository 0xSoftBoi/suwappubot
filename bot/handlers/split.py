"""Bill-split handler.

Usage:
  /split <total> @alice @bob @carol [description] [TOKEN]

Example:
  /split 30 @alice @bob @carol dinner USDC
  /split 30 @alice @bob             (default: USDC on Base, no description)

Each listed debtor gets an inline 'Pay my share' button.  Tapping it debits
their custodial balance and credits the creator.  The bill is marked settled
when every share is paid.

SECURITY: the payer identity is resolved from update.effective_user.id — not
from callback_data — before any balance mutation.
"""

import logging
from decimal import Decimal, InvalidOperation

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.services.community_service import (
    DEFAULT_CHAIN,
    DEFAULT_TOKEN,
    create_split_bill,
    get_split_bill_status,
    pay_split_share,
)
from bot.utils.tos_utils import enforce_tos

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
    "Usage: /split <total> @user1 @user2 ... [description] [TOKEN]\n"
    "Example: /split 60 @alice @bob @carol dinner USDC\n"
    "Default token: USDC on Base"
)


def _parse_args(
    args: list[str],
) -> tuple[Decimal | None, list[str], str | None, str, str]:
    """Parse into (total, usernames, description, token, chain)."""
    total: Decimal | None = None
    usernames: list[str] = []
    description_parts: list[str] = []
    token = DEFAULT_TOKEN
    chain = DEFAULT_CHAIN

    remaining = list(args)

    if remaining:
        try:
            total = Decimal(remaining.pop(0))
        except InvalidOperation:
            return None, [], None, token, chain

    for item in remaining:
        if item.startswith("@"):
            usernames.append(item)
        elif item.upper() in _SUPPORTED_TOKENS:
            token = item.upper()
            chain = _CHAIN_MAP.get(token.lower(), DEFAULT_CHAIN)
        else:
            description_parts.append(item)

    description = " ".join(description_parts) if description_parts else None
    return total, usernames, description, token, chain


def _pay_keyboard(bill_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Pay my share", callback_data=f"splitpay_{bill_id}")]]
    )


@enforce_tos
async def split_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /split command."""
    user = update.effective_user
    message = update.message

    args = context.args or []
    total, usernames, description, token, chain = _parse_args(args)

    if total is None:
        await message.reply_text(f"Invalid arguments.\n\n{_USAGE}")
        return

    if total <= 0:
        await message.reply_text("Amount must be greater than 0.")
        return

    if not usernames:
        await message.reply_text(f"Please tag at least one debtor.\n\n{_USAGE}")
        return

    chat_id = str(message.chat.id)

    ok, msg, bill_id = create_split_bill(
        creator_telegram_id=user.id,
        chat_id=chat_id,
        total_amount=total,
        debtor_telegram_ids=[],  # not resolved from message; only from @mention args
        debtor_usernames=usernames,
        description=description,
        token=token,
        chain=chain,
    )

    if not ok:
        await message.reply_text(f"Could not create bill split: {msg}")
        return

    status = get_split_bill_status(bill_id)
    if not status:
        await message.reply_text("Bill created but could not fetch status.")
        return

    debtors_display = ", ".join(usernames)
    desc_line = f"\nDescription: {description}" if description else ""
    share_display = status["share_amount"]

    await message.reply_text(
        f"Bill split #{bill_id} created!\n"
        f"Total: {total} {token}{desc_line}\n"
        f"Debtors: {debtors_display}\n"
        f"Each owes: {share_display} {token}\n\n"
        f"Tap 'Pay my share' to settle your portion.",
        reply_markup=_pay_keyboard(bill_id),
    )


@enforce_tos
async def split_pay_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'Pay my share' button.

    SECURITY: payer is resolved from update.effective_user.id — NEVER from
    callback_data.  The service layer double-checks that a SplitBillShare row
    exists for this payer.id before any balance mutation.
    """
    query = update.callback_query
    await query.answer()

    payer_telegram_id = update.effective_user.id

    raw = query.data or ""
    if not raw.startswith("splitpay_"):
        await query.answer("Invalid payment data.", show_alert=True)
        return

    try:
        bill_id = int(raw.split("_", 1)[1])
    except (IndexError, ValueError):
        await query.answer("Invalid bill ID.", show_alert=True)
        return

    ok, msg = pay_split_share(
        bill_id=bill_id,
        payer_telegram_id=payer_telegram_id,
    )

    if ok:
        status = get_split_bill_status(bill_id)
        if status and status["status"] == "settled":
            try:
                await query.edit_message_text(
                    query.message.text + "\n\nBill fully settled!",
                )
            except Exception:
                pass  # Not critical if edit fails
        await query.answer(msg, show_alert=True)
    else:
        await query.answer(msg, show_alert=True)


# Handlers exported for registration
split_handler = CommandHandler("split", split_command)
split_pay_handler = CallbackQueryHandler(split_pay_callback, pattern=r"^splitpay_\d+$")

__all__ = ["split_handler", "split_pay_handler"]
