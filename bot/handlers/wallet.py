"""Wallet management handlers."""

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
from bot.services.wallet import WalletService
from bot.utils.validators import validate_private_key
from bot.utils.formatters import format_address_link
from bot.utils.qr_code import generate_wallet_qr
from bot.utils.telegram_safe import safe_md
from bot.utils.templates import copy_button
from bot.services.error_guidance import user_facing_error
from bot.i18n import get_text, get_user_lang
from database.db import get_session
import logging

logger = logging.getLogger(__name__)

# Conversation states
WALLET_TYPE, WALLET_KEY, WALLET_NAME = range(3)

wallet_service = WalletService()


async def wallet_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /wallet command."""
    await show_wallet_menu(update, context, is_callback=False)


async def wallet_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle wallet menu callback."""
    query = update.callback_query
    await query.answer()

    if not query.message:
        return

    # If coming from a photo message (QR code), delete it and send new message
    if query.message.photo:
        await query.message.delete()
        # Send new message instead of editing
        user = update.effective_user

        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()

            if not db_user:
                await context.bot.send_message(
                    chat_id=query.message.chat_id, text="❌ Please use /start first."
                )
                return

            wallets = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == db_user.id,
                    Wallet.is_active == True,
                )
                .all()
            )

            if not wallets:
                text = "👛 *Wallet Management*\n\nYou don't have any wallets yet."
                keyboard = [
                    [
                        InlineKeyboardButton("➕ EVM", callback_data="wallet_create_evm"),
                        InlineKeyboardButton("➕ Solana", callback_data="wallet_create_solana"),
                        InlineKeyboardButton("➕ TRON", callback_data="wallet_create_tron"),
                    ],
                    [
                        InlineKeyboardButton("📥 Import EVM", callback_data="wallet_import_evm"),
                        InlineKeyboardButton("📥 Import SOL", callback_data="wallet_import_solana"),
                        InlineKeyboardButton("📥 Import TRX", callback_data="wallet_import_tron"),
                    ],
                    [
                        InlineKeyboardButton("➕ Starknet", callback_data="wallet_create_starknet"),
                        InlineKeyboardButton(
                            "📥 Import STRK", callback_data="wallet_import_starknet"
                        ),
                    ],
                    [InlineKeyboardButton("« Back", callback_data="main_menu")],
                ]
            else:
                lines = ["👛 *Your Wallets*\n"]
                lines.append("Tap a wallet to view its QR code:\n")

                keyboard = []

                for w in wallets:
                    chain_emoji = {"evm": "🔷", "solana": "🟢", "tron": "💎", "starknet": "🟣"}.get(
                        w.chain_type, "🔷"
                    )
                    default_mark = " ⭐" if w.is_default else ""
                    lines.append(f"{chain_emoji} *{safe_md(w.name)}*{default_mark}")
                    lines.append(f"   `{w.address}`")
                    if w.chain_type == "starknet":
                        lines.append(f"   [Voyager ↗](https://voyager.online/contract/{w.address})")
                    lines.append("")

                    keyboard.append(
                        [
                            InlineKeyboardButton(
                                f"{chain_emoji} {w.name} QR", callback_data=f"wallet_qr_{w.id}"
                            )
                        ]
                    )

                text = "\n".join(lines)

                keyboard.extend(
                    [
                        [
                            InlineKeyboardButton("➕ EVM", callback_data="wallet_create_evm"),
                            InlineKeyboardButton("➕ Solana", callback_data="wallet_create_solana"),
                            InlineKeyboardButton("➕ TRON", callback_data="wallet_create_tron"),
                        ],
                        [
                            InlineKeyboardButton(
                                "📥 Import EVM", callback_data="wallet_import_evm"
                            ),
                            InlineKeyboardButton(
                                "📥 Import SOL", callback_data="wallet_import_solana"
                            ),
                            InlineKeyboardButton(
                                "📥 Import TRX", callback_data="wallet_import_tron"
                            ),
                        ],
                        [
                            InlineKeyboardButton(
                                "➕ Starknet", callback_data="wallet_create_starknet"
                            ),
                            InlineKeyboardButton(
                                "📥 Import STRK", callback_data="wallet_import_starknet"
                            ),
                        ],
                        [InlineKeyboardButton("« Back", callback_data="main_menu")],
                    ]
                )

        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return

    await show_wallet_menu(update, context, is_callback=True)


