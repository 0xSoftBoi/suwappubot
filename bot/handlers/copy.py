"""Handlers for Copy Trading commands.

Commands:
- /traders - Browse top traders to follow
- /follow - Manage who you follow
- /profile - View/edit your trader profile
- /stats - Your trading statistics
"""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.services.copy_service import copy_service, MAX_FOLLOWS
from bot.utils.tos_utils import enforce_tos

logger = logging.getLogger(__name__)


# Conversation states
PROFILE_NAME, PROFILE_BIO, PROFILE_EMOJI = range(3)
FOLLOW_AMOUNT = range(1)


def get_user_db_id(telegram_id: int) -> int:
    """Get database user ID from Telegram ID."""
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == telegram_id).first()
        return user.id if user else None


# ============== /traders Command ==============

@enforce_tos
async def traders_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show top traders to follow."""
    msg = copy_service.format_top_traders_message()
    
    # Get top traders for buttons
    traders = copy_service.get_top_traders(5)
    
    buttons = []
    for t in traders:
        buttons.append([
            InlineKeyboardButton(
                f"{t['avatar']} {t['display_name']} ({t['win_rate']:.0f}%)",
                callback_data=f"copy_view_{t['user_id']}"
            )
        ])
    
    buttons.append([InlineKeyboardButton("📊 My Stats", callback_data="copy_mystats")])
    
    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


@enforce_tos
async def traders_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle traders list callback."""
    query = update.callback_query
    await query.answer()
    
    msg = copy_service.format_top_traders_message()
    
    traders = copy_service.get_top_traders(5)
    
    buttons = []
    for t in traders:
        buttons.append([
            InlineKeyboardButton(
                f"{t['avatar']} {t['display_name']} ({t['win_rate']:.0f}%)",
                callback_data=f"copy_view_{t['user_id']}"
            )
        ])
    
    buttons.append([InlineKeyboardButton("📊 My Stats", callback_data="copy_mystats")])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ============== View Trader Profile ==============

@enforce_tos
async def view_trader_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """View a specific trader's profile."""
    query = update.callback_query
    await query.answer()
    
    # Parse trader ID
    try:
        trader_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.answer("Invalid trader!", show_alert=True)
        return
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    stats = copy_service.get_trader_stats(trader_id)
    if not stats:
        await query.answer("Trader not found!", show_alert=True)
        return
    
    profile = stats["profile"]
    s = stats["stats"]
    social = stats["social"]
    
    pnl_emoji = "📈" if s["total_pnl"] >= 0 else "📉"
    
    msg = (
        f"{profile['avatar']} *{profile['display_name']}*\n"
        f"{profile.get('bio') or ''}\n\n"
        f"📊 *Performance*\n"
        f"├ Trades: {s['total_trades']}\n"
        f"├ Win Rate: {s['win_rate']:.1f}%\n"
        f"├ Volume: ${s['total_volume']:,.2f}\n"
        f"├ PnL: {pnl_emoji} ${s['total_pnl']:,.2f}\n"
        f"├ Best: +${s['best_trade']:,.2f}\n"
        f"└ Worst: ${s['worst_trade']:,.2f}\n\n"
        f"👥 *Social*\n"
        f"├ Followers: {social['follower_count']}\n"
        f"├ Times Copied: {social['times_copied']}\n"
        f"└ Copy Volume: ${social['copy_volume']:,.2f}\n"
    )
    
    # Recent trades
    if stats["recent_trades"]:
        msg += "\n📜 *Recent Trades*\n"
        for t in stats["recent_trades"][:3]:
            trade_pnl = t.get("pnl", 0) or 0
            t_emoji = "✅" if trade_pnl >= 0 else "❌"
            msg += f"├ {t_emoji} {t['from']}→{t['to']} ${t['amount']:,.0f}\n"
    
    # Check if already following
    following = copy_service.get_following(user_id)
    is_following = any(f["trader_id"] == trader_id for f in following)
    
    if is_following:
        # NOTE: the previous "⚙️ Settings" button emitted callback_data
        # "copy_settings_<id>", which has NO registered CallbackQueryHandler in
        # bot/main.py — it was a dead button (Telegram spinner would hang). Removed
        # until a real copy-settings screen + handler are added. Unfollow works.
        buttons = [
            [
                InlineKeyboardButton("🚫 Unfollow", callback_data=f"copy_unfollow_{trader_id}"),
            ]
        ]
    else:
        buttons = [
            [
                InlineKeyboardButton("🔔 Follow (Notify)", callback_data=f"copy_follow_{trader_id}_notify"),
                InlineKeyboardButton("🤖 Follow (Auto)", callback_data=f"copy_follow_{trader_id}_auto"),
            ]
        ]
    
    buttons.append([
        InlineKeyboardButton("« Back", callback_data="copy_traders"),
        InlineKeyboardButton("👥 Following", callback_data="copy_following"),
    ])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ============== Follow/Unfollow ==============

