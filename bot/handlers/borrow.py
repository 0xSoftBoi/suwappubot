"""/borrow — USDC borrowing against cbBTC collateral via Morpho Blue on Base.

Structure mirrors bot/handlers/savings.py (the Phase-4 ₿ Bitcoin section):
ConversationHandler with unique ^borrow_ callback patterns, wallet selection,
confirm-before-execute money-path screens, and recovery keyboards on errors.

All on-chain work happens in MorphoAPI (blocking web3); handlers offload those
calls with asyncio.to_thread so the event loop stays responsive.

Money-path UX invariants (see docs/plans/btcfi-expansion-plan.md §P2):
- every borrow confirm screen shows the liquidation price;
- LTV choices are capped at MAX_LTV (64.5%) — never the protocol's 86% LLTV;
- collateral withdrawals that would drop HF below MIN_WITHDRAW_HF are blocked
  in the handler with a clear message (the service enforces it again).
"""

import asyncio
import logging
import math

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.config.morpho_config import (
    CBBTC,
    CBBTC_DECIMALS,
    DEFAULT_LTV,
    LLTV,
    MAX_LTV,
    MIN_WITHDRAW_HF,
    ORACLE_PRICE_SCALE,
    URGENT_HF,
    USDC_DECIMALS,
    WAD,
    WARN_HF,
)
from bot.models.user import User, Wallet
from bot.services.morpho_api import (
    MorphoError,
    collateral_value_usdc_raw,
    compute_health_factor,
    morpho_api,
)
from bot.services.wallet import WalletService
from bot.utils.formatters import format_tx_link
from bot.utils.validators import validate_amount
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    BORROW_MENU,
    BORROW_SELECT_WALLET,
    BORROW_ENTER_COLLATERAL,
    BORROW_SELECT_LTV,
    BORROW_CONFIRM,
    BORROW_MANAGE_AMOUNT,
    BORROW_MANAGE_CONFIRM,
) = range(7)

wallet_service = WalletService()

# LTV choices for the open-borrow flow. Keys are embedded in callback data and
# anchored in the conversation pattern — unknown keys can never enter the state.
LTV_OPTIONS = {
    "25": ("25% — conservative", 0.25),
    "50": ("50% — recommended", DEFAULT_LTV),
    "645": ("64.5% — max", MAX_LTV),
}
_BORROW_LTV_PATTERN = "^borrow_ltv_(?:" + "|".join(LTV_OPTIONS) + ")$"

# Recovery keyboard for error screens — "borrow_menu" is a registered entry
# point, so this works even after the conversation has ended.
_RETRY_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("🔄 Try Again", callback_data="borrow_menu")],
        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
    ]
)

_BACK_KEYBOARD = InlineKeyboardMarkup(
    [[InlineKeyboardButton("« Back to Borrow", callback_data="borrow_menu")]]
)


# ── pure helpers (unit-tested) ────────────────────────────────────────────────


def _hf_emoji(hf: float) -> str:
    """Emoji tier for a health factor (∞ when no debt)."""
    if math.isinf(hf) or hf >= 1.5:
        return "🟢"
    if hf >= WARN_HF:
        return "🟡"
    if hf >= URGENT_HF:
        return "🟠"
    return "🔴"


def _fmt_hf(hf: float) -> str:
    return "∞" if math.isinf(hf) else f"{hf:.2f}"


def _fmt_btc(raw: int) -> str:
    return f"{raw / 10**CBBTC_DECIMALS:.8f}".rstrip("0").rstrip(".") or "0"


def _fmt_usdc(raw: int) -> str:
    return f"{raw / 10**USDC_DECIMALS:,.2f}"


def _fmt_liq_price(price_usd: float) -> str:
    return f"${price_usd:,.0f}"


def _borrow_for_ltv(collateral_raw: int, price: int, ltv: float) -> int:
    """USDC raw units borrowable at a target LTV against the given collateral."""
    return int(collateral_value_usdc_raw(collateral_raw, price) * ltv)


def _max_safe_withdraw_raw(collateral_raw: int, price: int, debt_raw: int) -> int:
    """Max cbBTC withdrawable while keeping post-withdraw HF ≥ MIN_WITHDRAW_HF.

    Remaining collateral r must satisfy max_borrow(r) ≥ MIN_WITHDRAW_HF × debt:
    r ≥ ceil(MIN_WITHDRAW_HF · debt · 1e36 · 1e18 / (price · LLTV)).
    """
    if debt_raw <= 0:
        return collateral_raw
    if price <= 0:
        return 0
    needed_num = int(MIN_WITHDRAW_HF * debt_raw) * ORACLE_PRICE_SCALE * WAD
    needed_den = price * LLTV
    r_min = (needed_num + needed_den - 1) // needed_den
    return max(0, collateral_raw - r_min)


