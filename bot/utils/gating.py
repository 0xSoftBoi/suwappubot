"""Feature gating decorator for tier-based access control."""

import functools
import logging
from typing import Callable, Any, Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from bot.models.subscription import SubscriptionTier
from bot.models.user import User
from bot.services.x402_service import x402_service as subscription_service
from database.db import get_session

logger = logging.getLogger(__name__)

# Tier hierarchy: ENTERPRISE > PREMIUM > PRO > FREE
_TIER_RANK = {
    SubscriptionTier.FREE: 0,
    SubscriptionTier.PRO: 1,
    SubscriptionTier.PREMIUM: 2,
    SubscriptionTier.ENTERPRISE: 3,
}


def require_tier(required_tier: SubscriptionTier):
    """
    Decorator to gate a Telegram handler based on the caller's subscription tier.

    Usage:
        @require_tier(SubscriptionTier.PRO)
        async def my_feature_handler(update, context):
            ...

    Notes:
    - ``Subscription.user_id`` is a FK to ``users.id`` (the DB id), NOT the
      Telegram id. Updates only carry the Telegram id, so we resolve
      telegram_id -> users.id before checking the tier. Skipping this resolution
      makes every gate read the wrong row and silently deny paying users.
    - Fail-closed: if the tier cannot be confirmed (user hasn't /start-ed, or a
      transient DB/lookup error), access is denied rather than granted, so the
      paywall never leaks on error.
    """

    def decorator(func: Callable[..., Any]):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            telegram_id = _extract_telegram_id(args, kwargs)

            if not telegram_id:
                # Can't identify the caller — this isn't a normal handler
                # invocation. Fail open so non-handler internal calls aren't broken.
                logger.warning(f"require_tier: no telegram_id for {func.__name__}; allowing")
                return await func(*args, **kwargs)

            db_user_id = _resolve_db_user_id(telegram_id)
            if db_user_id is None:
                # No account yet (or lookup failed) — can't have a paid tier.
                return await _send_gate_message(required_tier, args, not_started=True)

            try:
                user_tier = await subscription_service.get_tier(db_user_id)
            except Exception as e:  # transient DB / service error -> fail closed
                logger.error(f"require_tier: get_tier failed for user {db_user_id}: {e}")
                return await _send_gate_message(required_tier, args, error=True)

            if _TIER_RANK.get(user_tier, 0) >= _TIER_RANK.get(required_tier, 0):
                return await func(*args, **kwargs)

            return await _send_gate_message(required_tier, args)

        return wrapper

    return decorator


def _extract_telegram_id(args, kwargs) -> Optional[int]:
    """Extract the Telegram user id from a handler's (update, context) args."""
    if kwargs.get("telegram_id"):
        return kwargs["telegram_id"]

    for arg in args:
        if hasattr(arg, "effective_user") and arg.effective_user:
            return arg.effective_user.id
        if hasattr(arg, "from_user") and arg.from_user:
            return arg.from_user.id

    return None


def _resolve_db_user_id(telegram_id: int) -> Optional[int]:
    """Resolve a Telegram id to the internal ``users.id`` (None if no account)."""
    try:
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == telegram_id).first()
            return db_user.id if db_user else None
    except Exception as e:
        logger.error(f"require_tier: user lookup failed for telegram_id {telegram_id}: {e}")
        return None


def _upgrade_keyboard(required_tier: SubscriptionTier) -> InlineKeyboardMarkup:
    # callback_data must match the registered patterns in handlers/subscription.py:
    # "^sub_upgrade$" (the upgrade conversation entry point) is verified live.
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    f"⭐ Upgrade to {required_tier.value.upper()}", callback_data="sub_upgrade"
                )
            ]
        ]
    )


async def _send_gate_message(
    required_tier: SubscriptionTier, args, not_started: bool = False, error: bool = False
):
    """Reply to the user explaining why access was denied (callback- or message-driven)."""
    if not_started:
        msg = "👋 Send /start first, then this feature will be available on the right plan."
        keyboard = None
    elif error:
        msg = "⚠️ Couldn't verify your plan right now. Please try again in a moment."
        keyboard = None
    else:
        msg = (
            f"🔒 *{required_tier.value.upper()} feature*\n\n"
            f"This is part of the *{required_tier.value.upper()}* plan.\n"
            f"Upgrade with USDC on Base or card — tap below or send /sub."
        )
        keyboard = _upgrade_keyboard(required_tier)
        logger.info(f"require_tier: denied {required_tier.value} feature")

    for arg in args:
        cq = getattr(arg, "callback_query", None)
        if cq is not None:
            await cq.answer()
            await cq.edit_message_text(msg, parse_mode="Markdown", reply_markup=keyboard)
            return None
        message = getattr(arg, "message", None)
        if message is not None:
            await message.reply_text(msg, parse_mode="Markdown", reply_markup=keyboard)
            return None

    return None
