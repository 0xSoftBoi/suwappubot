"""Per-pool minimum-out risk, and what it does to ranking.

The router nets off what a route costs to attempt: gas, plus the chance one of
its minimum-outs -- each a fraction of its pool's fee -- has been overtaken by
the time the transaction is mined a minute or two later.  A failure costs a
resubmission rather than the trade, so that second term is a fraction of a basis
point; the tests below fix its *size*, not only its sign, because the size is
the whole argument.  Two halves: the table and the estimator that fills it.
"""

from __future__ import annotations

import math
import random

import numpy as np

from erouter.chain.drift import PriceSeries
from erouter.chain.revert_risk import breach_risk, jump_scale_bp, tail_model
from erouter.core.candidates import Candidate, CandidateSet
from erouter.core.realize import RealizedLeg, RealizedRoute
from erouter.core.risk import DEFAULT_RISK, RiskTable
from erouter.core.types import ArcKind, Leg
from erouter.core.verify import verify

POOL = ["0x" + f"{k:02x}" * 20 for k in range(1, 9)]


def _score(candidate, risk):
    """What `verify` ranks on, recomputed here so a test can name the size of
    the premium rather than only its sign."""
    from erouter.core.risk import expected_value

    return expected_value(float(candidate.verified_out), candidate.survival)


class FakeClient:
    def __init__(self, outs):
        self.outs = list(outs)
        self.calls = 0

    def quote_routes(self, routes, amounts_in, dst_slots):
        self.calls += 1
        return self.outs[: len(routes)]


def _candidate(label, targets, out=None, kind=ArcKind.SWAP_STABLE):
    """One candidate whose legs hop through `targets` in order."""
    route = RealizedRoute(dst_slot=1)
    for k, target in enumerate(targets):
        route.legs.append(
            RealizedLeg(
                leg=Leg(target, kind, src_slot=k, dst_slot=k + 1),
                kind=kind, target=target,
                token_in="0xa", token_out="0xb", amount_in=1, amount_out=1,
            )
        )
    candidate = Candidate(label=label, psi=np.array([1.0]), certificate=False)
    candidate.route = route
    candidate.status = "ready"
    if out is not None:
        candidate.verified_out = out
    return candidate


# --------------------------------------------------------------- the table


def test_survival_is_the_product_over_legs():
    table = RiskTable({(POOL[0], 0, 1): 0.25, (POOL[1], 0, 1): 0.1})
    legs = [Leg(POOL[0], ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1),
            Leg(POOL[1], ArcKind.SWAP_CRYPTO, src_slot=1, dst_slot=2)]
    assert table.survival(legs) == 0.75 * 0.9


def test_an_unmeasured_pool_is_not_a_free_one():
    """The one thing a missing measurement cannot say is "never moves"."""
    table = RiskTable({(POOL[0], 0, 1): 0.0})
    priced = Leg(POOL[0], ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1)
    unknown = Leg(POOL[5], ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1)
    assert table.survival([priced]) == 1.0
    assert table.survival([unknown]) == 1.0 - DEFAULT_RISK


def test_an_unsampled_direction_inherits_its_pool_not_the_default():
    """The `(-1, -1)` tier: a pair the sweep missed on a pool it knows is
    priced from that pool, erring high."""
    table = RiskTable({(POOL[0], 0, 1): 0.2, (POOL[0], -1, -1): 0.2})
    missed = Leg(POOL[0], ArcKind.SWAP_STABLE, i=1, j=2, n=3,
                 src_slot=0, dst_slot=1)
    assert table.survival([missed]) == 0.8


def test_arcs_of_one_pool_are_priced_separately():
    """TriCRV's CRV/ETH pair moves several times as far as its crvUSD one, and
    the minimum-out is written per leg."""
    table = RiskTable({(POOL[0], 0, 1): 0.01, (POOL[0], 1, 2): 0.4})
    quiet = Leg(POOL[0], ArcKind.SWAP_CRYPTO, i=0, j=1, n=3, src_slot=0, dst_slot=1)
    loud = Leg(POOL[0], ArcKind.SWAP_CRYPTO, i=1, j=2, n=3, src_slot=0, dst_slot=1)
    assert table.survival([quiet]) == 0.99
    assert table.survival([loud]) == 0.6


