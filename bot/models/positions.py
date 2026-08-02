"""User spot-position cost basis for the unified Positions / PnL view.

Average-cost basis per (user, token, chain) for the user's OWN spot holdings,
so the Positions view can show realized and unrealized spot PnL — the thing
competitor bots show but we couldn't (we had no cost basis on spot).

Mirrors TraderPosition (copy-trading) but for the user's own swaps: a buy adds
qty + USD cost; a sell realizes PnL = proceeds - avg_cost * qty_sold and reduces
the position. Maintained by a best-effort post-swap hook in the swap engine.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)

from database.db import Base


class UserPosition(Base):
    __tablename__ = "user_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token = Column(String(20), nullable=False)  # symbol (matches swap.from/to_token)
    chain = Column(String(20), nullable=False)
    qty = Column(Float, default=0.0)  # accumulated token quantity
    cost_usd = Column(Float, default=0.0)  # total USD cost of the held qty
    realized_pnl_usd = Column(Float, default=0.0)  # cumulative realized PnL (sells)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "token", "chain", name="uq_user_position"),)
