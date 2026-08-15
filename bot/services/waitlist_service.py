"""Handle-reservation waitlist + live referral leaderboard.

Backs the ``/webapp/waitlist/*`` routes in ``api/webapp.py``. Distinct from
the mobile-app waitlist (``bot/services/waitlist_email.py`` +
``SupportTicket`` category ``mobile_waitlist``) which is left untouched.

Ranking rule (fixed by the API contract, do not change):
    ORDER BY referral_count DESC, created_at ASC, id ASC

``referral_count`` for a row is always ``COUNT(*) WHERE referred_by_id = id``
— it is never denormalized/cached on the row, so it cannot drift. Rank is
computed with a single SQL window function (``ROW_NUMBER() OVER (...)``)
against a `LEFT JOIN` subquery that does the counting, so this stays a
single query regardless of table size (no Python-side sort of all rows).

SQLite compatibility: ``ROW_NUMBER() OVER (...)`` requires SQLite >= 3.25
(2018-09). Every SQLite bundled with Python >= 3.7 satisfies this, and
Postgres has supported window functions since 8.4, so the SQL path is used
unconditionally in practice. As a defensive fallback for a hypothetical
ancient SQLite build, ``_supports_window_functions`` gates a pure-Python
equivalent (``_rank_row_python`` / ``_leaderboard_python``) that loads and
sorts in memory — this fallback is O(n) per call and is NOT what runs in
any environment this codebase actually deploys to.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import sqlite3
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Handle validation
# ---------------------------------------------------------------------------

# 3-32 chars total, lowercase alnum + dash, no leading/trailing dash.
HANDLE_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$")

RESERVED_HANDLES = {
    "admin",
    "root",
    "support",
    "suwappu",
    "help",
    "api",
    "www",
    "mod",
    "moderator",
    "team",
    "official",
    "staff",
    "security",
    "billing",
    "system",
    "null",
    "undefined",
}

REASON_TAKEN = "taken"
REASON_INVALID = "invalid"
REASON_RESERVED = "reserved"

WAITLIST_REFERRAL_BASE_URL = "https://suwappu.bot/reserve"


def normalize_handle(raw: str) -> str:
    """Lowercase + strip. Does not validate."""
    return (raw or "").strip().lower()


def validate_handle_format(handle: str) -> Optional[str]:
    """Validate an already-normalized (lowercase, stripped) handle.

    Returns None if valid, else one of REASON_INVALID / REASON_RESERVED.
    """
    if not handle:
        return REASON_INVALID
    if "--" in handle:
        return REASON_INVALID
    if not HANDLE_RE.match(handle):
        return REASON_INVALID
    if handle in RESERVED_HANDLES:
        return REASON_RESERVED
    return None


def derive_seed(handle: str) -> int:
    """Stable non-negative int < 2**31 derived from the (normalized) handle.

    Used by the frontend to render a deterministic generative card. Must
    stay stable for a given handle forever, so this exact formula
    (first 8 hex chars of sha256(handle) mod 2**31) must never change.
    """
    digest = hashlib.sha256(handle.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % (2**31)


def _ip_salt() -> str:
    from bot.config.settings import settings

    return (
        getattr(settings, "jwt_secret_key", None)
        or getattr(settings, "telegram_bot_token", None)
        or "suwappu-waitlist-fallback-salt"
    )


def hash_ip(ip: Optional[str]) -> Optional[str]:
    """Salted hash of a client IP for abuse analysis. Never store the raw IP."""
    if not ip:
        return None
    return hashlib.sha256(f"{_ip_salt()}:{ip}".encode("utf-8")).hexdigest()


def generate_referral_code(session: Session, handle: str, max_attempts: int = 10) -> str:
    """Mint a unique referral code "HANDLE-XXXX" (uppercase handle + 4 random
    uppercase hex chars). Retries on collision against the unique index.

    ``handle`` is expected already-normalized (lowercase). The DB unique
    index on referral_code is the source of truth; this just avoids handing
    back an obviously-colliding code before the INSERT.
    """
    from bot.models.waitlist import WaitlistSignup

    prefix = handle.upper()[:32]
    for _ in range(max_attempts):
        suffix = secrets.token_hex(2).upper()  # 4 hex chars
        code = f"{prefix}-{suffix}"
        exists = (
            session.query(WaitlistSignup.id).filter(WaitlistSignup.referral_code == code).first()
        )
        if not exists:
            return code
    # Extremely unlikely to exhaust attempts; widen the suffix as a last resort.
    return f"{prefix}-{secrets.token_hex(4).upper()}"


def referral_url(code: str) -> str:
    return f"{WAITLIST_REFERRAL_BASE_URL}?ref={code}"


# ---------------------------------------------------------------------------
# Ranking (single SQL window function — do not replace with Python sorting)
# ---------------------------------------------------------------------------

# referral_count is computed via a LEFT JOIN subquery counting referred_by_id;
# rank is ROW_NUMBER() OVER the contract-mandated ordering. This CTE is reused
# (as a prefix) by every ranking query below so there is exactly one
# definition of the ranking rule.
_RANKED_CTE_SQL = """
WITH ref_counts AS (
    SELECT referred_by_id AS signup_id, COUNT(*) AS referral_count
    FROM waitlist_signups
    WHERE referred_by_id IS NOT NULL
    GROUP BY referred_by_id
),
ranked AS (
    SELECT
        w.id,
        w.handle,
        w.referral_code,
        w.created_at,
        COALESCE(rc.referral_count, 0) AS referral_count,
        ROW_NUMBER() OVER (
            ORDER BY COALESCE(rc.referral_count, 0) DESC, w.created_at ASC, w.id ASC
        ) AS position
    FROM waitlist_signups w
    LEFT JOIN ref_counts rc ON rc.signup_id = w.id
)
"""


@dataclass
class RankedRow:
    id: int
    handle: str
    referral_code: str
    referral_count: int
    position: int


def _supports_window_functions(session: Session) -> bool:
    """True unless bound to a SQLite older than 3.25 (see module docstring)."""
    bind = session.get_bind()
    dialect = getattr(bind, "dialect", None)
    if dialect is None or dialect.name != "sqlite":
        return True
    return sqlite3.sqlite_version_info >= (3, 25, 0)


def get_ranked_row(session: Session, signup_id: int) -> Optional[RankedRow]:
    """Rank + referral_count for a single signup, computed live."""
    if _supports_window_functions(session):
        row = session.execute(
            text(
                _RANKED_CTE_SQL + " SELECT id, handle, referral_code, referral_count, position"
                "   FROM ranked WHERE id = :id"
            ),
            {"id": signup_id},
        ).first()
        if row is None:
            return None
        return RankedRow(
            id=row.id,
            handle=row.handle,
            referral_code=row.referral_code,
            referral_count=int(row.referral_count),
            position=int(row.position),
        )
    return _rank_row_python(session, signup_id)


def get_row_above(session: Session, position: int) -> Optional[RankedRow]:
    """The row currently ranked directly above ``position`` (position - 1)."""
    if position <= 1:
        return None
    if _supports_window_functions(session):
        row = session.execute(
            text(
                _RANKED_CTE_SQL + " SELECT id, handle, referral_code, referral_count, position"
                "   FROM ranked WHERE position = :pos"
            ),
            {"pos": position - 1},
        ).first()
        if row is None:
            return None
        return RankedRow(
            id=row.id,
            handle=row.handle,
            referral_code=row.referral_code,
            referral_count=int(row.referral_count),
            position=int(row.position),
        )
    return _rank_position_python(session, position - 1)


def get_leaderboard(session: Session, limit: int = 10) -> list[RankedRow]:
    """Top ``limit`` rows by rank. PII-free by construction — the caller
    (api/webapp.py) must only surface .position/.handle/.referral_count."""
    limit = max(1, min(50, int(limit)))
    if _supports_window_functions(session):
        rows = session.execute(
            text(
                _RANKED_CTE_SQL + " SELECT id, handle, referral_code, referral_count, position"
                "   FROM ranked ORDER BY position ASC LIMIT :limit"
            ),
            {"limit": limit},
        ).fetchall()
        return [
            RankedRow(
                id=r.id,
                handle=r.handle,
                referral_code=r.referral_code,
                referral_count=int(r.referral_count),
                position=int(r.position),
            )
            for r in rows
        ]
    return _leaderboard_python(session, limit)


def get_total_signups(session: Session) -> int:
    return int(session.execute(text("SELECT COUNT(*) FROM waitlist_signups")).scalar() or 0)


def referrals_to_next_rank(my: RankedRow, above: Optional[RankedRow]) -> int:
    """How many MORE referrals ``my`` needs to overtake the row above.

    If already rank 1 -> 0. If tied on referral_count with the row above
    (they beat us purely on tie-break/earlier signup) -> need +1. If they
    have strictly more -> need (their_count - my_count + 1).
    """
    if above is None:
        return 0
    if above.referral_count == my.referral_count:
        return 1
    return max(0, above.referral_count - my.referral_count + 1)


# ---------------------------------------------------------------------------
# Pure-Python fallback (only used if _supports_window_functions() is False)
# ---------------------------------------------------------------------------


def _all_ranked_python(session: Session) -> list[RankedRow]:
    from bot.models.waitlist import WaitlistSignup

    rows = session.query(
        WaitlistSignup.id, WaitlistSignup.handle, WaitlistSignup.referral_code
    ).all()
    counts_raw = session.execute(
        text(
            "SELECT referred_by_id, COUNT(*) AS c FROM waitlist_signups "
            "WHERE referred_by_id IS NOT NULL GROUP BY referred_by_id"
        )
    ).fetchall()
    counts = {r.referred_by_id: int(r.c) for r in counts_raw}
    created_at_map = {
        r.id: r.created_at
        for r in session.query(WaitlistSignup.id, WaitlistSignup.created_at).all()
    }
    enriched = [
        (row.id, row.handle, row.referral_code, counts.get(row.id, 0), created_at_map.get(row.id))
        for row in rows
    ]
    enriched.sort(key=lambda t: (-t[3], t[4] or 0, t[0]))
    return [
        RankedRow(id=i, handle=h, referral_code=c, referral_count=cnt, position=pos)
        for pos, (i, h, c, cnt, _) in enumerate(enriched, start=1)
    ]


def _rank_row_python(session: Session, signup_id: int) -> Optional[RankedRow]:
    for r in _all_ranked_python(session):
        if r.id == signup_id:
            return r
    return None


def _rank_position_python(session: Session, position: int) -> Optional[RankedRow]:
    all_rows = _all_ranked_python(session)
    if 1 <= position <= len(all_rows):
        return all_rows[position - 1]
    return None


def _leaderboard_python(session: Session, limit: int) -> list[RankedRow]:
    return _all_ranked_python(session)[:limit]
