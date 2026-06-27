"""Models for user favorites and settings."""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from database.db import Base


class FavoriteSwapPair(Base):
    """User's favorite swap pairs for quick access."""

    __tablename__ = "favorite_swap_pairs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    from_chain = Column(String(50), nullable=False)
    from_token = Column(String(20), nullable=False)
    to_chain = Column(String(50), nullable=False)
    to_token = Column(String(20), nullable=False)

    # Optional default amount
    default_amount = Column(Float, nullable=True)

    # Display name (auto-generated or custom)
    name = Column(String(100), nullable=True)

    # Usage tracking
    use_count = Column(Integer, default=0)
    last_used_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self) -> str:
        return f"<FavoritePair({self.from_chain}/{self.from_token} -> {self.to_chain}/{self.to_token})>"

    @property
    def display_name(self) -> str:
        if self.name:
            return self.name
        return f"{self.from_token}→{self.to_token}"


class PriceAlert(Base):
    """User price alerts."""

    __tablename__ = "price_alerts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    from_token = Column(String(20), nullable=False)
    to_token = Column(String(20), nullable=False)

    # Alert conditions
    target_rate = Column(Float, nullable=False)
    condition = Column(String(10), nullable=False)  # "above" or "below"

    # Status
    is_active = Column(Boolean, default=True)
    triggered_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self) -> str:
        return (
            f"<PriceAlert({self.from_token}/{self.to_token} {self.condition} {self.target_rate})>"
        )


class UserSettings(Base):
    """Extended user settings."""

    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    # Slippage settings
    default_slippage_bps = Column(Integer, default=50)  # 0.5%

    # Notification preferences
    notify_on_complete = Column(Boolean, default=True)
    notify_on_price_alert = Column(Boolean, default=True)
    notify_gas_updates = Column(Boolean, default=False)
    # Opt-in consent flag for future anticipatory/proactive push (DEFAULT OFF).
    # Scaffold only — no push logic reads this yet; it gates future delivery.
    proactive_alerts_enabled = Column(Boolean, default=False)

    # Granular per-event notification preferences
    notify_copy_executed = Column(Boolean, default=True, nullable=False)
    notify_order_triggered = Column(Boolean, default=True, nullable=False)
    notify_portfolio_milestone = Column(Boolean, default=False, nullable=False)
    notify_risk_event = Column(Boolean, default=True, nullable=False)

    # Security settings
    per_swap_limit_usd = Column(Float, default=5000.0)
    daily_limit_usd = Column(Float, default=50000.0)
    require_2fa_above_usd = Column(Float, default=1000.0)
    panic_sell_enabled = Column(Boolean, default=False)

    # MEV protection (Pro tier) — column already migrated by _add_user_settings_mev_column
    mev_protection_enabled = Column(Boolean, default=True)

    # Transaction speed preset: 'slow' | 'normal' | 'fast'
    tx_speed_preset = Column(String(10), default="normal")

    # Default output token (e.g. "USDC") — sell-to token for one-click sells
    default_output_token = Column(String(20), nullable=True)

    # Display preferences
    default_chain = Column(String(50), nullable=True)
    show_usd_values = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
