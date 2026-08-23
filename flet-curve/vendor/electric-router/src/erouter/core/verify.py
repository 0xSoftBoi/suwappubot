"""On-chain verification of candidates (spec §7).

The model is used for combinatorics and the chain for arithmetic.  Every
candidate goes out in **one** `quote_routes` call at the pinned block, because
chained `get_dy` cannot be batched any other way.

Four rules from §7, all load-bearing here:

1. *Net shared pools before quoting.*  Enforced upstream by the edge-flow
   formulation, and asserted here: a candidate touching a pool twice is rejected
   rather than quoted, because a view-only call cannot see its own earlier leg.
2. *Pin the block.*  All candidates share one `Transport`, hence one block.
3. *Quote at the real size.*  The legs carry the amounts the model chose.
4. *Treat a failed quote as arc removal.*  A zero comes back as `reverted` and
   the candidate is dropped, never as an error.

What this catches that no amount of modelling will: paused pools, reentrancy
locks, fee-on-transfer tokens, stale indexer state -- and the difference between
a fitted reference price and the real curve.
"""

from __future__ import annotations

import numpy as np

from .candidates import Candidate, CandidateSet
from .gas import GasTable, leg_gas, plan_gas, shape_cost, value_per_gas
from .nodes import NodeMap
from .quoter import MAX_LEGS, MAX_SLOTS, QuoterClient
from .realize import RealizationError, check_one_arc_per_pool, realize
from .risk import REVERT_COST_BP, RiskTable, expected_value
from .types import ArcKind, PoolArc

# What counts as "the same answer".  `score` nets gas off every candidate before
# ranking, so the only thing left for a tolerance to absorb is noise in the
# quotes themselves -- integer rounding, around 1e-12 relative.  A flat 5e-6 was
# instead absorbing a whole basis point of real difference at low gas: measured
# on WETH->stETH 100 at 0.049 gwei, a 4-leg route lost to a 2-leg one over
# 0.0415 bp, while the two extra legs cost thirty times less than the gain thrown
# away.  So the tolerance is what one more leg actually costs, in output units,
# and nothing more; the floor keeps a tie from turning on the last bit.
TIE_FLOOR = 1e-12

#: Fraction of the trade re-quoted to find what the same route would have paid
#: if the trade had been small.
#
# Every leg's share is a fraction of its slot's balance, so scaling the input
# scales every branch with it: the shape of the route is held fixed and only the
# size changes, which is exactly the comparison price impact is supposed to make.
# 5% is small enough that its own impact is a rounding error against the full
# trade's, and large enough to stay clear of integer dust on a 6-decimal token.
IMPACT_FRACTION = 0.05

#: What one leg is charged beyond its gas, in basis points of the trade.
#
# Gas is a real per-leg price and at any ordinary gas price it decides this on
# its own: measured on USDC->WETH $10k, the winner is 9 legs at 0.045 gwei, 3 at
# 5 gwei and 1 at 30.  This term is for the case gas stops arbitrating, where the
# relaxation will take a long tail of branches for a fraction of a basis point
# each.  Whatever is charged has to leave alone the cases where the legs earn
# their keep -- at $100k, 6 legs to 12 buys 60 bp.
#
# The value is the measured knee, swept at 0.045 gwei
# (`scripts/leg_cost_frontier.py`) as legs taken and basis points given up
# against charging nothing:
#
#     case                     0.0      0.02      0.05       0.1       0.2
#     USDC->WETH  10k     31L +0.00 10L +0.62 10L +0.62 10L +0.62  9L +0.88
#     USDC->WETH 100k     12L +0.00 12L +0.00 12L +0.00 12L +0.00 12L +0.00
#     USDC->WETH   1M     12L +0.00 12L +0.00 12L +0.00 12L +0.00 12L +0.00
#     USDC->USDT   1M      4L +0.00  2L +0.00  2L +0.00  2L +0.00  1L +0.11
#     USDC->USDT  20M      4L +0.00  4L +0.00  2L +0.20  1L +0.34  1L +0.34
#     crvUSD->WETH 1M     11L +0.00 11L +0.00 11L +0.00 11L +0.00 11L +0.00
#
# 0.02 takes 21 legs off the $10k trade for 0.62 bp and halves USDC->USDT $1M for
# nothing, while costing zero where the legs are earning their keep.  Above 0.1
# it starts buying simplicity with real money.
#
# Proportional rather than absolute, which is the right shape: what avoiding a
# leg is worth scales with the trade, and so does what the leg earns, so the
# charge stays self-limiting.
LEG_COST_BP = 0.02


