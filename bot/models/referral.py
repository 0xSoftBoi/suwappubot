"""Referral system database models.

Multi-stream referral commission system:
  - swap:      percentage of fee from each referred user's swap
  - perps:     volume-tiered percentage (20%-80%) of fee from referred user's perp trades
  - milestone: fixed bonus at 5/10/20/50/100 verified referrals (open-ended thresholds)

Pre-existing tables (referrals, referral_codes, referral_rewards, referral_payouts) are
left structurally intact.  New columns on referrals (verified_at, perps_volume_14d_usd)
are added by the runtime migration _add_referral_stream_columns().
New tables (referral_earnings, referral_milestones) are added by their own migration
functions in database/db.py.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import relationship

from database.db import Base


class Referral(Base):
    """Tracks referral relationships between users.

    When user B signs up with user A's referral code:
    - referrer_id = A's user ID
    - referee_id = B's user ID

    verified_at is NULL until the service layer confirms the referee is
    legitimate (fraud/activity check).  Only verified referrals count toward
    milestone thresholds and perps-tier calculations.
    perps_volume_14d_usd is a rolling 14-day window updated by the perps
    commission service; it determines the volume tier (20%-80% rate).
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

    # Multi-stream additions (added by _add_referral_stream_columns migration)
    verified_at = Column(DateTime, nullable=True)  # NULL = unverified
    perps_volume_14d_usd = Column(Float, default=0.0)  # 14-day rolling perp volume for tier calc

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
    """Tracks individual referral rewards from swaps (legacy per-swap table).

    Every time a referee swaps, a tier-based percentage of the fee goes to
    the referrer (see referral_service._l1_rate_for_tier).  Retained for
    backward compatibility with claim_rewards.  New multi-stream earnings
    are additionally recorded in ReferralEarning.
    """

    __tablename__ = "referral_rewards"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Links
    referral_id = Column(Integer, ForeignKey("referrals.id"), nullable=False, index=True)
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=False, unique=True)

    # Reward details
    fee_amount_usd = Column(Float, nullable=False)  # Total fee paid by referee
    reward_amount_usd = Column(Float, nullable=False)  # Referrer's tier-based share of fee

    # Status
    is_paid = Column(Boolean, default=False)
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
    token_amount = Column(String(78), nullable=False)  # Raw token amount (uint256 as string)
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


class ReferralEarning(Base):
    """Append-only ledger of every referral commission credit.

    stream_type values:
      'swap'      - commission from a referred user's swap fee
      'perps'     - volume-tiered commission from a referred user's perp trade fee
      'milestone' - fixed bonus at a verified-referral count threshold

    commission_rate stores the decimal rate applied (e.g. 0.30 for 30%).
    For milestone rows commission_rate is NULL (it is a fixed bonus, not a rate).
    referred_id is NULL for milestone rows (the bonus is not tied to one referee).
    metadata is a free-form JSON string for any extra context the service layer wants.

    Negative rows represent clawbacks (same stream_type, negative amount_usd).
    No expiry or cap columns — the system is open-ended by design.
    """

    __tablename__ = "referral_earnings"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Who earns (always set)
    referrer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Whose activity triggered the earning (NULL for milestone rows)
    referred_id = Column(Integer, nullable=True, index=True)

    # Commission stream identifier: 'swap' | 'perps' | 'milestone'
    stream_type = Column(String(20), nullable=False, index=True)

    # Credit amount in USD (positive = credit, negative = clawback)
    amount_usd = Column(Float, nullable=False)

    # Optional token denomination (e.g. 'USDC') — NULL means USD-only accounting
    token = Column(String(20), nullable=True)

    # Source-event foreign keys (at most one will be set per row)
    swap_id = Column(Integer, nullable=True)  # referral_rewards.swap_id equivalent
    perp_order_id = Column(Integer, nullable=True)  # perp_orders.id

    # Milestone context (set only when stream_type == 'milestone')
    milestone_count = Column(Integer, nullable=True)

    # Decimal rate applied; NULL for milestone rows
    commission_rate = Column(Float, nullable=True)

    # Free-form JSON for extra service-layer context
    # NOTE: "metadata" is reserved by SQLAlchemy's declarative base — the ORM
    # attribute is named earning_metadata; the DB column remains "metadata".
    earning_metadata = Column("metadata", Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    referrer = relationship("User", foreign_keys=[referrer_id], backref="referral_earnings")

    __table_args__ = (
        Index("ix_referral_earnings_referrer_stream", "referrer_id", "stream_type"),
        Index("ix_referral_earnings_created_at", "created_at"),
    )


class ReferralMilestone(Base):
    """Records each milestone bonus unlocked by a referrer.

    milestone_count is the threshold crossed (5, 10, 20, 50, 100, …).
    The UNIQUE constraint on (referrer_id, milestone_count) prevents
    double-crediting even if the service fires twice.

    earning_id points to the ReferralEarning row that recorded the bonus
    credit; it is set after that row is written and may be NULL during a
    brief window between milestone detection and credit insertion.

    No expiry column — milestones are permanent once earned.
    """

    __tablename__ = "referral_milestones"

    id = Column(Integer, primary_key=True, autoincrement=True)

    referrer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    milestone_count = Column(Integer, nullable=False)  # 5 | 10 | 20 | 50 | 100 | …
    bonus_usd = Column(Float, nullable=False)  # Fixed USD bonus amount

    earned_at = Column(DateTime, default=datetime.utcnow)

    # FK to the ledger row; nullable briefly during write sequencing
    earning_id = Column(Integer, ForeignKey("referral_earnings.id"), nullable=True)

    # Relationships
    referrer = relationship("User", foreign_keys=[referrer_id], backref="referral_milestones")

    __table_args__ = (
        Index(
            "uq_referral_milestones_referrer_count", "referrer_id", "milestone_count", unique=True
        ),
    )
