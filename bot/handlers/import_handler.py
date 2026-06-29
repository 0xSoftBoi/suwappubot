"""BullX Neo migration handler — /import command."""

import re
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    ConversationHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)

from bot.models.user import User, Wallet
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
IMPORT_ADDRESSES, IMPORT_CONFIRM = range(2)

# Regex patterns
EVM_RE = re.compile(r"\b(0x[0-9a-fA-F]{40})\b")
# Base58 characters only, 32-44 chars (Solana public key)
SOL_RE = re.compile(r"\b([1-9A-HJ-NP-Za-km-z]{32,44})\b")

WELCOME_TEXT = (
    "👋 *BullX Neo Migration*\n\n"
    "BullX Neo has shut down. Suwappu supports the same chains — EVM and Solana — "
    "with *1% fees* (vs BullX's 1-2%) and no hidden costs.\n\n"
    "Paste your wallet addresses (one or more, any format). I'll add them as "
    "*watch wallets* so you can track balances and portfolio without importing a private key.\n\n"
    "You can import a private key later from /wallet if you want to trade.\n\n"
    "Send your addresses, or /cancel to exit."
)


async def import_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Entry point for /import."""
    await update.message.reply_text(WELCOME_TEXT, parse_mode="Markdown")
    return IMPORT_ADDRESSES


async def import_addresses(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Parse addresses from user message and ask for confirmation."""
    text = update.message.text or ""

    evm_addresses = list(dict.fromkeys(EVM_RE.findall(text)))  # dedupe, preserve order
    # Filter out anything that looks like an EVM address from SOL matches
    sol_candidates = SOL_RE.findall(text)
    sol_addresses = list(dict.fromkeys(a for a in sol_candidates if not a.lower().startswith("0x")))

    if not evm_addresses and not sol_addresses:
        await update.message.reply_text(
            "No valid wallet addresses found. Please paste EVM (0x...) or Solana addresses, "
            "or /cancel to exit."
        )
        return IMPORT_ADDRESSES

    context.user_data["import_evm"] = evm_addresses
    context.user_data["import_sol"] = sol_addresses

    lines = []
    for addr in evm_addresses:
        lines.append(f"• EVM: `{addr}`")
    for addr in sol_addresses:
        lines.append(f"• Solana: `{addr}`")

    count = len(evm_addresses) + len(sol_addresses)
    summary = "\n".join(lines)

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Yes, import", callback_data="import_confirm"),
                InlineKeyboardButton("Cancel", callback_data="import_cancel"),
            ]
        ]
    )

    await update.message.reply_text(
        f"Found *{count} wallet(s)*:\n\n{summary}\n\n" "Add these as watch wallets?",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )
    return IMPORT_CONFIRM


async def import_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle confirmation — add wallets to DB."""
    query = update.callback_query
    await query.answer()

    if query.data == "import_cancel":
        await query.edit_message_text("Cancelled. Use /wallet to manage wallets.")
        return ConversationHandler.END

    tg_user = update.effective_user
    evm_addresses: list[str] = context.user_data.get("import_evm", [])
    sol_addresses: list[str] = context.user_data.get("import_sol", [])

    added = 0
    skipped = 0

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        if not db_user:
            await query.edit_message_text("Please use /start first to set up your account.")
            return ConversationHandler.END

        existing_addresses = {
            w.address.lower()
            for w in session.query(Wallet).filter(
                Wallet.user_id == db_user.id, Wallet.is_active == True
            )
        }

        for i, addr in enumerate(evm_addresses):
            if addr.lower() in existing_addresses:
                skipped += 1
                continue
            wallet = Wallet(
                user_id=db_user.id,
                name=f"BullX Import {i + 1}",
                address=addr,
                encrypted_private_key=None,
                chain_type="evm",
                wallet_provider="watch",
                is_active=True,
                is_default=(added == 0 and not existing_addresses),
            )
            session.add(wallet)
            added += 1

        sol_offset = len(evm_addresses)
        for i, addr in enumerate(sol_addresses):
            if addr.lower() in existing_addresses:
                skipped += 1
                continue
            wallet = Wallet(
                user_id=db_user.id,
                name=f"BullX SOL Import {i + 1}",
                address=addr,
                encrypted_private_key=None,
                chain_type="solana",
                wallet_provider="watch",
                is_active=True,
                is_default=(added == 0 and not existing_addresses),
            )
            session.add(wallet)
            added += 1

        session.commit()

    parts = [f"Done! Added *{added} watch wallet(s)*."]
    if skipped:
        parts.append(f"{skipped} already existed and were skipped.")
    parts.append(
        "\n*Fee comparison:*\n"
        "• BullX Neo: 1-2%\n"
        "• Suwappu: *1%* — same chains, lower cost\n\n"
        "Use /wallet to add a private key and start trading, or /b to check balances."
    )

    await query.edit_message_text("\n".join(parts), parse_mode="Markdown")
    return ConversationHandler.END


async def import_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /cancel command."""
    await update.message.reply_text("Import cancelled. Use /wallet to manage wallets.")
    return ConversationHandler.END


import_conversation_handler = ConversationHandler(
    entry_points=[CommandHandler("import", import_command)],
    states={
        IMPORT_ADDRESSES: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, import_addresses),
        ],
        IMPORT_CONFIRM: [
            CallbackQueryHandler(import_confirm, pattern="^import_(confirm|cancel)$"),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", import_cancel),
        CallbackQueryHandler(import_confirm, pattern="^import_cancel$"),
    ],
)
