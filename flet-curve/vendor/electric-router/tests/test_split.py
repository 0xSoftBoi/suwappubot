"""Split-ratio optimisation against the quoter (§7) -- no chain.

The quoter is stubbed with a concave payoff whose optimum is known in closed
form, so these check the optimiser actually climbs rather than merely runs.
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pytest

from erouter.core.split import (
    BPS,
    apply_weights,
    optimise,
    scout,
    should_optimise,
    split_groups,
    weights_of,
)
from erouter.core.types import ArcKind, Leg

POOL_A = "0x" + "a1" * 20
POOL_B = "0x" + "b2" * 20
POOL_C = "0x" + "c3" * 20


def leg(src: int, dst: int, bps: int, target: str = POOL_A) -> Leg:
    return Leg(target=target, kind=ArcKind.SWAP_STABLE, i=0, j=1, n=2,
               src_slot=src, dst_slot=dst, bps=bps)


# Two branches out of slot 0, then a single leg out of slot 1.
SPLIT = [leg(0, 1, 6000, POOL_A), leg(0, 2, 0, POOL_B), leg(1, 2, 0, POOL_C)]


class ConcaveQuoter:
    """`out = sum_k (x_k - x_k^2 / (2 K_k))`, maximised by equal marginals.

    Depth differs per branch, so the optimum is *not* the even split -- an
    optimiser that merely jitters symmetrically would not find it.
    """

    def __init__(self, depth: tuple[float, ...] = (4e6, 1e6)) -> None:
        self.depth = depth
        self.calls = 0

    def payoff(self, shares: list[float], amount: int) -> int:
        total = 0.0
        for share, k in zip(shares, self.depth, strict=True):
            x = share * amount
            total += x - x * x / (2 * k)
        return int(max(total, 0.0))

    def quote_routes(self, routes, amounts_in, dst_slots):
        self.calls += 1
        out = []
        for legs, amount in zip(routes, amounts_in, strict=True):
            head = legs[0].bps / BPS
            out.append(self.payoff([head, 1.0 - head], amount))
        return out


# Three branches out of one slot, depths four decades apart, starting at an
# even split.  The optimum sits in a narrow valley the gradient points along
# only loosely, so one line search cannot reach it.
SPLIT3 = [leg(0, 1, 3300, POOL_A), leg(0, 1, 3300, POOL_B), leg(0, 1, 0, POOL_C)]


class ValleyQuoter(ConcaveQuoter):
    """The same payoff over a whole group, not just its head."""

    def __init__(self) -> None:
        super().__init__(depth=(1e9, 1e7, 1e5))

    def quote_routes(self, routes, amounts_in, dst_slots):
        self.calls += 1
        out = []
        for legs, amount in zip(routes, amounts_in, strict=True):
            shares = [leg.bps / BPS for leg in legs]
            shares[-1] = max(0.0, 1.0 - sum(shares[:-1]))
            out.append(self.payoff(shares, amount))
        return out


def best_share(depth: tuple[float, float], amount: int) -> float:
    """Equal-marginal split: 1 - x/Ka = 1 - y/Kb with x + y = amount."""
    ka, kb = depth
    return (ka / (ka + kb))


def test_split_groups_finds_contiguous_runs_that_actually_split():
    assert split_groups(SPLIT) == [[0, 1]]
    assert split_groups([leg(0, 1, 0)]) == []
    assert split_groups([]) == []


def test_a_slot_drained_by_two_separate_runs_is_two_groups():
    """Grouping must follow the quoter's rule -- contiguity, not slot identity."""
    legs = [leg(0, 1, 5000), leg(0, 2, 0), leg(1, 3, 0), leg(0, 4, 3000), leg(0, 5, 0)]
    assert split_groups(legs) == [[0, 1], [3, 4]]


