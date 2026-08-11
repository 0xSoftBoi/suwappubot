"""Gekko mobile Telegram deeplink sign-in — pairing code lifecycle.

MONEY-PATH (account takeover surface): this mints the session that lets a
device act as the paired Telegram user everywhere `_jwt_user` is checked.

Flow:
  1. `create_pending()` — unauthenticated. Mints a >=128-bit
     `secrets.token_urlsafe` code, stores only its SHA-256 hash, returns the
     raw code + deeplink to the caller.
  2. `approve()` — called from `bot/handlers/start.py` on `/start gekko_<code>`.
     Binds the row to the Telegram update's own resolved `users.id` — never
     anything client-supplied. Idempotent no-op on an already-approved/expired/
     unknown code (never reveals which case fired).
  3. `poll_and_consume()` — unauthenticated. Returns pending/ready/expired.
     "ready" deletes the row (single-use) and the caller mints the JWT.

Unknown, expired, and another-user's code all resolve through the exact same
`expired` branch with identical shape/timing characteristics (one indexed
lookup either way) so codes can't be enumerated by response difference.
"""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from database.db import get_session
from bot.models.mobile_pairing import MobilePairing

logger = logging.getLogger(__name__)

CODE_PREFIX = "gekko_"
_TTL_SECONDS = 300  # 5 minutes
_MAX_PENDING_PER_IP = 5
_PENDING_WINDOW_SECONDS = 600  # matches the abuse-control window, not the code TTL


def _hash_code(raw_code: str) -> str:
    return hashlib.sha256(raw_code.encode("utf-8")).hexdigest()


def _hash_ip(ip: Optional[str]) -> Optional[str]:
    if not ip:
        return None
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()


def _as_utc(dt: datetime) -> datetime:
    """SQLite's DateTime type round-trips as tz-naive even though every value
    written here is UTC — normalize before comparing against
    `datetime.now(timezone.utc)` (matches the `.tzinfo is None` pattern used
    throughout bot/services/*.py, e.g. health_monitor.py, digest_service.py)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@dataclass
class PendingCode:
    code: str
    expires_at: datetime


class MobilePairingError(Exception):
    """Raised for caller-facing rejections (e.g. per-IP pending cap)."""


class MobilePairingService:
    def create_pending(self, request_ip: Optional[str] = None) -> PendingCode:
        """Create a new pending pairing row. Raises MobilePairingError if the
        requesting IP already has too many outstanding pending codes."""
        now = datetime.now(timezone.utc)
        ip_hash = _hash_ip(request_ip)

        with get_session() as session:
            if ip_hash:
                window_start = now - timedelta(seconds=_PENDING_WINDOW_SECONDS)
                pending_count = (
                    session.query(MobilePairing)
                    .filter(
                        MobilePairing.request_ip_hash == ip_hash,
                        MobilePairing.status == "pending",
                        MobilePairing.created_at >= window_start,
                        MobilePairing.expires_at > now,
                    )
                    .count()
                )
                if pending_count >= _MAX_PENDING_PER_IP:
                    raise MobilePairingError(
                        "Too many pending sign-in attempts. Try again shortly."
                    )

            raw_code = secrets.token_urlsafe(
                32
            )  # 256 bits of entropy, well above the 128-bit floor
            expires_at = now + timedelta(seconds=_TTL_SECONDS)
            row = MobilePairing(
                code_hash=_hash_code(raw_code),
                status="pending",
                request_ip_hash=ip_hash,
                created_at=now,
                expires_at=expires_at,
            )
            session.add(row)

        # Read back the locally computed value rather than the ORM instance —
        # `get_session()` closes the session on exit (expire_on_commit default),
        # so touching `row.expires_at` here would risk a DetachedInstanceError.
        return PendingCode(code=raw_code, expires_at=expires_at)

    def approve(self, raw_code: str, telegram_resolved_user_id: int) -> bool:
        """Bind a pending code to a Telegram-resolved `users.id`.

        `telegram_resolved_user_id` MUST come from the bot's own DB lookup of
        the Telegram update's sender — never from any client-supplied value —
        so an approved code can only ever be collected as the account that
        actually opened the deeplink in Telegram.

        Returns True only if a pending, unexpired code was found and bound.
        Never raises for unknown/expired input — the bot's reply text must
        stay identical either way (see start.py).
        """
        now = datetime.now(timezone.utc)
        code_hash = _hash_code(raw_code)

        with get_session() as session:
            row = session.query(MobilePairing).filter(MobilePairing.code_hash == code_hash).first()
            if row is None:
                return False
            # Constant-time compare in addition to the indexed hash-equality
            # lookup above — defense in depth per the spec, even though the
            # DB lookup already required an exact hash match.
            if not secrets.compare_digest(row.code_hash, code_hash):
                return False
            if row.status != "pending" or _as_utc(row.expires_at) <= now:
                return False

            row.status = "approved"
            row.user_id = telegram_resolved_user_id
            row.approved_at = now
            return True

    def poll_and_consume(self, raw_code: str) -> dict:
        """Single-use poll. Deletes the row on a "ready" response so a code
        can never be collected twice."""
        now = datetime.now(timezone.utc)
        code_hash = _hash_code(raw_code)

        with get_session() as session:
            row = session.query(MobilePairing).filter(MobilePairing.code_hash == code_hash).first()
            if row is None or _as_utc(row.expires_at) <= now:
                if row is not None:
                    session.delete(row)
                return {"status": "expired"}

            if not secrets.compare_digest(row.code_hash, code_hash):
                return {"status": "expired"}

            if row.status == "pending":
                return {"status": "pending"}

            if row.status == "approved":
                user_id = row.user_id
                session.delete(row)
                return {"status": "ready", "user_id": user_id}

            # Any other/unexpected status — treat as consumed/unknown.
            return {"status": "expired"}

    def purge_expired(self) -> int:
        """Best-effort housekeeping — safe to call from anywhere; not relied
        on for correctness since every read path already checks expires_at."""
        now = datetime.now(timezone.utc)
        with get_session() as session:
            deleted = (
                session.query(MobilePairing)
                .filter(MobilePairing.expires_at <= now)
                .delete(synchronize_session=False)
            )
        return deleted


mobile_pairing_service = MobilePairingService()
