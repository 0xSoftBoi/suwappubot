"""/bindwallet — signature-proved binding of an external EVM address.

This closes the loop the money-path review flagged as a BLOCKER: memberships are
bought from Robinhood Wallet (or any self-custody / smart-account wallet), whose
address never appears in the bot's Wallet table — so without an explicit,
PROVEN binding, a paid on-chain subscription would be invisible to get_tier and
the user would keep paying FREE-tier fees.

Flow (two messages, nonce held in per-user conversation state):
  1. /bindwallet            -> bot issues a one-time challenge to sign
  2. /bindwallet <addr> <sig> -> bot verifies the EIP-191 personal_sign
     signature recovers <addr> over that exact challenge, then stores the
     address on User.membership_address and invalidates the tier cache.

Security properties:
  - The challenge embeds the Telegram user id and a 128-bit nonce, so a
    signature can neither be replayed for another user nor pre-computed.
  - Nonces are single-use and expire after 10 minutes.
  - Verification uses eth_account's EIP-191 recovery — possession of the key is
    the ONLY way to bind an address.
  - EXCLUSIVITY: an address can be bound to at most one account, enforced by a
    pre-write check AND a unique index on users.membership_address. A signature
    proves someone with the key consented; it does NOT prove that someone is
    this Telegram user. Without exclusivity a single ENTERPRISE NFT could be
    signed for unlimited accounts, reintroducing exactly the shared-account
    vector the soulbound contract exists to prevent. Addresses are stored
    lowercased so the index actually collides.
  - Rate limited, and private chats only — the flow echoes an address back.
"""

import logging
import secrets
import time

from telegram import Update
from telegram.ext import CommandHandler, ContextTypes

logger = logging.getLogger(__name__)

_NONCE_TTL = 600  # seconds
_CHALLENGE_KEY = "bindwallet_challenge"  # (nonce, issued_at) in user_data


def _challenge_text(telegram_id: int, nonce: str) -> str:
    return (
        "Suwappu membership binding\n"
        f"telegram:{telegram_id}\n"
        f"nonce:{nonce}\n"
        "This signature only proves wallet ownership to Suwappu. "
        "It authorizes no transaction and costs nothing."
    )


async def bindwallet_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    args = context.args or []

    # Never run this in a group: it echoes the challenge and the bound address.
    chat = update.effective_chat
    if chat is not None and getattr(chat, "type", "private") != "private":
        await update.message.reply_text("🔒 Please use /bindwallet in a direct message with me.")
        return

    try:
        from bot.utils.rate_limiter import enforce_rate_limit_for_update, swap_limiter

        if not await enforce_rate_limit_for_update(update, swap_limiter):
            return
    except ImportError:  # pragma: no cover - limiter is optional at import time
        pass

    from bot.models.user import User
    from database.db import get_session

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please start the bot first with /start")
            return
        user_id = db_user.id
        current = db_user.membership_address

    # Step 1: no args -> issue a fresh challenge.
    if not args:
        nonce = secrets.token_hex(16)
        context.user_data[_CHALLENGE_KEY] = (nonce, time.time())
        challenge = _challenge_text(user.id, nonce)
        current_line = f"Currently bound: `{current}`\n\n" if current else ""
        await update.message.reply_text(
            "🔗 *Bind your Robinhood Wallet*\n\n"
            + current_line
            + "1. Open your wallet's *Sign message* (personal\\_sign)\n"
            "2. Sign exactly this message:\n\n"
            f"`{challenge}`\n\n"
            "3. Send back:\n"
            "`/bindwallet <address> <signature>`\n\n"
            "_Expires in 10 minutes. Signing proves ownership only — it authorizes "
            "no transaction._",
            parse_mode="Markdown",
        )
        return

    # Step 2: verify <address> <signature> against the outstanding challenge.
    if len(args) != 2:
        await update.message.reply_text(
            "Usage: `/bindwallet` then `/bindwallet <address> <signature>`", parse_mode="Markdown"
        )
        return
    address, signature = args[0].strip(), args[1].strip()
    stored = context.user_data.get(_CHALLENGE_KEY)
    if not stored or time.time() - stored[1] > _NONCE_TTL:
        context.user_data.pop(_CHALLENGE_KEY, None)
        await update.message.reply_text(
            "⏱ Challenge expired — run /bindwallet again for a fresh one."
        )
        return
    nonce = stored[0]

    if not (address.startswith("0x") and len(address) == 42):
        await update.message.reply_text("❌ That doesn't look like an EVM address.")
        return

    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct

        message = encode_defunct(text=_challenge_text(user.id, nonce))
        recovered = Account.recover_message(message, signature=signature)
    except Exception as e:
        logger.debug("bindwallet: recovery failed for user %s: %s", user_id, e)
        await update.message.reply_text(
            "❌ Signature verification failed. Sign the exact challenge text and try again."
        )
        return

    if recovered.lower() != address.lower():
        await update.message.reply_text(
            f"❌ Signature recovers `{recovered[:10]}…`, not the address you sent. "
            "Sign with the wallet you want to bind.",
            parse_mode="Markdown",
        )
        return

    # Proven. Single-use: burn the nonce, store, invalidate the tier cache.
    normalized = recovered.lower()
    with get_session() as session:
        # EXCLUSIVITY (see module docstring): one address, one account. Checked
        # here for a clean error and enforced by a unique index underneath, so a
        # concurrent bind cannot slip through the gap between check and write.
        clash = (
            session.query(User.id)
            .filter(User.membership_address == normalized, User.id != user_id)
            .first()
        )
        if clash:
            await update.message.reply_text(
                "❌ That address is already linked to another Suwappu account.\n\n"
                "Each wallet can back one account — use a different wallet, or "
                "unlink it from the other account first.",
            )
            return
        db_user = session.query(User).filter(User.id == user_id).first()
        if not db_user:
            await update.message.reply_text("❌ Account not found — try /start again.")
            return
        try:
            db_user.membership_address = normalized
            session.flush()
        except Exception:
            session.rollback()
            await update.message.reply_text(
                "❌ That address is already linked to another Suwappu account."
            )
            return

    context.user_data.pop(_CHALLENGE_KEY, None)
    try:
        from bot.services.membership_service import membership_service

        membership_service.invalidate(user_id)
    except Exception:  # pragma: no cover - cache drop is best-effort
        pass

    await update.message.reply_text(
        f"✅ *Bound* `{recovered}`\n\n"
        "Your on-chain Suwappu membership (and any tier you buy from this wallet) "
        "now counts toward your subscription automatically.",
        parse_mode="Markdown",
    )


bindwallet_handler = CommandHandler("bindwallet", bindwallet_command)
