"""Custodial wallet handlers for deposits and withdrawals."""

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

from datetime import datetime
from web3 import Web3

from bot.models.user import User
from bot.models.custodial import TransactionType, TransactionStatus
from bot.models.security import WithdrawalWhitelist
from bot.services.hot_wallet import hot_wallet_service
from bot.services.security import spending_tracker, SpendingLimits
from bot.services.twofa import twofa_service
from bot.services.price_service import price_service
from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.tokens import TOKENS, get_token_address
from bot.utils.formatters import format_amount, format_usd
from bot.utils.validators import validate_amount, validate_address
from bot.utils.qr_code import generate_wallet_qr
from database.db import get_session
from bot.utils.tos_utils import enforce_tos


# Conversation states
SELECT_CHAIN, SELECT_TOKEN, ENTER_AMOUNT, CONFIRM_WITHDRAWAL, CONFIRM_2FA = range(5)


def _normalize_evm_address(to_address: str) -> str:
    """Validate an EVM address and return its EIP-55 checksummed form.

    Rejects malformed addresses (bad length, non-hex, invalid checksum) and
    rejects mixed-case addresses whose checksum does not match, so a user
    cannot silently send funds to an address that differs from what they
    intended. Raises ValueError on any invalid input.
    """
    # Format + checksum validation via eth_utils (handles all-lower, all-upper,
    # and correctly-checksummed mixed-case as valid).
    if not validate_address(to_address, "evm"):
        raise ValueError("Invalid EVM address.")

    # If the user supplied a mixed-case address, it must match EIP-55 exactly.
    # All-lowercase / all-uppercase inputs have no case information and are
    # accepted, then normalized to checksum form.
    body = to_address[2:] if to_address.startswith("0x") else to_address
    is_mixed_case = not (body.islower() or body.isupper())
    checksummed = Web3.to_checksum_address(to_address)
    if is_mixed_case and to_address != checksummed:
        raise ValueError(
            "Address checksum is invalid (possible typo). "
            "Please re-check and re-enter the address."
        )

    return checksummed


async def _amount_to_usd(token: str, amount: float) -> float:
    """Best-effort USD valuation of a token amount.

    On price lookup failure we fall back to the raw amount so that security
    gates (2FA / spending limits) fail safe (treat value as at least `amount`)
    rather than being bypassed by an unavailable price feed.
    """
    try:
        price = await price_service.get_price(token)
    except Exception:
        price = None
    if price is None:
        return float(amount)
    return float(amount) * float(price)


