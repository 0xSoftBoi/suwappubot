"""Savings flow handlers — non-custodial USDC yield via Aave V3 on Base.

Mirrors the swap conversation patterns: ConversationHandler with unique
callback patterns (^save_), persistent name, wallet selection reused from the
swap pattern, and a confirm-before-execute money-path screen.

All on-chain work happens in SavingsService (blocking web3); handlers offload
those calls with asyncio.to_thread so the event loop stays responsive.
"""

import asyncio
import logging
from decimal import Decimal

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User, Wallet
from bot.models.savings import SavingsEvent
from bot.services.savings_service import savings_service, SavingsError
from bot.services.starknet_yield import VENUES as _BTC_VENUES
from bot.services.wallet import WalletService
from bot.services.error_guidance import user_facing_error
from bot.utils.formatters import format_tx_link, escape_markdown
from bot.utils.validators import validate_amount
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    SAVE_MENU,
    SAVE_SELECT_WALLET,
    SAVE_ENTER_AMOUNT,
    SAVE_CONFIRM,
    SAVE_BTC_MENU,
    SAVE_BTC_VENUE,
    SAVE_BTC_AMOUNT,
    SAVE_BTC_CONFIRM,
    SAVE_MORPHO_MENU,
    SAVE_MORPHO_AMOUNT,
    SAVE_MORPHO_CONFIRM,
) = range(11)

wallet_service = WalletService()

# Anchored venue callback pattern built from the canonical venue keys —
# unknown keys can never enter the conversation state.
_SAVE_BTC_VENUE_PATTERN = "^save_btc_v_(?:" + "|".join(_BTC_VENUES) + ")$"

# Recovery keyboard for error screens — "save_menu" is a registered entry
# point, so this works even after the conversation has ended.
_RETRY_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("🔄 Try Again", callback_data="save_menu")],
        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
    ]
)


def _basescan_tx(tx_hash: str) -> str:
    """Markdown link to a Base tx on basescan."""
    if tx_hash and not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    return format_tx_link(tx_hash, "base")


async def _log_event(user_id, wallet_id, action, amount, tx_hash):
    """Record a savings deposit/withdraw (best-effort)."""
    try:
        with get_session() as session:
            session.add(
                SavingsEvent(
                    user_id=user_id,
                    wallet_id=wallet_id,
                    chain="base",
                    token="USDC",
                    action=action,
                    amount=(Decimal(str(amount)) if amount is not None else None),
                    tx_hash=(
                        ("0x" + tx_hash) if tx_hash and not tx_hash.startswith("0x") else tx_hash
                    ),
                )
            )
    except Exception as e:
        logger.warning(f"Failed to log savings event: {e}")


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


async def _render_menu(update, context, *, is_callback):
    """Render the main /save dashboard: APY, USDC balance, savings position."""
    user_id = context.user_data.get("user_id")
    wallets = _evm_wallets(user_id)

    if not wallets:
        keyboard = [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
        text = "👛 You need an EVM wallet (Base) to use Savings."
        if is_callback:
            await update.callback_query.edit_message_text(
                text, reply_markup=InlineKeyboardMarkup(keyboard)
            )
        else:
            await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
        return ConversationHandler.END

    # Use the default EVM wallet for the dashboard summary.
    summary_wallet = wallet_service.get_default_wallet(user_id, "evm") or wallets[0]
    context.user_data.setdefault("savings", {})

    try:
        apy, usdc_bal, position = await asyncio.gather(
            asyncio.to_thread(savings_service.get_apy),
            asyncio.to_thread(savings_service.get_usdc_balance, summary_wallet.address),
            asyncio.to_thread(savings_service.get_position, summary_wallet.address),
        )
        apy_text = f"{apy:.2f}%"
        bal_text = f"{usdc_bal:.2f} USDC"
        pos_text = f"{position:.2f} USDC"
    except SavingsError as e:
        apy_text = bal_text = pos_text = "—"
        logger.debug(f"Savings dashboard read failed: {e}")

    addr_short = f"{summary_wallet.address[:6]}...{summary_wallet.address[-4:]}"
    text = (
        f"🏦 *Savings* — earn yield on idle USDC\n"
        f"_Non-custodial · Aave V3 · Base_\n\n"
        f"📈 Current APY: *{apy_text}*\n"
        f"👛 Wallet ({addr_short}):\n"
        f"   • Idle USDC: *{bal_text}*\n"
        f"   • In Savings: *{pos_text}*\n\n"
        f"Deposit USDC to start earning. Withdraw anytime."
    )

    keyboard = [
        [
            InlineKeyboardButton("➕ Deposit", callback_data="save_deposit"),
            InlineKeyboardButton("➖ Withdraw", callback_data="save_withdraw"),
        ],
        [InlineKeyboardButton("₿ Bitcoin (Starknet)", callback_data="save_btc_menu")],
        [InlineKeyboardButton("🌾 Morpho USDC (Base)", callback_data="save_morpho_menu")],
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="save_refresh"),
            InlineKeyboardButton("❌ Close", callback_data="save_close"),
        ],
    ]

    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    return SAVE_MENU


