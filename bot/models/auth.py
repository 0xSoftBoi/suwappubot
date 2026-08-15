"""Session refresh tokens (H13 — short-lived access JWT + rotating refresh token).

Only the SHA-256 hash of each refresh token is stored. Tokens rotate on use: each
refresh revokes the presented token and issues a successor in the same ``family_id``.
Presenting an already-rotated token is treated as theft → the whole family is revoked.
This table is also the revocation point that the 7-day stateless JWT lacks today.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String

from database.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RefreshToken(Base):
    __tablename__ = "auth_refresh_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # SHA-256 hex of the opaque refresh token; the plaintext is never persisted.
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    # Rotation chain id (uuid4) — all successors of one login share it.
    family_id = Column(String(36), nullable=False, index=True)
    # EVM address claim to re-mint into the access JWT on refresh.
    address = Column(String(64), nullable=True)
    # Origin surface: webapp | terminal | oauth | wallet | passkey | ...
    client = Column(String(32), nullable=True)
    issued_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    # Successor token_hash once rotated (presence ⇒ this token was already used).
    replaced_by = Column(String(64), nullable=True)

    __table_args__ = (Index("ix_auth_refresh_tokens_family", "family_id"),)
