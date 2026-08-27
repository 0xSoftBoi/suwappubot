"""Revenue analytics views with institutional constraints (W2).

Tektonic published a CC-0 SQL ledger of every x402 payment on Solana and Base and made
three constraints structural rather than advisory. This module is the same three
constraints applied to Suwappu's own revenue surface:

**1. Atomic state validation (W2.1).** Only terminally successful rows count. Their
   pipeline counted a Solana payment only at ``tx.err = ''`` and a Base payment only at
   ``receipt_status = 1``, yielding "exactly 0.00% inflation from reverted or failed
   executions". Here every view carries its success predicate in the view body, so a
   caller cannot produce an inflated number by forgetting a filter.

**2. Partition discipline (W2.2).** Every view takes a bounded window and
   :func:`build_query` refuses to render without one. Their unpartitioned Solana scans
   cost $5,000-$20,000 against $0.50-$2.00 partitioned; ours is Postgres rather than
   BigQuery so the cost is a table scan and a locked-up primary rather than a bill, but
   the discipline is the same and the fix is the same: make the unbounded query
   impossible to express, not merely discouraged.

**3. Reproducibility (W2.5).** Every figure is returned next to the exact SQL that
   produced it. "Institutional users trust reproducible SQL far more than dashboard
   screenshots." :func:`render` exists so a number in a report can always be pasted back
   into psql by whoever doubts it.

The five views mirror the five they built - summary, per-seller, per-facilitator, hourly
timeseries, top buyers - remapped onto what we actually sell.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Sequence

# --- Atomic state predicates ----------------------------------------------------------
#
# One definition per table, used by every view. Changing what "settled" means is a
# one-line change here, not a grep across a dozen dashboards.

SETTLED = {
    "swap_transactions": "s.status = 'completed'",
    "fee_transactions": "f.fee_amount_usd IS NOT NULL",
    "x402_payments": "p.status = 'completed'",
    "referral_earnings": "r.amount_usd IS NOT NULL",
}


class UnboundedQuery(ValueError):
    """Raised when a query would scan without a bounded window.

    This is the partition-discipline guard. It is an exception rather than a warning
    because the failure mode it prevents - a full-history scan issued by something that
    runs every minute - degrades production rather than the report.
    """


MAX_WINDOW_DAYS = 400


@dataclass(frozen=True)
class View:
    name: str
    title: str
    description: str
    sql: str
    #: Columns the view returns, in order, for rendering.
    columns: Sequence[str]


# --- View 1: summary ------------------------------------------------------------------

SUMMARY = View(
    name="summary",
    title="Revenue summary",
    description=(
        "Settled volume, fee revenue, x402 payments and referral cost for the window. "
        "Every component filters on terminal success, so the total cannot include a "
        "reverted execution."
    ),
    columns=["metric", "value_usd", "row_count"],
    sql="""
WITH swaps AS (
    SELECT COUNT(*) AS n, COALESCE(SUM(s.from_amount_usd), 0) AS usd
      FROM swap_transactions s
     WHERE s.created_at >= :start AND s.created_at < :end
       AND {settled_swaps}
), fees AS (
    SELECT COUNT(*) AS n, COALESCE(SUM(f.fee_amount_usd), 0) AS usd
      FROM fee_transactions f
     WHERE f.created_at >= :start AND f.created_at < :end
       AND {settled_fees}
), payments AS (
    SELECT COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS usd
      FROM x402_payments p
     WHERE p.created_at >= :start AND p.created_at < :end
       AND {settled_payments}
), referrals AS (
    SELECT COUNT(*) AS n, COALESCE(SUM(r.amount_usd), 0) AS usd
      FROM referral_earnings r
     WHERE r.created_at >= :start AND r.created_at < :end
       AND {settled_referrals}
)
SELECT 'settled_swap_volume_usd' AS metric, usd AS value_usd, n AS row_count FROM swaps
UNION ALL SELECT 'fee_revenue_usd',      usd, n FROM fees
UNION ALL SELECT 'x402_payments_usd',    usd, n FROM payments
UNION ALL SELECT 'referral_cost_usd',    usd, n FROM referrals
""",
)

# --- View 2: per-user (their "per-seller") --------------------------------------------

PER_USER = View(
    name="per_user",
    title="Revenue per user",
    description="Settled volume and fee revenue by user, highest fee revenue first.",
    columns=["user_id", "swaps", "volume_usd", "fee_usd"],
    sql="""
