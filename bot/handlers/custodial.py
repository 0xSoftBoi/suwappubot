"""Custodial wallet handlers for deposits and withdrawals."""

import logging
import uuid
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

from bot.models.user import User
from bot.models.custodial import TransactionType, TransactionStatus
from bot.services.hot_wallet import (
    hot_wallet_service,
    WithdrawalsPausedError,
    PostBroadcastAmbiguous,
    quantize_to_decimals,
)
from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.tokens import TOKENS, get_token_address
from bot.utils.formatters import format_amount, format_usd
from bot.utils.validators import validate_amount
from bot.utils.qr_code import generate_wallet_qr
from database.db import get_session
from bot.utils.tos_utils import enforce_tos

logger = logging.getLogger(__name__)

# Conversation states
SELECT_CHAIN, SELECT_TOKEN, ENTER_AMOUNT, CONFIRM_WITHDRAWAL = range(4)

# Base58 alphabet (Bitcoin/Solana/TRON) — excludes 0, O, I, l.
_BASE58_ALPHABET = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")


def _is_base58(value: str) -> bool:
    return bool(value) and all(c in _BASE58_ALPHABET for c in value)


def validate_withdraw_address(chain: str, address: str) -> bool:
    """Validate a destination address per chain family.

    Prevents sending to a wrong-format address (e.g. an EVM 0x address pasted as a
    Solana/TRON destination), which would burn funds irrecoverably.
    """
    address = (address or "").strip()
    chain_l = (chain or "").lower()

    if chain_l == "solana":
        # Solana base58-encoded 32-byte pubkey → 32-44 chars, no 0x.
        return _is_base58(address) and 32 <= len(address) <= 44

    if chain_l in ("tron", "trx"):
        # TRON mainnet base58check addresses start with 'T' and are 34 chars.
        return address.startswith("T") and _is_base58(address) and len(address) == 34

    # Default: EVM-family. 0x + 40 hex chars (EIP-55 mixed-case tolerated).
    if not address.startswith("0x") or len(address) != 42:
        return False
    hex_part = address[2:]
    try:
        int(hex_part, 16)
    except ValueError:
        return False
    return True


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
            chain_display = (
                f"{chain_info.logo_emoji} {chain_info.display_name}" if chain_info else chain
            )
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
                    chat_id=query.message.chat_id, text="❌ Please use /start first."
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
            chain_display = (
                f"{chain_info.logo_emoji} {chain_info.display_name}" if chain_info else chain
            )
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
        keyboard.append(
            [
                InlineKeyboardButton("🔷 Ethereum", callback_data="deposit_qr_ethereum"),
                InlineKeyboardButton("🟣 Polygon", callback_data="deposit_qr_polygon"),
            ]
        )
        keyboard.append(
            [
                InlineKeyboardButton("🟡 BSC", callback_data="deposit_qr_bsc"),
                InlineKeyboardButton("🔵 Arbitrum", callback_data="deposit_qr_arbitrum"),
            ]
        )
        keyboard.append(
            [
                InlineKeyboardButton("🔴 Optimism", callback_data="deposit_qr_optimism"),
                InlineKeyboardButton("🔵 Base", callback_data="deposit_qr_base"),
            ]
        )

    if sol_wallet:
        keyboard.append(
            [
                InlineKeyboardButton("🟢 Solana", callback_data="deposit_qr_solana"),
            ]
        )

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
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("« Back", callback_data="custodial_deposit")]]
            ),
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
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("« Back", callback_data="custodial_menu")]]
            ),
        )
        return ConversationHandler.END

    # Show chain selection
    keyboard = []
    for chain in balances.keys():
        chain_info = get_chain_by_name(chain)
        if chain_info:
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"{chain_info.logo_emoji} {chain_info.display_name}",
                        callback_data=f"withdraw_chain_{chain}",
                    )
                ]
            )

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
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("« Back", callback_data="custodial_withdraw")]]
            ),
        )
        return SELECT_CHAIN

    # Show token selection
    keyboard = []
    for token, amount in chain_balances.items():
        if amount > 0:
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"{token}: {format_amount(float(amount))}",
                        callback_data=f"withdraw_token_{token}",
                    )
                ]
            )

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
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
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
            await update.message.reply_text("❌ Invalid amount. Please enter a number or 'max'.")
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

    # Tempo TIP-20 supports an on-chain payment memo. Offer it inline (append
    # "| memo") so we don't add a state to the irreversible withdraw flow.
    memo_hint = ""
    if (chain or "").lower() == "tempo":
        memo_hint = (
            "\n\n_Tip: add an on-chain memo by appending_ `| your memo` "
            "_(e.g._ `0xabc...123 | invoice 42`_)._"
        )

    await update.message.reply_text(
        f"📤 *Confirm Withdrawal*\n\n"
        f"Token: {token}\n"
        f"Chain: {chain}\n"
        f"Amount: {format_amount(amount, symbol=token)}\n\n"
        f"Please enter the destination address:" + memo_hint,
        parse_mode="Markdown",
    )

    return CONFIRM_WITHDRAWAL


