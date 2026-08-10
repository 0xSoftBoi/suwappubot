"""Per-swap execution receipt (execution intelligence phase 4).

WHY THIS EXISTS. Phases 2 and 3 built the measurement — ``execution_scorer``
writes marks for every completed swap, ``execution_benchmark`` turns pooled
marks into k-anonymous cohort percentiles. Both have been running in
production. Neither was ever shown to the person whose trade it was.

READ THIS BEFORE CHANGING ANY LABEL IN HERE.

The column ``swap_execution_marks.realized_vs_quoted_bps`` does NOT contain
what its name says. The scorer computes it as::

    _bps(swap.to_amount_usd, swap.from_amount_usd)

and BOTH sides are written once, in ``execute_swap()``, from the *quote's*
expected amounts (``swap_engine.py:3803-3806``). Nothing anywhere updates
``to_amount_usd`` with the amount actually received — grep it. So the figure
carries no realized fill data at all. What it actually measures is the
**quoted round-trip cost** of the trade: DEX spread + price impact + our own
platform fee + priced-in bridge fees, as quoted.

That distinction is not pedantic. Our FREE-tier fee alone is 100 bps, so this
number is large and negative on almost every swap. Rendering it as "you
received less than the quote promised — that gap is ours" would tell users we
botched their fill when what they are looking at is mostly the spread and the
fee they already agreed to. This module therefore surfaces it as
``quoted_cost_bps`` and says what it is.

Fill accuracy IS now measurable — but only where a provider reports a settled
amount. ``swap_transactions.realized_to_amount`` is populated from the Li.Fi
status receive leg; every other path still leaves it NULL. So
``fill_vs_quote_bps`` appears on some receipts and not others, and its absence
means "not observed", never "no shortfall". Coverage has to widen before any
payout can key off it.

WHAT IS HONEST HERE:

  * ``fill_vs_quote_bps`` — the real one. Realized output vs quoted output, in
    smallest token units so no price move can contaminate it. Present only
    where a settled amount was observed.
  * ``quoted_cost_bps`` — the cost of crossing this trade, as quoted. Real,
    just not a measure of fill accuracy.
  * ``markout_bps`` — genuinely post-trade. The scorer compares live observed
    prices at later horizons against the earliest mark, so this really does
    measure how the fill aged. Attributable to the market, not to routing.

Keeping those two apart is the point. One is what the trade cost you; the
other is what the market did afterwards.

OTHER HONESTY CONSTRAINTS (do not quietly relax these):

  1. Counterfactual route comparisons are modeled, never observed. No one can
     know what a route that did not execute would have realized.
  2. Cohort suppression is delegated to ``execution_benchmark``, whose query
     layer enforces the k-anonymity floor. This module never queries cohort
     rows itself, so it cannot bypass that floor by forgetting to check.

OWNERSHIP. ``build`` is scoped by ``user_id`` in the WHERE clause, not filtered
after the fetch — a receipt for someone else's swap must be indistinguishable
from a swap that does not exist.
"""

import logging
from typing import Any, Optional

from bot.models.swap import SwapTransaction, SwapExecutionMark, SwapRouteCandidate
from bot.services.execution_benchmark import execution_benchmark
from database.db import get_session

logger = logging.getLogger(__name__)

# Order marks are presented in, regardless of insert order.
HORIZON_ORDER = ["5m", "1h", "24h"]

# Below this magnitude a bps figure is measurement noise, not a finding.
# Used only for the plain-English verdict; raw numbers are always returned.
NOISE_FLOOR_BPS = 5.0

_COST_BASIS_CAVEAT = (
    "This is the cost of the trade as quoted — spread, price impact and fees. "
    "It is not a measure of whether the fill matched the quote: the amount "
    "actually received is not yet recorded, so that cannot be measured today."
)
_COUNTERFACTUAL_CAVEAT = (
    "Alternative routes are modeled from their quotes — nobody can know what "
    "they would actually have filled at."
)


