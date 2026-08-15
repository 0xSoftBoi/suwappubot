"""Snapshot fee terms (tier + fee_bps + referrer) at delayed-order creation time.

MONEY-PATH: Delayed orders (limit orders, DCA, snipes, copy trades) must honor
the fee rate quoted to the user at CREATION time, not whatever the user's
subscription tier / referral status happens to be when the order eventually
fires. Without this, a user who creates an order on PREMIUM (0.3%) and then
lets their subscription lapse before the order fills gets charged FREE (1%)
at execution — a silent overcharge relative to what they were quoted.

This module centralizes the one-time resolution so all four order types
(limit_orders, dca_orders, snipe_orders, copy_trades) capture identical
semantics. Callers persist the returned (fee_bps, fee_tier, referrer_id) on
the order row; execution code passes fee_bps back into
SwapEngine.get_quote(fee_bps_override=...) and credits referrer_id directly
instead of re-resolving either at execution time.
"""

import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


async def snapshot_fee_terms(user_id: int) -> Tuple[int, Optional[str], Optional[int]]:
    """Resolve (fee_bps, fee_tier, referrer_id) for `user_id` right now.

    Call once at order creation. Mirrors the exact resolution SwapEngine
    performs at quote time today (x402 tier lookup -> fee_service.get_fee_bps)
    so a freshly-created order's snapshot equals what an immediate swap would
    have been quoted. Never raises — a tier/referrer lookup failure degrades
    to the same flat-default behavior get_quote() already falls back to.
    """
    from bot.services.fee_service import fee_service
    from bot.services.x402_service import x402_service
    from bot.services.referral_service import referral_service

    tier = None
    try:
        tier = await x402_service.get_tier(user_id)
    except Exception as e:
        logger.warning(
            f"x402 tier lookup failed for user_id={user_id} at order creation; "
            f"snapshotting flat default fee: {e}"
        )
        tier = None

    fee_bps = fee_service.get_fee_bps(tier, user_id=user_id)
    fee_tier = tier.value if tier is not None else None

    referrer_id: Optional[int] = None
    try:
        referrer_id = referral_service.get_referrer_id(user_id)
    except Exception as e:
        logger.warning(f"Referrer lookup failed for user_id={user_id} at order creation: {e}")
        referrer_id = None

    return fee_bps, fee_tier, referrer_id
