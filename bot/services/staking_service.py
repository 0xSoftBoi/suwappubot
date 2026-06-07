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
STAKING_FEE_SHARE = Decimal("0.40")
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

    def create_distribution_epoch(self):
        """Create a weekly DistributionEpoch: 40% fees direct + 100% vault yield → stakers."""
        from decimal import ROUND_DOWN
        from sqlalchemy import func
        from bot.models.fees import FeeTransaction
        from bot.services.treasury_vault_service import treasury_vault_service

        now = datetime.now(timezone.utc)

        with get_session() as session:
            last_epoch = session.query(DistributionEpoch).order_by(
                DistributionEpoch.epoch_number.desc()
            ).first()

            if last_epoch:
                period_start = last_epoch.period_end
                next_epoch_number = last_epoch.epoch_number + 1
            else:
                from datetime import datetime as dt
                period_start = dt(2024, 1, 1, tzinfo=timezone.utc)
                next_epoch_number = 1

            period_end = now

            total_row = session.query(
                func.coalesce(func.sum(FeeTransaction.fee_amount_usd), 0).label("total")
            ).filter(
                FeeTransaction.collected == True,
                FeeTransaction.created_at >= period_start,
                FeeTransaction.created_at < period_end,
            ).one()
            total_fees_usd = Decimal(str(total_row.total))

            direct_fees_usdc = (total_fees_usd * Decimal("0.40")).quantize(
                Decimal("0.000001"), rounding=ROUND_DOWN
            )
            protocol_usdc = (total_fees_usd * Decimal("0.60")).quantize(
                Decimal("0.000001"), rounding=ROUND_DOWN
            )

            # Harvest vault yield — returns 0 safely on any failure
            vault_yield = treasury_vault_service.harvest_yield()
            total_staker_usdc = direct_fees_usdc + vault_yield

            staked_row = session.query(
                func.coalesce(func.sum(StakingPosition.suwp_staked), 0).label("total")
            ).filter(
                StakingPosition.is_active == True,
                StakingPosition.suwp_staked > 0,
            ).one()
            total_suwp_staked = Decimal(str(staked_row.total))

            vault_stats = treasury_vault_service.get_vault_stats()
            treasury_aum_usdc = Decimal(str(vault_stats.get("current_balance_usdc", 0)))

            epoch = DistributionEpoch(
                epoch_number=next_epoch_number,
                period_start=period_start,
                period_end=period_end,
                total_fees_usdc=total_fees_usd,
                staking_pool_usdc=total_staker_usdc,  # legacy field — APY endpoint reads this
                protocol_usdc=protocol_usdc,
                total_suwp_staked=total_suwp_staked,
                suwp_emission=WEEKLY_SUWP_EMISSION,
                status="pending",
                direct_fees_usdc=direct_fees_usdc,
                treasury_yield_usdc=vault_yield,
                total_staker_usdc=total_staker_usdc,
                treasury_aum_usdc=treasury_aum_usdc,
            )
            session.add(epoch)
            session.flush()

            stakers = session.query(StakingPosition).filter(
                StakingPosition.is_active == True,
                StakingPosition.suwp_staked > 0,
            ).all()

            # USDC rewards now flow per-second via Superfluid GDA pool (fundStream).
            # No per-staker USDC EpochReward records are created; usdc_reward is set to 0.
            logger.info(
                "Epoch #%d: %.6f USDC will be streamed via fundStream() "
                "(Superfluid GDA pool) — no per-staker USDC records created.",
                next_epoch_number, float(total_staker_usdc),
            )

            rewards_count = 0
            for staker in stakers:
                if total_suwp_staked == 0:
                    break
                share = Decimal(str(staker.suwp_staked)) / total_suwp_staked
                suwp_bonus = (WEEKLY_SUWP_EMISSION * share).quantize(
                    Decimal("0.000001"), rounding=ROUND_DOWN
                )
                # usdc_reward is 0: USDC distributes continuously via Superfluid GDA pool.
                session.add(EpochReward(
                    epoch_id=epoch.id,
                    user_id=staker.user_id,
                    suwp_staked_snapshot=staker.suwp_staked,
                    usdc_reward=Decimal("0"),
                    suwp_bonus=suwp_bonus,
                    status="pending",
                ))
                rewards_count += 1

            session.commit()
            session.refresh(epoch)
            logger.info(
                "Epoch #%d: fees=%.2f direct=%.2f vault_yield=%.2f "
                "total_staker=%.2f (streamed via Superfluid) suwp_rewards=%d stakers",
                next_epoch_number, float(total_fees_usd), float(direct_fees_usdc),
                float(vault_yield), float(total_staker_usdc), rewards_count,
            )
            return epoch

    def fund_stream_on_chain(self, epoch_usdc: Decimal, duration_seconds: int = 604800) -> str:
        """
        Call SuwppuStaking.fundStream(usdcAmount, durationSeconds) on Base.
        Returns tx_hash. No-op if STAKING_CONTRACT_ADDRESS not set.
        Requires treasury wallet to have USDC approved to the staking contract.
        """
        from bot.config.settings import settings
        contract_addr = getattr(settings, "staking_contract_address", None)
        if not contract_addr:
            logger.info("[mock] fund_stream_on_chain %.6f USDC (no contract address set)", epoch_usdc)
            return "0x" + "0" * 64
        try:
            from bot.services.treasury_vault_service import treasury_vault_service
            from web3 import Web3
            web3 = treasury_vault_service._get_web3()
            wallet = treasury_vault_service._get_treasury_wallet()
            private_key = treasury_vault_service._get_private_key(wallet)

            STAKING_ABI = [
                {"name": "fundStream", "type": "function", "stateMutability": "nonpayable",
                 "inputs": [{"name": "usdcAmount", "type": "uint256"},
                             {"name": "durationSeconds", "type": "uint256"}],
                 "outputs": []},
            ]
            contract = web3.eth.contract(
                address=Web3.to_checksum_address(contract_addr), abi=STAKING_ABI
            )
            usdc_wei = int(epoch_usdc * Decimal("1000000"))  # 6 decimals
            tx_hash = treasury_vault_service._build_and_send(
                web3, wallet,
                contract.functions.fundStream(usdc_wei, duration_seconds),
                private_key,
            )
            logger.info("fundStream called: %.6f USDC over %ds tx=%s", epoch_usdc, duration_seconds, tx_hash)
            return tx_hash
        except Exception as e:
            logger.error("fund_stream_on_chain failed: %s", e, exc_info=True)
            return "0x" + "0" * 64

    def get_vault_stats(self) -> dict:
        """Delegate to treasury vault service."""
        from bot.services.treasury_vault_service import treasury_vault_service
        return treasury_vault_service.get_vault_stats()


staking_service = StakingService()
