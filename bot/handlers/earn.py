"""Earn flow handlers — generic cross-protocol ERC-4626 yield via /earn.

Mirrors the savings/Morpho conversation patterns in bot/handlers/savings.py:
ConversationHandler with unique callback patterns (^earn_), persistent name,
default-EVM-wallet reuse, and a confirm-before-execute money-path screen.

All on-chain work happens in VaultService (blocking web3); handlers offload
those calls with asyncio.to_thread so the event loop stays responsive.
"""

import asyncio
import logging
from decimal import Decimal

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.config.vaults import VAULTS, get_vault, list_vaults
from bot.models.savings import SavingsEvent
from bot.models.user import User, Wallet
from bot.services.error_guidance import user_facing_error
from bot.services.vault_service import VaultError, vault_service
from bot.services.wallet import WalletService
from bot.utils.formatters import escape_markdown, format_tx_link
from bot.utils.tos_utils import enforce_tos
from bot.utils.validators import validate_amount
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    EARN_MENU,
    EARN_VAULT,
    EARN_AMOUNT,
    EARN_CONFIRM,
) = range(4)

wallet_service = WalletService()

# Anchored vault-key callback pattern built from the canonical registry keys —
# unknown keys can never enter the conversation state.
_EARN_VAULT_PATTERN = "^earn_v_(?:" + "|".join(VAULTS.keys()) + ")$"

_RETRY_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("🔄 Try Again", callback_data="earn_menu")],
        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
    ]
)


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


async def _log_event(user_id, wallet_id, vault_key, action, amount, tx_hash):
    """Record an earn deposit/withdraw (best-effort), same table savings uses."""
    try:
        cfg = get_vault(vault_key)
        with get_session() as session:
            session.add(
                SavingsEvent(
                    user_id=user_id,
                    wallet_id=wallet_id,
                    chain=cfg.chain if cfg else "unknown",
                    token=cfg.asset_symbol if cfg else "?",
                    action=f"earn_{vault_key}_{action}",
                    amount=(Decimal(str(amount)) if amount is not None else None),
                    tx_hash=(
                        ("0x" + tx_hash) if tx_hash and not tx_hash.startswith("0x") else tx_hash
                    ),
                )
            )
    except Exception as e:
        logger.warning(f"Failed to log earn event: {e}")


def _tx_link(tx_hash: str, chain: str) -> str:
    if tx_hash and not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    return format_tx_link(tx_hash, chain)


async def _resolve_user_id(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Resolve context.user_data['user_id'], including entry via a bare
    callback (e.g. from the main menu) where the conversation hasn't set it."""
    if context.user_data.get("user_id"):
        return context.user_data["user_id"]
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == update.effective_user.id).first()
        if not db_user:
            return None
        context.user_data["user_id"] = db_user.id
        return db_user.id


# ── Menu: list all vaults grouped by chain ────────────────────────────────────


