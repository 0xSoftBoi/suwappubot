"""Telegram handler for /rewards — on-chain fee cashback (Rewards v1).

User flow:
  /rewards  -> summary card (accruing this epoch, claimable now, on-chain pending)
            -> [💰 Claim to balance] settles every custodially-settleable entry
               to the user's USDC custodial balance.
  Published epochs are claimed on-chain from the Mini App (wallet + Merkle proof);
  this handler only surfaces them.

Admin flow (fail-closed, same gate as /metrics):
  /rewards finalize <epoch>            aggregate + build Merkle tree
  /rewards payload <epoch>             print the setEpoch() args for ops
  /rewards published <epoch> <tx> <days>  record the setEpoch tx + claim window
  /rewards reconcile <epoch>           settle leaves the contract reports claimed,
                                       notifying each affected user
"""

import logging
import re
from datetime import datetime, timedelta

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.config.settings import settings
from bot.models.user import User
from bot.services.onchain_rewards_service import (
    CASHBACK_RATE,
    MIN_PAYOUT_USD,
    onchain_rewards_service,
)
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

ADMIN_IDS = (
    [int(x) for x in settings.admin_telegram_ids.split(",") if x.strip()]
    if settings.admin_telegram_ids
    else []
)


def _is_admin(telegram_id: int) -> bool:
    return bool(ADMIN_IDS) and telegram_id in ADMIN_IDS


def _get_db_user_id(telegram_id: int):
    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == telegram_id).first()
        return user.id if user else None


def _summary_text(summary) -> str:
    lines = [
        "💸 *Cashback Rewards*",
        "",
        f"Earn *{CASHBACK_RATE:.0%} of your swap fees back*, every week.",
        "",
        f"⏳ Accruing this epoch: *${summary.accruing_usd:.2f}*"
        + (f" (ends {summary.accruing_ends_at:%a %d %b})" if summary.accruing_ends_at else ""),
        f"✅ Claimable now: *${summary.claimable_usd:.2f}*",
    ]
    if summary.onchain_usd > 0:
        lines.append(
            f"⛓️ Claimable on-chain: *${summary.onchain_usd:.2f}* — open the Mini App "
            f"to claim USDC straight to your wallet"
        )
    if summary.carryover_usd > 0:
        lines.append(
            f"🔁 Rolling over: *${summary.carryover_usd:.2f}* "
            f"(payouts start at ${MIN_PAYOUT_USD:.0f})"
        )
    if summary.lifetime_usd > 0:
        lines.append(f"🏆 Lifetime claimed: *${summary.lifetime_usd:.2f}*")
    recent = summary.entries[:5]
    if recent:
        lines.append("")
        lines.append("*Recent epochs:*")
        status_emoji = {
            "claimable": "✅",
            "onchain": "⛓️",
            "claimed_onchain": "🏦",
            "credited": "🏦",
            "carryover": "🔁",
            "rolled": "🔁",
        }
        for e in recent:
            lines.append(
                f"  {status_emoji.get(e['status'], '•')} Epoch {e['epoch_index']}: "
                f"${e['amount_usd']:.2f} — {e['status'].replace('_', ' ')}"
            )
    return "\n".join(lines)


