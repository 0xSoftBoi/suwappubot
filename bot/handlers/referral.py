"""Referral and fee command handlers.

Commands:
- /ref - Show referral code and stats
- /fees - Show fee structure
- /rewards - Show referral rewards
"""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.services.referral_service import referral_service, MIN_CLAIM_USD
from bot.services.fee_service import fee_service
from bot.models.user import User
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)


# ============================================
# /ref - Referral Code & Stats
# ============================================


@enforce_tos
async def ref_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's referral code and stats."""
    user = update.effective_user

    # Get or create user in DB
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please start the bot first with /start")
            return

        user_id = db_user.id
        username = db_user.username

    # Get or create referral code
    code = referral_service.get_or_create_code(user_id, username)

    # Get bot username for link
    bot_username = (await context.bot.get_me()).username

    # Format and send message
    message = referral_service.format_referral_message(user_id, bot_username)

    await update.message.reply_text(
        message,
        parse_mode="Markdown",
        reply_markup=_ref_main_keyboard(user_id, code.code),
        disable_web_page_preview=True,
    )


def _ref_main_keyboard(user_id: int, code: str) -> InlineKeyboardMarkup:
    """Main referral menu keyboard. Surfaces a Claim button only when there are
    enough pending rewards to actually claim, so we never show a dead button."""
    pending_usd, _ = referral_service.get_pending_rewards(user_id)

    rows = [
        [
            InlineKeyboardButton("📊 My Rewards", callback_data="ref_rewards"),
            InlineKeyboardButton("👥 My Referrals", callback_data="ref_list"),
        ],
    ]
    if pending_usd >= MIN_CLAIM_USD:
        rows.append(
            [InlineKeyboardButton(f"💸 Claim ${pending_usd:.2f}", callback_data="ref_claim")]
        )
    rows.append(
        [
            InlineKeyboardButton("📣 Share Link", callback_data="ref_share"),
            InlineKeyboardButton("📋 Copy Code", callback_data=f"ref_copy_{code}"),
        ]
    )
    return InlineKeyboardMarkup(rows)


@enforce_tos
async def ref_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle referral-related callbacks."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user
    data = query.data

    # Get user from DB
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ User not found")
            return
        user_id = db_user.id

    if data == "ref_menu":
        # Entry point from the main "🎁 Referrals" button — render the main view.
        code = referral_service.get_or_create_code(user_id)
        bot_username = (await context.bot.get_me()).username
        message = referral_service.format_referral_message(user_id, bot_username)
        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=_ref_main_keyboard(user_id, code.code),
            disable_web_page_preview=True,
        )

    elif data == "ref_rewards":
        # Show rewards summary
        message = referral_service.format_rewards_message(user_id)

        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("⬅️ Back", callback_data="ref_back")],
            ]
        )

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    elif data == "ref_list":
        # Show referrals list
        referrals = referral_service.get_referrals_list(user_id, limit=10)

        if not referrals:
            message = (
                "👥 *Your Referrals*\n\n"
                "You haven't referred anyone yet!\n\n"
                "Share your referral link to start earning 30% of their fees."
            )
        else:
            message = "👥 *Your Referrals*\n\n"
            for i, ref in enumerate(referrals, 1):
                username = ref["username"][:15]
                rewards = ref["total_rewards_usd"]
                date = ref["joined_at"].strftime("%m/%d")
                message += f"{i}. {username} - ${rewards:.2f} (joined {date})\n"

            message += f"\n_Showing top {len(referrals)} referrals_"

        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("⬅️ Back", callback_data="ref_back")],
            ]
        )

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    elif data == "ref_share":
        # Send a forwardable share message the user can forward to friends.
        bot_username = (await context.bot.get_me()).username
        share_message = referral_service.format_share_message(user_id, bot_username)
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=share_message,
            parse_mode="Markdown",
            disable_web_page_preview=True,
        )
        await query.answer("Forward the message below to invite friends! 📣")

    elif data == "ref_claim":
        # Atomically claim eligible rewards → credit custodial USDC ledger.
        success, claim_msg, _ = referral_service.claim_rewards(user_id)
        code = referral_service.get_or_create_code(user_id)
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("⬅️ Back", callback_data="ref_back")]]
        )
        if success:
            await query.edit_message_text(claim_msg, parse_mode="Markdown", reply_markup=keyboard)
        else:
            # Re-render the main view (with whatever buttons are still valid) and
            # surface the reason as a non-blocking toast.
            bot_username = (await context.bot.get_me()).username
            await query.edit_message_text(
                referral_service.format_referral_message(user_id, bot_username),
                parse_mode="Markdown",
                reply_markup=_ref_main_keyboard(user_id, code.code),
                disable_web_page_preview=True,
            )
            await query.answer(claim_msg, show_alert=True)

    elif data.startswith("ref_copy_"):
        code = data.replace("ref_copy_", "")
        await query.answer(f"Code: {code} - Share it with friends!", show_alert=True)

    elif data == "ref_back":
        # Go back to main referral view
        code = referral_service.get_or_create_code(user_id)
        bot_username = (await context.bot.get_me()).username
        message = referral_service.format_referral_message(user_id, bot_username)

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=_ref_main_keyboard(user_id, code.code),
            disable_web_page_preview=True,
        )