def _withdraw_block_text(hf_after: float) -> str:
    """Clear block message when a withdrawal would breach the health floor."""
    return (
        f"🚫 *Withdrawal blocked.*\n\n"
        f"That withdrawal would drop your health factor to *{hf_after:.2f}* — "
        f"below the *{MIN_WITHDRAW_HF}* safety floor.\n\n"
        f"Repay some debt first, or withdraw a smaller amount."
    )


def _parse_btc_amount(text: str):
    """Parse a BTC amount (max 8 decimals) → raw int, or None if invalid."""
    from decimal import Decimal, InvalidOperation

    try:
        clean = (text or "").replace(",", "").replace(" ", "").strip()
        if not clean or len(clean) > 32:
            return None
        amount = Decimal(clean)
    except (InvalidOperation, ValueError):
        return None
    if amount <= 0 or amount > Decimal(21_000_000):  # BTC supply cap sanity bound
        return None
    raw = amount * Decimal(10**CBBTC_DECIMALS)
    if raw != raw.to_integral_value():
        return None  # more than 8 decimal places
    return int(raw)


def _format_open_confirm(
    collateral_raw: int, borrow_raw: int, preview: dict, borrow_apy_text: str
) -> str:
    """Open-borrow confirmation screen — ALWAYS shows the liquidation price."""
    hf = preview["health_factor"]
    return (
        f"✅ *Confirm Borrow*\n\n"
        f"Collateral: *{_fmt_btc(collateral_raw)} cbBTC*\n"
        f"Borrow: *{_fmt_usdc(borrow_raw)} USDC*\n\n"
        f"LTV: *{preview['ltv']:.1%}* (max {MAX_LTV:.1%})\n"
        f"Health Factor: {_hf_emoji(hf)} *{_fmt_hf(hf)}*\n"
        f"Liquidation Price: *{_fmt_liq_price(preview['liquidation_price'])}* / BTC "
        f"(now {_fmt_liq_price(preview['btc_price_usd'])})\n"
        f"Borrow APY: *{borrow_apy_text}* (variable)\n\n"
        f"Network: Base · Morpho Blue\n"
        f"⛽ Gas: paid in ETH on Base. 3 transactions: approve → "
        f"supply collateral → borrow.\n\nProceed?"
    )


# ── DB / chain helpers ────────────────────────────────────────────────────────


def _evm_wallets(user_id: int) -> list:
    with get_session() as session:
        return (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == "evm",
                Wallet.is_active == True,  # noqa: E712
            )
            .all()
        )


def _get_wallet(user_id: int, wallet_id: int):
    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if wallet:
            session.expunge(wallet)
        return wallet


def _cbbtc_balance_raw(address: str) -> int:
    """cbBTC balance in raw units (blocking — call via asyncio.to_thread)."""
    from web3 import Web3

    owner = Web3.to_checksum_address(address)
    return int(
        morpho_api._failover(
            lambda web3: morpho_api._erc20(web3, CBBTC).functions.balanceOf(owner).call()
        )
    )


def _basescan_tx(tx_hash: str) -> str:
    if tx_hash and not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    return format_tx_link(tx_hash, "base")


def _tx_links(tx_hashes: list) -> str:
    return "\n".join(_basescan_tx(h) for h in tx_hashes)


async def _ensure_user_id(update: Update, context) -> bool:
    if context.user_data.get("user_id"):
        return True
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == update.effective_user.id).first()
        if not db_user:
            return False
        context.user_data["user_id"] = db_user.id
    return True


# ── menu ──────────────────────────────────────────────────────────────────────


