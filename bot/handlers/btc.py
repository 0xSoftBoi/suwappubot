"""BTC bridge handlers — /btc Lightning deposits + BTC/Lightning withdrawals.

Telegram UX over bot/services/btc_bridge.py (Atomiq, Starknet Phase 3).
Mirrors the savings conversation patterns: ConversationHandler with unique
callback patterns (^btc_), persistent name, wallet selection, and a
confirm-before-execute money-path screen for withdrawals.

Flows:
- Deposit: pick (or create) a Starknet wallet → enter sats → BOLT11 invoice
  shown in a code block + lightning: link (+ QR image, best-effort). Funds
  land as WBTC on Starknet automatically once the invoice is paid.
- Withdraw: pick wallet → destination (BTC address or BOLT11 invoice,
  validated via parseAddress) → sats for plain addresses (BOLT11 encodes its
  own EXACT_OUT amount) → confirm → start_withdrawal.
- My BTC swaps: last 5 BtcSwap rows with direction, sats, state, tx links.
"""

import json
import logging
from typing import Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.config.settings import settings
from bot.models.btc_swap import BtcSwap
from bot.models.user import User, Wallet
from bot.services.btc_bridge import (
    LIGHTNING_BTC,
    MIN_BTC_OUT_SATS,
    BtcBridge,
    BtcBridgeError,
    btc_bridge,
)
from bot.services.wallet import WalletService
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    BTC_MENU,
    BTC_DEP_DEST,
    BTC_DEP_WALLET,
    BTC_DEP_AMOUNT,
    BTC_WD_WALLET,
    BTC_WD_DEST,
    BTC_WD_AMOUNT,
    BTC_WD_CONFIRM,
) = range(8)

# Deposit destinations: chain → (label, received asset, wallet chain_type).
# Botanix is deliberately ABSENT (network shutting down) and additionally
# denylisted inside btc_bridge itself.
DEPOSIT_DESTINATIONS = {
    "starknet": {"label": "Starknet", "asset": "WBTC", "wallet_chain_type": "starknet"},
    "citrea": {"label": "Citrea", "asset": "cBTC", "wallet_chain_type": "evm"},
}

wallet_service = WalletService()

# Fallback Lightning deposit limits (sats) when getSwapLimits is unavailable
DEFAULT_LN_MIN_SATS = 100
DEFAULT_LN_MAX_SATS = 2_000_000

# Recovery keyboard — "btc_menu" is a registered entry point, so this works
# even after the conversation has ended.
_RETRY_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("🔄 Try Again", callback_data="btc_menu")],
        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
    ]
)

_DIRECTION_LABELS = {
    "ln_in": "⚡ Lightning → Starknet",
    "btc_out": "📤 Starknet → BTC",
    "ln_out": "📤 Starknet → Lightning",
}


def _short(addr: str, n: int = 8) -> str:
    if not addr or len(addr) <= 2 * n + 3:
        return addr or "?"
    return f"{addr[:n]}...{addr[-n:]}"


def _tx_link(tx_hash: str) -> str:
    """Markdown explorer link: 0x → Starknet (voyager), 64-hex → BTC (mempool)."""
    if tx_hash.startswith("0x"):
        return f"[{_short(tx_hash)}](https://voyager.online/tx/{tx_hash})"
    return f"[{_short(tx_hash)}](https://mempool.space/tx/{tx_hash})"


def _format_fees(fees) -> str:
    """Best-effort human rendering of an Atomiq quote fees payload."""
    lines = []
    try:
        if isinstance(fees, dict):
            items = fees.items()
        elif isinstance(fees, list):
            items = [(f.get("type", f.get("name", "fee")), f) for f in fees if isinstance(f, dict)]
        else:
            return ""
        for name, value in items:
            if isinstance(value, dict):
                raw = BtcBridge._raw_amount(value.get("amount", value))
            else:
                raw = BtcBridge._raw_amount(value)
            if raw is not None:
                lines.append(f"  • {name}: {raw} sats")
    except Exception:  # pragma: no cover - fee shape is server-defined
        return ""
    return "\n".join(lines)


def _wallets_of_type(user_id: int, chain_type: str) -> list:
    with get_session() as session:
        return (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == chain_type,
                Wallet.is_active == True,  # noqa: E712
            )
            .all()
        )


def _starknet_wallets(user_id: int) -> list:
    return _wallets_of_type(user_id, "starknet")