def test_weights_round_trip_through_bps():
    groups = split_groups(SPLIT)
    w = weights_of(SPLIT, groups)
    assert len(w) == 1
    assert w[0] == pytest.approx([0.6, 0.4], abs=1e-9)
    back = apply_weights(SPLIT, groups, w)
    assert back[0].bps == 6000
    assert back[1].bps == 0, "the last leg of a group must sweep"


def test_apply_weights_never_starves_the_sweep():
    """A group whose head takes everything would leave the sweep a no-op leg."""
    groups = split_groups(SPLIT)
    out = apply_weights(SPLIT, groups, [np.array([0.999999, 1e-9])])
    assert out[0].bps <= BPS - 1
    assert out[1].bps == 0
    assert out[0].bps >= 1


def test_the_gate_skips_a_route_with_nothing_to_split():
    assert should_optimise([leg(0, 1, 0)], [0.9], modelled_out=100, verified_out=50) == ""


def test_the_gate_fires_on_a_deep_leg():
    assert "theta" in should_optimise(SPLIT, [0.02, 0.44])


def test_the_gate_fires_when_the_model_already_disagrees():
    """Shallow legs, but the route as a whole missed -- theta alone misses this."""
    reason = should_optimise(SPLIT, [0.01], modelled_out=1_000_000, verified_out=999_000)
    assert "model off by" in reason


def test_the_gate_stays_quiet_when_the_model_was_right_and_legs_are_small():
    assert should_optimise(SPLIT, [0.01], modelled_out=1_000_000, verified_out=999_999) == ""


def test_it_climbs_towards_the_equal_marginal_split():
    amount = 1_000_000
    quoter = ConcaveQuoter()
    tuned, report = optimise(SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=0)
    assert report.improved
    assert report.after > report.before
    # The analytic optimum puts 80% through the deeper branch; the model's
    # starting guess was 60%.
    got = tuned[0].bps / BPS
    assert abs(got - best_share(quoter.depth, amount)) < 0.05, got


def test_it_never_returns_something_worse():
    """The whole safety argument: only a strict improvement is accepted."""
    quoter = ConcaveQuoter()
    baseline = quoter.quote_routes([SPLIT], [1_000_000], [2])[0]
    _tuned, report = optimise(SPLIT, quoter, amount_in=1_000_000, dst_slot=2,
                              baseline=baseline)
    assert report.after >= report.before


def test_it_leaves_an_unsplittable_route_alone_and_spends_nothing():
    quoter = ConcaveQuoter()
    legs = [leg(0, 1, 0)]
    tuned, report = optimise(legs, quoter, amount_in=1000, dst_slot=1, baseline=99)
    assert tuned == legs
    assert report.calls == 0
    assert quoter.calls == 0
    assert report.skipped


def test_it_stays_within_its_round_trip_budget():
    quoter = ConcaveQuoter()
    _tuned, report = optimise(SPLIT, quoter, amount_in=1_000_000, dst_slot=2,
                              baseline=0, max_rounds=2, hot_rounds=3)
    assert report.rounds <= 3
    # One baseline quote, then at most two batches per round.
    assert report.calls <= 1 + 2 * report.rounds


def test_a_round_still_finding_real_money_buys_another():
    """The budget is two rounds, extended only while a round is still paying."""
    _tuned, hot = optimise(SPLIT3, ValleyQuoter(), amount_in=1_000_000, dst_slot=1,
                           baseline=0, max_rounds=2, hot_rounds=5)
    _tuned, capped = optimise(SPLIT3, ValleyQuoter(), amount_in=1_000_000, dst_slot=1,
                              baseline=0, max_rounds=2, hot_rounds=2)
    assert hot.rounds > capped.rounds
    assert hot.after > capped.after


