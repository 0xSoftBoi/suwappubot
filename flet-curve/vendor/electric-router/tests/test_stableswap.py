"""`core.stableswap` against the contracts, to the wei (§11.3).

The module exists to agree with the chain exactly, so the test is the difference
against it.  These vectors were read from mainnet at block 25,770,648 --
balances, `A`, fee, `offpeg_fee_multiplier`, `stored_rates`, and what `get_dy`
returned for each -- so the check needs no node.

Both dialects and both fee conventions are represented: 3pool takes its fee
after converting back to token units and is off by a wei the other way round,
and two of these pools charge a *dynamic* fee that rises as the trade pushes
them off peg -- the term the quadratic model handles worst.
"""

from __future__ import annotations

import pytest

from erouter.core import stableswap
from erouter.core.stableswap import StableSwap, StableSwapError

VECTORS = {
    'threepool': {
        'balances': (25450000660957548614289897, 24879539770247, 109145012346349), 'rates': (1000000000000000000, 1000000000000000000000000000000, 1000000000000000000000000000000),
        'amp': 4000, 'fee': 1500000, 'offpeg_fee_multiplier': 0,
        'a_precision': 1, 'fee_on_xp': False,
        'quotes': [(0, 1, 1000000000000000000000, 999823974), (0, 1, 1000000000000000000000000, 999778303007), (0, 1, 5000000000000000000000000, 4997923644929), (1, 0, 1000000000, 999875935372046094331), (1, 0, 1000000000000, 999830424812050963192325), (1, 0, 5000000000000, 4998205092222291097529518)]},
    'crvusd_usdt': {
        'balances': (22751800499951, 23119668623353096970379594), 'rates': (1000000000000000000000000000000, 1000000000000000000),
        'amp': 200000, 'fee': 1000000, 'offpeg_fee_multiplier': 0,
        'a_precision': 100, 'fee_on_xp': True,
        'quotes': [(0, 1, 1000000000, 999907993998223469328), (0, 1, 1000000000000, 999886209681718173199129), (0, 1, 5000000000000, 4998972175915511306548738), (1, 0, 1000000000000000000000, 999891962), (1, 0, 1000000000000000000000000, 999870117611), (1, 0, 5000000000000000000000000, 4998883843804)]},
    'strategic_usd': {
        'balances': (759122283993, 5733213545533), 'rates': (1000000000000000000000000000000, 1000000000000000000000000000000),
        'amp': 1000000, 'fee': 100000, 'offpeg_fee_multiplier': 200000000000,
        'a_precision': 100, 'fee_on_xp': True,
        'quotes': [(0, 1, 1000000000, 1000874136), (0, 1, 1000000000000, 1000359491230), (0, 1, 5000000000000, 4999925919513), (1, 0, 1000000000, 999079048), (1, 0, 1000000000000, 757008912892), (1, 0, 5000000000000, 759011037462)]},
    'crvusd_frxusd': {
        'balances': (3294706639764884934677896, 9793190462986415930077796), 'rates': (1000000000000000000, 1000000000000000000),
        'amp': 200000, 'fee': 1000000, 'offpeg_fee_multiplier': 50000000000,
        'a_precision': 100, 'fee_on_xp': True,
        'quotes': [(0, 1, 1000000000000000000000, 1000749040280441566013), (0, 1, 1000000000000000000000000, 1000515347728170852411748), (0, 1, 5000000000000000000000000, 5000312180335154695652134), (1, 0, 1000000000000000000000, 999001965394135667289), (1, 0, 1000000000000000000000000, 998553375772730931210750), (1, 0, 5000000000000000000000000, 3288569555708714101718864)]},
}


def pool_from(spec) -> StableSwap:
    return StableSwap(**{k: v for k, v in spec.items() if k != "quotes"})


@pytest.mark.parametrize("name", sorted(VECTORS))
def test_get_dy_matches_the_chain_to_the_wei(name):
    spec = VECTORS[name]
    pool = pool_from(spec)
    for i, j, dx, expected in spec["quotes"]:
        assert pool.get_dy(i, j, dx) == expected, (
            f"{name} {i}->{j} at {dx}: {pool.get_dy(i, j, dx)} != {expected}")


