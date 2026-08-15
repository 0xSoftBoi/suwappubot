"""Models for PnL tracking with average cost basis."""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
from datetime import datetime
from database.db import Base


class TokenPosition(Base):
    """Tracks a user's position in a specific token with average cost basis.

    One row per user+chain+token_address combination. Updated on every swap.
    """

    __tablename__ = "token_positions"
    __table_args__ = (
        UniqueConstraint("user_id", "chain", "token_address", name="uq_token_position"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    chain = Column(String(50), nullable=False)
    token_symbol = Column(String(20), nullable=False)
    token_address = Column(String(100), nullable=False)

    # Running totals
    total_bought = Column(Float, default=0.0)
    total_sold = Column(Float, default=0.0)
    total_cost_usd = Column(Float, default=0.0)
    total_proceeds_usd = Column(Float, default=0.0)

    # Computed fields (denormalized for fast reads)
    avg_buy_price_usd = Column(Float, default=0.0)
    realized_pnl_usd = Column(Float, default=0.0)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    @property
    def current_holdings(self) -> float:
        """Net tokens currently held."""
        return (self.total_bought or 0.0) - (self.total_sold or 0.0)

    def __repr__(self) -> str:
        return f"<TokenPosition({self.token_symbol} on {self.chain}, holdings={self.current_holdings:.4f})>"
