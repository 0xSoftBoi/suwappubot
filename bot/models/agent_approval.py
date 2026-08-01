"""Agent approval requests (SUW-204: agent control-plane human-in-the-loop).

The api-ts side (Hono/Effect agent-control-plane) writes a row here whenever
an autonomous agent wants to execute an intent above a risk threshold. The
Python bot polls for ``status='pending' AND notified_at IS NULL``, DMs the
owning Telegram user (``user_telegram_id``) with an inline Approve/Deny
keyboard, and atomically flips ``status`` when the human decides.

This table is shared cross-stack (api-ts writes, Python reads/writes), so the
model here is descriptive of DDL owned by ``database/db.py``'s
``_ensure_schema()`` (see ``_create_agent_approvals_table``), not a
``create_all()``-managed table. Treat column additions as additive-only and
keep them in lockstep with whatever migration api-ts ships for this table.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    DateTime,
    Numeric,
    Index,
    JSON,
)

from database.db import Base


class AgentApprovalStatus:
    """Lifecycle states for an agent approval request (stored as plain strings)."""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"

    ALL = (PENDING, APPROVED, DENIED, EXPIRED)


class AgentApproval(Base):
    """A single pending-approval request for an agent-initiated intent.

    ``id`` is a uuid string (postgres uuid pk on the api-ts side); Python
    treats it as an opaque string everywhere rather than parsing/generating
    it, since api-ts owns row creation.
    """

    __tablename__ = "agent_approvals"

    id = Column(String(36), primary_key=True)

    org_id = Column(String(36), nullable=True, index=True)
    agent_id = Column(Text, nullable=False)
    agent_name = Column(Text, nullable=True)

    # The human owner to notify/decide on Telegram. Nullable because not every
    # agent necessarily has a bound Telegram identity (e.g. org-level agents
    # notified via a different channel later).
    user_telegram_id = Column(BigInteger, nullable=True, index=True)

    intent_json = Column(JSON, nullable=True)
    intent_hash = Column(String(128), nullable=True)
    value_usd = Column(Numeric, nullable=True)
    chain = Column(String(50), nullable=True)

    status = Column(String(20), default=AgentApprovalStatus.PENDING, nullable=False, index=True)

    # Where the decision was made ("telegram", "webapp", ...) and who made it.
    channel = Column(String(20), nullable=True)
    decided_by = Column(String(64), nullable=True)
    decided_at = Column(DateTime, nullable=True)

    expires_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Fan-out bookkeeping, mirrors bot/models/support.py's SupportTicket
    # pattern: NULL means "not yet DM'd", set once approval_notifier sends the
    # Telegram prompt so restarts/polling never double-notify.
    notified_at = Column(DateTime, nullable=True, index=True)

    # Telegram message coordinates for the notified prompt, so the notifier/
    # handler can edit the original message in place once decided or expired.
    notify_chat_id = Column(BigInteger, nullable=True)
    notify_message_id = Column(Integer, nullable=True)

    # Set once a decided (approved/denied) row has been fully processed
    # downstream (e.g. the intent executed or discarded), so consumers can
    # distinguish "decided" from "decided and acted on". NULL until consumed.
    consumed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_agent_approvals_status_expires", "status", "expires_at"),
        Index("ix_agent_approvals_telegram_status", "user_telegram_id", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentApproval(id={self.id}, agent_id={self.agent_id}, "
            f"status={self.status}, value_usd={self.value_usd})>"
        )
