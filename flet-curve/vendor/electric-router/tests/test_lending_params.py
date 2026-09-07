"""The lending pools: stableswap with wrapped tokens.

`cDAI/cUSDC` is the first Curve pool ever deployed and still quotes.  Nothing
about its invariant is unusual -- what is unusual is where its rates come from,
and that its coin list runs past its balances.
"""

from __future__ import annotations

from erouter.chain.lending_params import LENDING_PRECISION, VARIANTS, candidates
from erouter.core.stableswap import PRECISION, StableSwap


class Coin:
    def __init__(self, decimals, address="0x" + "11" * 20, symbol="X"):
        self.decimals = decimals
        self.address = address
        self.symbol = symbol


class Pool:
    def __init__(self, coins, balances, name="pool"):
        self.coins = coins
        self.balances = balances
        self.name = name
        self.address = "0x" + "22" * 20


def test_a_wrapped_pool_is_recognised_by_its_trailing_zeros():
    """cDAI/cUSDC lists four coins and holds two.

    The underlying pair is listed because `exchange_underlying` trades it, and
    reported with a zero balance.  `all(pool.balances)` reads that as an empty
    pool, which is why the first Curve pool was never offered to any builder.
    """
    pool = Pool([Coin(8), Coin(8), Coin(18), Coin(6)],
                [833963285690023, 1412413376521133, 0, 0])
    got = candidates([pool])
    assert got and got[0][1] == 2, "should see two held coins of four listed"


def test_a_genuinely_empty_pool_is_not_a_lending_pool():
    pool = Pool([Coin(18), Coin(18)], [0, 0])
    assert candidates([pool]) == []


def test_a_full_pool_is_not_a_lending_pool():
    pool = Pool([Coin(18), Coin(18)], [10**21, 10**21])
    assert candidates([pool]) == []


def test_the_variants_cover_both_deployed_shapes():
    """The generation is not one implementation.

    The Compound pools take a static fee in token space and round the output
    down by a wei; the Aave pool takes a dynamic fee in `xp` space and keeps
    it.  Both shapes have to be reachable, or one family is unmodellable.
    """
    assert (False, True) in VARIANTS, "Compound: token-space fee, minus one wei"
    assert (True, False) in VARIANTS, "Aave: dynamic xp fee, keeps the wei"


def test_keeping_the_wei_is_worth_exactly_one_wei():
    """`subtract_one` is the whole difference between the two roundings."""
    shaped = {"balances": (10**24, 10**24), "rates": (PRECISION, PRECISION),
                  "amp": 10_000, "fee": 4_000_000, "a_precision": 100}
    keeps = StableSwap(subtract_one=False, **shaped)
    rounds = StableSwap(subtract_one=True, **shaped)
    dx = 10**21
    assert keeps.get_dy(0, 1, dx) - rounds.get_dy(0, 1, dx) == 1


def test_a_coin_that_is_not_lent_is_worth_one_underlying():
    """`LENDING_PRECISION` is the rate of a coin with no wrapper."""
    assert LENDING_PRECISION == 10**18


# ------------------------------------------------------------- rate pools

def test_the_wrapper_rate_sources_cover_the_deployed_shapes():
    """Each pool's `_stored_rates` is `@internal`, so the wrapper is asked.

        ETH/rETH   [PRECISION, rETH.getExchangeRate()]
        ETH/aETH   [PRECISION, PRECISION * LENDING_PRECISION / aETH.ratio()]

    `ratio()` is the *inverse* -- ankrETH reports how much ankrETH one ETH
    buys -- and reading it as a rate directly would value the pool upside
    down rather than merely wrongly.
    """
    from erouter.chain.lending_params import RATE_SOURCES

    sources = dict(RATE_SOURCES)
    assert "getExchangeRate()" in sources
    assert sources["getExchangeRate()"](11 * 10**17) == 11 * 10**17

    # ankrETH at a ratio of 0.8 is worth 1.25 ETH, not 0.8.
    inverted = sources["ratio()"](8 * 10**17)
    assert inverted == 10**36 // (8 * 10**17) == 1_250_000_000_000_000_000


def test_the_redemption_price_is_scaled_from_27_decimals():
    """RAI's snapshot carries 27 decimals; `xp` wants 18."""
    from erouter.chain.lending_params import REDEMPTION_PRICE_SCALE

    snapped = 3_059_000_000_000_000_000_000_000_000        # ~3.059, 27 dp
    assert snapped // REDEMPTION_PRICE_SCALE == 3_059_000_000_000_000_000


def test_a_zero_ratio_does_not_divide_by_zero():
    """A wrapper answering zero is not a rate of infinity."""
    from erouter.chain.lending_params import RATE_SOURCES

    sources = dict(RATE_SOURCES)
    assert sources["ratio()"](0) == 0
