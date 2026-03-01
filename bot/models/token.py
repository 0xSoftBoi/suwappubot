"""Points-based rewards models — tiers, fee discounts, reward claims."""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Float, Numeric
from datetime import datetime
from database.db import Base


class PointsTier(Base):
    """User's points tier status, derived from XP + volume."""
    __tablename__ = "points_tiers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)

    tier = Column(String(20), default="none")  # none, bronze, silver, gold, diamond
    qualifying_xp = Column(Integer, default=0)
    qualifying_volume_usd = Column(Numeric(precision=20, scale=2), default=0)

    accumulated_rewards = Column(Numeric(precision=20, scale=8), default=0)  # USD rewards pool
    last_claim_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FeeDiscount(Base):
    """Fee discount based on points tier or subscription."""
    __tablename__ = "fee_discounts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    discount_tier = Column(String(20), default="none")  # none, bronze, silver, gold, diamond
    discount_percent = Column(Float, default=0.0)  # 0, 10, 20, 30, 50

    valid_until = Column(DateTime, nullable=True)  # NULL = perpetual (tier-based)
    source = Column(String(20), default="points")  # points, subscription, promotion

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