async def show_wallet_menu(
    update: Update, context: ContextTypes.DEFAULT_TYPE, is_callback: bool = False
) -> None:
    """Show wallet management menu."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            text = "❌ Please use /start first."
            if is_callback:
                await update.callback_query.edit_message_text(text)
            else:
                await update.message.reply_text(text)
            return

        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_active == True,
            )
            .all()
        )

        if not wallets:
            text = "👛 *Wallet Management*\n\nYou don't have any wallets yet."
            keyboard = [
                [
                    InlineKeyboardButton("➕ EVM", callback_data="wallet_create_evm"),
                    InlineKeyboardButton("➕ Solana", callback_data="wallet_create_solana"),
                    InlineKeyboardButton("➕ TRON", callback_data="wallet_create_tron"),
                ],
                [
                    InlineKeyboardButton("📥 Import EVM", callback_data="wallet_import_evm"),
                    InlineKeyboardButton("📥 Import SOL", callback_data="wallet_import_solana"),
                    InlineKeyboardButton("📥 Import TRX", callback_data="wallet_import_tron"),
                ],
                [
                    InlineKeyboardButton("➕ Starknet", callback_data="wallet_create_starknet"),
                    InlineKeyboardButton("📥 Import STRK", callback_data="wallet_import_starknet"),
                ],
                [InlineKeyboardButton("« Back", callback_data="main_menu")],
            ]
        else:
            lines = ["👛 *Your Wallets*\n"]
            lines.append("Tap a wallet to view its QR code:\n")

            keyboard = []

            for w in wallets:
                chain_emoji = {"evm": "🔷", "solana": "🟢", "tron": "💎", "starknet": "🟣"}.get(
                    w.chain_type, "🔷"
                )
                default_mark = " ⭐" if w.is_default else ""
                lines.append(f"{chain_emoji} *{safe_md(w.name)}*{default_mark}")
                lines.append(f"   `{w.address}`")
                if w.chain_type == "starknet":
                    lines.append(f"   [Voyager ↗](https://voyager.online/contract/{w.address})")
                lines.append("")

                # Add button for each wallet
                keyboard.append(
                    [
                        InlineKeyboardButton(
                            f"{chain_emoji} {w.name} QR", callback_data=f"wallet_qr_{w.id}"
                        )
                    ]
                )

            text = "\n".join(lines)

            keyboard.extend(
                [
                    [
                        InlineKeyboardButton("➕ EVM", callback_data="wallet_create_evm"),
                        InlineKeyboardButton("➕ Solana", callback_data="wallet_create_solana"),
                        InlineKeyboardButton("➕ TRON", callback_data="wallet_create_tron"),
                    ],
                    [
                        InlineKeyboardButton("📥 Import EVM", callback_data="wallet_import_evm"),
                        InlineKeyboardButton("📥 Import SOL", callback_data="wallet_import_solana"),
                        InlineKeyboardButton("📥 Import TRX", callback_data="wallet_import_tron"),
                    ],
                    [
                        InlineKeyboardButton("➕ Starknet", callback_data="wallet_create_starknet"),
                        InlineKeyboardButton(
                            "📥 Import STRK", callback_data="wallet_import_starknet"
                        ),
                    ],
                    [InlineKeyboardButton("« Back", callback_data="main_menu")],
                ]
            )

    reply_markup = InlineKeyboardMarkup(keyboard)

    if is_callback:
        await update.callback_query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )
    else:
        await update.message.reply_text(
            text,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )


async def wallet_create_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle wallet creation."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    chain_type = query.data.rsplit("_", 1)[-1]
    if chain_type not in {"evm", "solana", "tron", "starknet"}:
        chain_type = "evm"

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return

        user_id = db_user.id

        # Check existing wallets
        existing = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == chain_type,
                Wallet.is_active == True,
            )
            .count()
        )
        is_default = existing == 0

    # Create wallet (routes to Turnkey if configured, otherwise local)
    chain_emoji = {"evm": "🔷", "solana": "🟢", "tron": "💎", "starknet": "🟣"}.get(
        chain_type, "🔷"
    )
    chain_name = {"evm": "EVM", "solana": "SOL", "tron": "TRON", "starknet": "Starknet"}.get(
        chain_type, "EVM"
    )

    try:
        wallet = await wallet_service.create_wallet(
            user_id=user_id,
            name=f"{chain_name} Wallet",
            chain_type=chain_type,
        )
        address = wallet.address

        # Set as default if first wallet of this chain type
        if is_default:
            with get_session() as session:
                w = session.query(Wallet).filter(Wallet.id == wallet.id).first()
                if w:
                    w.is_default = True
                    session.flush()
    except Exception as e:
        logger.error(f"Wallet creation failed: {e}", exc_info=True)
        await query.edit_message_text(user_facing_error(e, prefix="❌ Wallet creation failed: "))
        return

    # Show wallet created WITHOUT the private key in chat
    lang = get_user_lang(update.effective_user)
    provider_note = (
        "🔐 Your wallet is secured by Turnkey."
        if wallet.is_turnkey_wallet
        else "🔐 Your private key is encrypted and stored securely."
    )
    text = get_text(
        "wallet_created",
        lang,
        chain_name=chain_name,
        chain_emoji=chain_emoji,
        address=address,
        provider_note=provider_note,
    )
    if chain_type == "starknet":
        text += (
            "\n\nℹ️ Account deploys automatically on first transaction "
            "(gas can be paid in the token you swap)."
        )

    keyboard = [
        [InlineKeyboardButton("👛 View Wallets", callback_data="wallet_menu")],
        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
    ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def wallet_qr_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show QR code for a specific wallet."""
    query = update.callback_query
    await query.answer()

    # Extract wallet ID
    try:
        wallet_id = int(query.data.replace("wallet_qr_", ""))
    except ValueError:
        await query.edit_message_text("❌ Invalid wallet.")
        return

    tg_user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        if not db_user:
            await query.edit_message_text("❌ User not found.")
            return

        wallet = (
            session.query(Wallet)
            .filter(
                Wallet.id == wallet_id,
                Wallet.user_id == db_user.id,
            )
            .first()
        )

        if not wallet:
            await query.edit_message_text("❌ Wallet not found.")
            return

        address = wallet.address
        chain_type = wallet.chain_type
        wallet_name = wallet.name

    # Determine chain for QR styling
    chain = {"evm": "ethereum", "solana": "solana", "tron": "tron", "starknet": "starknet"}.get(
        chain_type, "ethereum"
    )
    chain_emoji = {"evm": "🔷", "solana": "🟢", "tron": "💎", "starknet": "🟣"}.get(
        chain_type, "🔷"
    )

    # Generate QR code
    try:
        qr_bytes = generate_wallet_qr(address, chain=chain)
    except Exception:
        # Fallback without QR
        fallback_rows = []
        copy_btn = copy_button("📋 Copy Address", address)
        if copy_btn:
            fallback_rows.append([copy_btn])
        fallback_rows.append([InlineKeyboardButton("« Back", callback_data="wallet_menu")])
        await query.edit_message_text(
            f"{chain_emoji} *{safe_md(wallet_name)}*\n\n"
            f"Address:\n`{address}`\n\n"
            f"Tap address to copy.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(fallback_rows),
        )
        return

    # Delete old message and send photo
    await query.message.delete()

    from io import BytesIO

    caption = (
        f"{chain_emoji} *{safe_md(wallet_name)}*\n\n"
        f"Address:\n`{address}`\n\n"
        f"• Scan QR to receive tokens\n"
        f"• Tap address above to copy"
    )

    keyboard = []
    copy_btn = copy_button("📋 Copy Address", address)
    if copy_btn:
        keyboard.append([copy_btn])
    keyboard.extend(
        [
            [InlineKeyboardButton("👛 Back to Wallets", callback_data="wallet_menu")],
            [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
        ]
    )

    await context.bot.send_photo(
        chat_id=query.message.chat_id,
        photo=BytesIO(qr_bytes),
        caption=caption,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def wallet_import_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start wallet import conversation."""
    query = update.callback_query
    await query.answer()

    chain_type = query.data.rsplit("_", 1)[-1]
    if chain_type not in {"evm", "solana", "tron", "starknet"}:
        chain_type = "evm"
    context.user_data["import_chain_type"] = chain_type

    chain_name = {"evm": "EVM", "solana": "SOL", "tron": "TRON", "starknet": "Starknet"}.get(
        chain_type, "EVM"
    )
    key_hint = {
        "evm": "• EVM: 64 hex characters (with or without 0x prefix)",
        "solana": "• Solana: Base58 encoded key or JSON array",
        "tron": "• TRON: 64 hex characters (same format as EVM)",
        "starknet": "• Starknet: hex private key (with or without 0x prefix)",
    }.get(chain_type, "")

    text = f"""
📥 *Import {chain_name} Wallet*

Please send your private key:

{key_hint}

⚠️ Your key will be encrypted and stored securely.
Send /cancel to abort.
"""

    await query.edit_message_text(text, parse_mode="Markdown")
    return WALLET_KEY


async def wallet_import_key(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle private key input for import."""
    private_key = update.message.text.strip()
    chain_type = context.user_data.get("import_chain_type", "evm")

    # Delete the message containing the private key for security
    try:
        await update.message.delete()
    except Exception:
        pass

    # Validate private key
    if not validate_private_key(private_key, chain_type):
        await update.message.reply_text(
            "❌ Invalid private key format. Please try again or /cancel.",
        )
        return WALLET_KEY

    # Get address from private key
    try:
        if chain_type == "evm":
            address = wallet_service.import_evm_wallet(private_key)
        elif chain_type == "tron":
            address = wallet_service.import_tron_wallet(private_key)
        elif chain_type == "starknet":
            address = wallet_service.import_starknet_wallet(private_key)
        else:
            address = wallet_service.import_solana_wallet(private_key)
    except Exception as e:
        # Never interpolate the raw private_key into logs or chat. All our own
        # rejections are a curated ValueError ("Invalid {CHAIN} private key");
        # log only the exception TYPE for anything unexpected from the
        # underlying key-derivation libraries (Account.from_key / Keypair /
        # TronPrivateKey), matching the tempo_keychain grant/revoke precedent.
        logger.error(
            "Wallet import failed (chain_type=%s): %s",
            chain_type,
            type(e).__name__,
            exc_info=True,
        )
        await update.message.reply_text(
            user_facing_error(e, prefix="❌ Error importing wallet: ")
            + "\n\nPlease try again or /cancel.",
        )
        return WALLET_KEY

    context.user_data["import_address"] = address
    context.user_data["import_private_key"] = private_key

    await update.message.reply_text(
        f"✅ Valid key!\n\nAddress: `{address}`\n\nEnter a name for this wallet (or /skip for default):",
        parse_mode="Markdown",
    )
    return WALLET_NAME


async def wallet_import_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle wallet name input."""
    user = update.effective_user
    name = update.message.text.strip()

    if name.startswith("/"):
        name = None

    chain_type = context.user_data.get("import_chain_type", "evm")
    address = context.user_data.get("import_address")
    private_key = context.user_data.get("import_private_key")

    if not address or not private_key:
        await update.message.reply_text("❌ Session expired. Please try again with /w")
        return ConversationHandler.END

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return ConversationHandler.END

        user_id = db_user.id

        # Check if wallet already exists
        existing = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.address == address,
            )
            .first()
        )

        if existing:
            await update.message.reply_text(
                "⚠️ This wallet is already imported!",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("👛 View Wallets", callback_data="wallet_menu")]]
                ),
            )
            return ConversationHandler.END

        # Check for default
        existing_count = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == user_id,
                Wallet.chain_type == chain_type,
                Wallet.is_active == True,
            )
            .count()
        )
        is_default = existing_count == 0

    # Save wallet
    default_names = {
        "evm": "EVM",
        "solana": "Solana",
        "tron": "TRON",
        "starknet": "Starknet",
    }
    wallet_name = name if name else f"{default_names.get(chain_type, 'EVM')} Wallet"

    wallet_service.save_wallet(
        user_id=user_id,
        address=address,
        private_key=private_key,
        chain_type=chain_type,
        name=wallet_name,
        is_default=is_default,
    )

    # Clear sensitive data
    context.user_data.pop("import_private_key", None)
    context.user_data.pop("import_address", None)
    context.user_data.pop("import_chain_type", None)

    keyboard = [
        [InlineKeyboardButton("👛 View Wallets", callback_data="wallet_menu")],
        [InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start")],
    ]

    await update.message.reply_text(
        f"✅ *Wallet Imported Successfully!*\n\n"
        f"Name: {safe_md(wallet_name)}\n"
        f"Address: `{address[:8]}...{address[-6:]}`",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return ConversationHandler.END


async def wallet_import_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel wallet import."""
    context.user_data.pop("import_private_key", None)
    context.user_data.pop("import_address", None)
    context.user_data.pop("import_chain_type", None)

    await update.message.reply_text(
        "❌ Wallet import cancelled.",
        reply_markup=InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu")],
                [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
            ]
        ),
    )
    return ConversationHandler.END


# Create conversation handler for wallet import
wallet_import_handler = ConversationHandler(
    name="wallet_import",
    persistent=True,
    entry_points=[
        CallbackQueryHandler(wallet_import_start, pattern="^wallet_import_"),
    ],
    states={
        WALLET_KEY: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, wallet_import_key),
        ],
        WALLET_NAME: [
            MessageHandler(filters.TEXT, wallet_import_name),
        ],
    },
    fallbacks=[
        CommandHandler("cancel", wallet_import_cancel),
        CommandHandler("skip", wallet_import_name),
    ],
    per_message=False,
    per_chat=True,
)

# Create handlers
# Aliases: CommandHandler accepts a list of command names (verified against the
# installed python-telegram-bot 22.5). Without "wallet" registered, the 12
# user-facing error messages that tell users to run /wallet as the recovery
# step (fund.py, predict.py, snipe.py, import_handler.py, swap.py) were dead ends.
wallet_handler = CommandHandler(["w", "wallet"], wallet_command)
