"""Activation funnel: signup -> wallet -> quote -> swap.

Answers the question no dashboard could: where do new users stop?

Context for the thresholds below. Benchmarks put B2B self-serve activation at
30-45%, and treat anything under 20% as severe friction. This product currently
sits at 0% on the final stage, so the value here is not the percentage — it is
locating the exact step where people stop.

DELIBERATE GAP: there is no "funded" stage. Nothing persists a balance —
custodial_balances, custodial_transactions and x402_payments are all empty, and
balances are fetched live from chain and never written down. Reporting a funded
count today would mean inventing one. The stage is named in FUNNEL_GAPS instead
so the hole is visible rather than silently absent.
"""

import logging
from typing import Any, Optional

from sqlalchemy import text

from database.db import get_session

logger = logging.getLogger(__name__)

# Stages, in order. Each is a COUNT DISTINCT of users reaching that step.
_STAGES = (
    ("signed_up", "SELECT COUNT(*) FROM users"),
    ("has_wallet", "SELECT COUNT(DISTINCT user_id) FROM wallets"),
    (
        "requested_quote",
        "SELECT COUNT(DISTINCT user_id) FROM swap_route_candidates " "WHERE user_id IS NOT NULL",
    ),
    ("completed_swap", "SELECT COUNT(DISTINCT user_id) FROM swap_transactions"),
)

# Stages we cannot measure, and why. Surfaced in the payload so a zero is never
# mistaken for "nobody funded" when it actually means "we do not record it".
FUNNEL_GAPS = {
    "funded": (
        "Not instrumented. No table persists a wallet balance or deposit; "
        "balances are read live from chain. A funded count would be invented."
    ),
}


class ActivationFunnel:
    """Counts distinct users reaching each activation stage."""

    def compute(self) -> dict[str, Any]:
        stages: list[dict[str, Any]] = []
        total: Optional[int] = None

        with get_session() as session:
            for name, sql in _STAGES:
                try:
                    count = session.execute(text(sql)).scalar() or 0
                except Exception as e:  # a missing table must not 500 the endpoint
                    logger.warning(f"[activation_funnel] stage {name} failed: {e}")
                    stages.append({"stage": name, "users": None, "error": str(e)[:120]})
                    continue

                if total is None:
                    total = count

                prev = next(
                    (s["users"] for s in reversed(stages) if s.get("users") is not None),
                    None,
                )
                stages.append(
                    {
                        "stage": name,
                        "users": count,
                        # Share of ALL signups — the number that matters for
                        # activation.
                        "pct_of_signups": round(count / total * 100, 1) if total else 0.0,
                        # Share of the previous stage — this is what localises
                        # the drop-off. A stage at 90% of signups but 20% of the
                        # step before it is where people are actually stopping.
                        "pct_of_previous": (round(count / prev * 100, 1) if prev else None),
                    }
                )

        biggest_drop = None
        measured = [s for s in stages if s.get("pct_of_previous") is not None]
        if measured:
            worst = min(measured, key=lambda s: s["pct_of_previous"])
            biggest_drop = {"stage": worst["stage"], "retained_pct": worst["pct_of_previous"]}

        return {
            "stages": stages,
            "biggest_drop": biggest_drop,
            "not_instrumented": FUNNEL_GAPS,
        }


activation_funnel = ActivationFunnel()