def _get_wallet(user_id: int, wallet_id: int) -> Optional[Wallet]:
    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if wallet:
            session.expunge(wallet)
        return wallet


async def _resolve_user_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> Optional[int]:
    """Resolve and cache the DB user id for the Telegram user."""
    if context.user_data.get("user_id"):
        return context.user_data["user_id"]
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == update.effective_user.id).first()
        if not db_user:
            return None
        context.user_data["user_id"] = db_user.id
        return db_user.id


async def _reply(update, text, *, is_callback, keyboard=None, **kwargs):
    markup = InlineKeyboardMarkup(keyboard) if keyboard else None
    if is_callback:
        await update.callback_query.edit_message_text(text, reply_markup=markup, **kwargs)
    else:
        await update.message.reply_text(text, reply_markup=markup, **kwargs)


# ── Menu ─────────────────────────────────────────────────────────────────────


async def _render_menu(update, context, *, is_callback) -> int:
    text = (
        "₿ *BTC Bridge* — Bitcoin ⇄ Starknet\n"
        "_Atomiq · trustless atomic swaps_\n\n"
        "⚡ Deposit BTC over Lightning — lands as WBTC on Starknet (1-3 min).\n"
        "📤 Withdraw WBTC to a BTC address or Lightning invoice."
    )
    keyboard = [
        [InlineKeyboardButton("⚡ Deposit via Lightning", callback_data="btc_deposit")],
        [InlineKeyboardButton("📤 Withdraw to BTC/Lightning", callback_data="btc_withdraw")],
        [InlineKeyboardButton("📋 My BTC swaps", callback_data="btc_swaps")],
        [InlineKeyboardButton("❌ Close", callback_data="btc_close")],
    ]
    await _reply(update, text, is_callback=is_callback, keyboard=keyboard, parse_mode="Markdown")
    return BTC_MENU


async def btc_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /btc command."""
    if await _resolve_user_id(update, context) is None:
        await update.message.reply_text("❌ Please use /start first to set up your account.")
        return ConversationHandler.END
    context.user_data.pop("btc", None)
    return await _render_menu(update, context, is_callback=False)


async def btc_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if await _resolve_user_id(update, context) is None:
        await query.edit_message_text("❌ Please use /start first to set up your account.")
        return ConversationHandler.END
    context.user_data.pop("btc", None)
    return await _render_menu(update, context, is_callback=True)


async def btc_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Closed")
    context.user_data.pop("btc", None)
    from bot.handlers.start import main_menu_callback

    await main_menu_callback(update, context)
    return ConversationHandler.END


# ── Wallet selection (shared by deposit + withdraw) ──────────────────────────


def _deposit_dest(context) -> dict:
    flow = context.user_data.get("btc") or {}
    return DEPOSIT_DESTINATIONS.get(
        flow.get("dst_chain", "starknet"), DEPOSIT_DESTINATIONS["starknet"]
    )


async def _render_wallet_pick(update, context, *, action: str) -> int:
    user_id = context.user_data["user_id"]
    if action == "deposit":
        dest = _deposit_dest(context)
        chain_label = dest["label"]
        wallet_chain_type = dest["wallet_chain_type"]
        verb = f"receive {dest['asset']} into"
    else:
        chain_label = "Starknet"
        wallet_chain_type = "starknet"
        verb = "withdraw WBTC from"
    wallets = _wallets_of_type(user_id, wallet_chain_type)
    wallet_kind = "Starknet" if wallet_chain_type == "starknet" else "EVM"

    keyboard = []
    for w in wallets:
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"{w.name} ({_short(w.address, 6)})", callback_data=f"btc_w_{w.id}"
                )
            ]
        )
    keyboard.append(
        [InlineKeyboardButton(f"➕ Create {wallet_kind} Wallet", callback_data="btc_new_wallet")]
    )
    keyboard.append([InlineKeyboardButton("« Back", callback_data="btc_menu")])

    if wallets:
        text = f"👛 *Select the {wallet_kind} wallet ({chain_label}) to {verb}:*"
    else:
        text = f"👛 You need a {wallet_kind} wallet to {verb} on {chain_label}. Create one now:"

    await _reply(update, text, is_callback=True, keyboard=keyboard, parse_mode="Markdown")
    return BTC_DEP_WALLET if action == "deposit" else BTC_WD_WALLET


async def btc_deposit_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Deposit entry: pick the destination chain first (default Starknet)."""
    query = update.callback_query
    await query.answer()
    context.user_data["btc"] = {"action": "deposit"}
    text = (
        "⚡ *Lightning Deposit — choose destination*\n\n"
        "🌌 *Starknet* — lands as WBTC (default, deepest liquidity).\n"
        "🍊 *Citrea* — lands as native cBTC. _Early ecosystem with thin "
        "liquidity — swaps on Citrea may have high price impact._"
    )
    keyboard = [
        [InlineKeyboardButton("🌌 Starknet (WBTC)", callback_data="btc_dst_starknet")],
        [InlineKeyboardButton("🍊 Citrea (cBTC) — early", callback_data="btc_dst_citrea")],
        [InlineKeyboardButton("« Back", callback_data="btc_menu")],
    ]
    await _reply(update, text, is_callback=True, keyboard=keyboard, parse_mode="Markdown")
    return BTC_DEP_DEST