@enforce_tos
async def save_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /save command."""
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first to set up your account.")
            return ConversationHandler.END
        context.user_data["user_id"] = db_user.id
    context.user_data.pop("savings", None)
    context.user_data.pop("savings_btc", None)
    context.user_data.pop("savings_morpho", None)
    return await _render_menu(update, context, is_callback=False)


async def save_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Refreshing...")
    # Entered via the main-menu "save_menu" button there may be no user_id in
    # context yet — resolve it from the Telegram user.
    if not context.user_data.get("user_id"):
        with get_session() as session:
            db_user = (
                session.query(User).filter(User.telegram_id == update.effective_user.id).first()
            )
            if not db_user:
                await query.edit_message_text("❌ Please use /start first to set up your account.")
                return ConversationHandler.END
            context.user_data["user_id"] = db_user.id
    return await _render_menu(update, context, is_callback=True)


async def save_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Closed")
    context.user_data.pop("savings", None)
    context.user_data.pop("savings_btc", None)
    context.user_data.pop("savings_morpho", None)
    from bot.handlers.start import main_menu_callback

    await main_menu_callback(update, context)
    return ConversationHandler.END


# ── Deposit / Withdraw entry → wallet selection ──────────────────────────────


async def save_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Begin a deposit or withdraw: choose which EVM wallet to use."""
    query = update.callback_query
    await query.answer()

    action = "deposit" if query.data == "save_deposit" else "withdraw"
    context.user_data["savings"] = {"action": action}

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

    verb = "deposit into" if action == "deposit" else "withdraw from"
    text = f"👛 *Select a wallet to {verb} Savings:*"

    keyboard = []
    for w in wallets:
        addr_short = f"{w.address[:6]}...{w.address[-4:]}"
        keyboard.append(
            [InlineKeyboardButton(f"{w.name} ({addr_short})", callback_data=f"save_w_{w.id}")]
        )
    keyboard.append([InlineKeyboardButton("« Back", callback_data="save_refresh")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return SAVE_SELECT_WALLET


async def save_select_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Wallet picked → show amount entry (with % buttons / All)."""
    query = update.callback_query
    await query.answer()

    try:
        wallet_id = int(query.data.replace("save_w_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid wallet.")
        return ConversationHandler.END

    savings = context.user_data.get("savings")
    if not savings:
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if not wallet:
            await query.edit_message_text("❌ Invalid wallet selection.")
            return ConversationHandler.END
        savings["wallet_id"] = wallet.id
        savings["wallet_address"] = wallet.address

    action = savings["action"]

    if action == "deposit":
        try:
            available = await asyncio.to_thread(
                savings_service.get_usdc_balance, savings["wallet_address"]
            )
        except SavingsError as e:
            logger.error("Savings balance fetch failed: %s", e, exc_info=True)
            await query.edit_message_text(
                user_facing_error(e, safe_exceptions=(SavingsError,)),
                reply_markup=_RETRY_KEYBOARD,
            )
            return ConversationHandler.END
        savings["available"] = float(available)
        text = (
            f"➕ *Deposit USDC*\n\n"
            f"Idle USDC available: *{available:.2f}*\n\n"
            f"Enter an amount or pick a %:"
        )
    else:
        try:
            position = await asyncio.to_thread(
                savings_service.get_position, savings["wallet_address"]
            )
        except SavingsError as e:
            logger.error("Savings position fetch failed: %s", e, exc_info=True)
            await query.edit_message_text(
                user_facing_error(e, safe_exceptions=(SavingsError,)),
                reply_markup=_RETRY_KEYBOARD,
            )
            return ConversationHandler.END
        savings["available"] = float(position)
        text = (
            f"➖ *Withdraw USDC*\n\n"
            f"In Savings: *{position:.2f} USDC*\n\n"
            f"Enter an amount, pick a %, or withdraw All:"
        )

    pct_row = [
        InlineKeyboardButton("25%", callback_data="save_pct_25"),
        InlineKeyboardButton("50%", callback_data="save_pct_50"),
        InlineKeyboardButton("100%", callback_data="save_pct_100"),
    ]
    keyboard = [pct_row]
    if action == "withdraw":
        keyboard.append([InlineKeyboardButton("💯 Withdraw All", callback_data="save_all")])
    keyboard.append([InlineKeyboardButton("« Back", callback_data=f"save_{action}")])

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return SAVE_ENTER_AMOUNT


async def save_pct_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle 25/50/100% amount buttons."""
    query = update.callback_query
    await query.answer()

    savings = context.user_data.get("savings")
    if not savings:
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    pct = int(query.data.replace("save_pct_", ""))
    available = float(savings.get("available", 0))
    if available <= 0:
        await query.edit_message_text("❌ No balance available. Start again with /save")
        return ConversationHandler.END

    amount = round(available * pct / 100, 6)
    # 100% withdraw → use the All sentinel so dust/interest is fully captured.
    if savings["action"] == "withdraw" and pct == 100:
        savings["amount"] = None
    else:
        savings["amount"] = amount
    return await _show_confirm(update, context, is_callback=True)


async def save_all_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Withdraw-all sentinel."""
    query = update.callback_query
    await query.answer()
    savings = context.user_data.get("savings")
    if not savings:
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END
    savings["amount"] = None
    return await _show_confirm(update, context, is_callback=True)


async def save_enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle typed amount input."""
    savings = context.user_data.get("savings")
    if not savings:
        await update.message.reply_text(
            "❌ Session expired. Start again with /save", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    amount = validate_amount(update.message.text)
    if amount is None or amount <= 0:
        await update.message.reply_text("❌ Invalid amount. Enter a number (e.g. 100 or 50.5):")
        return SAVE_ENTER_AMOUNT

    available = float(savings.get("available", 0))
    if amount > available + 1e-9:
        await update.message.reply_text(
            f"❌ Amount exceeds available ({available:.2f} USDC). Enter a smaller amount:"
        )
        return SAVE_ENTER_AMOUNT

    savings["amount"] = round(float(amount), 6)
    return await _show_confirm(update, context, is_callback=False)


async def _show_confirm(update, context, *, is_callback) -> int:
    """Confirmation screen: amount + APY + gas estimate note."""
    savings = context.user_data["savings"]
    action = savings["action"]
    amount = savings.get("amount")

    try:
        apy = await asyncio.to_thread(savings_service.get_apy)
        apy_text = f"{apy:.2f}%"
    except SavingsError:
        apy_text = "—"

    amount_text = "All (full balance)" if amount is None else f"{amount:.2f} USDC"

    if action == "deposit":
        text = (
            f"✅ *Confirm Deposit*\n\n"
            f"Amount: *{amount_text}*\n"
            f"Earning APY: *{apy_text}*\n"
            f"Network: Base · Aave V3\n\n"
            f"⛽ Gas: paid in ETH on Base (typically < $0.01).\n"
            f"A USDC approval tx may be sent first.\n\n"
            f"Proceed?"
        )
        confirm_cb = "save_exec"
    else:
        text = (
            f"✅ *Confirm Withdrawal*\n\n"
            f"Amount: *{amount_text}*\n"
            f"Network: Base · Aave V3\n\n"
            f"⛽ Gas: paid in ETH on Base (typically < $0.01).\n\n"
            f"Proceed?"
        )
        confirm_cb = "save_exec"

    keyboard = [
        [
            InlineKeyboardButton("🚀 Confirm", callback_data=confirm_cb),
            InlineKeyboardButton("❌ Cancel", callback_data="save_refresh"),
        ]
    ]
    markup = InlineKeyboardMarkup(keyboard)

    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=markup
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)
    return SAVE_CONFIRM


async def save_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the deposit or withdraw on-chain."""
    query = update.callback_query
    await query.answer()

    savings = context.user_data.get("savings")
    if not savings:
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet_id = savings.get("wallet_id")
    action = savings["action"]
    amount = savings.get("amount")

    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if not wallet:
            await query.edit_message_text("❌ Wallet not found.")
            return ConversationHandler.END
        # Detach for use off-session (read-only attributes used downstream).
        session.expunge(wallet)

    await query.edit_message_text(
        f"⏳ Submitting {escape_markdown(action)}... this can take a moment.",
        parse_mode="Markdown",
    )

    try:
        if action == "deposit":
            tx_hashes = await asyncio.to_thread(
                savings_service.deposit, wallet, Decimal(str(amount))
            )
            for h in tx_hashes:
                await _log_event(user_id, wallet_id, "deposit", amount, h)
            links = "\n".join(_basescan_tx(h) for h in tx_hashes)
            text = (
                f"✅ *Deposit submitted!*\n\n"
                f"Deposited *{amount:.2f} USDC* into Savings.\n\n"
                f"*Transactions:*\n{links}"
            )
        else:
            amount_dec = None if amount is None else Decimal(str(amount))
            tx_hash = await asyncio.to_thread(savings_service.withdraw, wallet, amount_dec)
            await _log_event(user_id, wallet_id, "withdraw", amount, tx_hash)
            amount_text = "all funds" if amount is None else f"{amount:.2f} USDC"
            text = (
                f"✅ *Withdrawal submitted!*\n\n"
                f"Withdrew *{amount_text}* from Savings.\n\n"
                f"*Transaction:*\n{_basescan_tx(tx_hash)}"
            )

        keyboard = [
            [InlineKeyboardButton("🏦 Back to Savings", callback_data="save_refresh")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )
    except SavingsError as e:
        logger.error(f"Savings {action} failed for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(SavingsError,)),
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("« Back to Savings", callback_data="save_refresh")]]
            ),
        )
    except Exception as e:
        logger.error(f"Savings {action} unexpected error for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ Something went wrong. Your funds were not moved. Please try again.",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("« Back to Savings", callback_data="save_refresh")]]
            ),
        )

    return SAVE_MENU


# ── Bitcoin (Starknet) yield: Endur xWBTC + Vesu Re7 xBTC pool ────────────────


_BTC_RETRY_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("🔄 Try Again", callback_data="save_btc_menu")],
        [InlineKeyboardButton("« Savings", callback_data="save_refresh")],
    ]
)


def _starknet_wallets(user_id: int) -> list:
    with get_session() as session:
        return (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == "starknet",
                Wallet.is_active == True,  # noqa: E712
            )
            .all()
        )


def _parse_btc_amount(text: str):
    """Parse a BTC amount (max 8 decimals) → raw sats int, or None if invalid."""
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
    sats = amount * Decimal(10**8)
    if sats != sats.to_integral_value():
        return None  # more than 8 decimal places
    return int(sats)


def _fmt_btc(raw: int) -> str:
    return f"{raw / 1e8:.8f}".rstrip("0").rstrip(".") or "0"


def _voyager_tx(tx_hash: str) -> str:
    if tx_hash and not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    return format_tx_link(tx_hash, "starknet")


async def save_btc_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Bitcoin venue list: wallet BTC balances + per-venue positions."""
    from bot.services.starknet_yield import VENUES, StarknetYieldError, starknet_yield_service

    query = update.callback_query
    await query.answer()

    if not context.user_data.get("user_id"):
        with get_session() as session:
            db_user = (
                session.query(User).filter(User.telegram_id == update.effective_user.id).first()
            )
            if not db_user:
                await query.edit_message_text("❌ Please use /start first to set up your account.")
                return ConversationHandler.END
            context.user_data["user_id"] = db_user.id

    user_id = context.user_data["user_id"]
    wallets = _starknet_wallets(user_id)
    if not wallets:
        await query.edit_message_text(
            "👛 You need a Starknet wallet to use Bitcoin savings.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")],
                    [InlineKeyboardButton("« Savings", callback_data="save_refresh")],
                ]
            ),
        )
        return SAVE_BTC_MENU

    wallet = wallet_service.get_default_wallet(user_id, "starknet") or wallets[0]
    btc = context.user_data.setdefault("savings_btc", {})
    btc["wallet_id"] = wallet.id
    btc["wallet_address"] = wallet.address

    try:
        wbtc_bal, strkbtc_bal = await asyncio.gather(
            wallet_service.get_starknet_token_balance("WBTC", wallet.address),
            wallet_service.get_starknet_token_balance("STRKBTC", wallet.address),
        )
        bal_lines = f"   • WBTC: *{wbtc_bal:.8f}*\n   • strkBTC: *{strkbtc_bal:.8f}*"
    except Exception:
        bal_lines = "   • Balances unavailable — try Refresh."

    positions = await asyncio.gather(
        *(starknet_yield_service.get_position(wallet.address, key) for key in VENUES),
        return_exceptions=True,
    )
    pos_lines = []
    for venue, position in zip(VENUES.values(), positions):
        if isinstance(position, BaseException):
            pos_lines.append(f"   • {venue.name}: —")
        else:
            pos_lines.append(f"   • {venue.name}: *{position['assets_btc']:.8f} BTC*")

    addr_short = f"{wallet.address[:6]}...{wallet.address[-4:]}"
    text = (
        f"₿ *Bitcoin Savings* — Starknet\n"
        f"_Non-custodial · variable APY · gas-free via paymaster_\n\n"
        f"👛 Wallet ({addr_short}):\n{bal_lines}\n\n"
        f"📈 Positions:\n" + "\n".join(pos_lines) + "\n\n"
        f"Pick a venue:\n"
        f"• *Endur xWBTC* — STRK staking rewards (variable)\n"
        f"• *Vesu* — BTC-denominated lending yield (variable)"
    )
    keyboard = [
        [InlineKeyboardButton(venue.name, callback_data=f"save_btc_v_{key}")]
        for key, venue in VENUES.items()
    ]
    keyboard.append(
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="save_btc_menu"),
            InlineKeyboardButton("« Savings", callback_data="save_refresh"),
        ]
    )
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return SAVE_BTC_MENU


