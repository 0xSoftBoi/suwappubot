"""Handle-reservation waitlist with a live referral leaderboard.

Distinct from the mobile-app waitlist (``SupportTicket`` category
``mobile_waitlist`` in ``bot/models/support.py``) — that one is a simple
email capture with a naive row-count position. This one lets a visitor
reserve a Suwappu ``handle`` pre-launch, mints them a referral code, and
ranks everyone live by referral count so inviting friends genuinely moves
you up the list. See ``bot/services/waitlist_service.py`` for the ranking
query and ``api/webapp.py`` ``/webapp/waitlist/*`` for the routes. Table is
created by ``database.db._create_waitlist_signups_table`` (idempotent
runtime migration); this ORM model exists for query/insert use and for
``Base.metadata.create_all`` in tests.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Index

from database.db import Base


class WaitlistSignup(Base):
    """One handle reservation. Exactly one row per email (enforced unique)."""

    __tablename__ = "waitlist_signups"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Always stored lowercase; validated + normalized in waitlist_service.
    # Uniqueness is enforced by the named indexes in __table_args__ below
    # (not duplicated here via Column(unique=True)) so there is exactly one
    # index per constraint.
    handle = Column(String(32), nullable=False)
    email = Column(String(320), nullable=False)
    telegram = Column(String(64), nullable=True)

    # Format "HANDLE-XXXX" (uppercase handle + 4 random hex chars).
    referral_code = Column(String(40), nullable=False)
    # Self-referential: the waitlist_signups.id of whoever invited this row.
    # NULL if unreferred, self-referral, or an unknown ref code was passed.
    referred_by_id = Column(Integer, nullable=True, index=True)

    # Deterministic non-negative int < 2**31 derived from the handle (stable
    # for a given handle) — used by the frontend to render a generative card.
    seed = Column(Integer, nullable=False)

    # Optional marketing attribution pass-through (JSON-encoded).
    attribution_json = Column(Text, nullable=True)

    # Salted hash of the reserving IP for abuse analysis — never the raw IP.
    ip_hash = Column(String(64), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_waitlist_signups_handle", "handle", unique=True),
        Index("ix_waitlist_signups_email", "email", unique=True),
        Index("ix_waitlist_signups_referral_code", "referral_code", unique=True),
        # Composite index supporting the live rank ordering tie-break
        # (referral_count DESC, created_at ASC, id ASC) — referral_count is
        # computed via a join/subquery, so this covers the stored columns.
        Index("ix_waitlist_signups_created_id", "created_at", "id"),
    )

    def __repr__(self) -> str:
        return f"<WaitlistSignup(id={self.id}, handle={self.handle!r})>"
