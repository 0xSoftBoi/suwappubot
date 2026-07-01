"""Referral system database models.

Implements a 30% referral reward system for viral growth.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from database.db import Base


class Referral(Base):
    """Tracks referral relationships between users.

    When user B signs up with user A's referral code:
    - referrer_id = A's user ID
    - referee_id = B's user ID
    - A earns 30% of all fees B pays
    """

    __tablename__ = "referrals"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Referral relationship
    referrer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    referee_id = Column(
        Integer, ForeignKey("users.id"), nullable=False, unique=True
    )  # One referrer per user

    # Referral code used
    referral_code = Column(String(32), nullable=False, index=True)

    # Tracking
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)  # Can be deactivated if abuse detected

    # Referral v2: referee rebate — first 5 swaps get a 10% fee discount (reward-side)
    referee_swap_rebate_remaining = Column(Integer, default=5)

    # Relationships
    referrer = relationship("User", foreign_keys=[referrer_id], backref="referrals_made")
    referee = relationship("User", foreign_keys=[referee_id], backref="referred_by")

    # Indexes for efficient queries
    __table_args__ = (Index("ix_referrals_referrer_active", "referrer_id", "is_active"),)


class ReferralCode(Base):
    """Stores unique referral codes for each user.

    Each user gets one unique code they can share.
    Code format: USERNAME_XXXX or USER_XXXX (4 random chars)
    """

    __tablename__ = "referral_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    code = Column(String(32), nullable=False, unique=True, index=True)

    # Stats
    times_used = Column(Integer, default=0)
    total_rewards_earned = Column(Float, default=0.0)  # Total USD earned from this code

    # Referral v2: volume-milestone tier (standard / power / elite)
    referrer_tier = Column(String(20), default="standard")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)

    # Relationship
    user = relationship("User", backref="referral_code")


class ReferralReward(Base):
    """Tracks individual referral rewards from swaps.

    Every time a referee swaps, 30% of the fee goes to the referrer.
    """

    __tablename__ = "referral_rewards"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Links
    referral_id = Column(Integer, ForeignKey("referrals.id"), nullable=False, index=True)
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=False, unique=True)

    # Reward details
    fee_amount_usd = Column(Float, nullable=False)  # Total fee paid by referee
    reward_amount_usd = Column(Float, nullable=False)  # 30% of fee (referrer's reward)

    # Status
    is_paid = Column(Boolean, default=False)  # Whether reward has been paid out
    paid_at = Column(DateTime, nullable=True)

    # Referral v2: FK to the ReferralPayout that consumed this reward row.
    # Set atomically with is_paid=True in claim_rewards so reject_referral_claim
    # can find the exact rows belonging to a payout without timestamp correlation.
    payout_id = Column(Integer, ForeignKey("referral_payouts.id"), nullable=True, index=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    referral = relationship("Referral", backref="rewards")

    # Indexes
    __table_args__ = (Index("ix_referral_rewards_unpaid", "referral_id", "is_paid"),)


class ReferralPayout(Base):
    """Tracks batch payouts of referral rewards.

    Rewards are accumulated and paid out periodically or on request.
    """

    __tablename__ = "referral_payouts"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # User receiving payout
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Payout details
    amount_usd = Column(Float, nullable=False)
    token = Column(String(20), nullable=False)  # Token paid in (USDC, etc.)
    token_amount = Column(String(78), nullable=False)  # Raw token amount
    chain = Column(String(50), nullable=False)

    # Transaction
    tx_hash = Column(String(128), nullable=True)
    status = Column(String(20), default="pending")  # pending, processing, completed, failed

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Error tracking
    error_message = Column(String(500), nullable=True)

    # Referral v2: large-claim review flag — set True when claim > $500; not credited until reviewed
    needs_review = Column(Boolean, default=False)

    # Relationship
    user = relationship("User", backref="referral_payouts")
