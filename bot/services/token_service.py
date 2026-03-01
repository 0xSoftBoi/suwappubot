"""$SUWAPPU token service — staking, airdrops, fee discounts."""

import logging
from typing import Optional
from decimal import Decimal
from datetime import datetime, timedelta

from bot.models.token import SuwappuStake, AirdropSnapshot, FeeDiscount
from database.db import get_session

logger = logging.getLogger(__name__)


# Staking tier thresholds and fee discounts
STAKE_TIERS = {
    "bronze": {"min_amount": 1_000, "discount": 10.0},
    "silver": {"min_amount": 10_000, "discount": 20.0},
    "gold": {"min_amount": 100_000, "discount": 30.0},
    "diamond": {"min_amount": 1_000_000, "discount": 50.0},
}

UNSTAKING_COOLDOWN_DAYS = 7

# Airdrop allocation weights
AIRDROP_WEIGHTS = {
    "xp": 0.4,        # 40% based on XP
    "volume": 0.4,     # 40% based on trading volume
    "referrals": 0.2,  # 20% based on referral count
}

TOTAL_AIRDROP_SUPPLY = 100_000_000  # 100M tokens for airdrop


class TokenService:
    """Service for $SUWAPPU token operations."""

    def get_stake(self, user_id: int) -> Optional[SuwappuStake]:
        """Get user's active stake."""
        with get_session() as session:
            stake = session.query(SuwappuStake).filter_by(
                user_id=user_id, is_active=True
            ).first()
            if stake:
                session.expunge(stake)
            return stake

    def stake(self, user_id: int, amount: float, wallet_id: Optional[int] = None) -> SuwappuStake:
        """Stake $SUWAPPU tokens."""
        if amount <= 0:
            raise ValueError("Stake amount must be positive")

        tier = self._calculate_tier(amount)
        discount = STAKE_TIERS.get(tier, {}).get("discount", 0.0)

        with get_session() as session:
            # Check for existing active stake
            existing = session.query(SuwappuStake).filter_by(
                user_id=user_id, is_active=True
            ).first()

            if existing:
                # Add to existing stake
                existing.amount = Decimal(str(float(existing.amount) + amount))
                existing.tier = self._calculate_tier(float(existing.amount))
                stake = existing
            else:
                stake = SuwappuStake(
                    user_id=user_id,
                    wallet_id=wallet_id,
                    amount=Decimal(str(amount)),
                    tier=tier,
                )
                session.add(stake)

            # Update fee discount
            self._update_fee_discount(session, user_id, stake.tier)

            session.flush()
            session.expunge(stake)

        logger.info(f"User {user_id} staked {amount} $SUWAPPU → {tier} tier ({discount}% discount)")
        return stake

    def request_unstake(self, user_id: int, stake_id: int) -> SuwappuStake:
        """Start unstaking cooldown (7 days)."""
        with get_session() as session:
            stake = session.query(SuwappuStake).filter_by(
                id=stake_id, user_id=user_id, is_active=True
            ).first()

            if not stake:
                raise ValueError("Active stake not found")

            if stake.unstake_requested_at:
                raise ValueError("Unstaking already requested")

            stake.unstake_requested_at = datetime.utcnow()
            session.flush()
            session.expunge(stake)

        logger.info(f"User {user_id} requested unstake. Cooldown ends: {stake.unstake_requested_at + timedelta(days=UNSTAKING_COOLDOWN_DAYS)}")
        return stake

    def complete_unstake(self, user_id: int, stake_id: int) -> bool:
        """Complete unstaking after cooldown period."""
        with get_session() as session:
            stake = session.query(SuwappuStake).filter_by(
                id=stake_id, user_id=user_id, is_active=True
            ).first()

            if not stake or not stake.unstake_requested_at:
                raise ValueError("No unstake request found")

            cooldown_end = stake.unstake_requested_at + timedelta(days=UNSTAKING_COOLDOWN_DAYS)
            if datetime.utcnow() < cooldown_end:
                remaining = cooldown_end - datetime.utcnow()
                raise ValueError(f"Cooldown not complete. {remaining.days}d {remaining.seconds // 3600}h remaining")

            stake.is_active = False
            stake.unstaked_at = datetime.utcnow()

            # Remove fee discount
            self._update_fee_discount(session, user_id, "none")

        logger.info(f"User {user_id} completed unstake of {stake.amount} $SUWAPPU")
        return True

    def claim_rewards(self, user_id: int) -> float:
        """Claim accumulated staking rewards."""
        with get_session() as session:
            stake = session.query(SuwappuStake).filter_by(
                user_id=user_id, is_active=True
            ).first()

            if not stake:
                raise ValueError("No active stake found")

            rewards = float(stake.accumulated_rewards or 0)
            if rewards <= 0:
                raise ValueError("No rewards to claim")

            stake.accumulated_rewards = Decimal("0")
            stake.last_claim_at = datetime.utcnow()

        logger.info(f"User {user_id} claimed {rewards:.4f} in staking rewards")
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

    def take_airdrop_snapshot(self) -> int:
        """
        Take airdrop snapshot of all eligible users.

        Returns number of users snapshotted.
        """
        from bot.models.points import UserPoints
        from bot.models.user import User
        from bot.models.swap import SwapTransaction
        from sqlalchemy import func

        with get_session() as session:
            # Get all users with their XP, volume, and referrals
            users = session.query(User).all()

            snapshots = []
            total_xp = 0
            total_volume = 0
            total_referrals = 0

            for user in users:
                # Get XP
                points = session.query(UserPoints).filter_by(user_id=user.id).first()
                xp = points.xp if points else 0

                # Get trade volume
                volume_result = session.query(
                    func.coalesce(func.sum(SwapTransaction.amount_usd), 0)
                ).filter(
                    SwapTransaction.user_id == user.id,
                    SwapTransaction.status == "completed",
                ).scalar()
                volume = float(volume_result or 0)

                # Get referral count
                referrals = user.referral_count or 0

                if xp > 0 or volume > 0 or referrals > 0:
                    snapshots.append({
                        "user_id": user.id,
                        "xp": xp,
                        "volume": volume,
                        "referrals": referrals,
                    })
                    total_xp += xp
                    total_volume += volume
                    total_referrals += referrals

            # Calculate allocations
            for snap in snapshots:
                xp_share = (snap["xp"] / total_xp * AIRDROP_WEIGHTS["xp"]) if total_xp > 0 else 0
                volume_share = (snap["volume"] / total_volume * AIRDROP_WEIGHTS["volume"]) if total_volume > 0 else 0
                ref_share = (snap["referrals"] / total_referrals * AIRDROP_WEIGHTS["referrals"]) if total_referrals > 0 else 0

                allocation = (xp_share + volume_share + ref_share) * TOTAL_AIRDROP_SUPPLY

                snapshot = AirdropSnapshot(
                    user_id=snap["user_id"],
                    xp_balance=snap["xp"],
                    trade_volume_usd=Decimal(str(snap["volume"])),
                    referral_count=snap["referrals"],
                    allocation=Decimal(str(allocation)),
                )
                session.add(snapshot)

        logger.info(f"Airdrop snapshot taken for {len(snapshots)} users")
        return len(snapshots)

    def get_user_allocation(self, user_id: int) -> Optional[AirdropSnapshot]:
        """Get user's latest airdrop allocation."""
        with get_session() as session:
            snapshot = session.query(AirdropSnapshot).filter_by(
                user_id=user_id
            ).order_by(AirdropSnapshot.snapshot_at.desc()).first()

            if snapshot:
                session.expunge(snapshot)
            return snapshot

    def claim_airdrop(self, user_id: int) -> Optional[AirdropSnapshot]:
        """Claim airdrop allocation."""
        with get_session() as session:
            snapshot = session.query(AirdropSnapshot).filter_by(
                user_id=user_id, claimed=False
            ).order_by(AirdropSnapshot.snapshot_at.desc()).first()

            if not snapshot:
                raise ValueError("No unclaimed airdrop allocation found")

            snapshot.claimed = True
            snapshot.claimed_at = datetime.utcnow()
            # claim_tx_hash would be set after actual token transfer

            session.flush()
            session.expunge(snapshot)

        logger.info(f"User {user_id} claimed airdrop: {snapshot.allocation} $SUWAPPU")
        return snapshot

    def _calculate_tier(self, amount: float) -> str:
        """Calculate staking tier based on amount."""
        if amount >= STAKE_TIERS["diamond"]["min_amount"]:
            return "diamond"
        elif amount >= STAKE_TIERS["gold"]["min_amount"]:
            return "gold"
        elif amount >= STAKE_TIERS["silver"]["min_amount"]:
            return "silver"
        elif amount >= STAKE_TIERS["bronze"]["min_amount"]:
            return "bronze"
        return "none"

    def _update_fee_discount(self, session, user_id: int, tier: str):
        """Update user's fee discount based on stake tier."""
        discount_percent = STAKE_TIERS.get(tier, {}).get("discount", 0.0)

        existing = session.query(FeeDiscount).filter_by(
            user_id=user_id, source="stake"
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
                source="stake",
            )
            session.add(discount)


# Global instance
token_service = TokenService()