def test_wraps_and_redemptions_carry_no_rate_risk():
    """A wrap, a stake or a vault redemption is priced by accrual, which moves
    upward and slowly.  No minimum-out of this kind can trigger on it, so
    charging one would tax exactly the legs that cannot fail."""
    table = RiskTable({(POOL[0], 0, 1): 0.5}, default=0.5)
    for kind in (ArcKind.WRAP_NATIVE, ArcKind.WSTETH_WRAP, ArcKind.STAKE_NATIVE,
                 ArcKind.LEND_REDEEM, ArcKind.ERC4626_DEPOSIT):
        leg = Leg(POOL[0], kind, src_slot=0, dst_slot=1)
        assert table.survival([leg]) == 1.0


# ------------------------------------------------------------- the ranking


def test_a_dangerous_route_pays_a_fraction_of_a_basis_point():
    """The premium has to stay small enough to be a tie-break.  TriCRV and
    TricryptoUSDC together land about 62% of the time; that is worth 0.4 bp of
    a route, not the 3,800 bp `output * survival` would charge -- and a 71 bp
    advantage is still an advantage."""
    risk = RiskTable({(POOL[0], 0, 1): 1e-5, (POOL[1], 0, 1): 0.25,
                      (POOL[2], 0, 1): 0.167})
    candidates = CandidateSet([
        _candidate("split", [POOL[1], POOL[2]]),
        _candidate("direct", [POOL[0]]),
    ])
    verify(candidates, FakeClient([1_007_100, 1_000_000]), amount_in=10**6,
           risk_table=risk)
    assert candidates.best.label == "split"
    split = candidates.candidates[0]
    assert 0.6 < split.survival < 0.64
    charged_bp = (1 - _score(split, risk) / split.verified_out) * 1e4
    assert 0.3 < charged_bp < 0.5


def test_a_dangerous_route_loses_when_its_edge_is_under_the_premium():
    """...and the same 0.4 bp is decisive when the gain is smaller than it."""
    risk = RiskTable({(POOL[0], 0, 1): 1e-5, (POOL[1], 0, 1): 0.25,
                      (POOL[2], 0, 1): 0.167})
    candidates = CandidateSet([
        _candidate("split", [POOL[1], POOL[2]]),
        _candidate("direct", [POOL[0]]),
    ])
    verify(candidates, FakeClient([1_000_020, 1_000_000]), amount_in=10**6,
           risk_table=risk)  # +0.2 bp for a 38% chance of not landing
    assert candidates.best.label == "direct"


def test_a_long_route_through_safe_pools_keeps_its_gain():
    """The other half of the argument: risk is not a leg budget.  Twelve legs
    through pools whose fees are wide against their volatility cost almost
    nothing, and a 30 bp gain still wins."""
    safe = {(p, 0, 1): 1e-5 for p in POOL}
    candidates = CandidateSet([
        _candidate("long", [POOL[k % 8] for k in range(12)]),
        _candidate("short", [POOL[0]]),
    ])
    verify(candidates, FakeClient([1_003_000, 1_000_000]), amount_in=10**6,
           risk_table=RiskTable(safe))
    assert candidates.best.label == "long"


def test_a_failed_attempt_pays_gas_twice():
    """It pays for itself and the retry pays again -- so gas carries a
    `1 + P(fails)` factor, while the output only loses what resubmitting is
    worth."""
    from erouter.core.risk import expected_value

    gas = 173_000 * 1e-9          # 71,000 base + 102,000 swap, at 1 gwei
    assert expected_value(10**18, 1.0, gas_cost=gas * 1e18) == 10**18 - gas * 1e18
    half = expected_value(10**18, 0.5, gas_cost=gas * 1e18)
    assert abs(half - (10**18 * (1 - 0.5e-4) - 1.5 * gas * 1e18)) < 1

    risk = RiskTable({(POOL[0], 0, 1): 0.5})
    candidates = CandidateSet([_candidate("one", [POOL[0]])])
    verify(candidates, FakeClient([10**18]), amount_in=10**18,
           gas_price_wei=10**9, dst_wei_per_eth=10**18, risk_table=risk)
    candidate = candidates.candidates[0]
    assert candidate.survival == 0.5
    assert candidate.gas == 173_000


def test_no_table_means_no_risk_pricing():
    """Ranking must be unchanged when nothing has been measured."""
    candidates = CandidateSet([
        _candidate("long", [POOL[k % 8] for k in range(6)]),
        _candidate("short", [POOL[0]]),
    ])
    verify(candidates, FakeClient([1_000_100, 1_000_000]), amount_in=10**6)
    assert candidates.best.label == "long"
    assert candidates.candidates[0].survival == 1.0


# ------------------------------------------------------------ the estimator


