"""Subscription and x402 payment handlers."""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler, ConversationHandler,
    MessageHandler, filters
)

from bot.services.x402_service import x402_service, TIER_LIMITS
from bot.models.subscription import SubscriptionTier
from database.db import get_session
from bot.models.user import User

logger = logging.getLogger(__name__)


# Conversation states
SELECTING_TIER, SELECTING_CHAIN, CONFIRMING_PAYMENT = range(3)


async def subscription_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /subscription command - show subscription status and options."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first to register.")
            return
        user_id = db_user.id
    
    # Get current subscription
    sub = await x402_service.get_subscription(user_id)
    tier = await x402_service.get_tier(user_id)
    tier_info = x402_service.get_tier_info(tier)
    
    # Build status message
    status_emoji = {
        SubscriptionTier.FREE: "🆓",
        SubscriptionTier.PRO: "⭐",
        SubscriptionTier.PREMIUM: "💎",
        SubscriptionTier.ENTERPRISE: "🏢",
    }
    
    message = f"""
{status_emoji.get(tier, "📋")} **Your Subscription**

**Tier:** {tier.value.upper()}
**Daily Swaps:** {sub.api_calls_today} / {tier_info['daily_swaps'] if tier_info['daily_swaps'] != -1 else '∞'}
**Max Swap:** ${tier_info['max_swap_usd']:,.0f if tier_info['max_swap_usd'] != -1 else '∞'}

**Features:**
{_format_features(tier_info['features'])}
"""
    
    if sub.expires_at:
        message += f"\n⏰ **Expires:** {sub.expires_at.strftime('%Y-%m-%d')}"
    elif sub.token_address:
        message += f"\n🔐 **Token-Gated:** Hold {sub.min_token_balance} tokens"
    
    # Build keyboard
    keyboard = [
        [InlineKeyboardButton("⬆️ Upgrade Plan", callback_data="sub_upgrade")],
        [InlineKeyboardButton("🔐 Token Gate Access", callback_data="sub_tokengate")],
        [InlineKeyboardButton("💳 Buy API Credits", callback_data="sub_credits")],
        [InlineKeyboardButton("📊 Compare Plans", callback_data="sub_compare")],
    ]
    
    await update.message.reply_text(
        message,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )


async def compare_plans_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show plan comparison."""
    query = update.callback_query
    await query.answer()
    
    message = """
📊 **Subscription Plans**

🆓 **FREE** - $0/month
• 5 swaps/day
• $1,000 max swap
• Basic features

⭐ **PRO** - $9.99/month
• 50 swaps/day
• $50,000 max swap
• Price alerts & limit orders
• DCA automation
• Portfolio tracking

💎 **PREMIUM** - $29.99/month
• 500 swaps/day
• $500,000 max swap
• All PRO features
• Tax export
• Priority execution
• Custom slippage

🏢 **ENTERPRISE** - $99.99/month
• Unlimited swaps
• No amount limits
• All features
• Priority support

━━━━━━━━━━━━━━━
💡 **Token Gate Access**
Hold tokens to unlock tiers without paying!
"""
    
    keyboard = [
        [
            InlineKeyboardButton("⭐ Get PRO", callback_data="sub_buy_pro"),
            InlineKeyboardButton("💎 Get PREMIUM", callback_data="sub_buy_premium"),
        ],
        [InlineKeyboardButton("🔙 Back", callback_data="sub_back")],
    ]
    
    await query.edit_message_text(
        message,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )


async def upgrade_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle upgrade button - show tier selection."""
    query = update.callback_query
    await query.answer()
    
    message = """
⬆️ **Upgrade Your Plan**

Select a subscription tier:
"""
    
    keyboard = [
        [InlineKeyboardButton("⭐ PRO - $9.99/mo", callback_data="sub_buy_pro")],
        [InlineKeyboardButton("💎 PREMIUM - $29.99/mo", callback_data="sub_buy_premium")],
        [InlineKeyboardButton("🏢 ENTERPRISE - $99.99/mo", callback_data="sub_buy_enterprise")],
        [InlineKeyboardButton("🔙 Cancel", callback_data="sub_back")],
    ]
    
    await query.edit_message_text(
        message,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )
    return SELECTING_TIER


async def select_tier_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle tier selection."""
    query = update.callback_query
    await query.answer()
    
    tier_map = {
        "sub_buy_pro": SubscriptionTier.PRO,
        "sub_buy_premium": SubscriptionTier.PREMIUM,
        "sub_buy_enterprise": SubscriptionTier.ENTERPRISE,
    }
    
    tier = tier_map.get(query.data)
    if not tier:
        await query.edit_message_text("❌ Invalid selection")
        return ConversationHandler.END
    
    context.user_data["selected_tier"] = tier
    tier_info = x402_service.get_tier_info(tier)
    
    message = f"""
💳 **Payment for {tier.value.upper()}**

**Price:** ${tier_info['price_usd']}/month

