"""Pools that report more than they hold (dev-side, no chain).

`get_dy` runs the invariant over a pool's own `balances[]` storage and never
asks the token whether those coins exist.  When an issuer retires a token out
from under a pool the accounting keeps its old number, and the pool quotes
against liquidity it cannot pay -- a quote that reverts on execution, which is
worse than no quote at all.
"""

from __future__ import annotations

import pytest

from erouter.core.pools import Coin, PoolSpec
from erouter.core.transport import Answer, Status
from erouter.dev.universe import HELD_TOLERANCE, check_reserves_are_real

SUSD = "0x" + "51" * 20
SUSDE = "0x" + "52" * 20
WETH = "0x" + "c0" * 20
USDC = "0x" + "a0" * 20


def coin(address: str, symbol: str, decimals: int, index: int = 0) -> Coin:
    return Coin(address=address, symbol=symbol, decimals=decimals, index=index)


def pool(name: str, coins: list[Coin], balances: tuple[int, ...]) -> PoolSpec:
    return PoolSpec(
        address="0x" + f"{abs(hash(name)) % (16 ** 40):040x}",
        name=name,
        pool_type="main",
        coins=tuple(coins),
        balances=balances,
    )


class Holdings:
    """A chain where each token reports whatever we say it holds."""

    def __init__(self, held: dict[tuple[str, str], int], missing: set[str] | None = None):
        self.held = held
        self.missing = missing or set()
        self.calls = 0

    def raw(self, calls):
        self.calls += len(calls)
        out = []
        for call in calls:
            owner = "0x" + call.data[-20:].hex()
            if call.to.lower() in self.missing:
                out.append(Answer(Status.REVERTED))
                continue
            out.append(Answer(Status.VALUE,
                              self.held.get((call.to.lower(), owner.lower()), 0).to_bytes(32, "big")))
        return out


def test_a_pool_that_holds_nothing_is_dropped():
    p = pool("sUSD/sUSDe", [coin(SUSD, "sUSD", 18, 0), coin(SUSDE, "sUSDe", 18, 0)],
             (421_778 * 10 ** 18, 1_915 * 10 ** 18))
    chain = Holdings({(SUSD, p.address.lower()): 0,
                      (SUSDE, p.address.lower()): 1_915 * 10 ** 18})
    warnings = check_reserves_are_real([p], chain)
    assert len(warnings) == 1
    assert "sUSD" in warnings[0] and "holds 0.00" in warnings[0]
    assert not any(p.balances), "a dropped pool must produce no arcs"


def test_an_honest_pool_is_left_alone():
    p = pool("3pool-ish", [coin(USDC, "USDC", 6, 0), coin(SUSD, "DAI", 18, 0)],
             (1_000 * 10 ** 6, 1_000 * 10 ** 18))
    chain = Holdings({(USDC, p.address.lower()): 1_000 * 10 ** 6,
                      (SUSD, p.address.lower()): 1_000 * 10 ** 18})
    before = p.balances
    assert check_reserves_are_real([p], chain) == []
    assert p.balances == before


def test_being_a_little_short_is_not_being_rugged():
    """Rounding, in-flight transfers and rebasing all move a balance slightly."""
    held = int(1_000 * 10 ** 6 * (HELD_TOLERANCE + 0.25))
    p = pool("slightly short", [coin(USDC, "USDC", 6, 0)], (1_000 * 10 ** 6,))
    chain = Holdings({(USDC, p.address.lower()): held})
    assert check_reserves_are_real([p], chain) == []
    assert p.balances == (1_000 * 10 ** 6,)


def test_a_token_that_will_not_answer_is_not_evidence():
    """A reverting `balanceOf` says nothing about the reserves; do not guess."""
    p = pool("odd token", [coin(USDC, "USDC", 6, 0)], (1_000 * 10 ** 6,))
    chain = Holdings({}, missing={USDC})
    assert check_reserves_are_real([p], chain) == []
    assert p.balances == (1_000 * 10 ** 6,)


