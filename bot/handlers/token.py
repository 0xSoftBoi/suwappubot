"""Telegram handler for $SUWAPPU token commands."""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler,
    ConversationHandler, MessageHandler, filters,
)

from bot.services.token_service import token_service, STAKE_TIERS
from bot.services.revenue_sharing import revenue_sharing

logger = logging.getLogger(__name__)

# Conversation states
TOKEN_MENU, TOKEN_STAKE_AMOUNT = range(2)


async def token_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /suwappu or /token command."""
    user_id = update.effective_user.id

    # Get stake info
    stake = token_service.get_stake(user_id)
    allocation = token_service.get_user_allocation(user_id)
    fee_discount = token_service.get_fee_discount(user_id)

    text = "🪙 **$SUWAPPU Token Dashboard**\n\n"

    # Staking section
    if stake:
        rewards = float(stake.accumulated_rewards or 0)
        text += (
            f"**Staked:** {float(stake.amount):,.0f} $SUWAPPU\n"
            f"**Tier:** {stake.tier.title()} {'🥉🥈🥇💎'.split()[['bronze','silver','gold','diamond'].index(stake.tier)] if stake.tier in ['bronze','silver','gold','diamond'] else '⚪'}\n"
            f"**Fee Discount:** {fee_discount:.0f}%\n"
            f"**Pending Rewards:** ${rewards:,.4f}\n"
        )
        if stake.unstake_requested_at:
            text += f"⏳ Unstaking in progress...\n"
        text += "\n"
    else:
        text += "**Not staking yet.** Stake $SUWAPPU to earn fee discounts + revenue share!\n\n"

    # Airdrop section
    if allocation:
        if allocation.claimed:
            text += f"✅ **Airdrop:** {float(allocation.allocation):,.0f} $SUWAPPU (claimed)\n\n"
        else:
            text += f"🎁 **Airdrop Available:** {float(allocation.allocation):,.0f} $SUWAPPU\n\n"

    # Tier info
    text += (
        "**Staking Tiers:**\n"
        "🥉 Bronze (1K) → 10% fee discount\n"
        "🥈 Silver (10K) → 20% fee discount\n"
        "🥇 Gold (100K) → 30% fee discount\n"
        "💎 Diamond (1M) → 50% fee discount\n"
    )

    # Buttons
    keyboard = []

    if stake:
        keyboard.append([
            InlineKeyboardButton("➕ Stake More", callback_data="token_stake"),
            InlineKeyboardButton("📤 Unstake", callback_data="token_unstake"),
        ])
        if float(stake.accumulated_rewards or 0) > 0:
            keyboard.append([InlineKeyboardButton("💰 Claim Rewards", callback_data="token_claim")])
    else:
        keyboard.append([InlineKeyboardButton("🔒 Stake $SUWAPPU", callback_data="token_stake")])

    if allocation and not allocation.claimed:
        keyboard.append([InlineKeyboardButton("🎁 Claim Airdrop", callback_data="token_airdrop")])

    keyboard.append([InlineKeyboardButton("📊 Staking Stats", callback_data="token_stats")])
    keyboard.append([InlineKeyboardButton("🔙 Back", callback_data="main_menu")])

    await update.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return TOKEN_MENU


async def token_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle token menu callbacks."""
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "token_stake":
        await query.edit_message_text(
            "🔒 **Stake $SUWAPPU**\n\n"
            "Enter the amount of $SUWAPPU tokens to stake:\n\n"
            "Minimum: 100 $SUWAPPU\n"
            "Example: `10000`",
            parse_mode="Markdown",
        )
        return TOKEN_STAKE_AMOUNT

    elif data == "token_unstake":
        stake = token_service.get_stake(query.from_user.id)
        if not stake:
            await query.edit_message_text("No active stake found.")
            return TOKEN_MENU

        try:
            result = token_service.request_unstake(query.from_user.id, stake.id)
            await query.edit_message_text(
                f"📤 **Unstake Requested**\n\n"
                f"Amount: {float(stake.amount):,.0f} $SUWAPPU\n"
                f"Cooldown: 7 days\n\n"
                f"Your tokens will be available for withdrawal after the cooldown period.",
                parse_mode="Markdown",
            )
        except ValueError as e:
            await query.edit_message_text(f"❌ {str(e)}")

        return TOKEN_MENU

    elif data == "token_claim":
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

    elif data == "token_airdrop":
        try:
            snapshot = token_service.claim_airdrop(query.from_user.id)
            if snapshot:
                await query.edit_message_text(
                    f"🎁 **Airdrop Claimed!**\n\n"
                    f"You received: {float(snapshot.allocation):,.0f} $SUWAPPU\n\n"
                    f"Tokens have been sent to your wallet.",
                    parse_mode="Markdown",
                )
            else:
                await query.edit_message_text("No airdrop available to claim.")
        except ValueError as e:
            await query.edit_message_text(f"❌ {str(e)}")

        return TOKEN_MENU

    elif data == "token_stats":
        stats = revenue_sharing.get_staking_stats()

        text = (
            "📊 **$SUWAPPU Staking Stats**\n\n"
            f"Total Stakers: {stats['total_stakers']}\n"
            f"Total Staked: {stats['total_staked']:,.0f} $SUWAPPU\n"
            f"Rewards Distributed: ${stats['total_rewards_distributed']:,.2f}\n\n"
            "**Tier Distribution:**\n"
        )

        for tier, count in sorted(stats.get("tier_distribution", {}).items()):
            emoji = {"bronze": "🥉", "silver": "🥈", "gold": "🥇", "diamond": "💎"}.get(tier, "⚪")
            text += f"  {emoji} {tier.title()}: {count}\n"

        keyboard = [[InlineKeyboardButton("🔙 Back", callback_data="token_menu")]]

        await query.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return TOKEN_MENU

    elif data == "token_menu":
        return await token_command(update, context)

    return TOKEN_MENU


