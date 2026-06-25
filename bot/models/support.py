"""Support/bug ticket model — user-submitted help requests and bug reports
the team can track.

A ticket is created from the bot (`/support`, `/bug`) or any other surface and
lives in the ``support_tickets`` table. The ``kind`` field distinguishes a
support request from a bug report. Admins list/triage/reply via admin commands;
replies DM the original user and move the ticket through its lifecycle.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    DateTime,
    Index,
)

from database.db import Base


class TicketStatus:
    """Lifecycle states for a support ticket (stored as plain strings)."""

    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"

    ALL = (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
    # States still needing attention (shown by default in /tickets).
    ACTIVE = (OPEN, IN_PROGRESS)


class TicketKind:
    """What kind of ticket this is (stored as plain strings)."""

    SUPPORT = "support"
    BUG = "bug"
    # Inbound enterprise/sales lead filed from the website "Talk to the team"
    # form. Rides the same notified_at fan-out (admin DM + group + Linear) so a
    # lead reaches the team within the support_notifier poll interval.
    ENTERPRISE_LEAD = "enterprise_lead"

    ALL = (SUPPORT, BUG, ENTERPRISE_LEAD)


class SupportTicket(Base):
    """A single support request submitted by a user.

    ``user_id`` links to ``users.id`` when known; ``telegram_id`` is stored
    denormalized so admins can DM a reply even if the user row is missing.
    """

    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Who opened it. user_id may be NULL (e.g. pre-/start); telegram_id is the
    # reliable handle for replying back.
    user_id = Column(Integer, nullable=True, index=True)
    telegram_id = Column(BigInteger, nullable=True, index=True)
    username = Column(String(255), nullable=True)

    # Where the ticket was filed from: "telegram", "webapp", "whatsapp".
    source = Column(String(20), default="telegram", nullable=False)

    # "support" or "bug" (see TicketKind).
    kind = Column(String(20), default=TicketKind.SUPPORT, nullable=False, index=True)
    # Free-text category tag (e.g. "swap", "wallet", "billing"); optional.
    category = Column(String(50), nullable=True)
    message = Column(Text, nullable=False)

    status = Column(String(20), default=TicketStatus.OPEN, nullable=False, index=True)

    # Admin response + who handled it (admin Telegram id).
    admin_reply = Column(Text, nullable=True)
    handled_by = Column(BigInteger, nullable=True)

    # Severity/priority hint ("low"|"normal"|"high"|"critical"); drives Linear priority.
    priority = Column(String(20), nullable=True)

    # Dedup: an idempotency key (e.g. ticket:<uid>:<hash>) so rapid double-submits
    # and one-tap "Report this" on the same error collapse into one ticket.
    idempotency_key = Column(String(128), nullable=True, index=True)

    # Auto-captured diagnostic context (filed without the user typing it).
    error_category = Column(String(50), nullable=True)  # from error_guidance
    reference_id = Column(String(16), nullable=True)  # error_guidance ref shown to user
    tx_hash = Column(String(120), nullable=True)
    bot_version = Column(String(20), nullable=True)
    context_json = Column(Text, nullable=True)  # JSON blob: chain/wallet/tier/last-swap/etc.

    # Optional screenshot (Telegram file_id) attached to a bug report.
    photo_file_id = Column(String(255), nullable=True)

    # Support-group placement: forum topic + the posted message, so admin
    # replies typed into the topic can be threaded back to the user.
    group_chat_id = Column(String(40), nullable=True)
    group_topic_id = Column(Integer, nullable=True, index=True)
    group_message_id = Column(Integer, nullable=True)

    # CSAT after resolution: 1 (👍) / -1 (👎) / NULL (not rated).
    csat = Column(Integer, nullable=True)
    # First time an admin responded — for response-time metrics.
    first_response_at = Column(DateTime, nullable=True)

    # Fan-out bookkeeping. ``notified_at`` is set once the support_notifier
    # service has DM'd admins / posted to the support group / synced to Linear;
    # NULL means "not yet fanned out" (the service polls for these). This lets
    # tickets created from ANY surface (bot, webapp, whatsapp) get identical
    # routing without duplicating notification logic per surface.
    notified_at = Column(DateTime, nullable=True, index=True)
    linear_issue_id = Column(String(64), nullable=True)
    linear_issue_url = Column(String(255), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_support_tickets_status_created", "status", "created_at"),)

    def __repr__(self) -> str:
        return (
            f"<SupportTicket(id={self.id}, kind={self.kind}, "
            f"status={self.status}, telegram_id={self.telegram_id})>"
        )