@pytest.mark.parametrize("name", sorted(VECTORS))
def test_the_invariant_is_stable_under_a_round_trip(name):
    """`D` must not move when a trade is undone -- it is the conserved thing."""
    spec = VECTORS[name]
    pool = pool_from(spec)
    xp = pool.xp()
    before = pool.d(xp)
    i, j = 0, 1
    x = xp[i] + xp[i] // 100
    y = pool.y(i, j, x, xp, before)
    after = pool.d([x if k == i else (y if k == j else v) for k, v in enumerate(xp)])
    assert abs(after - before) <= 2, (after, before)


def test_the_dynamic_fee_rises_off_peg():
    """A pool pushed off peg charges more, and at peg charges exactly `fee`."""
    spec = VECTORS["strategic_usd"]
    pool = pool_from(spec)
    assert pool.offpeg_fee_multiplier > 10**10
    at_peg = pool.dynamic_fee(1_000_000, 1_000_000)
    off_peg = pool.dynamic_fee(200_000, 1_800_000)
    assert at_peg == pool.fee
    assert off_peg > at_peg


def test_a_static_fee_pool_ignores_the_multiplier():
    spec = VECTORS["crvusd_usdt"]
    pool = pool_from(spec)
    assert pool.offpeg_fee_multiplier == 0
    assert pool.dynamic_fee(100, 900) == pool.fee


def test_a_nonsense_trade_is_refused_rather_than_guessed():
    spec = VECTORS["crvusd_usdt"]
    pool = pool_from(spec)
    assert pool.get_dy(0, 1, 0) == 0
    assert pool.get_dy(0, 1, -5) == 0
    with pytest.raises(StableSwapError):
        pool.y(0, 0, 1)


def test_an_empty_pool_is_an_error_not_a_zero():
    empty = StableSwap(balances=(0, 10**18), rates=(10**18, 10**18),
                       amp=20000, fee=1000000)
    with pytest.raises(StableSwapError):
        empty.d()


# --------------------------------------------------- the float fast path

def _pool(balances, amp=200, fee=4_000_000):
    n = len(balances)
    return StableSwap(balances=tuple(balances),
                      rates=tuple([stableswap.PRECISION] * n),
                      amp=amp, fee=fee)


@pytest.mark.parametrize("amp", [10, 200, 5000, 50_000])
@pytest.mark.parametrize("skew", [1.0, 1.5, 8.0])
def test_the_float_invariant_tracks_the_integer_one(amp, skew):
    """`d_fast` is the same `D` the contract computes, to double precision.

    The integer form *is* the contract and is what the admission gate checks;
    this one prices with it thousands of times per quote, so it has to agree
    to far better than any tick that could reorder two candidates.
    """
    pool = _pool([1_000_000 * 10**18, int(1_000_000 * skew) * 10**18], amp=amp)
    xp = pool.xp()
    exact = pool.d(xp)
    fast = stableswap.d_fast([float(v) for v in xp], float(amp), 100.0, 2)
    assert abs(fast / exact - 1.0) < 1e-12


@pytest.mark.parametrize("frac", [1e-6, 1e-4, 1e-2, 0.1, 0.5])
@pytest.mark.parametrize("amp", [10, 200, 5000])
def test_the_float_quote_tracks_the_integer_one(frac, amp):
    pool = _pool([2_000_000 * 10**18, 3_000_000 * 10**18], amp=amp)
    dx = int(pool.balances[0] * frac)
    exact = pool.get_dy(0, 1, dx)
    fast = pool.get_dy_fast(0, 1, dx)
    assert exact > 0
    # 0.01 bp is the bound the mainnet sweep came in three orders under.
    assert abs(fast / exact - 1.0) * 1e4 < 0.01


def test_the_float_path_refuses_what_the_integer_path_refuses():
    """An empty balance is not a number to be interpolated through."""
    pool = _pool([1_000_000 * 10**18, 0])
    with pytest.raises(stableswap.StableSwapError):
        stableswap.d_fast([1e24, 0.0], 200.0, 100.0, 2)
    assert pool.get_dy_fast(0, 1, 0) == 0


