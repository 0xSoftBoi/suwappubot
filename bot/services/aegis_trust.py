"""Per-user trust adaptation — Phase 2.3 of docs/plans/aegis-fork-extend.md.

DB-backed AEGIS TrustManager-like semantics: a per-(platform, user_id) trust
score that decays on threat verdicts and slowly recovers on clean scans. Must
be DB-backed (never in-process memory) because the bot runs multi-replica in
webhook mode (USE_WEBHOOK=true) — an in-memory dict would give every replica
its own view of a user's trust.

RECORD-ONLY (Phase 2.3): nothing here enforces anything. `get_trust` is not
called by any gate/limiter yet — enforcement is deferred to a later phase
after telemetry review. This module only maintains the score.

Write-amplification guard: every inbound message runs through AegisService's
scan()/ascan(), most of them clean. Writing a DB row for every clean scan
across the whole bot would be a huge amount of write volume for telemetry
nobody acts on yet. So:
  - A threat verdict always creates the row if missing and always writes
    (that's the signal we actually care about).
  - A clean verdict NEVER creates a row (a user with zero threats simply has
    no row — get_trust() returns the 100.0 default for them).
  - A clean verdict for a user who already has a row only writes a "slow
    recovery" (+1, capped at 100) update, and only if at least an hour has
    passed since the row was last touched — bounding write volume to at most
    one recovery bump per user per hour, no matter how many clean messages
    they send.

All public functions are fail-open: any DB error is caught, logged at debug,
and swallowed. A trust-tracking hiccup must never raise into the scan path.

Read-amplification guard (money-path review, Phase 2.4): the write guard above
bounds *writes*, but a naive clean path still runs one SELECT per scanned
message — and record_verdict shares the money-path DB thread pool. Since the
overwhelming majority of users never trip a signature (so have no row), we keep
an in-process negative cache of (platform, user_id) keys known to have no row.
A clean verdict for a cached key returns before touching the DB, so steady-state
reads fall to ~one per new user (then cached) plus the small set of users who
have actually tripped a threat. The cache is per-process (fine — it only ever
suppresses a redundant read of a row that is still absent); a threat that
creates a row evicts the key so its later clean scans take the recovery path.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Set, Tuple

from database.db import get_session
from bot.models.aegis_trust import AegisUserTrust

logger = logging.getLogger(__name__)

# Trust score bounds and step sizes.
TRUST_DEFAULT = 100.0
TRUST_MIN = 0.0
TRUST_MAX = 100.0
_THREAT_PENALTY = 15.0
_RECOVERY_STEP = 1.0
_RECOVERY_INTERVAL = timedelta(hours=1)

# In-process negative cache of (platform, user_id) keys confirmed to have no
# row. Set operations are atomic under the GIL, which is all this fail-open
# cache needs — a race at worst causes one redundant DB read. Bounded by a
# crude clear-on-overflow: a telemetry cache never needs LRU precision, and
# clearing just costs a few reads until it refills.
_no_row_cache: Set[Tuple[str, str]] = set()
_NO_ROW_CACHE_MAX = 50_000


def _cache_absent(key: Tuple[str, str]) -> None:
    if len(_no_row_cache) >= _NO_ROW_CACHE_MAX:
        _no_row_cache.clear()
    _no_row_cache.add(key)


def get_trust(platform: str, user_id: Optional[str]) -> float:
    """Return the current trust score for (platform, user_id).

    Defaults to 100.0 (full trust) when no row exists — including for
    unknown platforms/users and on any DB error (fail-open).
    """
    if not platform or not user_id:
        return TRUST_DEFAULT
    try:
        with get_session() as session:
            row = (
                session.query(AegisUserTrust)
                .filter(
                    AegisUserTrust.platform == platform,
                    AegisUserTrust.user_id == str(user_id),
                )
                .first()
            )
            if row is None:
                return TRUST_DEFAULT
            return float(row.trust_score) if row.trust_score is not None else TRUST_DEFAULT
    except Exception:
        logger.debug("aegis_trust.get_trust failed (fail-open, default 100.0)", exc_info=True)
        return TRUST_DEFAULT


def record_verdict(platform: str, user_id: Optional[str], verdict) -> None:
    """Record one scan verdict against a user's trust score.

    `verdict` is duck-typed (only `.is_threat` is read) to avoid importing
    AegisVerdict here, which would create an import cycle with
    bot.services.aegis_service (that module lazily imports this one instead).

    Threat path: create the row if missing, decrement trust_score by
    `_THREAT_PENALTY` (floored at TRUST_MIN), bump threat_count, stamp
    last_threat_at/last_seen_at.

    Clean path: see the write-amplification guard in the module docstring —
    never creates a row, and only bumps an existing row's trust_score when
    the recovery interval has elapsed since it was last touched.

    Never raises: any exception (including a malformed `verdict`) is caught,
    logged at debug, and swallowed.
    """
    if not platform or not user_id:
        return
    try:
        is_threat = bool(getattr(verdict, "is_threat", False))
        now = datetime.utcnow()
        user_id = str(user_id)
        key = (platform, user_id)

        # Read-amplification guard: a clean verdict for a user we already know
        # has no row does zero DB work. Threats always go to the DB (and evict
        # the key, since they may create the row).
        if not is_threat and key in _no_row_cache:
            return

        with get_session() as session:
            row = (
                session.query(AegisUserTrust)
                .filter(AegisUserTrust.platform == platform, AegisUserTrust.user_id == user_id)
                .first()
            )

            if is_threat:
                if row is None:
                    row = AegisUserTrust(
                        platform=platform,
                        user_id=user_id,
                        trust_score=TRUST_DEFAULT,
                        threat_count=0,
                        clean_count=0,
                        created_at=now,
                    )
                    session.add(row)
                current = row.trust_score if row.trust_score is not None else TRUST_DEFAULT
                row.trust_score = max(TRUST_MIN, current - _THREAT_PENALTY)
                row.threat_count = (row.threat_count or 0) + 1
                row.last_threat_at = now
                row.last_seen_at = now
                _no_row_cache.discard(key)  # a row now exists for this key
                return

            # Clean path — never create a row for a user with zero threats.
            if row is None:
                _cache_absent(key)  # remember: skip the DB on this user's next clean scan
                return

            last_update = row.last_seen_at or row.created_at
            if last_update is not None and (now - last_update) < _RECOVERY_INTERVAL:
                return  # too soon since the last write — skip to bound write volume

            current = row.trust_score if row.trust_score is not None else TRUST_DEFAULT
            row.trust_score = min(TRUST_MAX, current + _RECOVERY_STEP)
            row.clean_count = (row.clean_count or 0) + 1
            row.last_seen_at = now
    except Exception:
        logger.debug("aegis_trust.record_verdict failed (fail-open)", exc_info=True)
