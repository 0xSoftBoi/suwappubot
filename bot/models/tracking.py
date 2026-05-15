"""Terminal tracking models."""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from database.db import Base


class TrackedWallet(Base):
    """A watch-only wallet address tracked by a terminal user."""

    __tablename__ = "tracked_wallets"
    __table_args__ = (
        UniqueConstraint("user_id", "address", name="uq_tracked_wallet_user_address"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    address = Column(String(255), nullable=False, index=True)
    label = Column(String(100), nullable=True)
    chain = Column(String(50), nullable=False, default="ethereum")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref="tracked_wallets")
