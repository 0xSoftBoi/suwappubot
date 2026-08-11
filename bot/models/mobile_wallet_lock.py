"""DB-backed cross-replica wallet lock for mobile send/earn actions — MONEY-PATH.

The in-process asyncio lock in api/routes/mobile.py (`_earn_wallet_lock`)
only serializes concurrent requests landing on the SAME worker process. In a
multi-replica deployment (`USE_WEBHOOK=true`, N Railway replicas) two
concurrent requests for the same wallet can land on two different
processes, both pass the in-process lock (each process has its own), and
both read -> sign -> broadcast concurrently — reintroducing the exact
nonce-collision class the in-process lock exists to prevent.

This table is a minimal advisory lock: one row per `wallet_address`,
acquired by INSERTing (or, if the previous holder's lock is older than the
TTL, stealing it) before the read -> sign -> broadcast window, and released
(deleted) after. It is a fast-path *addition* on top of the in-process lock,
not a replacement — see `_earn_wallet_lock` in api/routes/mobile.py.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime

from database.db import Base


class MobileWalletLock(Base):
    """One row per wallet currently mid-send/earn-action, cross-replica."""

    __tablename__ = "mobile_wallet_locks"

    id = Column(Integer, primary_key=True)
    wallet_address = Column(String(128), nullable=False, unique=True, index=True)
    # Opaque per-request identifier — only the holder that acquired the lock
    # is allowed to release it, so a slow/timed-out request can't release a
    # lock a NEWER request (that stole it after TTL expiry) now holds.
    holder = Column(String(64), nullable=False)
    acquired_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
