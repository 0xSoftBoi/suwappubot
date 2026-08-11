"""Revocable JWT session records (MONEY-PATH: backs session-kill for stolen
mobile/webapp bearer tokens).

`api/main.py::create_jwt_token` mints a `jti` (uuid4) for every new token and
best-effort persists one row here. `decode_jwt_token` looks the `jti` up (via
a short-TTL in-process cache, see `_check_session_valid`) and rejects the
token if the row is missing or `revoked_at` is set.

Tokens minted BEFORE this feature shipped have no `jti` claim at all — those
are deliberately grandfathered as valid forever (never looked up here) so
this migration can never break every existing signed-in session on deploy.
A DB failure during the lookup also fails OPEN (treated as valid, logged
loudly) so a transient DB hiccup can never lock out every user on every
route — see `_check_session_valid`.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index

from database.db import Base


class UserSession(Base):
    """One `jti -> users.id` session record, created alongside every JWT
    that has a `jti` claim. `revoked_at` set (by /sessions revoke-all or a
    future single-device revoke) makes the matching token instantly rejected
    everywhere `decode_jwt_token` is used, without waiting for the JWT's own
    7-day `exp` to pass."""

    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True)
    jti = Column(String(36), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Mirrors create_jwt_token's `src` ('siwe' | 'passkey' | 'telegram' | 'weak' | ...)
    # so /sessions can show the user what kind of proof each device used.
    src = Column(String(16), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    last_seen_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_user_sessions_user_revoked", "user_id", "revoked_at"),)
