"""Per-swap execution receipt (execution intelligence phase 4).

WHY THIS EXISTS. Phases 2 and 3 built the measurement — ``execution_scorer``
records realized-vs-quoted and markout at fixed horizons, ``execution_benchmark``
turns pooled marks into k-anonymous cohort percentiles. Both have been running
in production against every completed swap. Neither was ever shown to the person
whose trade it was.

This module answers one question for one fill: *what actually happened to my
swap, and was that us or the market?* It composes the existing services rather
than recomputing anything.

THE SPLIT IS THE POINT, AND IT MUST SURVIVE INTO THE UI.

  * ``realized_vs_quoted_bps`` is OURS. Routing choice, slippage tolerance,
    bridge behaviour. A bad number here is a bug we own.
  * ``markout_bps`` is THE MARKET'S. The price moved after the fill; nobody
    routed that. A bad number here is a warning to give the user, not a defect.

Collapsing the two into one "execution score" would be the easy thing and the
wrong thing: it would let a routing regression hide behind a volatile week, and
it would blame us for adverse selection we did not cause.

HONESTY CONSTRAINTS (do not quietly relax these):

  1. The quoted baseline is snapshotted inside ``execute_swap()``, immediately
     before signing — NOT at the moment the user was shown a number. Any
     re-quote drift between those two points is invisible here, which means
     this receipt UNDER-reports our own slippage. Safe for reporting, not safe
     as the trigger for a payout. ``caveats`` says so on every receipt.
  2. Counterfactual route comparisons are modeled, never observed. No one can
     know what a route that did not execute would have realized.
  3. Cohort suppression is delegated to ``execution_benchmark``, whose query
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

_QUOTE_TIMING_CAVEAT = (
    "The quoted baseline is captured just before broadcast, not when you were "
    "first shown a price, so any re-quote in between is not counted here."
)
_COUNTERFACTUAL_CAVEAT = (
    "Alternative routes are modeled from their quotes — nobody can know what "
    "they would actually have filled at."
)


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
                "tx_hash": swap.tx_hash,
                "completed_at": (swap.completed_at.isoformat() if swap.completed_at else None),
            }

            marks = (
                session.query(SwapExecutionMark).filter(SwapExecutionMark.swap_id == swap_id).all()
            )
            by_horizon = {
                m.horizon: {
                    "horizon": m.horizon,
                    "realized_vs_quoted_bps": m.realized_vs_quoted_bps,
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

        # realized-vs-quoted is knowable the instant the swap completes, so the
        # earliest horizon carrying it is the authoritative value. Later
        # horizons re-record it only for self-containment.
        realized_bps = next(
            (
                m["realized_vs_quoted_bps"]
                for m in ordered_marks
                if m["realized_vs_quoted_bps"] is not None
            ),
            None,
        )

        receipt: dict[str, Any] = {
            **shape,
            "scored": bool(ordered_marks),
            "realized_vs_quoted_bps": realized_bps,
            "marks": ordered_marks,
            "counterfactual": self._counterfactual(routes),
            "caveats": [_QUOTE_TIMING_CAVEAT],
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

        receipt["verdict"] = self._verdict(realized_bps, ordered_marks)
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

    def _verdict(self, realized_bps: Optional[float], marks: list[dict]) -> dict[str, Any]:
        """Plain-English read, keeping our fault and the market's apart."""
        parts: dict[str, Any] = {"routing": None, "market": None}

        if realized_bps is None:
            parts["routing"] = (
                "Not scored yet — execution marks land a few minutes after a swap completes."
            )
        elif realized_bps >= NOISE_FLOOR_BPS:
            parts["routing"] = (
                f"You received about {realized_bps:.0f} bps MORE than the quote promised."
            )
        elif realized_bps <= -NOISE_FLOOR_BPS:
            parts["routing"] = (
                f"You received about {abs(realized_bps):.0f} bps less than the quote "
                f"promised. That gap is ours — routing, slippage tolerance, or bridge behaviour."
            )
        else:
            parts["routing"] = "The fill matched the quote, within measurement noise."

        # Markout reads from the longest horizon that has one — the short
        # horizons are too noisy to call adverse selection on.
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
