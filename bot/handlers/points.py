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
            await update.message.reply_text("❌ Please start the bot first with /start")
            return
        user_id = db_user.id

    msg = points_service.format_stats_message(user_id)

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("📊 Leaderboard", callback_data="xp_leaderboard"),
                InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards"),
            ],
            [
                InlineKeyboardButton("📅 Check In", callback_data="xp_checkin"),
            ],
        ]
    )

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

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("📊 Leaderboard", callback_data="xp_leaderboard"),
                InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards"),
            ],
            [
                InlineKeyboardButton("📅 Check In", callback_data="xp_checkin"),
            ],
        ]
    )

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
            await update.message.reply_text("❌ Please start the bot first with /start")
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
        # NOTE: XP-level fee discounts are not yet applied (the charged fee is set
        # by subscription tier, not XP level), so we don't promise a fee rate here.
        level_up_msg = (
            f"\n\n🎉 *LEVEL UP!*\n"
            f"You're now {level_info.get('emoji', '')} *{level_info.get('name', new_level)}*!\n"
            f"_Level perks (fee discounts) coming soon._"
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

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("📊 Leaderboard", callback_data="xp_leaderboard"),
                InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards"),
            ],
            [
                InlineKeyboardButton("✅ Checked In Today", callback_data="xp_noop"),
            ],
        ]
    )

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

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")]]
    )

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

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("📊 My Stats", callback_data="xp_stats")]]
    )

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
            await update.message.reply_text("❌ Please start the bot first with /start")
            return
        user_id = db_user.id

    stats = points_service.get_user_stats(user_id)
    rewards = points_service.get_available_rewards()

    msg = f"🎁 *Rewards Store*\n\n" f"💰 Your Points: *{stats['current_points']:,}*\n\n"

    if not rewards:
        msg += "_No rewards available yet._"
    else:
        for r in rewards:
            can_afford = "✅" if stats["current_points"] >= r["cost"] else "🔒"
            duration = f" ({r['duration']}d)" if r["duration"] else ""
            msg += (
                f"{can_afford} {r['emoji']} *{r['name']}*{duration}\n"
                f"    {r['description']}\n"
                f"    💰 {r['cost']:,} points\n\n"
            )

    # Build reward buttons
    buttons = []
    for r in rewards[:6]:  # Max 6 rewards shown as buttons
        buttons.append(
            InlineKeyboardButton(f"{r['emoji']} {r['cost']}", callback_data=f"xp_redeem_{r['id']}")
        )

    keyboard_rows = [buttons[i : i + 3] for i in range(0, len(buttons), 3)]
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

    msg = f"🎁 *Rewards Store*\n\n" f"💰 Your Points: *{stats['current_points']:,}*\n\n"

    if not rewards:
        msg += "_No rewards available yet._"
    else:
        for r in rewards:
            can_afford = "✅" if stats["current_points"] >= r["cost"] else "🔒"
            duration = f" ({r['duration']}d)" if r["duration"] else ""
            msg += (
                f"{can_afford} {r['emoji']} *{r['name']}*{duration}\n"
                f"    {r['description']}\n"
                f"    💰 {r['cost']:,} points\n\n"
            )

    # Build reward buttons
    buttons = []
    for r in rewards[:6]:
        buttons.append(
            InlineKeyboardButton(f"{r['emoji']} {r['cost']}", callback_data=f"xp_redeem_{r['id']}")
        )

    keyboard_rows = [buttons[i : i + 3] for i in range(0, len(buttons), 3)]
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
        reward_category = getattr(reward, "reward_category", None) or "own_product"
        reward_duration_days = reward.duration_days

    from bot.services.reward_providers import ASYNC_CATEGORIES

    # Async marketplace categories (gift_card/travel/merch/donation/experience) go
    # through the marketplace path, which debits + creates a fulfillment order and
    # REFUNDS while the marketplace is disabled (points never lost). gift_card now
    # routes here instead of the old hard reject.
    if reward_category in ASYNC_CATEGORIES:
        try:
            success, message, order_id = points_service.redeem_marketplace_reward(
                user_id=user_id, reward_id=reward_id
            )
        except NotImplementedError as e:
            # Defense-in-depth: redeem_marketplace_reward already treats a provider
            # crash (base RewardProvider.fulfill() raises NotImplementedError for
            # any category without a real provider wired) as a refunded failure, so
            # this should never actually surface — but never let a raw
            # NotImplementedError reach the redemption button regardless.
            logger.error(f"Reward provider not implemented for category {reward_category}: {e}")
            await query.answer("This reward option isn't available yet.", show_alert=True)
            return
        if success:
            await query.answer(f"🎉 Redeemed {reward_name}!", show_alert=True)
            msg = (
                f"🎉 *Reward Redeemed!*\n\n"
                f"You got: *{reward_name}*\n"
                f"Cost: {reward_cost:,} points\n\n"
                f"_{message}_"
            )
            keyboard = InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton("🎁 More Rewards", callback_data="xp_rewards"),
                        InlineKeyboardButton("📊 My Stats", callback_data="xp_stats"),
                    ]
                ]
            )
            await query.edit_message_text(
                msg,
                parse_mode="Markdown",
                reply_markup=keyboard,
            )
        else:
            await query.answer(message, show_alert=True)
        return

    # Cash-equivalent redemptions (airline miles, stablecoin cash-out) remain NOT
    # enabled: they cross the cash-equivalent line and require a partner integration +
    # compliance sign-off (see docs/economics/REDEMPTION_AND_PARTNERS.md). Reject rather
    # than silently deduct points for something we cannot fulfill.
    if reward_type in ("partner_transfer", "miles", "cashout", "stablecoin"):
        await query.answer(
            "That reward is coming soon — partner redemptions aren't live yet.",
            show_alert=True,
        )
        return

    # Subscription rewards grant a REAL tier via an atomic deduct+grant path; all
    # other reward types use the generic spend path (recorded; effect applied later).
    if reward_type == "subscription":
        success, message, _expiry = points_service.redeem_subscription_reward(
            user_id=user_id, reward_id=reward_id
        )
        effect_note = (
            "\n\n✅ _Your subscription is active now — the lower fee applies on your next swap._"
            if success
            else ""
        )
    else:
        success, message = points_service.spend_points(
            user_id=user_id,
            amount=reward_cost,
            reward_type=reward_type,
            reward_value=reward_value,
            duration_days=reward_duration_days,
        )
        # fee-discount / gas-rebate EFFECTS now auto-apply at swap time:
        #  • fee_discount — subtracted from your tier fee on every swap until it
        #    expires (floored at our best paid-tier rate; never below).
        #  • gas_rebate — applied once, to your very next successful swap.
        if reward_type == "fee_discount":
            effect_note = (
                "\n\n✅ _Active now — this discount comes off your swap fee "
                "automatically on every swap until it expires._"
            )
        elif reward_type == "gas_rebate":
            effect_note = (
                "\n\n✅ _Active now — this rebate is applied automatically to "
                "your next successful swap._"
            )
        else:
            effect_note = ""

    if success:
        await query.answer(f"🎉 Redeemed {reward_name}!", show_alert=True)
        msg = (
            f"🎉 *Reward Redeemed!*\n\n"
            f"You got: *{reward_name}*\n"
            f"Cost: {reward_cost:,} points\n\n"
            f"_{message}_{effect_note}"
        )
    else:
        await query.answer(message, show_alert=True)
        return  # Don't update message on failure

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🎁 More Rewards", callback_data="xp_rewards"),
                InlineKeyboardButton("📊 My Stats", callback_data="xp_stats"),
            ]
        ]
    )

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

    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("✨ My XP", callback_data="xp_stats")],
            [InlineKeyboardButton("📅 Daily Check-in", callback_data="xp_checkin")],
            [InlineKeyboardButton("🏆 Leaderboard", callback_data="xp_leaderboard")],
            [InlineKeyboardButton("🎁 Rewards", callback_data="xp_rewards")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
    )

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ============== Register Handlers ==============

xp_handler = CommandHandler("xp", xp_command)
checkin_handler = CommandHandler("checkin", checkin_command)
leaderboard_handler = CommandHandler("lb", leaderboard_command)
rewards_handler = CommandHandler("rewards", rewards_command)

points_menu_callback_handler = CallbackQueryHandler(points_menu_callback, pattern="^points_menu$")
xp_callback_handler = CallbackQueryHandler(xp_callback, pattern="^xp_stats$")
checkin_callback_handler = CallbackQueryHandler(checkin_callback, pattern="^xp_checkin$")
leaderboard_callback_handler = CallbackQueryHandler(
    leaderboard_callback, pattern="^xp_leaderboard$"
)
rewards_callback_handler = CallbackQueryHandler(rewards_callback, pattern="^xp_rewards$")
redeem_callback_handler = CallbackQueryHandler(redeem_callback, pattern=r"^xp_redeem_\d+$")
noop_callback_handler = CallbackQueryHandler(noop_callback, pattern="^xp_noop$")
