"""Revenue sharing service for $SUWAPPU stakers."""

import logging
from decimal import Decimal
from datetime import datetime

from bot.models.token import SuwappuStake
from database.db import get_session

logger = logging.getLogger(__name__)

# Revenue sharing configuration
STAKER_REVENUE_SHARE = 0.30  # 30% of protocol fees go to stakers


class RevenueSharingService:
    """Distributes protocol revenue to $SUWAPPU stakers."""

    async def distribute_daily_revenue(self, total_fees_usd: float) -> dict:
        """
        Distribute daily protocol fees to stakers.

        Args:
            total_fees_usd: Total fees collected in the past 24h

        Returns:
            Distribution summary
        """
        staker_pool = total_fees_usd * STAKER_REVENUE_SHARE

        if staker_pool <= 0:
            return {"distributed": 0, "recipients": 0, "pool": 0}

        with get_session() as session:
            # Get all active stakes
            active_stakes = session.query(SuwappuStake).filter_by(
                is_active=True
            ).all()

            if not active_stakes:
                return {"distributed": 0, "recipients": 0, "pool": staker_pool}

            # Calculate total staked
            total_staked = sum(float(s.amount) for s in active_stakes)

            if total_staked <= 0:
                return {"distributed": 0, "recipients": 0, "pool": staker_pool}

            # Distribute proportionally
            distributed = 0.0
            for stake in active_stakes:
                user_share = (float(stake.amount) / total_staked) * staker_pool
                stake.accumulated_rewards = Decimal(str(
                    float(stake.accumulated_rewards or 0) + user_share
                ))
                distributed += user_share

        logger.info(
            f"Revenue distributed: ${distributed:.2f} to {len(active_stakes)} stakers "
            f"(from ${total_fees_usd:.2f} total fees)"
        )

        return {
            "distributed": distributed,
            "recipients": len(active_stakes),
            "pool": staker_pool,
            "total_staked": total_staked,
        }

    def get_staking_stats(self) -> dict:
        """Get global staking statistics."""
        with get_session() as session:
            active_stakes = session.query(SuwappuStake).filter_by(
                is_active=True
            ).all()

            total_staked = sum(float(s.amount) for s in active_stakes)
            tier_counts = {}
            for stake in active_stakes:
                tier = stake.tier or "none"
                tier_counts[tier] = tier_counts.get(tier, 0) + 1

            return {
                "total_stakers": len(active_stakes),
                "total_staked": total_staked,
                "tier_distribution": tier_counts,
                "total_rewards_distributed": sum(
                    float(s.accumulated_rewards or 0) for s in active_stakes
                ),
            }


# Global instance
revenue_sharing = RevenueSharingService()
