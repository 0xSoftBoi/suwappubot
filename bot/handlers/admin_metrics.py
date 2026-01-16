"""Admin metrics dashboard handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.services.metrics import metrics_service
from bot.utils.formatters import format_usd
from bot.config.settings import settings


def is_admin(user_id: int) -> bool:
    """Check if user is admin."""
    admin_ids = getattr(settings, 'admin_ids', [])
    return user_id in admin_ids


async def metrics_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /metrics command - show admin dashboard."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return
    
    overview = metrics_service.get_overview()
    
    text = (
        "📊 *Admin Metrics Dashboard*\n\n"
        "━━━━━━ *Users* ━━━━━━\n"
        f"👥 Total: *{overview['users']['total']}*\n"
        f"🟢 Active Today: *{overview['users']['active_today']}*\n"
        f"📅 Active This Week: *{overview['users']['active_week']}*\n"
        f"🏦 Custodial: *{overview['users']['custodial']}*\n\n"
        "━━━━━━ *Swaps* ━━━━━━\n"
        f"📈 Total: *{overview['swaps']['total']}*\n"
        f"✅ Completed: *{overview['swaps']['completed']}*\n"
        f"❌ Failed: *{overview['swaps']['failed']}*\n"
        f"📆 Today: *{overview['swaps']['today']}*\n"
        f"📊 Success Rate: *{overview['swaps']['success_rate']:.1f}%*"
    )
    
    keyboard = [
        [
            InlineKeyboardButton("📈 Volume", callback_data="metrics_volume"),
            InlineKeyboardButton("💰 Fees", callback_data="metrics_fees"),
        ],
        [
            InlineKeyboardButton("🏆 Top Users", callback_data="metrics_users"),
            InlineKeyboardButton("🔗 Chains", callback_data="metrics_chains"),
        ],
        [
            InlineKeyboardButton("🏦 Hot Wallets", callback_data="metrics_wallets"),
            InlineKeyboardButton("❌ Errors", callback_data="metrics_errors"),
        ],
        [InlineKeyboardButton("🔄 Refresh", callback_data="metrics_refresh")],
    ]
    
    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_volume_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show volume statistics."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    stats = metrics_service.get_volume_stats(days=30)
    
    lines = [
        "📈 *Volume Statistics (30 days)*\n",
        f"💰 Total: *{format_usd(stats['total_volume'])}*\n",
        "\n*By Chain:*",
    ]
    
    for chain, volume in list(stats['by_chain'].items())[:5]:
        lines.append(f"• {chain}: {format_usd(volume)}")
    
    lines.append("\n*Top Tokens:*")
    for token, volume in list(stats['by_token'].items())[:5]:
        lines.append(f"• {token}: {format_usd(volume)}")
    
    text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_fees_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show fee statistics."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    stats = metrics_service.get_fee_stats(days=30)
    
    text = (
        "💰 *Fee Statistics (30 days)*\n\n"
        f"📥 Collected: *{format_usd(stats['total_collected'])}*\n"
        f"📤 Swept: *{format_usd(stats['total_swept'])}*\n"
        f"⏳ Pending: *{format_usd(stats['pending'])}*\n\n"
        "*By Chain:*\n"
    )
    
    for chain, amount in stats['by_chain'].items():
        text += f"• {chain}: {format_usd(amount)}\n"
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_users_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show top users."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    top_users = metrics_service.get_top_users(limit=10)
    
    lines = ["🏆 *Top Users by Volume*\n"]
    
    for i, u in enumerate(top_users, 1):
        medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else f"{i}."
        username = u['username'][:15] if u['username'] else f"User {u['user_id']}"
        lines.append(f"{medal} @{username}: {format_usd(u['volume'])} ({u['swap_count']} swaps)")
    
    if not top_users:
        lines.append("_No users yet_")
    
    text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_chains_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show chain health."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    health = metrics_service.get_chain_health()
    
    lines = ["🔗 *Chain Health (24h)*\n"]
    
    status_icons = {
        "healthy": "🟢",
        "degraded": "🟡",
        "unhealthy": "🔴",
    }
    
    for chain, stats in health.items():
        icon = status_icons.get(stats['status'], "⚪")
        lines.append(
            f"{icon} *{chain}*\n"
            f"   {stats['completed']}/{stats['total']} ({stats['success_rate']}%)"
        )
    
    if not health:
        lines.append("_No recent transactions_")
    
    text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_wallets_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show hot wallet status."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    wallets = metrics_service.get_hot_wallet_status()
    
    lines = ["🏦 *Hot Wallets*\n"]
    
    for w in wallets:
        status = "🟢" if w['is_active'] else "🔴"
        address_short = f"{w['address'][:6]}...{w['address'][-4:]}"
        lines.append(f"{status} *{w['name']}*\n   {w['chain']}: `{address_short}`")
    
    if not wallets:
        lines.append("_No hot wallets configured_")
    
    text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_errors_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show recent errors."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    errors = metrics_service.get_recent_errors(limit=10)
    
    lines = ["❌ *Recent Errors*\n"]
    
    for err in errors:
        error_msg = (err['error'] or "Unknown error")[:50]
        lines.append(
            f"• {err['from_chain']}→{err['to_chain']}: {err['from_token']}→{err['to_token']}\n"
            f"  _{error_msg}_"
        )
    
    if not errors:
        lines.append("_No recent errors_ 🎉")
    
    text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def metrics_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Refresh main metrics view."""
    query = update.callback_query
    await query.answer("Refreshing...")
    
    user = update.effective_user
    if not is_admin(user.id):
        return
    
    overview = metrics_service.get_overview()
    
    text = (
        "📊 *Admin Metrics Dashboard*\n\n"
        "━━━━━━ *Users* ━━━━━━\n"
        f"👥 Total: *{overview['users']['total']}*\n"
        f"🟢 Active Today: *{overview['users']['active_today']}*\n"
        f"📅 Active This Week: *{overview['users']['active_week']}*\n"
        f"🏦 Custodial: *{overview['users']['custodial']}*\n\n"
        "━━━━━━ *Swaps* ━━━━━━\n"
        f"📈 Total: *{overview['swaps']['total']}*\n"
        f"✅ Completed: *{overview['swaps']['completed']}*\n"
        f"❌ Failed: *{overview['swaps']['failed']}*\n"
        f"📆 Today: *{overview['swaps']['today']}*\n"
        f"📊 Success Rate: *{overview['swaps']['success_rate']:.1f}%*"
    )
    
    keyboard = [
        [
            InlineKeyboardButton("📈 Volume", callback_data="metrics_volume"),
            InlineKeyboardButton("💰 Fees", callback_data="metrics_fees"),
        ],
        [
            InlineKeyboardButton("🏆 Top Users", callback_data="metrics_users"),
            InlineKeyboardButton("🔗 Chains", callback_data="metrics_chains"),
        ],
        [
            InlineKeyboardButton("🏦 Hot Wallets", callback_data="metrics_wallets"),
            InlineKeyboardButton("❌ Errors", callback_data="metrics_errors"),
        ],
        [InlineKeyboardButton("🔄 Refresh", callback_data="metrics_refresh")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Create handlers
metrics_handler = CommandHandler("m", metrics_command)
metrics_volume_handler = CallbackQueryHandler(metrics_volume_callback, pattern="^metrics_volume$")
metrics_fees_handler = CallbackQueryHandler(metrics_fees_callback, pattern="^metrics_fees$")
metrics_users_handler = CallbackQueryHandler(metrics_users_callback, pattern="^metrics_users$")
metrics_chains_handler = CallbackQueryHandler(metrics_chains_callback, pattern="^metrics_chains$")
metrics_wallets_handler = CallbackQueryHandler(metrics_wallets_callback, pattern="^metrics_wallets$")
metrics_errors_handler = CallbackQueryHandler(metrics_errors_callback, pattern="^metrics_errors$")
metrics_refresh_handler = CallbackQueryHandler(metrics_refresh_callback, pattern="^metrics_refresh$")

