"""Quick swap command for power users."""

import re
import secrets
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler

from bot.models.user import User, Wallet
from bot.services.wallet import WalletService
from bot.services.swap_engine import SwapEngine
from bot.config.tokens import get_token_by_symbol
from bot.config.chains import get_chain_by_name
from bot.utils.validators import validate_amount
from bot.utils.formatters import format_amount, format_usd
from bot.utils.rate_limiter import swap_limiter, enforce_rate_limit_for_update
from database.db import get_session
from bot.utils.tos_utils import enforce_tos


wallet_service = WalletService()
swap_engine = SwapEngine()


@enforce_tos
async def quickswap_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle /s shortcut command.
    
    Usage: /s 100 USDC ETH
           /s 50 USDC polygon ETH ethereum
    """
    user = update.effective_user
    args = context.args

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return
    
    if not args or len(args) < 3:
        await update.message.reply_text(
            "🔄 *Quick Swap*\n\n"
            "Usage: `/s <amount> <from_token> <to_token>`\n\n"
            "Examples:\n"
            "• `/s 100 USDC ETH` - Swap 100 USDC to ETH\n"
            "• `/s 50 ETH USDC` - Swap 50 ETH to USDC\n\n"
            "For full swap wizard, tap the button below.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Open Swap Wizard", callback_data="swap_start")]
            ])
        )
        return
    
    # Parse arguments
    try:
        amount_str = args[0]
        from_token = args[1].upper()
        to_token = args[2].upper()
        
        # Optional chain specification
        from_chain = args[3].lower() if len(args) > 3 else None
        to_chain = args[4].lower() if len(args) > 4 else None
    except Exception:
        await update.message.reply_text("❌ Invalid command format. Use `/s 100 USDC ETH`", parse_mode="Markdown")
        return
    
    # Validate amount
    amount = validate_amount(amount_str)
    if amount is None:
        await update.message.reply_text("❌ Invalid amount.")
        return
    
    # Get user and wallet
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        
        wallet = session.query(Wallet).filter(
            Wallet.user_id == db_user.id,
            Wallet.is_default == True,
            Wallet.is_active == True,
        ).first()
        
        if not wallet:
            await update.message.reply_text(
                "❌ No default wallet found. Add one first.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")]
                ])
            )
            return
        
        wallet_info = {
            "id": wallet.id,
            "address": wallet.address,
            "chain_type": wallet.chain_type,
            "user_id": db_user.id,
        }
    
    # Validate tokens
    from_token_info = get_token_by_symbol(from_token)
    to_token_info = get_token_by_symbol(to_token)
    
    if not from_token_info:
        await update.message.reply_text(f"❌ Unknown token: {from_token}")
        return
    
    if not to_token_info:
        await update.message.reply_text(f"❌ Unknown token: {to_token}")
        return
    
    # Determine chains if not specified
    if not from_chain:
        # Default to ethereum or first available chain
        if "ethereum" in from_token_info.addresses:
            from_chain = "ethereum"
        else:
            from_chain = list(from_token_info.addresses.keys())[0]
    
    if not to_chain:
        if "ethereum" in to_token_info.addresses:
            to_chain = "ethereum"
        else:
            to_chain = list(to_token_info.addresses.keys())[0]
    
    # Store swap data for confirmation
    context.user_data["quickswap"] = {
        "from_chain": from_chain,
        "from_token": from_token,
        "to_chain": to_chain,
        "to_token": to_token,
        "amount": amount,
        "wallet_id": wallet_info["id"],
        "user_id": wallet_info["user_id"],
        "attempt_id": secrets.token_urlsafe(16),
    }
    
    loading_msg = await update.message.reply_text("🔄 Getting quote...")
    
    try:
        # Get quote
        quote = await swap_engine.get_quote(
            from_chain=from_chain,
            from_token=from_token,
            to_chain=to_chain,
            to_token=to_token,
            amount=amount,
            from_address=wallet_info["address"],
        )
        
        if not quote:
            await loading_msg.edit_text("❌ No route found for this swap.")
            return
        
        # Format quote - SwapQuote is a dataclass with attributes
        estimated_output = quote.to_amount_human
        rate = quote.exchange_rate if quote.exchange_rate else (estimated_output / amount if amount > 0 else 0)
        gas_fee = quote.gas_cost_usd
        bridge_fee = quote.fee_cost_usd
        total_fee = quote.total_cost_usd
        
        text = (
            f"🔄 *Quick Swap Quote*\n\n"
            f"📤 *From:* {format_amount(amount, symbol=from_token)} ({from_chain})\n"
            f"📥 *To:* ~{format_amount(estimated_output, symbol=to_token)} ({to_chain})\n\n"
            f"💱 *Rate:* 1 {from_token} ≈ {rate:.6f} {to_token}\n"
            f"⛽ *Gas:* {format_usd(gas_fee)}\n"
        )
        
        if bridge_fee > 0:
            text += f"🌉 *Bridge:* {format_usd(bridge_fee)}\n"
        
        text += f"\n💵 *Total Fees:* {format_usd(total_fee)}"
        
        keyboard = [
            [
                InlineKeyboardButton("✅ Confirm Swap", callback_data="quickswap_confirm"),
                InlineKeyboardButton("❌ Cancel", callback_data="main_menu"),
            ]
        ]
        
        # Store quote for confirmation
        context.user_data["quickswap"]["quote"] = quote
        
        await loading_msg.edit_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        
    except Exception as e:
        await loading_msg.edit_text(f"❌ Error getting quote: {str(e)}")


@enforce_tos
async def quickswap_confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Confirm and execute quick swap."""
    query = update.callback_query
    await query.answer()
    
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return
    
    swap_data = context.user_data.get("quickswap")
    if not swap_data:
        await query.edit_message_text("❌ Swap session expired. Please start again.")
        return
    
    await query.edit_message_text("⏳ Executing swap...")
    
    try:
        # Note: SwapEngine returns a SwapTransaction (not a dict)
        swap_tx = await swap_engine.execute_swap(
            quote=swap_data["quote"],
            wallet_id=swap_data["wallet_id"],
            user_id=swap_data["user_id"],
            idempotency_key=f"tg_quick:{swap_data['user_id']}:{swap_data['wallet_id']}:{swap_data.get('attempt_id','no_attempt')}",
        )

        if swap_tx and swap_tx.tx_hash:
            await query.edit_message_text(
                f"✅ *Swap Submitted!*\n\n"
                f"Transaction: `{swap_tx.tx_hash[:20]}...`\n\n"
                f"Check status with /hx",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("📜 History", callback_data="history")],
                    [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                ])
            )
        else:
            await query.edit_message_text(
                "❌ Swap submitted but missing transaction hash. Please check /hx in a moment.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("📜 History", callback_data="history")],
                    [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                ])
            )
    except Exception as e:
        await query.edit_message_text(f"❌ Error: {str(e)}")
    finally:
        context.user_data.pop("quickswap", None)


# Create handlers
quickswap_handler = CommandHandler("s", quickswap_command)

