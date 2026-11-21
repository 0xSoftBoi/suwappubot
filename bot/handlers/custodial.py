"""Custodial wallet handlers for deposits and withdrawals."""

import logging
import uuid
from decimal import Decimal
from typing import Optional
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ChatType
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User
from bot.models.custodial import TransactionType
from bot.services.hot_wallet import (
    hot_wallet_service,
    WithdrawalsPausedError,
    PostBroadcastAmbiguous,
    ComplianceBlockedError,
    quantize_to_decimals,
)
from bot.config.chains import get_chain_by_name
from bot.config.tokens import TOKENS, get_token_address
from bot.utils.formatters import format_amount
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


_MD2_SPECIAL = "_*[]()~`>#+-=|{}.!"


def _md2(value: str) -> str:
    """Escape a dynamic value for MarkdownV2."""
    return "".join("\\" + c if c in _MD2_SPECIAL else c for c in str(value))


def _is_private(update: Update) -> bool:
    """True only in a 1:1 chat with the user.

    A deposit screen must never render anywhere else. The address is per-user
    but a group message is shared, and these keyboards reach groups: /c takes no
    chat-type filter and `custodial_menu` buttons are handed out by group-capable
    surfaces (bot/handlers/tip.py, bot/handlers/start.py). So Alice opens the
    menu, Bob taps Deposit, the message is replaced in place with Bob's address,
    and Alice deposits to it — the watcher credits Bob, consistently enough that
    nothing alerts. Harmless before this address became per-user; a way to lose
    funds afterwards.
    """
    chat = update.effective_chat
    return bool(chat) and chat.type == ChatType.PRIVATE


_DM_ONLY = "Open a direct message with me to view your deposit address."


async def _user_deposit_address(user_id: int) -> Optional[str]:
    """This user's OWN custodial deposit address, minted on first view.

    Deliberately not ``get_deposit_wallet()``. That returns the shared omnibus,
    and ``deposit_watcher`` only watches addresses carrying ``deposit_user_id``
    (see ``list_user_deposit_wallets``). EVM has no memo field, so an inbound
    transfer to a shared address says nothing about who sent it — the address
    has to be the attribution. Showing the omnibus here meant deposits were
    never credited to anyone, while the copy promised they were automatic.

    Returns None rather than raising, so the wallet overview still renders its
    balances if minting hits KMS or the DB, and the deposit screens say so
    instead of falling back to an address nothing credits.
    """
    try:
        wallet = await hot_wallet_service.get_or_create_user_deposit_wallet(int(user_id), "evm")
        return wallet.address if wallet else None
    except Exception as exc:
        logger.error("Could not resolve deposit address for user %s: %s", user_id, exc)
        return None


def _accepted_lines() -> list:
    """What the watcher actually credits, one line per token set.

    Letters, commas and spaces only, so the same strings are safe under both
    ``Markdown`` and ``MarkdownV2`` without separate escaping.
    """
    from bot.services.deposit_watcher import creditable_matrix

    out = []
    for chains, tokens in creditable_matrix():
        names = []
        for chain in chains:
            info = get_chain_by_name(chain)
            names.append(info.display_name if info else chain.upper())
        out.append(f"{', '.join(tokens)} on {', '.join(names)}")
    return out


def _deposit_lines(deposit_address: Optional[str]) -> list:
    """The deposit block for the wallet overview (legacy ``Markdown``)."""
    if not deposit_address:
        return [
            "\n📥 *Your Deposit Address*",
            "_Could not load your deposit address. Try again shortly._",
        ]
    lines = [
        "\n📥 *Your Deposit Address*",
        f"`{deposit_address}`",
        "_Yours alone — deposits to it credit automatically._",
        "\n*Credited:*",
    ]
    from bot.services.deposit_watcher import min_deposit_summary

    lines += [f"  • {line}" for line in _accepted_lines()]
    floors = min_deposit_summary()
    if floors:
        lines.append(f"_Minimum {floors} per deposit — less is not credited._")
    lines.append("_Native coins (ETH, BNB, POL) and Solana are not credited yet._")
    return lines


