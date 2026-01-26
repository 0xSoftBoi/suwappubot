"""Feature gating decorator for tier-based access control."""

import functools
import logging
from typing import Callable, Any, Optional

from bot.models.subscription import SubscriptionTier
from bot.services.x402_service import x402_service as subscription_service
from database.db import get_session

logger = logging.getLogger(__name__)

def require_tier(required_tier: SubscriptionTier):
    """
    Decorator to gate functions or handlers based on user subscription tier.
    
    Usage:
        @require_tier(SubscriptionTier.PRO)
        async def my_feature_handler(update, context):
            ...
    """
    def decorator(func: Callable[..., Any]):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract user_id from arguments (handles typical TG update objects)
            user_id = _extract_user_id(args, kwargs)
            
            if not user_id:
                logger.warning(f"Could not extract user_id for feature gate: {func.__name__}")
                return await func(*args, **kwargs)

            # Check user tier
            user_tier = await subscription_service.get_user_tier(user_id)
            
            # Tier hierarchy: ENTERPRISE > PREMIUM > PRO > FREE
            tier_values = {
                SubscriptionTier.FREE: 0,
                SubscriptionTier.PRO: 1,
                SubscriptionTier.PREMIUM: 2,
                SubscriptionTier.ENTERPRISE: 3
            }
            
            if tier_values.get(user_tier, 0) >= tier_values.get(required_tier, 0):
                return await func(*args, **kwargs)
            
            # Access denied - Send upsell message
            return await _send_upsell_message(user_id, required_tier, args, kwargs)
            
        return wrapper
    return decorator

def _extract_user_id(args, kwargs) -> Optional[int]:
    """Helper to extract user_id from function arguments."""
    # Attempt to find user_id in common handler patterns
    if kwargs.get("user_id"):
        return kwargs["user_id"]
    
    # Check if first arg is context or update
    for arg in args:
        if hasattr(arg, "effective_user") and arg.effective_user:
            return arg.effective_user.id
        if hasattr(arg, "from_user") and arg.from_user:
            return arg.from_user.id
            
    return None

async def _send_upsell_message(user_id: int, required_tier: SubscriptionTier, args, kwargs):
    """Notify the user that they need an upgrade."""
    msg = (
        f"🌟 *Upgrade Required*\n\n"
        f"This feature requires the `{required_tier.value.upper()}` tier.\n\n"
        f"Upgrade now using `/upgrade` to unlock professional tools with USDC on Base!"
    )
    
    # Logic to send message via bot (simplified)
    # In a real app, this would use a notification service or the context object
    logger.info(f"User {user_id} denied access to {required_tier.value} feature.")
    
    # Use context or update if available to send directly
    for arg in args:
        if hasattr(arg, "message") and arg.message:
            await arg.message.reply_text(msg, parse_mode="Markdown")
            return
            
    return None
