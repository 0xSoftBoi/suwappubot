"""Deposits and withdrawals, on the invariant the swap models already run.

An LP arc asks a different question of the same curve: not "what does `i` become
when `j` moves at constant `D`" but "what does `i` become when `D` itself moves".
That is `solve_y_d`, and the two conventions around it were read off the deployed
3pool (`0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7`) rather than guessed:

* `calc_token_amount` charges **no fee**.  Its own docstring says it is "needed
  to prevent front-running, not for precise calculations".
* `calc_withdraw_one_coin` charges `fee * N / (4 * (N - 1))` on each coin's
  *imbalance against the ideal*, not on the output, then returns one wei less.

Against mainnet, four of the five pools carrying LP arcs reproduce their own
`calc_withdraw_one_coin` to the wei.  The fifth is stableswap-ng, which charges
its dynamic per-coin fee instead of the flat one -- off by 1,631 wei on a
575,757,635 withdrawal, which is a fee convention and not a broken solver.
"""

from __future__ import annotations

import pytest

from erouter.core.stableswap import StableSwap, StableSwapError, StableSwapLP, solve_y_d

UNIT = 10**18
BALANCED = StableSwap(
    balances=(1_000_000 * UNIT, 1_000_000 * UNIT, 1_000_000 * UNIT),
    rates=(UNIT, UNIT, UNIT),
    amp=2000, fee=4_000_000, offpeg_fee_multiplier=0,
    a_precision=1, fee_on_xp=False,
)
SUPPLY = 3_000_000 * UNIT


def lp(pool=BALANCED, supply=SUPPLY):
    return StableSwapLP(pool=pool, total_supply=supply)