async def btc_dep_dest_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Destination chain picked via btc_dst_<chain>."""
    query = update.callback_query
    await query.answer()

    flow = context.user_data.get("btc")
    if not flow:
        await query.edit_message_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    dst_chain = query.data.replace("btc_dst_", "")
    if dst_chain not in DEPOSIT_DESTINATIONS:
        await query.edit_message_text("❌ Invalid destination.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    flow["dst_chain"] = dst_chain
    return await _render_wallet_pick(update, context, action="deposit")


async def btc_withdraw_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data["btc"] = {"action": "withdraw"}
    return await _render_wallet_pick(update, context, action="withdraw")


async def btc_new_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Create a wallet inline for the flow's destination chain type."""
    query = update.callback_query
    await query.answer("Creating wallet...")

    flow = context.user_data.get("btc")
    if not flow:
        await query.edit_message_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    if flow.get("action") == "deposit":
        chain_type = _deposit_dest(context)["wallet_chain_type"]
    else:
        chain_type = "starknet"
    wallet_kind = "Starknet" if chain_type == "starknet" else "EVM"

    user_id = context.user_data["user_id"]
    try:
        wallet = await wallet_service.create_wallet(
            user_id=user_id, name=f"{wallet_kind} Wallet", chain_type=chain_type
        )
    except Exception as e:
        logger.error(f"BTC bridge: {wallet_kind} wallet creation failed for user {user_id}: {e}")
        await query.edit_message_text(
            f"❌ Could not create a {wallet_kind} wallet. Please try again.",
            reply_markup=_RETRY_KEYBOARD,
        )
        return ConversationHandler.END

    return await _wallet_chosen(update, context, wallet)