async def rewards_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /rewards (and admin subcommands)."""
    tg_user = update.effective_user
    if tg_user is None or update.message is None:
        return

    args = context.args or []
    if args and _is_admin(tg_user.id):
        await _handle_admin(update, context, args)
        return

    db_user_id = await run_in_db(_get_db_user_id, tg_user.id)
    if db_user_id is None:
        await update.message.reply_text("Use /start first to set up your account.")
        return

    summary = await run_in_db(onchain_rewards_service.get_user_summary, db_user_id)
    keyboard = []
    if summary.claimable_usd > 0:
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"💰 Claim ${summary.claimable_usd:.2f} to balance",
                    callback_data="rewards_claim",
                )
            ]
        )
    await update.message.reply_text(
        _summary_text(summary),
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=InlineKeyboardMarkup(keyboard) if keyboard else None,
    )


async def rewards_claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """MONEY-PATH: settle custodially-settleable entries to the USDC balance."""
    query = update.callback_query
    if query is None:
        return
    await query.answer()

    db_user_id = await run_in_db(_get_db_user_id, query.from_user.id)
    if db_user_id is None:
        await query.edit_message_text("Use /start first to set up your account.")
        return

    ok, message, amount = await run_in_db(onchain_rewards_service.credit_custodial, db_user_id)
    if ok:
        await query.edit_message_text(
            f"✅ {message}\n\nCheck /b to see your updated balance.",
            parse_mode=ParseMode.MARKDOWN,
        )
    else:
        await query.edit_message_text(message)


_TX_HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


async def _handle_admin(update: Update, context: ContextTypes.DEFAULT_TYPE, args) -> None:
    action = args[0].lower()
    message = update.message

    try:
        epoch_arg = int(args[1]) if len(args) >= 2 else None
    except ValueError:
        await message.reply_text("⚠️ Epoch must be an integer. See /rewards help.")
        return

    if action == "finalize" and epoch_arg is not None:
        ok, msg = await run_in_db(onchain_rewards_service.finalize_epoch, epoch_arg)
        await message.reply_text(("✅ " if ok else "⚠️ ") + msg)
    elif action == "payload" and epoch_arg is not None:
        payload = await run_in_db(onchain_rewards_service.get_publish_payload, epoch_arg)
        if payload is None:
            await message.reply_text("⚠️ Epoch not finalized (or has no on-chain leaves).")
        else:
            await message.reply_text(
                "setEpoch() args for the distributor:\n"
                f"  epochId: {payload['epochId']}\n"
                f"  merkleRoot: {payload['merkleRoot']}\n"
                f"  totalAmount: {payload['totalAmountBaseUnits']} "
                f"({payload['token']} base units on {payload['chain']})\n"
                f"  claimDeadline: {payload['suggestedClaimDeadline']} (suggested, unix)"
            )
    elif action == "published" and epoch_arg is not None and len(args) >= 4:
        # The recorded tx hash is the permanent proof-of-record for the epoch's
        # setEpoch submission — refuse anything that isn't a real tx hash.
        if not _TX_HASH_RE.match(args[2]):
            await message.reply_text("⚠️ tx_hash must be 0x + 64 hex chars.")
            return
        try:
            window_days = int(args[3])
            if not 1 <= window_days <= 365:
                raise ValueError
        except ValueError:
            await message.reply_text("⚠️ claim_window_days must be an integer between 1 and 365.")
            return
        deadline = datetime.utcnow() + timedelta(days=window_days)
        ok, msg = await run_in_db(
            onchain_rewards_service.mark_published, epoch_arg, args[2], deadline
        )
        await message.reply_text(("✅ " if ok else "⚠️ ") + msg)
    elif action == "reconcile" and epoch_arg is not None:
        ok, msg, settled = await run_in_db(onchain_rewards_service.reconcile_onchain, epoch_arg)
        await message.reply_text(("✅ " if ok else "⚠️ ") + msg)
        for user_id, amount_usd in settled:
            try:
                with get_session() as session:
                    user = session.query(User).filter(User.id == user_id).first()
                    chat_id = user.telegram_id if user else None
                if chat_id:
                    await context.bot.send_message(
                        chat_id=chat_id,
                        text=(
                            f"⛓️ Your on-chain cashback claim of *${amount_usd:.2f} USDC* "
                            f"is confirmed. Nice."
                        ),
                        parse_mode=ParseMode.MARKDOWN,
                    )
            except Exception as e:
                logger.warning("rewards: claim notification failed for user %s: %s", user_id, e)
    else:
        await message.reply_text(
            "Admin usage:\n"
            "/rewards finalize <epoch>\n"
            "/rewards payload <epoch>\n"
            "/rewards published <epoch> <tx_hash> <claim_window_days>\n"
            "/rewards reconcile <epoch>"
        )


rewards_handler = CommandHandler("rewards", rewards_command)
rewards_claim_handler = CallbackQueryHandler(rewards_claim_callback, pattern=r"^rewards_claim$")
