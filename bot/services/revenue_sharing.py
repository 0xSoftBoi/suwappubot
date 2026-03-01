"""Revenue sharing service — distributes protocol fees to top-tier users."""

import logging
from decimal import Decimal
from datetime import datetime

from bot.models.token import PointsTier
from database.db import get_session

logger = logging.getLogger(__name__)

# Revenue sharing configuration
TIER_REVENUE_SHARE = 0.30  # 30% of protocol fees go to eligible tiers
ELIGIBLE_TIERS = {"bronze", "silver", "gold", "diamond"}

# Weight multipliers per tier (higher tier = bigger share)
TIER_WEIGHTS = {
    "bronze": 1,
    "silver": 3,
    "gold": 10,
    "diamond": 30,
}


class RevenueSharingService:
    """Distributes protocol revenue to users based on their points tier."""

    async def distribute_daily_revenue(self, total_fees_usd: float) -> dict:
        """
        Distribute daily protocol fees to tier-holding users.

        Args:
            total_fees_usd: Total fees collected in the past 24h

        Returns:
            Distribution summary
        """
        reward_pool = total_fees_usd * TIER_REVENUE_SHARE

        if reward_pool <= 0:
            return {"distributed": 0, "recipients": 0, "pool": 0}

        with get_session() as session:
            eligible = session.query(PointsTier).filter(
                PointsTier.tier.in_(ELIGIBLE_TIERS)
            ).all()

            if not eligible:
                return {"distributed": 0, "recipients": 0, "pool": reward_pool}

            # Calculate weighted total
            total_weight = sum(TIER_WEIGHTS.get(u.tier, 0) for u in eligible)

            if total_weight <= 0:
                return {"distributed": 0, "recipients": 0, "pool": reward_pool}

            # Distribute proportional to tier weight
            distributed = 0.0
            for user_tier in eligible:
                weight = TIER_WEIGHTS.get(user_tier.tier, 0)
                user_share = (weight / total_weight) * reward_pool
                user_tier.accumulated_rewards = Decimal(str(
                    float(user_tier.accumulated_rewards or 0) + user_share
                ))
                distributed += user_share

        logger.info(
            f"Revenue distributed: ${distributed:.2f} to {len(eligible)} users "
            f"(from ${total_fees_usd:.2f} total fees)"
        )

        return {
            "distributed": distributed,
            "recipients": len(eligible),
            "pool": reward_pool,
            "total_weight": total_weight,
        }

    def get_rewards_stats(self) -> dict:
        """Get global rewards statistics."""
        with get_session() as session:
            all_tiers = session.query(PointsTier).all()

            tier_counts = {}
            for t in all_tiers:
                tier_name = t.tier or "none"
                tier_counts[tier_name] = tier_counts.get(tier_name, 0) + 1

            eligible = [t for t in all_tiers if t.tier in ELIGIBLE_TIERS]

            return {
                "total_users": len(all_tiers),
                "eligible_users": len(eligible),
                "tier_distribution": tier_counts,
                "total_rewards_pending": sum(
                    float(t.accumulated_rewards or 0) for t in all_tiers
                ),
            }


# Global instance
revenue_sharing = RevenueSharingService()
