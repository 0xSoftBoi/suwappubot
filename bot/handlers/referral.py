"""Referral system handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.models.user import User
from bot.services.referral_service import referral_service
from bot.utils.formatters import format_usd
from database.db import get_session


async def referral_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /referral command - show referral dashboard."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    # Get or create referral code
    code = referral_service.get_or_create_code(user_id)
    stats = referral_service.get_referral_stats(user_id)
    
    bot_username = (await context.bot.get_me()).username
    ref_link = f"https://t.me/{bot_username}?start=ref_{code.code}"
    
    text = (
        f"🎁 *Referral Blitz*\n\n"
        f"Earn *{stats['reward_percentage']:.0f}%* of fees from referred users\n"
        f"＋ Instant bonuses for both of you (we know times are tough)\n\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🔗 *Your Referral Link:*\n"
        f"`{ref_link}`\n\n"
        f"📊 *Your Code:* `{code.code}`\n\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📈 *Statistics*\n"
        f"👥 Total Referrals: *{stats['total_referrals']}*\n"
        f"💰 Volume Generated: *{format_usd(stats['total_volume_usd'])}*\n"
        f"🎁 Total Rewards: *{format_usd(stats['total_rewards_usd'])}*\n"
        f"⏳ Pending: *{format_usd(stats['pending_rewards_usd'])}*"
    )
    
    keyboard = [
        [InlineKeyboardButton("📋 Copy Link", callback_data="ref_copy_link")],
        [InlineKeyboardButton("👥 My Referrals", callback_data="ref_list")],
        [InlineKeyboardButton("💸 Claim Rewards", callback_data="ref_claim")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
    
    await update.message.reply_text(
        text,
        parse_mode="MarkdownV2",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def ref_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle referral menu callback."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    code = referral_service.get_or_create_code(user_id)
    stats = referral_service.get_referral_stats(user_id)
    
    bot_username = (await context.bot.get_me()).username
    ref_link = f"https://t.me/{bot_username}?start=ref_{code.code}"
    
    text = (
        f"🎁 *Referral Blitz*\n\n"
        f"📊 *Your Code:* `{code.code}`\n"
        f"🔗 Link: `{ref_link}`\n\n"
        f"👥 Referrals: *{stats['total_referrals']}*\n"
        f"💰 Volume: *{format_usd(stats['total_volume_usd'])}*\n"
        f"🎁 Earned: *{format_usd(stats['total_rewards_usd'])}*\n"
        f"⏳ Pending: *{format_usd(stats['pending_rewards_usd'])}*"
    )
    
    keyboard = [
        [InlineKeyboardButton("👥 My Referrals", callback_data="ref_list")],
        [InlineKeyboardButton("💸 Claim Rewards", callback_data="ref_claim")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def ref_list_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show list of referred users."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    referrals = referral_service.get_referred_users(user_id)
    
    if not referrals:
        text = (
            "👥 *Your Referrals*\n\n"
            "_No referrals yet._\n\n"
            "Share your link to start earning!"
        )
    else:
        lines = ["👥 *Your Referrals*\n"]
        
        for ref in referrals[:10]:  # Show top 10
            username = ref["username"] or "Anonymous"
            lines.append(
                f"• @{username}\n"
                f"  Volume: {format_usd(ref['volume_usd'])} | "
                f"Earned: {format_usd(ref['rewards_earned_usd'])}"
            )
        
        if len(referrals) > 10:
            lines.append(f"\n_...and {len(referrals) - 10} more_")
        
        text = "\n".join(lines)
    
    keyboard = [
        [InlineKeyboardButton("« Back", callback_data="ref_menu")],
    ]
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def ref_claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle reward claim."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    pending = referral_service.get_pending_rewards(user_id)
    
    if pending < 1.0:  # Minimum $1 to claim
        text = (
            "💸 *Claim Rewards*\n\n"
            f"Pending: {format_usd(pending)}\n\n"
            "⚠️ Minimum $1.00 required to claim."
        )
    else:
        text = (
            "💸 *Claim Rewards*\n\n"
            f"Pending: {format_usd(pending)}\n\n"
            "Select how you'd like to receive your rewards:"
        )
    
    keyboard = []
    if pending >= 1.0:
        keyboard.append([
            InlineKeyboardButton("💵 Claim as USDC", callback_data="ref_claim_usdc"),
        ])
        keyboard.append([
            InlineKeyboardButton("🔄 Reinvest (Add to balance)", callback_data="ref_claim_reinvest"),
        ])
    
    keyboard.append([InlineKeyboardButton("« Back", callback_data="ref_menu")])
    
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def handle_referral_start(user_id: int, ref_code: str) -> str:
    """Handle referral code from /start command."""
    success, message = referral_service.apply_referral(user_id, ref_code)
    return message


# Create handlers
referral_handler = CommandHandler("referral", referral_command)
ref_menu_callback_handler = CallbackQueryHandler(ref_callback, pattern="^ref_menu$")
ref_list_callback_handler = CallbackQueryHandler(ref_list_callback, pattern="^ref_list$")
ref_claim_callback_handler = CallbackQueryHandler(ref_claim_callback, pattern="^ref_claim$")

