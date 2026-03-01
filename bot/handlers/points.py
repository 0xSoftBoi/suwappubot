"""Handlers for Points/XP commands.

Commands:
- /xp - Show points, level, and progress
- /checkin - Daily check-in for points
- /leaderboard - Top 10 users by XP
- /rewards - Browse reward store
- /redeem - Redeem points for rewards
"""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
)

from bot.services.points_service import points_service
from bot.models.points import LEVELS
from bot.utils.tos_utils import enforce_tos

logger = logging.getLogger(__name__)


# ============== /xp Command ==============

@enforce_tos
async def xp_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's XP, level, and progress."""
    user = update.effective_user
    
    # Get or create user in DB
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text(
                "❌ Please start the bot first with /start"
            )
            return
        user_id = db_user.id
    
    msg = points_service.format_stats_message(user_id)
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📊 Leaderboard", callback_data="xp_leaderboard"),
            InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards"),
        ],
        [
            InlineKeyboardButton("📅 Check In", callback_data="xp_checkin"),
            InlineKeyboardButton("🎯 Quests", callback_data="xp_quests"),
        ]
    ])

    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


@enforce_tos
async def xp_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle XP menu callback."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please start the bot first with /start")
            return
        user_id = db_user.id
    
    msg = points_service.format_stats_message(user_id)
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📊 Leaderboard", callback_data="xp_leaderboard"),
            InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards"),
        ],
        [
            InlineKeyboardButton("📅 Check In", callback_data="xp_checkin"),
            InlineKeyboardButton("🎯 Quests", callback_data="xp_quests"),
        ]
    ])

    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ============== /checkin Command ==============

@enforce_tos
async def checkin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Daily check-in for points."""
    user = update.effective_user
    
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text(
                "❌ Please start the bot first with /start"
            )
            return
        user_id = db_user.id
    
    points, streak, continued, new_level = points_service.daily_checkin(user_id)
    
    if points == 0:
        await update.message.reply_text(
            "✅ You've already checked in today!\n\n"
            f"🔥 Current streak: *{streak} days*\n\n"
            "_Come back tomorrow!_",
            parse_mode="Markdown",
        )
        return
    
    level_up_msg = ""
    if new_level:
        level_info = LEVELS.get(new_level, {})
        level_up_msg = (
            f"\n\n🎉 *LEVEL UP!*\n"
            f"You're now {level_info.get('emoji', '')} *{level_info.get('name', new_level)}*!\n"
            f"New fee rate: {level_info.get('fee', 0.8)}%"
        )
    
    streak_emoji = "🔥" if continued else "✨"
    
    await update.message.reply_text(
        f"📅 *Daily Check-In Complete!*\n\n"
        f"💰 +*{points}* points earned!\n"
        f"{streak_emoji} Streak: *{streak} days*{level_up_msg}\n\n"
        f"_Keep checking in for bonus points!_",
        parse_mode="Markdown",
    )


@enforce_tos
async def checkin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle check-in callback."""
    query = update.callback_query
    user = update.effective_user
    
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("Please start the bot first!", show_alert=True)
            return
        user_id = db_user.id
    
    points, streak, continued, new_level = points_service.daily_checkin(user_id)
    
    if points == 0:
        await query.answer("Already checked in today! Come back tomorrow.", show_alert=True)
        return
    
    await query.answer(f"✅ +{points} points! Streak: {streak} days", show_alert=True)
    
    # Refresh stats display
    msg = points_service.format_stats_message(user_id)
    
    level_up_msg = ""
    if new_level:
        level_info = LEVELS.get(new_level, {})
        msg += (
            f"\n🎉 *LEVEL UP!* → {level_info.get('emoji', '')} {level_info.get('name', new_level)}!"
        )
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📊 Leaderboard", callback_data="xp_leaderboard"),
            InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards"),
        ],
        [
            InlineKeyboardButton("✅ Checked In Today", callback_data="xp_noop"),
        ]
    ])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ============== /leaderboard Command ==============