async def token_stake_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle stake amount input."""
    try:
        amount = float(update.message.text.strip().replace(",", ""))
        if amount < 100:
            await update.message.reply_text("Minimum stake is 100 $SUWAPPU.")
            return TOKEN_STAKE_AMOUNT

        stake = token_service.stake(update.effective_user.id, amount)
        discount = STAKE_TIERS.get(stake.tier, {}).get("discount", 0)

        tier_emoji = {"bronze": "🥉", "silver": "🥈", "gold": "🥇", "diamond": "💎"}.get(stake.tier, "⚪")

        await update.message.reply_text(
            f"✅ **Staked {amount:,.0f} $SUWAPPU!**\n\n"
            f"Total Staked: {float(stake.amount):,.0f}\n"
            f"Tier: {tier_emoji} {stake.tier.title()}\n"
            f"Fee Discount: {discount:.0f}%\n\n"
            f"Use /suwappu to manage your stake.",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    except ValueError:
        await update.message.reply_text("Please enter a valid number.")
        return TOKEN_STAKE_AMOUNT


# Conversation handler
token_conversation_handler = ConversationHandler(
    entry_points=[
        CommandHandler("suwappu", token_command),
        CommandHandler("token", token_command),
    ],
    states={
        TOKEN_MENU: [
            CallbackQueryHandler(token_menu_callback, pattern="^token_"),
        ],
        TOKEN_STAKE_AMOUNT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, token_stake_amount),
        ],
    },
    fallbacks=[
        CommandHandler("suwappu", token_command),
        CommandHandler("token", token_command),
        CallbackQueryHandler(token_menu_callback, pattern="^main_menu$"),
    ],
    name="token_conversation",
    persistent=False,
)

# Callback handlers
token_menu_callback_handler = CallbackQueryHandler(token_menu_callback, pattern="^token_menu$")