def test_replacing_a_balance_does_not_carry_the_old_reserves():
    """`xp` is cached because the pool is frozen at a block.

    A copy with different balances is a different pool, so the cache must not
    travel with it -- `init=False` is what stops `dataclasses.replace` from
    passing it along and quoting the new reserves with the old ones.
    """
    import dataclasses

    pool = _pool([1_000_000 * 10**18, 1_000_000 * 10**18])
    pool.xp()                                   # fill the cache
    moved = dataclasses.replace(pool, balances=(2_000_000 * 10**18, 10**24))
    assert moved.xp() == [2_000_000 * 10**18, 10**24]
    assert moved.get_dy(0, 1, 10**18) != pool.get_dy(0, 1, 10**18)


# ----------------------------------------------------- advancing the state
#
# A route may not touch a pool twice (decision 3) because a view-only chained
# quoter cannot see its own earlier leg.  That is a limit of *asking the chain*,
# not of the arithmetic: for a pool the wei-exact gate admitted, the state after
# a trade is as computable as the trade itself.  On gnosis WXDAI->EURe at
# 100,000, splitting across two branches that both enter the 3pool returns
# 81,321 EURe against 66,074 for the single branch the rule permits.

GNOSIS_3POOL = {
    'balances': (142638 * 10**18, 153563 * 10**6, 246110 * 10**6),
    'rates': (10**18, 10**30, 10**30),
    'amp': 200 * 100,
    'fee': 3 * 10**6,
    'a_precision': 100,
    'fee_on_xp': True,
    'admin_fee': 5 * 10**9,
}


def test_the_trader_sees_the_same_number_either_way():
    """`exchange` must not quote differently from `get_dy`.

    They are the same trade; only one of them also reports what is left.  A
    difference here would mean a route priced one way and executed another.
    """
    pool = StableSwap(**GNOSIS_3POOL)
    for dx in (10**18, 1000 * 10**18, 50_000 * 10**18):
        dy, _ = pool.exchange(0, 1, dx)
        assert dy == pool.get_dy(0, 1, dx)


def test_advancing_without_the_admin_fee_is_refused():
    """Assuming zero would leave the pool richer than it is.

    The DAO's share leaves the pool, so a model that skipped it would quote
    the *next* leg through that pool too well -- and too well is the direction
    that invents value.
    """
    pool = StableSwap(**{**GNOSIS_3POOL, "admin_fee": -1})
    assert pool.get_dy(0, 1, 10**18) > 0, "quoting still works without it"
    with pytest.raises(StableSwapError, match="admin_fee"):
        pool.exchange(0, 1, 10**18)


def test_the_pool_keeps_the_lp_share_and_loses_the_dao_share():
    pool = StableSwap(**GNOSIS_3POOL)
    dx = 10_000 * 10**18
    dy, after = pool.exchange(0, 1, dx)
    assert after.balances[0] == pool.balances[0] + dx
    # Everything the trader took, plus the DAO's cut, left the `j` side.
    gone = pool.balances[1] - after.balances[1]
    assert gone > dy, "the admin fee leaves too"
    assert after.balances[2] == pool.balances[2], "an untouched coin is untouched"

    # With no admin fee the whole fee stays behind, so the pool keeps more.
    free = StableSwap(**{**GNOSIS_3POOL, "admin_fee": 0})
    _, after_free = free.exchange(0, 1, dx)
    assert after_free.balances[1] > after.balances[1]


def test_the_second_leg_is_priced_worse_than_the_first():
    """The point of the whole exercise: the pool moved.

    Without this the two legs of a double entry would each be quoted against
    the opening balances, which is precisely the over-count decision 3 exists
    to prevent.
    """
    pool = StableSwap(**GNOSIS_3POOL)
    dx = 20_000 * 10**18
    first, after = pool.exchange(0, 1, dx)
    assert after.get_dy(0, 1, dx) < first, "the same trade again must cost more"
    assert pool.get_dy(0, 1, dx) == first, "the original is not mutated"


def test_the_cached_xp_does_not_survive_the_advance():
    """`_xp` is a function of the balances, and the balances just changed.

    `init=False` on the cache is what makes `replace` drop it; this pins that,
    because carrying it across would quote the new pool with the old reserves
    and the numbers would still look plausible.
    """
    pool = StableSwap(**GNOSIS_3POOL)
    pool.xp()  # fill the cache
    _, after = pool.exchange(0, 1, 10_000 * 10**18)
    assert after.xp()[0] > pool.xp()[0]
    assert after.xp() == [b * r // 10**18
                          for b, r in zip(after.balances, after.rates,
                                          strict=True)]