async def withdraw_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive the destination address, validate it, and show a confirmation card.

    The irreversible on-chain send is NOT executed here — only after the user taps
    "Confirm Send" (withdraw_execute). This prevents an accidental paste from
    instantly draining funds to an unverified address.
    """
    raw_input = update.message.text.strip()

    chain = context.user_data.get("withdraw_chain")
    token = context.user_data.get("withdraw_token")
    amount = context.user_data.get("withdraw_amount")

    # Tempo only: an optional on-chain memo can be appended after a "|".
    memo = None
    to_address = raw_input
    if (chain or "").lower() == "tempo" and "|" in raw_input:
        addr_part, _, memo_part = raw_input.partition("|")
        to_address = addr_part.strip()
        memo = memo_part.strip()[:32] or None
    context.user_data["withdraw_memo"] = memo

    # Validate the address format for the selected chain (Solana/TRON/EVM).
    if not validate_withdraw_address(chain, to_address):
        chain_l = (chain or "").lower()
        if chain_l == "solana":
            hint = "a valid Solana (base58) address"
        elif chain_l in ("tron", "trx"):
            hint = "a valid TRON address (starts with 'T')"
        else:
            hint = "a valid EVM address starting with 0x"
        await update.message.reply_text(f"❌ Invalid address. Please enter {hint}.")
        return CONFIRM_WITHDRAWAL

    # Stash the validated address for the execute step.
    context.user_data["withdraw_address"] = to_address

    # A fresh per-confirmation idempotency token. withdraw_execute claims this
    # (via the same claim/finalize/release primitives the web route uses)
    # before reserving/sending, so a double-tap of "Confirm Send" — or any
    # re-delivery of the same callback update — can only ever be processed
    # once.
    context.user_data["withdraw_confirm_token"] = uuid.uuid4().hex

    chain_info = get_chain_by_name(chain)
    chain_display = chain_info.display_name if chain_info else chain

    # Confirmation card — show the FULL destination address so the user can verify
    # it before any funds move.
    keyboard = [
        [
            InlineKeyboardButton("✅ Confirm Send", callback_data="withdraw_execute"),
            InlineKeyboardButton("❌ Cancel", callback_data="custodial_menu"),
        ],
    ]
    memo_line = f"Memo: `{memo}`\n" if memo else ""
    await update.message.reply_text(
        f"📤 *Confirm Withdrawal*\n\n"
        f"Token: {token}\n"
        f"Chain: {chain_display}\n"
        f"Amount: {format_amount(amount, symbol=token)}\n"
        f"{memo_line}\n"
        f"Destination:\n`{to_address}`\n\n"
        f"⚠️ This is irreversible. Double-check the address before confirming.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return CONFIRM_WITHDRAWAL


def _clear_withdraw_context(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("withdraw_chain", None)
    context.user_data.pop("withdraw_token", None)
    context.user_data.pop("withdraw_amount", None)
    context.user_data.pop("withdraw_balance", None)
    context.user_data.pop("withdraw_address", None)
    context.user_data.pop("withdraw_memo", None)
    context.user_data.pop("withdraw_confirm_token", None)
    context.user_data.pop("withdraw_in_flight", None)


async def withdraw_execute(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the on-chain send after the user confirms via the inline button."""
    query = update.callback_query
    await query.answer()

    # Double-tap guard: a fast repeat tap of "Confirm Send" (or a duplicate
    # callback delivery from Telegram) fires this handler twice concurrently.
    # This in-process flag is checked-and-set atomically (no `await` between
    # the check and the set) so the second invocation bails immediately
    # instead of racing the first one to reserve/send. The idempotency claim
    # below is the durable backstop (covers process restarts / multi-worker),
    # this flag just avoids two concurrent in-process sends for the common case.
    if context.user_data.get("withdraw_in_flight"):
        await query.answer("Withdrawal already in progress — please wait.", show_alert=True)
        return CONFIRM_WITHDRAWAL
    context.user_data["withdraw_in_flight"] = True

    try:
        user = update.effective_user
        token = context.user_data.get("withdraw_token")
        chain = context.user_data.get("withdraw_chain")
        amount = context.user_data.get("withdraw_amount")
        to_address = context.user_data.get("withdraw_address")
        confirm_token = context.user_data.get("withdraw_confirm_token")

        # Guard against a stale/expired confirmation card (e.g. bot restart
        # cleared state) — re-validate before doing anything irreversible.
        if not (
            token and chain and amount and to_address and confirm_token
        ) or not validate_withdraw_address(chain, to_address):
            await query.edit_message_text(
                "❌ Withdrawal session expired. Please start again.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("« Back", callback_data="custodial_menu")]]
                ),
            )
            _clear_withdraw_context(context)
            return ConversationHandler.END

        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            if not db_user:
                await query.edit_message_text("❌ Please use /start first.")
                _clear_withdraw_context(context)
                return ConversationHandler.END
            user_id = db_user.id

        await query.edit_message_text("⏳ Processing withdrawal...")

        # Determine decimals up front so we can quantize the amount BEFORE
        # both the ledger reserve and the on-chain int conversion — otherwise
        # the ledger debits full Decimal precision while the on-chain amount
        # floors to base units, leaving a dust mismatch between the two.
        token_address = get_token_address(token, chain)
        is_native = not (
            token_address and token_address != "0x0000000000000000000000000000000000000000"
        )
        decimals = TOKENS[token].decimals if (token in TOKENS and not is_native) else 18
        withdraw_amount = quantize_to_decimals(Decimal(str(amount)), decimals)

        # Idempotency key ties this specific confirmation card to a single
        # execution, using the same claim/finalize/release primitives as the
        # web route (a PENDING placeholder guarded by the DB unique index on
        # (user_id, idempotency_key)). Durable across restarts, unlike the
        # in-flight flag above.
        idempotency_key = f"tg_withdraw:{user_id}:{confirm_token}"
        claimed_tx_id = hot_wallet_service.claim_idempotency_key(
            idempotency_key=idempotency_key,
            user_id=user_id,
            tx_type=TransactionType.WITHDRAWAL,
            chain=chain,
            token_symbol=token,
            amount=withdraw_amount,
            to_address=to_address,
        )
        if claimed_tx_id is None:
            # Already claimed by a previous (or concurrent) execution of this
            # exact confirmation — do not reprocess.
            existing = hot_wallet_service.get_transaction_by_idempotency_key(
                user_id, idempotency_key
            )
            await query.edit_message_text(
                "⏳ This withdrawal was already submitted"
                + (f"\nTx: `{existing.tx_hash[:20]}...`" if existing and existing.tx_hash else "")
                + "\n\nCheck /orders or your wallet for status.",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🏦 Custodial", callback_data="custodial_menu")]]
                ),
            )
            _clear_withdraw_context(context)
            return ConversationHandler.END

        reserved = False
        try:
            # Reserve FIRST: a single atomic conditional debit. This IS the
            # balance check now — never trust
            # context.user_data["withdraw_balance"], which is a cached read
            # from token-select time and can be stale by the time the user
            # confirms (concurrent withdrawals, other conversations, or a
            # balance change in between). reserve_custodial_balance only
            # succeeds if the current balance actually covers the amount, so
            # it also closes the same TOCTOU race as the web route.
            reserved = hot_wallet_service.reserve_custodial_balance(
                user_id=user_id,
                chain=chain,
                token_symbol=token,
                amount=withdraw_amount,
            )
            if not reserved:
                hot_wallet_service.release_claimed_transaction(claimed_tx_id)
                raise Exception("Insufficient balance")

            # Get hot wallet
            hot_wallet = hot_wallet_service.get_deposit_wallet("evm")
            if not hot_wallet:
                raise Exception("Hot wallet not configured")

            # Send on-chain AFTER the reservation is committed. The
            # kill-switch (TERMINAL_WITHDRAW_ENABLED) is enforced inside
            # send_token / send_native_token so this surface honors the same
            # pause toggle as the web route.
            if not is_native:
                # Optional payment memo (Tempo TIP-20 transferWithMemo). The
                # withdraw flow has no memo-input step yet; if a future step
                # sets context.user_data["withdraw_memo"], it rides with the
                # transfer.
                memo = context.user_data.get("withdraw_memo", "") or ""
                tx_hash = await hot_wallet_service.send_token(
                    wallet=hot_wallet,
                    chain_name=chain,
                    token_address=token_address,
                    to_address=to_address,
                    amount=withdraw_amount,
                    decimals=decimals,
                    memo=memo,
                    claimed_tx_id=claimed_tx_id,
                )
            else:
                tx_hash = await hot_wallet_service.send_native_token(
                    wallet=hot_wallet,
                    chain_name=chain,
                    to_address=to_address,
                    amount=withdraw_amount,
                    claimed_tx_id=claimed_tx_id,
                )

            # Balance was already debited by the reservation above; finalize
            # the claimed idempotency placeholder.
            hot_wallet_service.finalize_claimed_transaction(
                tx_id=claimed_tx_id, tx_hash=tx_hash, from_address=hot_wallet.address
            )

            await query.edit_message_text(
                f"✅ *Withdrawal Submitted\\!*\n\n"
                f"Amount: {format_amount(amount, symbol=token)}\n"
                f"To: `{to_address[:10]}...{to_address[-8:]}`\n"
                f"Tx: `{tx_hash[:20]}...`\n\n"
                f"⏳ Please wait for blockchain confirmation\\.",
                parse_mode="MarkdownV2",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🏦 Custodial", callback_data="custodial_menu")]]
                ),
            )

        except PostBroadcastAmbiguous as exc:
            # DO NOT refund and DO NOT release the idempotency placeholder.
            # The node call itself failed/threw AFTER the tx may already have
            # been accepted and propagated (timeout, dropped response,
            # "already known", transient 5xx) — we genuinely don't know if
            # funds moved. Leave the reservation debited and the placeholder
            # PENDING; the withdraw reconciler resolves it against real
            # chain state. Do not show this to the user as a failure.
            #
            # The deterministic hash is normally already stamped pre-broadcast
            # (see hot_wallet._broadcast_evm_raw_tx / _send_sol_native /
            # _send_spl_token); record it again here as an explicit,
            # idempotent backstop so it is never silently dropped.
            hot_wallet_service.record_pending_tx_hash(claimed_tx_id, exc.tx_hash)
            logger.exception(
                "bot withdraw broadcast ambiguous for user %s (tx_id=%s, tx_hash=%s) — left PENDING for reconciler",
                user_id,
                claimed_tx_id,
                exc.tx_hash,
            )
            await query.edit_message_text(
                "⏳ *Withdrawal Submitted*\n\n"
                "We couldn't confirm your withdrawal reached the network right away. "
                "We're checking — it will either complete or be automatically refunded. "
                "No action needed; check /orders shortly for status.",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🏦 Custodial", callback_data="custodial_menu")]]
                ),
            )

        except WithdrawalsPausedError as e:
            # Kill-switch check happens before any node call — safe to fully
            # undo, same as any other pre-broadcast failure below.
            if reserved:
                hot_wallet_service.update_custodial_balance(
                    user_id=user_id,
                    chain=chain,
                    token_symbol=token,
                    amount=withdraw_amount,
                    operation="add",
                )
                hot_wallet_service.release_claimed_transaction(claimed_tx_id)
            await query.edit_message_text(
                f"⏸️ {str(e)}",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("🔄 Try Again", callback_data="custodial_withdraw")],
                        [InlineKeyboardButton("« Back", callback_data="custodial_menu")],
                    ]
                ),
            )

        except Exception as e:
            # Everything else here (missing hot wallet, insufficient balance,
            # gas estimation, nonce fetch, signing) happens strictly BEFORE
            # the broadcast call — the broadcast call itself is wrapped and
            # raises PostBroadcastAmbiguous instead of a bare Exception, so
            # reaching this branch means nothing was ever sent to the
            # network. Safe to fully undo.
            if reserved:
                hot_wallet_service.update_custodial_balance(
                    user_id=user_id,
                    chain=chain,
                    token_symbol=token,
                    amount=withdraw_amount,
                    operation="add",
                )
                hot_wallet_service.release_claimed_transaction(claimed_tx_id)
            await query.edit_message_text(
                f"❌ Withdrawal failed: {str(e)}",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("🔄 Try Again", callback_data="custodial_withdraw")],
                        [InlineKeyboardButton("« Back", callback_data="custodial_menu")],
                    ]
                ),
            )
    finally:
        context.user_data.pop("withdraw_in_flight", None)

    # Clear context
    _clear_withdraw_context(context)

    return ConversationHandler.END


async def withdraw_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel withdrawal."""
    query = update.callback_query
    await query.answer()

    context.user_data.pop("withdraw_chain", None)
    context.user_data.pop("withdraw_token", None)
    context.user_data.pop("withdraw_amount", None)
    context.user_data.pop("withdraw_balance", None)

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
            CallbackQueryHandler(withdraw_execute, pattern="^withdraw_execute$"),
            CallbackQueryHandler(withdraw_cancel, pattern="^custodial_menu$"),
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
