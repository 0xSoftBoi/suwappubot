"""L3 canonical money-event schema (W1.1).

Four-layer reconstruction (background: docs/plans/tektonic-blog-study.md):

    L1  raw            the production tables exactly as written
    L2  snapshot       the aggregate rows we treat as ground truth (user_points,
                       fee_summaries) taken at a point in time
    L3  canonical      *this module* - one normalised, deduplicated, deterministically
                       ordered event stream
    L4  reconstructed  replay of L3 against L2, in scripts/replay/engine.py

Two properties matter and both live here:

* **Determinism.** Two events sharing a timestamp must sort the same way on every
  machine, every run: :data:`EVENT_PRIORITY` first, then
  ``(user_id, source_table, source_id)``. Anything that relies on insertion order or
  dict iteration order breaks reproducibility.

* **Total coverage.** The expensive bug class is the long tail below ``fee``/``swap``:
  referral commissions, point spends, savings events. Omitting one category does not
  produce a local error, it shifts everything downstream of it. When a money-moving
  table is added to the product, add it here in the same commit.

Dependencies are deliberately minimal (stdlib + SQLAlchemy Core, no bot package
import) so the replayer runs anywhere a database URL does.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Iterable, Iterator, Mapping, Optional, Sequence

from scripts.replay._money import q_points, q_usd

# --- Event taxonomy -------------------------------------------------------------------

# Priority classes for same-millisecond tiebreaking. Lower sorts first.
#
# The ordering is causal, not alphabetical: a swap must settle before the fee derived
# from it, the fee before the referral commission derived from *that*, and points
# before any spend of those points. Getting this wrong produces a state that is
# internally consistent but wrong at every intermediate checkpoint.
EVENT_PRIORITY: dict[str, int] = {
    "swap_settled": 10,
    "fee_accrued": 20,
    "fee_swept": 30,
    "referral_earned": 40,
    "points_awarded": 50,
    "points_spent": 60,
    "spend_recorded": 70,
    "withdrawal": 80,
}

# Statuses that count as money actually having moved. Everything else is intent.
#
# A reverted swap that contributes to volume is not a rounding difference, it is a
# wrong number. Only terminal success counts.
TERMINAL_SUCCESS_STATUSES: frozenset[str] = frozenset({"completed"})
TERMINAL_FAILURE_STATUSES: frozenset[str] = frozenset({"failed", "cancelled"})


@dataclass(frozen=True, slots=True)
class CanonicalEvent:
    """One money-moving fact, normalised across source tables."""

    kind: str
    user_id: int
    ts: datetime
    source_table: str
    source_id: int
    usd: Decimal = Decimal(0)
    points: Decimal = Decimal(0)
    asset: Optional[str] = None
    chain: Optional[str] = None
    meta: Mapping[str, Any] = field(default_factory=dict)

    # -- ordering ---------------------------------------------------------------------

    @property
    def priority(self) -> int:
        return EVENT_PRIORITY.get(self.kind, 999)

    @property
    def sort_key(self) -> tuple:
        """Total order. Deterministic across processes and machines.

        ``(timestamp, priority class, user, source table, source id)``. The final two
        components guarantee a total order even when two rows in different tables share
        a millisecond and a user - which happens constantly, because a swap, its fee and
        its points award are written in one transaction.
        """
        return (
            self.ts,
            self.priority,
            self.user_id,
            self.source_table,
            self.source_id,
        )

    @property
    def dedupe_key(self) -> tuple[str, int]:
        """Identity of the underlying row. Replaying twice must not double-count."""
        return (self.source_table, self.source_id)

    def digest(self) -> str:
        """Stable content hash, used in checkpoint hashing."""
        payload = "|".join(
            [
                self.kind,
                str(self.user_id),
                _iso(self.ts),
                self.source_table,
                str(self.source_id),
                format(self.usd, "f"),
                format(self.points, "f"),
                self.asset or "",
                self.chain or "",
            ]
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _iso(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def _as_utc(value: Any) -> datetime:
    if value is None:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# --- Extraction -----------------------------------------------------------------------
#
# Every extractor filters at *extraction* time, not query time: a caller cannot forget
# a WHERE clause that is not an available option.

_SWAP_SQL = """
    SELECT id, user_id, from_chain, from_token, from_amount_usd, to_amount_usd,
           realized_to_amount_usd, status, completed_at, created_at
      FROM swap_transactions
     WHERE created_at >= :start AND created_at < :end
"""

_FEE_SQL = """
    SELECT id, user_id, swap_id, chain, token_symbol, fee_amount, fee_amount_usd,
           fee_percentage, swap_amount, collected, created_at
      FROM fee_transactions
     WHERE created_at >= :start AND created_at < :end
"""

_POINTS_SQL = """
    SELECT id, user_id, amount, action, swap_id, season_id, created_at
      FROM point_transactions
     WHERE created_at >= :start AND created_at < :end
"""

_REFERRAL_SQL = """
    SELECT id, referrer_id, referred_id, stream_type, amount_usd, token,
           commission_rate, created_at
      FROM referral_earnings
     WHERE created_at >= :start AND created_at < :end
"""

_SPEND_SQL = """
    SELECT id, user_id, amount_usd, kind, swap_id, created_at
      FROM spend_events
     WHERE created_at >= :start AND created_at < :end
