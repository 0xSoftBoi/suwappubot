"""The two charges on a route's shape must not both be levied (§11.1).

Gas and the branching premium answer the same question -- what is one more leg
worth avoiding -- so `shape_cost` takes the larger.  Measured on
USDC->crvUSD at $5M, where a 0.02 bp premium on a $5M trade is ~$10 a leg and
the gas it was being added to is under a cent: whichever charge is noise should
contribute nothing, not stack.
"""

import pytest

from erouter.core.gas import (
    SPLIT_OVERHEAD,
    STATIC,
    TX_BASE,
    plan_gas,
    shape_cost,
    value_per_gas,
)
from erouter.core.types import ArcKind, Leg


def leg(kind: ArcKind = ArcKind.SWAP_STABLE) -> Leg:
    return Leg(target="0x" + "11" * 20, kind=kind, i=0, j=1, n=2,
               src_slot=0, dst_slot=1, bps=0)


def test_premium_alone_when_gas_is_not_priced():
    """No gas price, no gas charge -- the behaviour before gas could be valued."""
    legs = [leg(), leg()]
    cost = shape_cost(legs, [False, False], value=1e6, leg_cost_bp=0.02,
                      per_gas=0.0)
    assert cost == 1e6 * 2 * 0.02 / 1e4


def test_takes_the_larger_charge_not_the_sum():
    legs = [leg()]
    per_gas = 1e-6  # a cent per 10k gas, roughly
    gas = STATIC.gas(legs[0].kind, legs[0].target, legs[0].i, legs[0].j)
    fixed = (plan_gas(legs, STATIC) - gas) * per_gas

    # Large trade: the premium dwarfs the gas, so the gas must not show up.
    big = shape_cost(legs, [False], value=5e6, leg_cost_bp=0.02, per_gas=per_gas)
    premium = 5e6 * 0.02 / 1e4
    assert premium > gas * per_gas
    assert big == fixed + premium

    # Small trade: the gas dwarfs the premium, so the premium must not either.
    small = shape_cost(legs, [False], value=100.0, leg_cost_bp=0.02,
                       per_gas=per_gas)
    assert 100.0 * 0.02 / 1e4 < gas * per_gas
    assert small == fixed + gas * per_gas

    # And in both cases strictly less than charging both.
    assert big < fixed + premium + gas * per_gas
    assert small < fixed + 100.0 * 0.02 / 1e4 + gas * per_gas


def test_conversions_pay_gas_but_no_premium():
    """A wrap is a leg to the executor, not a branch the router chose."""
    legs = [leg(), leg()]
    per_gas = 1e-9  # small enough that the premium would win if it applied
    both = shape_cost(legs, [False, False], value=1e6, leg_cost_bp=0.02,
                      per_gas=per_gas)
    one = shape_cost(legs, [False, True], value=1e6, leg_cost_bp=0.02,
                     per_gas=per_gas)
    premium = 1e6 * 0.02 / 1e4
    gas = STATIC.gas(legs[1].kind, legs[1].target, legs[1].i, legs[1].j)
    assert both - one == pytest.approx(premium - gas * per_gas)
    assert premium > gas * per_gas


def test_fixed_cost_is_charged_whole():
    """The transaction itself has no branching counterpart to compete with."""
    legs = [leg(), leg()]
    per_gas = 1e-6
    cost = shape_cost(legs, [True, True], value=1e9, leg_cost_bp=0.02,
                      per_gas=per_gas)
    per_leg = sum(STATIC.gas(x.kind, x.target, x.i, x.j) for x in legs)
    assert cost == plan_gas(legs, STATIC) * per_gas
    assert plan_gas(legs, STATIC) == TX_BASE + SPLIT_OVERHEAD + per_leg


def test_value_per_gas_zero_without_a_price():
    assert value_per_gas(0, 3000.0) == 0.0
    assert value_per_gas(int(1e9), 0.0) == 0.0
