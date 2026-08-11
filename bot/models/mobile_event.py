"""Gekko mobile analytics sink (`POST /v1/mobile/events`).

Rows here are display/analytics only — never authoritative for money,
balances, or account state. `api/routes/mobile.py` validates the event name
and strips/rejects any prop that looks like an address, tx hash, or is
unreasonably long BEFORE a row is ever written, so this table should never
contain anything sensitive enough to need encryption at rest.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey, Index

from database.db import Base


class MobileEvent(Base):
    __tablename__ = "mobile_events"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(64), nullable=False)
    # Client-reported event timestamp (not necessarily == created_at).
    ts = Column(DateTime, nullable=True)
    props = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (Index("ix_mobile_events_user_created", "user_id", "created_at"),)