async def _render_menu(update, context, *, is_callback):
    """Render the /earn dashboard: all vaults grouped by chain, with live APY
    (or "—") and the user's position in each, if any."""
    user_id = await _resolve_user_id(update, context)
    if user_id is None:
        text = "❌ Please use /start first to set up your account."
        if is_callback:
            await update.callback_query.edit_message_text(text)
        else:
            await update.message.reply_text(text)
        return ConversationHandler.END

    wallets = _evm_wallets(user_id)
    if not wallets:
        keyboard = [[InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]]
        text = "👛 You need an EVM wallet to use Earn."
        if is_callback:
            await update.callback_query.edit_message_text(
                text, reply_markup=InlineKeyboardMarkup(keyboard)
            )
        else:
            await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
        return ConversationHandler.END

    wallet = wallet_service.get_default_wallet(user_id, "evm") or wallets[0]
    context.user_data["earn"] = {"wallet_id": wallet.id, "wallet_address": wallet.address}

    lines = [
        "🌾 *Earn* — cross-protocol ERC-4626 yield\n_Non-custodial · deposit/withdraw anytime_\n"
    ]
    keyboard = []
    by_chain: dict = {}
    for cfg in list_vaults():
        by_chain.setdefault(cfg.chain, []).append(cfg)

    for chain in sorted(by_chain):
        lines.append(f"\n*{chain.capitalize()}*")
        for cfg in by_chain[chain]:
            apy_text = "—"
            pos_text = ""
            try:
                stats = await asyncio.to_thread(vault_service.get_vault_stats, cfg.key)
                apy_text = f"{stats['apy']:.2%}" if stats.get("apy") is not None else "—"
            except VaultError:
                pass
            try:
                pos = await asyncio.to_thread(vault_service.get_position, cfg.key, wallet.address)
                if pos["shares_raw"] > 0:
                    pos_text = f" · your position: {pos['assets']:.4f} {pos['asset_symbol']}"
            except VaultError:
                pass
            lines.append(
                f"   • *{cfg.display_name}* ({cfg.protocol}, {cfg.asset_symbol}) "
                f"— APY: {apy_text}{pos_text}"
            )
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"{cfg.display_name} ({chain})", callback_data=f"earn_v_{cfg.key}"
                    )
                ]
            )

    keyboard.append(
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="earn_menu"),
            InlineKeyboardButton("❌ Close", callback_data="earn_close"),
        ]
    )
    text = "\n".join(lines)

    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        await update.message.reply_text(
            text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
    return EARN_MENU


@enforce_tos
async def earn_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /earn command."""
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first to set up your account.")
            return ConversationHandler.END
        context.user_data["user_id"] = db_user.id
    context.user_data.pop("earn", None)
    return await _render_menu(update, context, is_callback=False)


async def earn_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Refreshing...")
    return await _render_menu(update, context, is_callback=True)


async def earn_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer("Closed")
    context.user_data.pop("earn", None)
    from bot.handlers.start import main_menu_callback

    await main_menu_callback(update, context)
    return ConversationHandler.END


# ── Vault detail screen ───────────────────────────────────────────────────────


async def earn_vault_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Vault picked → show its stats + user's position + deposit/withdraw."""
    query = update.callback_query
    await query.answer()

    vault_key = query.data.replace("earn_v_", "")
    cfg = get_vault(vault_key)
    if cfg is None:
        await query.edit_message_text("❌ Unknown vault.", reply_markup=_RETRY_KEYBOARD)
        return EARN_MENU

    earn = context.user_data.get("earn")
    if not earn or not earn.get("wallet_address"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /earn", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END
    earn["vault_key"] = vault_key

    try:
        stats, position, idle = await asyncio.gather(
            asyncio.to_thread(vault_service.get_vault_stats, vault_key),
            asyncio.to_thread(vault_service.get_position, vault_key, earn["wallet_address"]),
            asyncio.to_thread(vault_service.get_asset_balance, vault_key, earn["wallet_address"]),
        )
    except VaultError as e:
        logger.error("earn vault detail fetch failed: %s", e, exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(VaultError,)), reply_markup=_RETRY_KEYBOARD
        )
        return EARN_MENU
    earn["position"] = position
    earn["idle"] = idle["balance"]

    apy_text = f"{stats['apy']:.2%}" if stats.get("apy") is not None else "—"
    addr_short = f"{earn['wallet_address'][:6]}...{earn['wallet_address'][-4:]}"
    text = (
        f"🌾 *{cfg.display_name}* — {cfg.protocol}\n"
        f"_Non-custodial · {cfg.chain.capitalize()} · ERC-4626_\n\n"
        f"📈 APY: *{apy_text}*\n"
        f"💰 Vault TVL: *{stats['total_assets']:,.2f} {cfg.asset_symbol}*\n\n"
        f"👛 Wallet ({addr_short}):\n"
        f"   • Idle {cfg.asset_symbol}: *{idle['balance']:.6f}*\n"
        f"   • In vault: *{position['assets']:.6f} {cfg.asset_symbol}*\n\n"
        f"⚠️ {cfg.risk_note}\n\n"
        f"Deposit {cfg.asset_symbol} to start earning. Withdraw anytime."
    )
    keyboard = [
        [
            InlineKeyboardButton("➕ Deposit", callback_data="earn_dep"),
            InlineKeyboardButton("➖ Withdraw", callback_data="earn_wd"),
        ],
        [InlineKeyboardButton("💯 Withdraw All", callback_data="earn_wd_all")],
        [
            InlineKeyboardButton("🔄 Refresh", callback_data=f"earn_v_{vault_key}"),
            InlineKeyboardButton("« Earn", callback_data="earn_menu"),
        ],
    ]
    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return EARN_VAULT


async def earn_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Deposit/withdraw chosen → prompt for an amount (or All sentinel)."""
    query = update.callback_query
    await query.answer()

    earn = context.user_data.get("earn")
    if not earn or not earn.get("vault_key") or not earn.get("position"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /earn", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    cfg = get_vault(earn["vault_key"])

    if query.data == "earn_wd_all":
        earn["action"] = "withdraw"
        earn["amount"] = None  # full-redeem sentinel
        return await _show_confirm(update, context, is_callback=True)

    earn["action"] = "deposit" if query.data == "earn_dep" else "withdraw"
    if earn["action"] == "deposit":
        available = float(earn.get("idle") or 0)
        text = (
            f"➕ *Deposit {cfg.asset_symbol}* → {cfg.display_name}\n\n"
            f"Available: *{available:.6f} {cfg.asset_symbol}*\n\n"
            f"Enter an amount:"
        )
    else:
        available = float(earn["position"]["assets"])
        text = (
            f"➖ *Withdraw {cfg.asset_symbol}* from {cfg.display_name}\n\n"
            f"In vault: *{available:.6f} {cfg.asset_symbol}*\n\n"
            f"Enter an amount, or use Withdraw All:"
        )
    earn["available"] = available

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("« Back", callback_data=f"earn_v_{earn['vault_key']}")]]
        ),
    )
    return EARN_AMOUNT


async def earn_enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Typed amount input."""
    earn = context.user_data.get("earn")
    if not earn or not earn.get("action"):
        await update.message.reply_text(
            "❌ Session expired. Start again with /earn", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    amount = validate_amount(update.message.text)
    if amount is None or amount <= 0:
        await update.message.reply_text("❌ Invalid amount. Enter a number (e.g. 100 or 50.5):")
        return EARN_AMOUNT

    available = float(earn.get("available") or 0)
    if amount > available + 1e-9:
        await update.message.reply_text(
            f"❌ Amount exceeds available ({available:.6f}). Enter a smaller amount:"
        )
        return EARN_AMOUNT

    earn["amount"] = float(amount)
    return await _show_confirm(update, context, is_callback=False)


async def _show_confirm(update, context, *, is_callback) -> int:
    """Confirmation screen: amount, vault, protocol, chain, est. shares, risk note."""
    earn = context.user_data["earn"]
    cfg = get_vault(earn["vault_key"])
    action = earn["action"]
    amount = earn.get("amount")
    amount_text = "All (full balance)" if amount is None else f"{amount:.6f} {cfg.asset_symbol}"

    est_text = ""
    try:
        if action == "deposit" and amount is not None:
            assets_raw = int(round(amount * 10**cfg.asset_decimals))
            shares_raw = await asyncio.to_thread(
                vault_service.preview_deposit, earn["vault_key"], assets_raw
            )
            est_text = f"\nEst. shares: *{shares_raw / 10**cfg.share_decimals:.6f}*"
        elif action == "withdraw" and amount is not None:
            position = earn.get("position") or {}
            total_assets = float(position.get("assets") or 0)
            total_shares_raw = int(position.get("shares_raw") or 0)
            if total_assets > 0 and total_shares_raw > 0:
                shares_raw = min(
                    total_shares_raw, int(round(amount / total_assets * total_shares_raw))
                )
                assets_raw = await asyncio.to_thread(
                    vault_service.preview_redeem, earn["vault_key"], shares_raw
                )
                est_text = (
                    f"\nEst. return: *{assets_raw / 10**cfg.asset_decimals:.6f} {cfg.asset_symbol}*"
                )
    except VaultError:
        pass

    if action == "deposit":
        text = (
            f"✅ *Confirm Deposit*\n\n"
            f"Vault: *{cfg.display_name}* ({cfg.protocol})\n"
            f"Chain: *{cfg.chain.capitalize()}*\n"
            f"Amount: *{amount_text}*{est_text}\n\n"
            f"⚠️ {cfg.risk_note}\n\n"
            f"An exact-amount approval and the deposit are sent as two "
            f"transactions.\n\nProceed?"
        )
    else:
        text = (
            f"✅ *Confirm Withdrawal*\n\n"
            f"Vault: *{cfg.display_name}* ({cfg.protocol})\n"
            f"Chain: *{cfg.chain.capitalize()}*\n"
            f"Amount: *{amount_text}*{est_text}\n\n"
            f"{cfg.asset_symbol} is returned to your wallet.\n\nProceed?"
        )

    keyboard = [
        [
            InlineKeyboardButton("🚀 Confirm", callback_data="earn_exec"),
            InlineKeyboardButton("❌ Cancel", callback_data=f"earn_v_{earn['vault_key']}"),
        ]
    ]
    markup = InlineKeyboardMarkup(keyboard)
    if is_callback:
        await update.callback_query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=markup
        )
    else:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)
    return EARN_CONFIRM