class PoolQuoter:
    """Three CPMMs, answering probes per-pool and routes by chaining them.

    `f(x) = Kx/(K+x)` makes `u = x/f` exactly affine, so the sampled curve is
    the pool rather than an approximation of it -- which is what lets this test
    assert convergence to the true optimum instead of merely to an improvement.
    """

    DEPTH: ClassVar[dict[str, float]] = {POOL_A: 4e6, POOL_B: 1e6, POOL_C: 2e7}

    def __init__(self) -> None:
        self.probe_calls = 0
        self.route_calls = 0

    def out(self, pool: str, x: float) -> int:
        k = self.DEPTH[pool]
        return int(k * x / (k + x)) if x > 0 else 0

    def probe(self, probes):
        from erouter.core.quoter import Quote, Status

        self.probe_calls += 1
        return [Quote(Status.VALUE, self.out(p.pool, p.dx)) for p in probes]

    def _walk(self, legs, amount_in, dst_slot):
        balances = {0: amount_in}
        current, base = None, 0
        for leg in legs:
            if leg.src_slot != current:
                current, base = leg.src_slot, balances.get(leg.src_slot, 0)
            available = balances.get(leg.src_slot, 0)
            take = available if leg.bps == 0 else min(base * leg.bps // BPS, available)
            if take <= 0:
                continue
            balances[leg.src_slot] = available - take
            balances[leg.dst_slot] = balances.get(leg.dst_slot, 0) + self.out(leg.target, take)
        return balances.get(dst_slot, 0)

    def quote_routes(self, routes, amounts_in, dst_slots):
        self.route_calls += 1
        return [self._walk(legs, amount, slot)
                for legs, amount, slot in zip(routes, amounts_in, dst_slots, strict=True)]


def true_optimum(quoter: PoolQuoter, amount: int) -> float:
    """Best head share, by brute force over the whole simplex."""
    best, where = -1, 0.0
    for share in np.linspace(0.001, 0.999, 20_000):
        through_a = quoter.out(POOL_C, quoter.out(POOL_A, share * amount))
        value = through_a + quoter.out(POOL_B, (1.0 - share) * amount)
        if value > best:
            best, where = value, share
    return where


def test_the_sampled_curves_converge_on_the_true_optimum():
    amount = 1_000_000
    quoter = PoolQuoter()
    nominal_in = [600_000, 400_000, quoter.out(POOL_A, 600_000)]
    nominal_out = [quoter.out(POOL_A, 600_000), quoter.out(POOL_B, 400_000),
                   quoter.out(POOL_C, quoter.out(POOL_A, 600_000))]
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=nominal_in, nominal_out=nominal_out,
    )
    assert report.mode == "curves"
    assert report.improved
    assert abs(tuned[0].bps / BPS - true_optimum(quoter, amount)) < 0.01


def test_it_costs_exactly_two_round_trips():
    """The whole point: sample once, adjudicate once, converge in between."""
    amount = 1_000_000
    quoter = PoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    quoter.route_calls = 0
    _tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
    )
    assert (quoter.probe_calls, quoter.route_calls) == (1, 1)
    assert report.calls == 2
    assert report.local > 100, "the local search should be free enough to converge"


def test_an_exact_curve_predicts_the_chain_to_within_rounding():
    """`curve_error_bp` is the number the whole approach stands on."""
    amount = 1_000_000
    quoter = PoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    _tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
    )
    # One unit out of ~800k, which is the three `int()` truncations the walk
    # performs -- the curve itself contributes nothing measurable.
    assert abs(report.predicted - report.after) <= 2
    assert abs(report.curve_error_bp) < 0.1, report.curve_error_bp


def test_it_falls_back_to_the_chained_search_without_a_probe_path():
    """A quoter that cannot probe still gets optimised, just more expensively."""
    quoter = ConcaveQuoter()
    _tuned, report = optimise(SPLIT, quoter, amount_in=1_000_000, dst_slot=2,
                              baseline=1, nominal_in=[6, 4, 5], nominal_out=[5, 3, 4])
    assert report.mode == "chained"


class LocalPoolQuoter(PoolQuoter):
    """The same pools, but claiming quotes are cheap enough to spend freely."""

    local = True