@enforce_tos
async def custodial_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /custodial command - show custodial wallet overview."""
    if not _is_private(update):
        # effective_message, not message: a channel post arrives as
        # channel_post and leaves `update.message` None, so replying through it
        # would raise instead of refusing.
        await update.effective_message.reply_text(_DM_ONLY)
        return

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return

        user_id = db_user.id

    # Get custodial balances
    balances = hot_wallet_service.get_all_custodial_balances(user_id)

    deposit_address = await _user_deposit_address(user_id)

    lines = ["🏦 *Custodial Wallet*\n"]
    lines.append("Your balances managed by the bot:\n")

    if balances:
        total_usd = 0.0  # noqa: F841
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

    lines.extend(_deposit_lines(deposit_address))

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

    if not _is_private(update):
        await query.answer(_DM_ONLY, show_alert=True)
        return
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
    deposit_address = await _user_deposit_address(user_id)

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

    lines.extend(_deposit_lines(deposit_address))

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

    if not _is_private(update):
        await query.answer(_DM_ONLY, show_alert=True)
        return
    await query.answer()

    from bot.services.deposit_watcher import creditable_chains

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first\\.", parse_mode="MarkdownV2")
            return
        user_id = db_user.id

    deposit_address = await _user_deposit_address(user_id)

    lines = ["📥 *Deposit to Custodial Wallet*\n"]

    keyboard = []
    if deposit_address:
        lines.append("Select a network to view deposit address:\n")
        # Only chains the watcher scans. Solana is absent on purpose: there is
        # no SPL scan yet, so an address shown for it would never credit.
        row = []
        for chain in creditable_chains():
            info = get_chain_by_name(chain)
            emoji = info.logo_emoji if info else "💎"
            label = info.display_name if info else chain.title()
            # Bind the button to whoever opened it. Defence in depth behind the
            # DM guard: a keyboard stays tappable forever, so the handler
            # re-checks the owner rather than trusting the tap's context.
            row.append(
                InlineKeyboardButton(
                    f"{emoji} {label}", callback_data=f"deposit_qr_{chain}_{user.id}"
                )
            )
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
    else:
        lines.append("❌ _Could not load your deposit address\\. Try again shortly\\._")

    keyboard.append([InlineKeyboardButton("« Back", callback_data="custodial_menu")])

    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="MarkdownV2",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def deposit_qr_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show QR code for specific chain deposit."""
    query = update.callback_query

    if not _is_private(update):
        await query.answer(_DM_ONLY, show_alert=True)
        return

    from bot.services.deposit_watcher import (
        CONFIRMATIONS,
        creditable_tokens,
        is_chain_creditable,
        min_deposit_summary,
    )

    # callback_data is deposit_qr_{chain}_{owner telegram id}. No chain name
    # contains an underscore, so the owner is the last segment.
    payload = query.data.replace("deposit_qr_", "")
    chain, _, owner = payload.rpartition("_")
    if not chain or not owner.isdigit():
        # A button minted before owner binding. Re-open rather than guess whose
        # address to show.
        await query.answer()
        await query.edit_message_text(
            "Please open the deposit screen again\\.",
            parse_mode="MarkdownV2",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("📥 Deposit", callback_data="custodial_deposit")]]
            ),
        )
        return

    # Compare as strings. `str.isdigit()` is true for digit-valued characters
    # that `int()` rejects (e.g. "²"), and treats Arabic-Indic digits as equal
    # to ASCII ones, so neither parses nor authorizes reliably as an int.
    if not update.effective_user or owner != str(update.effective_user.id):
        await query.answer("This isn't your deposit screen.", show_alert=True)
        return
    await query.answer()

    back_only = InlineKeyboardMarkup(
        [[InlineKeyboardButton("« Back", callback_data="custodial_deposit")]]
    )

    # The watcher credits allowlisted ERC-20s on scanned EVM chains only. Refuse
    # anything else here too, not just in the menu: an older message's buttons
    # stay tappable, and a Solana address we cannot credit must never be shown.
    if not is_chain_creditable(chain):
        await query.edit_message_text(
            "❌ Deposits on that network are not supported yet\\.",
            parse_mode="MarkdownV2",
            reply_markup=back_only,
        )
        return

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first\\.", parse_mode="MarkdownV2")
            return
        user_id = db_user.id

    address = await _user_deposit_address(user_id)
    if not address:
        await query.edit_message_text(
            "❌ Could not load your deposit address\\. Try again shortly\\.",
            parse_mode="MarkdownV2",
            reply_markup=back_only,
        )
        return

    info = get_chain_by_name(chain)
    emoji = info.logo_emoji if info else "💎"
    display_name = info.display_name if info else chain.title()
    tokens = ", ".join(creditable_tokens(chain))
    confirmations = CONFIRMATIONS[chain]
    # min_deposit_summary is empty when no creditable token on this chain has a
    # floor, so the clause is built conditionally rather than interpolated —
    # otherwise the copy asserts "minimum ." and misstates the rule.
    floors = _md2(min_deposit_summary(chain))
    floor_clause = f", minimum {floors}" if floors else ""
    floor_bullet = f"• Minimum {floors} per deposit, less is not credited\n" if floors else ""

    # Generate QR code
    try:
        qr_bytes = generate_wallet_qr(address, chain=chain)
    except Exception:
        # Fallback: just show address without QR
        await query.edit_message_text(
            f"{emoji} *{display_name} Deposit*\n\n"
            f"`{address}`\n\n"
            f"Send *{tokens}* on *{display_name}* only{floor_clause}\\.\n"
            f"⚠️ Native coins and other tokens sent here are *not* credited\\.",
            parse_mode="MarkdownV2",
            reply_markup=back_only,
        )
        return

    # Delete old message and send new one with photo
    await query.message.delete()

    from io import BytesIO

    caption = (
        f"{emoji} *{display_name} Deposit*\n\n"
        f"`{address}`\n\n"
        f"Send *{tokens}* on *{display_name}* only\\.\n\n"
        f"• Scan QR or copy address above\n"
        f"• This address is yours alone, so deposits credit automatically\n"
        f"• Credited after {confirmations} confirmations\n"
        f"{floor_bullet}"
        f"⚠️ Native coins \\(ETH, BNB, POL\\) and other tokens sent here are "
        f"*not* credited"
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

    # Same rule as the deposit surfaces, and the same reason: 📤 Withdraw sits
    # on the same inline keyboard as 📥 Deposit, so every custodial menu already
    # posted into a group is a live entry point. Without this, Bob tapping it on
    # Alice's old group message publishes Bob's balances to the group and then
    # takes his destination address and amount in public.
    if not _is_private(update):
        await query.answer(_DM_ONLY, show_alert=True)
        return ConversationHandler.END
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

        except ComplianceBlockedError:
            # Sanctions screening happens before any node call — safe to
            # fully undo, same as WithdrawalsPausedError above. Distinct
            # message so the user sees a clear compliance block instead of a
            # generic "withdrawal failed".
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
                "🚫 This withdrawal cannot be completed due to compliance restrictions.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("« Back", callback_data="custodial_menu")]]
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
