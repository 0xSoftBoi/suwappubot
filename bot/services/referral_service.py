"""Multi-tier referral service for viral growth.

Referral Program (3-tier):
- Level 1 (direct referral): 25% of referee's fees
- Level 2 (referee's referrals): 5% of L2 fees
- Level 3 (L2's referrals): 2% of L3 fees
- KOL program: custom elevated L1 rates (30%+)
- Referred users get 10% fee discount

When someone signs up with a code, the entire referral chain
(up to 3 levels) is created for all upstream referrers.
"""

import logging
import secrets
import string
from typing import Optional, List, Tuple
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from bot.models.user import User
from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
from bot.services.fee_service import REFERRAL_REWARD_DECIMAL, fee_service
from database.db import get_session

logger = logging.getLogger(__name__)


# Multi-tier reward rates
TIER_RATES = {
    1: Decimal("0.25"),  # 25% for direct referrals
    2: Decimal("0.05"),  # 5% for level 2
    3: Decimal("0.02"),  # 2% for level 3
}
MAX_REFERRAL_DEPTH = 3


class ReferralService:
    """Service for managing multi-tier referral relationships and rewards.

    Reward Structure (3-tier):
    - L1 (direct): 25% of referee's fees (KOL: 30%+)
    - L2: 5% of L2 referee's fees
    - L3: 2% of L3 referee's fees
    - Referee gets 10% fee discount
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
        suffix = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
        code = f"{base}_{suffix}"
        
        # Ensure uniqueness
        with get_session() as session:
            while session.query(ReferralCode).filter(ReferralCode.code == code).first():
                suffix = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
                code = f"{base}_{suffix}"
        
        return code
    
    def get_or_create_code(self, user_id: int, username: Optional[str] = None) -> ReferralCode:
        """Get user's referral code or create one if it doesn't exist."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == user_id
            ).first()
            
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
            return session.query(ReferralCode).filter(
                ReferralCode.code == code_string.upper()
            ).first()
    
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
            existing = session.query(Referral).filter(
                Referral.referee_id == referee_id
            ).first()
            
            if existing:
                return False, "You already have a referrer"
            
            # Find the referral code
            code = session.query(ReferralCode).filter(
                ReferralCode.code == referral_code.upper()
            ).first()
            
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
            code.last_used_at = datetime.utcnow()
            
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
        return True, "Referral applied successfully! Your referrer will earn rewards from your swaps."
    
    def get_referrer_id(self, user_id: int) -> Optional[int]:
        """Get the referrer ID for a user, if any."""
        with get_session() as session:
            referral = session.query(Referral).filter(
                Referral.referee_id == user_id,
                Referral.is_active == True
            ).first()
            
            return referral.referrer_id if referral else None
    
    def get_referral_chain(self, user_id: int, max_depth: int = MAX_REFERRAL_DEPTH) -> List[Tuple[int, int]]:
        """Walk up the referral chain from a user.

        Returns list of (referrer_id, level) tuples, up to max_depth levels.
        """
        chain = []
        current_id = user_id

        with get_session() as session:
            for level in range(1, max_depth + 1):
                referral = session.query(Referral).filter(
                    Referral.referee_id == current_id,
                    Referral.is_active == True,
                ).first()

                if not referral:
                    break

                chain.append((referral.referrer_id, level))
                current_id = referral.referrer_id

        return chain

    def get_reward_rate(self, referrer_id: int, level: int) -> Decimal:
        """Get the reward rate for a referrer at a given level.

        KOL codes override the L1 rate.
        """
        base_rate = TIER_RATES.get(level, Decimal("0"))

        if level == 1:
            with get_session() as session:
                code = session.query(ReferralCode).filter(
                    ReferralCode.user_id == referrer_id
                ).first()
                if code and code.is_kol and code.custom_l1_rate is not None:
                    return Decimal(str(code.custom_l1_rate))

        return base_rate

    def record_reward(
        self,
        referee_id: int,
        swap_id: int,
        fee_amount_usd: float,
    ) -> Optional[ReferralReward]:
        """Record multi-tier referral rewards when a referred user swaps.

        Walks the referral chain and creates rewards for each level:
        - L1 referrer: 25% (or KOL custom rate)
        - L2 referrer: 5%
        - L3 referrer: 2%
        """
        fee = Decimal(str(fee_amount_usd))
        chain = self.get_referral_chain(referee_id)

        if not chain:
            return None

        first_reward = None

        with get_session() as session:
            # Check if rewards already exist for this swap
            existing = session.query(ReferralReward).filter(
                ReferralReward.swap_id == swap_id
            ).first()
            if existing:
                return existing

            for referrer_id, level in chain:
                # Find the referral record for this level
                if level == 1:
                    referral = session.query(Referral).filter(
                        Referral.referee_id == referee_id,
                        Referral.referrer_id == referrer_id,
                        Referral.is_active == True,
                    ).first()
                else:
                    # For L2+, find any active referral link
                    referral = session.query(Referral).filter(
                        Referral.referrer_id == referrer_id,
                        Referral.is_active == True,
                    ).first()

                if not referral:
                    continue

                rate = self.get_reward_rate(referrer_id, level)
                reward_amount = float(fee * rate)

                if reward_amount <= 0:
                    continue

                reward = ReferralReward(
                    referral_id=referral.id,
                    swap_id=swap_id,
                    fee_amount_usd=fee_amount_usd,
                    reward_amount_usd=reward_amount,
                    is_paid=False,
                )
                session.add(reward)

                # Update referrer stats
                code = session.query(ReferralCode).filter(
                    ReferralCode.user_id == referrer_id
                ).first()
                if code:
                    code.total_rewards_earned = (code.total_rewards_earned or 0) + reward_amount

                referrer = session.query(User).filter(User.id == referrer_id).first()
                if referrer:
                    referrer.total_referral_rewards = (referrer.total_referral_rewards or 0) + reward_amount

                logger.info(
                    f"L{level} referral reward: ${reward_amount:.2f} for user {referrer_id} "
                    f"from swap {swap_id} by user {referee_id}"
                )

                if first_reward is None:
                    session.flush()
                    first_reward = reward

            session.flush()

        # Award points for first swap (L1 only)
        if chain:
            l1_referrer_id = chain[0][0]
            with get_session() as session:
                l1_ref = session.query(Referral).filter(
                    Referral.referee_id == referee_id,
                    Referral.referrer_id == l1_referrer_id,
                ).first()
                if l1_ref:
                    reward_count = session.query(func.count(ReferralReward.id)).filter(
                        ReferralReward.referral_id == l1_ref.id
                    ).scalar()
                    if reward_count == 1:
                        try:
                            from bot.services.points_service import points_service
                            points_service.award_referral_points(
                                referrer_id=l1_referrer_id,
                                referee_id=referee_id,
                                action="first_swap",
                            )
                        except Exception as e:
                            logger.warning(f"Failed to award first swap points: {e}")

        return first_reward
    
    def get_pending_rewards(self, user_id: int) -> Tuple[float, int]:
        """
        Get total pending (unpaid) rewards for a user.
        
        Returns:
            Tuple of (total_pending_usd, pending_count)
        """
        with get_session() as session:
            # Get referrals where this user is the referrer
            referrals = session.query(Referral.id).filter(
                Referral.referrer_id == user_id,
                Referral.is_active == True
            ).all()
            
            if not referrals:
                return 0.0, 0
            
            referral_ids = [r.id for r in referrals]
            
            # Sum pending rewards
            result = session.query(
                func.sum(ReferralReward.reward_amount_usd).label('total'),
                func.count(ReferralReward.id).label('count')
            ).filter(
                ReferralReward.referral_id.in_(referral_ids),
                ReferralReward.is_paid == False
            ).first()
            
            return float(result.total or 0), result.count or 0
    
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
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == user_id
            ).first()
            
            # Get pending rewards
            pending_usd, pending_count = self.get_pending_rewards(user_id)
            
            # Get active referrals
            active_referrals = session.query(func.count(Referral.id)).filter(
                Referral.referrer_id == user_id,
                Referral.is_active == True
            ).scalar() or 0
            
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
            referrals = session.query(Referral, User).join(
                User, Referral.referee_id == User.id
            ).filter(
                Referral.referrer_id == user_id,
                Referral.is_active == True
            ).order_by(
                Referral.created_at.desc()
            ).limit(limit).all()
            
            result = []
            for ref, referee in referrals:
                # Get rewards from this referral
                total_rewards = session.query(
                    func.sum(ReferralReward.reward_amount_usd)
                ).filter(
                    ReferralReward.referral_id == ref.id
                ).scalar() or 0
                
                result.append({
                    "user_id": referee.id,
                    "username": referee.username or f"User{referee.id}",
                    "joined_at": ref.created_at,
                    "total_rewards_usd": float(total_rewards),
                })
            
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
            "💡 *3-Tier Rewards:*\n"
            "• L1 (direct): *25%* of their fees\n"
            "• L2 (their referrals): *5%* of fees\n"
            "• L3 (third degree): *2%* of fees\n"
            "• Your friends get *10% fee discount*!\n\n"
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
                username = ref['username'][:15]
                rewards = ref['total_rewards_usd']
                msg += f"{i}. {username}: ${rewards:.2f}\n"
        
        msg += (
            "\n_You earn 25% (L1) + 5% (L2) + 2% (L3) of referral fees!_"
        )
        
        return msg


# Global instance
referral_service = ReferralService()
