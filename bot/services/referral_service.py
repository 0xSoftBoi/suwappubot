"""Referral service for viral growth with 30% reward distribution.

Referral Program:
- Each user gets a unique referral code
- When someone signs up with the code, they're linked forever
- Referrer earns 30% of all fees from their referrals
- Rewards accumulate and can be claimed
"""

import logging
import secrets
import string
from typing import Optional, List, Tuple
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from bot.models.user import User
from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
from bot.services.fee_service import REFERRAL_REWARD_DECIMAL, fee_service
from database.db import get_session

logger = logging.getLogger(__name__)

# Rewards are recorded in USD (ReferralReward.reward_amount_usd). When a user
# claims, the USD amount is credited to their custodial ledger as USDC (a 1:1
# USD stablecoin), on the chain below. USDC has 6 decimals and is deposit-
# supported on Base, so the user can withdraw the credited balance normally.
CLAIM_PAYOUT_TOKEN = "USDC"
CLAIM_PAYOUT_CHAIN = "base"

# Minimum accrued rewards (USD) required before a claim can be made. Keeps the
# ledger free of dust-sized payouts and matches the threshold shown in the UI.
MIN_CLAIM_USD = 1.0


class ReferralService:
    """Service for managing referral relationships and rewards.

    Reward Structure:
    - 30% of all swap fees go to the referrer
    - Rewards are tracked per-swap for transparency
    - Users can claim accumulated rewards
    """

    def generate_code(self, user_id: int, username: Optional[str] = None) -> str:
        """
        Generate a unique referral code for a user.

        Format: USERNAME_XXXX or USER_XXXX (4 random alphanumeric chars)
        """
        # Create base from username or user ID
        if username:
            base = username[:10].upper().replace(" ", "")
        else:
            base = f"USER{user_id}"

        # Add random suffix
        suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
        code = f"{base}_{suffix}"

        # Ensure uniqueness
        with get_session() as session:
            while session.query(ReferralCode).filter(ReferralCode.code == code).first():
                suffix = "".join(
                    secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4)
                )
                code = f"{base}_{suffix}"

        return code

    def get_or_create_code(self, user_id: int, username: Optional[str] = None) -> ReferralCode:
        """Get user's referral code or create one if it doesn't exist."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(ReferralCode.user_id == user_id).first()

            if code:
                # Refresh the object to get latest stats
                session.refresh(code)
                return code

            # Create new code
            new_code = self.generate_code(user_id, username)
            code = ReferralCode(
                user_id=user_id,
                code=new_code,
                times_used=0,
                total_rewards_earned=0.0,
            )
            session.add(code)
            session.flush()

            code_id = code.id

        # Return fresh copy
        with get_session() as session:
            return session.query(ReferralCode).filter(ReferralCode.id == code_id).first()

    def get_code_by_string(self, code_string: str) -> Optional[ReferralCode]:
        """Look up a referral code by its string value."""
        with get_session() as session:
            return (
                session.query(ReferralCode).filter(ReferralCode.code == code_string.upper()).first()
            )

    def process_referral(self, referee_id: int, referral_code: str) -> Tuple[bool, str]:
        """
        Process a referral when a new user signs up.

        Args:
            referee_id: The new user's ID
            referral_code: The referral code they used

        Returns:
            Tuple of (success, message)
        """
        with get_session() as session:
            # Check if user already has a referrer
            existing = session.query(Referral).filter(Referral.referee_id == referee_id).first()

            if existing:
                return False, "You already have a referrer"

            # Find the referral code
            code = (
                session.query(ReferralCode)
                .filter(ReferralCode.code == referral_code.upper())
                .first()
            )

            if not code:
                return False, "Invalid referral code"

            # Can't refer yourself
            if code.user_id == referee_id:
                return False, "You cannot use your own referral code"

            # Create the referral relationship
            referral = Referral(
                referrer_id=code.user_id,
                referee_id=referee_id,
                referral_code=code.code,
                is_active=True,
            )
            session.add(referral)

            # Update code stats
            code.times_used += 1
            code.last_used_at = datetime.now(timezone.utc)

            # Update user's referred_by
            referee = session.query(User).filter(User.id == referee_id).first()
            if referee:
                referee.referred_by_user_id = code.user_id

            # Update referrer's referral count
            referrer = session.query(User).filter(User.id == code.user_id).first()
            if referrer:
                referrer.referral_count = (referrer.referral_count or 0) + 1

            referrer_id = code.user_id

        # Award points to referrer for signup
        try:
            from bot.services.points_service import points_service

            points_service.award_referral_points(
                referrer_id=referrer_id,
                referee_id=referee_id,
                action="signup",
            )
        except Exception as e:
            logger.warning(f"Failed to award referral points: {e}")

        logger.info(f"Referral processed: User {referee_id} referred by User {referrer_id}")
        return (
            True,
            "Referral applied successfully! Your referrer will earn rewards from your swaps.",
        )

    def get_referrer_id(self, user_id: int) -> Optional[int]:
        """Get the referrer ID for a user, if any."""
        with get_session() as session:
            referral = (
                session.query(Referral)
                .filter(Referral.referee_id == user_id, Referral.is_active == True)
                .first()
            )

            return referral.referrer_id if referral else None

    def record_reward(
        self,
        referee_id: int,
        swap_id: int,
        fee_amount_usd: float,
    ) -> Optional[ReferralReward]:
        """
        Record a referral reward when a referred user swaps.

        Args:
            referee_id: The user who made the swap
            swap_id: The swap transaction ID
            fee_amount_usd: Total fee paid

        Returns:
            ReferralReward if a reward was created, None otherwise
        """
        with get_session() as session:
            # Find the referral relationship
            referral = (
                session.query(Referral)
                .filter(Referral.referee_id == referee_id, Referral.is_active == True)
                .first()
            )

            if not referral:
                return None

            # Check if reward already exists for this swap
            existing = (
                session.query(ReferralReward).filter(ReferralReward.swap_id == swap_id).first()
            )

            if existing:
                return existing

            # Calculate reward (30% of fee)
            reward_amount = float(Decimal(str(fee_amount_usd)) * REFERRAL_REWARD_DECIMAL)

            # Create reward record
            reward = ReferralReward(
                referral_id=referral.id,
                swap_id=swap_id,
                fee_amount_usd=fee_amount_usd,
                reward_amount_usd=reward_amount,
                is_paid=False,
            )
            session.add(reward)

            # Update referral code stats
            code = (
                session.query(ReferralCode)
                .filter(ReferralCode.user_id == referral.referrer_id)
                .first()
            )
            if code:
                code.total_rewards_earned = (code.total_rewards_earned or 0) + reward_amount

            # Update referrer's total rewards
            referrer = session.query(User).filter(User.id == referral.referrer_id).first()
            if referrer:
                referrer.total_referral_rewards = (
                    referrer.total_referral_rewards or 0
                ) + reward_amount

            session.flush()
            reward_id = reward.id

        logger.info(
            f"Referral reward recorded: ${reward_amount:.2f} for referrer of user {referee_id} "
            f"from swap {swap_id}"
        )

        # Check if this is referee's first swap and award bonus points to referrer
        with get_session() as session:
            # Count rewards for this referral to see if first swap
            reward_count = (
                session.query(func.count(ReferralReward.id))
                .filter(ReferralReward.referral_id == referral.id)
                .scalar()
            )

            if reward_count == 1:  # This is the first reward (first swap)
                try:
                    from bot.services.points_service import points_service

                    points_service.award_referral_points(
                        referrer_id=referral.referrer_id,
                        referee_id=referee_id,
                        action="first_swap",
                    )
                except Exception as e:
                    logger.warning(f"Failed to award first swap referral points: {e}")

        with get_session() as session:
            return session.query(ReferralReward).filter(ReferralReward.id == reward_id).first()

    def get_pending_rewards(self, user_id: int) -> Tuple[float, int]:
        """
        Get total pending (unpaid) rewards for a user.

        Returns:
            Tuple of (total_pending_usd, pending_count)
        """
        with get_session() as session:
            # Get referrals where this user is the referrer
            referrals = (
                session.query(Referral.id)
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .all()
            )

            if not referrals:
                return 0.0, 0

            referral_ids = [r.id for r in referrals]

            # Sum pending rewards
            result = (
                session.query(
                    func.sum(ReferralReward.reward_amount_usd).label("total"),
                    func.count(ReferralReward.id).label("count"),
                )
                .filter(
                    ReferralReward.referral_id.in_(referral_ids), ReferralReward.is_paid == False
                )
                .first()
            )

            return float(result.total or 0), result.count or 0

    def claim_rewards(self, user_id: int) -> Tuple[bool, str, float]:
        """Atomically claim all eligible (unpaid) referral rewards for a user.

        Marks the eligible ReferralReward rows ``is_paid=True`` and credits the
        claimed USD amount to the user's custodial ledger as USDC (1 USD = 1
        USDC), then records a ReferralPayout for auditability.

        The mark-paid step and the eligibility re-check happen inside a single
        DB session/transaction. A second rapid tap re-reads the unpaid rows
        inside its own transaction and finds nothing left to claim, so no
        double-credit is possible.

        Returns:
            Tuple of (success, message, claimed_usd)
        """
        # 1) Atomically select + mark the unpaid rewards as paid. The re-check is
        #    implicit: only rows still is_paid==False at update time are claimed,
        #    so a concurrent/duplicate tap claims $0.
        claimed_usd = 0.0
        with get_session() as session:
            referral_ids = [
                r.id
                for r in session.query(Referral.id)
                .filter(
                    Referral.referrer_id == user_id,
                    Referral.is_active == True,
                )
                .all()
            ]

            if not referral_ids:
                return False, "You don't have any referral rewards yet.", 0.0

            # Lock the unpaid rows for this transaction (SELECT ... FOR UPDATE on
            # backends that support it; harmless no-op on SQLite).
            unpaid = (
                session.query(ReferralReward)
                .filter(
                    ReferralReward.referral_id.in_(referral_ids),
                    ReferralReward.is_paid == False,
                )
                .with_for_update()
                .all()
            )

            if not unpaid:
                return False, "No pending rewards to claim.", 0.0

            claimed_usd = float(sum(Decimal(str(r.reward_amount_usd or 0)) for r in unpaid))

            if claimed_usd < MIN_CLAIM_USD:
                return (
                    False,
                    f"Minimum claim is ${MIN_CLAIM_USD:.2f}. "
                    f"You have ${claimed_usd:.2f} pending — keep referring!",
                    claimed_usd,
                )

            now = datetime.now(timezone.utc)
            for r in unpaid:
                r.is_paid = True
                r.paid_at = now
            # Session commits on context exit — rewards are now durably marked paid.

        # 2) Credit the custodial ledger. This runs AFTER the rewards are marked
        #    paid (and committed). The credit is itself an idempotent +add on a
        #    string-decimal balance, so even if it somehow ran twice the amount
        #    would just be wrong-high — but it can't, because step 1 already
        #    consumed the rows.
        try:
            from bot.services.hot_wallet import hot_wallet_service

            hot_wallet_service.update_custodial_balance(
                user_id=user_id,
                chain=CLAIM_PAYOUT_CHAIN,
                token_symbol=CLAIM_PAYOUT_TOKEN,
                amount=Decimal(str(claimed_usd)),
                operation="add",
            )
        except Exception as e:
            # Crediting failed — un-mark the rewards so the user can retry. Without
            # this, a failed credit would silently burn the user's rewards.
            logger.error(f"Custodial credit failed for user {user_id} claim: {e}")
            with get_session() as session:
                session.query(ReferralReward).filter(
                    ReferralReward.referral_id.in_(referral_ids),
                    ReferralReward.is_paid == True,
                    ReferralReward.paid_at == now,
                ).update(
                    {ReferralReward.is_paid: False, ReferralReward.paid_at: None},
                    synchronize_session=False,
                )
            return (
                False,
                "⚠️ Could not credit your balance right now. Your rewards are safe — please try again shortly.",
                0.0,
            )

        # 3) Record the payout for auditability (USDC, 6 decimals).
        try:
            with get_session() as session:
                token_amount_raw = int(Decimal(str(claimed_usd)) * Decimal(10**6))
                payout = ReferralPayout(
                    user_id=user_id,
                    amount_usd=claimed_usd,
                    token=CLAIM_PAYOUT_TOKEN,
                    token_amount=str(token_amount_raw),
                    chain=CLAIM_PAYOUT_CHAIN,
                    status="completed",
                    completed_at=datetime.now(timezone.utc),
                )
                session.add(payout)
        except Exception as e:
            # The ledger is already credited — a missing audit row is non-fatal.
            logger.warning(f"Failed to record ReferralPayout for user {user_id}: {e}")

        logger.info(
            f"Referral claim: user {user_id} claimed ${claimed_usd:.2f} "
            f"as {CLAIM_PAYOUT_TOKEN} on {CLAIM_PAYOUT_CHAIN}"
        )
        return (
            True,
            f"✅ Claimed *${claimed_usd:.2f}*! Credited as "
            f"*{claimed_usd:.2f} {CLAIM_PAYOUT_TOKEN}* on {CLAIM_PAYOUT_CHAIN.title()} "
            f"to your custodial balance.\n\nUse 🏦 Custodial to withdraw.",
            claimed_usd,
        )

    def build_share_link(self, user_id: int, bot_username: str) -> str:
        """Build the user's shareable referral deep-link (creates code if needed)."""
        code = self.get_or_create_code(user_id)
        return f"https://t.me/{bot_username}?start={code.code}"

    def format_share_message(self, user_id: int, bot_username: str) -> str:
        """Forwardable share message a user can send to friends."""
        link = self.build_share_link(user_id, bot_username)
        return (
            "🌸 *Trade smarter on Suwappu*\n\n"
            "Cross-chain swaps, perps, sniping & more — all in Telegram.\n"
            f"Join with my link and we both win:\n{link}\n\n"
            "_You'll get a welcome XP bonus, I earn 30% of the fees on your swaps._"
        )

    def get_total_earnings(self, user_id: int) -> float:
        """Get total lifetime earnings from referrals."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            return float(user.total_referral_rewards or 0) if user else 0.0

    def get_referral_stats(self, user_id: int) -> dict:
        """Get comprehensive referral statistics for a user."""
        with get_session() as session:
            # Get user
            user = session.query(User).filter(User.id == user_id).first()
            if not user:
                return {}

            # Get referral code
            code = session.query(ReferralCode).filter(ReferralCode.user_id == user_id).first()

            # Get pending rewards
            pending_usd, pending_count = self.get_pending_rewards(user_id)

            # Get active referrals
            active_referrals = (
                session.query(func.count(Referral.id))
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .scalar()
                or 0
            )

            return {
                "referral_code": code.code if code else None,
                "total_referrals": user.referral_count or 0,
                "active_referrals": active_referrals,
                "total_earnings_usd": user.total_referral_rewards or 0,
                "pending_rewards_usd": pending_usd,
                "pending_rewards_count": pending_count,
                "code_times_used": code.times_used if code else 0,
            }

    def get_referrals_list(self, user_id: int, limit: int = 10) -> List[dict]:
        """Get list of users referred by this user."""
        with get_session() as session:
            referrals = (
                session.query(Referral, User)
                .join(User, Referral.referee_id == User.id)
                .filter(Referral.referrer_id == user_id, Referral.is_active == True)
                .order_by(Referral.created_at.desc())
                .limit(limit)
                .all()
            )

            # Batch-load all referral rewards in a single query to avoid N+1
            ref_ids = [ref.id for ref, _ in referrals]
            reward_map: dict = {}
            if ref_ids:
                reward_rows = (
                    session.query(
                        ReferralReward.referral_id,
                        func.sum(ReferralReward.reward_amount_usd),
                    )
                    .filter(ReferralReward.referral_id.in_(ref_ids))
                    .group_by(ReferralReward.referral_id)
                    .all()
                )
                reward_map = {rid: (total or 0) for rid, total in reward_rows}

            result = []
            for ref, referee in referrals:
                result.append(
                    {
                        "user_id": referee.id,
                        "username": referee.username or f"User{referee.id}",
                        "joined_at": ref.created_at,
                        "total_rewards_usd": float(reward_map.get(ref.id, 0)),
                    }
                )

            return result

    def format_referral_message(self, user_id: int, bot_username: str) -> str:
        """Format referral information message."""
        stats = self.get_referral_stats(user_id)

        if not stats.get("referral_code"):
            return "❌ No referral code found. Contact support."

        code = stats["referral_code"]
        link = f"https://t.me/{bot_username}?start={code}"

        msg = (
            "🎁 *Your Referral Program*\n\n"
            f"📋 *Code:* `{code}`\n"
            f"🔗 *Link:* [Click to share]({link})\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Total Referrals: *{stats['total_referrals']}*\n"
            f"💰 Total Earned: *${stats['total_earnings_usd']:.2f}*\n"
            f"⏳ Pending: *${stats['pending_rewards_usd']:.2f}*\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            "💡 *How it works:*\n"
            "• Share your link or code\n"
            "• Friends sign up and swap\n"
            "• You earn *30%* of all their fees!\n\n"
            "_Rewards are credited after each swap_"
        )

        return msg

    def format_rewards_message(self, user_id: int) -> str:
        """Format rewards summary message."""
        stats = self.get_referral_stats(user_id)
        referrals = self.get_referrals_list(user_id, limit=5)

        msg = (
            "💰 *Your Referral Rewards*\n\n"
            f"📊 *Summary*\n"
            f"• Total Earned: *${stats['total_earnings_usd']:.2f}*\n"
            f"• Pending: *${stats['pending_rewards_usd']:.2f}*\n"
            f"• From {stats['total_referrals']} referrals\n\n"
        )

        if referrals:
            msg += "👥 *Top Referrals*\n"
            for i, ref in enumerate(referrals[:5], 1):
                username = ref["username"][:15]
                rewards = ref["total_rewards_usd"]
                msg += f"{i}. {username}: ${rewards:.2f}\n"

        msg += "\n_You earn 30% of all swap fees from your referrals!_"

        return msg


# Global instance
referral_service = ReferralService()