@enforce_tos
async def follow_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Follow a trader."""
    query = update.callback_query
    
    # Parse trader ID and mode
    parts = query.data.split("_")
    try:
        trader_id = int(parts[2])
        mode = parts[3] if len(parts) > 3 else "notify"
    except (ValueError, IndexError):
        await query.answer("Invalid request!", show_alert=True)
        return
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    success, message = copy_service.follow_trader(
        follower_id=user_id,
        trader_id=trader_id,
        copy_mode=mode,
    )
    
    await query.answer(message, show_alert=True)
    
    if success:
        # Refresh the trader view
        await view_trader_callback(update, context)


@enforce_tos
async def unfollow_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Unfollow a trader."""
    query = update.callback_query
    
    try:
        trader_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.answer("Invalid request!", show_alert=True)
        return
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    success, message = copy_service.unfollow_trader(user_id, trader_id)
    
    await query.answer(message, show_alert=True)
    
    if success:
        # Refresh the trader view
        await view_trader_callback(update, context)


# ============== /follow Command (Following List) ==============

@enforce_tos
async def following_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show list of traders user is following."""
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await update.message.reply_text("❌ Please /start first!")
        return
    
    msg = copy_service.format_following_message(user_id)
    
    following = copy_service.get_following(user_id)
    
    buttons = []
    for f in following[:5]:
        buttons.append([
            InlineKeyboardButton(
                f"{f['avatar']} {f['display_name']}",
                callback_data=f"copy_view_{f['trader_id']}"
            )
        ])
    
    buttons.append([
        InlineKeyboardButton("🏆 Top Traders", callback_data="copy_traders"),
        InlineKeyboardButton("📊 My Profile", callback_data="copy_profile"),
    ])
    
    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


@enforce_tos
async def following_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle following list callback."""
    query = update.callback_query
    await query.answer()
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    msg = copy_service.format_following_message(user_id)
    
    following = copy_service.get_following(user_id)
    
    buttons = []
    for f in following[:5]:
        buttons.append([
            InlineKeyboardButton(
                f"{f['avatar']} {f['display_name']}",
                callback_data=f"copy_view_{f['trader_id']}"
            )
        ])
    
    buttons.append([
        InlineKeyboardButton("🏆 Top Traders", callback_data="copy_traders"),
        InlineKeyboardButton("📊 My Profile", callback_data="copy_profile"),
    ])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ============== /profile Command ==============

@enforce_tos
async def profile_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """View/edit trader profile."""
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await update.message.reply_text("❌ Please /start first!")
        return
    
    profile = copy_service.get_or_create_profile(user_id)
    stats = copy_service.get_trader_stats(user_id)
    
    visibility = "🟢 Public" if profile.is_public else "🔴 Private"
    pnl_emoji = "📈" if profile.total_pnl_usd >= 0 else "📉"
    
    msg = (
        f"👤 *Your Trader Profile*\n\n"
        f"{profile.avatar_emoji} *{profile.display_name or 'Not set'}*\n"
        f"_{profile.bio or 'No bio set'}_\n\n"
        f"*Visibility:* {visibility}\n\n"
        f"📊 *Your Stats*\n"
        f"├ Trades: {profile.total_trades}\n"
        f"├ Win Rate: {profile.win_rate:.1f}%\n"
        f"├ Volume: ${profile.total_volume_usd:,.2f}\n"
        f"├ PnL: {pnl_emoji} ${profile.total_pnl_usd:,.2f}\n"
        f"├ Followers: {profile.follower_count}\n"
        f"└ Times Copied: {profile.times_copied}\n"
    )
    
    toggle_text = "🔴 Go Private" if profile.is_public else "🟢 Go Public"
    
    buttons = [
        [
            InlineKeyboardButton("✏️ Edit Name", callback_data="copy_edit_name"),
            InlineKeyboardButton("📝 Edit Bio", callback_data="copy_edit_bio"),
        ],
        [
            InlineKeyboardButton("🎭 Change Emoji", callback_data="copy_edit_emoji"),
            InlineKeyboardButton(toggle_text, callback_data="copy_toggle_public"),
        ],
        [
            InlineKeyboardButton("👥 My Followers", callback_data="copy_myfollowers"),
            InlineKeyboardButton("🏆 Leaderboard", callback_data="copy_traders"),
        ],
    ]
    
    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