@enforce_tos
async def leaderboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show top 10 users by XP."""
    msg = points_service.format_leaderboard_message()
    
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")]
    ])
    
    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


@enforce_tos
async def leaderboard_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle leaderboard callback."""
    query = update.callback_query
    await query.answer()
    
    msg = points_service.format_leaderboard_message()
    
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")]
    ])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ============== /rewards Command ==============

@enforce_tos
async def rewards_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Browse available rewards."""
    user = update.effective_user
    
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text(
                "❌ Please start the bot first with /start"
            )
            return
        user_id = db_user.id
    
    stats = points_service.get_user_stats(user_id)
    rewards = points_service.get_available_rewards()
    
    msg = (
        f"🎁 *Rewards Store*\n\n"
        f"💰 Your Points: *{stats['current_points']:,}*\n\n"
    )
    
    if not rewards:
        msg += "_No rewards available yet._"
    else:
        for r in rewards:
            can_afford = "✅" if stats['current_points'] >= r['cost'] else "🔒"
            duration = f" ({r['duration']}d)" if r['duration'] else ""
            msg += (
                f"{can_afford} {r['emoji']} *{r['name']}*{duration}\n"
                f"    {r['description']}\n"
                f"    💰 {r['cost']:,} points\n\n"
            )
    
    # Build reward buttons
    buttons = []
    for r in rewards[:6]:  # Max 6 rewards shown as buttons
        buttons.append(
            InlineKeyboardButton(
                f"{r['emoji']} {r['cost']}",
                callback_data=f"xp_redeem_{r['id']}"
            )
        )
    
    keyboard_rows = [buttons[i:i+3] for i in range(0, len(buttons), 3)]
    keyboard_rows.append([InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")])
    
    await update.message.reply_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard_rows),
    )


@enforce_tos
async def rewards_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle rewards browsing callback."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    from bot.models.user import User
    from database.db import get_session
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("Please start the bot first!", show_alert=True)
            return
        user_id = db_user.id
    
    stats = points_service.get_user_stats(user_id)
    rewards = points_service.get_available_rewards()
    
    msg = (
        f"🎁 *Rewards Store*\n\n"
        f"💰 Your Points: *{stats['current_points']:,}*\n\n"
    )
    
    if not rewards:
        msg += "_No rewards available yet._"
    else:
        for r in rewards:
            can_afford = "✅" if stats['current_points'] >= r['cost'] else "🔒"
            duration = f" ({r['duration']}d)" if r['duration'] else ""
            msg += (
                f"{can_afford} {r['emoji']} *{r['name']}*{duration}\n"
                f"    {r['description']}\n"
                f"    💰 {r['cost']:,} points\n\n"
            )
    
    # Build reward buttons
    buttons = []
    for r in rewards[:6]:
        buttons.append(
            InlineKeyboardButton(
                f"{r['emoji']} {r['cost']}",
                callback_data=f"xp_redeem_{r['id']}"
            )
        )
    
    keyboard_rows = [buttons[i:i+3] for i in range(0, len(buttons), 3)]
    keyboard_rows.append([InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard_rows),
    )


# ============== Redeem Reward ==============

@enforce_tos
async def redeem_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle reward redemption."""
    query = update.callback_query
    user = update.effective_user
    
    from bot.models.user import User
    from bot.models.points import Reward
    from database.db import get_session
    
    # Parse reward ID
    try:
        reward_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.answer("Invalid reward!", show_alert=True)
        return
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("Please start the bot first!", show_alert=True)
            return
        user_id = db_user.id
        
        reward = session.query(Reward).filter(Reward.id == reward_id).first()
        if not reward:
            await query.answer("Reward not found!", show_alert=True)
            return
        
        reward_name = reward.name
        reward_cost = reward.points_cost
        reward_type = reward.reward_type
        reward_value = reward.reward_value
    
    # Attempt to redeem
    success, message = points_service.spend_points(
        user_id=user_id,
        amount=reward_cost,
        reward_type=reward_type,
        reward_value=reward_value,
    )
    
    if success:
        await query.answer(f"🎉 Redeemed {reward_name}!", show_alert=True)
        
        # Apply reward effect (fee discount, gas rebate, etc.)
        # This would integrate with fee_service and swap flow
        
        msg = (
            f"🎉 *Reward Redeemed!*\n\n"
            f"You got: *{reward_name}*\n"
            f"Cost: {reward_cost:,} points\n\n"
            f"_{message}_"
        )
    else:
        await query.answer(message, show_alert=True)
        return  # Don't update message on failure
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🎁 More Rewards", callback_data="xp_rewards"),
            InlineKeyboardButton("📊 My Stats", callback_data="xp_stats"),
        ]
    ])
    
    await query.edit_message_text(
        msg,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ============== No-op callback ==============

async def noop_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle no-op callbacks."""
    query = update.callback_query
    await query.answer()


async def points_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle points menu callback - show main points menu."""
    query = update.callback_query
    await query.answer()

    text = (
        "✨ *Points & Rewards*\n\n"
        "Earn XP points and unlock exclusive rewards!\n\n"
        "• ✨ View your XP and level\n"
        "• 📅 Daily check-in bonus\n"
        "• 🏆 Climb the leaderboard\n"
        "• 🎁 Redeem rewards with points"
    )

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("✨ My XP", callback_data="xp_stats")],
        [InlineKeyboardButton("📅 Daily Check-in", callback_data="xp_checkin")],
        [InlineKeyboardButton("🏆 Leaderboard", callback_data="xp_leaderboard")],
        [InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ])

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ============== /quests Command ==============

