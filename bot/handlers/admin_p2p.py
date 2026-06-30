"""Admin handlers for native P2P escrow settlement.

``release_escrow`` / escrow refund are not user-facing — a native trade reaches
COMPLETED only when an operator confirms the off-chain fiat leg and releases the
on-chain crypto leg. These admin-gated commands expose that final step (and the
refund path) so native P2P trades can actually settle.

  /p2prelease <trade_id> <buyer_address>   escrow ──USDC──▶ buyer   (FIAT_SENT → COMPLETED)
  /p2prefund  <trade_id> <seller_address>  escrow ──USDC──▶ seller  (refund + CANCELLED)
"""

import logging

from telegram import Update
from telegram.ext import ContextTypes, CommandHandler

from bot.config.settings import settings
from bot.services.p2p_service import P2PError, p2p_service

logger = logging.getLogger(__name__)

# Admin user IDs from settings, fail-closed if not configured (mirrors admin_fees).
ADMIN_IDS = (
    [int(x) for x in settings.admin_telegram_ids.split(",") if x.strip()]
    if settings.admin_telegram_ids
    else []
)


def is_admin(user_id: int) -> bool:
    """Check if user is admin. Denies all if no admin IDs configured (fail-closed)."""
    return len(ADMIN_IDS) > 0 and user_id in ADMIN_IDS


def _parse_address(raw: str) -> str:
    """Light validation: an EVM address, 0x + 40 hex chars."""
    addr = raw.strip()
    if not (addr.startswith("0x") and len(addr) == 42):
        raise P2PError(f"Invalid address: {raw!r}")
    return addr


async def p2p_release_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: release native escrow to the buyer. Usage: /p2prelease <trade_id> <buyer_address>"""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    args = context.args or []
    if len(args) != 2:
        await update.message.reply_text(
            "Usage: `/p2prelease <trade_id> <buyer_address>`", parse_mode="Markdown"
        )
        return

    try:
        trade_id = int(args[0])
        buyer_address = _parse_address(args[1])
    except (ValueError, P2PError) as e:
        await update.message.reply_text(f"❌ {e}")
        return

    await update.message.reply_text(
        f"⏳ Releasing escrow for trade {trade_id} → {buyer_address[:10]}…"
    )
    try:
        trade = await p2p_service.release_escrow(trade_id=trade_id, buyer_address=buyer_address)
        await update.message.reply_text(
            f"✅ Trade {trade_id} released.\nStatus: `{trade.status}`\nRelease tx: `{trade.escrow_release_tx}`",
            parse_mode="Markdown",
        )
    except Exception as e:
        logger.exception("p2prelease failed for trade %s", trade_id)
        await update.message.reply_text(f"❌ Release failed: {e}")


async def p2p_refund_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: refund locked native escrow to the seller. Usage: /p2prefund <trade_id> <seller_address>"""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    args = context.args or []
    if len(args) != 2:
        await update.message.reply_text(
            "Usage: `/p2prefund <trade_id> <seller_address>`", parse_mode="Markdown"
        )
        return

    try:
        trade_id = int(args[0])
        seller_address = _parse_address(args[1])
    except (ValueError, P2PError) as e:
        await update.message.reply_text(f"❌ {e}")
        return

    await update.message.reply_text(
        f"⏳ Refunding escrow for trade {trade_id} → {seller_address[:10]}…"
    )
    try:
        trade = await p2p_service.cancel_trade(trade_id=trade_id, seller_address=seller_address)
        await update.message.reply_text(
            f"✅ Trade {trade_id} refunded + cancelled.\nStatus: `{trade.status}`",
            parse_mode="Markdown",
        )
    except Exception as e:
        logger.exception("p2prefund failed for trade %s", trade_id)
        await update.message.reply_text(f"❌ Refund failed: {e}")


# Create handlers
p2p_release_handler = CommandHandler("p2prelease", p2p_release_command)
p2p_refund_handler = CommandHandler("p2prefund", p2p_refund_command)
