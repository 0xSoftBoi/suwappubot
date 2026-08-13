"""Savings (Aave V3) event log model."""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey

from database.db import Base


class SavingsEvent(Base):
    """Audit log of every savings deposit/withdraw (non-custodial Aave V3 USDC)."""

    __tablename__ = "savings_events"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True, index=True)
    chain = Column(String(32), nullable=False, default="base")
    token = Column(String(16), nullable=False, default="USDC")
    action = Column(String(16), nullable=False)  # deposit / withdraw
    amount = Column(Numeric(18, 6), nullable=True)  # None for withdraw-all
    tx_hash = Column(String(80), nullable=True)
    memo = Column(String(256), nullable=True)  # optional user-supplied reconciliation memo
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
