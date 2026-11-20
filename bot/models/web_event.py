"""First-party marketing-site events (page views + funnel steps).

Written by api-ts ``POST /v1/web/event`` from the showcase site and read by
``GET /admin/growth`` for the admin "Growth" dashboard, so the team can see
visits -> intent -> lead without leaving their own product or needing a
third-party analytics login.

Privacy: deliberately holds no personal data. There is no IP address, no user
agent, no cookie id and no user id. ``session_id`` is a random value kept in
the browser's sessionStorage, so it identifies one tab-session and cannot be
joined to a person or followed across visits.

The table is created by ``Base.metadata.create_all`` (importing this model in
``bot/models/__init__.py`` is what registers it). Mirrored for api-ts in
``api-ts/src/db/schema/webEvents.ts`` -- keep the two in sync.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Index, Integer, String, Text, func

from database.db import Base


class WebEvent(Base):
    """One page view or funnel event from the marketing site."""

    __tablename__ = "web_events"

    # BIGSERIAL on Postgres. SQLite only auto-increments INTEGER PRIMARY KEY, so
    # use that there (tests and local dev).
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)

    # Event name, e.g. "page_view", "cta_clicked", "enterprise_lead_submitted".
    name = Column(String(48), nullable=False)
    # Site path only (no query string, no host).
    path = Column(String(200), nullable=False, default="/")
    # Random per-tab-session id from sessionStorage. Not a user identifier.
    session_id = Column(String(40), nullable=False)

    # Where the visit came from. Host only, never the full referring URL.
    referrer_host = Column(String(120), nullable=True)
    utm_source = Column(String(80), nullable=True)
    utm_medium = Column(String(80), nullable=True)
    utm_campaign = Column(String(80), nullable=True)

    # Small JSON object of event properties (size-capped at ingest).
    props_json = Column(Text, nullable=True)

    # server_default as well as default: api-ts inserts into this table too, and
    # a client-side default alone leaves the database column with none.
    # func.now() is portable (CURRENT_TIMESTAMP on SQLite, which the tests and
    # local dev use; now() on Postgres). api-ts always sends an explicit UTC
    # value, so this is only the fallback.
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_web_events_created_at", "created_at"),
        Index("ix_web_events_name_created_at", "name", "created_at"),
    )