async def earn_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the deposit/withdraw on-chain."""
    query = update.callback_query
    await query.answer()

    earn = context.user_data.get("earn")
    if not earn or not earn.get("action") or not earn.get("vault_key"):
        await query.edit_message_text(
            "❌ Session expired. Start again with /earn", reply_markup=_RETRY_KEYBOARD
        )
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    wallet_id = earn.get("wallet_id")
    vault_key = earn["vault_key"]
    cfg = get_vault(vault_key)
    action = earn["action"]
    amount = earn.get("amount")

    with get_session() as session:
        wallet = (
            session.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user_id).first()
        )
        if not wallet:
            await query.edit_message_text("❌ Wallet not found.")
            return ConversationHandler.END
        session.expunge(wallet)

    await query.edit_message_text(
        f"⏳ Submitting {escape_markdown(action)}... this can take a moment.",
        parse_mode="Markdown",
    )

    back_keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("« Back to Earn", callback_data=f"earn_v_{vault_key}")]]
    )
    try:
        if action == "deposit":
            assets_raw = int(round(float(amount) * 10**cfg.asset_decimals))
            tx_hashes = await asyncio.to_thread(
                vault_service.deposit, wallet, vault_key, assets_raw
            )
            await _log_event(user_id, wallet_id, vault_key, "deposit", amount, tx_hashes[-1])
            links = "\n".join(_tx_link(h, cfg.chain) for h in tx_hashes)
            text = (
                f"✅ *Deposit submitted!*\n\n"
                f"Deposited *{amount:.6f} {cfg.asset_symbol}* into {cfg.display_name}.\n\n"
                f"*Transactions:*\n{links}"
            )
        else:
            shares_raw = None  # full redeem
            if amount is not None:
                position = earn.get("position") or {}
                total_assets = float(position.get("assets") or 0)
                total_shares_raw = int(position.get("shares_raw") or 0)
                if total_assets <= 0 or total_shares_raw <= 0:
                    raise VaultError("Nothing to withdraw from this vault.")
                # ≥99.5% of the balance → full redeem (no dust left behind).
                if amount < total_assets * 0.995:
                    shares_raw = min(
                        total_shares_raw, int(round(amount / total_assets * total_shares_raw))
                    )
            tx_hashes = await asyncio.to_thread(
                vault_service.withdraw, wallet, vault_key, shares_raw
            )
            await _log_event(user_id, wallet_id, vault_key, "withdraw", amount, tx_hashes[-1])
            amount_text = "all funds" if amount is None else f"{amount:.6f} {cfg.asset_symbol}"
            text = (
                f"✅ *Withdrawal submitted!*\n\n"
                f"Withdrew *{amount_text}* from {cfg.display_name}.\n\n"
                f"*Transaction:*\n{_tx_link(tx_hashes[-1], cfg.chain)}"
            )

        keyboard = [
            [InlineKeyboardButton("🌾 Back to Earn", callback_data="earn_menu")],
            [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
        ]
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )
    except VaultError as e:
        logger.error(f"Earn {action} failed for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            user_facing_error(e, safe_exceptions=(VaultError,)), reply_markup=back_keyboard
        )
    except Exception as e:
        logger.error(f"Earn {action} unexpected error for user {user_id}: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ Something went wrong. Your funds were not moved. Please try again.",
            reply_markup=back_keyboard,
        )
    return EARN_MENU


async def earn_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the earn flow."""
    context.user_data.pop("earn", None)
    if update.callback_query:
        await update.callback_query.answer("Cancelled")
        from bot.handlers.start import main_menu_callback

        await main_menu_callback(update, context)
    else:
        await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