def test_reducing_d_reduces_the_balance():
    """The whole point of `solve_y_d`: `D` moves, the others are held."""
    xp = BALANCED.xp()
    d0 = BALANCED.d()
    same = solve_y_d(BALANCED.amp, BALANCED.a_precision, xp, d0, 0, 3)
    smaller = solve_y_d(BALANCED.amp, BALANCED.a_precision, xp, d0 * 99 // 100, 0, 3)
    assert abs(same - xp[0]) <= 2, "at the pool's own D, nothing should move"
    assert smaller < same


def test_depositing_nothing_mints_nothing():
    assert lp().calc_token_amount([0, 0, 0], True) == 0


def test_a_balanced_deposit_mints_in_proportion():
    """No fee and no imbalance, so LP scales with the value added."""
    minted = lp().calc_token_amount([1_000 * UNIT] * 3, True)
    assert minted == pytest.approx(SUPPLY * 3_000 / 3_000_000, rel=1e-6)


def test_a_one_sided_deposit_mints_less_than_a_balanced_one():
    """Slippage, which `calc_token_amount` does account for."""
    balanced = lp().calc_token_amount([1_000 * UNIT] * 3, True)
    one_sided = lp().calc_token_amount([3_000 * UNIT, 0, 0], True)
    assert one_sided < balanced


def test_withdrawing_one_coin_pays_less_than_the_ideal_share():
    """The imbalance fee, and the one wei the pool keeps."""
    burn = SUPPLY // 1000
    got = lp().calc_withdraw_one_coin(burn, 0)
    ideal = 3_000 * UNIT          # 0.1% of a 3,000,000 pool, taken in one coin
    assert 0 < got < ideal


def test_withdrawing_more_than_exists_is_refused():
    with pytest.raises(StableSwapError):
        StableSwapLP(pool=BALANCED, total_supply=0).calc_withdraw_one_coin(1, 0)
    with pytest.raises(StableSwapError):
        lp().calc_withdraw_one_coin(SUPPLY // 100, 7)


def test_a_bigger_withdrawal_pays_proportionally_less_per_lp():
    """Curvature: the larger the single-sided exit, the worse the rate."""
    small = lp().calc_withdraw_one_coin(SUPPLY // 10_000, 0)
    large = lp().calc_withdraw_one_coin(SUPPLY // 100, 0)
    assert large / 100 < small, "a 1% exit should price worse per LP than 0.01%"


# --------------------------------------------------- the float fast path

@pytest.mark.parametrize("frac", [1e-6, 1e-4, 1e-2, 0.1])
def test_the_float_deposit_tracks_the_integer_one(frac):
    pool_lp = lp()
    dx = int(pool_lp.pool.balances[0] * frac)
    amounts = [dx if k == 0 else 0 for k in range(pool_lp.n)]
    exact = pool_lp.calc_token_amount(amounts, True)
    fast = pool_lp.calc_token_amount_fast(amounts, True)
    assert exact > 0
    assert abs(fast / exact - 1.0) * 1e4 < 0.01


@pytest.mark.parametrize("frac", [1e-6, 1e-4, 1e-2, 0.1])
def test_the_float_withdrawal_tracks_the_integer_one(frac):
    """The imbalance fee stays integer; only the invariants move to floats."""
    pool_lp = lp()
    burn = int(pool_lp.total_supply * frac)
    exact = pool_lp.calc_withdraw_one_coin(burn, 0)
    fast = pool_lp.calc_withdraw_one_coin_fast(burn, 0)
    assert exact > 0
    assert abs(fast / exact - 1.0) * 1e4 < 0.01


# ------------------------------------------------- what a deposit really pays
#
# `calc_token_amount` is fee-free on the legacy pools by its own admission, so it
# over-states every deposit: on the gnosis 3pool, a $100,000 single-sided deposit
# quotes 1.7 bp better than it executes.  `add_liquidity` is the executable
# number, and the pool it leaves behind is what a second leg must be priced
# against.

GNOSIS_3POOL = {
    "balances": (142638 * 10**18, 153563 * 10**6, 246110 * 10**6),
    "rates": (10**18, 10**30, 10**30),
    "amp": 200 * 100,
    "fee": 3 * 10**6,
    "a_precision": 100,
    "fee_on_xp": True,
    "admin_fee": 5 * 10**9,
}


def _lp(**over):
    from erouter.core.stableswap import StableSwap, StableSwapLP

    return StableSwapLP(pool=StableSwap(**{**GNOSIS_3POOL, **over}),
                        total_supply=520_000 * 10**18)


def test_a_balanced_deposit_pays_no_imbalance_fee():
    """The fee is on the *imbalance*, so a deposit in pool proportion is free.

    This is the test that says the fee is being charged on the right
    quantity: charge it on the deposit instead and this fails immediately.
    """
    lp = _lp()
    pool = lp.pool
    d0 = pool.d()
    # In proportion to the current balances, so `ideal` and `new` coincide.
    amounts = [b // 100 for b in pool.balances]
    free = lp.calc_token_amount(amounts, True)
    real, _ = lp.add_liquidity(amounts)
    assert abs(free - real) * 10**6 < free, "a balanced deposit is ~fee-free"
    assert d0 > 0


def test_a_one_sided_deposit_mints_less_than_the_getter_promises():
    lp = _lp()
    amounts = [100_000 * 10**18, 0, 0]
    free = lp.calc_token_amount(amounts, True)
    real, _ = lp.add_liquidity(amounts)
    assert real < free, "the getter does not charge the imbalance fee"
    assert (free / real - 1) * 1e4 < 100, "and the gap is basis points, not %"


def test_the_pool_keeps_everything_but_the_dao_share():
    """Two different subtractions: the mint is priced against balances less
    the whole fee, the pool keeps all but the admin part."""
    amounts = [100_000 * 10**18, 0, 0]
    kept, after_kept = _lp(admin_fee=0).add_liquidity(amounts)
    taken, after_taken = _lp(admin_fee=5 * 10**9).add_liquidity(amounts)
    assert kept == taken, "the depositor pays the same either way"
    assert after_kept.pool.balances[0] > after_taken.pool.balances[0]
    # With no admin fee the whole deposit stays in the pool.
    assert after_kept.pool.balances[0] == GNOSIS_3POOL["balances"][0] + amounts[0]


def test_the_supply_grows_by_what_was_minted():
    lp = _lp()
    minted, after = lp.add_liquidity([100_000 * 10**18, 0, 0])
    assert after.total_supply == lp.total_supply + minted


def test_advancing_needs_the_admin_fee_and_a_supply():
    import pytest

    from erouter.core.stableswap import StableSwapError

    with pytest.raises(StableSwapError, match="admin_fee"):
        _lp(admin_fee=-1).add_liquidity([10**18, 0, 0])
    empty = _lp()
    object.__setattr__(empty, "total_supply", 0)
    with pytest.raises(StableSwapError, match="no supply"):
        empty.add_liquidity([10**18, 0, 0])


def test_add_liquidity_refuses_a_deposit_that_moves_nothing():
    import pytest

    from erouter.core.stableswap import StableSwapError

    with pytest.raises(StableSwapError):
        _lp().add_liquidity([0, 0, 0])


def test_the_getter_over_states_what_a_deposit_mints():
    """`calc_token_amount` takes no fee; `add_liquidity` charges one.

    The gap is the whole point of pricing deposits by the second: a router
    that quotes the getter promises a mint the deposit does not pay.
    """
    amounts = [0, 0, 100_000 * UNIT]
    free = lp().calc_token_amount(amounts, True)
    charged = lp().calc_token_amount_charged(amounts)
    assert charged < free, "the imbalance fee was not charged"
    # A balanced deposit is not imbalancing, so it pays nothing.
    even = [50_000 * UNIT] * 3
    assert lp().calc_token_amount_charged(even) == lp().calc_token_amount(even, True)


def test_the_charged_mint_is_what_add_liquidity_returns():
    """One arithmetic, two callers -- the state is the only difference."""
    amounts = [0, 0, 100_000 * 10**6]
    minted, _ = _lp().add_liquidity(amounts)
    assert _lp().calc_token_amount_charged(amounts) == minted


def test_the_mint_does_not_need_the_admin_fee():
    """The DAO's share changes what the pool keeps, never what you are given.

    Which is why pricing a deposit is available to every modelled pool, and
    not only to the ones `admin_fee` could be read from.
    """
    amounts = [0, 0, 100_000 * 10**6]
    assert (_lp(admin_fee=-1).calc_token_amount_charged(amounts)
            == _lp(admin_fee=5 * 10**9).calc_token_amount_charged(amounts))


def test_the_float_path_tracks_the_integer_one():
    """`_price` takes the fast path, so it has to agree to well under a bp."""
    for size in (UNIT, 1_000 * UNIT, 100_000 * UNIT, 500_000 * UNIT):
        amounts = [0, 0, size]
        exact = lp().calc_token_amount_charged(amounts)
        fast = lp().calc_token_amount_charged_fast(amounts)
        assert abs(fast - exact) / exact * 10_000 < 0.01, (
            f"float deposit is {abs(fast - exact) / exact * 10_000:.4f} bp "
            f"off the integer one at {size}")


def test_the_charged_getter_refuses_a_deposit_that_moves_nothing():
    with pytest.raises(StableSwapError):
        lp().calc_token_amount_charged([0, 0, 0])