def realize_candidates(
    candidates: CandidateSet,
    arcs: list[PoolArc],
    nu: np.ndarray,
    nodes: NodeMap,
    *,
    src_token: str,
    dst_token: str,
    amount_in: int,
    potentials: np.ndarray | None = None,
    max_legs: int = MAX_LEGS,
) -> None:
    """Turn each candidate's flow into legs, marking the ones that cannot be.

    `max_legs` defaults to the quoter's ABI capacity, which is what *we* can price
    -- not what anything can execute.  A deployed router has its own, much
    tighter, limit.  Until this router emits calldata there is nothing to violate,
    so the default stays permissive and the knob exists for whoever has an
    executor to satisfy.
    """
    for candidate in candidates.candidates:
        active = np.flatnonzero(candidate.psi > 0)
        if active.size == 0:
            candidate.status = "empty"
            continue
        try:
            route = realize(
                [arcs[int(k)] for k in active],
                candidate.psi[active],
                nu,
                nodes,
                src_token=src_token,
                dst_token=dst_token,
                amount_in=amount_in,
                potentials=potentials,
            )
        except RealizationError as exc:
            candidate.status = "infeasible"
            candidate.note = str(exc)
            continue

        conflicts = check_one_arc_per_pool(route)
        if conflicts:
            candidate.status = "conflict"
            candidate.note = f"{len(conflicts)} pool(s) used twice"
            continue
        if len(route.slots) > MAX_SLOTS:
            candidate.status = "too_wide"
            candidate.note = f"{len(route.slots)} tokens > quoter limit {MAX_SLOTS}"
            continue
        if len(route.legs) > max_legs:
            candidate.status = "too_long"
            candidate.note = f"{len(route.legs)} legs > limit {max_legs}"
            continue
        candidate.route = route
        candidate.status = "ready"


def verify(
    candidates: CandidateSet,
    client: QuoterClient,
    *,
    amount_in: int,
    gas_price_wei: int = 0,
    dst_wei_per_eth: float = 0.0,
    gas_table: GasTable | None = None,
    risk_table: RiskTable | None = None,
    revert_cost_bp: float = REVERT_COST_BP,
    leg_cost_bp: float = LEG_COST_BP,
) -> CandidateSet:
    """Quote every ready candidate in one call and rank them.

    Ranking is by verified output net of what the route costs to attempt: gas,
    plus the chance one of its minimum-outs trips first, charged at what a
    resubmission is worth rather than at the trade.  Both corrections need the
    caller to have supplied the means to value them in the output token;
    neither is an element law and neither may enter the convex core (§11.1).
    """
    # Quote whatever is new.  Ranking happens unconditionally below: this is
    # called more than once per route (candidates, then the direct floor, then the
    # refit), and returning early when nothing needs quoting used to leave ranks
    # stale from an earlier call.  The winner is chosen by rank, so a stale rank
    # silently picks the wrong route.
    ready = [c for c in candidates.candidates if c.status == "ready" and c.route]
    if ready:
        outs = client.quote_routes(
            [c.route.wire_legs for c in ready],
            [amount_in] * len(ready),
            [c.route.dst_slot for c in ready],
        )
        for candidate, value in zip(ready, outs, strict=True):
            if value <= 0:
                candidate.status = "reverted"
                candidate.note = candidate.note or "quoter returned 0"
                continue
            candidate.verified_out = int(value)
            candidate.status = "ok"

    def score(candidate: Candidate) -> float:
        value = float(candidate.verified_out or 0)
        gas_cost = 0.0
        if candidate.route:
            legs = [leg.leg for leg in candidate.route.legs]
            candidate.gas = plan_gas(legs, gas_table)
            # The greater of the two shape charges, never their sum -- see
            # `gas.shape_cost`.
            gas_cost = shape_cost(
                legs, [leg.is_conversion for leg in candidate.route.legs],
                value=value, leg_cost_bp=leg_cost_bp,
                per_gas=value_per_gas(gas_price_wei, dst_wei_per_eth),
                table=gas_table)
        if risk_table is None or not candidate.route:
            return value - gas_cost
        # Every leg carries a minimum-out at a fraction of its pool's fee, so the
        # route lands only if none of those pools moves past its own bound while
        # the user is confirming.  `survival` is the chance of that; the cost of
        # the other case is one more transaction and a basis point of price
        # movement, not the trade.  See `core/risk.py`.
        candidate.survival = risk_table.survival(
            leg.leg for leg in candidate.route.legs)
        return expected_value(value, candidate.survival, gas_cost=gas_cost,
                              revert_cost_bp=revert_cost_bp)

    def legs(candidate: Candidate) -> int:
        return len(candidate.route.legs) if candidate.route else 1_000

    # Prefer the simpler route when the outputs are indistinguishable.  Measured
    # on stablecoin pairs, the relaxation happily takes a 25-leg route to gain
    # 0.02 bp over a 1-leg one, and §11.1 is explicit that a fixed per-arc cost
    # belongs in candidate selection rather than in the convex core.  Quantising
    # the score is how a tie becomes visible to the sort at all.
    for candidate in candidates.candidates:
        if not candidate.ok:
            candidate.rank = None  # a stale rank must never survive a re-verify

    usable = [c for c in candidates.candidates if c.ok]
    if not usable:
        return candidates
    best_score = max(score(c) for c in usable)
    # What one more leg has to earn to be worth taking.  Both of its costs are
    # already inside `score` -- gas subtracted, revert risk multiplied in -- so
    # what is left for a tolerance to absorb is one leg's gas.
    #
    # An earlier version added a `min_gain_bp` term here, standing in for the risk
    # of the price moving before inclusion.  Something models that now, and per
    # pool rather than per route: a threshold on the gain could only ever say
    # "long routes are suspect", where the survival product says which pools are
    # dangerous and leaves the rest alone.
    per_leg = leg_gas(ArcKind.SWAP_STABLE) * gas_price_wei / 1e18 * dst_wei_per_eth
    tolerance = max(per_leg, abs(best_score) * TIE_FLOOR)

    def rank_key(candidate: Candidate) -> tuple:
        value = score(candidate)
        bucket = 0 if best_score - value <= tolerance else 1
        return (bucket, legs(candidate) if bucket == 0 else 0, -value)

    ranked = sorted(usable, key=rank_key)

    # Hard floor: never rank below a plain one-hop swap.  The tie-break should
    # already give this -- a direct candidate has one leg, so it wins any tie --
    # but "the router is never worse than a pool you could find by inspection" is
    # a promise, not an emergent property.
    #
    # Compared on `score`, not on the raw quote, so the floor speaks the same
    # language as the ranking: a single hop through a pool that breaches a quarter
    # of the time can quote the largest number on the page and still be the worse
    # trade.
    floor = max(
        (c for c in usable if c.kind == "direct"), key=score, default=None,
    )
    if floor is not None and ranked and score(ranked[0]) < score(floor):
        ranked.remove(floor)
        ranked.insert(0, floor)

    for position, candidate in enumerate(ranked, start=1):
        candidate.rank = position
    return candidates


