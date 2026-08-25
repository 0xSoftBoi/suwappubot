"""Access control decorators for feature gating."""

import logging
from functools import wraps
from typing import Optional
from telegram import Update
from telegram.ext import ContextTypes

from bot.services.x402_service import x402_service, SubscriptionTier
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


def require_subscription(
    min_tier: SubscriptionTier = SubscriptionTier.FREE,
    feature: Optional[str] = None,
):
    """
    Decorator to require a minimum subscription tier or feature access.

    Usage:
        @require_subscription(min_tier=SubscriptionTier.PRO)
        async def premium_handler(update, context):
            ...

        @require_subscription(feature="limit_orders")
        async def limit_order_handler(update, context):
            ...
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
            user = update.effective_user
            if not user:
                return

            # Get database user
            with get_session() as session:
                db_user = session.query(User).filter(User.telegram_id == user.id).first()
                if not db_user:
                    message = update.message or update.callback_query.message
                    await message.reply_text("❌ Please use /start first to register.")
                    return
                user_id = db_user.id

            # Check tier
            current_tier = await x402_service.get_tier(user_id)
            tier_order = [
                SubscriptionTier.FREE,
                SubscriptionTier.PRO,
                SubscriptionTier.PREMIUM,
                SubscriptionTier.ENTERPRISE,
            ]

            if tier_order.index(current_tier) < tier_order.index(min_tier):
                message = update.message or update.callback_query.message
                await message.reply_text(
                    f"🔒 **Premium Feature**\n\n"
                    f"This feature requires **{min_tier.value.upper()}** subscription.\n"
                    f"Your current tier: **{current_tier.value.upper()}**\n\n"
                    f"Use /sub to upgrade!",
                    parse_mode="Markdown",
                )
                return

            # Check specific feature access
            if feature:
                has_access = await x402_service.check_feature_access(user_id, feature)
                if not has_access:
                    message = update.message or update.callback_query.message
                    await message.reply_text(
                        "🔒 **Feature Locked**\n\n"
                        "This feature is not available on your current plan.\n\n"
                        "Use /sub to upgrade!",
                        parse_mode="Markdown",
                    )
                    return

            # Record API call
            await x402_service.record_api_call(user_id)

            return await func(update, context, *args, **kwargs)

        return wrapper

    return decorator


def require_feature(feature: str):
    """Shortcut decorator to require a specific feature."""
    return require_subscription(feature=feature)


def check_swap_limit(amount_usd: float):
    """
    Decorator to check swap limits before executing.

    Usage:
        @check_swap_limit(amount_usd=quote.from_amount_usd)
        async def execute_swap(update, context):
            ...
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
            user = update.effective_user
            if not user:
                return

            with get_session() as session:
                db_user = session.query(User).filter(User.telegram_id == user.id).first()
                if not db_user:
                    return
                user_id = db_user.id

            allowed, message = await x402_service.check_swap_limit(user_id, amount_usd)
            if not allowed:
                msg = update.message or update.callback_query.message
                await msg.reply_text(
                    f"⚠️ **Limit Reached**\n\n{message}\n\n" f"Use /sub to increase your limits!",
                    parse_mode="Markdown",
                )
                return

            return await func(update, context, *args, **kwargs)

        return wrapper

    return decorator


async def check_user_limits(user_id: int, amount_usd: float = 0) -> tuple[bool, str]:
    """
    Check if user can perform action based on subscription limits.

    Returns:
        (allowed, message) tuple
    """
    # Check swap limits
    allowed, msg = await x402_service.check_swap_limit(user_id, amount_usd)
    return allowed, msg


async def get_user_tier(telegram_id: int) -> SubscriptionTier:
    """Get user's subscription tier by Telegram ID."""
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == telegram_id).first()
        if not db_user:
            return SubscriptionTier.FREE
        return await x402_service.get_tier(db_user.id)


async def is_premium_user(telegram_id: int) -> bool:
    """Check if user has PRO or higher subscription."""
    tier = await get_user_tier(telegram_id)
    return tier in [SubscriptionTier.PRO, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]