@enforce_tos
async def custodial_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /custodial command - show custodial wallet overview."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        
        user_id = db_user.id
    
    # Get custodial balances
    balances = hot_wallet_service.get_all_custodial_balances(user_id)
    
    # Get deposit addresses
    evm_wallet = hot_wallet_service.get_deposit_wallet("evm")
    sol_wallet = hot_wallet_service.get_deposit_wallet("solana")
    
    lines = ["🏦 *Custodial Wallet*\n"]
    lines.append("Your balances managed by the bot:\n")
    
    if balances:
        total_usd = 0.0
        for chain, tokens in balances.items():
            chain_info = get_chain_by_name(chain)
            chain_display = f"{chain_info.logo_emoji} {chain_info.display_name}" if chain_info else chain
            lines.append(f"\n*{chain_display}*")
            
            for token, amount in tokens.items():
                if amount > 0:
                    lines.append(f"  • {format_amount(float(amount), symbol=token)}")
        
        lines.append("")
    else:
        lines.append("_No custodial balances yet._\n")
    
    # Deposit info
    lines.append("📥 *Deposit Addresses*")
    if evm_wallet:
        lines.append(f"\n*EVM Chains* (ETH, BSC, etc.):")
        lines.append(f"`{evm_wallet.address}`")
    if sol_wallet:
        lines.append(f"\n*SOL*:")
        lines.append(f"`{sol_wallet.address}`")
    
    if not evm_wallet and not sol_wallet:
        lines.append("_No deposit wallets configured yet._")
    
    lines.append("\n⚡ *Benefits:*")
    lines.append("• Gas fees sponsored by us")
    lines.append("• Faster transaction execution")
    lines.append("• No need to manage gas tokens")
    
    keyboard = [
        [
            InlineKeyboardButton("📥 Deposit", callback_data="custodial_deposit"),
            InlineKeyboardButton("📤 Withdraw", callback_data="custodial_withdraw"),
        ],
        [
            InlineKeyboardButton("🔄 Swap", callback_data="custodial_swap"),
            InlineKeyboardButton("📜 History", callback_data="custodial_history"),
        ],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
    
    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


@enforce_tos
async def custodial_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle custodial menu callback."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            if query.message.photo:
                await query.message.delete()
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text="❌ Please use /start first."
                )
            else:
                await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    balances = hot_wallet_service.get_all_custodial_balances(user_id)
    evm_wallet = hot_wallet_service.get_deposit_wallet("evm")
    sol_wallet = hot_wallet_service.get_deposit_wallet("solana")
    
    lines = ["🏦 *Custodial Wallet*\n"]
    lines.append("Your balances managed by the bot:\n")
    
    if balances:
        for chain, tokens in balances.items():
            chain_info = get_chain_by_name(chain)
            chain_display = f"{chain_info.logo_emoji} {chain_info.display_name}" if chain_info else chain
            lines.append(f"\n*{chain_display}*")
            
            for token, amount in tokens.items():
                if amount > 0:
                    lines.append(f"  • {format_amount(float(amount), symbol=token)}")
    else:
        lines.append("_No custodial balances yet._\n")
    
    lines.append("\n📥 *Deposit Addresses*")
    if evm_wallet:
        lines.append(f"\n*EVM Chains*:")
        lines.append(f"`{evm_wallet.address}`")
    if sol_wallet:
        lines.append(f"\n*SOL*:")
        lines.append(f"`{sol_wallet.address}`")
    
    keyboard = [
        [
            InlineKeyboardButton("📥 Deposit", callback_data="custodial_deposit"),
            InlineKeyboardButton("📤 Withdraw", callback_data="custodial_withdraw"),
        ],
        [
            InlineKeyboardButton("🔄 Swap", callback_data="custodial_swap"),
            InlineKeyboardButton("📜 History", callback_data="custodial_history"),
        ],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
    
    text = "\n".join(lines)
    
    # If coming from a photo (QR code), delete and send new message
    if query.message.photo:
        await query.message.delete()
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    else:
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )


