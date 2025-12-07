"""Referral system service."""

import logging
import secrets
import string
from typing import Optional, Tuple
from datetime import datetime

from bot.models.advanced import ReferralCode, AdvancedReferral as Referral, ReferralReward
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


class ReferralService:
    """Service for managing referrals and rewards."""
    
    # Aggressive, "very rewarding" defaults
    DEFAULT_REWARD_PERCENTAGE = 50.0  # 50% of fees shared with referrer
    SIGNUP_BONUS_REFERRER_USD = 5.0   # Instant bonus for referrer
    SIGNUP_BONUS_REFERRED_USD = 2.0   # Instant bonus for referred user
    
    def _generate_code(self, length: int = 8) -> str:
        """Generate a unique referral code."""
        chars = string.ascii_uppercase + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))
    
    # === Code Management ===
    
    def _create_code_for_user(self, session, user_id: int) -> ReferralCode:
        """Internal helper to create a referral code within an open session."""
        for _ in range(10):  # Try up to 10 times for uniqueness
            new_code = self._generate_code()
            exists = session.query(ReferralCode).filter(
                ReferralCode.code == new_code
            ).first()
            if not exists:
                break
        
        code = ReferralCode(
            user_id=user_id,
            code=new_code,
            reward_percentage=self.DEFAULT_REWARD_PERCENTAGE,
        )
        session.add(code)
        session.flush()
        return code
    
    def get_or_create_code(self, user_id: int) -> ReferralCode:
        """Get or create a referral code for a user."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == user_id
            ).first()
            
            if code:
                # If existing code has a lower reward, bump it to the generous default
                if code.reward_percentage < self.DEFAULT_REWARD_PERCENTAGE:
                    code.reward_percentage = self.DEFAULT_REWARD_PERCENTAGE
                return code
            
            code = self._create_code_for_user(session, user_id)
            code_id = code.id
        
        with get_session() as session:
            return session.query(ReferralCode).filter(ReferralCode.id == code_id).first()
    
    def get_code_by_string(self, code_str: str) -> Optional[ReferralCode]:
        """Get referral code by string."""
        with get_session() as session:
            return session.query(ReferralCode).filter(
                ReferralCode.code == code_str.upper(),
                ReferralCode.is_active == True,
            ).first()
    
    # === Referral Tracking ===
    
    def apply_referral(self, referred_user_id: int, code_str: str) -> Tuple[bool, str]:
        """Apply a referral code to a new user."""
        with get_session() as session:
            # Check if user already has a referrer
            existing = session.query(Referral).filter(
                Referral.referred_id == referred_user_id
            ).first()
            
            if existing:
                return False, "You've already been referred"
            
            # Find referral code
            code = session.query(ReferralCode).filter(
                ReferralCode.code == code_str.upper(),
                ReferralCode.is_active == True,
            ).first()
            
            if not code:
                return False, "Invalid referral code"
            
            # Can't refer yourself
            if code.user_id == referred_user_id:
                return False, "Can't use your own referral code"
            
            # Create referral
            referral = Referral(
                referrer_id=code.user_id,
                referred_id=referred_user_id,
                referral_code_id=code.id,
            )
            session.add(referral)
            
            # Update code stats
            code.total_referrals += 1
            
            # Instant signup bonuses: reward referrer + give the referred user a starting balance
            code.pending_rewards_usd += self.SIGNUP_BONUS_REFERRER_USD
            code.total_rewards_usd += self.SIGNUP_BONUS_REFERRER_USD
            
            referred_code = session.query(ReferralCode).filter(
                ReferralCode.user_id == referred_user_id
            ).first()
            if not referred_code:
                referred_code = self._create_code_for_user(session, referred_user_id)
            # Ensure boosted reward for the referred user too
            if referred_code.reward_percentage < self.DEFAULT_REWARD_PERCENTAGE:
                referred_code.reward_percentage = self.DEFAULT_REWARD_PERCENTAGE
            referred_code.pending_rewards_usd += self.SIGNUP_BONUS_REFERRED_USD
            referred_code.total_rewards_usd += self.SIGNUP_BONUS_REFERRED_USD
        
        return True, (
            f"Referral applied! 50% fee share on every swap + "
            f"${self.SIGNUP_BONUS_REFERRER_USD:.0f} bonus for your referrer and "
            f"${self.SIGNUP_BONUS_REFERRED_USD:.0f} for you."
        )
    
    def get_referrer(self, user_id: int) -> Optional[int]:
        """Get the referrer's user_id for a user."""
        with get_session() as session:
            referral = session.query(Referral).filter(
                Referral.referred_id == user_id
            ).first()
            
            return referral.referrer_id if referral else None
    
    # === Rewards ===
    
    def record_swap_reward(
        self,
        referred_user_id: int,
        swap_id: int,
        fee_amount_usd: float,
    ) -> Optional[ReferralReward]:
        """Record a reward from a referred user's swap."""
        with get_session() as session:
            # Get referral relationship
            referral = session.query(Referral).filter(
                Referral.referred_id == referred_user_id
            ).first()
            
            if not referral:
                return None
            
            # Get reward percentage
            code = session.query(ReferralCode).filter(
                ReferralCode.id == referral.referral_code_id
            ).first()
            
            if not code or not code.is_active:
                return None
            
            reward_pct = code.reward_percentage
            reward_amount = fee_amount_usd * (reward_pct / 100)
            
            # Create reward record
            reward = ReferralReward(
                referral_id=referral.id,
                swap_id=swap_id,
                fee_amount_usd=fee_amount_usd,
                reward_amount_usd=reward_amount,
                reward_percentage=reward_pct,
            )
            session.add(reward)
            
            # Update stats
            referral.volume_usd += fee_amount_usd
            referral.rewards_earned_usd += reward_amount
            
            code.total_volume_usd += fee_amount_usd
            code.total_rewards_usd += reward_amount
            code.pending_rewards_usd += reward_amount
            
            session.flush()
            reward_id = reward.id
        
        with get_session() as session:
            return session.query(ReferralReward).filter(
                ReferralReward.id == reward_id
            ).first()
    
    def get_pending_rewards(self, user_id: int) -> float:
        """Get total pending rewards for a user."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == user_id
            ).first()
            
            return code.pending_rewards_usd if code else 0.0
    
    def get_referral_stats(self, user_id: int) -> dict:
        """Get referral statistics for a user."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == user_id
            ).first()
            
            if not code:
                return {
                    "code": None,
                    "total_referrals": 0,
                    "total_volume_usd": 0,
                    "total_rewards_usd": 0,
                    "pending_rewards_usd": 0,
                    "reward_percentage": self.DEFAULT_REWARD_PERCENTAGE,
                }
            
            return {
                "code": code.code,
                "total_referrals": code.total_referrals,
                "total_volume_usd": code.total_volume_usd,
                "total_rewards_usd": code.total_rewards_usd,
                "pending_rewards_usd": code.pending_rewards_usd,
                "reward_percentage": code.reward_percentage,
            }
    
    def get_referred_users(self, user_id: int) -> list:
        """Get list of users referred by this user."""
        with get_session() as session:
            code = session.query(ReferralCode).filter(
                ReferralCode.user_id == user_id
            ).first()
            
            if not code:
                return []
            
            referrals = session.query(Referral).filter(
                Referral.referral_code_id == code.id
            ).all()
            
            result = []
            for ref in referrals:
                user = session.query(User).filter(User.id == ref.referred_id).first()
                result.append({
                    "user_id": ref.referred_id,
                    "username": user.username if user else "Unknown",
                    "volume_usd": ref.volume_usd,
                    "rewards_earned_usd": ref.rewards_earned_usd,
                    "joined_at": ref.created_at,
                })
            
            return result


# Global instance
referral_service = ReferralService()