# ============================================
# /fees - Fee Structure
# ============================================


@enforce_tos
async def fees_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show the fee structure."""
    message = fee_service.format_fee_info()

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🎁 Referral Program", callback_data="fees_referral"),
            ],
        ]
    )

    await update.message.reply_text(
        message,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


async def fees_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle fee-related callbacks."""
    query = update.callback_query
    await query.answer()

    if query.data == "fees_referral":
        user = update.effective_user

        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            if not db_user:
                await query.edit_message_text("❌ Please /start first")
                return
            user_id = db_user.id
            username = db_user.username

        code = referral_service.get_or_create_code(user_id, username)
        bot_username = (await context.bot.get_me()).username

        message = (
            "🎁 *Referral Program*\n\n"
            f"Your code: `{code.code}`\n"
            f"Share link: t.me/{bot_username}?start={code.code}\n\n"
            "*How it works:*\n"
            "1. Share your code/link with friends\n"
            "2. They sign up and make swaps\n"
            "3. You earn *30%* of all their fees!\n\n"
            "_This is one of the highest referral rates in the industry!_"
        )

        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("⬅️ Back to Fees", callback_data="fees_back")],
            ]
        )

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    elif query.data == "fees_back":
        message = fee_service.format_fee_info()

        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("🎁 Referral Program", callback_data="fees_referral"),
                ],
            ]
        )

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )


# ============================================
# /rewards - Referral Rewards
# ============================================


@enforce_tos
async def rewards_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show referral rewards summary."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please start the bot first with /start")
            return
        user_id = db_user.id

    message = referral_service.format_rewards_message(user_id)

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🎁 My Referral Code", callback_data="rewards_ref"),
            ],
        ]
    )

    await update.message.reply_text(
        message,
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


async def rewards_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle rewards-related callbacks."""
    query = update.callback_query
    await query.answer()

    if query.data == "rewards_ref":
        user = update.effective_user

        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            if not db_user:
                await query.edit_message_text("❌ User not found")
                return
            user_id = db_user.id
            username = db_user.username

        code = referral_service.get_or_create_code(user_id, username)  # noqa: F841
        bot_username = (await context.bot.get_me()).username
        message = referral_service.format_referral_message(user_id, bot_username)

        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("⬅️ Back to Rewards", callback_data="rewards_back")],
            ]
        )

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=keyboard,
            disable_web_page_preview=True,
        )

    elif query.data == "rewards_back":
        user = update.effective_user

        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            user_id = db_user.id if db_user else 0

        message = referral_service.format_rewards_message(user_id)

        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("🎁 My Referral Code", callback_data="rewards_ref"),
                ],
            ]
        )

        await query.edit_message_text(
            message,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )


# ============================================
# Handler Registration
# ============================================

# Command handlers for main.py
referral_handler = CommandHandler("ref", ref_command)
fees_command_handler = CommandHandler("fees", fees_command)
rewards_command_handler = CommandHandler("rewards", rewards_command)

# Callback handlers for main.py
ref_menu_callback_handler = CallbackQueryHandler(ref_callback, pattern="^ref_")
ref_list_callback_handler = CallbackQueryHandler(ref_callback, pattern="^ref_list")
ref_claim_callback_handler = CallbackQueryHandler(ref_callback, pattern="^ref_copy_")
fees_callback_handler = CallbackQueryHandler(fees_callback, pattern="^fees_")
rewards_callback_handler = CallbackQueryHandler(rewards_callback, pattern="^rewards_")


def get_referral_handlers():
    """Get all referral-related handlers."""
    return [
        # Commands (using short versions)
        referral_handler,
        fees_command_handler,
        rewards_command_handler,
        # Callbacks
        ref_menu_callback_handler,
        ref_list_callback_handler,
        ref_claim_callback_handler,
        fees_callback_handler,
        rewards_callback_handler,
    ]
