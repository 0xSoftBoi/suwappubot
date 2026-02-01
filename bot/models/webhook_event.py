from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from database.db import Base


class WebhookEvent(Base):
    """Webhook delivery record for agent notifications."""
    __tablename__ = "webhook_events"

    id = Column(Integer, primary_key=True)
    agent_id = Column(Integer, nullable=False, index=True)

    event_type = Column(String(50), nullable=False)  # swap.submitted, swap.completed, swap.failed
    payload = Column(Text, nullable=False)  # JSON body
    callback_url = Column(String(1024), nullable=False)

    status = Column(String(20), default="pending")  # pending, delivered, failed
    attempts = Column(Integer, default=0)
    next_retry_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    response_status = Column(Integer, nullable=True)  # HTTP status from callback

    created_at = Column(DateTime, default=datetime.utcnow)
    delivered_at = Column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<WebhookEvent(id={self.id}, agent={self.agent_id}, type={self.event_type}, status={self.status})>"
