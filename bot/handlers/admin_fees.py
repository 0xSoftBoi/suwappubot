"""Admin handlers for fee management."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.services.fee_service import fee_service
from bot.utils.formatters import format_usd, format_amount
from database.db import get_session


# Admin IDs
ADMIN_IDS = []  # Add your Telegram ID


def is_admin(user_id: int) -> bool:
    """Check if user is admin. Denies all if no admin IDs configured (fail-closed)."""
    return len(ADMIN_IDS) > 0 and user_id in ADMIN_IDS


async def fees_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin command to view fee stats and config."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return
    
    # Get config
    config = fee_service.get_fee_config()
    
    # Get totals
    total_fees_usd, total_swaps = fee_service.get_total_fees_collected()
    
    # Get daily stats
    daily_stats = fee_service.get_daily_stats(7)
    
    lines = ["💰 *Fee Dashboard*\n"]
    
    # Config section
    lines.append("*Current Configuration:*")
    lines.append(f"• Fee: {config.swap_fee_percentage}%")
    lines.append(f"• Min fee: {format_usd(config.min_fee_usd)}")
    lines.append(f"• Max fee: {format_usd(config.max_fee_usd)}")
    lines.append(f"• Status: {'✅ Active' if config.is_active else '❌ Disabled'}")
    lines.append("")
    
    # Totals
    lines.append("*All-Time Totals:*")
    lines.append(f"• Total swaps: {total_swaps:,}")
    lines.append(f"• Total fees: {format_usd(total_fees_usd)}")
    lines.append("")
    
    # Daily breakdown
    if daily_stats:
        lines.append("*Last 7 Days:*")
        for day in daily_stats[:7]:
            lines.append(
                f"• {day['date']}: {day['swaps']} swaps, "
                f"{format_usd(day['fees_usd'])} fees"
            )
    
    # Get uncollected fees
    uncollected = fee_service.get_uncollected_fees()
    if uncollected:
        lines.append("")
        lines.append("*Uncollected Fees:*")
        for uf in uncollected:
            lines.append(
                f"• {uf['chain']}: {format_amount(uf['amount'], symbol=uf['token'])} "
                f"({format_usd(uf['amount_usd'])})"
            )
    
    # Fee collector
    lines.append("")
    lines.append(f"*Collector:* `{config.fee_collector_address or 'Not set'}`")
    
    keyboard = [
        [
            InlineKeyboardButton("📊 Set 0.5%", callback_data="set_fee_0.5"),
            InlineKeyboardButton("📊 Set 1%", callback_data="set_fee_1"),
            InlineKeyboardButton("📊 Set 2%", callback_data="set_fee_2"),
        ],
        [InlineKeyboardButton("💸 Sweep All Fees", callback_data="sweep_all_fees")],
        [InlineKeyboardButton("🔄 Refresh", callback_data="fees_refresh")],
    ]
    
    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def set_fee_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle fee setting callbacks."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    fee_str = query.data.replace("set_fee_", "")
    try:
        new_fee = float(fee_str)
    except ValueError:
        await query.edit_message_text("❌ Invalid fee value.")
        return
    
    # Update fee
    fee_service.set_fee_config(fee_percentage=new_fee)
    
    await query.edit_message_text(
        f"✅ Fee updated to {new_fee}%",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("💰 Back to Fees", callback_data="fees_refresh")]
        ])
    )


async def fees_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Refresh fees dashboard."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    config = fee_service.get_fee_config()
    total_fees_usd, total_swaps = fee_service.get_total_fees_collected()
    daily_stats = fee_service.get_daily_stats(7)
    
    lines = ["💰 *Fee Dashboard*\n"]
    
    lines.append("*Current Configuration:*")
    lines.append(f"• Fee: {config.swap_fee_percentage}%")
    lines.append(f"• Min fee: {format_usd(config.min_fee_usd)}")
    lines.append(f"• Max fee: {format_usd(config.max_fee_usd)}")
    lines.append(f"• Status: {'✅ Active' if config.is_active else '❌ Disabled'}")
    lines.append("")
    
    lines.append("*All-Time Totals:*")
    lines.append(f"• Total swaps: {total_swaps:,}")
    lines.append(f"• Total fees: {format_usd(total_fees_usd)}")
    lines.append("")
    
    if daily_stats:
        lines.append("*Last 7 Days:*")
        for day in daily_stats[:7]:
            lines.append(
                f"• {day['date']}: {day['swaps']} swaps, "
                f"{format_usd(day['fees_usd'])} fees"
            )
    
    # Get uncollected fees
    uncollected = fee_service.get_uncollected_fees()
    if uncollected:
        lines.append("")
        lines.append("*Uncollected Fees:*")
        for uf in uncollected:
            lines.append(
                f"• {uf['chain']}: {format_amount(uf['amount'], symbol=uf['token'])} "
                f"({format_usd(uf['amount_usd'])})"
            )
    
    # Fee collector
    lines.append("")
    lines.append(f"*Collector:* `{config.fee_collector_address or 'Not set'}`")
    
    keyboard = [
        [
            InlineKeyboardButton("📊 Set 0.5%", callback_data="set_fee_0.5"),
            InlineKeyboardButton("📊 Set 1%", callback_data="set_fee_1"),
            InlineKeyboardButton("📊 Set 2%", callback_data="set_fee_2"),
        ],
        [InlineKeyboardButton("💸 Sweep All Fees", callback_data="sweep_all_fees")],
        [InlineKeyboardButton("🔄 Refresh", callback_data="fees_refresh")],
    ]
    
    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def sweep_fees_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Sweep all uncollected fees to collector address."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.edit_message_text("❌ Admin access required.")
        return
    
    await query.edit_message_text("⏳ Sweeping fees to collector...")
    
    try:
        results = await fee_service.sweep_all_fees()
        
        if not results:
            await query.edit_message_text(
                "ℹ️ No fees to sweep.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("💰 Back to Fees", callback_data="fees_refresh")]
                ])
            )
            return
        
        lines = ["💸 *Fee Sweep Results*\n"]
        
        for r in results:
            status = "✅" if r["success"] else "❌"
            lines.append(
                f"{status} {r['chain']} {r['token']}: "
                f"{format_amount(r['amount'])} - {r['message']}"
            )
            if r.get("tx_hash"):
                lines.append(f"   `{r['tx_hash'][:20]}...`")
        
        await query.edit_message_text(
            "\n".join(lines),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💰 Back to Fees", callback_data="fees_refresh")]
            ])
        )
        
    except Exception as e:
        await query.edit_message_text(
            f"❌ Sweep failed: {str(e)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💰 Back to Fees", callback_data="fees_refresh")]
            ])
        )


# Create handlers
fees_handler = CommandHandler("fee", fees_command)

