"""Persistence for a creator's public JellyJelly account claim.

This model deliberately stores only proof metadata and a canonical Jelly ID.
The video itself remains on JellyJelly.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from database.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JellyAccountClaim(Base):
    """One claimed public Jelly account per Suwappu user and vice versa."""

    __tablename__ = "jelly_account_claims"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    jelly_username = Column(String(80), nullable=False, unique=True, index=True)
    claim_jelly_id = Column(String(128), nullable=False, unique=True, index=True)

    # This is a wallet address proved by the current SIWE/SIWS-backed session,
    # not a claim that JellyJelly itself verifies a legal-world identity.
    wallet_address = Column(String(255), nullable=False)
    wallet_proof = Column(String(32), nullable=False, default="siwe-session")

    claimed_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)

    def __repr__(self) -> str:
        return f"<JellyAccountClaim(user_id={self.user_id}, jelly_username={self.jelly_username})>"