class DriftingQuoter(LocalPoolQuoter):
    """Chained quotes that the leg-by-leg probes do not predict.

    The probes see each pool alone; the chained walk here charges a little
    extra, so composing the curves lands away from the truth -- which is the
    only condition under which polishing on the true function can pay.
    """

    def quote_routes(self, routes, amounts_in, dst_slots):
        # 0.3 bp: past `POLISH_CHECK_BP` so polish engages, well short of
        # `CHECK_TOL_BP` where the curves stop being believed at all.
        return [int(v * 0.99997)
                for v in super().quote_routes(routes, amounts_in, dst_slots)]


def test_a_local_quoter_finishes_on_the_true_function_when_the_curves_drift():
    """The last word comes from a real quote, not from an interpolant -- but
    only where the two actually disagree."""
    amount = 1_000_000
    quoter = DriftingQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
    )
    assert report.mode == "curves"
    assert abs(report.check_bp) >= 0.15
    assert report.polish_calls > 0, "drifting curves should be polished against"
    # Every polish evaluation is a real quote, so the reported result is one.
    assert report.after == quoter.quote_routes([tuned], [amount], [2])[0]


def test_polish_is_skipped_when_the_curves_already_match():
    """Polish corrects interpolation drift and nothing else, so when the check
    says there is none it is 241 sequential quotes for nothing.  Measured on
    WETH->USDC 300: 0.031 bp for ~770 ms."""
    amount = 1_000_000
    quoter = LocalPoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
    )
    assert abs(report.check_bp) < 0.15
    assert report.polish_skipped and report.polish_calls == 0
    # ...and the answer is still the optimum, reached on the curves alone.
    assert report.improved
    assert abs(tuned[0].bps / BPS - true_optimum(quoter, amount)) < 0.01


def test_the_polish_never_returns_something_worse():
    amount = 1_000_000
    quoter = LocalPoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    _tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
    )
    assert report.after >= baseline
    assert report.polish_bp >= 0.0


def test_a_remote_quoter_is_not_polished():
    """On the wire each of those evaluations is a round trip; do not spend them."""
    amount = 1_000_000
    quoter = PoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    _tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
    )
    assert report.polish_calls == 0


# --- the specialised evaluator --------------------------------------------
#
# `make_evaluator` exists only to be fast; `walk(_fractions(...))` stays as the
# definition of what it computes.  These hold the two together, because a
# divergence would show up as a slightly wrong split rather than as a failure.

def _eval_legs():
    """Two groups sharing a slot, plus an ungrouped leg -- every branch."""
    return [
        Leg(target="0x" + "11" * 20, kind=ArcKind.SWAP_STABLE, i=0, j=1,
            src_slot=0, dst_slot=1, bps=6000),
        Leg(target="0x" + "22" * 20, kind=ArcKind.SWAP_STABLE, i=0, j=1,
            src_slot=0, dst_slot=1, bps=0),
        Leg(target="0x" + "33" * 20, kind=ArcKind.SWAP_CRYPTO, i=0, j=1,
            src_slot=1, dst_slot=2, bps=3000),
        Leg(target="0x" + "44" * 20, kind=ArcKind.SWAP_CRYPTO, i=0, j=1,
            src_slot=1, dst_slot=2, bps=0),
    ]


def _eval_curves(n):
    from erouter.core.curves import fit
    made = []
    for k in range(n):
        xs = [10.0 ** e for e in range(1, 7)]
        rate = 0.99 - 0.01 * k
        made.append(fit(xs, [x * rate * (1.0 - x / 1e9) for x in xs]))
    return made


