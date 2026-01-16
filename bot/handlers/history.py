"""Transaction history handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler
from datetime import datetime

from bot.models.user import User
from bot.models.swap import SwapTransaction, SwapStatus
from bot.utils.formatters import format_amount, format_usd, format_tx_link, format_chain_name
from database.db import get_session
from bot.utils.tos_utils import enforce_tos


@enforce_tos
async def history_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /history command - show recent swap history."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if not db_user:
            await update.message.reply_text(
                "❌ Please use /start first to set up your account."
            )
            return
        
        # Get last 10 swaps
        swaps = session.query(SwapTransaction).filter(
            SwapTransaction.user_id == db_user.id
        ).order_by(SwapTransaction.created_at.desc()).limit(10).all()
        
        if not swaps:
            await update.message.reply_text(
                "📜 *Transaction History*\n\n"
                "No swaps yet. Use /s to make your first swap!",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start")]
                ])
            )
            return
        
        # Build history message
        lines = ["📜 *Transaction History*\n"]
        
        for swap in swaps:
            status_emoji = _get_status_emoji(swap.status)
            date_str = swap.created_at.strftime("%m/%d %H:%M")
            
            from_display = f"{swap.from_token}"
            to_display = f"{swap.to_token}"
            
            # Amount
            try:
                from_amount = float(swap.from_amount) / 1e6 if swap.from_amount else 0
                amount_str = f"{from_amount:,.2f}"
            except:
                amount_str = "?"
            
            line = (
                f"{status_emoji} `{date_str}` "
                f"{amount_str} {from_display} → {to_display}"
            )
            
            if swap.tx_hash:
                line += f"\n   └ {format_tx_link(swap.tx_hash, swap.from_chain)}"
            
            lines.append(line)
            lines.append("")
        
        # Stats
        total_swaps = len(swaps)
        completed = sum(1 for s in swaps if s.status == SwapStatus.COMPLETED.value)
        
        lines.append(f"_Showing last {total_swaps} swaps ({completed} completed)_")
        
        keyboard = [
            [
                InlineKeyboardButton("🔄 New Swap", callback_data="swap_start"),
                InlineKeyboardButton("📊 Stats", callback_data="history_stats"),
            ],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
        
        await update.message.reply_text(
            "\n".join(lines),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )


async def history_stats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show detailed swap statistics."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        
        # Get all swaps
        swaps = session.query(SwapTransaction).filter(
            SwapTransaction.user_id == db_user.id
        ).all()
        
        if not swaps:
            await query.edit_message_text(
                "📊 *Swap Statistics*\n\nNo swaps yet!",
                parse_mode="Markdown"
            )
            return
        
        # Calculate stats
        total_swaps = len(swaps)
        completed = sum(1 for s in swaps if s.status == SwapStatus.COMPLETED.value)
        failed = sum(1 for s in swaps if s.status == SwapStatus.FAILED.value)
        pending = total_swaps - completed - failed
        
        # Volume
        total_volume = sum(
            float(s.from_amount_usd or 0)
            for s in swaps
            if s.status == SwapStatus.COMPLETED.value
        )
        
        # Fees
        total_gas = sum(float(s.gas_fee or 0) for s in swaps)
        total_bridge = sum(float(s.bridge_fee or 0) for s in swaps)
        
        # Most used pairs
        pair_counts = {}
        for s in swaps:
            pair = f"{s.from_token}→{s.to_token}"
            pair_counts[pair] = pair_counts.get(pair, 0) + 1
        
        top_pairs = sorted(pair_counts.items(), key=lambda x: -x[1])[:3]
        
        text = (
            f"📊 *Your Swap Statistics*\n\n"
            f"*Total Swaps:* {total_swaps}\n"
            f"  ✅ Completed: {completed}\n"
            f"  ❌ Failed: {failed}\n"
            f"  ⏳ Pending: {pending}\n\n"
            f"*Volume:* {format_usd(total_volume)}\n"
            f"*Fees Paid:*\n"
            f"  ⛽ Gas: {format_usd(total_gas)}\n"
            f"  🌉 Bridge: {format_usd(total_bridge)}\n\n"
            f"*Top Pairs:*\n"
        )
        
        for pair, count in top_pairs:
            text += f"  • {pair}: {count} swaps\n"
        
        keyboard = [
            [InlineKeyboardButton("📜 History", callback_data="history")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
        
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )


def _get_status_emoji(status: str) -> str:
    """Get emoji for swap status."""
    return {
        SwapStatus.PENDING.value: "⏳",
        SwapStatus.EXECUTING.value: "🔄",
        SwapStatus.SUBMITTED.value: "📤",
        SwapStatus.CONFIRMING.value: "⏳",
        SwapStatus.COMPLETED.value: "✅",
        SwapStatus.FAILED.value: "❌",
        SwapStatus.CANCELLED.value: "🚫",
    }.get(status, "❓")


# Create handlers
history_handler = CommandHandler("hx", history_command)

