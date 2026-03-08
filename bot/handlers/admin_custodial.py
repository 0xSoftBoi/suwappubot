"""Admin handlers for custodial wallet management."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.services.hot_wallet import hot_wallet_service
from bot.services.paymaster import paymaster_service
from bot.models.custodial import HotWallet, GasSponsorshipConfig
from bot.config.chains import CHAINS
from bot.utils.formatters import format_amount, format_usd
from database.db import get_session

# Admin IDs (set your Telegram ID here)
ADMIN_IDS = []  # e.g., [123456789]


def is_admin(user_id: int) -> bool:
    """Check if user is admin."""
    return user_id in ADMIN_IDS or len(ADMIN_IDS) == 0


# Conversation states
ENTER_PRIVATE_KEY = 0


async def admin_hot_wallets(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin command to manage hot wallets."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return
    
    with get_session() as session:
        wallets = session.query(HotWallet).filter(HotWallet.is_active == True).all()
        
        wallet_data = [
            {
                "id": w.id,
                "name": w.name,
                "chain_type": w.chain_type,
                "address": w.address,
                "is_deposit": w.is_deposit_wallet,
                "is_gas_payer": w.is_gas_payer,
            }
            for w in wallets
        ]
    
    lines = ["🔑 *Hot Wallet Management*\n"]
    
    if wallet_data:
        for w in wallet_data:
            role = []
            if w["is_deposit"]:
                role.append("📥 Deposit")
            if w["is_gas_payer"]:
                role.append("⛽ Gas Payer")
            
            lines.append(
                f"*{w['name']}* ({w['chain_type'].upper()})\n"
                f"`{w['address'][:20]}...`\n"
                f"Roles: {', '.join(role) if role else 'None'}\n"
            )
    else:
        lines.append("_No hot wallets configured._\n")
    
    keyboard = [
        [
            InlineKeyboardButton("➕ Create EVM Wallet", callback_data="admin_create_evm"),
            InlineKeyboardButton("➕ Create SOL Wallet", callback_data="admin_create_sol"),
        ],
        [InlineKeyboardButton("📥 Import Wallet", callback_data="admin_import_wallet")],
        [InlineKeyboardButton("⛽ Gas Config", callback_data="admin_gas_config")],
    ]
    
    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def create_evm_wallet(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Create a new EVM hot wallet."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    try:
        wallet = hot_wallet_service.create_hot_wallet(
            name="EVM Hot Wallet",
            chain_type="evm",
            is_deposit_wallet=True,
            is_gas_payer=True,
        )
        
        await query.edit_message_text(
            f"✅ *EVM Hot Wallet Created\\!*\n\n"
            f"Address:\n`{wallet.address}`\n\n"
            f"⚠️ *Important:* Fund this wallet with ETH/native tokens for gas\\!",
            parse_mode="MarkdownV2",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="admin_wallets")]
            ])
        )
    except Exception as e:
        await query.edit_message_text(f"❌ Error: {str(e)}")


async def create_sol_wallet(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Create a new SOL hot wallet."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    try:
        wallet = hot_wallet_service.create_hot_wallet(
            name="SOL Hot Wallet",
            chain_type="solana",
            is_deposit_wallet=True,
            is_gas_payer=True,
        )
        
        await query.edit_message_text(
            f"✅ *SOL Hot Wallet Created\\!*\n\n"
            f"Address:\n`{wallet.address}`\n\n"
            f"⚠️ *Important:* Fund this wallet with SOL for transaction fees\\!",
            parse_mode="MarkdownV2",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("« Back", callback_data="admin_wallets")]
            ])
        )
    except Exception as e:
        await query.edit_message_text(f"❌ Error: {str(e)}")


async def gas_config(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show gas sponsorship configuration."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    lines = ["⛽ *Gas Sponsorship Config*\n"]
    
    # Get config for each chain
    for chain_name, chain in CHAINS.items():
        config = paymaster_service.get_sponsorship_config(chain_name)
        
        if config:
            status = "✅ Enabled" if config.is_enabled else "❌ Disabled"
            lines.append(
                f"*{chain.display_name}*: {status}\n"
                f"  Max per tx: {format_usd(config.max_gas_per_tx_usd)}\n"
                f"  Daily limit: {format_usd(config.max_gas_per_user_daily_usd)}\n"
                f"  Total sponsored: {format_usd(config.total_sponsored_usd)}\n"
            )
        else:
            lines.append(f"*{chain.display_name}*: Not configured\n")
    
    keyboard = []
    for chain_name in ["ethereum", "arbitrum", "optimism", "base", "polygon", "bsc"]:
        keyboard.append([
            InlineKeyboardButton(
                f"⚙️ Configure {chain_name.title()}",
                callback_data=f"admin_gas_{chain_name}"
            )
        ])
    
    keyboard.append([InlineKeyboardButton("« Back", callback_data="admin_wallets")])
    
    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def configure_gas_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Configure gas sponsorship for a chain."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    chain = query.data.replace("admin_gas_", "")
    
    # Enable sponsorship with default settings
    config = paymaster_service.set_sponsorship_config(
        chain=chain,
        is_enabled=True,
        max_gas_per_tx_usd=5.0,
        max_gas_per_user_daily_usd=20.0,
    )
    
    await query.edit_message_text(
        f"✅ Gas sponsorship enabled for {chain.title()}\\!\n\n"
        f"• Max per transaction: $5\\.00\n"
        f"• Daily limit per user: $20\\.00\n",
        parse_mode="MarkdownV2",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⛽ Gas Config", callback_data="admin_gas_config")],
            [InlineKeyboardButton("« Back", callback_data="admin_wallets")]
        ])
    )


async def admin_wallets_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Callback for admin wallets menu."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    with get_session() as session:
        wallets = session.query(HotWallet).filter(HotWallet.is_active == True).all()
        wallet_data = [
            {
                "name": w.name,
                "chain_type": w.chain_type,
                "address": w.address,
                "is_deposit": w.is_deposit_wallet,
                "is_gas_payer": w.is_gas_payer,
            }
            for w in wallets
        ]
    
    lines = ["🔑 *Hot Wallet Management*\n"]
    
    if wallet_data:
        for w in wallet_data:
            role = []
            if w["is_deposit"]:
                role.append("📥")
            if w["is_gas_payer"]:
                role.append("⛽")
            
            lines.append(
                f"*{w['name']}* ({w['chain_type'].upper()}) {' '.join(role)}\n"
                f"`{w['address'][:20]}...`\n"
            )
    else:
        lines.append("_No hot wallets configured._\n")
    
    keyboard = [
        [
            InlineKeyboardButton("➕ Create EVM", callback_data="admin_create_evm"),
            InlineKeyboardButton("➕ Create SOL", callback_data="admin_create_sol"),
        ],
        [InlineKeyboardButton("⛽ Gas Config", callback_data="admin_gas_config")],
    ]
    
    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Create handlers
admin_hot_wallets_handler = CommandHandler("hw", admin_hot_wallets)