async def save_btc_venue_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Venue screen: position + variable-APY framing + deposit/withdraw actions."""
    from bot.services.starknet_yield import StarknetYieldError, get_venue, starknet_yield_service

    query = update.callback_query
    await query.answer()

    btc = context.user_data.get("savings_btc")
    if not btc or not btc.get("wallet_address"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_BTC_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    venue_key = query.data.replace("save_btc_v_", "")
    try:
        venue = get_venue(venue_key)
    except StarknetYieldError:
        await query.edit_message_text("❌ Unknown venue.", reply_markup=_BTC_RETRY_KEYBOARD)
        return SAVE_BTC_MENU
    btc["venue"] = venue_key

    apy = await starknet_yield_service.get_apy(venue_key)
    apy_text = f"{apy:.2f}%" if apy is not None else f"variable ({venue.yield_note})"

    try:
        position = await starknet_yield_service.get_position(btc["wallet_address"], venue_key)
        btc["position_shares"] = position["shares_raw"]
        btc["position_assets"] = position["assets_raw"]
        pos_text = f"{position['assets_btc']:.8f} BTC"
    except StarknetYieldError as e:
        logger.error("BTC savings position fetch failed: %s", e, exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(StarknetYieldError,)),
            reply_markup=_BTC_RETRY_KEYBOARD,
        )
        return SAVE_BTC_MENU

    unbond_note = (
        "\n⚠️ Endur exits can be subject to staking unbonding (up to 21 days worst case).\n"
        if venue.family == "endur"
        else ""
    )
    text = (
        f"₿ *{venue.name}*\n\n"
        f"Deposit token: *{venue.underlying_symbol}*\n"
        f"Yield: *{apy_text}*\n"
        f"Your position: *{pos_text}*\n"
        f"{unbond_note}\n"
        f"Gas is sponsored via the AVNU paymaster when possible."
    )
    keyboard = [
        [
            InlineKeyboardButton("➕ Deposit", callback_data="save_btc_dep"),
            InlineKeyboardButton("➖ Withdraw", callback_data="save_btc_wd"),
        ],
        [InlineKeyboardButton("💯 Withdraw All", callback_data="save_btc_wd_all")],
        [InlineKeyboardButton("« Venues", callback_data="save_btc_menu")],
    ]
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return SAVE_BTC_VENUE


async def save_btc_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Deposit/withdraw chosen → prompt for a BTC amount (8 decimals max)."""
    from bot.services.starknet_yield import get_venue

    query = update.callback_query
    await query.answer()

    btc = context.user_data.get("savings_btc")
    if not btc or not btc.get("venue"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_BTC_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    venue = get_venue(btc["venue"])

    if query.data == "save_btc_wd_all":
        btc["action"] = "withdraw"
        btc["amount_raw"] = None  # max sentinel
        return await _save_btc_show_confirm(update, context)

    btc["action"] = "deposit" if query.data == "save_btc_dep" else "withdraw"
    if btc["action"] == "deposit":
        try:
            available_raw = await wallet_service.get_starknet_token_balance_raw(
                venue.underlying_symbol, btc["wallet_address"]
            )
        except Exception:
            # Never present a false 0 balance on an RPC failure — stop here.
            await query.edit_message_text(
                "⚠️ Balance unavailable (RPC error) — try again",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("« Back", callback_data=f"save_btc_v_{btc['venue']}")]]
                ),
            )
            return SAVE_BTC_VENUE
        btc["available_raw"] = available_raw
        text = (
            f"➕ *Deposit {venue.underlying_symbol}* → {venue.name}\n\n"
            f"Available: *{available_raw / 10**venue.decimals:.8f} {venue.underlying_symbol}*\n\n"
            f"Enter an amount in BTC (up to 8 decimals, e.g. 0.0005):"
        )
    else:
        btc["available_raw"] = int(btc.get("position_assets") or 0)
        text = (
            f"➖ *Withdraw from {venue.name}*\n\n"
            f"Position: *{btc['available_raw'] / 1e8:.8f} BTC*\n\n"
            f"Enter an amount in BTC (up to 8 decimals), or use Withdraw All:"
        )

    keyboard = [[InlineKeyboardButton("« Back", callback_data=f"save_btc_v_{btc['venue']}")]]
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return SAVE_BTC_AMOUNT


