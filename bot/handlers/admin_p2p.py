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
from web3 import Web3

from bot.config.settings import settings
from bot.services.p2p_service import P2PError, p2p_service
from bot.services.error_guidance import user_facing_error

_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

logger = logging.getLogger(__name__)


def _type_suffix(exc: BaseException, safe: tuple) -> str:
    """Admin-only diagnostic hint: the exception TYPE name (never the raw
    message) appended when ``exc`` is NOT one of the curated "safe to show"
    types — lets an operator triage a genuine failure without exposing
    internals to end users (this module is admin-gated, see ``is_admin``)."""
    return "" if isinstance(exc, safe) else f" ({type(exc).__name__})"


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
    """Validate + checksum an EVM payout address; reject the zero/burn address."""
    addr = raw.strip()
    if not Web3.is_address(addr):
        raise P2PError(f"Invalid EVM address: {raw!r}")
    checksummed = Web3.to_checksum_address(addr)
    if checksummed == _ZERO_ADDRESS:
        raise P2PError("Refusing to send to the zero address.")
    return checksummed


async def p2p_release_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: release native escrow to the buyer. Usage: /p2prelease <trade_id> <buyer_address>"""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    args = context.args or []
    if len(args) not in (1, 2):
        await update.message.reply_text(
            "Usage: `/p2prelease <trade_id> [buyer_address]`\n"
            "Address is optional — defaults to the buyer recorded for the trade; "
            "if given it must match.",
            parse_mode="Markdown",
        )
        return

    try:
        trade_id = int(args[0])
        buyer_address = _parse_address(args[1]) if len(args) == 2 else None
    except (ValueError, P2PError) as e:
        logger.error("p2prelease input rejected: %s", e, exc_info=True)
        await update.message.reply_text(
            user_facing_error(e, safe_exceptions=(P2PError,), escape_for_markdown=True),
            parse_mode="Markdown",
        )
        return

    await update.message.reply_text(f"⏳ Releasing escrow for trade {trade_id}…")
    try:
        trade = await p2p_service.release_escrow(trade_id=trade_id, buyer_address=buyer_address)
        await update.message.reply_text(
            f"✅ Trade {trade_id} released.\nStatus: `{trade.status}`\nRelease tx: `{trade.escrow_release_tx}`",
            parse_mode="Markdown",
        )
    except Exception as e:
        logger.exception("p2prelease failed for trade %s", trade_id)
        await update.message.reply_text(
            user_facing_error(
                e,
                prefix=f"❌ Release failed{_type_suffix(e, (P2PError,))}: ",
                safe_exceptions=(P2PError,),
                escape_for_markdown=True,
            ),
            parse_mode="Markdown",
        )


async def p2p_refund_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: refund locked native escrow to the seller. Usage: /p2prefund <trade_id> <seller_address>"""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    args = context.args or []
    if len(args) not in (1, 2):
        await update.message.reply_text(
            "Usage: `/p2prefund <trade_id> [seller_address]`\n"
            "Address is optional — defaults to the seller recorded for the trade; "
            "if given it must match.",
            parse_mode="Markdown",
        )
        return

    try:
        trade_id = int(args[0])
        seller_address = _parse_address(args[1]) if len(args) == 2 else None
    except (ValueError, P2PError) as e:
        logger.error("p2prefund input rejected: %s", e, exc_info=True)
        await update.message.reply_text(
            user_facing_error(e, safe_exceptions=(P2PError,), escape_for_markdown=True),
            parse_mode="Markdown",
        )
        return

    await update.message.reply_text(f"⏳ Refunding escrow for trade {trade_id}…")
    try:
        trade = await p2p_service.cancel_trade(trade_id=trade_id, seller_address=seller_address)
        await update.message.reply_text(
            f"✅ Trade {trade_id} cancelled (status: `{trade.status}`). "
            f"If escrow was locked, USDC was refunded on-chain to the seller.",
            parse_mode="Markdown",
        )
    except Exception as e:
        logger.exception("p2prefund failed for trade %s", trade_id)
        await update.message.reply_text(
            user_facing_error(
                e,
                prefix=f"❌ Refund failed{_type_suffix(e, (P2PError,))}: ",
                safe_exceptions=(P2PError,),
                escape_for_markdown=True,
            ),
            parse_mode="Markdown",
        )