SELECT s.user_id,
       COUNT(DISTINCT s.id)                       AS swaps,
       COALESCE(SUM(s.from_amount_usd), 0)        AS volume_usd,
       COALESCE(MAX(fee.fee_usd), 0)              AS fee_usd
  FROM swap_transactions s
  LEFT JOIN (
       SELECT f.user_id, SUM(f.fee_amount_usd) AS fee_usd
         FROM fee_transactions f
        WHERE f.created_at >= :start AND f.created_at < :end
          AND {settled_fees}
        GROUP BY f.user_id
  ) fee ON fee.user_id = s.user_id
 WHERE s.created_at >= :start AND s.created_at < :end
   AND {settled_swaps}
 GROUP BY s.user_id
 ORDER BY fee_usd DESC, volume_usd DESC
 LIMIT :limit
""",
)

# --- View 3: per-chain (their "per-facilitator") --------------------------------------

PER_CHAIN = View(
    name="per_chain",
    title="Revenue per chain",
    description=(
        "Settled volume, fee revenue and average ticket by source chain. Average ticket "
        "is the number Tektonic used to tell agent micro-payments ($0.17 on Solana) "
        "from merchant payments ($0.32 on Base); the same split tells our retail "
        "traffic from our agent traffic."
    ),
    columns=["chain", "swaps", "volume_usd", "fee_usd", "avg_ticket_usd"],
    sql="""
-- Fees are pre-aggregated per swap before the join. Joining fee_transactions
-- directly would fan out any swap carrying more than one fee row and inflate
-- SUM(from_amount_usd) by the duplication factor - a volume number that is wrong
-- in the direction that flatters us.
WITH fee_by_swap AS (
    SELECT f.swap_id, SUM(f.fee_amount_usd) AS fee_usd
      FROM fee_transactions f
     WHERE f.created_at >= :start AND f.created_at < :end
       AND {settled_fees}
     GROUP BY f.swap_id
)
SELECT s.from_chain                                        AS chain,
       COUNT(*)                                            AS swaps,
       COALESCE(SUM(s.from_amount_usd), 0)                 AS volume_usd,
       COALESCE(SUM(fee_by_swap.fee_usd), 0)               AS fee_usd,
       CASE WHEN COUNT(*) = 0 THEN 0
            ELSE COALESCE(SUM(s.from_amount_usd), 0) / COUNT(*)
       END                                                 AS avg_ticket_usd
  FROM swap_transactions s
  LEFT JOIN fee_by_swap ON fee_by_swap.swap_id = s.id
 WHERE s.created_at >= :start AND s.created_at < :end
   AND {settled_swaps}
 GROUP BY s.from_chain
 ORDER BY volume_usd DESC
""",
)

# --- View 4: hourly timeseries --------------------------------------------------------

HOURLY = View(
    name="hourly",
    title="Hourly settled volume and fees",
    description=(
        "Bucketed to the hour. Tektonic's cascade analysis only became legible once "
        "events were bucketed and ordered - peak fill rate, wave onset and contagion "
        "spread are all shapes in a timeseries, invisible in a total."
    ),
    columns=["bucket", "swaps", "volume_usd", "fee_usd"],
    sql="""
-- Same pre-aggregation as per_chain: a fan-out here would inflate every bucket.
WITH fee_by_swap AS (
    SELECT f.swap_id, SUM(f.fee_amount_usd) AS fee_usd
      FROM fee_transactions f
     WHERE f.created_at >= :start AND f.created_at < :end
       AND {settled_fees}
     GROUP BY f.swap_id
)
SELECT {hour_bucket}                                AS bucket,
       COUNT(*)                                     AS swaps,
       COALESCE(SUM(s.from_amount_usd), 0)          AS volume_usd,
       COALESCE(SUM(fee_by_swap.fee_usd), 0)        AS fee_usd
  FROM swap_transactions s
  LEFT JOIN fee_by_swap ON fee_by_swap.swap_id = s.id
 WHERE s.created_at >= :start AND s.created_at < :end
   AND {settled_swaps}
 GROUP BY bucket
 ORDER BY bucket