async def save_btc_enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Typed BTC amount (sats-precision validation)."""
    btc = context.user_data.get("savings_btc")
    if not btc or not btc.get("venue") or not btc.get("action"):
        await update.message.reply_text(
            "❌ Session expired. Start again with /save", reply_markup=_BTC_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    amount_raw = _parse_btc_amount(update.message.text)
    if amount_raw is None:
        await update.message.reply_text(
            "❌ Invalid amount. Enter a BTC amount with at most 8 decimals (e.g. 0.0005):"
        )
        return SAVE_BTC_AMOUNT

    available_raw = int(btc.get("available_raw") or 0)
    if amount_raw > available_raw:
        await update.message.reply_text(
            f"❌ Amount exceeds available ({_fmt_btc(available_raw)} BTC). Enter a smaller amount:"
        )
        return SAVE_BTC_AMOUNT

    btc["amount_raw"] = amount_raw
    return await _save_btc_show_confirm(update, context)


async def _save_btc_show_confirm(update, context) -> int:
    """Confirmation screen with variable-APY framing."""
    from bot.services.starknet_yield import get_venue

    btc = context.user_data["savings_btc"]
    venue = get_venue(btc["venue"])
    action = btc["action"]
    amount_raw = btc.get("amount_raw")
    amount_text = "All (full position)" if amount_raw is None else f"{_fmt_btc(amount_raw)} BTC"

    if action == "deposit":
        text = (
            f"✅ *Confirm Deposit*\n\n"
            f"Venue: *{venue.name}*\n"
            f"Amount: *{amount_text}* ({venue.underlying_symbol})\n"
            f"Yield: *variable* — {venue.yield_note}\n\n"
            f"An exact-amount approval and the deposit are sent as one "
            f"transaction. Gas is sponsored when possible.\n\nProceed?"
        )
    else:
        unbond = (
            "\n⚠️ Endur exits can be subject to staking unbonding (up to 21 days worst case)."
            if venue.family == "endur"
            else ""
        )
        text = (
            f"✅ *Confirm Withdrawal*\n\n"
            f"Venue: *{venue.name}*\n"
            f"Amount: *{amount_text}*\n"
            f"{venue.underlying_symbol} is returned to your wallet.{unbond}\n\nProceed?"
        )

    keyboard = [
        [
            InlineKeyboardButton("🚀 Confirm", callback_data="save_btc_exec"),
            InlineKeyboardButton("❌ Cancel", callback_data=f"save_btc_v_{btc['venue']}"),
        ]
    ]
    markup = InlineKeyboardMarkup(keyboard)
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=markup
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)
    return SAVE_BTC_CONFIRM


async def save_btc_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the BTC deposit/withdraw on Starknet."""
    from bot.services.starknet_yield import StarknetYieldError, get_venue, starknet_yield_service

    query = update.callback_query
    await query.answer()

    btc = context.user_data.get("savings_btc")
    if not btc or not btc.get("venue") or not btc.get("action"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_BTC_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet_id = btc.get("wallet_id")
    venue = get_venue(btc["venue"])
    action = btc["action"]
    amount_raw = btc.get("amount_raw")

    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if not wallet:
            await query.edit_message_text("❌ Wallet not found.")
            return ConversationHandler.END
        session.expunge(wallet)

    await query.edit_message_text(f"⏳ Submitting {action}... this can take a moment.")

    venue_back = InlineKeyboardMarkup(
        [[InlineKeyboardButton("« Back", callback_data=f"save_btc_v_{btc['venue']}")]]
    )
    try:
        if action == "deposit":
            tx_hash = await starknet_yield_service.deposit(wallet, venue.key, int(amount_raw))
            amount_btc = amount_raw / 1e8
            await _log_btc_event(user_id, wallet_id, venue, "deposit", amount_btc, tx_hash)
            text = (
                f"✅ *Deposit submitted!*\n\n"
                f"Deposited *{_fmt_btc(amount_raw)} {venue.underlying_symbol}* "
                f"into {venue.name}.\n\n*Transaction:*\n{_voyager_tx(tx_hash)}"
            )
        else:
            if amount_raw is None:
                # Full position: the service resolves the live share balance.
                tx_hash = await starknet_yield_service.withdraw(wallet, venue.key, "max")
                amount_btc = None
            else:
                # BTC amount → shares computed inside the service from a LIVE
                # position fetch (never a rate cached on an earlier screen).
                tx_hash = await starknet_yield_service.withdraw_assets(
                    wallet, venue.key, int(amount_raw)
                )
                amount_btc = amount_raw / 1e8
            await _log_btc_event(user_id, wallet_id, venue, "withdraw", amount_btc, tx_hash)
            amount_text = (
                "your full position" if amount_raw is None else f"{_fmt_btc(amount_raw)} BTC"
            )
            text = (
                f"✅ *Withdrawal submitted!*\n\n"
                f"Withdrew *{amount_text}* from {venue.name}.\n\n"
                f"*Transaction:*\n{_voyager_tx(tx_hash)}"
            )

        keyboard = [
            [InlineKeyboardButton("₿ Back to Bitcoin Savings", callback_data="save_btc_menu")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )
    except StarknetYieldError as e:
        logger.error(f"BTC savings {action} failed for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(StarknetYieldError,)),
            reply_markup=venue_back,
        )
    except Exception as e:
        logger.error(
            f"BTC savings {action} unexpected error for user {user_id}: {e}", exc_info=True
        )
        await query.edit_message_text(
            "❌ Something went wrong. Please check your balance before retrying.",
            reply_markup=venue_back,
        )
    return SAVE_BTC_VENUE


async def _log_btc_event(user_id, wallet_id, venue, action, amount_btc, tx_hash):
    """Record a BTC yield deposit/withdraw the same way Aave savings does.

    The SavingsEvent tx_hash is what downstream tooling (digest, tx_poller's
    starknet status branch) keys off — mirror the Aave recording exactly,
    with chain='starknet' and the venue's underlying token symbol.
    """
    try:
        with get_session() as session:
            session.add(
                SavingsEvent(
                    user_id=user_id,
                    wallet_id=wallet_id,
                    chain="starknet",
                    token=venue.underlying_symbol,
                    action=action,
                    amount=(Decimal(str(amount_btc)) if amount_btc is not None else None),
                    tx_hash=(
                        ("0x" + tx_hash) if tx_hash and not tx_hash.startswith("0x") else tx_hash
                    ),
                )
            )
    except Exception as e:
        logger.warning(f"Failed to log BTC savings event: {e}")


# ── Morpho USDC (Base) earn venue: MetaMorpho ERC-4626 vault ─────────────────


_MORPHO_RETRY_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("🔄 Try Again", callback_data="save_morpho_menu")],
        [InlineKeyboardButton("« Savings", callback_data="save_refresh")],
    ]
)


