"""Tempo (chain 4217) native models.

Persists fee-sponsorship bookkeeping so per-user sponsored-tx limits and the
daily budget hold across restarts/replicas (Railway wipes in-memory state).
"""

from datetime import datetime, date

from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Index

from database.db import Base


class TempoSponsorship(Base):
    """Per-user aggregate of sponsored Tempo transactions.

    One row per user. ``tx_count`` is the lifetime number of sponsored txs
    (capped by settings.tempo_sponsor_max_txs). ``daily_spend_usd`` tracks
    the USD spend for ``day`` (UTC date); it resets when ``day`` rolls over.
    """

    __tablename__ = "tempo_sponsorships"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, unique=True, index=True)

    tx_count = Column(Integer, default=0, nullable=False)
    daily_spend_usd = Column(Float, default=0.0, nullable=False)
    day = Column(Date, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_tempo_sponsorships_user", "user_id"),)