async def btc_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Existing wallet picked via btc_w_<id>."""
    query = update.callback_query
    await query.answer()

    flow = context.user_data.get("btc")
    if not flow:
        await query.edit_message_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    try:
        wallet_id = int(query.data.replace("btc_w_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid wallet.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    wallet = _get_wallet(context.user_data["user_id"], wallet_id)
    if not wallet:
        await query.edit_message_text("❌ Invalid wallet selection.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    return await _wallet_chosen(update, context, wallet)


async def _wallet_chosen(update, context, wallet) -> int:
    """Continue the active flow once a Starknet wallet is resolved."""
    flow = context.user_data["btc"]
    flow["wallet_id"] = wallet.id

    if flow["action"] == "deposit":
        min_sats, max_sats = await _lightning_limits(flow.get("dst_chain", "starknet"))
        flow["min_sats"], flow["max_sats"] = min_sats, max_sats
        await _reply(
            update,
            (
                f"⚡ *Lightning Deposit*\n\n"
                f"Receiving wallet: `{_short(wallet.address, 10)}`\n"
                f"Limits: *{min_sats:,} – {max_sats:,} sats*\n\n"
                f"Enter the amount in *sats* to deposit:"
            ),
            is_callback=True,
            keyboard=[[InlineKeyboardButton("« Back", callback_data="btc_menu")]],
            parse_mode="Markdown",
        )
        return BTC_DEP_AMOUNT

    await _reply(
        update,
        (
            f"📤 *Withdraw*\n\n"
            f"From wallet: `{_short(wallet.address, 10)}`\n\n"
            f"Send the destination — a *BTC address* or a *Lightning invoice* (BOLT11):"
        ),
        is_callback=True,
        keyboard=[[InlineKeyboardButton("« Back", callback_data="btc_menu")]],
        parse_mode="Markdown",
    )
    return BTC_WD_DEST


async def _lightning_limits(dst_chain: str = "starknet"):
    """Live LN-in limits in sats, with safe defaults on any failure."""
    from bot.services.btc_bridge import DEPOSIT_DST_CHAINS

    dst_token = DEPOSIT_DST_CHAINS.get(dst_chain) or settings.btc_deposit_default_token
    min_sats, max_sats = DEFAULT_LN_MIN_SATS, DEFAULT_LN_MAX_SATS
    try:
        limits = await btc_bridge.api.get_swap_limits(LIGHTNING_BTC, dst_token)
        raw_min = BtcBridge._raw_amount((limits.get("input") or {}).get("min"))
        raw_max = BtcBridge._raw_amount((limits.get("input") or {}).get("max"))
        if raw_min:
            min_sats = int(raw_min)
        if raw_max:
            max_sats = int(raw_max)
    except Exception as e:
        logger.warning(f"BTC bridge: getSwapLimits failed, using defaults: {str(e)[:200]}")
    return min_sats, max_sats


# ── Deposit: amount → invoice ────────────────────────────────────────────────


def _parse_sats(text: str) -> Optional[int]:
    try:
        sats = int(str(text).strip().replace(",", "").replace("_", ""))
    except (TypeError, ValueError):
        return None
    return sats if sats > 0 else None


async def btc_dep_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    flow = context.user_data.get("btc")
    if not flow:
        await update.message.reply_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    sats = _parse_sats(update.message.text)
    min_sats = flow.get("min_sats", DEFAULT_LN_MIN_SATS)
    max_sats = flow.get("max_sats", DEFAULT_LN_MAX_SATS)
    if sats is None or sats < min_sats or sats > max_sats:
        await update.message.reply_text(
            f"❌ Enter a whole number of sats between {min_sats:,} and {max_sats:,}:"
        )
        return BTC_DEP_AMOUNT

    user_id = context.user_data["user_id"]
    wallet = _get_wallet(user_id, flow["wallet_id"])
    if not wallet:
        await update.message.reply_text("❌ Wallet not found.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    dst_chain = flow.get("dst_chain", "starknet")
    dest = DEPOSIT_DESTINATIONS.get(dst_chain, DEPOSIT_DESTINATIONS["starknet"])
    progress = await update.message.reply_text("⏳ Creating your Lightning invoice...")
    try:
        result = await btc_bridge.start_lightning_deposit(
            user_id, wallet, sats, dst_chain=dst_chain
        )
    except (BtcBridgeError, Exception) as e:
        if not isinstance(e, BtcBridgeError):
            logger.error(f"BTC deposit failed for user {user_id}: {e}", exc_info=True)
            msg = "❌ Could not create the deposit. Please try again."
        else:
            msg = f"❌ {e}"
        await progress.edit_text(msg, reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    invoice = result["invoice"]
    text = (
        f"⚡ *Lightning Deposit — {sats:,} sats*\n\n"
        f"`{invoice}`\n\n"
        f"[Open in Lightning wallet](lightning:{invoice})\n\n"
        f"Pay this from any Lightning wallet; funds land as {dest['asset']} on your "
        f"{dest['label']} wallet automatically (1-3 min).\n\n"
        f"Swap ID: `{result['swap_id']}`"
    )
    keyboard = [
        [InlineKeyboardButton("📋 My BTC swaps", callback_data="btc_swaps")],
        [InlineKeyboardButton("« Back", callback_data="btc_menu")],
    ]
    await progress.edit_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
        disable_web_page_preview=True,
    )
    await _send_invoice_qr(update, invoice)
    context.user_data.pop("btc", None)
    return BTC_MENU


async def _send_invoice_qr(update, invoice: str) -> None:
    """Send a QR image of the BOLT11 invoice (best-effort, qrcode is a dep)."""
    try:
        from io import BytesIO

        from bot.utils.qr_code import generate_simple_qr

        png = generate_simple_qr(f"lightning:{invoice.upper()}")
        await update.message.reply_photo(
            photo=BytesIO(png), caption="⚡ Scan to pay the Lightning invoice"
        )
    except Exception as e:  # QR is a nicety — never fail the flow on it
        logger.debug(f"BTC bridge: invoice QR generation failed: {e}")


# ── Withdraw: destination → amount → confirm → execute ──────────────────────


async def btc_wd_dest(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    flow = context.user_data.get("btc")
    if not flow:
        await update.message.reply_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    destination = (update.message.text or "").strip()
    try:
        parsed = await btc_bridge.api.parse_address(destination)
    except Exception as e:
        logger.warning(f"BTC bridge: parseAddress failed: {str(e)[:200]}")
        await update.message.reply_text(
            "❌ Could not validate that destination. Send a BTC address or a Lightning invoice:"
        )
        return BTC_WD_DEST

    addr_type = (parsed.get("type") or "").upper()
    flow["destination"] = destination
    flow["dest_type"] = addr_type

    if addr_type == "BITCOIN":
        await update.message.reply_text(
            f"📤 On-chain BTC withdrawal to:\n`{_short(destination, 12)}`\n\n"
            f"Enter the amount in *sats* (minimum {MIN_BTC_OUT_SATS:,}):",
            parse_mode="Markdown",
        )
        return BTC_WD_AMOUNT
    if addr_type == "LIGHTNING":
        # BOLT11 carries its own EXACT_OUT amount — go straight to confirm.
        flow["sats"] = None
        return await _show_wd_confirm(update, context)

    await update.message.reply_text(
        f"❌ Unsupported destination type ({addr_type or 'unknown'}). "
        f"Send a BTC address or a Lightning invoice:"
    )
    return BTC_WD_DEST


async def btc_wd_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    flow = context.user_data.get("btc")
    if not flow:
        await update.message.reply_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    sats = _parse_sats(update.message.text)
    if sats is None or sats < MIN_BTC_OUT_SATS:
        await update.message.reply_text(
            f"❌ On-chain BTC withdrawals must be at least {MIN_BTC_OUT_SATS:,} sats. "
            f"Enter a larger amount:"
        )
        return BTC_WD_AMOUNT

    flow["sats"] = sats
    return await _show_wd_confirm(update, context)


async def _show_wd_confirm(update, context) -> int:
    flow = context.user_data["btc"]
    sats = flow.get("sats")
    amount_text = "encoded in the invoice" if sats is None else f"{sats:,} sats"
    dest_label = "Lightning invoice" if flow["dest_type"] == "LIGHTNING" else "BTC address"
    text = (
        f"✅ *Confirm Withdrawal*\n\n"
        f"To: {dest_label}\n`{_short(flow['destination'], 14)}`\n"
        f"Amount: *{amount_text}* (EXACT\\_OUT — the destination receives exactly this)\n\n"
        f"Swap + network fees are deducted from your WBTC balance on top; "
        f"the exact fee breakdown is shown once the swap is created.\n\n"
        f"Proceed?"
    )
    keyboard = [
        [
            InlineKeyboardButton("🚀 Confirm", callback_data="btc_exec"),
            InlineKeyboardButton("❌ Cancel", callback_data="btc_menu"),
        ]
    ]
    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return BTC_WD_CONFIRM


async def btc_exec_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    flow = context.user_data.get("btc")
    if not flow or not flow.get("destination"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /btc", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data["user_id"]
    wallet = _get_wallet(user_id, flow["wallet_id"])
    if not wallet:
        await query.edit_message_text("❌ Wallet not found.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    await query.edit_message_text("⏳ Creating the withdrawal swap...")
    try:
        result = await btc_bridge.start_withdrawal(
            user_id, wallet, flow["destination"], sats=flow.get("sats")
        )
    except (BtcBridgeError, Exception) as e:
        if not isinstance(e, BtcBridgeError):
            logger.error(f"BTC withdrawal failed for user {user_id}: {e}", exc_info=True)
            msg = "❌ Could not create the withdrawal. Your funds were not moved."
        else:
            msg = f"❌ {e}"
        await query.edit_message_text(msg, reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    fee_lines = _format_fees(result.get("fees"))
    fee_text = f"\n*Fees:*\n{fee_lines}\n" if fee_lines else ""
    out_raw = BtcBridge._raw_amount((result.get("quote") or {}).get("outputAmount"))
    out_text = f"Destination receives: *{int(out_raw):,} sats*\n" if out_raw else ""
    text = (
        f"✅ *Withdrawal started!*\n\n"
        f"{out_text}"
        f"Swap ID: `{result['swap_id']}`\n"
        f"{fee_text}\n"
        f"The escrow transactions are signed and executed automatically. "
        f"I'll notify you when it completes — track it under 📋 My BTC swaps."
    )
    keyboard = [
        [InlineKeyboardButton("📋 My BTC swaps", callback_data="btc_swaps")],
        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
    ]
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    context.user_data.pop("btc", None)
    return BTC_MENU


# ── My BTC swaps ─────────────────────────────────────────────────────────────


async def btc_swaps_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if await _resolve_user_id(update, context) is None:
        await query.edit_message_text("❌ Please use /start first to set up your account.")
        return ConversationHandler.END
    user_id = context.user_data["user_id"]

    with get_session() as session:
        rows = (
            session.query(BtcSwap)
            .filter(BtcSwap.user_id == user_id)
            .order_by(BtcSwap.id.desc())
            .limit(5)
            .all()
        )
        swaps = [
            {
                "direction": r.direction,
                "amount_raw": r.amount_raw,
                "state": r.state,
                "finished": r.finished,
                "success": r.success,
                "tx_hashes": r.tx_hashes,
            }
            for r in rows
        ]

    if not swaps:
        text = "📋 *My BTC swaps*\n\nNo BTC bridge swaps yet."
    else:
        lines = ["📋 *My BTC swaps* (latest 5)\n"]
        for s in swaps:
            label = _DIRECTION_LABELS.get(s["direction"], s["direction"])
            try:
                sats_text = f"{int(s['amount_raw']):,} sats"
            except (TypeError, ValueError):
                sats_text = "? sats"
            if s["finished"]:
                status = "✅ done" if s["success"] else "❌ failed"
            else:
                status = f"⏳ {s['state'] or 'pending'}"
            line = f"{label} · {sats_text} · {status}"
            try:
                hashes = json.loads(s["tx_hashes"]) if s["tx_hashes"] else []
            except (TypeError, ValueError):
                hashes = []
            # Entries are either plain hash strings (legacy) or
            # {"tx_hash", "atomiq_state_num"} dicts.
            hashes = [h.get("tx_hash") if isinstance(h, dict) else h for h in hashes]
            hashes = [h for h in hashes if h]
            if hashes:
                line += "\n   " + " · ".join(_tx_link(h) for h in hashes[:3])
            lines.append(line)
        text = "\n".join(lines)

    keyboard = [[InlineKeyboardButton("« Back", callback_data="btc_menu")]]
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
        disable_web_page_preview=True,
    )
    return BTC_MENU


# ── Cancel / conversation wiring ─────────────────────────────────────────────


async def btc_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.pop("btc", None)
    if update.callback_query:
        await update.callback_query.answer("Cancelled")
        from bot.handlers.start import main_menu_callback

        await main_menu_callback(update, context)
    else:
        await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


_WALLET_PICK_HANDLERS = [
    CallbackQueryHandler(btc_wallet_callback, pattern="^btc_w_"),
    CallbackQueryHandler(btc_new_wallet_callback, pattern="^btc_new_wallet$"),
    CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
]

btc_conversation_handler = ConversationHandler(
    name="btc_bridge",
    persistent=True,
    entry_points=[
        CommandHandler("btc", btc_command),
        CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
    ],
    states={
        BTC_MENU: [
            CallbackQueryHandler(btc_deposit_callback, pattern="^btc_deposit$"),
            CallbackQueryHandler(btc_withdraw_callback, pattern="^btc_withdraw$"),
            CallbackQueryHandler(btc_swaps_callback, pattern="^btc_swaps$"),
            CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
            CallbackQueryHandler(btc_close_callback, pattern="^btc_close$"),
        ],
        BTC_DEP_DEST: [
            CallbackQueryHandler(btc_dep_dest_callback, pattern="^btc_dst_"),
            CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
        ],
        BTC_DEP_WALLET: _WALLET_PICK_HANDLERS,
        BTC_DEP_AMOUNT: [
            CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, btc_dep_amount),
        ],
        BTC_WD_WALLET: _WALLET_PICK_HANDLERS,
        BTC_WD_DEST: [
            CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, btc_wd_dest),
        ],
        BTC_WD_AMOUNT: [
            CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, btc_wd_amount),
        ],
        BTC_WD_CONFIRM: [
            CallbackQueryHandler(btc_exec_callback, pattern="^btc_exec$"),
            CallbackQueryHandler(btc_menu_callback, pattern="^btc_menu$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(btc_close_callback, pattern="^btc_close$"),
        CommandHandler("cancel", btc_cancel),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)