async def save_morpho_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Morpho USDC vault screen: live netApy, idle USDC, vault position."""
    from bot.services.morpho_api import MorphoError, morpho_api

    query = update.callback_query
    await query.answer()

    if not context.user_data.get("user_id"):
        with get_session() as session:
            db_user = (
                session.query(User).filter(User.telegram_id == update.effective_user.id).first()
            )
            if not db_user:
                await query.edit_message_text("❌ Please use /start first to set up your account.")
                return ConversationHandler.END
            context.user_data["user_id"] = db_user.id

    user_id = context.user_data["user_id"]
    wallets = _evm_wallets(user_id)
    if not wallets:
        await query.edit_message_text(
            "👛 You need an EVM wallet (Base) to use Morpho savings.",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")],
                    [InlineKeyboardButton("« Savings", callback_data="save_refresh")],
                ]
            ),
        )
        return SAVE_MORPHO_MENU

    wallet = wallet_service.get_default_wallet(user_id, "evm") or wallets[0]
    morpho = context.user_data.setdefault("savings_morpho", {})
    morpho["wallet_id"] = wallet.id
    morpho["wallet_address"] = wallet.address
    vault = morpho_api._default_vault()
    morpho["vault"] = vault

    try:
        info, idle = await asyncio.gather(
            asyncio.to_thread(morpho_api.get_vault_info, vault, wallet.address),
            asyncio.to_thread(savings_service.get_usdc_balance, wallet.address),
        )
    except (MorphoError, SavingsError) as e:
        logger.error("Morpho vault info fetch failed: %s", e, exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(MorphoError, SavingsError)),
            reply_markup=_MORPHO_RETRY_KEYBOARD,
        )
        return SAVE_MORPHO_MENU
    morpho["info"] = info

    apy_text = "variable"
    try:
        vault_apys = await morpho_api.get_vault_apys()
        for v in vault_apys:
            if v["address"].lower() == vault.lower():
                apy_text = f"{v['net_apy']:.2%}"
                break
    except Exception as e:
        logger.debug(f"morpho vault APY fetch failed: {e}")

    addr_short = f"{wallet.address[:6]}...{wallet.address[-4:]}"
    text = (
        f"🌾 *Morpho USDC* — Base\n"
        f"_Non-custodial · MetaMorpho vault (ERC-4626)_\n\n"
        f"📈 Net APY: *{apy_text}*\n"
        f"💰 Vault TVL: *${info['tvl_usdc']:,.0f}*\n\n"
        f"👛 Wallet ({addr_short}):\n"
        f"   • Idle USDC: *{idle:.2f}*\n"
        f"   • In vault: *{info['balance_usdc']:.2f} USDC*\n\n"
        f"Deposit USDC to start earning. Withdraw anytime."
    )
    morpho["idle_usdc"] = float(idle)
    keyboard = [
        [
            InlineKeyboardButton("➕ Deposit", callback_data="save_morpho_dep"),
            InlineKeyboardButton("➖ Withdraw", callback_data="save_morpho_wd"),
        ],
        [InlineKeyboardButton("💯 Withdraw All", callback_data="save_morpho_wd_all")],
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="save_morpho_menu"),
            InlineKeyboardButton("« Savings", callback_data="save_refresh"),
        ],
    ]
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return SAVE_MORPHO_MENU


async def save_morpho_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Deposit/withdraw chosen → prompt for a USDC amount (or All sentinel)."""
    query = update.callback_query
    await query.answer()

    morpho = context.user_data.get("savings_morpho")
    if not morpho or not morpho.get("info"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_MORPHO_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    if query.data == "save_morpho_wd_all":
        morpho["action"] = "withdraw"
        morpho["amount"] = None  # full-redeem sentinel
        return await _save_morpho_show_confirm(update, context)

    morpho["action"] = "deposit" if query.data == "save_morpho_dep" else "withdraw"
    if morpho["action"] == "deposit":
        available = float(morpho.get("idle_usdc") or 0)
        text = (
            f"➕ *Deposit USDC* → Morpho vault\n\n"
            f"Idle USDC available: *{available:.2f}*\n\n"
            f"Enter an amount:"
        )
    else:
        available = float(morpho["info"]["balance_usdc"])
        text = (
            f"➖ *Withdraw USDC* from Morpho vault\n\n"
            f"In vault: *{available:.2f} USDC*\n\n"
            f"Enter an amount, or use Withdraw All:"
        )
    morpho["available"] = available

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data="save_morpho_menu")]]
        ),
    )
    return SAVE_MORPHO_AMOUNT