Select payment chain:
"""
    
    keyboard = [
        [InlineKeyboardButton("🔵 Base (USDC)", callback_data="chain_base")],
        [InlineKeyboardButton("🟣 Ethereum (USDC)", callback_data="chain_ethereum")],
        [InlineKeyboardButton("🟢 Polygon (USDC)", callback_data="chain_polygon")],
        [InlineKeyboardButton("🔙 Cancel", callback_data="sub_back")],
    ]
    
    await query.edit_message_text(
        message,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )
    return SELECTING_CHAIN


async def select_chain_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle chain selection and create payment."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    chain_map = {
        "chain_base": "base",
        "chain_ethereum": "ethereum",
        "chain_polygon": "polygon",
    }
    
    chain = chain_map.get(query.data)
    if not chain:
        await query.edit_message_text("❌ Invalid selection")
        return ConversationHandler.END
    
    tier = context.user_data.get("selected_tier")
    if not tier:
        await query.edit_message_text("❌ Session expired. Please start again.")
        return ConversationHandler.END
    
    # Get user ID
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return ConversationHandler.END
        user_id = db_user.id
    
    # Create payment request
    payment = await x402_service.create_subscription_payment(user_id, tier, chain)
    context.user_data["payment_id"] = payment.payment_id
    
    tier_info = x402_service.get_tier_info(tier)
    
    message = f"""
💳 **x402 Payment Request**

**Plan:** {tier.value.upper()}
**Amount:** {payment.amount} USDC
**Chain:** {chain.capitalize()}
**Recipient:** `{payment.recipient[:10]}...{payment.recipient[-8:]}`

━━━━━━━━━━━━━━━

📤 **Send Payment To:**
`{payment.recipient}`

**Amount:** `{payment.amount} USDC`

━━━━━━━━━━━━━━━

After sending, paste your transaction hash below.

⏰ Payment expires in 1 hour.
"""
    
    keyboard = [
        [InlineKeyboardButton("🔙 Cancel", callback_data="sub_back")],
    ]
    
    await query.edit_message_text(
        message,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )
    return CONFIRMING_PAYMENT


async def confirm_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify payment transaction hash."""
    tx_hash = update.message.text.strip()
    
    # Validate tx hash format
    if not tx_hash.startswith("0x") or len(tx_hash) != 66:
        await update.message.reply_text(
            "❌ Invalid transaction hash. Please send a valid hash (0x...)"
        )
        return CONFIRMING_PAYMENT
    
    payment_id = context.user_data.get("payment_id")
    if not payment_id:
        await update.message.reply_text("❌ Session expired. Please start again with /subscription")
        return ConversationHandler.END
    
    await update.message.reply_text("🔄 Verifying payment...")
    
    success, message = await x402_service.verify_payment(payment_id, tx_hash)
    
    if success:
        tier = context.user_data.get("selected_tier", SubscriptionTier.PRO)
        await update.message.reply_text(
            f"✅ **Payment Verified!**\n\n"
            f"Your subscription has been upgraded to **{tier.value.upper()}**!\n\n"
            f"Use /subscription to view your new features.",
            parse_mode="Markdown"
        )
    else:
        await update.message.reply_text(
            f"❌ **Payment verification failed**\n\n{message}\n\n"
            "Please try again or contact support."
        )
    
    return ConversationHandler.END


async def token_gate_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show token gate options."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id
    
    # Check available token gates
    qualified_gates = await x402_service.check_token_gates(user_id)
    
    message = """
🔐 **Token Gate Access**

Hold specific tokens to unlock subscription tiers without monthly payments!

**Available Token Gates:**
"""
    
    if qualified_gates:
        message += "\n✅ **You qualify for:**\n"
        for gate in qualified_gates:
            message += f"• {gate.name} ({gate.tier_granted.value.upper()})\n"
    else:
        message += "\n❌ You don't currently qualify for any token gates.\n"
    
    message += """
━━━━━━━━━━━━━━━

**Popular Token Gates:**
• Hold 1000+ SUWAPPU → PRO access
• Hold 10000+ SUWAPPU → PREMIUM access
• Hold 100+ UNI → PRO access
"""
    
    keyboard = [
        [InlineKeyboardButton("🔄 Check My Tokens", callback_data="sub_check_tokens")],
        [InlineKeyboardButton("🔙 Back", callback_data="sub_back")],
    ]
    
    await query.edit_message_text(
        message,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )


async def back_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle back button."""
    query = update.callback_query
    await query.answer()
    
    # Clear user data
    context.user_data.clear()
    
    await query.edit_message_text(
        "Use /subscription to view your subscription status.",
    )
    return ConversationHandler.END


def _format_features(features: list) -> str:
    """Format feature list for display."""
    if "all" in features:
        return "✅ All features unlocked"
    
    feature_names = {
        "basic_swap": "Basic Swaps",
        "balance": "Balance Check",
        "history": "Transaction History",
        "alerts": "Price Alerts",
        "limit_orders": "Limit Orders",
        "dca": "DCA Automation",
        "portfolio": "Portfolio Tracking",
        "tax_export": "Tax Export",
        "priority_execution": "Priority Execution",
        "custom_slippage": "Custom Slippage",
    }
    
    return "\n".join(f"✅ {feature_names.get(f, f)}" for f in features)


# Handlers
subscription_handler = CommandHandler("subscription", subscription_command)

subscription_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(upgrade_callback, pattern="^sub_upgrade$"),
    ],
    states={
        SELECTING_TIER: [
            CallbackQueryHandler(select_tier_callback, pattern="^sub_buy_"),
        ],
        SELECTING_CHAIN: [
            CallbackQueryHandler(select_chain_callback, pattern="^chain_"),
        ],
        CONFIRMING_PAYMENT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, confirm_payment),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(back_callback, pattern="^sub_back$"),
    ],
    per_message=False,
)

sub_compare_callback = CallbackQueryHandler(compare_plans_callback, pattern="^sub_compare$")
sub_tokengate_callback = CallbackQueryHandler(token_gate_callback, pattern="^sub_tokengate$")
sub_back_callback = CallbackQueryHandler(back_callback, pattern="^sub_back$")

