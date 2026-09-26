"""A node touched by one pool cannot be routed *through*.

Not "is unlikely to help" -- cannot.  A node that is neither endpoint has to be
entered through one pool and left through another, because decision 3 gives a
route at most one arc per pool and a two-coin pool's only other coin is the one
the flow just arrived from.  So the long tail of single-pool tokens is excluded
on structure, without a list of names: on mainnet HLX, CXD, FIDU and STG each
sit in exactly one pool, and 306 arcs of ~790 go this way.
"""

from __future__ import annotations

from erouter.core.pipeline import _prune_dead_end_nodes
from erouter.core.types import ArcKind, PoolArc


class _Counters:
    def __init__(self):
        self.counters: dict = {}


def arc(pool: str, tau: int, sigma: int) -> PoolArc:
    return PoolArc(
        id=f"{pool}:{tau}>{sigma}", pool=pool, kind=ArcKind.SWAP_STABLE,
        i=0, j=1, n_coins=2, token_in=f"0xin{tau}", token_out=f"0xout{sigma}",
        tau=tau, sigma=sigma,
    )


def both_ways(pool: str, a: int, b: int) -> list[PoolArc]:
    return [arc(pool, a, b), arc(pool, b, a)]


def test_a_token_in_one_pool_is_dropped_as_an_intermediate():
    """`HLX/USDC` is the only HLX pool, so no route passes through HLX."""
    arcs = [*both_ways("0xusdc_crvusd", 0, 1),      # USDC <-> crvUSD
            *both_ways("0xcrvusd_susde", 1, 2),     # crvUSD <-> sUSDe
            *both_ways("0xhlx_usdc", 0, 9)]         # HLX, and nowhere else
    kept = _prune_dead_end_nodes(arcs, 0, 2, _Counters())
    assert {a.pool for a in kept} == {"0xusdc_crvusd", "0xcrvusd_susde"}
    assert all(9 not in (a.tau, a.sigma) for a in kept)


def test_a_token_in_two_pools_survives():
    """Two pools is enough to enter by one and leave by the other."""
    arcs = [*both_ways("0xusdc_crvusd", 0, 1),
            *both_ways("0xcrvusd_susde", 1, 2),
            *both_ways("0xusdc_mid", 0, 9),
            *both_ways("0xmid_susde", 9, 2)]
    kept = _prune_dead_end_nodes(arcs, 0, 2, _Counters())
    assert {a.pool for a in kept} == {
        "0xusdc_crvusd", "0xcrvusd_susde", "0xusdc_mid", "0xmid_susde"}


def test_the_endpoints_are_never_pruned():
    """`HLX -> USDC` is a fair question and its single pool is the answer."""
    arcs = both_ways("0xhlx_usdc", 9, 0)
    kept = _prune_dead_end_nodes(arcs, 9, 0, _Counters())
    assert len(kept) == 2


def test_pruning_iterates():
    """Removing a leaf can leave its neighbour with one pool, and so on."""
    arcs = [*both_ways("0xusdc_crvusd", 0, 1),
            *both_ways("0xcrvusd_susde", 1, 2),
            *both_ways("0xcrvusd_a", 1, 7),         # a chain off the side:
            *both_ways("0xa_b", 7, 8)]              # 7 has two pools, 8 has one
    counters = _Counters()
    kept = _prune_dead_end_nodes(arcs, 0, 2, counters)
    # 8 goes first for having one pool; that leaves 7 with one, so it goes too.
    assert {a.pool for a in kept} == {"0xusdc_crvusd", "0xcrvusd_susde"}
    assert counters.counters["arcs_dead_end"] == 4


def test_a_three_coin_pool_alone_still_cannot_be_a_through_route():
    """`A -> v -> B` inside one pool is dominated by `A -> B` inside it."""
    arcs = [arc("0xtri", 0, 1), arc("0xtri", 1, 0),
            arc("0xtri", 0, 2), arc("0xtri", 2, 0),
            arc("0xtri", 1, 2), arc("0xtri", 2, 1)]
    kept = _prune_dead_end_nodes(arcs, 0, 2, _Counters())
    assert all(1 not in (a.tau, a.sigma) for a in kept)
    assert {(a.tau, a.sigma) for a in kept} == {(0, 2), (2, 0)}
