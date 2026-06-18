"""Morpho Blue borrow-position registry (health-monitor watchlist)."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String

from database.db import Base


class MorphoPosition(Base):
    """One open Morpho Blue borrow position per (user, wallet, market).

    The on-chain position is the source of truth; this row only tells the
    health monitor WHO to poll and tracks the alert tier already sent so the
    user isn't re-notified every cycle.
    """

    __tablename__ = "morpho_positions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True, index=True)
    market_id = Column(String(66), nullable=False)
    opened_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    closed_at = Column(DateTime, nullable=True)
    last_hf = Column(Numeric(20, 6), nullable=True)  # None until first poll / debt-free
    notified_tier = Column(String(16), nullable=True)  # None | "warn" | "urgent"
