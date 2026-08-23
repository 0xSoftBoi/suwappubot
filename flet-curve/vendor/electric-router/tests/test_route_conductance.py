"""A route weighed as a resistor network: `1/TVL` per pool.

This is what ranks scout entrants.  Leg count used to, and it is not a quality
measure -- a long chain through dust outranked a two-way branch across the
deepest pools on the chain.  Conductance says the opposite, and says it in the
units the rest of the router already uses.
"""

from __future__ import annotations

import math

import pytest

from erouter.core.realize import RealizedLeg, RealizedRoute, route_conductance
from erouter.core.types import ArcKind, Leg

POOL = "0x" + "a1" * 20


def leg(src: int, dst: int, tvl: float, *, kind=ArcKind.SWAP_STABLE) -> RealizedLeg:
    return RealizedLeg(
        leg=Leg(target=POOL, kind=kind, i=0, j=1, n=2,
                src_slot=src, dst_slot=dst, bps=0),
        kind=kind, target=POOL, token_in="0xin", token_out="0xout",
        amount_in=1, amount_out=1, tvl_usd=tvl,
    )


def route(legs, dst_slot: int) -> RealizedRoute:
    return RealizedRoute(legs=legs, dst_slot=dst_slot, amount_in=1)


def test_series_hops_add_resistance():
    """Two $100 pools in series conduct half of what one does."""
    one = route([leg(0, 1, 100.0)], 1)
    two = route([leg(0, 1, 100.0), leg(1, 2, 100.0)], 2)
    assert route_conductance(one) == pytest.approx(100.0)
    assert route_conductance(two) == pytest.approx(50.0)


def test_parallel_branches_add_conductance():
    """Splitting across two $100 pools conducts twice as much as one."""
    split = route([leg(0, 1, 100.0), leg(0, 1, 100.0)], 1)
    assert route_conductance(split) == pytest.approx(200.0)


def test_depth_and_branching_both_count():
    """The ranking the leg-count gate got backwards.

    A four-hop chain through thin pools has more legs than a two-way branch
    through deep ones, and less capacity.  Conductance has to prefer the branch.
    """
    thin_chain = route([leg(k, k + 1, 1_000.0) for k in range(4)], 4)
    deep_branch = route([leg(0, 1, 50_000_000.0), leg(0, 1, 50_000_000.0)], 1)
    assert len(thin_chain.legs) > len(deep_branch.legs)      # wider by legs
    assert route_conductance(deep_branch) > route_conductance(thin_chain)


def test_a_node_merge_is_a_short():
    """A conversion has `eps = 0` and `G = infinity` (§3.1), so it adds nothing.

    Its two slots are one node, and a route made only of merges has no
    resistance at all.
    """
    merged = route(
        [leg(0, 1, 0.0, kind=ArcKind.ERC4626_DEPOSIT), leg(1, 2, 100.0)], 2
    )
    assert route_conductance(merged) == pytest.approx(100.0)
    only_merge = route([leg(0, 1, 0.0, kind=ArcKind.ERC4626_DEPOSIT)], 1)
    assert route_conductance(only_merge) == math.inf


def test_a_pool_with_no_size_carries_no_current():
    """TVL of zero is an open circuit, not a free one."""
    assert route_conductance(route([leg(0, 1, 0.0)], 1)) == 0.0


def test_an_unreachable_destination_conducts_nothing():
    dangling = route([leg(0, 1, 100.0)], 7)      # nothing reaches slot 7
    assert route_conductance(dangling) == 0.0
    assert route_conductance(route([], 1)) == 0.0
