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