"""


def extract_swaps(conn, start: datetime, end: datetime) -> Iterator[CanonicalEvent]:
    for row in _rows(conn, _SWAP_SQL, start, end):
        status = (row["status"] or "").lower()
        if status not in TERMINAL_SUCCESS_STATUSES:
            # Atomic state validation. A pending or failed swap moved no money.
            continue
        usd = row["realized_to_amount_usd"]
        if usd is None:
            usd = row["from_amount_usd"]
        yield CanonicalEvent(
            kind="swap_settled",
            user_id=int(row["user_id"]),
            ts=_as_utc(row["completed_at"] or row["created_at"]),
            source_table="swap_transactions",
            source_id=int(row["id"]),
            usd=q_usd(usd),
            asset=row["from_token"],
            chain=row["from_chain"],
            meta={"status": status},
        )


def extract_fees(conn, start: datetime, end: datetime) -> Iterator[CanonicalEvent]:
    for row in _rows(conn, _FEE_SQL, start, end):
        yield CanonicalEvent(
            kind="fee_swept" if row["collected"] else "fee_accrued",
            user_id=int(row["user_id"]),
            ts=_as_utc(row["created_at"]),
            source_table="fee_transactions",
            source_id=int(row["id"]),
            usd=q_usd(row["fee_amount_usd"]),
            asset=row["token_symbol"],
            chain=row["chain"],
            meta={
                "swap_id": row["swap_id"],
                "fee_percentage": row["fee_percentage"],
                "fee_amount": row["fee_amount"],
                "swap_amount": row["swap_amount"],
            },
        )


def extract_points(conn, start: datetime, end: datetime) -> Iterator[CanonicalEvent]:
    for row in _rows(conn, _POINTS_SQL, start, end):
        amount = q_points(row["amount"])
        yield CanonicalEvent(
            kind="points_awarded" if amount >= 0 else "points_spent",
            user_id=int(row["user_id"]),
            ts=_as_utc(row["created_at"]),
            source_table="point_transactions",
            source_id=int(row["id"]),
            points=amount,
            meta={"action": row["action"], "season_id": row["season_id"]},
        )


def extract_referrals(conn, start: datetime, end: datetime) -> Iterator[CanonicalEvent]:
    for row in _rows(conn, _REFERRAL_SQL, start, end):
        yield CanonicalEvent(
            kind="referral_earned",
            user_id=int(row["referrer_id"]),
            ts=_as_utc(row["created_at"]),
            source_table="referral_earnings",
            source_id=int(row["id"]),
            usd=q_usd(row["amount_usd"]),
            asset=row["token"],
            meta={
                "stream_type": row["stream_type"],
                "referred_id": row["referred_id"],
                "commission_rate": row["commission_rate"],
            },
        )


def extract_spend(conn, start: datetime, end: datetime) -> Iterator[CanonicalEvent]:
    for row in _rows(conn, _SPEND_SQL, start, end):
        yield CanonicalEvent(
            kind="spend_recorded",
            user_id=int(row["user_id"]),
            ts=_as_utc(row["created_at"]),
            source_table="spend_events",
            source_id=int(row["id"]),
            usd=q_usd(row["amount_usd"]),
            meta={"kind": row["kind"], "swap_id": row["swap_id"]},
        )


EXTRACTORS = {
    "swap_transactions": extract_swaps,
    "fee_transactions": extract_fees,
    "point_transactions": extract_points,
    "referral_earnings": extract_referrals,
    "spend_events": extract_spend,
}


def _rows(conn, sql: str, start: datetime, end: datetime) -> Iterable[Mapping[str, Any]]:
    from sqlalchemy import text

    try:
        result = conn.execute(text(sql), {"start": start, "end": end})
    except Exception as exc:  # missing table on an older schema
        raise MissingSourceTable(str(exc)) from exc
    for row in result:
        yield row._mapping


class MissingSourceTable(RuntimeError):
    """Raised when a source table is absent - reported, never silently skipped."""


def build_canonical_stream(
    conn,
    start: datetime,
    end: datetime,
    *,
    tables: Optional[Sequence[str]] = None,
) -> tuple[list[CanonicalEvent], list[str]]:
    """Produce the deduplicated, deterministically ordered L3 stream.

    Returns ``(events, warnings)``. Missing tables land in ``warnings`` rather than
    being swallowed: partial coverage is a fact the operator must see, because the
    divergence it causes shows up much later and looks like an arithmetic bug.
    """
    selected = list(tables) if tables else list(EXTRACTORS)
    events: list[CanonicalEvent] = []
    seen: set[tuple[str, int]] = set()
    warnings: list[str] = []

    for name in selected:
        extractor = EXTRACTORS.get(name)
        if extractor is None:
            warnings.append(f"unknown source table: {name}")
            continue
        try:
            for event in extractor(conn, start, end):
                if event.dedupe_key in seen:
                    continue
                seen.add(event.dedupe_key)
                events.append(event)
        except MissingSourceTable as exc:
            warnings.append(f"source table unavailable ({name}): {exc}".split("\n")[0])

    events.sort(key=lambda e: e.sort_key)
    return events, warnings


def stream_digest(events: Sequence[CanonicalEvent]) -> str:
    """Hash of the whole ordered stream - the reproducibility receipt."""
    h = hashlib.sha256()
    for event in events:
        h.update(event.digest().encode())
    return h.hexdigest()


__all__ = [
    "CanonicalEvent",
    "EVENT_PRIORITY",
    "TERMINAL_SUCCESS_STATUSES",
    "TERMINAL_FAILURE_STATUSES",
    "MissingSourceTable",
    "build_canonical_stream",
    "stream_digest",
    "EXTRACTORS",
]
