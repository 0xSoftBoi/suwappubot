"""Snipe order models for token launch sniping."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
import enum

from database.db import Base


class SnipeStatus(enum.Enum):
    """Status of a snipe order."""

    PENDING = "pending"
    WATCHING = "watching"  # Monitoring for conditions
    EXECUTING = "executing"
    SUBMITTED = "submitted"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class SnipeMode(enum.Enum):
    """Execution mode for snipes."""

    INSTANT = "instant"  # Execute immediately
    CONDITIONAL = "conditional"  # Wait for conditions
    FIRST_BLOCK = "first_block"  # Land in same block as launch


class SnipePlatform(enum.Enum):
    """Platform to snipe on."""

    PUMP_FUN = "pump_fun"
    RAYDIUM = "raydium"
    ANY = "any"  # Snipe on any platform


# ============ SNIPE ORDERS ============


class SnipeOrder(Base):
    """Individual snipe order for a specific token or launch event."""

    __tablename__ = "snipe_orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False)

    # Target
    token_mint = Column(String(64), nullable=True)  # Specific token, or null for new launches
    token_name = Column(String(100), nullable=True)
    token_symbol = Column(String(20), nullable=True)
    platform = Column(String(30), default=SnipePlatform.ANY.value)

    # Configuration
    sol_amount = Column(Float, nullable=False)  # Amount of SOL to spend
    slippage_bps = Column(Integer, default=1000)  # Slippage in basis points
    mode = Column(String(20), default=SnipeMode.INSTANT.value)
    use_jito = Column(Boolean, default=True)
    jito_tip_lamports = Column(Integer, default=10_000_000)  # 0.01 SOL default

    # Status
    status = Column(String(20), default=SnipeStatus.PENDING.value)
    status_message = Column(String(255), nullable=True)

    # Conditions (for conditional mode)
    min_liquidity_sol = Column(Float, nullable=True)
    max_price_sol = Column(Float, nullable=True)
    require_socials = Column(Boolean, default=False)
    min_quality_score = Column(Float, nullable=True)

    # Execution result
    executed_at = Column(DateTime, nullable=True)
    tx_signature = Column(String(128), nullable=True)
    bundle_id = Column(String(128), nullable=True)
    sol_spent = Column(Float, nullable=True)
    tokens_received = Column(String(78), nullable=True)  # String for large numbers
    execution_price = Column(Float, nullable=True)
    execution_time_ms = Column(Float, nullable=True)
    slot = Column(Integer, nullable=True)
    retries = Column(Integer, default=0)
    error_message = Column(String(500), nullable=True)

    # Expiration
    expires_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<SnipeOrder {self.id} {self.token_symbol or 'ANY'} {self.sol_amount} SOL {self.status}>"

    @property
    def is_active(self) -> bool:
        """Check if order is still active."""
        return self.status in (
            SnipeStatus.PENDING.value,
            SnipeStatus.WATCHING.value,
            SnipeStatus.EXECUTING.value,
        )

    @property
    def is_completed(self) -> bool:
        """Check if order completed (success or failure)."""
        return self.status in (
            SnipeStatus.CONFIRMED.value,
            SnipeStatus.FAILED.value,
            SnipeStatus.CANCELLED.value,
            SnipeStatus.EXPIRED.value,
        )


# ============ SNIPE CONFIGURATION (User Defaults) ============


class SnipeConfig(Base):
    """User's default snipe configuration."""

    __tablename__ = "snipe_configs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    # Default amounts for quick buttons
    quick_amounts = Column(JSON, default=[0.1, 0.5, 1.0, 5.0])  # SOL amounts

    # Default settings
    default_sol_amount = Column(Float, default=0.5)
    default_slippage_bps = Column(Integer, default=1000)
    default_mode = Column(String(20), default=SnipeMode.INSTANT.value)
    use_jito = Column(Boolean, default=True)
    default_jito_tip = Column(Integer, default=10_000_000)  # 0.01 SOL

    # Auto-snipe settings
    auto_snipe_enabled = Column(Boolean, default=False)
    auto_snipe_min_liquidity = Column(Float, default=5.0)
    auto_snipe_max_liquidity = Column(Float, default=100.0)
    auto_snipe_require_socials = Column(Boolean, default=False)
    auto_snipe_platforms = Column(JSON, default=["pump_fun", "raydium"])
    auto_snipe_daily_budget = Column(Float, default=10.0)  # Max SOL per day
    auto_snipe_used_today = Column(Float, default=0.0)

    # Safety settings
    honeypot_check = Column(Boolean, default=True)
    authority_check = Column(Boolean, default=True)  # Verify mint/freeze revoked
    blacklist_check = Column(Boolean, default=True)

    # Notifications
    notify_on_launch = Column(Boolean, default=True)
    notify_on_execution = Column(Boolean, default=True)
    notify_on_failure = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============ SNIPE HISTORY ============