""",
)

# --- View 5: top payers (their "top buyers") ------------------------------------------

TOP_PAYERS = View(
    name="top_payers",
    title="Top payers by settled x402 volume",
    description="Users ranked by settled x402 payment value. Pending and failed excluded.",
    columns=["user_id", "payments", "paid_usd", "chains"],
    sql="""
SELECT p.user_id,
       COUNT(*)                            AS payments,
       COALESCE(SUM(p.amount), 0)          AS paid_usd,
       COUNT(DISTINCT p.chain)             AS chains
  FROM x402_payments p
 WHERE p.created_at >= :start AND p.created_at < :end
   AND {settled_payments}
 GROUP BY p.user_id
 ORDER BY paid_usd DESC
 LIMIT :limit
""",
)

VIEWS: dict[str, View] = {v.name: v for v in (SUMMARY, PER_USER, PER_CHAIN, HOURLY, TOP_PAYERS)}


# --- Rendering ------------------------------------------------------------------------

_HOUR_BUCKET = {
    # Postgres and SQLite spell hour truncation differently; the view body stays
    # dialect-neutral and the difference is resolved here.
    "postgresql": "date_trunc('hour', s.created_at)",
    "sqlite": "strftime('%Y-%m-%dT%H:00', s.created_at)",
}


def build_query(view: View, *, dialect: str = "postgresql") -> str:
    """Render a view's SQL for a dialect, with the success predicates inlined.

    The window parameters are left as bind parameters (``:start`` / ``:end``) so they
    cannot be forgotten - a caller who omits them gets a driver error, not a full scan.
    """
    return view.sql.format(
        settled_swaps=SETTLED["swap_transactions"],
        settled_fees=SETTLED["fee_transactions"],
        settled_payments=SETTLED["x402_payments"],
        settled_referrals=SETTLED["referral_earnings"],
        hour_bucket=_HOUR_BUCKET.get(dialect, _HOUR_BUCKET["postgresql"]),
    ).strip()


def validate_window(
    start: Optional[datetime], end: Optional[datetime]
) -> tuple[datetime, datetime]:
    """Partition discipline. An unbounded or absurd window is refused, not warned about."""
    if start is None or end is None:
        raise UnboundedQuery(
            "analytics queries require an explicit bounded window; "
            "an unpartitioned full-history scan is not an available option"
        )
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end <= start:
        raise UnboundedQuery(f"window end {end.isoformat()} is not after start {start.isoformat()}")
    span_days = (end - start).days
    if span_days > MAX_WINDOW_DAYS:
        raise UnboundedQuery(
            f"window of {span_days} days exceeds MAX_WINDOW_DAYS={MAX_WINDOW_DAYS}; "
            "run it as a series of bounded windows instead"
        )
    return start, end


@dataclass
class ViewResult:
    view: View
    rows: list[Mapping[str, Any]]
    sql: str
    params: Mapping[str, Any]

    def reproduce(self) -> str:
        """The exact query behind these numbers, ready to paste into psql."""
        bindings = "\n".join(f"-- :{k} = {v!r}" for k, v in sorted(self.params.items()))
        return f"{bindings}\n{self.sql}"


def run(
    conn,
    view: View,
    *,
    start: datetime,
    end: datetime,
    limit: int = 50,
    dialect: Optional[str] = None,
) -> ViewResult:
    """Execute one view over a validated window."""
    from sqlalchemy import text

    start, end = validate_window(start, end)
    if dialect is None:
        dialect = getattr(getattr(conn, "dialect", None), "name", "postgresql")

    sql = build_query(view, dialect=dialect)
    params: dict[str, Any] = {"start": start, "end": end}
    if ":limit" in sql:
        params["limit"] = limit

    rows = [dict(row._mapping) for row in conn.execute(text(sql), params)]
    return ViewResult(view=view, rows=rows, sql=sql, params=params)


__all__ = [
    "View",
    "ViewResult",
    "VIEWS",
    "SUMMARY",
    "PER_USER",
    "PER_CHAIN",
    "HOURLY",
    "TOP_PAYERS",
    "SETTLED",
    "UnboundedQuery",
    "MAX_WINDOW_DAYS",
    "build_query",
    "validate_window",
    "run",
]
