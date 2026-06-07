"""SUWP token commands -- claim points, stake, check rewards."""
import logging
from decimal import Decimal
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler,
    ConversationHandler, MessageHandler, filters
)
from database.db import get_session
from bot.models.user import User
from bot.services.staking_service import staking_service, POINTS_PER_SUWP
from bot.models.points import UserPoints

logger = logging.getLogger(__name__)

ENTER_CLAIM_AMOUNT, ENTER_STAKE_AMOUNT, ENTER_WALLET = range(3)


async def token_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show SUWP token overview: points balance, staking position, pending rewards."""
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return

        user_pts = session.query(UserPoints).filter(UserPoints.user_id == db_user.id).first()
        current_points = getattr(user_pts, 'current_points', 0) or 0
        claimable_suwp = current_points // POINTS_PER_SUWP
        db_user_id = db_user.id

    pos = staking_service.get_staking_position(db_user_id)
    staked = float(pos.suwp_staked) if pos else 0.0
    stats = staking_service.get_staking_stats()
    pending_rewards = staking_service.get_pending_rewards(db_user_id)
    pending_usdc = sum(float(r.usdc_reward) for r in pending_rewards)
    pending_suwp_bonus = sum(float(r.suwp_bonus) for r in pending_rewards)

    total_staked = stats["total_suwp_staked"]
    share_pct = (staked / total_staked * 100) if total_staked > 0 else 0

    text = (
        f"*SUWP Token Dashboard*\n\n"
        f"*Your Points:* {current_points:,} pts\n"
        f"*Claimable SUWP:* {claimable_suwp:,} SUWP\n"
        f"_(1,000 pts = 1 SUWP)_\n\n"
        f"*Staking Position*\n"
        f"Staked: {staked:,.2f} SUWP\n"
        f"Pool share: {share_pct:.2f}%\n"
        f"Total pool: {total_staked:,.0f} SUWP\n\n"
        f"*Pending Rewards*\n"
        f"USDC: ${pending_usdc:.4f}\n"
        f"SUWP bonus: {pending_suwp_bonus:.2f} SUWP\n\n"
        f"_Rewards distribute weekly from 20% of protocol fees_"
    )

    keyboard = []
    if claimable_suwp > 0:
        keyboard.append([InlineKeyboardButton(f"Claim {claimable_suwp} SUWP", callback_data="token_claim")])
    keyboard.append([
        InlineKeyboardButton("Stake SUWP", callback_data="token_stake"),
        InlineKeyboardButton("Unstake", callback_data="token_unstake"),
    ])
    if pending_usdc > 0 or pending_suwp_bonus > 0:
        keyboard.append([InlineKeyboardButton("Claim Rewards", callback_data="token_claim_rewards")])
    keyboard.append([InlineKeyboardButton("Back", callback_data="main_menu")])

    effective_message = update.message or update.callback_query.message
    if update.message:
        await effective_message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.callback_query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))


async def token_claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Initiate points -> SUWP claim."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        user_pts = session.query(UserPoints).filter(UserPoints.user_id == db_user.id).first() if db_user else None
        current_points = getattr(user_pts, 'current_points', 0) or 0

    max_suwp = current_points // POINTS_PER_SUWP
    await query.edit_message_text(
        f"*Claim SUWP Tokens*\n\n"
        f"You have *{current_points:,} points* -> up to *{max_suwp} SUWP*\n\n"
        f"Enter your Base wallet address to receive SUWP:\n"
        f"_(SUWP is distributed weekly -- pending claims are batched)_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Cancel", callback_data="token_menu")]]),
    )
    context.user_data["token_action"] = "claim"
    context.user_data["token_claim_max_pts"] = current_points
    return ENTER_WALLET


async def token_stake_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show staking instructions."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "*Stake SUWP*\n\n"
        "To stake:\n"
        "1. Get SUWP on Base (from claim or DEX)\n"
        "2. Send your SUWP staking amount and wallet address here\n\n"
        "Enter your Base wallet address that holds SUWP:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Cancel", callback_data="token_menu")]]),
    )
    context.user_data["token_action"] = "stake"
    return ENTER_WALLET


async def token_unstake_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show unstake instructions (skeleton)."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        db_user_id = db_user.id if db_user else None

    pos = staking_service.get_staking_position(db_user_id) if db_user_id else None
    staked = float(pos.suwp_staked) if pos else 0.0

    if staked <= 0:
        await query.edit_message_text(
            "You have no active staking position to unstake.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Back", callback_data="token_menu")]]),
        )
        return ConversationHandler.END

    await query.edit_message_text(
        f"*Unstake SUWP*\n\n"
        f"Currently staked: *{staked:,.2f} SUWP*\n\n"
        f"On-chain unstaking is processed via the weekly batch settlement. "
        f"Contact support or use the staking contract directly on Base to initiate unstaking.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Back", callback_data="token_menu")]]),
    )
    return ConversationHandler.END


async def token_claim_rewards_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show pending rewards summary and claim instructions (skeleton)."""
    query = update.callback_query
    await query.answer()
    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        db_user_id = db_user.id if db_user else None

    pending_rewards = staking_service.get_pending_rewards(db_user_id) if db_user_id else []
    pending_usdc = sum(float(r.usdc_reward) for r in pending_rewards)
    pending_suwp_bonus = sum(float(r.suwp_bonus) for r in pending_rewards)

    if not pending_rewards:
        await query.edit_message_text(
            "No pending rewards at this time. Rewards are distributed weekly.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Back", callback_data="token_menu")]]),
        )
        return ConversationHandler.END

    await query.edit_message_text(
        f"*Claim Rewards*\n\n"
        f"Pending USDC: *${pending_usdc:.4f}*\n"
        f"Pending SUWP bonus: *{pending_suwp_bonus:.2f} SUWP*\n\n"
        f"Rewards are settled on-chain weekly to your registered staking wallet. "
        f"No action required -- they will be sent automatically at the next epoch distribution.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Back", callback_data="token_menu")]]),
    )
    return ConversationHandler.END


