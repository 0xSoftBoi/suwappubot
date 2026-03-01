"""$SUWAPPU native token models — staking, airdrops, fee discounts."""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Float, Numeric
from datetime import datetime
from database.db import Base


class SuwappuStake(Base):
    """User's staked $SUWAPPU tokens."""
    __tablename__ = "suwappu_stakes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)

    amount = Column(Numeric(precision=20, scale=8), nullable=False)
    tier = Column(String(20), default="none")  # none, bronze, silver, gold, diamond

    staked_at = Column(DateTime, default=datetime.utcnow)
    unstake_requested_at = Column(DateTime, nullable=True)  # 7-day cooldown
    unstaked_at = Column(DateTime, nullable=True)

    is_active = Column(Boolean, default=True)
    accumulated_rewards = Column(Numeric(precision=20, scale=8), default=0)
    last_claim_at = Column(DateTime, nullable=True)


class AirdropSnapshot(Base):
    """Snapshot of user eligibility for $SUWAPPU airdrop."""
    __tablename__ = "airdrop_snapshots"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    xp_balance = Column(Integer, default=0)
    trade_volume_usd = Column(Numeric(precision=20, scale=2), default=0)
    referral_count = Column(Integer, default=0)

    allocation = Column(Numeric(precision=20, scale=8), default=0)  # Token allocation

    snapshot_at = Column(DateTime, default=datetime.utcnow)
    claimed = Column(Boolean, default=False)
    claimed_at = Column(DateTime, nullable=True)
    claim_tx_hash = Column(String(128), nullable=True)


class FeeDiscount(Base):
    """Fee discount based on staking tier or subscription."""
    __tablename__ = "fee_discounts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    discount_tier = Column(String(20), default="none")  # none, bronze, silver, gold, diamond
    discount_percent = Column(Float, default=0.0)  # 0, 10, 20, 30, 50

    valid_until = Column(DateTime, nullable=True)  # NULL = perpetual (stake-based)
    source = Column(String(20), default="stake")  # stake, subscription, promotion

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