def _fill_vs_quote_bps(quoted: Optional[str], realized: Optional[str]) -> Optional[float]:
    """True fill accuracy in bps, or None when it was not observed.

    Compares SMALLEST-UNIT TOKEN AMOUNTS, not USD. Both figures are the same
    token, so the ratio is immune to any price move between quote and
    settlement — a USD comparison would silently fold market drift into a
    number we present as our own execution quality.

    Returns None on absent or unparseable input. A swap where nothing settled
    must read as "not observed", never as a 100% shortfall.
    """
    if not quoted or not realized:
        return None
    try:
        q = int(quoted)
        r = int(realized)
    except (TypeError, ValueError):
        return None
    if q <= 0:
        return None
    return ((r - q) / q) * 10_000


class ExecutionReceipt:
    """Builds the per-fill receipt from already-recorded marks."""

    def build(self, user_id: int, swap_id: int) -> Optional[dict[str, Any]]:
        """Receipt for one swap, or None when it is not this user's swap.

        Returning None for both "missing" and "not yours" is deliberate: a
        distinguishable response would let a caller enumerate other people's
        swap ids.
        """
        with get_session() as session:
            swap = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.id == swap_id,
                    SwapTransaction.user_id == user_id,
                )
                .first()
            )
            if not swap:
                return None

            # Pull everything needed off the ORM objects before the session
            # closes — these are plain values, no lazy loads escape.
            shape = {
                "swap_id": swap.id,
                "status": swap.status,
                "from_token": swap.from_token,
                "to_token": swap.to_token,
                "from_chain": swap.from_chain,
                "to_chain": swap.to_chain,
                "from_amount_usd": swap.from_amount_usd,
                "to_amount_usd": swap.to_amount_usd,
                "quoted_to_amount": swap.to_amount,
                "realized_to_amount": swap.realized_to_amount,
                "tx_hash": swap.tx_hash,
                "completed_at": (swap.completed_at.isoformat() if swap.completed_at else None),
            }

            marks = (
                session.query(SwapExecutionMark).filter(SwapExecutionMark.swap_id == swap_id).all()
            )
            by_horizon = {
                m.horizon: {
                    "horizon": m.horizon,
                    # Renamed on the way out: the column name overclaims.
                    "quoted_cost_bps": m.realized_vs_quoted_bps,
                    "markout_bps": m.markout_bps,
                    "to_token_price_usd": m.to_token_price_usd,
                    "fill_price_usd": m.fill_price_usd,
                    "scored_at": m.scored_at.isoformat() if m.scored_at else None,
                }
                for m in marks
            }

            candidates = (
                session.query(SwapRouteCandidate)
                .filter(SwapRouteCandidate.swap_id == swap_id)
                .all()
            )
            routes = [
                {
                    "provider": c.provider,
                    "tool": c.tool,
                    "quoted_to_amount_usd": c.quoted_to_amount_usd,
                    "was_selected": c.was_selected,
                }
                for c in candidates
            ]

        ordered_marks = [by_horizon[h] for h in HORIZON_ORDER if h in by_horizon]

        # The cost figure is fixed at completion, so the earliest horizon
        # carrying it is authoritative; later horizons re-record it only for
        # self-containment. (Column name is historical — see module docstring.)
        cost_bps = next(
            (m["quoted_cost_bps"] for m in ordered_marks if m["quoted_cost_bps"] is not None),
            None,
        )

        fill_bps = _fill_vs_quote_bps(shape["quoted_to_amount"], shape["realized_to_amount"])

        receipt: dict[str, Any] = {
            **shape,
            "scored": bool(ordered_marks),
            "quoted_cost_bps": cost_bps,
            # The real thing, when the provider reported a settled amount.
            # None means not observed — never render it as 0.
            "fill_vs_quote_bps": fill_bps,
            "marks": ordered_marks,
            "counterfactual": self._counterfactual(routes),
            "caveats": [_COST_BASIS_CAVEAT],
        }
        if receipt["counterfactual"]:
            receipt["caveats"].append(_COUNTERFACTUAL_CAVEAT)

        # Cohort percentile — suppression is enforced inside the benchmark.
        try:
            receipt["benchmark"] = execution_benchmark.user_percentile(
                user_id=user_id,
                from_token=shape["from_token"],
                to_token=shape["to_token"],
            )
        except Exception as e:
            # A receipt is still useful without a percentile; never fail the
            # whole response because the cohort query had a bad day.
            logger.warning(f"[execution_receipt] benchmark failed for swap {swap_id}: {e}")
            receipt["benchmark"] = None

        receipt["verdict"] = self._verdict(cost_bps, ordered_marks, fill_bps)
        return receipt

    def _counterfactual(self, routes: list[dict]) -> Optional[dict[str, Any]]:
        """Best rejected alternative, when the quotes support the comparison.

        MODELED, never observed — see the module docstring. Returns None rather
        than a misleading zero when there is nothing to compare.
        """
        selected = next((r for r in routes if r["was_selected"]), None)
        rejected = [
            r for r in routes if not r["was_selected"] and r["quoted_to_amount_usd"] is not None
        ]
        if not selected or not rejected or selected["quoted_to_amount_usd"] is None:
            return None

        best = max(rejected, key=lambda r: r["quoted_to_amount_usd"])
        delta_usd = best["quoted_to_amount_usd"] - selected["quoted_to_amount_usd"]
        return {
            "routes_considered": len(routes),
            "selected_provider": selected["provider"],
            "selected_quoted_usd": selected["quoted_to_amount_usd"],
            "best_alternative_provider": best["provider"],
            "best_alternative_quoted_usd": best["quoted_to_amount_usd"],
            # Positive means an alternative quoted better than what we took.
            "delta_usd": round(delta_usd, 4),
            "modeled": True,
        }

    def _verdict(
        self,
        cost_bps: Optional[float],
        marks: list[dict],
        fill_bps: Optional[float] = None,
    ) -> dict[str, Any]:
        """Plain-English read, keeping trade cost and market drift apart.

        The ``cost`` line deliberately does not assign blame. Until realized
        fill amounts are recorded there is no way to tell a wide spread from a
        bad route, and guessing would put words in the data's mouth.
        """
        parts: dict[str, Any] = {"cost": None, "market": None, "fill": None}

        # The only line on this receipt that grades US, and it only appears
        # when a settled amount was actually observed. Silence beats a
        # confident number derived from the quote's own estimate.
        if fill_bps is not None:
            if fill_bps <= -NOISE_FLOOR_BPS:
                parts["fill"] = (
                    f"You received about {abs(fill_bps):.0f} bps less than the quote "
                    f"promised. That shortfall is ours."
                )
            elif fill_bps >= NOISE_FLOOR_BPS:
                parts["fill"] = (
                    f"You received about {fill_bps:.0f} bps more than the quote promised."
                )
            else:
                parts["fill"] = "The amount received matched the quote."

        if cost_bps is None:
            parts["cost"] = "Not scored yet — marks land a few minutes after a swap completes."
        elif cost_bps <= -NOISE_FLOOR_BPS:
            parts["cost"] = (
                f"This trade cost about {abs(cost_bps):.0f} bps to cross, as quoted — "
                f"spread, price impact and fees combined."
            )
        elif cost_bps >= NOISE_FLOOR_BPS:
            parts["cost"] = (
                f"The quote had you coming out about {cost_bps:.0f} bps ahead on " f"USD value."
            )
        else:
            parts["cost"] = "The quote was close to flat on USD value."

        # Markout reads from the longest horizon that has one — short horizons
        # are too noisy to call drift on. This one IS post-trade observation.
        aged = [m for m in marks if m["markout_bps"] is not None]
        if aged:
            last = aged[-1]
            mb = last["markout_bps"]
            if mb >= NOISE_FLOOR_BPS:
                parts["market"] = (
                    f"Over the following {last['horizon']} the price moved in your favour "
                    f"by about {mb:.0f} bps. Good timing — not something we routed."
                )
            elif mb <= -NOISE_FLOOR_BPS:
                parts["market"] = (
                    f"Over the following {last['horizon']} the price moved against you by "
                    f"about {abs(mb):.0f} bps. That is the market, not the route."
                )
            else:
                parts["market"] = f"The price barely moved over the following {last['horizon']}."
        return parts


execution_receipt = ExecutionReceipt()