def _walk(steps: int, sigma_bp: float, seed: int) -> list[float]:
    """A rate that moves every sample -- a busy pool."""
    rng = random.Random(seed)
    rate, out = 1.0, []
    for _ in range(steps):
        out.append(rate)
        rate *= math.exp(rng.gauss(0.0, sigma_bp / 1e4))
    return out


def _quiet_walk(steps: int, jump_bp: float, every: int, seed: int) -> list[float]:
    """A rate that holds still and jumps when someone trades, which is what a
    pool's rate actually does -- not a diffusion."""
    rng = random.Random(seed)
    rate, out = 1.0, []
    for k in range(steps):
        out.append(rate)
        if k % every == 0:
            rate *= math.exp(rng.gauss(0.0, jump_bp / 1e4))
    return out


def _arc(key, pool, i, j):
    return (key, pool, int(ArcKind.SWAP_STABLE), i, j, 2, 1000)


def test_a_bound_far_outside_the_data_is_priced_far_below_one_in_n():
    """The reason the tail is modelled rather than counted.  Two dozen windows
    can only resolve down to 4%, and the honest smoothing of a zero count --
    Jeffreys' 2% -- reads as a 22% loss over a twelve-leg route.  A pool whose
    bound sits far outside anything it has ever done is not that."""
    key = "a|b@" + POOL[0]
    series = {key: PriceSeries(token=key, pool=POOL[0],
                               prices=_quiet_walk(25, 0.05, 3, seed=1))}
    # 146 bp fee, as Yield Basis charges: a 29 bp bound on a 0.05 bp jump.
    out = breach_risk(series, {POOL[0].lower(): 0.0146},
                      [_arc(key, POOL[0], 0, 1)])
    assert out[POOL[0].lower() + ":0>1"]["p"] < 1e-3


def test_a_bound_inside_the_typical_move_is_priced_from_the_count():
    """A rate that moves further than its own bound most minutes.  Here the
    data speaks for itself and no extrapolation should talk it down.

    The fee is well above the floor on purpose, so this measures the count
    rather than `BOUND_FLOOR_BP`."""
    key = "a|b@" + POOL[1]
    series = {key: PriceSeries(token=key, pool=POOL[1],
                               prices=_walk(25, 20.0, seed=2))}
    out = breach_risk(series, {POOL[1].lower(): 0.0034},   # 34 bp fee, 6.8 bp bound
                      [_arc(key, POOL[1], 0, 1)])
    assert out[POOL[1].lower() + ":0>1"]["p"] > 0.2


def test_each_direction_of_a_pool_is_priced_on_its_own():
    """The minimum-out is written per leg, so the quiet pair of a pool with a
    loud one must not inherit its risk."""
    address = POOL[2].lower()
    quiet, loud = "a|b@" + address, "b|c@" + address
    series = {
        quiet: PriceSeries(token=quiet, pool=address,
                           prices=_quiet_walk(25, 0.01, 4, seed=3)),
        loud: PriceSeries(token=loud, pool=address, prices=_walk(25, 4.0, seed=4)),
    }
    out = breach_risk(series, {address: 0.0001},  # 1 bp fee, 0.2 bp bound
                      [_arc(quiet, address, 0, 1), _arc(loud, address, 1, 2)])
    assert out[address + ":1>2"]["p"] > 0.2
    assert out[address + ":0>1"]["p"] < 0.05


def test_a_pool_that_does_not_report_a_fee_is_left_unmeasured():
    """Without its own fee there is no bound, and an invented one would be a
    claim.  Absent means the default, which is the conservative answer."""
    key = "a|b@" + POOL[3]
    series = {key: PriceSeries(token=key, pool=POOL[3],
                               prices=_walk(25, 1.0, seed=5))}
    assert breach_risk(series, {}, [_arc(key, POOL[3], 0, 1)]) == {}


def test_the_scale_is_the_size_of_a_move_not_of_a_window():
    """Most windows contain no trade at all.  Their zeros say how often a pool
    is quiet, which is counted separately; letting them into the scale would
    put it at the floor and turn every real trade into a 400-sigma event -- the
    bug that priced 3pool, which never breached, at 4.5% a leg."""
    mostly_quiet = [0.0] * 18 + [0.3, 0.4, 0.5]
    assert jump_scale_bp(mostly_quiet) == 0.4


def test_the_tail_is_empirical_inside_the_data():
    sample = [float(k) / 10 for k in range(1, 1001)]  # uniform on (0, 100]
    tail = tail_model(sample)
    assert abs(tail(50.0) - 0.5) < 0.02
    # ... and continues past its edge rather than falling off it.
    assert 0 < tail(200.0) < tail(100.0)


