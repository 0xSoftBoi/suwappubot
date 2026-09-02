"""Point-in-time total portfolio value snapshots, used for history charts.

NOTE: `bot/models/advanced.py` already defines a class named
``PortfolioSnapshot`` mapped to a table named ``portfolio_snapshots`` (daily,
string-keyed, used by `bot/services/pnl.py`). Reusing that name/table here
would either collide in SQLAlchemy's metadata or silently corrupt an
in-production feature, so this is a *new*, differently-named model
(`PortfolioValueSnapshot` / `portfolio_value_snapshots`) for the terminal
portfolio-history feature. See docs/development/migrations.md — additive only.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index

from database.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PortfolioValueSnapshot(Base):
    """A single total-USD-value reading for a user, for charting history."""

    __tablename__ = "portfolio_value_snapshots"
    __table_args__ = (
        Index("ix_portfolio_value_snapshots_user_captured", "user_id", "captured_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    total_usd = Column(Float, nullable=False)
    token_count = Column(Integer, nullable=False, default=0)
    # 'request' (opportunistic, computed while serving a portfolio request) or
    # 'refresh' (background PortfolioSnapshotter pass).
    source = Column(String(20), nullable=False)
    captured_at = Column(DateTime, nullable=False, default=_utcnow)

    def __repr__(self) -> str:
        return (
            f"<PortfolioValueSnapshot(user_id={self.user_id}, total_usd={self.total_usd}, "
            f"source={self.source})>"
        )
