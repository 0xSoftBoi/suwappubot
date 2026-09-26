"""/subscribe — buy a Suwappu tier on-chain with one signature.

Closes the last unwired piece: `membership_service.build_subscription_authorization`
had no caller, so the gasless subscription path existed only in tests.

Flow (two messages, mirroring /bindwallet):
  1. /subscribe pro 3      -> bot returns the exact EIP-712 payload to sign
  2. /subscribe <signature> -> bot verifies and broadcasts

Why this shape: USDG implements EIP-3009, so the user signs a transfer
authorization instead of sending `approve` + `subscribe`. One signature, no gas
for them — the relayer pays it, and the contract credits the SIGNER, so the
relayer can never redirect the subscription to itself.

Security:
  - Every field submitted on-chain comes from the payload WE generated. The user
    supplies only a signature.
  - The signer must equal the user's bound `membership_address`; recovering *an*
    address only proves someone signed, not that this user did.
  - The EIP-3009 nonce commits to (subscriber, tier, periods), so a tampered
    payload fails the contract's IntentMismatch check even if it reached it.
  - Payloads expire with the authorization's validBefore.
"""

import logging
import time

from telegram import Update
from telegram.ext import CommandHandler, ContextTypes

from bot.models.subscription import SubscriptionTier
from bot.services.membership_service import membership_service

logger = logging.getLogger(__name__)

_PENDING_KEY = "subscribe_onchain_pending"
_TIERS = {
    "pro": SubscriptionTier.PRO,
    "premium": SubscriptionTier.PREMIUM,
    "enterprise": SubscriptionTier.ENTERPRISE,
}


def _usage() -> str:
    return (
        "*Subscribe on-chain*\n\n"
        "`/subscribe <tier> <months>` — e.g. `/subscribe pro 3`\n\n"
        "Tiers: `pro` $9.99 · `premium` $29.99 · `enterprise` $99.99 per month.\n"
        "Paid in USDG on Robinhood Chain. You sign once — no gas, no approval."
    )


async def subscribe_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    chat = update.effective_chat
    if chat is not None and getattr(chat, "type", "private") != "private":
        await update.message.reply_text("🔒 Please use /subscribe in a direct message with me.")
        return

    try:
        from bot.utils.rate_limiter import enforce_rate_limit_for_update, swap_limiter

        if not await enforce_rate_limit_for_update(update, swap_limiter):
            return
    except ImportError:  # pragma: no cover
        pass

    if not membership_service.enabled:
        await update.message.reply_text(
            "On-chain membership isn't live yet — your current plan is unchanged."
        )
        return

    from bot.models.user import User
    from database.db import get_session, run_in_db

    def _load():
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            if not db_user:
                return (None, None)
            return (db_user.id, db_user.membership_address)

    user_id, bound = await run_in_db(_load)
    if user_id is None:
        await update.message.reply_text("❌ Please start the bot first with /start")
        return
    if not bound:
        await update.message.reply_text(
            "🔗 Link a wallet first with /bindwallet — that's the wallet the "
            "subscription will be credited to."
        )
        return

    args = context.args or []

    # Step 2: a single argument is the signature for the outstanding payload.
    if len(args) == 1 and args[0].startswith("0x") and len(args[0]) > 100:
        pending = context.user_data.get(_PENDING_KEY)
        if not pending or pending["valid_before"] <= int(time.time()):
            context.user_data.pop(_PENDING_KEY, None)
            await update.message.reply_text("⏱ That quote expired — run /subscribe again.")
            return

        signer = membership_service.verify_subscription_signature(pending, args[0])
        if not signer:
            await update.message.reply_text(
                "❌ Couldn't read that signature. Sign the exact payload."
            )
            return
        if signer.lower() != bound.lower():
            await update.message.reply_text(
                f"❌ That signature is from `{signer[:10]}…`, not your linked wallet.",
                parse_mode="Markdown",
            )
            return

        tx_hash = await membership_service.submit_subscription(pending, args[0])
        if tx_hash:
            # Only now: on a transient broadcast failure the quote is still the
            # user's cheapest path back in — dropping it forced a re-quote, and
            # the re-quote reads a fresh seq, so retrying the SAME signature
            # (which is safe, it reverts if the first one landed) became
            # impossible. Expiry still bounds how long it lives.
            context.user_data.pop(_PENDING_KEY, None)
            membership_service.invalidate(user_id)
            await update.message.reply_text(
                f"✅ *{pending['tier'].upper()} for {pending['periods']} month(s)* submitted.\n\n"
                f"`{tx_hash}`\n\nYour tier updates as soon as it confirms.",
                parse_mode="Markdown",
            )
            return
        # Relayer off or broadcast failed: hand back broadcastable calldata so
        # the user is never stuck holding a signature nothing can use.
        built = membership_service.build_subscribe_tx(pending, args[0])
        if built:
            await update.message.reply_text(
                "⚠️ Couldn't broadcast for you right now. Send this yourself:\n\n"
                f"To: `{built['to']}`\nData:\n`{built['data']}`",
                parse_mode="Markdown",
            )
        else:
            await update.message.reply_text("❌ Couldn't build that transaction. Try again.")
        return

    # Step 1: quote and produce the payload to sign.
    if len(args) != 2 or args[0].lower() not in _TIERS:
        await update.message.reply_text(_usage(), parse_mode="Markdown")
        return
    try:
        periods = int(args[1])
    except ValueError:
        await update.message.reply_text(_usage(), parse_mode="Markdown")
        return
    if periods < 1 or periods > 24:
        await update.message.reply_text("Choose between 1 and 24 months.")
        return

    tier = _TIERS[args[0].lower()]
    payload = await membership_service.quote_subscription(bound, tier, periods)
    if not payload:
        await update.message.reply_text("❌ Couldn't build a quote right now — try again shortly.")
        return

    context.user_data[_PENDING_KEY] = payload
    total = payload["value"] / 1_000_000
    import json

    await update.message.reply_text(
        f"🧾 *{args[0].upper()} — {periods} month(s)*\n"
        f"Total: *{total:,.2f} USDG*\n\n"
        "Sign this in your wallet (*Sign typed data* / EIP-712):\n\n"
        f"`{json.dumps(payload['typed_data'], separators=(',', ':'))}`\n\n"
        "Then send:\n`/subscribe <signature>`\n\n"
        "_You pay no gas. The signature only authorises this exact USDG amount._",
        parse_mode="Markdown",
    )


subscribe_onchain_handler = CommandHandler("subscribe", subscribe_command)
