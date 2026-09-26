"""One fill per spoke, however many arcs draw on it.

A merged node holds one balance under two addresses, so an arc wanting the
non-canonical member needs a conversion leg to put some of the hub's balance
into a spoke slot.  That leg was emitted **per arc**: four pools wanting
scrvUSD meant four crvUSD -> scrvUSD deposits, at one ratio, into one slot.

Measured on crvUSD -> sDOLA at $100,000: legs 1, 2, 3 and 5 all deposited into
`0x0655977f`, and a single deposit of the 88,670 crvUSD they carried between
them pays the same 80,140.808884 scrvUSD, because a vault wrap is linear.  So
three of the caller's thirty-two legs and three on-chain vault calls bought
nothing.  The route came down from 15 legs to 12.

The draw side has always grouped this way -- see `(3)` in `realize`, and
`test_spoke_sweeper.py` for the sweeper rule that goes with it.
"""

from __future__ import annotations

import numpy as np

from erouter.core.realize import realize
from test_realize import CRVUSD, POOL_A, POOL_B, POOL_C, SCRVUSD, USDC, WETH, arc, merged_nodes


def fills(route, token):
    """The conversion legs that put `token` into its spoke."""
    return [rl for rl in route.legs
            if rl.is_conversion and rl.target.lower() == token.lower()]


def _two_arcs_off_one_spoke():
    nodes = merged_nodes()
    arcs = [arc(POOL_A, SCRVUSD, USDC, nodes),
            arc(POOL_B, SCRVUSD, WETH, nodes),
            arc(POOL_C, USDC, WETH, nodes)]
    route = realize(arcs, np.array([0.4, 0.4, 0.4]), np.ones(8), nodes,
                    src_token=CRVUSD, dst_token=WETH, amount_in=10**21)
    return nodes, route


def test_two_arcs_wanting_one_token_share_a_single_fill():
    _nodes, route = _two_arcs_off_one_spoke()
    assert len(fills(route, SCRVUSD)) == 1, (
        "one wrap per consuming arc is one wrap too many")


def test_the_arcs_still_draw_from_the_slot_it_filled():
    """Merging the fill must not orphan the legs it was feeding."""
    _nodes, route = _two_arcs_off_one_spoke()
    fill = fills(route, SCRVUSD)[0]
    drawing = [rl for rl in route.legs
               if not rl.is_conversion and rl.leg.src_slot == fill.leg.dst_slot]
    assert len(drawing) == 2, f"{len(drawing)} arcs drew on the filled slot"


def test_the_shared_fill_carries_the_whole_share():
    """It stands in for every arc behind it, so it takes what they take."""
    _nodes, route = _two_arcs_off_one_spoke()
    fill = fills(route, SCRVUSD)[0]
    drawing = [rl for rl in route.legs
               if not rl.is_conversion and rl.leg.src_slot == fill.leg.dst_slot]
    assert fill.amount_in >= sum(rl.amount_in for rl in drawing) - 2


def test_one_arc_off_a_spoke_still_gets_its_fill():
    """The grouping must not lose the ordinary case."""
    nodes = merged_nodes()
    arcs = [arc(POOL_A, SCRVUSD, USDC, nodes),
            arc(POOL_C, USDC, WETH, nodes)]
    route = realize(arcs, np.array([0.4, 0.4]), np.ones(8), nodes,
                    src_token=CRVUSD, dst_token=WETH, amount_in=10**21)
    assert len(fills(route, SCRVUSD)) == 1
