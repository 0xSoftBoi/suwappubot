"""Telegram handler for rewards & tier commands."""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler,
    ConversationHandler,
)

from bot.services.token_service import token_service, TIER_THRESHOLDS
from bot.services.revenue_sharing import revenue_sharing

logger = logging.getLogger(__name__)

# Conversation states
TOKEN_MENU = 0

TIER_EMOJI = {"bronze": "🥉", "silver": "🥈", "gold": "🥇", "diamond": "💎"}


async def token_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /rewards command — show tier dashboard."""
    user_id = update.effective_user.id

    # Refresh tier from latest XP + volume
    tier_record = token_service.refresh_tier(user_id)
    fee_discount = token_service.get_fee_discount(user_id)

    text = "🏆 **Rewards Dashboard**\n\n"

    # Tier status
    emoji = TIER_EMOJI.get(tier_record.tier, "⚪")
    rewards = float(tier_record.accumulated_rewards or 0)

    if tier_record.tier != "none":
        text += (
            f"**Tier:** {emoji} {tier_record.tier.title()}\n"
            f"**XP:** {tier_record.qualifying_xp:,}\n"
            f"**Trade Volume:** ${float(tier_record.qualifying_volume_usd):,.0f}\n"
            f"**Fee Discount:** {fee_discount:.0f}%\n"
            f"**Pending Rewards:** ${rewards:,.4f}\n\n"
        )
    else:
        text += (
            "**Tier:** ⚪ None\n"
            f"**XP:** {tier_record.qualifying_xp:,}\n"
            f"**Trade Volume:** ${float(tier_record.qualifying_volume_usd):,.0f}\n\n"
            "Keep trading and earning XP to unlock tiers!\n\n"
        )

    # Tier requirements
    text += (
        "**Tier Requirements** (XP + Volume):\n"
        "🥉 Bronze — 1K XP + $500 vol → 10% fee discount\n"
        "🥈 Silver — 10K XP + $5K vol → 20% fee discount\n"
        "🥇 Gold — 100K XP + $50K vol → 30% fee discount\n"
        "💎 Diamond — 1M XP + $500K vol → 50% fee discount\n"
    )

    # Buttons
    keyboard = []

    if rewards > 0:
        keyboard.append([InlineKeyboardButton("💰 Claim Rewards", callback_data="token_claim")])

    keyboard.append([InlineKeyboardButton("📊 Global Stats", callback_data="token_stats")])
    keyboard.append([InlineKeyboardButton("🔄 Refresh Tier", callback_data="token_refresh")])
    keyboard.append([InlineKeyboardButton("🔙 Back", callback_data="main_menu")])

    await update.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return TOKEN_MENU


async def token_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle rewards menu callbacks."""
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "token_claim":
        try:
            rewards = token_service.claim_rewards(query.from_user.id)
            await query.edit_message_text(
                f"💰 **Rewards Claimed!**\n\n"
                f"Amount: ${rewards:,.4f}\n\n"
                f"Rewards have been added to your wallet.",
                parse_mode="Markdown",
            )
        except ValueError as e:
            await query.edit_message_text(f"❌ {str(e)}")

        return TOKEN_MENU

    elif data == "token_stats":
        stats = revenue_sharing.get_rewards_stats()

        text = (
            "📊 **Rewards Stats**\n\n"
            f"Total Users: {stats['total_users']}\n"
            f"Eligible for Rewards: {stats['eligible_users']}\n"
            f"Pending Rewards: ${stats['total_rewards_pending']:,.2f}\n\n"
            "**Tier Distribution:**\n"
        )

        for tier, count in sorted(stats.get("tier_distribution", {}).items()):
            emoji = TIER_EMOJI.get(tier, "⚪")
            text += f"  {emoji} {tier.title()}: {count}\n"

        keyboard = [[InlineKeyboardButton("🔙 Back", callback_data="token_menu")]]

        await query.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return TOKEN_MENU

    elif data == "token_refresh":
        tier_record = token_service.refresh_tier(query.from_user.id)
        emoji = TIER_EMOJI.get(tier_record.tier, "⚪")
        fee_discount = token_service.get_fee_discount(query.from_user.id)

        await query.edit_message_text(
            f"🔄 **Tier Refreshed**\n\n"
            f"**Tier:** {emoji} {tier_record.tier.title()}\n"
            f"**XP:** {tier_record.qualifying_xp:,}\n"
            f"**Volume:** ${float(tier_record.qualifying_volume_usd):,.0f}\n"
            f"**Fee Discount:** {fee_discount:.0f}%\n\n"
            f"Use /rewards to see full dashboard.",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    elif data == "token_menu":
        # Can't call token_command directly since it uses update.message
        # Re-show via edit
        user_id = query.from_user.id
        tier_record = token_service.refresh_tier(user_id)
        fee_discount = token_service.get_fee_discount(user_id)
        emoji = TIER_EMOJI.get(tier_record.tier, "⚪")
        rewards = float(tier_record.accumulated_rewards or 0)

        text = "🏆 **Rewards Dashboard**\n\n"
        if tier_record.tier != "none":
            text += (
                f"**Tier:** {emoji} {tier_record.tier.title()}\n"
                f"**XP:** {tier_record.qualifying_xp:,}\n"
                f"**Trade Volume:** ${float(tier_record.qualifying_volume_usd):,.0f}\n"
                f"**Fee Discount:** {fee_discount:.0f}%\n"
                f"**Pending Rewards:** ${rewards:,.4f}\n\n"
            )
        else:
            text += (
                "**Tier:** ⚪ None\n"
                f"**XP:** {tier_record.qualifying_xp:,}\n"
                f"**Trade Volume:** ${float(tier_record.qualifying_volume_usd):,.0f}\n\n"
                "Keep trading and earning XP to unlock tiers!\n\n"
            )

        text += (
            "**Tier Requirements** (XP + Volume):\n"
            "🥉 Bronze — 1K XP + $500 vol → 10% fee discount\n"
            "🥈 Silver — 10K XP + $5K vol → 20% fee discount\n"
            "🥇 Gold — 100K XP + $50K vol → 30% fee discount\n"
            "💎 Diamond — 1M XP + $500K vol → 50% fee discount\n"
        )

        keyboard = []
        if rewards > 0:
            keyboard.append([InlineKeyboardButton("💰 Claim Rewards", callback_data="token_claim")])
        keyboard.append([InlineKeyboardButton("📊 Global Stats", callback_data="token_stats")])
        keyboard.append([InlineKeyboardButton("🔄 Refresh Tier", callback_data="token_refresh")])
        keyboard.append([InlineKeyboardButton("🔙 Back", callback_data="main_menu")])

        await query.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return TOKEN_MENU

    return TOKEN_MENU


# Conversation handler
token_conversation_handler = ConversationHandler(
    entry_points=[
        CommandHandler("rewards", token_command),
    ],
    states={
        TOKEN_MENU: [
            CallbackQueryHandler(token_menu_callback, pattern="^token_"),
        ],
    },
    fallbacks=[
        CommandHandler("rewards", token_command),
        CallbackQueryHandler(token_menu_callback, pattern="^main_menu$"),
    ],
    name="token_conversation",
    persistent=False,
)

# Callback handlers
token_menu_callback_handler = CallbackQueryHandler(token_menu_callback, pattern="^token_menu$")
