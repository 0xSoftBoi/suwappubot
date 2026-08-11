"""Mobile app savings goals (Gekko neobank `/v1/mobile/goals`).

A lightweight, user-defined target list — e.g. "New laptop: $1,500". Progress
toward each goal is computed CLIENT-SIDE from the user's existing earn
position (`GET /v1/mobile/earn`); this table never duplicates balance logic
and moves no funds.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey

from database.db import Base


class SavingsGoal(Base):
    """One user-defined savings target, created via `POST /v1/mobile/goals`."""

    __tablename__ = "mobile_savings_goals"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(64), nullable=False)
    target_usd = Column(Numeric(18, 2), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
