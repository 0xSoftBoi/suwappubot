"""Prediction market models for Polymarket integration."""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Float, Boolean, DateTime,
    ForeignKey, Text, Numeric, UniqueConstraint,
)
from sqlalchemy.sql import func

from database.db import Base


class PredictionOrder(Base):
    """Individual prediction market order."""
    __tablename__ = "prediction_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)

    # Market info
    market_id = Column(String(255), nullable=False)  # condition_id
    market_question = Column(Text, nullable=True)
    token_id = Column(String(255), nullable=False)
    outcome = Column(String(10), nullable=False)  # "Yes" or "No"
    side = Column(String(10), nullable=False)  # "BUY" or "SELL"

    # Order details
    amount_usdc = Column(Numeric(20, 6), nullable=True)
    shares = Column(Numeric(20, 6), nullable=True)
    price = Column(Numeric(10, 4), nullable=True)

    # Status
    status = Column(String(20), default="pending")  # pending/placed/filled/cancelled/failed

    # Execution
    clob_order_id = Column(String(255), nullable=True)
    tx_hash = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    def __repr__(self):
        return f"<PredictionOrder {self.id} {self.outcome} {self.side} {self.status}>"


class PredictionPosition(Base):
    """Aggregated prediction market position for a user."""
    __tablename__ = "prediction_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False, index=True)

    # Market info
    market_id = Column(String(255), nullable=False)
    market_question = Column(Text, nullable=True)
    token_id = Column(String(255), nullable=False)
    outcome = Column(String(10), nullable=False)  # "Yes" or "No"

    # Position details
    total_shares = Column(Numeric(20, 6), default=0)
    avg_entry_price = Column(Numeric(10, 4), nullable=True)
    total_cost_usdc = Column(Numeric(20, 6), default=0)

    # Live tracking
    current_price = Column(Numeric(10, 4), nullable=True)
    unrealized_pnl = Column(Numeric(20, 6), nullable=True)

    # Resolution
    is_resolved = Column(Boolean, default=False)
    resolved_payout = Column(Numeric(20, 6), nullable=True)

    # Timestamps
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "market_id", "token_id", name="uq_user_market_token"),
    )

    def __repr__(self):
        return f"<PredictionPosition {self.id} {self.outcome} shares={self.total_shares}>"