@enforce_tos
async def profile_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle profile view callback."""
    query = update.callback_query
    await query.answer()
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    profile = copy_service.get_or_create_profile(user_id)
    
    visibility = "🟢 Public" if profile.is_public else "🔴 Private"
    pnl_emoji = "📈" if profile.total_pnl_usd >= 0 else "📉"
    
    msg = (
        f"👤 *Your Trader Profile*\n\n"
        f"{profile.avatar_emoji} *{profile.display_name or 'Not set'}*\n"
        f"_{profile.bio or 'No bio set'}_\n\n"
        f"*Visibility:* {visibility}\n\n"
        f"📊 *Your Stats*\n"
        f"├ Trades: {profile.total_trades}\n"
        f"├ Win Rate: {profile.win_rate:.1f}%\n"
        f"├ Volume: ${profile.total_volume_usd:,.2f}\n"
        f"├ PnL: {pnl_emoji} ${profile.total_pnl_usd:,.2f}\n"
        f"├ Followers: {profile.follower_count}\n"
        f"└ Times Copied: {profile.times_copied}\n"
    )
    
    toggle_text = "🔴 Go Private" if profile.is_public else "🟢 Go Public"
    
    buttons = [
        [
            InlineKeyboardButton("✏️ Edit Name", callback_data="copy_edit_name"),
            InlineKeyboardButton("📝 Edit Bio", callback_data="copy_edit_bio"),
        ],
        [
            InlineKeyboardButton("🎭 Change Emoji", callback_data="copy_edit_emoji"),
            InlineKeyboardButton(toggle_text, callback_data="copy_toggle_public"),
        ],
        [
            InlineKeyboardButton("👥 My Followers", callback_data="copy_myfollowers"),
            InlineKeyboardButton("🏆 Leaderboard", callback_data="copy_traders"),
        ],
    ]
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ============== Profile Editing ==============

@enforce_tos
async def toggle_public_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Toggle public visibility."""
    query = update.callback_query
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    is_public, message = copy_service.toggle_public(user_id)
    
    await query.answer(message, show_alert=True)
    
    # Refresh profile view
    await profile_callback(update, context)


@enforce_tos
async def edit_name_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start name editing flow."""
    query = update.callback_query
    await query.answer()
    
    await query.edit_message_text(
        "✏️ *Edit Display Name*\n\n"
        "Send your new display name (max 50 characters):\n\n"
        "_Send /cancel to cancel_",
        parse_mode="Markdown",
    )
    
    context.user_data["copy_edit_mode"] = "name"
    return PROFILE_NAME


@enforce_tos
async def edit_bio_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start bio editing flow."""
    query = update.callback_query
    await query.answer()
    
    await query.edit_message_text(
        "📝 *Edit Bio*\n\n"
        "Send your new bio (max 255 characters):\n\n"
        "_Send /cancel to cancel_",
        parse_mode="Markdown",
    )
    
    context.user_data["copy_edit_mode"] = "bio"
    return PROFILE_BIO


@enforce_tos
async def edit_emoji_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start emoji editing flow."""
    query = update.callback_query
    await query.answer()
    
    emoji_options = ["🦊", "🐺", "🦁", "🐯", "🦅", "🐉", "🦈", "🐋", "🦄", "👑", "💎", "🔥"]
    
    buttons = []
    row = []
    for i, emoji in enumerate(emoji_options):
        row.append(InlineKeyboardButton(emoji, callback_data=f"copy_set_emoji_{emoji}"))
        if len(row) == 4:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    
    buttons.append([InlineKeyboardButton("« Back", callback_data="copy_profile")])
    
    await query.edit_message_text(
        "🎭 *Choose Your Avatar*\n\n"
        "Select an emoji to represent your profile:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


@enforce_tos
async def set_emoji_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Set profile emoji."""
    query = update.callback_query
    
    emoji = query.data.split("_")[-1]
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    copy_service.update_profile(user_id, avatar_emoji=emoji)
    
    await query.answer(f"Avatar set to {emoji}!", show_alert=True)
    
    # Return to profile
    await profile_callback(update, context)