def summary(candidates: CandidateSet, decimals: int, limit: int = 12) -> list[dict]:
    """Rows for the terminal and the JSON, best first, failures last."""
    def sort_key(candidate: Candidate):
        return (candidate.rank if candidate.rank else 10_000, candidate.label)

    rows = []
    best = candidates.best
    reference = float(best.verified_out) if best and best.verified_out else 0.0
    for candidate in sorted(candidates.candidates, key=sort_key)[:limit]:
        delta = None
        if candidate.verified_out and reference:
            delta = (candidate.verified_out / reference - 1.0) * 10_000
        rows.append(
            {
                "label": candidate.label,
                "kind": candidate.kind,
                "rank": candidate.rank,
                "status": candidate.status,
                "arcs": candidate.n_arcs,
                "legs": len(candidate.route.legs) if candidate.route else 0,
                "verified_out": (
                    None if candidate.verified_out is None else str(candidate.verified_out)
                ),
                "out": (
                    ""
                    if candidate.verified_out is None
                    else f"{candidate.verified_out / 10**decimals:,.6f}"
                ),
                "delta_bp": None if delta is None else round(delta, 2),
                "survival": round(candidate.survival, 6),
                "note": candidate.note,
                "certificate": candidate.certificate,
            }
        )
    return rows


def price_impact(
    client: QuoterClient,
    route,
    *,
    amount_in: int,
    verified_out: int,
    fraction: float = IMPACT_FRACTION,
) -> tuple[float, int, int] | None:
    """How much worse this trade's price is than a small one down the same route.

    Price is input over output, as the trader pays it, and the impact is the
    difference between the price at full size and at `fraction` of it:

        impact = price(full) / price(small) - 1

    Returns `(impact_bp, reference_in, reference_out)`, or `None` when there is
    nothing to compare -- a size that rounds to zero, or a quote that reverts at
    the smaller size, which happens on legs whose pool has a minimum.

    One extra `quote_routes` call, at the same block, on the route already chosen.

    **What this is not.**  The reference trade has its own impact, so this
    understates the true spot-relative figure by roughly `fraction` of it -- about
    5%, in the same direction for every route, and not corrected for here because
    correcting would mean assuming a shape for the impact curve.
    """
    reference_in = int(amount_in * fraction)
    if reference_in <= 0 or amount_in <= 0 or verified_out <= 0:
        return None
    quoted = client.quote_routes(
        [route.wire_legs], [reference_in], [route.dst_slot]
    )
    reference_out = int(quoted[0]) if quoted else 0
    if reference_out <= 0:
        return None
    rate_small = reference_out / reference_in
    rate_full = verified_out / amount_in
    if rate_small <= 0 or rate_full <= 0:
        return None
    return (rate_small / rate_full - 1.0) * 1e4, reference_in, reference_out
