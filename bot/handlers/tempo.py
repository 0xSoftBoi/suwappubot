"""Tempo session-key (access-key) handler — `/tempo grant|revoke|status`.

Lets a user authorize a bot-held access key on their Tempo account, scoped to
enshrined-DEX swaps with an on-chain weekly cap + 30-day expiry, so the bot can run
automated Tempo swaps (DCA / limit / snipe) without their root key and without
per-trade approval. Authority is on-chain and revocable.
"""

import logging
from datetime import datetime, timezone

from telegram import Update
from telegram.ext import ContextTypes, CommandHandler

from bot.models.user import User
from bot.services.wallet import WalletService
from bot.services.tempo_keychain import tempo_keychain_service, DEFAULT_CAP_USD
from bot.services.error_guidance import classify_swap_failure
from bot.utils.formatters import format_usd
from database.db import get_session

logger = logging.getLogger(__name__)
wallet_service = WalletService()


async def tempo_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    args = context.args or []
    sub = args[0].lower() if args else "status"

    if sub == "grant":
        cap = DEFAULT_CAP_USD
        if len(args) > 1:
            try:
                cap = float(args[1])
            except ValueError:
                pass
        await _grant(update, user_id, cap)
    elif sub == "revoke":
        await _revoke(update, user_id)
    else:
        await _status(update, user_id)


async def _status(update: Update, user_id: int) -> None:
    rec = tempo_keychain_service.get_active_key(user_id)
    if not rec:
        await update.message.reply_text(
            "🔑 *Tempo Session Key*\n\n"
            "No active key.\n\n"
            "Grant one so the bot can run automated Tempo swaps (DCA / limit / snipe) "
            "for you — gaslessly, capped on-chain, with no per-trade approval:\n"
            f"`/tempo grant [weekly $ cap]`  _(default ${DEFAULT_CAP_USD:.0f}/week, "
            "30-day expiry)_",
            parse_mode="Markdown",
        )
        return
    cap = int(rec.spend_limit_raw) / 1e6
    expiry_dt = datetime.fromtimestamp(rec.expiry, tz=timezone.utc).strftime("%Y-%m-%d")
    await update.message.reply_text(
        "🔑 *Tempo Session Key — Active*\n\n"
        f"Key: `{rec.key_address}`\n"
        "Scope: enshrined-DEX swaps (TIP-20)\n"
        f"Cap: {format_usd(cap)} / week _(enforced on-chain)_\n"
        f"Expires: {expiry_dt}\n\n"
        "Revoke anytime: `/tempo revoke`",
        parse_mode="Markdown",
    )


async def _grant(update: Update, user_id: int, cap: float) -> None:
    if tempo_keychain_service.get_active_key(user_id):
        await update.message.reply_text(
            "🔑 You already have an active session key. `/tempo revoke` first to replace it.",
            parse_mode="Markdown",
        )
        return
    wallet = wallet_service.get_default_wallet(user_id, "evm")
    if not wallet:
        await update.message.reply_text("❌ No wallet found. Use /start first.")
        return

    msg = await update.message.reply_text(
        f"🔑 Authorizing a Tempo session key (cap {format_usd(cap)}/week, 30-day expiry)…"
    )
    try:
        rec = await tempo_keychain_service.grant(user_id=user_id, wallet=wallet, cap_usd=cap)
        await msg.edit_text(
            "✅ *Session Key Active*\n\n"
            f"The bot can now run automated Tempo swaps for you, capped at "
            f"{format_usd(cap)}/week on-chain, expiring in 30 days.\n\n"
            f"Key: `{rec.key_address}`\n"
            f"Tx: [view](https://explore.tempo.xyz/tx/{rec.authorize_tx_hash})\n\n"
            "Revoke anytime: `/tempo revoke`",
            parse_mode="Markdown",
        )
    except Exception as e:
        # M3 fix: never interpolate the raw exception into the log message.
        # tempo_keychain.grant() creates the access key BEFORE encrypting it
        # (Account.create() -> encrypt_private_key_v2(access.key.hex())); if
        # anything in between raises with its input echoed into the exception
        # text, str(e) could contain the plaintext key — and by this point the
        # on-chain authorize_key tx may already be submitted, so a leaked key
        # is immediately spendable up to cap_usd. Log only the exception TYPE.
        logger.error(
            "Tempo session key grant failed for user %s: %s",
            user_id,
            type(e).__name__,
            exc_info=True,
        )
        guidance = classify_swap_failure(e, {"chain": "tempo"})
        await msg.edit_text(guidance.to_message(), parse_mode="Markdown")


async def _revoke(update: Update, user_id: int) -> None:
    msg = await update.message.reply_text("🔑 Revoking session key…")
    try:
        tx = await tempo_keychain_service.revoke(user_id)
        if not tx:
            await msg.edit_text("No active session key to revoke.")
        else:
            await msg.edit_text(f"✅ Session key revoked.\nTx: `{tx}`", parse_mode="Markdown")
    except Exception as e:
        # Same on-chain execution failure modes as _grant (gas, RPC timeout,
        # revert) — mirror its classify_swap_failure treatment rather than
        # leaking str(e) into chat.
        logger.error(
            "Tempo session key revoke failed for user %s: %s",
            user_id,
            type(e).__name__,
            exc_info=True,
        )
        guidance = classify_swap_failure(e, {"chain": "tempo"})
        await msg.edit_text(guidance.to_message(), parse_mode="Markdown")


def get_tempo_handlers():
    """Return handlers for the /tempo command."""
    return [CommandHandler("tempo", tempo_command)]