async def receive_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive new display name."""
    if update.message.text == "/cancel":
        await update.message.reply_text("Cancelled!")
        return ConversationHandler.END
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await update.message.reply_text("❌ Please /start first!")
        return ConversationHandler.END
    
    name = update.message.text[:50]
    copy_service.update_profile(user_id, display_name=name)
    
    await update.message.reply_text(
        f"✅ Display name set to: *{name}*\n\n"
        "Use /profile to view your profile.",
        parse_mode="Markdown",
    )
    
    return ConversationHandler.END


async def receive_bio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive new bio."""
    if update.message.text == "/cancel":
        await update.message.reply_text("Cancelled!")
        return ConversationHandler.END
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await update.message.reply_text("❌ Please /start first!")
        return ConversationHandler.END
    
    bio = update.message.text[:255]
    copy_service.update_profile(user_id, bio=bio)
    
    await update.message.reply_text(
        f"✅ Bio updated!\n\n"
        "Use /profile to view your profile.",
        parse_mode="Markdown",
    )
    
    return ConversationHandler.END


# ============== My Followers ==============

@enforce_tos
async def my_followers_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's followers."""
    query = update.callback_query
    await query.answer()
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    followers = copy_service.get_followers(user_id)
    
    if not followers:
        msg = (
            "👥 *Your Followers*\n\n"
            "No followers yet.\n\n"
            "Go public to let others follow and copy your trades!"
        )
    else:
        msg = f"👥 *Your Followers* ({len(followers)})\n\n"
        for f in followers[:10]:
            mode_emoji = "🔔" if f["copy_mode"] == "notify" else "🤖"
            msg += f"• {mode_emoji} {f['username']}\n"
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("« Back to Profile", callback_data="copy_profile")]
        ]),
    )


# ============== /stats Command ==============

@enforce_tos
async def stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's detailed trading stats."""
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await update.message.reply_text("❌ Please /start first!")
        return
    
    stats = copy_service.get_trader_stats(user_id)
    
    if not stats:
        await update.message.reply_text(
            "📊 *Your Trading Stats*\n\n"
            "No trading history yet.\n"
            "Start swapping to build your stats!",
            parse_mode="Markdown",
        )
        return
    
    s = stats["stats"]
    social = stats["social"]
    pnl_emoji = "📈" if s["total_pnl"] >= 0 else "📉"
    
    msg = (
        f"📊 *Your Trading Stats*\n\n"
        f"*Performance*\n"
        f"├ Total Trades: {s['total_trades']}\n"
        f"├ Winning Trades: {s['winning_trades']}\n"
        f"├ Win Rate: {s['win_rate']:.1f}%\n"
        f"├ Total Volume: ${s['total_volume']:,.2f}\n"
        f"├ Total PnL: {pnl_emoji} ${s['total_pnl']:,.2f}\n"
        f"├ Avg Trade Size: ${s['avg_trade_size']:,.2f}\n"
        f"├ Best Trade: +${s['best_trade']:,.2f}\n"
        f"└ Worst Trade: ${s['worst_trade']:,.2f}\n\n"
        f"*Social*\n"
        f"├ Followers: {social['follower_count']}\n"
        f"├ Times Copied: {social['times_copied']}\n"
        f"└ Copy Volume: ${social['copy_volume']:,.2f}\n"
    )
    
    # Recent trades
    if stats["recent_trades"]:
        msg += "\n*Recent Trades*\n"
        for t in stats["recent_trades"][:5]:
            trade_pnl = t.get("pnl", 0) or 0
            t_emoji = "✅" if trade_pnl >= 0 else "❌"
            msg += f"├ {t_emoji} {t['from']}→{t['to']} ${t['amount']:,.0f}\n"
    
    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("👤 Profile", callback_data="copy_profile"),
                InlineKeyboardButton("🏆 Leaderboard", callback_data="copy_traders"),
            ]
        ]),
    )


@enforce_tos
async def mystats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle my stats callback."""
    query = update.callback_query
    await query.answer()
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    stats = copy_service.get_trader_stats(user_id)
    
    if not stats:
        await query.edit_message_text(
            "📊 *Your Trading Stats*\n\n"
            "No trading history yet.\n"
            "Start swapping to build your stats!",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🏆 Top Traders", callback_data="copy_traders")]
            ]),
        )
        return
    
    s = stats["stats"]
    social = stats["social"]
    pnl_emoji = "📈" if s["total_pnl"] >= 0 else "📉"
    
    msg = (
        f"📊 *Your Trading Stats*\n\n"
        f"├ Trades: {s['total_trades']} ({s['win_rate']:.0f}% win)\n"
        f"├ Volume: ${s['total_volume']:,.0f}\n"
        f"├ PnL: {pnl_emoji} ${s['total_pnl']:,.0f}\n"
        f"└ Followers: {social['follower_count']}\n"
    )
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("👤 Profile", callback_data="copy_profile"),
                InlineKeyboardButton("🏆 Leaderboard", callback_data="copy_traders"),
            ]
        ]),
    )


# ============== Copy Trade Notification Handlers ==============

@enforce_tos
async def copy_now_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Execute a copy trade from notification."""
    query = update.callback_query
    
    try:
        copy_trade_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.answer("Invalid request!", show_alert=True)
        return
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    await query.answer("Copying trade...", show_alert=False)
    
    success, message, swap_id = await copy_service.execute_copy(user_id, copy_trade_id)
    
    if success:
        await query.edit_message_text(
            f"✅ *Trade Copied!*\n\n{message}\n\n"
            f"Swap ID: `{swap_id}`",
            parse_mode="Markdown",
        )
    else:
        await query.edit_message_text(
            f"❌ *Copy Failed*\n\n{message}",
            parse_mode="Markdown",
        )