async def _render_menu(update, context, *, is_callback):
    """Dashboard: position (collateral, debt, LTV, HF, liquidation price) or intro."""

    async def _send(text, keyboard):
        markup = InlineKeyboardMarkup(keyboard)
        if is_callback:
            await update.callback_query.edit_message_text(
                text, parse_mode="Markdown", reply_markup=markup
            )
        else:
            await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)

    user_id = context.user_data.get("user_id")
    wallets = _evm_wallets(user_id)
    if not wallets:
        await _send(
            "👛 You need an EVM wallet (Base) to borrow against BTC.",
            [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]],
        )
        return ConversationHandler.END

    wallet = wallet_service.get_default_wallet(user_id, "evm") or wallets[0]
    borrow = context.user_data.setdefault("borrow", {})
    borrow["wallet_id"] = wallet.id
    borrow["wallet_address"] = wallet.address
    addr_short = f"{wallet.address[:6]}...{wallet.address[-4:]}"

    try:
        position = await asyncio.to_thread(morpho_api.get_position, wallet.address)
    except MorphoError as e:
        await _send(
            f"❌ {e}",
            [
                [InlineKeyboardButton("🔄 Try Again", callback_data="borrow_menu")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ],
        )
        return BORROW_MENU
    borrow["position"] = position

    apy_text = "—"
    try:
        apys = await morpho_api.get_market_apys()
        apy_text = f"{apys['borrow_apy']:.2%}"
    except (MorphoError, Exception) as e:  # APY is informational, never blocking
        logger.debug(f"borrow menu APY fetch failed: {e}")

    has_position = position["collateral_raw"] > 0 or position["debt_usdc_raw"] > 0
    if has_position:
        hf = position["health_factor"]
        liq = (
            f"{_fmt_liq_price(position['liquidation_price'])} / BTC"
            if position["debt_usdc_raw"] > 0
            else "— (no debt)"
        )
        text = (
            f"₿ *Borrow* — USDC against your BTC\n"
            f"_Non-custodial · Morpho Blue · Base_\n\n"
            f"👛 Wallet ({addr_short}):\n"
            f"   • Collateral: *{_fmt_btc(position['collateral_raw'])} cbBTC* "
            f"(${position['collateral_value_usdc']:,.2f})\n"
            f"   • Debt: *{_fmt_usdc(position['debt_usdc_raw'])} USDC*\n"
            f"   • LTV: *{position['ltv']:.1%}* (max {MAX_LTV:.1%})\n"
            f"   • Health Factor: {_hf_emoji(hf)} *{_fmt_hf(hf)}*\n"
            f"   • Liquidation Price: *{liq}*\n\n"
            f"📈 BTC price: ${position['btc_price_usd']:,.0f} · Borrow APY: {apy_text}"
        )
        keyboard = [
            [
                InlineKeyboardButton("💵 Borrow More", callback_data="borrow_open"),
                InlineKeyboardButton("➕ Add Collateral", callback_data="borrow_add"),
            ],
            [
                InlineKeyboardButton("💸 Repay", callback_data="borrow_repay"),
                InlineKeyboardButton("➖ Withdraw Collateral", callback_data="borrow_withdraw"),
            ],
            [InlineKeyboardButton("🏁 Close Position", callback_data="borrow_close_pos")],
            [
                InlineKeyboardButton("🔄 Refresh", callback_data="borrow_menu"),
                InlineKeyboardButton("❌ Close", callback_data="borrow_close"),
            ],
        ]
    else:
        text = (
            f"₿ *Borrow* — USDC against your BTC\n"
            f"_Non-custodial · Morpho Blue · Base_\n\n"
            f"Deposit cbBTC as collateral and borrow USDC against it. "
            f"Keep your BTC exposure while unlocking dollars.\n\n"
            f"📈 BTC price: ${position['btc_price_usd']:,.0f} · Borrow APY: {apy_text}\n"
            f"• Borrow up to *{MAX_LTV:.1%}* LTV (50% recommended)\n"
            f"• Liquidation only if LTV reaches 86%\n"
            f"• Repay and withdraw anytime\n\n"
            f"👛 Wallet: {addr_short}"
        )
        keyboard = [
            [InlineKeyboardButton("💵 Borrow USDC", callback_data="borrow_open")],
            [
                InlineKeyboardButton("🔄 Refresh", callback_data="borrow_menu"),
                InlineKeyboardButton("❌ Close", callback_data="borrow_close"),
            ],
        ]

    await _send(text, keyboard)
    return BORROW_MENU


@enforce_tos
async def borrow_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /borrow command."""
    if not await _ensure_user_id(update, context):
        await update.message.reply_text("❌ Please use /start first to set up your account.")
        return ConversationHandler.END
    context.user_data.pop("borrow", None)
    return await _render_menu(update, context, is_callback=False)


async def borrow_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Refreshing...")
    if not await _ensure_user_id(update, context):
        await query.edit_message_text("❌ Please use /start first to set up your account.")
        return ConversationHandler.END
    return await _render_menu(update, context, is_callback=True)


async def borrow_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Closed")
    context.user_data.pop("borrow", None)
    from bot.handlers.start import main_menu_callback

    await main_menu_callback(update, context)
    return ConversationHandler.END


# ── open flow: wallet → collateral amount → LTV → confirm → execute ──────────


async def borrow_open_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Begin a borrow: choose which Base wallet supplies the cbBTC collateral."""
    query = update.callback_query
    await query.answer()

    user_id = context.user_data.get("user_id")
    wallets = _evm_wallets(user_id)
    if not wallets:
        await query.edit_message_text(
            "❌ No EVM wallet found. Add one first.",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
            ),
        )
        return ConversationHandler.END

    keyboard = []
    for w in wallets:
        addr_short = f"{w.address[:6]}...{w.address[-4:]}"
        keyboard.append(
            [InlineKeyboardButton(f"{w.name} ({addr_short})", callback_data=f"borrow_w_{w.id}")]
        )
    keyboard.append([InlineKeyboardButton("« Back", callback_data="borrow_menu")])

    await query.edit_message_text(
        "👛 *Select the Base wallet holding your cbBTC:*",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return BORROW_SELECT_WALLET


async def borrow_select_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Wallet picked → show cbBTC balance and prompt for a collateral amount."""
    query = update.callback_query
    await query.answer()

    try:
        wallet_id = int(query.data.replace("borrow_w_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid wallet.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    borrow = context.user_data.get("borrow")
    if borrow is None:
        await query.edit_message_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet = _get_wallet(user_id, wallet_id)
    if not wallet:
        await query.edit_message_text("❌ Invalid wallet selection.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END
    borrow["wallet_id"] = wallet.id
    borrow["wallet_address"] = wallet.address

    try:
        balance_raw = await asyncio.to_thread(_cbbtc_balance_raw, wallet.address)
    except Exception:
        # Never present a false 0 balance on an RPC failure — stop here.
        await query.edit_message_text(
            "⚠️ cbBTC balance unavailable (RPC error) — try again.", reply_markup=_RETRY_KEYBOARD
        )
        return BORROW_MENU
    borrow["cbbtc_balance_raw"] = balance_raw

    if balance_raw <= 0:
        await query.edit_message_text(
            "❌ This wallet holds no cbBTC on Base. Bridge or buy cbBTC first (try /s).",
            reply_markup=_BACK_KEYBOARD,
        )
        return BORROW_MENU

    await query.edit_message_text(
        f"➕ *Deposit cbBTC collateral*\n\n"
        f"Available: *{_fmt_btc(balance_raw)} cbBTC*\n\n"
        f"Enter an amount in BTC (up to 8 decimals, e.g. 0.005):",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="borrow_menu")]]
        ),
    )
    return BORROW_ENTER_COLLATERAL


async def borrow_enter_collateral(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Typed cbBTC amount (8dp validation) → LTV choice buttons."""
    borrow = context.user_data.get("borrow")
    if not borrow or not borrow.get("wallet_address"):
        await update.message.reply_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    amount_raw = _parse_btc_amount(update.message.text)
    if amount_raw is None:
        await update.message.reply_text(
            "❌ Invalid amount. Enter a BTC amount with at most 8 decimals (e.g. 0.005):"
        )
        return BORROW_ENTER_COLLATERAL

    balance_raw = int(borrow.get("cbbtc_balance_raw") or 0)
    if amount_raw > balance_raw:
        await update.message.reply_text(
            f"❌ Amount exceeds your balance ({_fmt_btc(balance_raw)} cbBTC). "
            f"Enter a smaller amount:"
        )
        return BORROW_ENTER_COLLATERAL

    try:
        state = await asyncio.to_thread(morpho_api.get_market_state)
    except MorphoError as e:
        await update.message.reply_text(f"❌ {e}", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    borrow["collateral_raw"] = amount_raw
    borrow["price_raw"] = state["price"]

    keyboard = [
        [
            InlineKeyboardButton(
                f"{label} → {_fmt_usdc(_borrow_for_ltv(amount_raw, state['price'], ltv))} USDC",
                callback_data=f"borrow_ltv_{key}",
            )
        ]
        for key, (label, ltv) in LTV_OPTIONS.items()
    ]
    keyboard.append([InlineKeyboardButton("« Back", callback_data="borrow_menu")])

    await update.message.reply_text(
        f"📐 *Choose your LTV* (loan-to-value)\n\n"
        f"Collateral: *{_fmt_btc(amount_raw)} cbBTC* "
        f"(${collateral_value_usdc_raw(amount_raw, state['price']) / 10**USDC_DECIMALS:,.2f})\n\n"
        f"Lower LTV = safer (liquidation only at 86% LTV).",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return BORROW_SELECT_LTV


async def borrow_ltv_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """LTV picked → confirm screen with LTV, HF, liquidation price, borrow APY."""
    query = update.callback_query
    await query.answer()

    borrow = context.user_data.get("borrow")
    if not borrow or not borrow.get("collateral_raw"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    key = query.data.replace("borrow_ltv_", "")
    if key not in LTV_OPTIONS:
        await query.edit_message_text("❌ Invalid LTV choice.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END
    _, ltv = LTV_OPTIONS[key]

    collateral_raw = int(borrow["collateral_raw"])
    borrow_raw = _borrow_for_ltv(collateral_raw, int(borrow["price_raw"]), ltv)
    if borrow_raw <= 0:
        await query.edit_message_text(
            "❌ Borrow amount is too small.", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END
    borrow["borrow_raw"] = borrow_raw

    try:
        preview = await asyncio.to_thread(
            morpho_api.preview_borrow, borrow["wallet_address"], collateral_raw, borrow_raw
        )
    except MorphoError as e:
        await query.edit_message_text(f"❌ {e}", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    apy_text = "—"
    try:
        apys = await morpho_api.get_market_apys()
        apy_text = f"{apys['borrow_apy']:.2%}"
    except (MorphoError, Exception) as e:
        logger.debug(f"borrow confirm APY fetch failed: {e}")

    keyboard = [
        [
            InlineKeyboardButton("🚀 Confirm", callback_data="borrow_exec"),
            InlineKeyboardButton("❌ Cancel", callback_data="borrow_menu"),
        ]
    ]
    await query.edit_message_text(
        _format_open_confirm(collateral_raw, borrow_raw, preview, apy_text),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return BORROW_CONFIRM


async def borrow_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute supply-collateral + borrow on-chain with progress edits."""
    query = update.callback_query
    await query.answer()

    borrow = context.user_data.get("borrow")
    if not borrow or not borrow.get("collateral_raw") or not borrow.get("borrow_raw"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet = _get_wallet(user_id, borrow.get("wallet_id"))
    if not wallet:
        await query.edit_message_text("❌ Wallet not found.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    collateral_raw = int(borrow["collateral_raw"])
    borrow_raw = int(borrow["borrow_raw"])

    await query.edit_message_text(
        "⏳ Submitting borrow...\n\n"
        "1/3 Approving cbBTC → 2/3 Supplying collateral → 3/3 Borrowing USDC.\n"
        "Each transaction is confirmed on Base before the next — this can take a minute."
    )

    try:
        tx_hashes = await asyncio.to_thread(
            morpho_api.open_borrow, wallet, collateral_raw, borrow_raw
        )
        morpho_api.record_position_open(user_id, wallet.id)
        text = (
            f"✅ *Borrow submitted!*\n\n"
            f"Supplied *{_fmt_btc(collateral_raw)} cbBTC* and borrowed "
            f"*{_fmt_usdc(borrow_raw)} USDC* to your wallet.\n\n"
            f"*Transactions:*\n{_tx_links(tx_hashes)}"
        )
        keyboard = [
            [InlineKeyboardButton("₿ Back to Borrow", callback_data="borrow_menu")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )
    except MorphoError as e:
        await query.edit_message_text(f"❌ {e}", reply_markup=_RETRY_KEYBOARD)
    except Exception as e:
        logger.error(f"borrow open unexpected error for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ Something went wrong. Check your wallet on basescan before retrying.",
            reply_markup=_RETRY_KEYBOARD,
        )
    return BORROW_MENU


# ── manage: add collateral / repay / withdraw collateral / close ─────────────


async def borrow_manage_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Add-collateral / repay / withdraw entry → amount prompt (or sentinel)."""
    query = update.callback_query
    await query.answer()

    borrow = context.user_data.get("borrow")
    position = (borrow or {}).get("position")
    if not borrow or position is None:
        await query.edit_message_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    data = query.data
    back_kb = InlineKeyboardMarkup([[InlineKeyboardButton("« Back", callback_data="borrow_menu")]])

    if data == "borrow_add":
        borrow["action"] = "add"
        try:
            balance_raw = await asyncio.to_thread(_cbbtc_balance_raw, borrow["wallet_address"])
        except Exception:
            await query.edit_message_text(
                "⚠️ cbBTC balance unavailable (RPC error) — try again.",
                reply_markup=_RETRY_KEYBOARD,
            )
            return BORROW_MENU
        borrow["available_raw"] = balance_raw
        await query.edit_message_text(
            f"➕ *Add cbBTC collateral*\n\n"
            f"Available: *{_fmt_btc(balance_raw)} cbBTC*\n\n"
            f"Enter an amount in BTC (up to 8 decimals):",
            parse_mode="Markdown",
            reply_markup=back_kb,
        )
        return BORROW_MANAGE_AMOUNT

    if data == "borrow_repay":
        borrow["action"] = "repay"
        borrow["available_raw"] = int(position["debt_usdc_raw"])
        await query.edit_message_text(
            f"💸 *Repay USDC debt*\n\n"
            f"Current debt: *{_fmt_usdc(position['debt_usdc_raw'])} USDC*\n\n"
            f"Enter a USDC amount, or repay everything (clears interest dust exactly):",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("💯 Repay All", callback_data="borrow_repay_all")],
                    [InlineKeyboardButton("« Back", callback_data="borrow_menu")],
                ]
            ),
        )
        return BORROW_MANAGE_AMOUNT

    if data == "borrow_repay_all":
        borrow["action"] = "repay"
        borrow["amount_raw"] = None  # full-repay sentinel (shares-exact)
        return await _show_manage_confirm(update, context, is_callback=True)

    if data == "borrow_withdraw":
        borrow["action"] = "withdraw"
        max_safe = _max_safe_withdraw_raw(
            int(position["collateral_raw"]),
            int(position["price_raw"]),
            int(position["debt_usdc_raw"]),
        )
        borrow["available_raw"] = int(position["collateral_raw"])
        keyboard = [[InlineKeyboardButton("« Back", callback_data="borrow_menu")]]
        if position["debt_usdc_raw"] <= 0:
            keyboard.insert(
                0, [InlineKeyboardButton("💯 Withdraw All", callback_data="borrow_wd_all")]
            )
        await query.edit_message_text(
            f"➖ *Withdraw cbBTC collateral*\n\n"
            f"Collateral: *{_fmt_btc(position['collateral_raw'])} cbBTC*\n"
            f"Max safe withdrawal (keeps HF ≥ {MIN_WITHDRAW_HF}): "
            f"*{_fmt_btc(max_safe)} cbBTC*\n\n"
            f"Enter an amount in BTC (up to 8 decimals):",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return BORROW_MANAGE_AMOUNT

    if data == "borrow_wd_all":
        borrow["action"] = "withdraw"
        if int(position["debt_usdc_raw"]) > 0:
            await query.edit_message_text(
                _withdraw_block_text(0.0)
                + "\n\nTo exit fully, use 🏁 Close Position (repays debt first).",
                parse_mode="Markdown",
                reply_markup=_BACK_KEYBOARD,
            )
            return BORROW_MENU
        borrow["amount_raw"] = int(position["collateral_raw"])
        return await _show_manage_confirm(update, context, is_callback=True)

    if data == "borrow_close_pos":
        borrow["action"] = "close"
        borrow["amount_raw"] = None
        return await _show_manage_confirm(update, context, is_callback=True)

    await query.edit_message_text("❌ Unknown action.", reply_markup=_RETRY_KEYBOARD)
    return BORROW_MENU


async def borrow_manage_enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Typed amount for add / repay / withdraw."""
    borrow = context.user_data.get("borrow")
    position = (borrow or {}).get("position")
    if not borrow or not borrow.get("action") or position is None:
        await update.message.reply_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    action = borrow["action"]
    available_raw = int(borrow.get("available_raw") or 0)

    if action == "repay":
        amount = validate_amount(update.message.text)
        if amount is None or amount <= 0:
            await update.message.reply_text(
                "❌ Invalid amount. Enter a USDC amount (e.g. 100 or 50.5):"
            )
            return BORROW_MANAGE_AMOUNT
        amount_raw = int(round(float(amount) * 10**USDC_DECIMALS))
        # Typed amount that covers the whole debt → use the shares-exact full repay.
        borrow["amount_raw"] = None if amount_raw >= available_raw else amount_raw
        return await _show_manage_confirm(update, context, is_callback=False)

    amount_raw = _parse_btc_amount(update.message.text)
    if amount_raw is None:
        await update.message.reply_text(
            "❌ Invalid amount. Enter a BTC amount with at most 8 decimals (e.g. 0.005):"
        )
        return BORROW_MANAGE_AMOUNT
    if amount_raw > available_raw:
        await update.message.reply_text(
            f"❌ Amount exceeds available ({_fmt_btc(available_raw)} cbBTC). "
            f"Enter a smaller amount:"
        )
        return BORROW_MANAGE_AMOUNT

    if action == "withdraw" and int(position["debt_usdc_raw"]) > 0:
        remaining = int(position["collateral_raw"]) - amount_raw
        hf_after = compute_health_factor(
            remaining, int(position["price_raw"]), int(position["debt_usdc_raw"])
        )
        if hf_after < MIN_WITHDRAW_HF:
            await update.message.reply_text(
                _withdraw_block_text(hf_after), parse_mode="Markdown", reply_markup=_BACK_KEYBOARD
            )
            return BORROW_MANAGE_AMOUNT

    borrow["amount_raw"] = amount_raw
    return await _show_manage_confirm(update, context, is_callback=False)


async def _show_manage_confirm(update, context, *, is_callback) -> int:
    """Confirmation screen for manage actions (shows post-action health)."""
    borrow = context.user_data["borrow"]
    position = borrow["position"]
    action = borrow["action"]
    amount_raw = borrow.get("amount_raw")

    collateral = int(position["collateral_raw"])
    debt = int(position["debt_usdc_raw"])
    price = int(position["price_raw"])

    if action == "add":
        new_collateral = collateral + int(amount_raw)
        hf_after = compute_health_factor(new_collateral, price, debt)
        text = (
            f"✅ *Confirm Add Collateral*\n\n"
            f"Amount: *{_fmt_btc(int(amount_raw))} cbBTC*\n"
            f"Health Factor: {_fmt_hf(position['health_factor'])} → "
            f"{_hf_emoji(hf_after)} *{_fmt_hf(hf_after)}*\n\n"
            f"⛽ Gas: paid in ETH on Base. An exact-amount approval is sent first.\n\nProceed?"
        )
    elif action == "repay":
        if amount_raw is None:
            text = (
                f"✅ *Confirm Full Repayment*\n\n"
                f"Repaying your entire debt of ≈ *{_fmt_usdc(debt)} USDC* "
                f"(exact to the share — clears interest dust).\n\n"
                f"⛽ Gas: paid in ETH on Base. A USDC approval is sent first.\n\nProceed?"
            )
        else:
            remaining = max(0, debt - int(amount_raw))
            hf_after = compute_health_factor(collateral, price, remaining)
            text = (
                f"✅ *Confirm Repayment*\n\n"
                f"Amount: *{_fmt_usdc(int(amount_raw))} USDC*\n"
                f"Remaining debt: ≈ *{_fmt_usdc(remaining)} USDC*\n"
                f"Health Factor: {_fmt_hf(position['health_factor'])} → "
                f"{_hf_emoji(hf_after)} *{_fmt_hf(hf_after)}*\n\n"
                f"⛽ Gas: paid in ETH on Base. A USDC approval is sent first.\n\nProceed?"
            )
    elif action == "withdraw":
        remaining = collateral - int(amount_raw)
        hf_after = compute_health_factor(remaining, price, debt)
        text = (
            f"✅ *Confirm Collateral Withdrawal*\n\n"
            f"Amount: *{_fmt_btc(int(amount_raw))} cbBTC*\n"
            f"Remaining collateral: *{_fmt_btc(remaining)} cbBTC*\n"
            f"Health Factor: {_fmt_hf(position['health_factor'])} → "
            f"{_hf_emoji(hf_after)} *{_fmt_hf(hf_after)}*\n\n"
            f"⛽ Gas: paid in ETH on Base.\n\nProceed?"
        )
    else:  # close
        text = (
            f"🏁 *Confirm Close Position*\n\n"
            f"1. Repay your entire debt of ≈ *{_fmt_usdc(debt)} USDC*\n"
            f"2. Withdraw all *{_fmt_btc(collateral)} cbBTC* collateral\n\n"
            f"⛽ Gas: paid in ETH on Base (up to 3 transactions).\n\nProceed?"
        )

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🚀 Confirm", callback_data="borrow_mexec"),
                InlineKeyboardButton("❌ Cancel", callback_data="borrow_menu"),
            ]
        ]
    )
    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=keyboard
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)
    return BORROW_MANAGE_CONFIRM


async def borrow_manage_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the manage action on-chain."""
    query = update.callback_query
    await query.answer()

    borrow = context.user_data.get("borrow")
    if not borrow or not borrow.get("action") or borrow.get("position") is None:
        await query.edit_message_text(
            "❌ Session expired. Start again with /borrow", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet = _get_wallet(user_id, borrow.get("wallet_id"))
    if not wallet:
        await query.edit_message_text("❌ Wallet not found.", reply_markup=_RETRY_KEYBOARD)
        return ConversationHandler.END

    action = borrow["action"]
    amount_raw = borrow.get("amount_raw")
    position = borrow["position"]

    await query.edit_message_text("⏳ Submitting... this can take a minute on Base.")

    try:
        if action == "add":
            tx_hashes = await asyncio.to_thread(morpho_api.add_collateral, wallet, int(amount_raw))
            morpho_api.record_position_open(user_id, wallet.id)
            text = (
                f"✅ *Collateral added!*\n\n"
                f"Supplied *{_fmt_btc(int(amount_raw))} cbBTC*.\n\n"
                f"*Transactions:*\n{_tx_links(tx_hashes)}"
            )
        elif action == "repay":
            tx_hashes = await asyncio.to_thread(morpho_api.repay, wallet, amount_raw)
            amount_text = (
                "your full debt" if amount_raw is None else f"{_fmt_usdc(int(amount_raw))} USDC"
            )
            text = f"✅ *Repayment submitted!*\n\nRepaid *{amount_text}*.\n\n*Transactions:*\n{_tx_links(tx_hashes)}"
        elif action == "withdraw":
            tx_hashes = await asyncio.to_thread(
                morpho_api.withdraw_collateral, wallet, int(amount_raw)
            )
            if (
                int(amount_raw) >= int(position["collateral_raw"])
                and int(position["debt_usdc_raw"]) <= 0
            ):
                morpho_api.record_position_closed(user_id, wallet.id)
            text = (
                f"✅ *Withdrawal submitted!*\n\n"
                f"Withdrew *{_fmt_btc(int(amount_raw))} cbBTC* to your wallet.\n\n"
                f"*Transactions:*\n{_tx_links(tx_hashes)}"
            )
        else:  # close: full repay (if debt) then withdraw everything
            tx_hashes = []
            if int(position["debt_usdc_raw"]) > 0:
                tx_hashes += await asyncio.to_thread(morpho_api.repay, wallet, None)
            collateral = int(position["collateral_raw"])
            if collateral > 0:
                tx_hashes += await asyncio.to_thread(
                    morpho_api.withdraw_collateral, wallet, collateral
                )
            morpho_api.record_position_closed(user_id, wallet.id)
            text = (
                f"🏁 *Position closed!*\n\n"
                f"Debt repaid and *{_fmt_btc(collateral)} cbBTC* returned to your wallet.\n\n"
                f"*Transactions:*\n{_tx_links(tx_hashes)}"
            )

        keyboard = [
            [InlineKeyboardButton("₿ Back to Borrow", callback_data="borrow_menu")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )
    except MorphoError as e:
        await query.edit_message_text(f"❌ {e}", reply_markup=_RETRY_KEYBOARD)
    except Exception as e:
        logger.error(f"borrow {action} unexpected error for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ Something went wrong. Check your wallet on basescan before retrying.",
            reply_markup=_RETRY_KEYBOARD,
        )
    return BORROW_MENU


async def borrow_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the borrow flow."""
    context.user_data.pop("borrow", None)
    if update.callback_query:
        await update.callback_query.answer("Cancelled")
        from bot.handlers.start import main_menu_callback

        await main_menu_callback(update, context)
    else:
        await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


_MANAGE_PATTERN = (
    "^(?:borrow_add|borrow_repay|borrow_repay_all|borrow_withdraw|"
    "borrow_wd_all|borrow_close_pos)$"
)

borrow_conversation_handler = ConversationHandler(
    name="borrow",
    persistent=True,
    entry_points=[
        CommandHandler("borrow", borrow_command),
        CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
    ],
    states={
        BORROW_MENU: [
            CallbackQueryHandler(borrow_open_callback, pattern="^borrow_open$"),
            CallbackQueryHandler(borrow_manage_callback, pattern=_MANAGE_PATTERN),
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
            CallbackQueryHandler(borrow_close_callback, pattern="^borrow_close$"),
        ],
        BORROW_SELECT_WALLET: [
            CallbackQueryHandler(borrow_select_wallet_callback, pattern=r"^borrow_w_\d+$"),
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
        ],
        BORROW_ENTER_COLLATERAL: [
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, borrow_enter_collateral),
        ],
        BORROW_SELECT_LTV: [
            CallbackQueryHandler(borrow_ltv_callback, pattern=_BORROW_LTV_PATTERN),
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
        ],
        BORROW_CONFIRM: [
            CallbackQueryHandler(borrow_execute_callback, pattern="^borrow_exec$"),
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
        ],
        BORROW_MANAGE_AMOUNT: [
            CallbackQueryHandler(borrow_manage_callback, pattern=_MANAGE_PATTERN),
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, borrow_manage_enter_amount),
        ],
        BORROW_MANAGE_CONFIRM: [
            CallbackQueryHandler(borrow_manage_execute_callback, pattern="^borrow_mexec$"),
            CallbackQueryHandler(borrow_menu_callback, pattern="^borrow_menu$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(borrow_close_callback, pattern="^borrow_close$"),
        CommandHandler("cancel", borrow_cancel),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)
