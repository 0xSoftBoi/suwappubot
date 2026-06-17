"""Persistence for the HyperLiquid ecosystem (staking, vaults, TWAP orders).

These tables let the bot track state that the raw HyperLiquid API is
stateless about from the user's perspective — what a user delegated and to
whom, their vault entries, and in-flight TWAP orders — so it can surface them
in the portfolio, monitor them in the background, and notify on changes.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey, Boolean

from database.db import Base


class HLStakeRecord(Base):
    """A user's delegation to a single HyperLiquid validator."""

    __tablename__ = "hl_stake_records"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    validator = Column(String(66), nullable=False, index=True)  # 0x validator address
    validator_name = Column(String(120), nullable=True)

    amount_hype = Column(Numeric(precision=30, scale=8), default=0)  # currently delegated
    locked_until = Column(DateTime, nullable=True)  # undelegation unlock (1-day lockup)

    # rolling reward tracking (delta of delegatorSummary over time)
    rewards_hype = Column(Numeric(precision=30, scale=8), default=0)

    status = Column(String(20), default="delegated", index=True)  # delegated, undelegated

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HLVaultPosition(Base):
    """A user's position in a HyperLiquid vault (HLP or a user vault)."""

    __tablename__ = "hl_vault_positions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    vault_address = Column(String(66), nullable=False, index=True)
    vault_name = Column(String(120), nullable=True)

    equity_usd = Column(Numeric(precision=20, scale=2), default=0)
    pnl_usd = Column(Numeric(precision=20, scale=2), default=0)  # current-cycle pnl
    all_time_pnl_usd = Column(Numeric(precision=20, scale=2), default=0)
    deposited_usd = Column(Numeric(precision=20, scale=2), default=0)  # net deposits
    lockup_until = Column(DateTime, nullable=True)

    is_open = Column(Boolean, default=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HLTwapOrder(Base):
    """An in-flight or completed TWAP order placed through the bot."""

    __tablename__ = "hl_twap_orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    twap_id = Column(String(60), nullable=True, index=True)  # HyperLiquid twapId
    market = Column(String(50), nullable=False)
    side = Column(String(10), nullable=False)  # long / short
    size = Column(Numeric(precision=30, scale=8), nullable=False)
    minutes = Column(Integer, nullable=False)

    status = Column(
        String(20), default="running", index=True
    )  # running, finished, cancelled, error
    filled_size = Column(Numeric(precision=30, scale=8), default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)