@enforce_tos
async def skip_copy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Skip a copy trade notification."""
    query = update.callback_query
    
    try:
        copy_trade_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.answer("Invalid request!", show_alert=True)
        return
    
    user_id = get_user_db_id(update.effective_user.id)
    if not user_id:
        await query.answer("Please /start first!", show_alert=True)
        return
    
    copy_service.skip_copy(user_id, copy_trade_id)
    
    await query.answer("Trade skipped", show_alert=False)
    await query.edit_message_text("⏭️ Trade skipped.")


# ============== Register Handlers ==============

# Command handlers
traders_handler = CommandHandler("traders", traders_command)
following_handler = CommandHandler("following", following_command)
profile_handler = CommandHandler("profile", profile_command)
stats_handler = CommandHandler("tstats", stats_command)

async def copy_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle copy trading main menu callback."""
    query = update.callback_query
    await query.answer()

    text = (
        "📋 *Copy Trading*\n\n"
        "Follow and automatically copy trades from top traders!\n\n"
        "• 🏆 Browse top traders\n"
        "• 👥 Manage who you're following\n"
        "• 👤 Set up your trader profile\n"
        "• 📊 View your trading stats"
    )

    keyboard = [
        [InlineKeyboardButton("🏆 Top Traders", callback_data="copy_traders")],
        [InlineKeyboardButton("👥 Following", callback_data="copy_following")],
        [InlineKeyboardButton("👤 My Profile", callback_data="copy_profile")],
        [InlineKeyboardButton("📊 My Stats", callback_data="copy_mystats")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Callback handlers
copy_menu_callback_handler = CallbackQueryHandler(copy_menu_callback, pattern="^copy_menu$")
traders_callback_handler = CallbackQueryHandler(traders_callback, pattern="^copy_traders$")
view_trader_callback_handler = CallbackQueryHandler(view_trader_callback, pattern=r"^copy_view_\d+$")
follow_callback_handler = CallbackQueryHandler(follow_callback, pattern=r"^copy_follow_\d+_(notify|auto)$")
unfollow_callback_handler = CallbackQueryHandler(unfollow_callback, pattern=r"^copy_unfollow_\d+$")
following_callback_handler = CallbackQueryHandler(following_callback, pattern="^copy_following$")
profile_callback_handler = CallbackQueryHandler(profile_callback, pattern="^copy_profile$")
toggle_public_callback_handler = CallbackQueryHandler(toggle_public_callback, pattern="^copy_toggle_public$")
edit_name_callback_handler = CallbackQueryHandler(edit_name_callback, pattern="^copy_edit_name$")
edit_bio_callback_handler = CallbackQueryHandler(edit_bio_callback, pattern="^copy_edit_bio$")
edit_emoji_callback_handler = CallbackQueryHandler(edit_emoji_callback, pattern="^copy_edit_emoji$")
set_emoji_callback_handler = CallbackQueryHandler(set_emoji_callback, pattern=r"^copy_set_emoji_.+$")
my_followers_callback_handler = CallbackQueryHandler(my_followers_callback, pattern="^copy_myfollowers$")
mystats_callback_handler = CallbackQueryHandler(mystats_callback, pattern="^copy_mystats$")
copy_now_callback_handler = CallbackQueryHandler(copy_now_callback, pattern=r"^copy_execute_\d+$")
skip_copy_callback_handler = CallbackQueryHandler(skip_copy_callback, pattern=r"^copy_skip_\d+$")

# Conversation handler for profile editing
profile_edit_conversation = ConversationHandler(
    name="profile_edit",
    persistent=True,
    entry_points=[
        CallbackQueryHandler(edit_name_callback, pattern="^copy_edit_name$"),
        CallbackQueryHandler(edit_bio_callback, pattern="^copy_edit_bio$"),
    ],
    states={
        PROFILE_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_name)],
        PROFILE_BIO: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_bio)],
    },
    fallbacks=[CommandHandler("cancel", lambda u, c: ConversationHandler.END)],
)