def test_the_worst_arc_is_what_an_unsampled_direction_inherits(tmp_path):
    """`FactsCache.risk_table` fills the `(-1, -1)` tier, so a pair the sweep
    missed is priced from its own pool rather than from the global default."""
    from erouter.chain.facts import FactsCache

    cache = FactsCache(chain_id=1, path=tmp_path / "x.json")
    cache.learn_breach({f"{POOL[0].lower()}:0>1": {"p": 0.02},
                        f"{POOL[0].lower()}:1>2": {"p": 0.31}})
    table = cache.risk_table()
    missed = Leg(POOL[0], ArcKind.SWAP_CRYPTO, i=2, j=0, n=3,
                 src_slot=0, dst_slot=1)
    assert table.of(ArcKind.SWAP_CRYPTO, POOL[0], 0, 1) == 0.02
    assert table.survival([missed]) == 1.0 - 0.31


def test_a_deposit_leg_takes_the_pool_figure_not_a_swap_pair():
    """`(i, j)` are coin indices on a swap and something else on a deposit, so
    reading the specific tier for one would hand it whichever swap happened to
    share the numbers."""
    table = RiskTable({(POOL[0], 0, 1): 0.4, (POOL[0], -1, -1): 0.02})
    deposit = Leg(POOL[0], ArcKind.DEPOSIT_FIXED, i=0, j=1, n=3,
                  src_slot=0, dst_slot=1)
    assert table.survival([deposit]) == 0.98


def test_a_listed_pool_gets_the_absolute_floor_under_its_bound():
    """Twenty percent of a 3.3 bp fee is 0.65 bp, against a rate that jumps
    ~0.9 bp per trade: TricryptoUSDC failed more often than it landed."""
    from erouter.chain.revert_risk import BOUND_FLOOR_BP, bound_bp

    assert bound_bp(0.00033, wide=True) == BOUND_FLOOR_BP
    # 146 bp fee, as Yield Basis charges: nowhere near the floor, listed or not.
    assert round(bound_bp(0.0146, wide=True), 4) == 29.2


def test_a_pool_off_the_list_keeps_the_fee_fraction():
    """5 bp is a large allowance against a spread of one or two, and a pool on
    a pegged pair does not need it."""
    from erouter.chain.revert_risk import bound_bp

    assert bound_bp(0.0001) == 0.2                         # 1 bp fee, unlisted


def test_the_list_names_low_fee_pools_on_moving_pairs():
    """Both conditions, because either alone is the wrong answer: a volatile
    pool that charges for it needs nothing, and a pegged pair would only be
    handed an allowance many times its own spread."""
    from erouter.chain.revert_risk import wide_bound_pools

    def series(pair, pool, prices):
        return {f"{pair}@{pool}": PriceSeries(token=pair, pool=pool, prices=prices)}

    volatile = [1.0, 1.01, 0.99, 1.02, 1.0]     # ~100 bp steps
    pegged = [1.0, 1.000001, 1.0, 1.000002, 1.0]
    cheap, dear = POOL[0].lower(), POOL[1].lower()
    quiet = POOL[2].lower()

    listed = wide_bound_pools({**series("a|b", cheap, volatile),
                               **series("c|d", dear, volatile),
                               **series("e|f", quiet, pegged)},
                              {cheap: 0.00033, dear: 0.0146, quiet: 0.00001})
    assert set(listed) == {cheap}               # dear charges enough; quiet does not move
    assert listed[cheap]["fee_bp"] == 3.3
    assert listed[cheap]["drift_bp"] > 90


def test_the_list_is_keyed_on_the_pair_not_on_one_pool_trading():
    """The defect this replaces: a pool that saw no trade in the sample looked
    pegged whatever it trades.  TricryptoINV's USDC/INV rate moves 1,178 bp in
    four hours, and a per-arc test left it on a 0.75 bp bound."""
    from erouter.chain.revert_risk import wide_bound_pools

    busy, quiet = POOL[3].lower(), POOL[4].lower()
    series = {
        f"a|b@{busy}": PriceSeries(token="a|b", pool=busy,
                                   prices=[1.0, 1.05, 0.97, 1.03, 1.0]),
        f"a|b@{quiet}": PriceSeries(token="a|b", pool=quiet,
                                    prices=[1.0, 1.0, 1.0, 1.0, 1.0]),
    }
    listed = wide_bound_pools(series, {busy: 0.0001, quiet: 0.0001})
    assert quiet in listed  # the pair moves, even though this pool did not