async def p2p_disputes_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: list native trades awaiting arbitration. Usage: /p2pdisputes"""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    try:
        disputed = await p2p_service.get_disputed_trades()
    except Exception as e:
        logger.exception("p2pdisputes failed")
        await update.message.reply_text(
            user_facing_error(
                e,
                prefix=f"❌ Could not load disputes{_type_suffix(e, (P2PError,))}: ",
                safe_exceptions=(P2PError,),
                escape_for_markdown=True,
            ),
            parse_mode="Markdown",
        )
        return

    if not disputed:
        await update.message.reply_text("✅ No open disputes.")
        return

    lines = ["⚖️ *Open disputes*\n"]
    for t in disputed:
        lines.append(
            f"• Trade `{t.id}` — {t.crypto_amount} {t.crypto_asset} on {t.crypto_chain}\n"
            f"  by `{t.disputed_by}`: {(t.dispute_reason or '')[:120]}\n"
            f"  → `/p2presolve {t.id} release` or `/p2presolve {t.id} refund`"
        )
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def p2p_resolve_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: arbitrate a dispute. Usage: /p2presolve <trade_id> <release|refund> [note]"""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    args = context.args or []
    if len(args) < 2 or args[1].lower() not in ("release", "refund"):
        await update.message.reply_text(
            "Usage: `/p2presolve <trade_id> <release|refund> [note]`\n"
            "release → crypto to the buyer; refund → crypto back to the seller.",
            parse_mode="Markdown",
        )
        return

    try:
        trade_id = int(args[0])
    except ValueError:
        await update.message.reply_text("❌ trade_id must be a number.")
        return
    resolution = args[1].lower()
    note = " ".join(args[2:]) if len(args) > 2 else None

    await update.message.reply_text(f"⏳ Resolving dispute on trade {trade_id} ({resolution})…")
    try:
        trade = await p2p_service.resolve_dispute(
            trade_id=trade_id, resolution=resolution, resolver_id=user.id, note=note
        )
        await update.message.reply_text(
            f"✅ Dispute on trade {trade_id} resolved: *{resolution}*.\n"
            f"Status: `{trade.status}`\nEscrow tx: `{trade.escrow_release_tx}`",
            parse_mode="Markdown",
        )
    except Exception as e:
        logger.exception("p2presolve failed for trade %s", trade_id)
        await update.message.reply_text(
            user_facing_error(
                e,
                prefix=f"❌ Resolve failed{_type_suffix(e, (P2PError,))}: ",
                safe_exceptions=(P2PError,),
                escape_for_markdown=True,
            ),
            parse_mode="Markdown",
        )


async def p2p_dispute_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Open a dispute on your own trade. Usage: /p2pdispute <trade_id> <reason>"""
    user = update.effective_user
    args = context.args or []
    if len(args) < 2:
        await update.message.reply_text(
            "Usage: `/p2pdispute <trade_id> <reason>`\n"
            "Freezes the escrow so neither side can move it until an arbiter decides.",
            parse_mode="Markdown",
        )
        return

    try:
        trade_id = int(args[0])
    except ValueError:
        await update.message.reply_text("❌ trade_id must be a number.")
        return
    reason = " ".join(args[1:])

    try:
        await p2p_service.open_dispute(trade_id=trade_id, reason=reason, opened_by=user.id)
        await update.message.reply_text(
            f"⚖️ Dispute opened on trade {trade_id}. The escrow is frozen; "
            f"our team will review and decide. You'll be notified of the outcome."
        )
    except Exception as e:
        logger.error("p2pdispute rejected for trade %s: %s", trade_id, e, exc_info=True)
        await update.message.reply_text(
            user_facing_error(e, safe_exceptions=(P2PError,), escape_for_markdown=True),
            parse_mode="Markdown",
        )


# Create handlers
p2p_release_handler = CommandHandler("p2prelease", p2p_release_command)
p2p_refund_handler = CommandHandler("p2prefund", p2p_refund_command)
p2p_disputes_handler = CommandHandler("p2pdisputes", p2p_disputes_command)
p2p_resolve_handler = CommandHandler("p2presolve", p2p_resolve_command)
p2p_dispute_handler = CommandHandler("p2pdispute", p2p_dispute_command)
