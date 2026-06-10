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
from bot.services.wallet import WalletService
from bot.utils.formatters import format_tx_link
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
) = range(4)

wallet_service = WalletService()

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
            await query.edit_message_text(f"❌ {e}", reply_markup=_RETRY_KEYBOARD)
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
            await query.edit_message_text(f"❌ {e}", reply_markup=_RETRY_KEYBOARD)
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
        f"⏳ Submitting {action}... this can take a moment.", parse_mode="Markdown"
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
        await query.edit_message_text(
            f"❌ {e}",
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


async def save_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the savings flow."""
    context.user_data.pop("savings", None)
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
    ],
    states={
        SAVE_MENU: [
            CallbackQueryHandler(save_action_callback, pattern="^save_deposit$"),
            CallbackQueryHandler(save_action_callback, pattern="^save_withdraw$"),
            CallbackQueryHandler(save_refresh_callback, pattern="^save_refresh$"),
            CallbackQueryHandler(save_close_callback, pattern="^save_close$"),
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