async def deposit_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show deposit instructions with chain selection."""
    query = update.callback_query
    await query.answer()
    
    evm_wallet = hot_wallet_service.get_deposit_wallet("evm")
    sol_wallet = hot_wallet_service.get_deposit_wallet("solana")
    
    lines = ["📥 *Deposit to Custodial Wallet*\n"]
    lines.append("Select a network to view deposit address:\n")
    
    keyboard = []
    
    if evm_wallet:
        keyboard.append([
            InlineKeyboardButton("🔷 Ethereum", callback_data="deposit_qr_ethereum"),
            InlineKeyboardButton("🟣 Polygon", callback_data="deposit_qr_polygon"),
        ])
        keyboard.append([
            InlineKeyboardButton("🟡 BSC", callback_data="deposit_qr_bsc"),
            InlineKeyboardButton("🔵 Arbitrum", callback_data="deposit_qr_arbitrum"),
        ])
        keyboard.append([
            InlineKeyboardButton("🔴 Optimism", callback_data="deposit_qr_optimism"),
            InlineKeyboardButton("🔵 Base", callback_data="deposit_qr_base"),
        ])
    
    if sol_wallet:
        keyboard.append([
            InlineKeyboardButton("🟢 Solana", callback_data="deposit_qr_solana"),
        ])
    
    if not evm_wallet and not sol_wallet:
        lines.append("❌ _Deposit wallets not configured\\. Contact admin\\._")
    
    keyboard.append([InlineKeyboardButton("« Back", callback_data="custodial_menu")])
    
    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="MarkdownV2",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def deposit_qr_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show QR code for specific chain deposit."""
    query = update.callback_query
    await query.answer()
    
    # Extract chain from callback data
    chain = query.data.replace("deposit_qr_", "")
    
    # Get appropriate wallet
    if chain == "solana":
        wallet = hot_wallet_service.get_deposit_wallet("solana")
    else:
        wallet = hot_wallet_service.get_deposit_wallet("evm")
    
    if not wallet:
        await query.edit_message_text("❌ Deposit wallet not configured.")
        return
    
    # Chain display names and emojis
    chain_info = {
        "ethereum": ("🔷", "ETH"),
        "polygon": ("🟣", "POL"),
        "bsc": ("🟡", "BSC"),
        "arbitrum": ("🔵", "ARB"),
        "optimism": ("🔴", "OP"),
        "base": ("🔵", "Base"),
        "solana": ("🟢", "SOL"),
    }
    
    emoji, display_name = chain_info.get(chain, ("💎", chain.title()))
    
    # Generate QR code
    try:
        qr_bytes = generate_wallet_qr(wallet.address, chain=chain)
    except Exception:
        # Fallback: just show address without QR
        await query.edit_message_text(
            f"{emoji} *{display_name} Deposit*\n\n"
            f"Address:\n`{wallet.address}`\n\n"
            f"⚠️ Only send tokens on the {display_name} network\\!",
            parse_mode="MarkdownV2",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="custodial_deposit")]
            ])
        )
        return
    
    # Delete old message and send new one with photo
    await query.message.delete()
    
    from io import BytesIO
    
    caption = (
        f"{emoji} *{display_name} Deposit*\n\n"
        f"Address:\n`{wallet.address}`\n\n"
        f"⚠️ Only send tokens on the *{display_name}* network\\!\n\n"
        f"• Scan QR or copy address above\n"
        f"• Deposits credited automatically\n"
        f"• Allow 1\\-5 min for confirmation"
    )
    
    keyboard = [
        [InlineKeyboardButton("« Back to Networks", callback_data="custodial_deposit")],
        [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
    ]
    
    await context.bot.send_photo(
        chat_id=query.message.chat_id,
        photo=BytesIO(qr_bytes),
        caption=caption,
        parse_mode="MarkdownV2",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def withdraw_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start withdrawal flow."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
        user_id = db_user.id
    
    balances = hot_wallet_service.get_all_custodial_balances(user_id)
    
    if not balances:
        await query.edit_message_text(
            "❌ No custodial balances to withdraw.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="custodial_menu")]
            ])
        )
        return ConversationHandler.END
    
    # Show chain selection
    keyboard = []
    for chain in balances.keys():
        chain_info = get_chain_by_name(chain)
        if chain_info:
            keyboard.append([
                InlineKeyboardButton(
                    f"{chain_info.logo_emoji} {chain_info.display_name}",
                    callback_data=f"withdraw_chain_{chain}"
                )
            ])
    
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="custodial_menu")])
    
    await query.edit_message_text(
        "📤 *Withdraw from Custodial*\n\nSelect chain:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    
    return SELECT_CHAIN


async def withdraw_select_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle chain selection for withdrawal."""
    query = update.callback_query
    await query.answer()
    
    chain = query.data.replace("withdraw_chain_", "")
    context.user_data["withdraw_chain"] = chain
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return SELECT_CHAIN
        user_id = db_user.id

    balances = hot_wallet_service.get_all_custodial_balances(user_id)
    chain_balances = balances.get(chain, {})
    
    if not chain_balances:
        await query.edit_message_text(
            f"❌ No balances on {chain}.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="custodial_withdraw")]
            ])
        )
        return SELECT_CHAIN
    
    # Show token selection
    keyboard = []
    for token, amount in chain_balances.items():
        if amount > 0:
            keyboard.append([
                InlineKeyboardButton(
                    f"{token}: {format_amount(float(amount))}",
                    callback_data=f"withdraw_token_{token}"
                )
            ])
    
    keyboard.append([InlineKeyboardButton("« Back", callback_data="custodial_withdraw")])
    
    chain_info = get_chain_by_name(chain)
    
    await query.edit_message_text(
        f"📤 *Withdraw from {chain_info.display_name if chain_info else chain}*\n\nSelect token:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    
    return SELECT_TOKEN


async def withdraw_select_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle token selection for withdrawal."""
    query = update.callback_query
    await query.answer()
    
    token = query.data.replace("withdraw_token_", "")
    context.user_data["withdraw_token"] = token
    
    chain = context.user_data.get("withdraw_chain")
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id
    
    balance = hot_wallet_service.get_custodial_balance(user_id, chain, token)
    context.user_data["withdraw_balance"] = float(balance)
    
    await query.edit_message_text(
        f"📤 *Withdraw {token}*\n\n"
        f"Available: {format_amount(float(balance), symbol=token)}\n\n"
        f"Enter amount to withdraw (or 'max' for all):",
        parse_mode="Markdown",
    )
    
    return ENTER_AMOUNT


async def withdraw_enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount input for withdrawal."""
    text = update.message.text.strip().lower()
    
    balance = context.user_data.get("withdraw_balance", 0)
    
    if text == "max" or text == "all":
        amount = balance
    else:
        amount = validate_amount(text)
        if amount is None:
            await update.message.reply_text(
                "❌ Invalid amount. Please enter a number or 'max'."
            )
            return ENTER_AMOUNT
    
    if amount <= 0:
        await update.message.reply_text("❌ Amount must be greater than 0.")
        return ENTER_AMOUNT
    
    if amount > balance:
        await update.message.reply_text(
            f"❌ Insufficient balance. Available: {format_amount(balance)}"
        )
        return ENTER_AMOUNT
    
    context.user_data["withdraw_amount"] = amount
    
    token = context.user_data.get("withdraw_token")
    chain = context.user_data.get("withdraw_chain")
    
    await update.message.reply_text(
        f"📤 *Confirm Withdrawal*\n\n"
        f"Token: {token}\n"
        f"Chain: {chain}\n"
        f"Amount: {format_amount(amount, symbol=token)}\n\n"
        f"Please enter the destination address:",
        parse_mode="Markdown",
    )
    
    return CONFIRM_WITHDRAWAL


def _clear_withdraw_context(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Clear all withdrawal-related conversation state."""
    for key in (
        "withdraw_chain",
        "withdraw_token",
        "withdraw_amount",
        "withdraw_balance",
        "withdraw_address",
        "withdraw_amount_usd",
        "withdraw_in_progress",
    ):
        context.user_data.pop(key, None)


def _check_withdrawal_whitelist(user_id: int, chain: str, to_address: str) -> tuple[bool, str]:
    """Enforce the user's withdrawal whitelist for a chain (opt-in).

    Behavior preserved when the user has no active whitelist entries for the
    chain: withdrawals to any address are allowed. Once the user has added any
    active whitelist entry for the chain, only whitelisted, cooldown-cleared
    addresses are permitted.

    Returns (allowed, error_message).
    """
    target = to_address.lower()
    with get_session() as session:
        entries = session.query(WithdrawalWhitelist).filter(
            WithdrawalWhitelist.user_id == user_id,
            WithdrawalWhitelist.chain == chain,
            WithdrawalWhitelist.is_active == True,  # noqa: E712
        ).all()

        if not entries:
            # Whitelist not configured for this chain -> no restriction.
            return True, ""

        match = next((e for e in entries if (e.address or "").lower() == target), None)
        if match is None:
            return False, (
                "Destination address is not in your withdrawal whitelist for "
                f"{chain}. Add it first, then try again."
            )

        if match.cooldown_until and match.cooldown_until > datetime.utcnow():
            return False, (
                "This whitelisted address is still in its security cooldown "
                f"(until {match.cooldown_until:%Y-%m-%d %H:%M} UTC). "
                "Please wait before withdrawing to it."
            )

    return True, ""


async def _execute_withdrawal(update, context, user_id, chain, token, amount, to_address, amount_usd) -> None:
    """Perform the on-chain withdrawal with balance deduction and refund-on-failure.

    The balance is deducted first (so a concurrent confirmation cannot
    double-spend: update_custodial_balance with operation="subtract" raises
    ValueError on insufficient funds within a single DB session). If the
    on-chain send (or any later step) fails, the deducted amount is refunded.
    """
    await update.message.reply_text("⏳ Processing withdrawal...")

    amount_dec = Decimal(str(amount))
    balance_deducted = False
    try:
        # Atomic read-modify-write; raises if it would go negative.
        hot_wallet_service.update_custodial_balance(
            user_id=user_id,
            chain=chain,
            token_symbol=token,
            amount=amount_dec,
            operation="subtract",
        )
        balance_deducted = True

        hot_wallet = hot_wallet_service.get_deposit_wallet("evm")
        if not hot_wallet:
            raise Exception("Hot wallet not configured")

        token_address = get_token_address(token, chain)

        if token_address and token_address != "0x0000000000000000000000000000000000000000":
            decimals = TOKENS[token].decimals
            tx_hash = await hot_wallet_service.send_token(
                wallet=hot_wallet,
                chain_name=chain,
                token_address=token_address,
                to_address=to_address,
                amount=amount_dec,
                decimals=decimals,
            )
        else:
            tx_hash = await hot_wallet_service.send_native_token(
                wallet=hot_wallet,
                chain_name=chain,
                to_address=to_address,
                amount=amount_dec,
            )

        hot_wallet_service.record_transaction(
            user_id=user_id,
            tx_type=TransactionType.WITHDRAWAL,
            chain=chain,
            token_symbol=token,
            amount=amount_dec,
            tx_hash=tx_hash,
            from_address=hot_wallet.address,
            to_address=to_address,
        )

        # Record spending only after a successful on-chain send.
        try:
            spending_tracker.record_spending(user_id, amount_usd)
        except Exception:
            pass

        await update.message.reply_text(
            f"✅ *Withdrawal Submitted\\!*\n\n"
            f"Amount: {format_amount(amount, symbol=token)}\n"
            f"To: `{to_address[:10]}...{to_address[-8:]}`\n"
            f"Tx: `{tx_hash[:20]}...`\n\n"
            f"⏳ Please wait for blockchain confirmation\\.",
            parse_mode="MarkdownV2",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🏦 Custodial", callback_data="custodial_menu")]
            ])
        )

    except Exception as e:
        # Refund the deducted balance so funds are never lost when the send
        # never reached the chain.
        if balance_deducted:
            try:
                hot_wallet_service.update_custodial_balance(
                    user_id=user_id,
                    chain=chain,
                    token_symbol=token,
                    amount=amount_dec,
                    operation="add",
                )
            except Exception:
                import logging
                logging.getLogger(__name__).error(
                    "CRITICAL: failed to refund custodial balance for user "
                    f"{user_id} chain={chain} token={token} amount={amount} "
                    f"after withdrawal error: {e}"
                )
        await update.message.reply_text(
            f"❌ Withdrawal failed: {str(e)}\n\n"
            f"Your balance was not charged.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Try Again", callback_data="custodial_withdraw")],
                [InlineKeyboardButton("« Back", callback_data="custodial_menu")]
            ])
        )


