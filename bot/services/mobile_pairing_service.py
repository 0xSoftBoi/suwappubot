"""Gekko mobile Telegram deeplink sign-in — pairing code lifecycle.

MONEY-PATH (account takeover surface): this mints the session that lets a
device act as the paired Telegram user everywhere `_jwt_user` is checked.

State machine (code_hash -> status):
  pending -> staged -> approved -> consumed (row deleted)
                     \-> rejected (row deleted)

Flow:
  1. `create_pending()` — unauthenticated. Mints a >=128-bit
     `secrets.token_urlsafe` code, stores only its SHA-256 hash, returns the
     raw code + deeplink + a deterministic `verification_word` to the caller
     (the Gekko app displays the word on its own sign-in screen).
  2. `stage()` — called from `bot/handlers/start.py` on `/start gekko_<code>`.
     Binds the row to the Telegram update's own resolved `users.id` — never
     anything client-supplied — but does NOT grant a session by itself. The
     bot replies with an Approve/Not me prompt showing the same verification
     word, so a phishing target who didn't actually request sign-in from
     their own Gekko app has no matching word to compare against.
  3. `approve()` — called ONLY from the "Approve" callback handler. Requires
     the row to still be `staged`, unexpired, and the confirming Telegram
     user to be the SAME one the row was staged to. Only this call moves a
     row into `approved`, which is what makes it collectible by poll.
  4. `reject()` — called from the "Not me" callback handler. Deletes a
     `staged` row so it can never be approved, regardless of what happens to
     the original deeplink.
  5. `poll_and_consume()` — unauthenticated. Returns pending/ready/expired.
     "ready" atomically claims the row (conditional UPDATE, not check-then-
     act) so two concurrent polls can never both mint a JWT, then deletes it
     (single-use) and the caller mints the JWT.

Unknown, expired, staged-but-not-approved, and another-user's code all
resolve through response shapes that don't let a poller distinguish "never
existed" from "still waiting for approval" from "timed out" by more than the
documented pending/expired split — codes can't be enumerated or fast-forwarded
by response difference.
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
# This used to bound to ONE GLOBAL bucket in production: api/routes/mobile.py's
# `_client_ip` returned Railway's edge IP for every request (uvicorn wasn't told to
# trust X-Forwarded-For), so 5 was actually "5 pending codes for the whole service,
# for everyone, at once". Now that `_client_ip` resolves the real per-client IP (see
# its docstring + api/Dockerfile.railway), this is a genuine per-client cap again —
# bumped from 5 to 8 to leave headroom for legitimate carrier-grade-NAT/shared-WiFi
# clients that share one public IP with a few other real users, while still bounding
# any single client's ability to spam pending codes.
_MAX_PENDING_PER_IP = 8
_PENDING_WINDOW_SECONDS = 600  # matches the abuse-control window, not the code TTL

# Human-eyeball verification word alphabet — no 0/O/1/I ambiguity.
_VERIFICATION_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_VERIFICATION_WORD_LEN = 5


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


def derive_verification_word(raw_code: str) -> str:
    """Deterministic, human-comparable word for a pairing code.

    Domain-separated SHA-256 (different label than `_hash_code`'s) truncated
    to a small alphabet — one-way, so displaying this word never lets anyone
    reconstruct the raw code, but it's stable for a given code so the same
    value shows on both the requesting app's screen and the bot's approval
    prompt. This is the comparable secret a phishing target won't have (their
    own Gekko app never asked to sign in, so they have nothing to compare
    the bot's word against).
    """
    digest = hashlib.sha256(f"gekko-pairing-verify-v1:{raw_code}".encode("utf-8")).digest()
    return "".join(
        _VERIFICATION_ALPHABET[b % len(_VERIFICATION_ALPHABET)]
        for b in digest[:_VERIFICATION_WORD_LEN]
    )


@dataclass
class PendingCode:
    code: str
    expires_at: datetime
    verification_word: str


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
                        MobilePairing.status.in_(("pending", "staged")),
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
        return PendingCode(
            code=raw_code,
            expires_at=expires_at,
            verification_word=derive_verification_word(raw_code),
        )

    def stage(self, raw_code: str, telegram_resolved_user_id: int) -> bool:
        """Bind a pending code to a Telegram-resolved `users.id` and move it
        to `staged` — the deeplink-tap step. Does NOT grant a session by
        itself; only `approve()` (from the explicit Approve callback) does.

        `telegram_resolved_user_id` MUST come from the bot's own DB lookup of
        the Telegram update's sender — never from any client-supplied value.

        Returns True only if the code was `pending`/`staged`-and-unexpired
        and (if already staged) staged to this same user — i.e. idempotent
        re-taps of the same link by the same user are fine, but a second
        Telegram account can't hijack a code someone else already staged.
        Never raises for unknown/expired input — the bot's reply text must
        stay identical either way (see start.py).
        """
        now = datetime.now(timezone.utc)
        code_hash = _hash_code(raw_code)

        with get_session() as session:
            row = session.query(MobilePairing).filter(MobilePairing.code_hash == code_hash).first()
            if row is None:
                return False
            if not secrets.compare_digest(row.code_hash, code_hash):
                return False
            if _as_utc(row.expires_at) <= now:
                return False
            if row.status not in ("pending", "staged"):
                return False
            if row.status == "staged" and row.user_id != telegram_resolved_user_id:
                return False

            row.status = "staged"
            row.user_id = telegram_resolved_user_id
            return True

    def approve(self, raw_code: str, telegram_confirming_user_id: int) -> bool:
        """Bind approval — called ONLY from the "Approve" callback handler.

        Requires the row to still be `staged`, unexpired, and the confirming
        Telegram user to be the same one it was staged to (defense in depth:
        `telegram_confirming_user_id` is resolved the same server-side way as
        `stage()`'s argument, never client-supplied). This is the only call
        that makes a code collectible by `poll_and_consume()`.
        """
        now = datetime.now(timezone.utc)
        code_hash = _hash_code(raw_code)

        with get_session() as session:
            row = session.query(MobilePairing).filter(MobilePairing.code_hash == code_hash).first()
            if row is None:
                return False
            if not secrets.compare_digest(row.code_hash, code_hash):
                return False
            if row.status != "staged" or _as_utc(row.expires_at) <= now:
                return False
            if row.user_id != telegram_confirming_user_id:
                return False

            row.status = "approved"
            row.approved_at = now
            return True

    def reject(self, raw_code: str, telegram_confirming_user_id: int) -> bool:
        """ "Not me" — called ONLY from the reject callback handler. Deletes a
        `staged` row so it can never subsequently be approved."""
        now = datetime.now(timezone.utc)
        code_hash = _hash_code(raw_code)

        with get_session() as session:
            row = session.query(MobilePairing).filter(MobilePairing.code_hash == code_hash).first()
            if row is None:
                return False
            if not secrets.compare_digest(row.code_hash, code_hash):
                return False
            if row.status != "staged" or _as_utc(row.expires_at) <= now:
                return False
            if row.user_id != telegram_confirming_user_id:
                return False

            session.delete(row)
            return True

    def poll_and_consume(self, raw_code: str) -> dict:
        """Single-use poll. `pending` and `staged` both read back as
        "pending" (waiting) to the client — only `approved` is collectible.

        The `approved` -> `consumed` transition is an atomic conditional
        UPDATE (`WHERE status='approved'`), not a read-then-delete: two
        concurrent polls racing here can only ever have ONE of them see
        `claimed == 1`, so at most one JWT is ever minted per code, even
        under a genuine race, without relying on any specific DB isolation
        level beyond a single-row UPDATE's own atomicity.
        """
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

            if row.status in ("pending", "staged"):
                return {"status": "pending"}

            if row.status != "approved":
                # rejected / already-consumed / unexpected — treat as unknown.
                return {"status": "expired"}

            user_id = row.user_id

            # Atomic conditional claim — see docstring. `synchronize_session`
            # is disabled since we don't need `row` to reflect the write, we
            # only need `claimed`'s rowcount.
            claimed = (
                session.query(MobilePairing)
                .filter(MobilePairing.code_hash == code_hash, MobilePairing.status == "approved")
                .update({"status": "consumed"}, synchronize_session=False)
            )
            if claimed != 1:
                # Lost the race to a concurrent poll — it already claimed
                # this code. Never hand back a second token for one code.
                return {"status": "expired"}

            session.query(MobilePairing).filter(MobilePairing.code_hash == code_hash).delete(
                synchronize_session=False
            )
            return {"status": "ready", "user_id": user_id}

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