def test_the_list_also_names_a_pool_whose_own_rate_wobbles():
    """The pair test alone is not enough.  Curve.fi Strategic USD Reserve
    charges 0.1 bp, putting its bound at 0.02, and trips a fifth of the time
    while trading USDC against USDT -- a pair nobody would call volatile.  Left
    off the list it binds every route it appears in."""
    from erouter.chain.revert_risk import wide_bound_pools

    pool = POOL[5].lower()
    pegged = {f"a|b@{pool}": PriceSeries(token="a|b", pool=pool,
                                         prices=[1.0, 1.0, 1.0, 1.0, 1.0])}
    fees = {pool: 0.00001}                       # 0.1 bp fee, 0.02 bp bound
    assert wide_bound_pools(pegged, fees) == {}  # pair alone says no
    listed = wide_bound_pools(pegged, fees, {f"{pool}:0>1": {"p": 0.217}})
    assert pool in listed
    assert listed[pool]["tight_p"] == 0.217


# ---------------------------------------------------------- price impact


class _route_stub:
    """The two attributes `price_impact` reads off a realised route."""

    dst_slot = 1

    @property
    def wire_legs(self):
        return ["leg"]


def test_price_impact_is_the_price_gap_against_a_small_trade():
    """Price is input over output, and the impact is what the size costs:
    `price(full) / price(small) - 1`."""
    from erouter.core.verify import price_impact

    Route = _route_stub

    # 1,000,000 in -> 990,000 out; at 5% the same route pays 50,000 -> 49,900,
    # so the small trade's rate is 0.998 against the full trade's 0.99.
    client = FakeClient([49_900])
    impact, ref_in, ref_out = price_impact(
        client, Route(), amount_in=1_000_000, verified_out=990_000)
    assert (ref_in, ref_out) == (50_000, 49_900)
    assert abs(impact - (0.998 / 0.99 - 1) * 1e4) < 1e-6


def test_price_impact_needs_something_to_compare():
    """A size that rounds to nothing, or a reference quote that reverts,
    yields no figure rather than a fabricated one."""
    from erouter.core.verify import price_impact

    Route = _route_stub

    assert price_impact(FakeClient([1]), Route(), amount_in=10,
                        verified_out=10) is None          # 5% of 10 is 0
    assert price_impact(FakeClient([0]), Route(), amount_in=10**18,
                        verified_out=10**18) is None      # reference reverted


def test_a_flat_route_has_no_price_impact():
    """A 1:1 conversion prices the same at any size."""
    from erouter.core.verify import price_impact

    Route = _route_stub

    impact, _, _ = price_impact(FakeClient([50_000]), Route(),
                                amount_in=1_000_000, verified_out=1_000_000)
    assert abs(impact) < 1e-9


# ------------------------------------------------------------- leg cost


def test_a_leg_is_charged_beyond_its_gas():
    """The tail the relaxation takes when gas is near zero: measured, a $10k
    trade went 31 legs to gain 0.62 bp over a 10-leg route."""
    long_route = _candidate("long", [POOL[k % 8] for k in range(20)])
    short = _candidate("short", [POOL[0]])
    candidates = CandidateSet([long_route, short])
    # +0.3 bp for 19 more legs, against 0.02 bp a leg.
    verify(candidates, FakeClient([1_000_030, 1_000_000]), amount_in=10**6,
           leg_cost_bp=0.02)
    assert candidates.best.label == "short"


def test_legs_that_earn_their_keep_are_untouched():
    """The charge has to leave the large trades alone, where extra legs are
    worth tens of basis points each."""
    long_route = _candidate("long", [POOL[k % 8] for k in range(12)])
    short = _candidate("short", [POOL[0]])
    candidates = CandidateSet([long_route, short])
    verify(candidates, FakeClient([1_006_000, 1_000_000]), amount_in=10**6,
           leg_cost_bp=0.02)   # +60 bp against 0.24 bp of charge
    assert candidates.best.label == "long"


def test_a_wrap_is_not_charged_as_complexity():
    """Conversions are exempt: a wrap is a leg to the executor but not a
    decision the router is choosing between."""
    wrapped = _candidate("wrapped", [POOL[0], POOL[1]], kind=ArcKind.WRAP_NATIVE)
    plain = _candidate("plain", [POOL[0]])
    candidates = CandidateSet([wrapped, plain])
    verify(candidates, FakeClient([1_000_001, 1_000_000]), amount_in=10**6,
           leg_cost_bp=1.0)
    assert candidates.best.label == "wrapped"
