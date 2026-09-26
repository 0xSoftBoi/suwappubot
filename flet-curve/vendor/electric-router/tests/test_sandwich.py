"""Are the minimum rates enough to make a sandwich not worth running?

Not quite, and the shape of the answer matters more than a yes.

**A sandwich pays or does not for reasons that have nothing to do with us.**
On a constant-product pool, the attacker's cost is the fee paid twice on their
own size and their gain is the price displacement the victim causes, so the
attack is profitable whenever the victim's trade exceeds roughly `2 * fee` times
the pool's reserve -- whatever tolerance the victim grants.  Measured over a
grid of fees and sizes, that rule calls all but the boundary case.

**What the tolerance decides is how much can be taken.**  The extraction is
capped, exactly, by what the victim's bound allows it to lose: the front-run can
only be as large as the bound will still settle.  Measured, the attacker's take
scales linearly with the tolerance and comes to about `t` of the trade.

So the tests below assert the second thing, which is true and is the guarantee
the router actually offers, and characterise the first, which is economics.
Both run against `core.routecall.min_rates` rather than a restatement of it --
otherwise this would be testing the test.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule

from erouter.core.poolfee import charged_fee
from erouter.core.realize import RealizedLeg, RealizedRoute
from erouter.core.routecall import FEE_SHARE, FLOOR_BP, ONE, VOLATILE_FLOOR_BP, min_rates
from erouter.core.stableswap import StableSwap
from erouter.core.types import ArcKind, Leg

POOL = "0x" + "cc" * 20
FEE_DENOMINATOR = 10**10


# --------------------------------------------------------------- the venues


@dataclass(frozen=True, slots=True)
class Cpmm:
    """Constant product, fee on the output.  The canonical sandwich target."""

    x: int
    y: int
    fee: int  # 1e10-based

    def get_dy(self, i: int, j: int, dx: int) -> int:
        held_in, held_out = (self.x, self.y) if i == 0 else (self.y, self.x)
        gross = held_out * dx // (held_in + dx)
        return gross - gross * self.fee // FEE_DENOMINATOR

    def exchange(self, i: int, j: int, dx: int) -> tuple[int, Cpmm]:
        dy = self.get_dy(i, j, dx)
        if i == 0:
            return dy, replace(self, x=self.x + dx, y=self.y - dy)
        return dy, replace(self, x=self.x - dy, y=self.y + dx)

    @property
    def reserves(self) -> tuple[int, int]:
        return self.x, self.y


def stable(balances=(10**24, 10**24), fee=4 * 10**6, dynamic=0) -> StableSwap:
    return StableSwap(balances=balances, rates=(10**18,) * 2, amp=200 * 100,
                      fee=fee, offpeg_fee_multiplier=dynamic, a_precision=100,
                      admin_fee=0)


# ------------------------------------------------------- the policy itself


def bound_for(amount_in: int, quoted_out: int, fee_frac: float,
              *, volatile: bool = False) -> int:
    """The `min_rate` the router would carry, from the shipping policy."""
    leg = RealizedLeg(
        leg=Leg(target=POOL, kind=ArcKind.SWAP_STABLE),
        kind=ArcKind.SWAP_STABLE, target=POOL,
        token_in="0x" + "01" * 20, token_out="0x" + "02" * 20,
        amount_in=amount_in, amount_out=quoted_out, verified_out=quoted_out,
        fee_frac=fee_frac, fee_floor=fee_frac,
    )
    route = RealizedRoute(legs=[leg], amount_in=amount_in, dst_slot=1)
    return min_rates(route, volatile=[POOL] if volatile else [])[0][0]


def settles(dx: int, dy: int, min_rate: int) -> bool:
    """`ElectricRouter`'s own check, to the operator."""
    return dy >= dx * min_rate // ONE


def run_sandwich(pool, i: int, j: int, front: int, victim: int):
    """`(attacker profit in the input token, what the victim got, the quote)`."""
    quote = pool.get_dy(i, j, victim)
    got_front, after = pool.exchange(i, j, front) if front else (0, pool)
    got_victim, after = after.exchange(i, j, victim)
    back = after.exchange(j, i, got_front)[0] if got_front else 0
    return back - front, got_victim, quote


# --------------------------------------------------------- what is promised


