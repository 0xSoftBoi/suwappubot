"""Advanced feature models - price alerts, limit orders, DCA, referrals."""

from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    Enum as SQLEnum,
)
from sqlalchemy.orm import relationship
import enum

from database.db import Base


class AlertType(enum.Enum):
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    PERCENT_CHANGE = "percent_change"


class OrderType(enum.Enum):
    LIMIT_BUY = "limit_buy"
    LIMIT_SELL = "limit_sell"
    STOP_LOSS = "stop_loss"
    TAKE_PROFIT = "take_profit"
    TRAILING_STOP = "trailing_stop"


class OrderStatus(enum.Enum):
    PENDING = "pending"
    TRIGGERED = "triggered"
    EXECUTED = "executed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    FAILED = "failed"


class DCAStatus(enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


# ============ ADVANCED PRICE ALERTS ============


class AdvancedPriceAlert(Base):
    """User price alerts with extended features."""

    __tablename__ = "advanced_price_alerts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    token_symbol = Column(String(20), nullable=False)
    chain = Column(String(50), default="ethereum")

    alert_type = Column(String(20), nullable=False)  # price_above, price_below, percent_change
    target_price = Column(Float, nullable=True)  # For price alerts
    percent_threshold = Column(Float, nullable=True)  # For percent change alerts
    base_price = Column(Float, nullable=True)  # Reference price for percent change

    is_active = Column(Boolean, default=True)
    is_triggered = Column(Boolean, default=False)
    triggered_at = Column(DateTime, nullable=True)
    triggered_price = Column(Float, nullable=True)

    # Notification settings
    notify_once = Column(Boolean, default=True)  # Disable after triggering

    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<PriceAlert {self.token_symbol} {self.alert_type} {self.target_price}>"


# ============ LIMIT ORDERS ============


class LimitOrder(Base):
    """Limit orders for automated swaps."""

    __tablename__ = "limit_orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False)

    order_type = Column(String(20), nullable=False)  # limit_buy, limit_sell, stop_loss
    status = Column(String(20), default=OrderStatus.PENDING.value)

    # Swap details
    from_chain = Column(String(50), nullable=False)
    from_token = Column(String(20), nullable=False)
    to_chain = Column(String(50), nullable=False)
    to_token = Column(String(20), nullable=False)

    # Order parameters
    amount = Column(String(78), nullable=False)  # Amount to swap
    trigger_price = Column(Float, nullable=False)  # Price to trigger at
    slippage = Column(Float, default=0.5)

    # Trailing stop fields (TRAILING_STOP order type only)
    trailing_percent = Column(Float, nullable=True)  # % below peak to trigger (e.g. 10.0 = 10%)
    highest_price_seen = Column(Float, nullable=True)  # ratcheted up each poll cycle

    # Expiration
    expires_at = Column(DateTime, nullable=True)

    # Execution
    executed_at = Column(DateTime, nullable=True)
    execution_price = Column(Float, nullable=True)
    tx_hash = Column(String(100), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<LimitOrder {self.order_type} {self.from_token}->{self.to_token} @ {self.trigger_price}>"


# ============ DCA (Dollar Cost Averaging) ============


class DCAOrder(Base):
    """Dollar Cost Averaging scheduled orders."""

    __tablename__ = "dca_orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False)

    status = Column(String(20), default=DCAStatus.ACTIVE.value)

    # Swap details
    from_chain = Column(String(50), nullable=False)
    from_token = Column(String(20), nullable=False)  # Usually USDC/USDT
    to_chain = Column(String(50), nullable=False)
    to_token = Column(String(20), nullable=False)  # Target token (ETH, BTC, etc.)

    # Schedule
    amount_per_execution = Column(String(78), nullable=False)  # Amount each time
    interval_hours = Column(Integer, nullable=False)  # Hours between executions
    next_execution_at = Column(DateTime, nullable=False)

    # Limits
    max_executions = Column(Integer, nullable=True)  # Total times to execute
    max_total_amount = Column(String(78), nullable=True)  # Max total to spend

    # Progress
    executions_completed = Column(Integer, default=0)
    total_spent = Column(String(78), default="0")
    total_received = Column(String(78), default="0")
    average_price = Column(Float, default=0)

    # End conditions
    ends_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DCAExecution(Base):
    """Individual DCA execution records."""

    __tablename__ = "dca_executions"

    id = Column(Integer, primary_key=True)
    dca_order_id = Column(Integer, ForeignKey("dca_orders.id"), nullable=False)

    amount_spent = Column(String(78), nullable=False)
    amount_received = Column(String(78), nullable=False)
    price = Column(Float, nullable=False)
    tx_hash = Column(String(100), nullable=True)

    executed_at = Column(DateTime, default=datetime.utcnow)


# ============ REFERRALS ============
# Note: ReferralCode is now in bot/models/referral.py


class AdvancedReferral(Base):
    """Referral relationships with detailed tracking."""

    __tablename__ = "advanced_referrals"

    id = Column(Integer, primary_key=True)
    referrer_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Who referred
    referred_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Who was referred
    referral_code_id = Column(Integer, ForeignKey("referral_codes.id"), nullable=False)

    # Stats for this referral
    volume_usd = Column(Float, default=0)
    rewards_earned_usd = Column(Float, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)


# Note: ReferralReward is now in bot/models/referral.py

# ============ SWAP TEMPLATES ============


class SwapTemplate(Base):
    """Saved swap templates for quick repeat."""

    __tablename__ = "swap_templates"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    name = Column(String(50), nullable=False)  # "Daily ETH buy"

    from_chain = Column(String(50), nullable=False)
    from_token = Column(String(20), nullable=False)
    to_chain = Column(String(50), nullable=False)
    to_token = Column(String(20), nullable=False)

    default_amount = Column(String(78), nullable=True)  # Optional preset amount
    slippage = Column(Float, default=0.5)

    use_count = Column(Integer, default=0)
    last_used_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


# ============ USER STATS & P&L ============


class UserStats(Base):
    """Aggregated user statistics."""

    __tablename__ = "user_stats"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    # Volume
    total_swaps = Column(Integer, default=0)
    total_volume_usd = Column(Float, default=0)

    # P&L tracking
    total_fees_paid_usd = Column(Float, default=0)
    total_gas_paid_usd = Column(Float, default=0)

    # Token holdings at time of swaps (for P&L calculation)
    realized_pnl_usd = Column(Float, default=0)

    # Streaks
    current_streak_days = Column(Integer, default=0)
    longest_streak_days = Column(Integer, default=0)
    last_swap_date = Column(DateTime, nullable=True)

    # Tier
    tier = Column(String(20), default="bronze")  # bronze, silver, gold, platinum

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PortfolioSnapshot(Base):
    """Daily portfolio value snapshots for charts."""

    __tablename__ = "portfolio_snapshots"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    date = Column(String(10), nullable=False)  # YYYY-MM-DD
    total_value_usd = Column(Float, nullable=False)

    # Breakdown by chain (JSON)
    chain_values = Column(Text, nullable=True)  # {"ethereum": 1000, "polygon": 500}

    created_at = Column(DateTime, default=datetime.utcnow)


# ============ RUG MONITORS ============


class RugMonitor(Base):
    """Tracks tokens being monitored for rug pulls."""

    __tablename__ = "rug_monitors"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_address = Column(String(255), nullable=False)
    chain = Column(String(50), nullable=False)
    token_symbol = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True)
    auto_sell_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