def test_a_pool_holding_native_eth_is_not_dropped():
    """E11: the $77M ETH/stETH pool holds native ETH against a WETH coin entry."""
    p = pool("ETH pool", [coin(WETH, "WETH", 18, 0), coin(USDC, "USDC", 6, 0)],
             (100 * 10 ** 18, 1_000 * 10 ** 6))
    chain = Holdings({(WETH, p.address.lower()): 0,
                      (USDC, p.address.lower()): 1_000 * 10 ** 6})

    class Node:
        pin = type("P", (), {"hex_block": "0x1"})()

        def fetch_multi(self, payloads, concurrent=False):
            # the pool's native balance covers the empty WETH slot
            return [hex(100 * 10 ** 18) for _ in payloads]

    assert check_reserves_are_real([p], chain, Node()) == []
    assert p.balances == (100 * 10 ** 18, 1_000 * 10 ** 6)


def test_a_zero_balance_coin_is_not_a_rug():
    """Lending pools list underlying coins at zero; that is shape, not a rug."""
    p = pool("lending", [coin(USDC, "aUSDC", 6, 0), coin(SUSD, "USDC", 6, 0)],
             (1_000 * 10 ** 6, 0))
    chain = Holdings({(USDC, p.address.lower()): 1_000 * 10 ** 6})
    assert check_reserves_are_real([p], chain) == []
    assert p.balances == (1_000 * 10 ** 6, 0)


def test_holdings_read_alongside_the_balances_cost_no_second_pass():
    """`read_balances` already asked, in a batch it was already sending."""
    p = pool("prefetched", [coin(USDC, "USDC", 6, 0), coin(SUSD, "sUSD", 18, 0)],
             (1_000 * 10 ** 6, 1_000 * 10 ** 18))
    p.held = (1_000 * 10 ** 6, 0)  # as `read_balances` would have left it
    chain = Holdings({})
    warnings = check_reserves_are_real([p], chain)
    assert chain.calls == 0, "the check must not re-ask what it already knows"
    assert warnings and not any(p.balances)


@pytest.mark.parametrize("held", [0, 1, 10 ** 6])
def test_the_drop_is_all_or_nothing(held):
    """One phantom coin makes every arc of that pool untrustworthy, not just its own."""
    p = pool("part rugged", [coin(USDC, "USDC", 6, 0), coin(SUSD, "sUSD", 18, 0)],
             (1_000 * 10 ** 6, 1_000 * 10 ** 18))
    chain = Holdings({(USDC, p.address.lower()): 1_000 * 10 ** 6,
                      (SUSD, p.address.lower()): held})
    assert check_reserves_are_real([p], chain)
    assert not any(p.balances)


def test_a_blacklisted_pool_never_reaches_the_universe():
    """Quotes fine, cannot be traded: no probe should be spent reaching it.

    Distinct from the reserve check above.  These pools hold exactly what they
    claim -- the failure is a layer down, in a protocol that will not take a
    deposit -- so nothing about their balances gives them away and only
    executing finds them.
    """
    from erouter.chain import chains
    from erouter.dev.universe import _apply_filters

    chain = chains.get("ethereum")
    banned = chain.blacklist[0]
    kept, dropped = _apply_filters(
        [pool("frozen", [coin(USDC, "aUSDC", 6)], (1,)),
         pool("fine", [coin(SUSD, "DAI", 18)], (1,))],
        chain, None, [], enabled=False,
    )
    assert dropped == 0, "nothing blacklisted in that pair"

    frozen = pool("aave", [coin(USDC, "aUSDC", 6)], (1,))
    frozen.address = banned
    warnings: list[str] = []
    kept, dropped = _apply_filters([frozen], chain, None, warnings, enabled=False)
    assert kept == [] and dropped == 1
    assert "blacklist" in warnings[0]


def test_the_blacklist_is_case_insensitive():
    from erouter.chain import chains
    from erouter.dev.universe import _apply_filters

    chain = chains.get("ethereum")
    frozen = pool("aave", [coin(USDC, "aUSDC", 6)], (1,))
    frozen.address = chain.blacklist[0].lower()
    kept, dropped = _apply_filters([frozen], chain, None, [], enabled=False)
    assert kept == [] and dropped == 1
