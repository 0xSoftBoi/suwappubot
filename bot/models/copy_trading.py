"""Copy Trading database models.

Enables social trading where users can:
- Create public trader profiles
- Follow successful traders
- Copy trades automatically or with notifications
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    JSON,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database.db import Base


class TraderProfile(Base):
    """Public profile for users who opt-in to be followed."""

    __tablename__ = "trader_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)

    # Profile settings
    is_public = Column(Boolean, default=False)  # Must opt-in to be visible
    display_name = Column(String(50), nullable=True)  # Public name
    bio = Column(String(255), nullable=True)  # Short bio
    avatar_emoji = Column(String(10), default="🦊")  # Profile emoji

    # Performance stats (updated after each swap)
    total_trades = Column(Integer, default=0)
    winning_trades = Column(Integer, default=0)
    total_pnl_usd = Column(Float, default=0.0)  # Realized + unrealized
    total_volume_usd = Column(Float, default=0.0)

    # Computed metrics
    win_rate = Column(Float, default=0.0)  # percentage
    avg_trade_size_usd = Column(Float, default=0.0)
    best_trade_pnl_usd = Column(Float, default=0.0)
    worst_trade_pnl_usd = Column(Float, default=0.0)

    # Copy stats
    follower_count = Column(Integer, default=0)
    times_copied = Column(Integer, default=0)
    total_copy_volume_usd = Column(Float, default=0.0)

    # Ranking
    rank_score = Column(Float, default=0.0)  # Composite score for leaderboard

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", backref="trader_profile")

    def update_stats(self, pnl: float, volume: float, is_win: bool):
        """Update trading stats after a swap."""
        self.total_trades += 1
        self.total_volume_usd += volume
        self.total_pnl_usd += pnl

        if is_win:
            self.winning_trades += 1

        self.win_rate = (
            (self.winning_trades / self.total_trades) * 100 if self.total_trades > 0 else 0
        )
        self.avg_trade_size_usd = (
            self.total_volume_usd / self.total_trades if self.total_trades > 0 else 0
        )

        if pnl > self.best_trade_pnl_usd:
            self.best_trade_pnl_usd = pnl
        if pnl < self.worst_trade_pnl_usd:
            self.worst_trade_pnl_usd = pnl

        # Update rank score (composite: volume * win_rate * log(trades))
        import math

        trade_factor = math.log10(self.total_trades + 1)
        self.rank_score = (self.total_volume_usd * (self.win_rate / 100) * trade_factor) / 1000

    def format_stats(self) -> str:
        """Format stats for display."""
        pnl_emoji = "📈" if self.total_pnl_usd >= 0 else "📉"
        return (
            f"{self.avatar_emoji} *{self.display_name or 'Anonymous'}*\n"
            f"{self.bio or ''}\n\n"
            f"📊 *Stats*\n"
            f"• Trades: {self.total_trades}\n"
            f"• Win Rate: {self.win_rate:.1f}%\n"
            f"• Volume: ${self.total_volume_usd:,.2f}\n"
            f"• PnL: {pnl_emoji} ${self.total_pnl_usd:,.2f}\n"
            f"• Followers: {self.follower_count}\n"
            f"• Times Copied: {self.times_copied}\n"
        )


class CopyFollow(Base):
    """Tracks who follows who for copy trading."""

    __tablename__ = "copy_follows"

    id = Column(Integer, primary_key=True, autoincrement=True)
    follower_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    trader_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Copy settings
    copy_mode = Column(String(20), default="notify")  # "notify", "auto", "paper"
    copy_type = Column(String(20), default="fixed")  # "fixed", "percentage"
    copy_amount_usd = Column(Float, default=10.0)  # Fixed USD amount
    copy_percentage = Column(Float, default=100.0)  # Percentage of trader's amount

    # Limits
    max_trade_usd = Column(Float, default=100.0)  # Max per trade
    daily_limit_usd = Column(Float, default=500.0)  # Daily copy limit
    daily_copied_usd = Column(Float, default=0.0)  # Tracked daily
    last_daily_reset = Column(DateTime, nullable=True)

    # Advanced filters
    min_trade_usd = Column(Float, nullable=True)  # skip copies below this USD size
    min_wallet_pnl_pct = Column(Float, nullable=True)  # only copy if trader's all-time PnL% >= this
    min_token_age_hours = Column(Float, nullable=True)  # skip tokens launched less than N hours ago

    # Slippage
    max_slippage_percent = Column(Float, default=1.0)

    # Status
    is_active = Column(Boolean, default=True)

    # Enhanced copy settings are already present in the shared Postgres schema
    # (and in api-ts Drizzle).  Keep SQLAlchemy in sync so Terminal settings are
    # actually enforced by copy_service instead of being silently discarded.
    auto_sell_enabled = Column(Boolean, default=True)
    chains_filter = Column(String(200), nullable=True)

    # Stats
    total_copied_trades = Column(Integer, default=0)
    total_copied_volume = Column(Float, default=0.0)
    total_copy_pnl = Column(Float, default=0.0)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Unique constraint: one follow relationship per pair
    __table_args__ = (
        Index("ix_copy_follows_unique", "follower_id", "trader_id", unique=True),
        Index("ix_copy_follows_trader_active", "trader_id", "is_active"),
    )

    def check_daily_limit(self, amount_usd: float) -> bool:
        """Check if amount fits within daily limit."""
        today = datetime.now(timezone.utc).date()
        if not self.last_daily_reset or self.last_daily_reset.date() < today:
            self.daily_copied_usd = 0.0
            self.last_daily_reset = datetime.now(timezone.utc)

        return (self.daily_copied_usd + amount_usd) <= self.daily_limit_usd

    def get_copy_amount(self, trader_amount_usd: float) -> float:
        """Calculate the copy amount based on settings."""
        if self.copy_type == "fixed":
            amount = self.copy_amount_usd
        else:  # percentage
            amount = trader_amount_usd * (self.copy_percentage / 100)

        # Apply max trade limit
        return min(amount, self.max_trade_usd)


class CopyTrade(Base):
    """Records each copied trade."""

    __tablename__ = "copy_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Relationships
    original_swap_id = Column(
        Integer, ForeignKey("swap_transactions.id"), nullable=False, index=True
    )
    copy_swap_id = Column(
        Integer, ForeignKey("swap_transactions.id"), nullable=True
    )  # Null if pending/failed
    trader_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    copier_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    follow_id = Column(Integer, ForeignKey("copy_follows.id"), nullable=False)

    # Trade details (copied from original)
    from_token = Column(String(20), nullable=False)
    to_token = Column(String(20), nullable=False)
    from_chain = Column(String(20), nullable=False)
    to_chain = Column(String(20), nullable=False)

    # Amounts
    trader_amount_usd = Column(Float, nullable=False)
    copy_amount_usd = Column(Float, nullable=False)

    # Status
    status = Column(
        String(20), default="pending"
    )  # pending/auto_pending/notified/executing/copied/outcome_unknown/skipped/failed
    failure_reason = Column(String(255), nullable=True)

    # PnL tracking
    entry_price = Column(Float, nullable=True)
    exit_price = Column(Float, nullable=True)
    pnl_usd = Column(Float, nullable=True)
    paper_entry_price_usd = Column(Float, nullable=True)  # set when copy_mode == "paper"

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    copied_at = Column(DateTime, nullable=True)

    # Indexes for efficient queries
    __table_args__ = (
        Index("ix_copy_trades_copier_status", "copier_id", "status"),
        Index("ix_copy_trades_original", "original_swap_id"),
    )


class CopyNotification(Base):
    """Tracks notifications sent to followers."""

    __tablename__ = "copy_notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    copy_trade_id = Column(Integer, ForeignKey("copy_trades.id"), nullable=False, index=True)

    # Notification details
    telegram_message_id = Column(Integer, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow)

    # User action
    action_taken = Column(String(20), nullable=True)  # "copied", "skipped", "ignored"
    action_at = Column(DateTime, nullable=True)


class TraderTrade(Base):
    """Historical record of a trader's swaps for performance tracking."""

    __tablename__ = "trader_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trader_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=False, unique=True)

    # Trade details
    from_token = Column(String(20), nullable=False)
    to_token = Column(String(20), nullable=False)
    from_chain = Column(String(20), nullable=False)
    to_chain = Column(String(20), nullable=False)
    amount_usd = Column(Float, nullable=False)

    # PnL calculation
    entry_price = Column(Float, nullable=True)  # Price at swap time
    current_price = Column(Float, nullable=True)  # Latest price
    is_closed = Column(Boolean, default=False)  # True if position closed
    pnl_usd = Column(Float, default=0.0)
    pnl_percent = Column(Float, default=0.0)

    # Result
    is_winning = Column(Boolean, nullable=True)  # Determined when closed

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    # Index for performance queries
    __table_args__ = (Index("ix_trader_trades_trader_date", "trader_id", "created_at"),)


class TraderPosition(Base):
    """Average-cost basis per (trader, token, chain), so realized PnL can be
    computed when a trader sells. A buy adds qty + USD cost; a sell realizes
    PnL = proceeds - avg_cost * qty_sold and reduces the position."""

    __tablename__ = "trader_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trader_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token = Column(String(20), nullable=False)  # symbol (matches swap.from/to_token)
    chain = Column(String(20), nullable=False)
    qty = Column(Float, default=0.0)  # accumulated token quantity (token units)
    cost_usd = Column(Float, default=0.0)  # total USD cost of the held qty
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("trader_id", "token", "chain", name="uq_trader_position"),)
