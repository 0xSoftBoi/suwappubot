"""wstETH legs are node merges, and the model has to carry them.

`is_conversion` named four of the six kinds `Conversion` emits and left out the
wstETH pair, so its legs went down the pool-swap branch of `_forward_simulate`
and were rescaled from an `amount_out` no calibration ever set.  That is zero,
so a route through wstETH dropped the whole branch from `modelled_out`: 42.18
WETH realised against 33.98 modelled, and a ledger reading 2,036 bp of modelled
loss on a trade that cost 98.
"""

from __future__ import annotations

import numpy as np

from erouter.core.nodes import Conversion, ConversionKind, NodeMap
from erouter.core.realize import realize
from erouter.core.types import ArcKind, PoolArc

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
STETH = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84"
WSTETH = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0"

#: stETH per wstETH, as mainnet reported it.
RATE_NUM, RATE_DEN = 1242113888677499794, 10**18


def nodes_with_wsteth() -> NodeMap:
    nodes = NodeMap()
    nodes.add_token(USDC, "USDC", 6)
    nodes.add_token(STETH, "stETH", 18)
    nodes.add_token(WSTETH, "wstETH", 18)
    nodes.merge(Conversion(ConversionKind.WSTETH, WSTETH, STETH,
                           RATE_NUM, RATE_DEN, target=WSTETH))
    return nodes


def arc(token_in: str, token_out: str, nodes: NodeMap, *, a: float) -> PoolArc:
    return PoolArc(
        id="0x" + "a1" * 20 + ":0>1", pool="0x" + "a1" * 20,
        kind=ArcKind.SWAP_STABLE, i=0, j=1, n_coins=2,
        token_in=token_in, token_out=token_out,
        tau=nodes.node(token_in), sigma=nodes.node(token_out),
        a=a, B=1e-9, G=1e9, eps=1.0 - a,
        decimals_in=nodes.decimals(token_in), decimals_out=nodes.decimals(token_out),
        reserve_in=10**24,
    )


def route_to(dst: str):
    """USDC into a pool that pays wstETH, asked for `dst`."""
    nodes = nodes_with_wsteth()
    arcs = [arc(USDC, WSTETH, nodes, a=1 / 4000.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(STETH)] = 4000.0
    return nodes, realize(arcs, np.array([1000.0]), nu, nodes,
                          src_token=USDC, dst_token=dst, amount_in=1000 * 10**6)


def test_a_wsteth_leg_is_a_conversion():
    _, route = route_to(STETH)
    legs = [rl for rl in route.legs if rl.kind is ArcKind.WSTETH_UNWRAP]
    assert legs, "no unwrap emitted; the fixture does not exercise the bug"
    assert legs[0].is_conversion, (
        "a wstETH leg was treated as a pool swap, so the forward simulation "
        "rescaled it from a calibration it never had"
    )


def test_the_unwrap_carries_its_branch_at_the_pool_rate():
    _, route = route_to(STETH)
    unwrap = next(rl for rl in route.legs if rl.kind is ArcKind.WSTETH_UNWRAP)
    assert unwrap.amount_in > 0
    assert unwrap.amount_out == unwrap.amount_in * RATE_NUM // RATE_DEN
    assert route.modelled_out == unwrap.amount_out, (
        "the branch behind the unwrap never reached the destination slot"
    )


def test_the_unwrap_multiplies_rather_than_divides():
    """The direction, stated so a `from_canonical` cannot pass as a typo."""
    _, route = route_to(STETH)
    unwrap = next(rl for rl in route.legs if rl.kind is ArcKind.WSTETH_UNWRAP)
    assert unwrap.amount_out > unwrap.amount_in, (
        "wstETH is worth more than one stETH; unwrapping must multiply"
    )


def test_the_wrap_divides():
    """The other direction, so neither is right by accident."""
    nodes = nodes_with_wsteth()
    arcs = [arc(USDC, STETH, nodes, a=1 / 4000.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(STETH)] = 4000.0
    route = realize(arcs, np.array([1000.0]), nu, nodes,
                    src_token=USDC, dst_token=WSTETH, amount_in=1000 * 10**6)
    wrap = next(rl for rl in route.legs if rl.kind is ArcKind.WSTETH_WRAP)
    assert wrap.amount_out == wrap.amount_in * RATE_DEN // RATE_NUM
    assert wrap.amount_out < wrap.amount_in


def test_a_wsteth_leg_is_not_counted_as_a_pool():
    """It carries no reserve, so theta, conductance and the gas premium skip it."""
    _, route = route_to(STETH)
    assert WSTETH not in route.pools_used
    assert all(rl.theta == 0.0 for rl in route.legs if rl.is_conversion)
