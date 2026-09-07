"""What a reused pool looks like to the leg after it.

Two quantities move on different legs, and both have to be carried:

* a **swap** moves the balances and leaves `total_supply` alone;
* a **deposit** mints, so it moves both.

Reading each from wherever it happened to be lying around is the bug this
pins.  The route that found it was 3pool three ways -- swap USDT->DAI,
deposit USDT->3Crv, withdraw 3Crv->DAI -- where the withdrawal burned
1.92e24 fresh LP against the *pre-deposit* supply of 153.4M, a 1.25% larger
share of `D` than it owns.  It reads as the deposit-and-withdraw round trip
being free, which is exactly the shape of a route worth distrusting.
"""

from __future__ import annotations

import pytest

from erouter.chain.exact_probe import ExactQuoterClient
from erouter.core.stableswap import StableSwap, StableSwapLP
from erouter.core.types import ArcKind, Leg

UNIT = 10**18
POOL = StableSwap(
    balances=(1_000_000 * UNIT, 1_000_000 * UNIT, 1_000_000 * UNIT),
    rates=(UNIT, UNIT, UNIT),
    amp=2000, fee=4_000_000, offpeg_fee_multiplier=0,
    a_precision=1, fee_on_xp=False, admin_fee=5_000_000_000,
)
SUPPLY = 3_000_000 * UNIT
POOL_ADDRESS = "0x" + "3c" * 20


class FakeSet:
    """The shape `ExactQuoterClient` reads: the two directions, each with a getter.

    Deposits and withdrawals are admitted separately by `build_exact_lp` -- a
    pool can reproduce one and not the other -- so a double that serves only
    `get` would let a caller drop the deposit path without any test noticing.
    """

    def __init__(self, model, deposits=True):
        self.by_pool = {POOL_ADDRESS: model}
        self.deposits = {POOL_ADDRESS: model} if deposits else {}

    def get(self, pool):
        return self.by_pool.get(pool.lower())

    def get_deposit(self, pool):
        return self.deposits.get(pool.lower())


def client() -> ExactQuoterClient:
    """An `ExactQuoterClient` that knows one pool and talks to nothing."""
    lp = StableSwapLP(pool=POOL, total_supply=SUPPLY)
    return ExactQuoterClient(None, FakeSet(POOL), lp=FakeSet(lp))


def leg(kind, i, j):
    return Leg(target=POOL_ADDRESS, kind=kind, i=i, j=j, n=3,
               src_slot=0, dst_slot=1, bps=0)


DEPOSIT = leg(ArcKind.DEPOSIT_FIXED, 2, 0)
WITHDRAW = leg(ArcKind.WITHDRAW_STABLE, 0, 0)
SWAP = leg(ArcKind.SWAP_STABLE, 2, 0)


def test_a_withdrawal_burns_against_the_supply_the_deposit_left():
    """The minted LP has to be in the supply it is then burned against."""
    quote = client()._stateful_leg([DEPOSIT, WITHDRAW])
    minted = quote(DEPOSIT, 100_000 * UNIT)
    got = quote(WITHDRAW, minted)

    grown = StableSwapLP(pool=POOL, total_supply=SUPPLY)
    _, after = grown.add_liquidity([0, 0, 100_000 * UNIT])
    assert after.total_supply > SUPPLY, "the deposit minted nothing"
    want = after.calc_withdraw_one_coin(minted, 0)
    assert got == pytest.approx(want, rel=1e-9), (
        "the withdrawal did not see the deposit's mint")

    # And the pre-deposit supply -- the figure this used to use -- is a
    # materially different, larger answer.
    stale = StableSwapLP(pool=after.pool, total_supply=SUPPLY)
    assert stale.calc_withdraw_one_coin(minted, 0) > want * 1.001, (
        "the bug and the fix are indistinguishable on these numbers")


def test_a_deposit_prices_into_the_balances_the_swap_left():
    """A swap moves the balances the deposit is then imbalancing against."""
    quote = client()._stateful_leg([SWAP, DEPOSIT, WITHDRAW])
    dy = quote(SWAP, 200_000 * UNIT)
    assert dy > 0
    minted = quote(DEPOSIT, 100_000 * UNIT)

    _, swapped = POOL.exchange(2, 0, 200_000 * UNIT)
    want, _ = StableSwapLP(pool=swapped,
                           total_supply=SUPPLY).add_liquidity([0, 0, 100_000 * UNIT])
    assert minted == want, "the deposit priced into pre-swap balances"


def test_a_swap_does_not_move_the_supply():
    """Only the balances -- a swap mints and burns nothing.

    Read through the deposit that follows it: the mint is `supply * dD / D0`,
    so a supply the swap had touched would show up here.
    """
    quote = client()._stateful_leg([SWAP, DEPOSIT, WITHDRAW])
    quote(SWAP, 200_000 * UNIT)
    minted = quote(DEPOSIT, 100_000 * UNIT)

    _, swapped = POOL.exchange(2, 0, 200_000 * UNIT)
    want, _ = StableSwapLP(pool=swapped,
                           total_supply=SUPPLY).add_liquidity([0, 0, 100_000 * UNIT])
    assert minted == want