@pytest.mark.parametrize("seed", range(8))
def test_the_fast_evaluator_matches_the_readable_one(seed):
    from erouter.core.split import _fractions, make_evaluator, walk

    legs = _eval_legs()
    groups = [[0, 1], [2, 3]]
    curves = _eval_curves(len(legs))
    rng = np.random.default_rng(seed)
    fast = make_evaluator(legs, groups, curves, 1e6, 2)

    for _ in range(20):
        weights = [rng.random(2), rng.random(2)]
        slow = walk(legs, curves, _fractions(legs, groups, weights), 1e6, 2)
        assert fast(weights) == pytest.approx(slow, rel=1e-12), (
            "the specialised evaluator drifted from walk(_fractions(...))"
        )


def test_the_fast_evaluator_does_not_mutate_its_input():
    """The golden-section closure shares the untouched groups rather than
    copying them, which is only safe while this holds."""
    from erouter.core.split import make_evaluator

    legs = _eval_legs()
    groups = [[0, 1], [2, 3]]
    weights = [np.array([0.3, 0.7]), np.array([0.4, 0.6])]
    before = [w.copy() for w in weights]
    make_evaluator(legs, groups, _eval_curves(len(legs)), 1e6, 2)(weights)
    for got, want in zip(weights, before, strict=True):
        assert np.array_equal(got, want)


def test_an_ungrouped_leg_keeps_its_realised_share():
    """Only grouped legs are searched; the rest keep the bps they were given."""
    from erouter.core.split import _fractions, make_evaluator, walk

    legs = _eval_legs()
    groups = [[2, 3]]                      # leg 0/1 left out of the search
    curves = _eval_curves(len(legs))
    weights = [np.array([0.25, 0.75])]
    fast = make_evaluator(legs, groups, curves, 1e6, 2)
    slow = walk(legs, curves, _fractions(legs, groups, weights), 1e6, 2)
    assert fast(weights) == pytest.approx(slow, rel=1e-12)


def test_scout_shares_one_probe_batch_across_candidates():
    """The whole point: candidates are nested, so their arcs are sampled once
    between them rather than once each -- which is what makes scouting many
    topologies cost about what scouting one costs."""
    from erouter.core.split import scout

    narrow = [leg(0, 2, 5_000, POOL_A), leg(0, 2, 0, POOL_B)]
    wide = [leg(0, 2, 3_000, POOL_A), leg(0, 2, 3_000, POOL_B),
            leg(0, 2, 0, POOL_C)]
    client = PoolQuoter()
    plans = [
        (narrow, 2, [500_000, 500_000], [400_000, 400_000]),
        (wide, 2, [300_000, 300_000, 400_000], [250_000, 250_000, 350_000]),
    ]
    found = scout(plans, client, amount_in=1_000_000)

    assert client.probe_calls == 1          # one batch, both candidates
    assert {f.index for f in found} == {0, 1}
    assert all(f.predicted > 0 for f in found)
    # Sorted best-first, and the wider topology should win on a concave payoff:
    # three pools spread the same flow further than two.
    assert found[0].index == 1


def test_scout_returns_weights_that_sum_to_the_whole_input():
    """Scouted legs are handed straight to the quoter, so their `bps` have to
    be a valid plan -- the last leg of each group sweeping the remainder."""
    from erouter.core.split import scout

    wide = [leg(0, 2, 3_000, POOL_A), leg(0, 2, 3_000, POOL_B),
            leg(0, 2, 0, POOL_C)]
    found = scout([(wide, 2, [300_000, 300_000, 400_000],
                    [250_000, 250_000, 350_000])],
                  PoolQuoter(), amount_in=1_000_000)
    assert found
    tuned = found[0].legs
    assert tuned[-1].bps == 0                       # the sweep
    assert 0 < sum(one.bps for one in tuned[:-1]) < BPS


