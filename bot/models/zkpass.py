"""zkPass (zkpass.org) TransGate identity/data verification results.

Stores the server-verified RESULT of a client-side zkPass TransGate proof.
This is informational/profile-level only — it is deliberately NOT wired to
gate any money-path feature (swap, withdrawal, fees, subscriptions). See
api-ts/src/services/ZkPassService.ts for the verification logic and
api-ts/src/db/schema/zkpass.ts for the mirrored Drizzle schema. Table is
created by ``database.db._create_zkpass_verifications_table`` (idempotent
runtime migration); this ORM model exists for query/insert use and for
``Base.metadata.create_all`` in tests.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, Index

from database.db import Base


class ZkPassVerification(Base):
    """One verified zkPass TransGate proof. Exactly one row per task_id (replay protection)."""

    __tablename__ = "zkpass_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)

    user_id = Column(Integer, nullable=False)
    schema_id = Column(String(255), nullable=False)

    # UNIQUE: a given TransGate task/proof must not be replayable to let a
    # second (different) user claim the same underlying proof result.
    task_id = Column(String(255), nullable=False, unique=True)

    u_hash = Column(String(255), nullable=True)
    public_fields_hash = Column(String(255), nullable=True)
    # JSON.stringify'd publicFields object from the proof result.
    public_fields = Column(Text, nullable=True)
    validator_address = Column(String(255), nullable=True)
    recipient = Column(String(255), nullable=True)

    is_valid = Column(Boolean, nullable=False, default=False)

    verified_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("zkpass_verifications_user_idx", "user_id"),
        Index("ix_zkpass_verifications_task_id", "task_id", unique=True),
    )

    def __repr__(self) -> str:
        return (
            f"<ZkPassVerification(id={self.id}, user_id={self.user_id}, task_id={self.task_id!r})>"
        )