async def token_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route token_menu callback back to the token dashboard."""
    query = update.callback_query
    await query.answer()
    # Reuse token_command logic via effective_user path
    await token_command(update, context)
    return ConversationHandler.END


async def receive_wallet_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive wallet address, then ask for amount."""
    wallet = update.message.text.strip()
    if not (wallet.startswith("0x") and len(wallet) == 42):
        await update.message.reply_text("Invalid Base wallet address. Must be 0x... (42 chars).")
        return ENTER_WALLET
    context.user_data["token_wallet"] = wallet
    action = context.user_data.get("token_action")
    if action == "claim":
        max_pts = context.user_data.get("token_claim_max_pts", 0)
        await update.message.reply_text(
            f"How many points to convert? (multiples of {POINTS_PER_SUWP:,})\n"
            f"Max: {max_pts:,} pts -> {max_pts // POINTS_PER_SUWP} SUWP\n\n"
            f"Enter number of points (e.g. 5000 = 5 SUWP):"
        )
        return ENTER_CLAIM_AMOUNT
    elif action == "stake":
        await update.message.reply_text(
            "How many SUWP to register as staked?\n"
            "(You must hold them in your wallet on Base)\n\n"
            "Enter amount (e.g. 100):"
        )
        return ENTER_STAKE_AMOUNT
    return ConversationHandler.END


async def receive_claim_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Process points -> SUWP claim."""
    try:
        points = int(update.message.text.strip().replace(",", ""))
    except ValueError:
        await update.message.reply_text("Enter a whole number.")
        return ENTER_CLAIM_AMOUNT

    user = update.effective_user
    wallet = context.user_data.get("token_wallet")
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        db_user_id = db_user.id if db_user else None

    if not db_user_id:
        await update.message.reply_text("User not found. Please /start first.")
        return ConversationHandler.END

    try:
        claim = await staking_service.claim_points_for_suwp(db_user_id, points, wallet)
        suwp = float(claim.suwp_amount)
        await update.message.reply_text(
            f"*Claim submitted!*\n\n"
            f"Burning {claim.points_burned:,} points -> {suwp:.2f} SUWP\n"
            f"Wallet: `{wallet}`\n\n"
            f"SUWP will be sent to your wallet in the next weekly distribution.",
            parse_mode="Markdown",
        )
    except ValueError as e:
        await update.message.reply_text(f"{e}")
    return ConversationHandler.END


async def receive_stake_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Register staking position."""
    try:
        amount = Decimal(update.message.text.strip().replace(",", ""))
        if amount <= 0:
            raise ValueError("Amount must be positive")
    except Exception:
        await update.message.reply_text("Enter a positive number.")
        return ENTER_STAKE_AMOUNT

    user = update.effective_user
    wallet = context.user_data.get("token_wallet")
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        db_user_id = db_user.id if db_user else None

    if not db_user_id:
        await update.message.reply_text("User not found. Please /start first.")
        return ConversationHandler.END

    try:
        pos = staking_service.register_stake(db_user_id, wallet, amount)
        await update.message.reply_text(
            f"*Staking position registered!*\n\n"
            f"Staked: {float(pos.suwp_staked):,.2f} SUWP\n"
            f"Wallet: `{wallet}`\n\n"
            f"You'll earn USDC + SUWP rewards each week proportional to your stake.",
            parse_mode="Markdown",
        )
    except ValueError as e:
        await update.message.reply_text(f"{e}")
    return ConversationHandler.END


async def _cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


# ConversationHandler for export
token_conv_handler = ConversationHandler(
    entry_points=[
        CommandHandler("token", token_command),
        CommandHandler("suwp", token_command),
        CallbackQueryHandler(token_claim_callback, pattern="^token_claim$"),
        CallbackQueryHandler(token_stake_callback, pattern="^token_stake$"),
    ],
    states={
        ENTER_WALLET: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_wallet_address)],
        ENTER_CLAIM_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_claim_amount)],
        ENTER_STAKE_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_stake_amount)],
    },
    fallbacks=[CommandHandler("cancel", _cancel)],
    name="token_conv",
    persistent=False,
)

# Standalone callback handlers for buttons outside the conversation flow
token_menu_callback_handler = CallbackQueryHandler(token_menu_callback, pattern="^token_menu$")
token_unstake_callback_handler = CallbackQueryHandler(token_unstake_callback, pattern="^token_unstake$")
token_claim_rewards_callback_handler = CallbackQueryHandler(token_claim_rewards_callback, pattern="^token_claim_rewards$")