class SnipeHistory(Base):
    """Historical record of snipe executions for analytics."""

    __tablename__ = "snipe_history"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    snipe_order_id = Column(Integer, ForeignKey("snipe_orders.id"), nullable=True)

    # Token info at time of snipe
    token_mint = Column(String(64), nullable=False)
    token_name = Column(String(100), nullable=True)
    token_symbol = Column(String(20), nullable=True)
    platform = Column(String(30), nullable=False)

    # Execution details
    sol_spent = Column(Float, nullable=False)
    tokens_received = Column(String(78), nullable=False)
    entry_price = Column(Float, nullable=False)
    execution_time_ms = Column(Float, nullable=True)

    # Current status (updated periodically for P&L tracking)
    current_price = Column(Float, nullable=True)
    current_value_sol = Column(Float, nullable=True)
    pnl_sol = Column(Float, nullable=True)
    pnl_percent = Column(Float, nullable=True)
    highest_price = Column(Float, nullable=True)  # ATH since entry
    lowest_price = Column(Float, nullable=True)

    # Exit info (if sold)
    is_sold = Column(Boolean, default=False)
    sold_at = Column(DateTime, nullable=True)
    exit_price = Column(Float, nullable=True)
    sol_received = Column(Float, nullable=True)
    realized_pnl_sol = Column(Float, nullable=True)
    realized_pnl_percent = Column(Float, nullable=True)

    # Timestamps
    sniped_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<SnipeHistory {self.token_symbol} {self.sol_spent} SOL -> {self.pnl_percent}%>"


# ============ WATCHED TOKENS (for migration sniping) ============


class WatchedToken(Base):
    """Tokens being watched for migration or specific events."""

    __tablename__ = "watched_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    token_mint = Column(String(64), nullable=False)
    token_name = Column(String(100), nullable=True)
    token_symbol = Column(String(20), nullable=True)
    platform = Column(String(30), nullable=False)  # Where it was launched

    # Watch settings
    snipe_on_migration = Column(Boolean, default=True)  # Snipe when migrates to Raydium
    snipe_sol_amount = Column(Float, default=0.5)
    alert_on_progress = Column(Boolean, default=True)  # Alert at 90% progress

    # pump.fun specific
    progress_percent = Column(Float, default=0)  # Progress toward migration
    bonding_curve = Column(String(64), nullable=True)

    # Status
    is_active = Column(Boolean, default=True)
    migrated = Column(Boolean, default=False)
    migrated_at = Column(DateTime, nullable=True)
    sniped = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============ AUTO-SNIPE RULES ============


class AutoSnipeRule(Base):
    """Rules for automatic sniping based on criteria."""

    __tablename__ = "auto_snipe_rules"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False)

    name = Column(String(50), nullable=False)  # User-friendly name
    is_active = Column(Boolean, default=True)

    # Platform filter
    platforms = Column(JSON, default=["pump_fun", "raydium"])

    # Liquidity filter
    min_liquidity_sol = Column(Float, nullable=True)
    max_liquidity_sol = Column(Float, nullable=True)

    # Quality filter
    min_quality_score = Column(Float, nullable=True)
    require_socials = Column(Boolean, default=False)

    # Name/symbol filters (regex patterns to match or exclude)
    name_must_contain = Column(JSON, default=[])  # List of patterns
    name_must_not_contain = Column(JSON, default=[])  # Blacklist patterns

    # Creator filter
    creator_whitelist = Column(JSON, default=[])  # Only snipe from these creators
    creator_blacklist = Column(JSON, default=[])  # Never snipe from these

    # Execution settings
    sol_amount = Column(Float, nullable=False)
    slippage_bps = Column(Integer, default=1000)
    use_jito = Column(Boolean, default=True)
    jito_tip = Column(Integer, default=10_000_000)

    # Limits
    max_snipes_per_day = Column(Integer, default=10)
    max_sol_per_day = Column(Float, default=5.0)
    snipes_today = Column(Integer, default=0)
    sol_spent_today = Column(Float, default=0)
    last_reset_date = Column(String(10), nullable=True)  # YYYY-MM-DD

    # Stats
    total_snipes = Column(Integer, default=0)
    successful_snipes = Column(Integer, default=0)
    total_sol_spent = Column(Float, default=0)
    total_pnl_sol = Column(Float, default=0)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<AutoSnipeRule {self.name} {'active' if self.is_active else 'inactive'}>"

    def matches_launch(self, launch_data: dict) -> bool:
        """Check if a launch matches this rule's criteria."""
        # Platform check
        if self.platforms and launch_data.get("platform") not in self.platforms:
            return False

        # Liquidity check
        liquidity = launch_data.get("liquidity_sol", 0)
        if self.min_liquidity_sol and liquidity < self.min_liquidity_sol:
            return False
        if self.max_liquidity_sol and liquidity > self.max_liquidity_sol:
            return False

        # Quality check
        if self.min_quality_score:
            quality = launch_data.get("quality_score", 0)
            if quality < self.min_quality_score:
                return False

        # Socials check
        if self.require_socials and not launch_data.get("has_socials"):
            return False

        # Creator checks
        creator = launch_data.get("creator", "")
        if self.creator_whitelist and creator not in self.creator_whitelist:
            return False
        if self.creator_blacklist and creator in self.creator_blacklist:
            return False

        # Daily limits
        if self.snipes_today >= self.max_snipes_per_day:
            return False
        if self.sol_spent_today >= self.max_sol_per_day:
            return False

        return True
