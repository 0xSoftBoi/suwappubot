"""What a route's own minimum-out costs it.

Every leg executes with a minimum-out at a fraction of the pool's fee; if the
rate moves past it before the transaction lands, the leg reverts and the route
with it.  So `P(lands) = product over legs of (1 - p_i)`.

**A revert does not cost the trade, and that sets the scale of the term.**  The
gas is spent and the user resubmits, so a failure costs one more transaction
plus whatever the price did -- around a basis point, not a hundred.  Ranking on
`output * P(lands)` prices it as losing the whole notional, wrong by three
orders of magnitude, and at measured 20-40% breach rates it pays 17-126 bp for
safety.  Instead:

    output * (1 - P(fails) * REVERT_COST_BP / 1e4) - gas * (1 + P(fails))

The gas term carries `(1 + P(fails))` because a failed attempt pays and the
retry pays again.

Only pool arcs carry risk -- a wrap, stake, lending mint or vault redemption is
priced by a rate that accrues slowly and not against us.  An unmeasured pool
takes `DEFAULT_RISK` rather than zero, so a thin unsampled pool cannot look
safer than a deep measured one.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from .types import ArcKind, Leg

#: Kinds whose output is not a market rate, so no bound of this sort binds.
RISKLESS: frozenset[ArcKind] = frozenset({
    ArcKind.WRAP_NATIVE,
    ArcKind.UNWRAP_NATIVE,
    ArcKind.WSTETH_WRAP,
    ArcKind.WSTETH_UNWRAP,
    ArcKind.STAKE_NATIVE,
    ArcKind.LEND_MINT,
    ArcKind.LEND_REDEEM,
    ArcKind.ERC4626_DEPOSIT,
    ArcKind.ERC4626_REDEEM,
})

#: What an arc nobody has measured is assumed to cost, as a probability.
#
# Small but not zero: zero would say "this pool provably never moves", which is
# the one thing a missing measurement cannot say, and would make an unprobed
# pool the cheapest thing in the graph.  The measured distribution is sharply
# bimodal -- nine arcs in ten at the 1e-5 floor, the rest from 1% to 50% -- so
# neither its median nor its upper decile stands in: one is indistinguishable
# from free, the other charges 120 bp for a gap in our own sampling.  0.2% is
# what an unknown arc must beat: about 20 bp, more than any tail-end routing
# gain and less than the cost of dropping a good pool.  `FactsCache.risk_table`
# raises it to the measured 75th percentile when that is higher.
DEFAULT_RISK = 0.002

#: What one failed attempt costs, as basis points of the trade.
#
# Gas, plus whatever the price did while the user resubmitted.  Set so that the
# most dangerous arc measured -- 39%, TricryptoUSDC's ETH side -- costs a route
# 0.4 bp.  Anything larger stops being a tie-break and starts buying worse
# prices.  Deliberately one number rather than a per-pair drift estimate: what
# varies between pairs is `p`, which is measured; resubmitting costs roughly
# the same trade either way.
REVERT_COST_BP = 1.0


class RiskTable:
    """Per-arc probability that a leg's minimum-out trips before inclusion.

    Keyed by direction, like `GasTable` and for the same reason: a pool's own
    pairs do not behave alike, and the minimum-out is written per leg, so
    pricing a pool by its worst pair would charge every route for the riskiest
    thing in it.

    Lookup walks from the specific to the general: this direction of this pool;
    then any direction of it, under `(-1, -1)`; then `default`.
    """

    __slots__ = ("arcs", "default")

    def __init__(self, arcs: Mapping[tuple[str, int, int], float] | None = None,
                 default: float = DEFAULT_RISK):
        self.arcs = {(str(a).lower(), int(i), int(j)): float(p)
                     for (a, i, j), p in (arcs or {}).items()}
        self.default = float(default)

    def of(self, kind: ArcKind, target: str = "", i: int = 0, j: int = 0) -> float:
        kind = ArcKind(kind)
        if kind in RISKLESS:
            return 0.0
        address = target.lower()
        got = None
        if kind.is_swap:
            # `(i, j)` means coin indices only on a swap.  A deposit or a
            # single-coin withdrawal numbers its legs differently, so it takes
            # the pool-level entry, which is the right granularity for it.
            got = self.arcs.get((address, int(i), int(j)))
        if got is None:
            got = self.arcs.get((address, -1, -1))
        return self.default if got is None else got

    def survival(self, legs: Iterable[Leg]) -> float:
        """P(every leg stays inside its bound).

        A pool touched twice counts twice: two legs are two separate
        minimum-outs, both of which have to hold.
        """
        product = 1.0
        for leg in legs:
            product *= 1.0 - self.of(leg.kind, leg.target, leg.i, leg.j)
        return product

    def __len__(self) -> int:
        return len(self.arcs)

    def __bool__(self) -> bool:
        return bool(self.arcs)


def expected_value(output: float, survival: float, *, gas_cost: float = 0.0,
                   revert_cost_bp: float = REVERT_COST_BP) -> float:
    """What this route is worth, netting the cost of it not landing.

    `output` and `gas_cost` are both in output-token units.  A failure costs
    `revert_cost_bp` of the trade plus one extra transaction -- not the trade.
    """
    failure = max(0.0, min(1.0, 1.0 - survival))
    return (output * (1.0 - failure * revert_cost_bp / 1e4)
            - gas_cost * (1.0 + failure))


#: No measurement anywhere: every pool arc is priced at the default.
STATIC = RiskTable()
