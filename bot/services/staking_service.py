"""SUWP token staking service."""
import logging
from decimal import Decimal
from datetime import datetime, timezone
from typing import Optional
from database.db import get_session
from bot.models.token_staking import TokenClaim, StakingPosition, DistributionEpoch, EpochReward
from bot.models.points import UserPoints

logger = logging.getLogger(__name__)

POINTS_PER_SUWP = 1000
STAKING_FEE_SHARE = Decimal("0.20")
WEEKLY_SUWP_EMISSION = Decimal("10000")  # bonus SUWP distributed per epoch


class StakingService:
    async def claim_points_for_suwp(self, user_id: int, points_to_burn: int, wallet_address: str) -> TokenClaim:
        """Convert points to a pending SUWP claim. Min 1000 points."""
        if points_to_burn < POINTS_PER_SUWP:
            raise ValueError(f"Minimum claim is {POINTS_PER_SUWP} points (= 1 SUWP)")
        if points_to_burn % POINTS_PER_SUWP != 0:
            # Round down to nearest 1000
            points_to_burn = (points_to_burn // POINTS_PER_SUWP) * POINTS_PER_SUWP

        suwp_amount = Decimal(points_to_burn) / Decimal(POINTS_PER_SUWP)

        with get_session() as session:
            # Verify and deduct points
            user_pts = session.query(UserPoints).filter(UserPoints.user_id == user_id).first()
            if not user_pts or user_pts.current_points < points_to_burn:
                raise ValueError(f"Insufficient points. Have: {getattr(user_pts, 'current_points', 0)}, need: {points_to_burn}")

            user_pts.current_points -= points_to_burn
            user_pts.points_spent = (user_pts.points_spent or 0) + points_to_burn

            claim = TokenClaim(
                user_id=user_id,
                wallet_address=wallet_address.lower(),
                points_burned=points_to_burn,
                suwp_amount=suwp_amount,
                status="pending",
            )
            session.add(claim)
            session.commit()
            session.refresh(claim)
            return claim

    def get_claims(self, user_id: int) -> list:
        with get_session() as session:
            return session.query(TokenClaim).filter(
                TokenClaim.user_id == user_id
            ).order_by(TokenClaim.created_at.desc()).limit(20).all()

    def get_staking_position(self, user_id: int) -> Optional[StakingPosition]:
        with get_session() as session:
            return session.query(StakingPosition).filter(
                StakingPosition.user_id == user_id,
                StakingPosition.is_active == True,
            ).first()

    def register_stake(self, user_id: int, wallet_address: str, suwp_amount: Decimal) -> StakingPosition:
        """Register a staking position (user staked on-chain, we record it here)."""
        now = datetime.now(timezone.utc)
        with get_session() as session:
            pos = session.query(StakingPosition).filter(
                StakingPosition.user_id == user_id
            ).first()
            if pos:
                pos.suwp_staked += suwp_amount
                pos.wallet_address = wallet_address.lower()
                pos.updated_at = now
                if not pos.staked_since:
                    pos.staked_since = now
            else:
                pos = StakingPosition(
                    user_id=user_id,
                    wallet_address=wallet_address.lower(),
                    suwp_staked=suwp_amount,
                    staked_since=now,
                )
                session.add(pos)
            session.commit()
            session.refresh(pos)
            return pos

    def register_unstake(self, user_id: int, suwp_amount: Decimal) -> StakingPosition:
        now = datetime.now(timezone.utc)
        with get_session() as session:
            pos = session.query(StakingPosition).filter(
                StakingPosition.user_id == user_id,
                StakingPosition.is_active == True,
            ).first()
            if not pos:
                raise ValueError("No active staking position found")
            if pos.suwp_staked < suwp_amount:
                raise ValueError(f"Cannot unstake {suwp_amount} SUWP, only {pos.suwp_staked} staked")
            pos.suwp_staked -= suwp_amount
            if pos.suwp_staked == 0:
                pos.staked_since = None
            pos.updated_at = now
            session.commit()
            session.refresh(pos)
            return pos

    def get_staking_stats(self) -> dict:
        """Global staking statistics."""
        with get_session() as session:
            from sqlalchemy import func
            result = session.query(
                func.sum(StakingPosition.suwp_staked).label("total_suwp_staked"),
                func.count(StakingPosition.id).label("staker_count"),
            ).filter(
                StakingPosition.is_active == True,
                StakingPosition.suwp_staked > 0,
            ).one()
            return {
                "total_suwp_staked": float(result.total_suwp_staked or 0),
                "staker_count": result.staker_count or 0,
            }

    def get_pending_rewards(self, user_id: int) -> list:
        """Get unclaimed epoch rewards for a user."""
        with get_session() as session:
            return session.query(EpochReward).filter(
                EpochReward.user_id == user_id,
                EpochReward.status == "pending",
            ).all()


staking_service = StakingService()
