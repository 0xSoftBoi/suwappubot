"""Token Intel / Dev Tracking models — watched deployers and detected new deploys."""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from database.db import Base


class DeployerWatch(Base):
    """A deployer address a user wants to be notified about on new deploys."""

    __tablename__ = "deployer_watches"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "deployer_address", "chain", name="uq_deployer_watch_user_addr_chain"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    deployer_address = Column(String(255), nullable=False, index=True)
    chain = Column(String(50), nullable=False, default="ethereum")
    label = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="deployer_watches")


class DeployerWatchHit(Base):
    """Record of a new token deploy detected for a watched deployer."""

    __tablename__ = "deployer_watch_hits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    watch_id = Column(Integer, ForeignKey("deployer_watches.id"), nullable=False, index=True)
    token_address = Column(String(255), nullable=False)
    chain = Column(String(50), nullable=False, default="ethereum")
    detected_at = Column(DateTime, default=datetime.utcnow)

    watch = relationship("DeployerWatch", backref="hits")
