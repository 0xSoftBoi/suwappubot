"""Perpetual trading models for HyperLiquid integration."""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Float, Numeric
from datetime import datetime
from database.db import Base


class PerpPosition(Base):
    """Perpetual trading position."""
    __tablename__ = "perp_positions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)

    exchange = Column(String(50), default="hyperliquid")
    market = Column(String(50), nullable=False)  # "ETH-USD", "BTC-USD"
    side = Column(String(10), nullable=False)  # "long" or "short"

    size = Column(Numeric(precision=20, scale=8), nullable=False)  # Position size
    entry_price = Column(Numeric(precision=20, scale=8), nullable=False)
    mark_price = Column(Numeric(precision=20, scale=8), nullable=True)
    leverage = Column(Integer, default=1)
    margin = Column(Numeric(precision=20, scale=8), nullable=True)

    unrealized_pnl = Column(Numeric(precision=20, scale=8), default=0)
    liquidation_price = Column(Numeric(precision=20, scale=8), nullable=True)

    tp_price = Column(Numeric(precision=20, scale=8), nullable=True)  # Take profit
    sl_price = Column(Numeric(precision=20, scale=8), nullable=True)  # Stop loss

    status = Column(String(20), default="open", index=True)  # open, closed, liquidated

    opened_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    closed_pnl = Column(Numeric(precision=20, scale=8), nullable=True)


class PerpOrder(Base):
    """Perpetual trading order."""
    __tablename__ = "perp_orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    position_id = Column(Integer, ForeignKey("perp_positions.id"), nullable=True)

    exchange = Column(String(50), default="hyperliquid")
    market = Column(String(50), nullable=False)
    side = Column(String(10), nullable=False)  # "long" or "short"

    order_type = Column(String(20), nullable=False)  # market, limit, stop_market, take_profit, stop_loss
    size = Column(Numeric(precision=20, scale=8), nullable=False)
    price = Column(Numeric(precision=20, scale=8), nullable=True)  # NULL for market orders
    leverage = Column(Integer, default=1)

    status = Column(String(20), default="pending", index=True)  # pending, filled, cancelled, failed
    hl_order_id = Column(String(100), nullable=True)  # HyperLiquid order ID

    fill_price = Column(Numeric(precision=20, scale=8), nullable=True)
    filled_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HyperLiquidAccount(Base):
    """User's HyperLiquid account configuration."""
    __tablename__ = "hyperliquid_accounts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)

    hl_address = Column(String(255), nullable=True)  # HyperLiquid address
    api_key_encrypted = Column(Text, nullable=True)
    api_secret_encrypted = Column(Text, nullable=True)

    is_active = Column(Boolean, default=True)
    total_equity = Column(Numeric(precision=20, scale=8), default=0)
    available_margin = Column(Numeric(precision=20, scale=8), default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
