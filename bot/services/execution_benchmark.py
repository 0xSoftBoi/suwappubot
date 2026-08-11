"""Execution-quality benchmarking (execution intelligence phase 3).

Turns pooled execution data into the one thing a trader cannot compute from
their own history: where they sit relative to everyone else trading the same
shape.

THE K-THRESHOLD IS A PRIVACY BOUNDARY, NOT A UX NICETY.

In trading data the valuable records are precisely the identifying ones — a
large fill on a thin pair is a rare group that survives aggregation and points
at one trader. If a cohort contains two participants, "the cohort median" is
effectively one person's fills shown to their competitor. Every cohort query
here therefore counts DISTINCT USERS and returns nothing below
``MIN_COHORT_USERS``. It is enforced here, in the query layer, so no caller —
API route, dashboard, or future export — can bypass it by forgetting to check.

Suppression is reported honestly (``suppressed: true``) rather than disguised
as "no data", so the caller can explain the gap instead of implying the user
has no peers.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import text

from database.db import get_session

logger = logging.getLogger(__name__)

# Minimum DISTINCT users in a cohort before any statistic is returned.
# Below this, an aggregate is a thin disguise over individual behaviour.
MIN_COHORT_USERS = 5

# How far back a cohort is drawn from.
DEFAULT_WINDOW_DAYS = 30

# Cap so one caller cannot request an unbounded scan.
MAX_WINDOW_DAYS = 180


def _pct_rank(value: float, population: list[float], higher_is_better: bool) -> float:
    """Percentile of `value` within `population`, 0–100."""
    if not population:
        return 50.0
    if higher_is_better:
        better_than = sum(1 for p in population if p < value)
    else:
        better_than = sum(1 for p in population if p > value)
    return round((better_than / len(population)) * 100, 1)


def _median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


class ExecutionBenchmark:
    """Cohort execution statistics with a hard k-anonymity floor."""

    def _cohort_rows(self, from_token: str, to_token: str, window_days: int) -> list[tuple]:
        """Every (user_id, bps) pair for one trade shape in the window.

        The ONLY place this join is issued. ``cohort_stats`` and
        ``user_percentile`` both derive from a single call's rows — an earlier
        attempt at this had ``user_percentile`` call ``cohort_stats`` and then
        re-fetch, which deduplicated the SQL text while still running the scan
        twice. Keep the fetch and the aggregate separable (see
        ``_stats_from_rows``) or that regression comes straight back.
        """
        cutoff = datetime.utcnow() - timedelta(days=window_days)
        with get_session() as session:
            return session.execute(
                text("""
                    SELECT s.user_id, m.realized_vs_quoted_bps
                    FROM swap_execution_marks m
                    JOIN swap_transactions s ON s.id = m.swap_id
                    WHERE m.horizon = '5m'
                      AND m.realized_vs_quoted_bps IS NOT NULL
                      AND s.from_token = :from_token
                      AND s.to_token = :to_token
                      AND m.scored_at >= :cutoff
                    """),
                {"from_token": from_token, "to_token": to_token, "cutoff": cutoff},
            ).fetchall()

    def cohort_stats(
        self,
        from_token: str,
        to_token: str,
        window_days: int = DEFAULT_WINDOW_DAYS,
    ) -> dict[str, Any]:
        """Aggregate quoted round-trip cost for one trade shape.

        NOTE the column ``realized_vs_quoted_bps`` queried below is misnamed —
        it holds quoted cost (spread + impact + fees), not fill accuracy. See
        ``execution_scorer``'s module docstring. So these percentiles rank how
        expensive a user's trades were to cross, NOT how well we executed them.

        Returns ``{"suppressed": True, ...}`` when the cohort is too small,
        never partial statistics.
        """
        window_days = max(1, min(window_days, MAX_WINDOW_DAYS))
        rows = self._cohort_rows(from_token, to_token, window_days)
        return self._stats_from_rows(rows, from_token, to_token, window_days)

    def _stats_from_rows(
        self, rows: list[tuple], from_token: str, to_token: str, window_days: int
    ) -> dict[str, Any]:
        """The aggregate, computed from rows already fetched.

        Pure — takes no session — so a caller holding the rows can reuse them
        instead of paying for the join again.
        """
        distinct_users = {r[0] for r in rows if r[0] is not None}

        # THE FLOOR. Below this a "cohort statistic" identifies individuals.
        if len(distinct_users) < MIN_COHORT_USERS:
            return {
                "suppressed": True,
                "reason": "cohort_too_small",
                "min_cohort_users": MIN_COHORT_USERS,
                "cohort_users": len(distinct_users),
                "window_days": window_days,
            }

        values = [float(r[1]) for r in rows]
        return {
            "suppressed": False,
            "from_token": from_token,
            "to_token": to_token,
            "window_days": window_days,
            "cohort_users": len(distinct_users),
            "sample_size": len(values),
            "median_bps": _median(values),
            "best_bps": max(values),
            "worst_bps": min(values),
        }

    def user_percentile(
        self,
        user_id: int,
        from_token: str,
        to_token: str,
        window_days: int = DEFAULT_WINDOW_DAYS,
    ) -> dict[str, Any]:
        """Where this user's execution sits within the cohort.

        Pairs every percentile with a concrete remedy — a benchmark that only
        says "you underperformed" gives the user a reason to leave and no way
        to act.
        """
        window_days = max(1, min(window_days, MAX_WINDOW_DAYS))

        # ONE fetch, feeding both the aggregate and the percentile population.
        # Calling cohort_stats() here instead would re-run this join.
        rows = self._cohort_rows(from_token, to_token, window_days)
        stats = self._stats_from_rows(rows, from_token, to_token, window_days)
        if stats.get("suppressed"):
            return stats

        cutoff = datetime.utcnow() - timedelta(days=window_days)
        population = [float(r[1]) for r in rows]

        with get_session() as session:
            mine = session.execute(
                text("""
                    SELECT m.realized_vs_quoted_bps
                    FROM swap_execution_marks m
                    JOIN swap_transactions s ON s.id = m.swap_id
                    WHERE m.horizon = '5m'
                      AND m.realized_vs_quoted_bps IS NOT NULL
                      AND s.user_id = :user_id
                      AND s.from_token = :from_token
                      AND s.to_token = :to_token
                      AND m.scored_at >= :cutoff
                    """),
                {
                    "user_id": user_id,
                    "from_token": from_token,
                    "to_token": to_token,
                    "cutoff": cutoff,
                },
            ).fetchall()

        my_values = [float(r[0]) for r in mine]
        if not my_values:
            return {
                "suppressed": False,
                "has_user_data": False,
                "cohort": stats,
            }

        my_median = _median(my_values)
        # Less value lost is better, so a higher (less negative) bps figure
        # ranks better.
        percentile = _pct_rank(my_median, population, higher_is_better=True)

        return {
            "suppressed": False,
            "has_user_data": True,
            "your_median_bps": my_median,
            "your_swaps": len(my_values),
            "percentile": percentile,
            "cohort": stats,
            "remedy": self._remedy(my_median, stats),
        }

    def _remedy(self, my_median: float, stats: dict) -> Optional[str]:
        """A concrete next action, or None when there is nothing to fix."""
        cohort_median = stats.get("median_bps")
        if cohort_median is None:
            return None

        gap = cohort_median - my_median
        # Under ~5bps is noise, not a finding worth acting on.
        if gap <= 5:
            return None
        return (
            f"You are losing about {gap:.0f} bps more than the median trader on "
            f"this pair. Try a smaller slippage tolerance, or split larger "
            f"orders — both usually recover most of that gap."
        )


execution_benchmark = ExecutionBenchmark()
