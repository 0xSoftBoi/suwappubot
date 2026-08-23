"""Differential test: the router must never lose to a brute-force baseline.

Two baselines, both model-free (see `naive.py`):

* every single pool holding both tokens;
* every `src -> M -> dst` chain, one pool per hop.

The router splits, so it should usually beat them.  It must never be worse,
because anyone comparing by hand would find these immediately -- and a real
failure of exactly this kind was already caught once by inspection, when a
degraded run returned 13,700 USDC for 100,000 DAI.
"""

from __future__ import annotations

import pytest
from naive import naive_direct, naive_two_step

from erouter.chain.wrappers import build_node_map
from erouter.core.pipeline import RoutingError, route
from erouter.core.pools import parse_universe
from erouter.dev.universe import read_balances, resolve_dialects

pytestmark = pytest.mark.forked

T = {
    "USDC": ("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6),
    "USDT": ("0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
    "DAI": ("0x6b175474e89094c44da98b954eedeac495271d0f", 18),
    "crvUSD": ("0xf939e0a03fb07f59a73314e73794be0e57ac1b4e", 18),
    "WETH": ("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18),
    "stETH": ("0xae7ab96520de3a18e5e111b5eaab095312d7fe84", 18),
    "rETH": ("0xae78736cd615f374d3085123a210448e74fc6393", 18),
    "wstETH": ("0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", 18),
}

# The leg-count tie-break may give up a hair of output for a much shorter
# route (§11.1), so the comparison allows exactly that much and no more.
TIE_SLACK = 1e-5

CASES = [
    ("USDC", "USDT", 100_000),
    ("USDT", "USDC", 100_000),
    ("DAI", "USDC", 100_000),
    ("USDC", "crvUSD", 250_000),
    ("USDC", "USDT", 5_000_000),
    ("USDC", "WETH", 100_000),
    ("WETH", "USDC", 30),
    ("stETH", "WETH", 50),
    ("WETH", "stETH", 50),
    ("rETH", "WETH", 50),
    # No pool pairs wstETH with WETH directly, so these are reachable only via a
    # chain -- and at size 50 the trade is ~4x every wstETH pool in the universe.
    # That is far outside the quadratic model's range (§12.1 wants an escalation
    # above theta = 10%), which is exactly why the two-step floor exists: the
    # model's own best answer here was 803 bp worse than an obvious chain.
    ("wstETH", "WETH", 5),
    ("wstETH", "WETH", 50),
    ("WETH", "wstETH", 50),
]


@pytest.fixture(scope="module")
def universe(pools, quoter_client, chain):
    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client)
    nodes, _ = build_node_map(specs, chain, quoter_client)
    return specs, nodes


@pytest.fixture(scope="module")
def routed(universe, quoter_client):
    """`(src, dst, amount) -> Route`, computed once and shared by both tests.

    Routing is the slow half of this file; both assertions need the same answer.
    """
    specs, nodes = universe
    memo: dict[tuple[str, str, int], object] = {}

    def get(src: str, dst: str, amount: int):
        key = (src, dst, amount)
        if key not in memo:
            src_token, decimals = T[src]
            memo[key] = route(specs, nodes, quoter_client, src_token=src_token,
                              dst_token=T[dst][0], amount_in=amount * 10**decimals)
        return memo[key]

    return get


@pytest.mark.parametrize(("src", "dst", "amount"), CASES, ids=lambda v: str(v))
def test_router_beats_every_single_pool(universe, quoter_client, routed, src, dst, amount):
    specs, nodes = universe
    src_token, decimals = T[src]
    wei = amount * 10**decimals

    best = naive_direct(specs, nodes, quoter_client, src_token, T[dst][0], wei)
    if not best.found:
        pytest.skip(f"no pool holds both {src} and {dst}")

    got = routed(src, dst, amount).verified_out or 0
    assert got >= best.amount_out * (1 - TIE_SLACK), (
        f"{amount:,} {src}->{dst}: router {got} < single pool {best.amount_out} "
        f"({(got / best.amount_out - 1) * 1e4:+.2f} bp) via {best.label}"
    )


@pytest.mark.parametrize(("src", "dst", "amount"), CASES, ids=lambda v: str(v))
def test_router_beats_every_two_pool_chain(universe, quoter_client, routed, src, dst, amount):
    specs, nodes = universe
    src_token, decimals = T[src]
    wei = amount * 10**decimals

    best = naive_two_step(specs, nodes, quoter_client, src_token, T[dst][0], wei)
    if not best.found:
        pytest.skip(f"no two-pool chain from {src} to {dst}")

    got = routed(src, dst, amount).verified_out or 0
    assert got >= best.amount_out * (1 - TIE_SLACK), (
        f"{amount:,} {src}->{dst}: router {got} < two-pool chain {best.amount_out} "
        f"({(got / best.amount_out - 1) * 1e4:+.2f} bp) via {best.label}"
    )


def test_a_route_is_always_produced(routed):
    """Whatever else happens, a pair with liquidity must not raise."""
    for src, dst, amount in CASES:
        try:
            result = routed(src, dst, amount)
        except RoutingError as exc:
            pytest.fail(f"{amount:,} {src}->{dst} raised: {exc}")
        assert (result.verified_out or 0) > 0
