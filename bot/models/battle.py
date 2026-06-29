"""Battle model — Bucket 3 (gamified trading).

A battle is a directional up/down bet on a market price. The user picks a
direction, stakes USD, optionally sets leverage, and the outcome is settled
at expiry_at against the live oracle price.

backing values: 'perps' | 'prediction'
direction:      'up'    | 'down'
outcome:        'win'   | 'loss'   | 'void'  (NULL while open)
status:         'open'  | 'settled' | 'voided'

All USD amounts use Numeric(18, 6) to match the money-path convention used
by staking, p2p, predictions, and morpho tables.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, Numeric, String
from sqlalchemy.orm import relationship

from database.db import Base


class Battle(Base):
    """Directional up/down bet on a market.

    stake_usd:    amount the user commits (USD equivalent at entry time)
    entry_price:  oracle price at the moment the battle is opened
    settle_price: oracle price at settlement (NULL while open)
    pnl_usd:      realised PnL in USD (NULL while open; negative = loss)
    leverage:     optional multiplier (NULL if no leverage is applied)
    perp_order_id: optional FK to perp_orders.id when backing='perps'
    """

    __tablename__ = "battles"

    id = Column(Integer, primary_key=True, autoincrement=True)

    user_id = Column(Integer, nullable=False, index=True)  # references users.id
    market = Column(String(50), nullable=False)  # e.g. "BTC/USD"
    direction = Column(String(10), nullable=False)  # 'up' | 'down'
    stake_usd = Column(Numeric(18, 6), nullable=False)
    backing = Column(String(20), nullable=False, default="perps")  # 'perps' | 'prediction'
    leverage = Column(Numeric(10, 2), nullable=True)  # NULL = no leverage

    entry_price = Column(Numeric(20, 8), nullable=False)
    expiry_at = Column(DateTime, nullable=False)
    settle_price = Column(Numeric(20, 8), nullable=True)  # NULL while open

    outcome = Column(String(10), nullable=True)  # 'win' | 'loss' | 'void' | NULL
    pnl_usd = Column(Numeric(18, 6), nullable=True)  # NULL while open

    perp_order_id = Column(Integer, nullable=True)  # optional FK to perp_orders.id
    status = Column(String(20), nullable=False, default="open")  # 'open' | 'settled' | 'voided'

    created_at = Column(DateTime, default=datetime.utcnow)
    settled_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_battles_user_status", "user_id", "status"),
        Index("ix_battles_status", "status"),
        Index("ix_battles_expiry_at", "expiry_at"),
    )
