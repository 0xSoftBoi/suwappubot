"""AEGIS per-user trust adaptation — Phase 2.3 of docs/plans/aegis-fork-extend.md.

DB-backed trust score per (platform, user_id), mirroring AEGIS TrustManager
semantics. MUST be DB-backed (never an in-process dict/cache) because the bot
runs multi-replica in webhook mode (USE_WEBHOOK=true) — an in-memory store
would give every replica its own view of a user's trust and never converge.

Phase 2.3 is RECORD-ONLY: nothing reads this table to gate or throttle
anything yet. It exists purely to accumulate telemetry that a later
enforcement phase will consume. See bot/services/aegis_trust.py for the
read/write logic; this module only defines the row shape.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    UniqueConstraint,
)

from database.db import Base


class AegisUserTrust(Base):
    """Per-(platform, user_id) trust score derived from AEGIS scan verdicts.

    ``platform`` mirrors the ``source`` string AegisService.scan()/ascan()
    already receive (e.g. "telegram", "whatsapp", "agent_api", "nl_intent").
    It is intentionally a plain VARCHAR rather than a DB-level enum so a new
    inbound seam's source string is never a hard schema migration.

    The UniqueConstraint on (platform, user_id) doubles as the lookup index
    for both ``get_trust`` and ``record_verdict``.
    """

    __tablename__ = "aegis_user_trust"
    __table_args__ = (
        UniqueConstraint("platform", "user_id", name="uq_aegis_user_trust_platform_user"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    platform = Column(String(32), nullable=False)
    user_id = Column(String(128), nullable=False)
    trust_score = Column(Float, nullable=False, default=100.0)
    threat_count = Column(Integer, nullable=False, default=0)
    clean_count = Column(Integer, nullable=False, default=0)
    last_threat_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True, default=datetime.utcnow)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