@enforce_tos
async def quests_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show daily quests."""
    user = update.effective_user
    from database.db import get_session
    from bot.models.user import User

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please /start first.")
            return
        user_id = db_user.id

    quests = points_service.get_today_quests(user_id)
    jackpot = points_service.get_jackpot_info()

    msg = "🎯 *Daily Quests*\n\n"

    for q in quests:
        if q["claimed"]:
            status = "✅"
        elif q["is_completed"]:
            status = "🎉"
        else:
            status = f"{q['progress']}/{q['target']}"

        # Progress bar
        pct = min(q["progress"] / q["target"], 1.0) if q["target"] > 0 else 0
        bar_len = 8
        filled = int(pct * bar_len)
        bar = "█" * filled + "░" * (bar_len - filled)

        msg += f"{status} {q['description']}\n"
        msg += f"   {bar} +{q['points_reward']} pts\n\n"

    msg += f"🎰 *Daily Jackpot:* ${jackpot['pool_usd']:.2f}\n"
    msg += "_Drawing at midnight UTC_"

    # Build claim buttons for completed but unclaimed quests
    buttons = []
    for q in quests:
        if q["is_completed"] and not q["claimed"]:
            buttons.append([InlineKeyboardButton(
                f"🎁 Claim: {q['description'][:30]}",
                callback_data=f"quest_claim_{q['quest_id']}"
            )])

    buttons.append([InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")])
    buttons.append([InlineKeyboardButton("« Back", callback_data="main_menu")])

    await update.message.reply_text(
        msg, parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


@enforce_tos
async def quests_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle quests menu callback (from xp_quests button)."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    from database.db import get_session
    from bot.models.user import User

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please /start first.")
            return
        user_id = db_user.id

    quests = points_service.get_today_quests(user_id)
    jackpot = points_service.get_jackpot_info()

    msg = "🎯 *Daily Quests*\n\n"

    for q in quests:
        if q["claimed"]:
            status = "✅"
        elif q["is_completed"]:
            status = "🎉"
        else:
            status = f"{q['progress']}/{q['target']}"

        pct = min(q["progress"] / q["target"], 1.0) if q["target"] > 0 else 0
        bar_len = 8
        filled = int(pct * bar_len)
        bar = "█" * filled + "░" * (bar_len - filled)

        msg += f"{status} {q['description']}\n"
        msg += f"   {bar} +{q['points_reward']} pts\n\n"

    msg += f"🎰 *Daily Jackpot:* ${jackpot['pool_usd']:.2f}\n"
    msg += "_Drawing at midnight UTC_"

    buttons = []
    for q in quests:
        if q["is_completed"] and not q["claimed"]:
            buttons.append([InlineKeyboardButton(
                f"🎁 Claim: {q['description'][:30]}",
                callback_data=f"quest_claim_{q['quest_id']}"
            )])

    buttons.append([InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")])
    buttons.append([InlineKeyboardButton("« Back", callback_data="main_menu")])

    await query.edit_message_text(
        msg, parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def quest_claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle quest reward claim."""
    query = update.callback_query
    await query.answer()

    quest_id = int(query.data.replace("quest_claim_", ""))
    user = update.effective_user

    from database.db import get_session
    from bot.models.user import User

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("Please start the bot first!", show_alert=True)
            return
        user_id = db_user.id

    success, points, msg = points_service.claim_quest_reward(user_id, quest_id)

    if success:
        await query.answer(f"🎉 +{points} points!", show_alert=True)
    else:
        await query.answer(msg, show_alert=True)
        return

    # Refresh quests view
    quests = points_service.get_today_quests(user_id)
    jackpot = points_service.get_jackpot_info()

    text = "🎯 *Daily Quests*\n\n"
    for q in quests:
        if q["claimed"]:
            status = "✅"
        elif q["is_completed"]:
            status = "🎉"
        else:
            status = f"{q['progress']}/{q['target']}"
        pct = min(q["progress"] / q["target"], 1.0) if q["target"] > 0 else 0
        bar_len = 8
        filled = int(pct * bar_len)
        bar = "█" * filled + "░" * (bar_len - filled)
        text += f"{status} {q['description']}\n   {bar} +{q['points_reward']} pts\n\n"

    text += f"🎰 *Daily Jackpot:* ${jackpot['pool_usd']:.2f}\n_Drawing at midnight UTC_"

    buttons = []
    for q in quests:
        if q["is_completed"] and not q["claimed"]:
            buttons.append([InlineKeyboardButton(f"🎁 Claim: {q['description'][:30]}", callback_data=f"quest_claim_{q['quest_id']}")])
    buttons.append([InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")])

    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(buttons))


# ============== Register Handlers ==============

xp_handler = CommandHandler("xp", xp_command)
checkin_handler = CommandHandler("checkin", checkin_command)
leaderboard_handler = CommandHandler("lb", leaderboard_command)
rewards_handler = CommandHandler("rewards", rewards_command)

points_menu_callback_handler = CallbackQueryHandler(points_menu_callback, pattern="^points_menu$")
xp_callback_handler = CallbackQueryHandler(xp_callback, pattern="^xp_stats$")
checkin_callback_handler = CallbackQueryHandler(checkin_callback, pattern="^xp_checkin$")
leaderboard_callback_handler = CallbackQueryHandler(leaderboard_callback, pattern="^xp_leaderboard$")
rewards_callback_handler = CallbackQueryHandler(rewards_callback, pattern="^xp_rewards$")
redeem_callback_handler = CallbackQueryHandler(redeem_callback, pattern=r"^xp_redeem_\d+$")
noop_callback_handler = CallbackQueryHandler(noop_callback, pattern="^xp_noop$")
quests_handler = CommandHandler("quests", quests_command)
quests_callback_handler = CallbackQueryHandler(quests_callback, pattern="^xp_quests$")
quest_claim_callback_handler = CallbackQueryHandler(quest_claim_callback, pattern=r"^quest_claim_\d+$")

