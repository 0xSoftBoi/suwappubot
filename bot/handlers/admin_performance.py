"""Admin handlers for performance monitoring."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.utils.performance import perf_tracker, MetricNames
from bot.utils.db_monitor import query_monitor
from bot.config.settings import settings


# Admin user IDs from settings, fail-closed if not configured
ADMIN_IDS = [int(x) for x in settings.admin_telegram_ids.split(",") if x.strip()] if settings.admin_telegram_ids else []


def is_admin(user_id: int) -> bool:
    """Check if user is admin. Denies all if no admin IDs configured (fail-closed)."""
    return len(ADMIN_IDS) > 0 and user_id in ADMIN_IDS


async def perf_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /perf command - show performance metrics."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return
    
    # Get performance stats
    summary = perf_tracker.get_summary()
    db_stats = query_monitor.get_stats()
    
    lines = ["📊 *Performance Metrics*\n"]
    
    # API metrics
    lines.append("*API Latency (ms)*")
    api_metrics = [
        (MetricNames.API_LIFI, "Li.Fi"),
        (MetricNames.API_JUPITER, "Jupiter"),
        (MetricNames.API_COINGECKO, "CoinGecko"),
    ]
    
    for metric_name, display_name in api_metrics:
        key = f"{metric_name}_ms"
        if key in summary:
            s = summary[key]
            lines.append(
                f"• {display_name}: avg {s['avg']:.0f}ms "
                f"(min {s['min']:.0f}, max {s['max']:.0f}) "
                f"[{s['count']} calls, {s['error_rate']:.1f}% errors]"
            )
    
    lines.append("")
    
    # Swap metrics
    lines.append("*Swap Operations*")
    for metric in [MetricNames.SWAP_QUOTE, MetricNames.SWAP_EXECUTE]:
        key = f"{metric}_ms"
        if key in summary:
            s = summary[key]
            lines.append(
                f"• {metric.replace('_', ' ').title()}: {s['avg']:.0f}ms avg "
                f"({s['count']} ops, {s['error_rate']:.1f}% errors)"
            )
    
    lines.append("")
    
    # Database metrics
    lines.append("*Database*")
    lines.append(f"• Total queries: {db_stats['total_queries']}")
    lines.append(f"• Avg query time: {db_stats['avg_query_ms']:.1f}ms")
    lines.append(f"• Slow queries: {db_stats['slow_query_count']}")
    
    text = "\n".join(lines)
    
    keyboard = [
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="perf_refresh"),
            InlineKeyboardButton("🗑 Reset", callback_data="perf_reset"),
        ],
        [InlineKeyboardButton("📝 Slow Queries", callback_data="perf_slow_queries")],
    ]
    
    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def perf_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Refresh performance metrics."""
    query = update.callback_query
    await query.answer("Refreshing...")
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    # Get performance stats
    summary = perf_tracker.get_summary()
    db_stats = query_monitor.get_stats()
    
    lines = ["📊 *Performance Metrics*\n"]
    
    # API metrics
    lines.append("*API Latency (ms)*")
    api_metrics = [
        (MetricNames.API_LIFI, "Li.Fi"),
        (MetricNames.API_JUPITER, "Jupiter"),
        (MetricNames.API_COINGECKO, "CoinGecko"),
    ]
    
    for metric_name, display_name in api_metrics:
        key = f"{metric_name}_ms"
        if key in summary:
            s = summary[key]
            lines.append(
                f"• {display_name}: avg {s['avg']:.0f}ms "
                f"[{s['count']} calls, {s['error_rate']:.1f}% errors]"
            )
    
    lines.append("")
    lines.append("*Database*")
    lines.append(f"• Queries: {db_stats['total_queries']}, Avg: {db_stats['avg_query_ms']:.1f}ms")
    
    text = "\n".join(lines)
    
    keyboard = [
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="perf_refresh"),
            InlineKeyboardButton("🗑 Reset", callback_data="perf_reset"),
        ],
        [InlineKeyboardButton("📝 Slow Queries", callback_data="perf_slow_queries")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def perf_reset_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reset performance metrics."""
    query = update.callback_query
    
    user = update.effective_user
    if not is_admin(user.id):
        await query.answer("Admin only", show_alert=True)
        return
    
    perf_tracker.reset()
    query_monitor.reset()
    
    await query.answer("Metrics reset!", show_alert=True)
    await query.edit_message_text(
        "📊 *Performance Metrics*\n\n_Metrics have been reset._",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 Refresh", callback_data="perf_refresh")],
        ]),
    )


async def perf_slow_queries_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show slow queries."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    slow_queries = query_monitor.get_slow_queries(limit=5)
    
    if not slow_queries:
        text = "📝 *Slow Queries*\n\n_No slow queries recorded._"
    else:
        lines = ["📝 *Recent Slow Queries*\n"]
        for i, q in enumerate(slow_queries, 1):
            stmt = q['statement'][:100] + "..." if len(q['statement']) > 100 else q['statement']
            lines.append(f"{i}. {q['duration_ms']:.0f}ms\n`{stmt}`\n")
        text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="perf_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Create handlers
perf_handler = CommandHandler("perf", perf_command)
perf_refresh_handler = CallbackQueryHandler(perf_refresh_callback, pattern="^perf_refresh$")
perf_reset_handler = CallbackQueryHandler(perf_reset_callback, pattern="^perf_reset$")
perf_slow_queries_handler = CallbackQueryHandler(perf_slow_queries_callback, pattern="^perf_slow_queries$")

