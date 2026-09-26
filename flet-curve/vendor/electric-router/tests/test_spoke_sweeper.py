"""One sweeper per group, including the groups drawn from a spoke.

`bps = 0` means "take the whole remaining slot balance", so it may appear once
per group.  The quoter groups by contiguous `src_slot`, which means two arcs
drawing from the same spoke are one group however they were emitted -- and
emitting each with `bps = 0` left the second with nothing to trade.

**These tests hold the invariant; they do not reproduce the bug.**  Two attempts
at a synthetic route that reaches the spoke path with two arcs on one slot both
passed against the unfixed realiser, so they are a guard against regression
rather than evidence of the fix.  The evidence is on real input: at block
25,800,460 on crvUSD -> sDOLA at $2M, four candidates carried a group with two
sweepers before the fix -- `top 3 paths`, `top 6 paths`, `top 12 paths` and
`top 12 pools`, each two legs off slot 1 -- and none does after it.
"""

from __future__ import annotations

from erouter.core.realize import RealizedRoute
from erouter.core.split import split_groups


def sweepers_per_group(route: RealizedRoute) -> list[int]:
    """How many `bps == 0` legs each contiguous group has."""
    legs = [rl.leg for rl in route.legs]
    runs: list[list[int]] = [[0]] if legs else []
    for k in range(1, len(legs)):
        if legs[k].src_slot == legs[runs[-1][-1]].src_slot:
            runs[-1].append(k)
        else:
            runs.append([k])
    return [sum(1 for k in run if legs[k].bps == 0) for run in runs]


def assert_one_sweeper_per_group(route: RealizedRoute) -> None:
    for run, count in zip(split_groups([rl.leg for rl in route.legs]),
                          sweepers_per_group(route), strict=False):
        assert count <= 1, f"{count} sweepers in one group of {len(run)}"


def test_a_group_never_has_two_sweepers(monkeypatch):
    """The property, over the realiser's own output on a branching route."""
    import numpy as np

    from erouter.core.realize import realize
    from test_realize import CRVUSD, POOL_A, POOL_B, POOL_C, USDC, WETH, arc, base_nodes

    nodes = base_nodes()
    arcs = [arc(POOL_A, CRVUSD, USDC, nodes),
            arc(POOL_B, CRVUSD, WETH, nodes),
            arc(POOL_C, USDC, WETH, nodes)]
    route = realize(arcs, np.array([0.5, 0.3, 0.5]), np.ones(8), nodes,
                    src_token=CRVUSD, dst_token=WETH, amount_in=10**21)
    assert route.legs
    for count in sweepers_per_group(route):
        assert count <= 1


def test_two_arcs_off_one_spoke_do_not_both_sweep():
    """The measured shape: two pools drawing from the same intermediate slot."""
    import numpy as np

    from erouter.core.realize import realize
    from test_realize import CRVUSD, POOL_A, POOL_B, POOL_C, SCRVUSD, USDC, WETH, arc, merged_nodes

    nodes = merged_nodes()
    # Both of these leave the scrvUSD side of the merged crvUSD node, so both
    # draw from the same spoke slot.
    arcs = [arc(POOL_A, SCRVUSD, USDC, nodes),
            arc(POOL_B, SCRVUSD, WETH, nodes),
            arc(POOL_C, USDC, WETH, nodes)]
    route = realize(arcs, np.array([0.4, 0.4, 0.4]), np.ones(8), nodes,
                    src_token=CRVUSD, dst_token=WETH, amount_in=10**21)
    counts = sweepers_per_group(route)
    assert counts, "no legs realised"
    assert max(counts) <= 1, f"a group has {max(counts)} sweepers"
