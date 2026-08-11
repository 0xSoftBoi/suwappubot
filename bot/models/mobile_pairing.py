"""Telegram deeplink pairing codes for Gekko mobile sign-in.

`POST /v1/mobile/auth/telegram/start` creates a pending row here (no
Telegram identity yet). `/start gekko_<code>` in bot/handlers/start.py stages
the row to the Telegram user's `users.id` once the deeplink is opened, but
only the explicit "Approve" callback (bot/handlers/start.py's
`gekko_approve_callback`) moves it to `approved` — a one-tap deeplink open
can never by itself grant a session. `POST /v1/mobile/auth/telegram/poll`
consumes the row exactly once it's approved, minting the same mobile JWT
`api/routes/mobile.py::_jwt_user` already verifies.

Only a SHA-256 hash of the opaque code is stored — never the raw code —
so a read of this table alone can't be replayed as a valid pairing code.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index

from database.db import Base


class MobilePairing(Base):
    """One `code -> users.id` pairing request. Single-use: `poll()` claims
    the row atomically the moment it hands back a JWT, then deletes it."""

    __tablename__ = "mobile_pairings"

    id = Column(Integer, primary_key=True)
    # sha256(code), hex — never the raw `secrets.token_urlsafe` value.
    code_hash = Column(String(64), nullable=False, unique=True, index=True)
    # "pending" (created, not yet opened in Telegram) | "staged" (deeplink
    # opened, bound to a user, awaiting explicit Approve/Not me) | "approved"
    # (user tapped Approve — waiting to be collected by poll; collection
    # atomically flips this to "consumed" then deletes the row). A "Not me"
    # tap deletes a "staged" row outright rather than storing "rejected".
    status = Column(String(16), nullable=False, default="pending")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # Hashed requester IP from the unauthenticated /start call, used only to
    # cap pending codes per IP (abuse control) — never the raw IP.
    request_ip_hash = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    approved_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_mobile_pairings_status_expires", "status", "expires_at"),)
