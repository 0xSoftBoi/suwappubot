"""Transaction history handlers."""

from typing import Optional
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler
from datetime import datetime

from bot.models.user import User
from bot.models.swap import SwapTransaction, SwapStatus
from bot.utils.formatters import format_amount, format_usd, format_tx_link, format_chain_name
from database.db import get_session
from bot.utils.tos_utils import enforce_tos
from bot.services.pnl import pnl_service

SWAPS_PER_PAGE = 5


@enforce_tos
async def history_command(update: Update, context: ContextTypes.DEFAULT_TYPE, page: int = 0) -> None:
    """Handle /history command - show recent swap history with pagination."""
    user = update.effective_user

    # Determine reply method based on whether this is a callback or command
    if update.callback_query:
        reply_func = update.callback_query.edit_message_text
    else:
        reply_func = update.message.reply_text

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await reply_func(
                "❌ Please use /start first to set up your account."
            )
            return

        # Get total count
        total_swaps = session.query(SwapTransaction).filter(
            SwapTransaction.user_id == db_user.id
        ).count()

        if total_swaps == 0:
            await reply_func(
                "📜 *Transaction History*\n\n"
                "No swaps yet. Use /s to make your first swap!",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start")]
                ])
            )
            return

        # Get paginated swaps
        swaps = session.query(SwapTransaction).filter(
            SwapTransaction.user_id == db_user.id
        ).order_by(SwapTransaction.created_at.desc()).offset(page * SWAPS_PER_PAGE).limit(SWAPS_PER_PAGE).all()

        # Build history message
        lines = ["📜 *Transaction History*\n"]

        for swap in swaps:
            status_emoji = _get_status_emoji(swap.status)
            date_str = swap.created_at.strftime("%m/%d %H:%M")

            from_display = f"{swap.from_token}"
            to_display = f"{swap.to_token}"

            # Amount — use correct decimals for the token
            try:
                from bot.config.tokens import get_token_decimals
                decimals = get_token_decimals(swap.from_token, swap.from_chain) or 18
                from_amount = float(swap.from_amount) / (10 ** decimals) if swap.from_amount else 0
                amount_str = format_amount(from_amount)
            except Exception:
                amount_str = "?"

            line = (
                f"{status_emoji} `{date_str}` "
                f"{amount_str} {from_display} → {to_display}"
            )

            if swap.tx_hash:
                line += f"\n   └ {format_tx_link(swap.tx_hash, swap.from_chain)}"

            lines.append(line)
            lines.append("")

        total_pages = max(1, (total_swaps + SWAPS_PER_PAGE - 1) // SWAPS_PER_PAGE)
        lines.append(f"_Page {page + 1}/{total_pages} • {total_swaps} total swaps_")

        keyboard = []

        # Navigation buttons
        nav_buttons = []
        if page > 0:
            nav_buttons.append(InlineKeyboardButton("« Prev", callback_data=f"history_page_{page - 1}"))
        if (page + 1) * SWAPS_PER_PAGE < total_swaps:
            nav_buttons.append(InlineKeyboardButton("Next »", callback_data=f"history_page_{page + 1}"))
        if nav_buttons:
            keyboard.append(nav_buttons)

        # Add Share button for the most recent completed swap (as a demo)
        recent_completed = [s for s in swaps if s.status == SwapStatus.COMPLETED.value]
        if recent_completed:
            s = recent_completed[0]
            keyboard.append([InlineKeyboardButton(f"🖼️ Share PNL ({s.to_token})", callback_data=f"pnl_share_{s.id}")])

        keyboard.append([
            InlineKeyboardButton("🔄 New Swap", callback_data="swap_start"),
            InlineKeyboardButton("📊 Stats", callback_data="history_stats"),
        ])
        keyboard.append([InlineKeyboardButton("« Back", callback_data="main_menu")])

        await reply_func(
            "\n".join(lines),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )


async def history_page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle history pagination callbacks."""
    query = update.callback_query
    await query.answer()
    page = int(query.data.replace("history_page_", ""))
    await history_command(update, context, page=page)


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


async def share_pnl_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Generate and show PNL sharing card."""
    query = update.callback_query
    await query.answer()
    
    swap_id = int(query.data.replace("pnl_share_", ""))
    data = await pnl_service.get_swap_pnl_data(swap_id)
    
    if not data:
        await query.message.reply_text("❌ Could not calculate PNL. Token might be too new or price data unavailable.")
        return
        
    roi = data["roi_percent"]
    roi_emoji = "🚀" if roi > 10 else ("📈" if roi > 0 else "📉")
    color_bar = "🟢" * 5 if roi > 0 else "🔴" * 5
    
    card_text = (
        f"{roi_emoji} *SUWAPPU PNL CARD*\n"
        f"{color_bar}\n\n"
        f"Token: *{data['token']}*\n"
        f"ROI: *{roi:+.2f}%*\n"
        f"Profit: *{format_usd(data['profit_usd'])}*\n\n"
        f"Entry: ${data['entry_price']:.6f}\n"
        f"Current: ${data['current_price']:.6f}\n\n"
        f"🤖 *Swapped via Suwappu Bot*"
    )
    
    keyboard = [
        [InlineKeyboardButton("🐦 Share on X (Twitter)", url=f"https://twitter.com/intent/tweet?text=Just%20made%20{roi:.1f}%25%20profit%20using%20SuwappuBot!%20%23Suwappu%20%23Solana")],
        [InlineKeyboardButton("« Back to History", callback_data="history")]
    ]
    
    await query.edit_message_text(
        card_text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


# Individual callbacks
history_callback = CallbackQueryHandler(history_command, pattern="^history$")
history_menu_callback = CallbackQueryHandler(history_command, pattern="^history_menu$")
history_page_handler = CallbackQueryHandler(history_page_callback, pattern="^history_page_")
share_pnl_handler = CallbackQueryHandler(share_pnl_callback, pattern="^pnl_share_")

# Create handlers
history_handler = CommandHandler("hx", history_command)