async def withdraw_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle withdrawal confirmation: validate address, enforce policy, gate on 2FA."""
    raw_address = update.message.text.strip()

    # Strict address validation: format + EIP-55 checksum. Rejects typos,
    # invalid hex, wrong length, and mismatched-case (non-checksummed) input.
    try:
        to_address = _normalize_evm_address(raw_address)
    except ValueError as e:
        await update.message.reply_text(
            f"❌ {e} Please enter a valid checksummed EVM address starting with 0x."
        )
        return CONFIRM_WITHDRAWAL

    user = update.effective_user
    token = context.user_data.get("withdraw_token")
    chain = context.user_data.get("withdraw_chain")
    amount = context.user_data.get("withdraw_amount")

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id

    # Whitelist enforcement (opt-in per chain).
    allowed, wl_error = _check_withdrawal_whitelist(user_id, chain, to_address)
    if not allowed:
        await update.message.reply_text(
            f"❌ {wl_error}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="custodial_menu")]
            ])
        )
        _clear_withdraw_context(context)
        return ConversationHandler.END

    # Spending-limit enforcement (per-swap / hourly / daily).
    amount_usd = await _amount_to_usd(token, amount)
    limits = SpendingLimits()
    ok, limit_error = spending_tracker.check_limits(user_id, amount_usd, limits)
    if not ok:
        await update.message.reply_text(
            f"❌ {limit_error}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="custodial_menu")]
            ])
        )
        _clear_withdraw_context(context)
        return ConversationHandler.END

    # Stash validated/normalized details for the (possible) 2FA step.
    context.user_data["withdraw_address"] = to_address
    context.user_data["withdraw_amount_usd"] = amount_usd

    # 2FA gate for high-value withdrawals.
    if spending_tracker.requires_2fa(amount_usd, limits):
        code = twofa_service.generate_simple_code(
            user_id,
            action_data={"to_address": to_address, "amount": amount, "token": token, "chain": chain},
        )
        await update.message.reply_text(
            "🔐 *2FA Required*\n\n"
            f"This withdrawal (~{format_usd(amount_usd)}) requires confirmation.\n"
            f"Your verification code is: `{code}`\n\n"
            "Reply with this code to confirm, or /cancel to abort.",
            parse_mode="Markdown",
        )
        return CONFIRM_2FA

    user_id_local = user_id
    await _execute_withdrawal(update, context, user_id_local, chain, token, amount, to_address, amount_usd)
    _clear_withdraw_context(context)
    return ConversationHandler.END


async def withdraw_confirm_2fa(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the 2FA code, then execute the withdrawal."""
    code = update.message.text.strip()

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_id = db_user.id

    success, action_data = twofa_service.verify_simple_code(user_id, code)
    if not success:
        await update.message.reply_text(
            "❌ Invalid or expired code. Please re-enter the code, or /cancel to abort."
        )
        return CONFIRM_2FA

    # Prefer the values captured at code-generation time; fall back to context.
    action_data = action_data or {}
    chain = action_data.get("chain") or context.user_data.get("withdraw_chain")
    token = action_data.get("token") or context.user_data.get("withdraw_token")
    amount = action_data.get("amount") or context.user_data.get("withdraw_amount")
    to_address = action_data.get("to_address") or context.user_data.get("withdraw_address")
    amount_usd = context.user_data.get("withdraw_amount_usd")
    if amount_usd is None:
        amount_usd = await _amount_to_usd(token, amount)

    await _execute_withdrawal(update, context, user_id, chain, token, amount, to_address, amount_usd)
    _clear_withdraw_context(context)
    return ConversationHandler.END