async def save_morpho_enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Typed USDC amount for the Morpho vault."""
    morpho = context.user_data.get("savings_morpho")
    if not morpho or not morpho.get("action"):
        await update.message.reply_text(
            "❌ Session expired. Start again with /save", reply_markup=_MORPHO_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    amount = validate_amount(update.message.text)
    if amount is None or amount <= 0:
        await update.message.reply_text("❌ Invalid amount. Enter a number (e.g. 100 or 50.5):")
        return SAVE_MORPHO_AMOUNT

    available = float(morpho.get("available") or 0)
    if amount > available + 1e-9:
        await update.message.reply_text(
            f"❌ Amount exceeds available ({available:.2f} USDC). Enter a smaller amount:"
        )
        return SAVE_MORPHO_AMOUNT

    morpho["amount"] = round(float(amount), 6)
    return await _save_morpho_show_confirm(update, context)


async def _save_morpho_show_confirm(update, context) -> int:
    """Confirmation screen for Morpho vault deposit/withdraw."""
    morpho = context.user_data["savings_morpho"]
    action = morpho["action"]
    amount = morpho.get("amount")
    amount_text = "All (full balance)" if amount is None else f"{amount:.2f} USDC"

    if action == "deposit":
        text = (
            f"✅ *Confirm Deposit*\n\n"
            f"Venue: *Morpho USDC vault*\n"
            f"Amount: *{amount_text}*\n"
            f"Network: Base · MetaMorpho (ERC-4626)\n\n"
            f"⛽ Gas: paid in ETH on Base. An exact-amount USDC approval "
            f"is sent first.\n\nProceed?"
        )
    else:
        text = (
            f"✅ *Confirm Withdrawal*\n\n"
            f"Venue: *Morpho USDC vault*\n"
            f"Amount: *{amount_text}*\n"
            f"USDC is returned to your wallet.\n\n"
            f"⛽ Gas: paid in ETH on Base.\n\nProceed?"
        )

    markup = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🚀 Confirm", callback_data="save_morpho_exec"),
                InlineKeyboardButton("❌ Cancel", callback_data="save_morpho_menu"),
            ]
        ]
    )
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=markup
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)
    return SAVE_MORPHO_CONFIRM


async def save_morpho_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the Morpho vault deposit/redeem on Base."""
    from bot.services.morpho_api import MorphoError, morpho_api

    query = update.callback_query
    await query.answer()

    morpho = context.user_data.get("savings_morpho")
    if not morpho or not morpho.get("action") or not morpho.get("info"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /save", reply_markup=_MORPHO_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet_id = morpho.get("wallet_id")
    action = morpho["action"]
    amount = morpho.get("amount")
    vault = morpho["vault"]
    info = morpho["info"]

    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if not wallet:
            await query.edit_message_text("❌ Wallet not found.")
            return ConversationHandler.END
        session.expunge(wallet)

    await query.edit_message_text(f"⏳ Submitting {action}... this can take a moment.")

    try:
        if action == "deposit":
            assets_raw = int(round(float(amount) * 1e6))
            tx_hashes = await asyncio.to_thread(morpho_api.vault_deposit, wallet, assets_raw, vault)
            await _log_event(user_id, wallet_id, "morpho_deposit", amount, tx_hashes[-1])
            links = "\n".join(_basescan_tx(h) for h in tx_hashes)
            text = (
                f"✅ *Deposit submitted!*\n\n"
                f"Deposited *{amount:.2f} USDC* into the Morpho vault.\n\n"
                f"*Transactions:*\n{links}"
            )
        else:
            shares_raw = None  # full redeem
            if amount is not None:
                balance_raw = int(info.get("balance_usdc_raw") or 0)
                total_shares = int(info.get("shares_raw") or 0)
                assets_raw = int(round(float(amount) * 1e6))
                if balance_raw <= 0 or total_shares <= 0:
                    raise MorphoError("Nothing to withdraw from this vault.")
                # ≥99.5% of the balance → full redeem (no dust left behind).
                if assets_raw < balance_raw * 995 // 1000:
                    shares_raw = min(total_shares, assets_raw * total_shares // balance_raw)
            tx_hashes = await asyncio.to_thread(morpho_api.vault_redeem, wallet, shares_raw, vault)
            await _log_event(user_id, wallet_id, "morpho_withdraw", amount, tx_hashes[-1])
            amount_text = "all funds" if amount is None else f"{amount:.2f} USDC"
            text = (
                f"✅ *Withdrawal submitted!*\n\n"
                f"Withdrew *{amount_text}* from the Morpho vault.\n\n"
                f"*Transaction:*\n{_basescan_tx(tx_hashes[-1])}"
            )

        keyboard = [
            [InlineKeyboardButton("🌾 Back to Morpho", callback_data="save_morpho_menu")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )
    except MorphoError as e:
        logger.error(f"Morpho savings {action} failed for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(MorphoError,)),
            reply_markup=_MORPHO_RETRY_KEYBOARD,
        )
    except Exception as e:
        logger.error(
            f"Morpho savings {action} unexpected error for user {user_id}: {e}", exc_info=True
        )
        await query.edit_message_text(
            "❌ Something went wrong. Please check your balance before retrying.",
            reply_markup=_MORPHO_RETRY_KEYBOARD,
        )
    return SAVE_MORPHO_MENU


async def save_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the savings flow."""
    context.user_data.pop("savings", None)
    context.user_data.pop("savings_btc", None)
    context.user_data.pop("savings_morpho", None)
    if update.callback_query:
        await update.callback_query.answer("Cancelled")
        from bot.handlers.start import main_menu_callback

        await main_menu_callback(update, context)
    else:
        await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


savings_conversation_handler = ConversationHandler(
    name="savings",
    persistent=True,
    entry_points=[
        CommandHandler("save", save_command),
        CallbackQueryHandler(save_refresh_callback, pattern="^save_menu$"),
        CallbackQueryHandler(save_btc_menu_callback, pattern="^save_btc_menu$"),
        CallbackQueryHandler(save_morpho_menu_callback, pattern="^save_morpho_menu$"),
    ],
    states={
        SAVE_MENU: [
            CallbackQueryHandler(save_action_callback, pattern="^save_deposit$"),
            CallbackQueryHandler(save_action_callback, pattern="^save_withdraw$"),
            CallbackQueryHandler(save_btc_menu_callback, pattern="^save_btc_menu$"),
            CallbackQueryHandler(save_morpho_menu_callback, pattern="^save_morpho_menu$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
            CallbackQueryHandler(save_close_callback, pattern="^save_close$"),
        ],
        SAVE_BTC_MENU: [
            CallbackQueryHandler(save_btc_venue_callback, pattern=_SAVE_BTC_VENUE_PATTERN),
            CallbackQueryHandler(save_btc_menu_callback, pattern="^save_btc_menu$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
        ],
        SAVE_BTC_VENUE: [
            CallbackQueryHandler(save_btc_action_callback, pattern="^save_btc_dep$"),
            CallbackQueryHandler(save_btc_action_callback, pattern="^save_btc_wd$"),
            CallbackQueryHandler(save_btc_action_callback, pattern="^save_btc_wd_all$"),
            CallbackQueryHandler(save_btc_venue_callback, pattern=_SAVE_BTC_VENUE_PATTERN),
            CallbackQueryHandler(save_btc_menu_callback, pattern="^save_btc_menu$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
        ],
        SAVE_BTC_AMOUNT: [
            CallbackQueryHandler(save_btc_venue_callback, pattern=_SAVE_BTC_VENUE_PATTERN),
            CallbackQueryHandler(save_btc_menu_callback, pattern="^save_btc_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, save_btc_enter_amount),
        ],
        SAVE_BTC_CONFIRM: [
            CallbackQueryHandler(save_btc_execute_callback, pattern="^save_btc_exec$"),
            CallbackQueryHandler(save_btc_venue_callback, pattern=_SAVE_BTC_VENUE_PATTERN),
            CallbackQueryHandler(save_btc_menu_callback, pattern="^save_btc_menu$"),
        ],
        SAVE_MORPHO_MENU: [
            CallbackQueryHandler(save_morpho_action_callback, pattern="^save_morpho_dep$"),
            CallbackQueryHandler(save_morpho_action_callback, pattern="^save_morpho_wd$"),
            CallbackQueryHandler(save_morpho_action_callback, pattern="^save_morpho_wd_all$"),
            CallbackQueryHandler(save_morpho_menu_callback, pattern="^save_morpho_menu$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
        ],
        SAVE_MORPHO_AMOUNT: [
            CallbackQueryHandler(save_morpho_menu_callback, pattern="^save_morpho_menu$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, save_morpho_enter_amount),
        ],
        SAVE_MORPHO_CONFIRM: [
            CallbackQueryHandler(save_morpho_execute_callback, pattern="^save_morpho_exec$"),
            CallbackQueryHandler(save_morpho_menu_callback, pattern="^save_morpho_menu$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
        ],
        SAVE_SELECT_WALLET: [
            CallbackQueryHandler(save_select_wallet_callback, pattern="^save_w_"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
        ],
        SAVE_ENTER_AMOUNT: [
            CallbackQueryHandler(save_pct_callback, pattern="^save_pct_"),
            CallbackQueryHandler(save_all_callback, pattern="^save_all$"),
            CallbackQueryHandler(save_action_callback, pattern="^save_deposit$"),
            CallbackQueryHandler(save_action_callback, pattern="^save_withdraw$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, save_enter_amount),
        ],
        SAVE_CONFIRM: [
            CallbackQueryHandler(save_execute_callback, pattern="^save_exec$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(save_close_callback, pattern="^save_close$"),
        CommandHandler("cancel", save_cancel),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)
