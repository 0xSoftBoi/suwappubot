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
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from bot.models.user import User
from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
from bot.services.fee_service import REFERRAL_REWARD_DECIMAL, fee_service
from database.db import get_session

logger = logging.getLogger(__name__)


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
        
        logger.info(f"Referral processed: User {referee_id} referred by User {code.user_id}")
        return True, "Referral applied successfully! Your referrer will earn rewards from your swaps."
    
    def get_referrer_id(self, user_id: int) -> Optional[int]:
        """Get the referrer ID for a user, if any."""
        with get_session() as session:
            referral = session.query(Referral).filter(
                Referral.referee_id == user_id,
                Referral.is_active == True
            ).first()
            
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
            referral = session.query(Referral).filter(
                Referral.referee_id == referee_id,
                Referral.is_active == True
            ).first()
            
            if not referral:
                return None
            
            # Check if reward already exists for this swap
            existing = session.query(ReferralReward).filter(
                ReferralReward.swap_id == swap_id
            ).first()
            
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
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == referral.referrer_id
            ).first()
            if code:
                code.total_rewards_earned = (code.total_rewards_earned or 0) + reward_amount
            
            # Update referrer's total rewards
            referrer = session.query(User).filter(User.id == referral.referrer_id).first()
            if referrer:
                referrer.total_referral_rewards = (referrer.total_referral_rewards or 0) + reward_amount
            
            session.flush()
            reward_id = reward.id
        
        logger.info(
            f"Referral reward recorded: ${reward_amount:.2f} for referrer of user {referee_id} "
            f"from swap {swap_id}"
        )
        
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
                username = ref['username'][:15]
                rewards = ref['total_rewards_usd']
                msg += f"{i}. {username}: ${rewards:.2f}\n"
        
        msg += (
            "\n_You earn 30% of all swap fees from your referrals!_"
        )
        
        return msg


# Global instance
referral_service = ReferralService()