@settings(max_examples=200, deadline=None)
@given(
    front=st.integers(min_value=0, max_value=10**23),
    victim=st.integers(min_value=10**18, max_value=10**23),
    fee_bp=st.sampled_from([0.5, 1.0, 4.0, 30.0, 100.0]),
)
def test_a_settled_leg_never_fell_below_what_it_promised(front, victim, fee_bp):
    """The whole guarantee: settle, or come back with at least the bound."""
    pool = Cpmm(10**24, 10**24, int(fee_bp / 1e4 * FEE_DENOMINATOR))
    _, got, quote = run_sandwich(pool, 0, 1, front, victim)
    assume(quote > 0)
    rate = bound_for(victim, quote, fee_bp / 1e4)
    tolerance = 1 - rate / (quote * ONE // victim)
    if not settles(victim, got, rate):
        return                                  # refused, which is the other half
    shortfall = 1 - got / quote
    assert shortfall <= tolerance + 1e-9, (
        f"settled {shortfall * 1e4:.4f} bp below the quote against a "
        f"{tolerance * 1e4:.4f} bp bound")


@settings(max_examples=100, deadline=None)
@given(
    victim=st.integers(min_value=10**20, max_value=10**23),
    fee_bp=st.sampled_from([1.0, 4.0, 30.0, 100.0]),
)
def test_the_tolerance_is_the_ceiling_on_what_can_be_taken(victim, fee_bp):
    """However large the front-run, extraction stops at the bound."""
    pool = Cpmm(10**24, 10**24, int(fee_bp / 1e4 * FEE_DENOMINATOR))
    quote = pool.get_dy(0, 1, victim)
    rate = bound_for(victim, quote, fee_bp / 1e4)
    tolerance = 1 - rate / (quote * ONE // victim)
    taken = 0.0
    for front in (10**18, 10**20, 10**21, 10**22, 10**23, 10**24):
        _, got, _ = run_sandwich(pool, 0, 1, front, victim)
        if settles(victim, got, rate):
            taken = max(taken, (quote - got) / quote)
    assert taken <= tolerance + 1e-9


def test_extraction_grows_with_the_tolerance_and_with_nothing_else():
    """A fifth of the fee is a fifth of the fee, in what it lets through."""
    victim = 10**22
    seen = []
    for fee_bp in (1.0, 4.0, 30.0, 100.0):
        pool = Cpmm(10**24, 10**24, int(fee_bp / 1e4 * FEE_DENOMINATOR))
        quote = pool.get_dy(0, 1, victim)
        rate = bound_for(victim, quote, fee_bp / 1e4)
        worst = 0.0
        for front in (10**19, 10**20, 10**21, 10**22, 10**23):
            _, got, _ = run_sandwich(pool, 0, 1, front, victim)
            if settles(victim, got, rate):
                worst = max(worst, (quote - got) / quote * 1e4)
        seen.append((fee_bp, worst))
    for fee_bp, worst in seen:
        allowed = max(FEE_SHARE * fee_bp, FLOOR_BP)
        assert worst <= allowed + 1e-6, f"{fee_bp} bp pool leaked {worst:.4f} bp"
    assert seen[-1][1] > seen[0][1], "a fatter fee should permit more, not less"


# ------------------------------------------------------------- the one rule


@pytest.mark.parametrize("fee_bp", [0.14, 0.5, 1.0, 4.0, 30.0, 100.0, 300.0])
def test_the_bound_is_a_fifth_of_the_fee(fee_bp):
    """A fifth of the least the pool can charge, floored only by rounding."""
    victim, quote = 10**22, 10**22
    rate = bound_for(victim, quote, fee_bp / 1e4)
    granted = (1 - rate / (quote * ONE // victim)) * 1e4
    assert granted == pytest.approx(max(FEE_SHARE * fee_bp, FLOOR_BP), rel=1e-3)


@pytest.mark.parametrize("fee_bp", [0.5, 1.0, 4.0, 10.0])
def test_the_volatile_floor_is_what_it_costs(fee_bp):
    """Below 25 bp the floor binds, and it binds by a factor worth knowing.

    Measured against the deployed TricryptoUSDC: the fee rule alone grants
    0.60 bp and a sandwich takes 0.52 bp of a $15,000 leg, so eight times the
    room is roughly eight times the take.  That is the accepted trade for a
    pair that would otherwise revert on honest movement.
    """
    victim, quote = 10**22, 10**22
    tight = bound_for(victim, quote, fee_bp / 1e4)
    loose = bound_for(victim, quote, fee_bp / 1e4, volatile=True)
    assert loose < tight
    room = ((1 - loose / (quote * ONE // victim)) * 1e4,
            (1 - tight / (quote * ONE // victim)) * 1e4)
    assert room[0] == pytest.approx(VOLATILE_FLOOR_BP, rel=1e-3)
    assert room[0] / room[1] == pytest.approx(
        VOLATILE_FLOOR_BP / max(FEE_SHARE * fee_bp, FLOOR_BP), rel=1e-3)


def test_a_leg_with_no_fee_to_measure_still_clears_its_own_rounding():
    """A wrap charges nothing, and still must not revert on a wei."""
    victim, quote = 10**22, 10**22
    rate = bound_for(victim, quote, 0.0)
    granted = (1 - rate / (quote * ONE // victim)) * 1e4
    assert granted == pytest.approx(FLOOR_BP, rel=1e-3)
    assert 0 < granted < 1.0, "a dust floor, not a slippage allowance"


# ------------------------------------------------------- when it pays at all


def impact_of(pool, i: int, j: int, dx: int) -> float:
    """The leg's own slippage: its rate at this size against its rate at dust.

    The fee is in both and cancels, so what is left is the curve.
    """
    dust = max(1, dx // 10**6)
    near, full = pool.get_dy(i, j, dust), pool.get_dy(i, j, dx)
    if near <= 0 or full <= 0:
        return 0.0
    return 1.0 - (full / dx) / (near / dust)


def best_bounded_attack(pool, i, j, victim, min_rate):
    """The most an attacker can make with the victim's bound in force.

    Bounded is the only interesting version.  An attacker allowed to front-run
    the whole pool can always show a profit, and would be refused instantly.
    """
    reserve = pool.reserves[i] if hasattr(pool, "reserves") else pool.balances[i]
    best = None
    for k in range(1, 41):
        front = int(reserve * k / 40)
        try:
            profit, got, _ = run_sandwich(pool, i, j, front, victim)
        except Exception:                       # a size the pool refuses
            continue
        if settles(victim, got, min_rate):
            best = profit if best is None else max(best, profit)
    return best or 0


@pytest.mark.parametrize("fee_bp", [1.0, 4.0, 30.0, 100.0])
def test_a_leg_flatter_than_twice_its_fee_cannot_be_sandwiched_at_all(fee_bp):
    """The condition is the leg's own impact against twice the pool's fee.

    The attacker pays two fees on their own size and is paid the displacement
    the victim causes, so below `impact = 2 * fee` the round trip loses whatever
    the victim is willing to tolerate.  Above it the attack pays and the bound
    caps it instead.  This is the property the router's splitting buys, and it
    is why `t` scales an attack rather than preventing one.
    """
    fee = fee_bp / 1e4
    reserve = 10**24
    pool = Cpmm(reserve, reserve, int(fee * FEE_DENOMINATOR))
    for share in (0.1, 0.5, 2.0, 8.0):
        victim = int(share * 2 * fee * reserve)
        if victim < 10**18:
            continue
        quote = pool.get_dy(0, 1, victim)
        impact = impact_of(pool, 0, 1, victim)
        # Unbounded, so only the economics decides.
        profit = max(run_sandwich(pool, 0, 1, f, victim)[0]
                     for f in (10**20, 10**21, 10**22, 10**23, 10**24))
        assert (profit > 0) == (impact > 2 * fee), (
            f"{fee_bp} bp pool, impact {impact * 1e4:.2f} bp against "
            f"{2 * fee * 1e4:.2f} bp: profit {profit:,}")
        if impact <= 2 * fee:
            # And a fortiori with the bound on.
            rate = bound_for(victim, quote, fee)
            assert best_bounded_attack(pool, 0, 1, victim, rate) <= 0


def test_a_stableswap_leg_at_the_sizes_we_route_is_out_of_reach():
    """Where the router actually operates, the attack loses money outright.

    Measured on live mainnet routes: every stableswap leg came in under
    `impact = 2 * fee` -- 0.11 bp of impact at 2.9% of the pool against a 3 bp
    doubled fee -- while ten of thirty-one cryptoswap legs sat above it.  The
    difference is the invariant, not the tolerance.
    """
    pool = stable(fee=4 * 10**6)
    fee = 4e-4
    for theta in (0.001, 0.01, 0.05, 0.1):
        victim = int(theta * pool.balances[0])
        impact = impact_of(pool, 0, 1, victim)
        assert impact < 2 * fee, (
            f"a stableswap at {theta:.1%} of reserve has {impact * 1e4:.2f} bp "
            f"of impact against a {2 * fee * 1e4:.2f} bp doubled fee")
        rate = bound_for(victim, pool.get_dy(0, 1, victim), fee)
        assert best_bounded_attack(pool, 0, 1, victim, rate) <= 0


# --------------------------------------------------------------- stateful


class Sandwiching(RuleBasedStateMachine):
    """One real stableswap, traded and attacked in an order nobody chose.

    The pool carries a dynamic fee and keeps the fees it earns, so every attack
    lands on a pool the previous ones have already moved -- which is the case a
    single-shot test cannot reach.
    """

    def __init__(self):
        super().__init__()
        self.pool = stable(dynamic=2 * FEE_DENOMINATOR)
        self.settled = 0
        self.refused = 0
        self.worst_bp = 0.0
        self.worst_allowed_bp = 0.0

    @rule(dx=st.integers(min_value=10**18, max_value=10**23),
          i=st.integers(min_value=0, max_value=1))
    def someone_else_trades(self, dx, i):
        """Ordinary flow, so attacks meet a pool that has already moved."""
        if dx >= self.pool.balances[i] // 2:
            return
        try:
            _, self.pool = self.pool.exchange(i, 1 - i, dx)
        except Exception:                       # a size the pool refuses
            return

    @rule(front=st.integers(min_value=0, max_value=10**23),
          victim=st.integers(min_value=10**19, max_value=10**23),
          i=st.integers(min_value=0, max_value=1))
    def a_sandwich_is_attempted(self, front, victim, i):
        j = 1 - i
        if max(front, victim) >= self.pool.balances[i] // 4:
            return
        try:
            quote = self.pool.get_dy(i, j, victim)
            fee = charged_fee(self.pool, i, j, victim)
            profit, got, _ = run_sandwich(self.pool, i, j, front, victim)
        except Exception:                       # the pool refused the size
            return
        if quote <= 0 or fee is None:
            return
        rate = bound_for(victim, quote, fee)
        allowed = 1 - rate / (quote * ONE // victim)
        if not settles(victim, got, rate):
            self.refused += 1
            return
        self.settled += 1
        shortfall = (quote - got) / quote
        assert shortfall <= allowed + 1e-9, (
            f"settled {shortfall * 1e4:.4f} bp below the quote against a "
            f"{allowed * 1e4:.4f} bp bound, front-run {front:,}")
        self.worst_bp = max(self.worst_bp, shortfall * 1e4)
        self.worst_allowed_bp = max(self.worst_allowed_bp, allowed * 1e4)
        # The attack settled, so the pool it left behind is the next one's.
        if profit > 0:
            _, self.pool = self.pool.exchange(i, j, victim)

    @invariant()
    def the_pool_is_still_a_pool(self):
        assert all(b > 0 for b in self.pool.balances)

    @invariant()
    def nothing_leaked_past_its_bound(self):
        assert self.worst_bp <= self.worst_allowed_bp + 1e-9


Sandwiching.TestCase.settings = settings(
    max_examples=25, stateful_step_count=12, deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)
TestSandwiching = Sandwiching.TestCase


def test_the_harness_reaches_both_outcomes():
    """A guard on the guards above: a bound that always refused, or one that
    always settled, would pass every assertion here while testing nothing."""
    settled = refused = profitable = 0
    for fee_bp in (0.5, 4.0, 100.0):
        pool = Cpmm(10**24, 10**24, int(fee_bp / 1e4 * FEE_DENOMINATOR))
        for victim in (10**19, 10**21, 10**23):
            quote = pool.get_dy(0, 1, victim)
            rate = bound_for(victim, quote, fee_bp / 1e4)
            for front in (0, 10**20, 10**22, 10**24):
                profit, got, _ = run_sandwich(pool, 0, 1, front, victim)
                profitable += front > 0 and profit > 0
                if settles(victim, got, rate):
                    settled += 1
                else:
                    refused += 1
    assert settled > 5 and refused > 5 and profitable > 5, (
        f"{settled} settled, {refused} refused, {profitable} paid")