def test_handed_curves_are_checked_but_not_resampled():
    """The scout has already paid for a sample; the split pass should reuse it
    and still hold it to the chain."""
    amount = 1_000_000
    quoter = LocalPoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    scouted = scout([(SPLIT, 2, [600_000, 400_000, 500_000],
                      [500_000, 380_000, 490_000])], quoter, amount_in=amount)
    assert scouted and scouted[0].curves

    before = quoter.probe_calls
    tuned, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
        curves=scouted[0].curves,
    )
    assert report.reused
    assert quoter.probe_calls == before      # nothing re-sampled
    assert report.check_bp != 0.0 or report.mode == "curves"   # still checked
    assert report.after >= baseline
    assert abs(tuned[0].bps / BPS - true_optimum(quoter, amount)) < 0.01


def test_handed_curves_that_miss_the_chain_are_resampled():
    """Reuse is an optimisation, not a promise: curves that fail their check
    fall back to a real sample rather than being optimised on."""
    amount = 1_000_000
    quoter = LocalPoolQuoter()
    baseline = quoter.quote_routes([SPLIT], [amount], [2])[0]
    # Curves that claim every leg is a 1:1 pass-through: badly wrong, and the
    # check against the chained baseline will say so.
    from erouter.core import curves as curve_mod

    before = quoter.probe_calls
    _, report = optimise(
        SPLIT, quoter, amount_in=amount, dst_slot=2, baseline=baseline,
        nominal_in=[600_000, 400_000, 500_000],
        nominal_out=[500_000, 380_000, 490_000],
        curves=[curve_mod.linear(1.0) for _ in SPLIT],
    )
    assert not report.reused
    assert quoter.probe_calls > before       # it went and sampled properly
    assert report.after >= baseline


def test_a_candidate_scouts_the_same_alone_as_in_company():
    """Candidates are independent answers, not terms in a shared one.

    `scout` samples one probe batch for the whole ballot, and it used to size
    each arc's ladder to the widest size *any* plan asked for.  `sizes()` spreads
    its nodes between `top/span` and `top`, so a second plan wanting more moved
    every sample point under the first one and changed what it tuned to -- which
    made a candidate's result depend on which rivals happened to share its
    batch.  On crvUSD -> sDOLA that was the difference between adopting a
    challenger and not.
    """
    from erouter.core.split import scout

    narrow = [leg(0, 2, 5_000, POOL_A), leg(0, 2, 0, POOL_B)]
    # Deliberately hungrier on the arcs it shares with `narrow`, so a batch-wide
    # ladder top would be set by this plan and not by that one.
    hungry = [leg(0, 2, 3_000, POOL_A), leg(0, 2, 3_000, POOL_B),
              leg(0, 2, 0, POOL_C)]
    narrow_plan = (narrow, 2, [500_000, 500_000], [400_000, 400_000])
    hungry_plan = (hungry, 2, [3_000_000, 3_000_000, 4_000_000],
                   [2_500_000, 2_500_000, 3_500_000])

    alone = scout([narrow_plan], PoolQuoter(), amount_in=1_000_000)
    together = scout([narrow_plan, hungry_plan], PoolQuoter(), amount_in=1_000_000)

    mine = next(f for f in alone if f.index == 0)
    ours = next(f for f in together if f.index == 0)
    assert ours.predicted == mine.predicted
    assert [one.bps for one in ours.legs] == [one.bps for one in mine.legs]


def test_scouting_in_company_still_costs_one_batch():
    """Independence must not be bought by giving every plan its own round trip."""
    from erouter.core.split import scout

    narrow = [leg(0, 2, 5_000, POOL_A), leg(0, 2, 0, POOL_B)]
    hungry = [leg(0, 2, 3_000, POOL_A), leg(0, 2, 3_000, POOL_B),
              leg(0, 2, 0, POOL_C)]
    client = PoolQuoter()
    scout([(narrow, 2, [500_000, 500_000], [400_000, 400_000]),
           (hungry, 2, [3_000_000, 3_000_000, 4_000_000],
            [2_500_000, 2_500_000, 3_500_000])],
          client, amount_in=1_000_000)
    assert client.probe_calls == 1
