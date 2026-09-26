"""Token staking and distribution models."""

from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    ForeignKey,
    Numeric,
    UniqueConstraint,
)
from database.db import Base


class TokenClaim(Base):
    """Points -> SUWP conversion queue."""

    __tablename__ = "token_claims"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_address = Column(String(42), nullable=False)  # Base wallet to receive SUWP
    points_burned = Column(Integer, nullable=False)
    suwp_amount = Column(Numeric(18, 6), nullable=False)  # points_burned / 1000
    status = Column(String(20), default="pending")  # pending/processing/completed/failed
    tx_hash = Column(String(255), nullable=True)
    error_message = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class StakingPosition(Base):
    """User SUWP staking position."""

    __tablename__ = "staking_positions"
    __table_args__ = (UniqueConstraint("user_id", name="uq_staking_user_id"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_address = Column(String(42), nullable=False)  # Base wallet holding SUWP
    suwp_staked = Column(Numeric(18, 6), nullable=False, default=0)
    staked_since = Column(DateTime, nullable=True)
    last_reward_epoch = Column(Integer, nullable=True)  # last epoch rewards were claimed
    total_usdc_claimed = Column(Numeric(18, 6), default=0)
    total_suwp_bonus_claimed = Column(Numeric(18, 6), default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DistributionEpoch(Base):
    """Weekly fee distribution epoch snapshot."""

    __tablename__ = "distribution_epochs"

    id = Column(Integer, primary_key=True)
    epoch_number = Column(Integer, unique=True, nullable=False)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    total_fees_usdc = Column(Numeric(18, 6), nullable=False, default=0)
    staking_pool_usdc = Column(Numeric(18, 6), nullable=False, default=0)  # 20%
    protocol_usdc = Column(Numeric(18, 6), nullable=False, default=0)  # 80%
    total_suwp_staked = Column(Numeric(18, 6), nullable=False, default=0)  # snapshot
    suwp_emission = Column(Numeric(18, 6), nullable=False, default=10000)  # 10k SUWP/week bonus
    status = Column(String(20), default="pending")  # pending/processing/completed
    direct_fees_usdc = Column(Numeric(18, 6), nullable=True)
    treasury_yield_usdc = Column(Numeric(18, 6), nullable=True)
    total_staker_usdc = Column(Numeric(18, 6), nullable=True)
    treasury_aum_usdc = Column(Numeric(18, 6), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    distributed_at = Column(DateTime, nullable=True)


class EpochReward(Base):
    """Individual staker reward record per epoch."""

    __tablename__ = "epoch_rewards"

    id = Column(Integer, primary_key=True)
    epoch_id = Column(Integer, ForeignKey("distribution_epochs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    suwp_staked_snapshot = Column(Numeric(18, 6), nullable=False)
    usdc_reward = Column(Numeric(18, 6), nullable=False)
    suwp_bonus = Column(Numeric(18, 6), nullable=False)
    status = Column(String(20), default="pending")  # pending/paid/failed
    tx_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)


class TreasuryPosition(Base):
    """Aave v3 vault position tracking."""

    __tablename__ = "treasury_positions"
    id = Column(Integer, primary_key=True)
    vault_name = Column(String(50), nullable=False, default="aave_v3_base_usdc")
    chain = Column(String(20), nullable=False, default="base")
    principal_usdc = Column(Numeric(18, 6), nullable=False, default=0)
    current_a_token_balance = Column(Numeric(18, 6), nullable=False, default=0)
    total_yield_harvested_usdc = Column(Numeric(18, 6), nullable=False, default=0)
    last_deposit_at = Column(DateTime, nullable=True)
    last_harvest_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