async def withdraw_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel withdrawal."""
    query = update.callback_query
    await query.answer()
    
    _clear_withdraw_context(context)
    context.user_data.pop("withdraw_amount_usd", None)

    await custodial_callback(update, context)
    return ConversationHandler.END


# Withdrawal conversation handler
withdrawal_conversation = ConversationHandler(
    name="withdrawal",
    persistent=True,
    entry_points=[
        CallbackQueryHandler(withdraw_start, pattern="^custodial_withdraw$"),
    ],
    states={
        SELECT_CHAIN: [
            CallbackQueryHandler(withdraw_select_chain, pattern="^withdraw_chain_"),
            CallbackQueryHandler(withdraw_cancel, pattern="^custodial_menu$"),
        ],
        SELECT_TOKEN: [
            CallbackQueryHandler(withdraw_select_token, pattern="^withdraw_token_"),
            CallbackQueryHandler(withdraw_start, pattern="^custodial_withdraw$"),
        ],
        ENTER_AMOUNT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_enter_amount),
        ],
        CONFIRM_WITHDRAWAL: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_confirm),
        ],
        CONFIRM_2FA: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_confirm_2fa),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", withdraw_cancel),
        CallbackQueryHandler(withdraw_cancel, pattern="^custodial_menu$"),
    ],
    per_message=False,
    per_chat=True,
)


# Create handlers
custodial_handler = CommandHandler("c", custodial_command)


# Export the new callback
__all__ = [
    "custodial_handler",
    "custodial_callback", 
    "deposit_callback",
    "deposit_qr_callback",
    "withdrawal_conversation",
]

