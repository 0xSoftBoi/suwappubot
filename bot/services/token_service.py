"""Points rewards service — tier calculation, fee discounts, reward claims."""

import logging
from typing import Optional
from decimal import Decimal
from datetime import datetime

from bot.models.token import PointsTier, FeeDiscount
from database.db import get_session

logger = logging.getLogger(__name__)


# Tier thresholds: XP required + minimum trade volume (USD)
TIER_THRESHOLDS = {
    "bronze":  {"min_xp": 1_000,     "min_volume": 500,      "discount": 10.0},
    "silver":  {"min_xp": 10_000,    "min_volume": 5_000,    "discount": 20.0},
    "gold":    {"min_xp": 100_000,   "min_volume": 50_000,   "discount": 30.0},
    "diamond": {"min_xp": 1_000_000, "min_volume": 500_000,  "discount": 50.0},
}


class TokenService:
    """Service for points-based tier and rewards operations."""

    def get_tier(self, user_id: int) -> Optional[PointsTier]:
        """Get user's current tier record."""
        with get_session() as session:
            tier = session.query(PointsTier).filter_by(user_id=user_id).first()
            if tier:
                session.expunge(tier)
            return tier

    def refresh_tier(self, user_id: int) -> PointsTier:
        """Recalculate user's tier from current XP and trade volume."""
        from bot.models.points import UserPoints
        from bot.models.swap import SwapTransaction
        from sqlalchemy import func

        with get_session() as session:
            # Get XP
            points = session.query(UserPoints).filter_by(user_id=user_id).first()
            xp = points.xp if points else 0

            # Get total completed trade volume
            volume_result = session.query(
                func.coalesce(func.sum(SwapTransaction.amount_usd), 0)
            ).filter(
                SwapTransaction.user_id == user_id,
                SwapTransaction.status == "completed",
            ).scalar()
            volume = float(volume_result or 0)

            # Calculate tier
            tier_name = self._calculate_tier(xp, volume)
            discount = TIER_THRESHOLDS.get(tier_name, {}).get("discount", 0.0)

            # Upsert tier record
            existing = session.query(PointsTier).filter_by(user_id=user_id).first()
            if existing:
                existing.tier = tier_name
                existing.qualifying_xp = xp
                existing.qualifying_volume_usd = Decimal(str(volume))
                existing.updated_at = datetime.utcnow()
                tier_record = existing
            else:
                tier_record = PointsTier(
                    user_id=user_id,
                    tier=tier_name,
                    qualifying_xp=xp,
                    qualifying_volume_usd=Decimal(str(volume)),
                )
                session.add(tier_record)

            # Update fee discount
            self._update_fee_discount(session, user_id, tier_name)

            session.flush()
            session.expunge(tier_record)

        logger.info(f"User {user_id} tier refreshed: {tier_name} (XP={xp}, vol=${volume:.0f}, discount={discount}%)")
        return tier_record

    def claim_rewards(self, user_id: int) -> float:
        """Claim accumulated rewards."""
        with get_session() as session:
            tier = session.query(PointsTier).filter_by(user_id=user_id).first()

            if not tier:
                raise ValueError("No tier record found — trade or earn XP first")

            rewards = float(tier.accumulated_rewards or 0)
            if rewards <= 0:
                raise ValueError("No rewards to claim")

            tier.accumulated_rewards = Decimal("0")
            tier.last_claim_at = datetime.utcnow()

        logger.info(f"User {user_id} claimed ${rewards:.4f} in rewards")
        return rewards

    def get_fee_discount(self, user_id: int) -> float:
        """Get user's current fee discount percentage."""
        with get_session() as session:
            discount = session.query(FeeDiscount).filter_by(
                user_id=user_id
            ).order_by(FeeDiscount.discount_percent.desc()).first()

            if not discount:
                return 0.0

            # Check if expired
            if discount.valid_until and datetime.utcnow() > discount.valid_until:
                return 0.0

            return discount.discount_percent

    def _calculate_tier(self, xp: int, volume_usd: float) -> str:
        """Calculate tier based on XP and trade volume."""
        if (xp >= TIER_THRESHOLDS["diamond"]["min_xp"]
                and volume_usd >= TIER_THRESHOLDS["diamond"]["min_volume"]):
            return "diamond"
        elif (xp >= TIER_THRESHOLDS["gold"]["min_xp"]
              and volume_usd >= TIER_THRESHOLDS["gold"]["min_volume"]):
            return "gold"
        elif (xp >= TIER_THRESHOLDS["silver"]["min_xp"]
              and volume_usd >= TIER_THRESHOLDS["silver"]["min_volume"]):
            return "silver"
        elif (xp >= TIER_THRESHOLDS["bronze"]["min_xp"]
              and volume_usd >= TIER_THRESHOLDS["bronze"]["min_volume"]):
            return "bronze"
        return "none"

    def _update_fee_discount(self, session, user_id: int, tier: str):
        """Update user's fee discount based on tier."""
        discount_percent = TIER_THRESHOLDS.get(tier, {}).get("discount", 0.0)

        existing = session.query(FeeDiscount).filter_by(
            user_id=user_id, source="points"
        ).first()

        if existing:
            existing.discount_tier = tier
            existing.discount_percent = discount_percent
            existing.updated_at = datetime.utcnow()
        else:
            discount = FeeDiscount(
                user_id=user_id,
                discount_tier=tier,
                discount_percent=discount_percent,
                source="points",
            )
            session.add(discount)


# Global instance
token_service = TokenService()