earn_conversation_handler = ConversationHandler(
    name="earn",
    persistent=True,
    entry_points=[
        CommandHandler("earn", earn_command),
        CallbackQueryHandler(earn_refresh_callback, pattern="^earn_menu$"),
    ],
    states={
        EARN_MENU: [
            CallbackQueryHandler(earn_vault_callback, pattern=_EARN_VAULT_PATTERN),
            CallbackQueryHandler(earn_refresh_callback, pattern="^earn_menu$"),
            CallbackQueryHandler(earn_close_callback, pattern="^earn_close$"),
        ],
        EARN_VAULT: [
            CallbackQueryHandler(earn_action_callback, pattern="^earn_dep$"),
            CallbackQueryHandler(earn_action_callback, pattern="^earn_wd$"),
            CallbackQueryHandler(earn_action_callback, pattern="^earn_wd_all$"),
            CallbackQueryHandler(earn_vault_callback, pattern=_EARN_VAULT_PATTERN),
            CallbackQueryHandler(earn_refresh_callback, pattern="^earn_menu$"),
        ],
        EARN_AMOUNT: [
            CallbackQueryHandler(earn_vault_callback, pattern=_EARN_VAULT_PATTERN),
            CallbackQueryHandler(earn_refresh_callback, pattern="^earn_menu$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, earn_enter_amount),
        ],
        EARN_CONFIRM: [
            CallbackQueryHandler(earn_execute_callback, pattern="^earn_exec$"),
            CallbackQueryHandler(earn_vault_callback, pattern=_EARN_VAULT_PATTERN),
            CallbackQueryHandler(earn_refresh_callback, pattern="^earn_menu$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(earn_close_callback, pattern="^earn_close$"),
        CommandHandler("cancel", earn_cancel),
    ],
    allow_reentry=True,
    per_message=False,
    per_chat=True,
)
