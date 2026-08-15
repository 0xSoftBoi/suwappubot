from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text
from datetime import datetime
from database.db import Base


class RegisteredAgent(Base):
    """External A2A agent registered via the public registration endpoint."""

    __tablename__ = "agents"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    callback_url = Column(String(1024), nullable=True)
    api_key = Column(String(128), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, nullable=True)
    uuid = Column(String(36), unique=True, nullable=True)
    api_key_hash = Column(String(128), nullable=True)
    agent_metadata = Column(
        "metadata", Text, nullable=True
    )  # JSON — "metadata" is reserved by SQLAlchemy
    rate_limit_tier = Column(String(20), default="free")
    total_requests = Column(Integer, default=0)
    total_swaps = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)
