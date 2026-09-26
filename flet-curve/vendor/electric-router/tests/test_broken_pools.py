"""A pool that holds what it claims and still cannot price any of it.

`WETH/yETH` holds 43,294 wei of WETH against a coin whose supply is 2.35e56.
Its `get_virtual_price()` reverts, its own `get_dy` reverts at one wei, and it
was carried at $2,123,962 because the index prices that coin.  The probe grid
discarded its arcs on every run and it stayed in the universe, in every count,
and in the reference-price fit's TVL weights.

`check_reserves_are_real` cannot see it -- the balances it reports are the
balances it holds.  Two of 541 pools across seventeen chains fail this way, so
the survey runs from `scripts/find_broken_pools.py` and what it finds goes in
the chain's blacklist; see the function's docstring for why it is not on the
route path.
"""

from __future__ import annotations

from erouter.core.pools import Coin, PoolSpec
from erouter.core.quoter import Quote
from erouter.core.transport import Answer, Status
from erouter.core.types import Dialect
from erouter.dev.universe import check_the_invariant_answers


def _pool(address: str, name: str, balances=(10**20, 10**20)) -> PoolSpec:
    return PoolSpec(
        address=address, name=name, pool_type="factory",
        coins=(Coin("0x" + "01" * 20, "A", 18, 0), Coin("0x" + "02" * 20, "B", 18, 1)),
        tvl_usd=1_000.0, balances=balances, held=balances, dialect=Dialect.STABLE,
    )


class _Client:
    """Answers `get_virtual_price()` per pool and quotes per pool."""

    def __init__(self, reverts: set[str], quotes: set[str]):
        self.reverts, self.quotes = reverts, quotes
        self.asked: list[str] = []
        self.probed: list = []

    def raw(self, calls):
        self.asked.extend(c.to.lower() for c in calls)
        return [Answer(Status.REVERTED) if c.to.lower() in self.reverts
                else Answer(Status.VALUE, (10**18).to_bytes(32, "big"))
                for c in calls]

    def probe(self, probes):
        self.probed.extend(probes)
        return [Quote(Status.VALUE, 10**18)
                if p.pool.lower() in self.quotes else Quote(Status.REVERTED, 0)
                for p in probes]


# ------------------------------------------------------- dropping the broken


def test_a_pool_that_can_neither_price_nor_quote_is_dropped():
    broken = _pool("0x" + "69" * 20, "WETH/yETH")
    pools = [broken, _pool("0x" + "aa" * 20, "healthy")]
    warnings = check_the_invariant_answers(pools, _Client({broken.address.lower()}, set()))

    assert len(warnings) == 1 and "yETH" in warnings[0]
    assert broken.balances == (0, 0), (
        "the drop is expressed by zeroing the balances, which is what stops "
        "`build_arcs` offering anything from the pool"
    )
    assert pools[1].balances == (10**20, 10**20)


def test_a_llamma_reverts_here_and_must_survive_it():
    """The negative half, and the reason the check costs a second call.

    Every LLAMMA on mainnet reverts on `get_virtual_price()` -- it has no `D`
    and no virtual price by construction -- and every one of them quotes.  A
    rule written on the first call alone drops $24M of crvUSD liquidity.
    """
    llamma = _pool("0x" + "11" * 20, "crvUSD/wstETH")
    llamma.pool_type = "llamma"
    key = llamma.address.lower()
    warnings = check_the_invariant_answers([llamma], _Client({key}, {key}))

    assert warnings == []
    assert llamma.balances == (10**20, 10**20), (
        "a pool that answers its own get_dy was dropped for having no virtual "
        "price -- which is every LLAMMA there is"
    )


def test_a_pool_whose_virtual_price_answers_is_never_probed():
    """The check must stay free on the 538 pools in 541 that are fine."""
    pools = [_pool("0x" + f"{k:02x}" * 20, f"p{k}") for k in range(1, 6)]
    client = _Client(set(), set())
    assert check_the_invariant_answers(pools, client) == []
    assert not client.probed
    assert len(client.asked) == len(pools)


def test_an_empty_pool_is_left_to_the_reserve_check():
    """Nothing here should fire twice on a pool that already holds nothing."""
    empty = _pool("0x" + "ee" * 20, "empty", balances=(0, 0))
    client = _Client({empty.address.lower()}, set())
    assert check_the_invariant_answers([empty], client) == []
    assert not client.asked
