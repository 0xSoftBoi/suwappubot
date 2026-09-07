"""`core/walk.py` has to be the contract's accumulator, not one like it.

Quoting a candidate by walking models instead of executing it is only sound if
the walk is the same walk.  The differences that would matter are all in how a
split is measured, and none of them show up on a single-leg route -- which is
exactly the shape a careless test would use.

Checked against the deployed contract on 108 real candidate routes across five
pairs (40 of them walked here rather than executed): every one agreed to the
wei.  These pin the branches that a live check only reaches by luck.
"""

from __future__ import annotations

import pytest

from erouter.core.types import ArcKind, Leg
from erouter.core.walk import LegUnquotable, walk_route

POOL = "0x" + "11" * 20
OTHER = "0x" + "22" * 20


def leg(*, bps=0, src=0, dst=1, target=POOL, i=0, j=1):
    return Leg(target=target, kind=ArcKind.SWAP_STABLE, i=i, j=j, n=2,
               src_slot=src, dst_slot=dst, bps=bps)


def one_to_one(_leg, dx):
    return dx


def test_bps_is_a_share_of_the_snapshot_not_of_what_is_left():
    """The property the snapshot exists for: order must not change the split.

    Measuring `bps` against the running balance would make the second leg of a
    50/50 split take half of what the first one left -- 25% -- and the totals
    would still look plausible.
    """
    legs = [leg(bps=5_000, dst=1), leg(bps=5_000, dst=2)]
    assert walk_route(legs, 1_000, 1, one_to_one) == 500
    assert walk_route(legs, 1_000, 2, one_to_one) == 500


def test_a_zero_bps_leg_sweeps_the_remainder():
    """`bps == 0` is "take the rest", which is how a split avoids dust."""
    legs = [leg(bps=3_333, dst=1), leg(bps=0, dst=2)]
    assert walk_route(legs, 1_000, 1, one_to_one) == 333
    assert walk_route(legs, 1_000, 2, one_to_one) == 667


def test_a_group_reopens_when_the_source_slot_changes_back():
    """The group opens on a *change* of `src_slot`, so groups are contiguous.

    Remembering the first snapshot per slot instead would size the second visit
    against a balance that no longer exists.
    """
    legs = [
        leg(bps=5_000, src=0, dst=1),   # 500 of 1,000 -> slot 1
        leg(bps=0, src=1, dst=2),       # all 500      -> slot 2
        leg(bps=5_000, src=0, dst=3),   # slot 0 reopens at its *current* 500
    ]
    assert walk_route(legs, 1_000, 3, one_to_one) == 250


def test_a_branch_rounded_to_nothing_is_skipped_not_fatal():
    """A split can round its smallest branch to zero; that is not a dead route.

    Treating it as fatal would discard an otherwise fine candidate over its
    least important branch -- silently, since the route would just score 0.
    """
    legs = [leg(bps=1, dst=1), leg(bps=0, dst=2)]
    assert walk_route(legs, 100, 2, one_to_one) == 100


def test_a_reverting_leg_kills_the_route():
    legs = [leg(bps=5_000, dst=1), leg(bps=0, dst=2)]
    assert walk_route(legs, 1_000, 2, lambda one, dx: 0 if one.dst_slot == 2 else dx) == 0


def test_the_answer_is_the_destination_slot_not_the_last_leg():
    """Two branches arriving at the same slot must sum."""
    legs = [leg(bps=5_000, src=0, dst=2), leg(bps=0, src=0, dst=1),
            leg(bps=0, src=1, dst=2)]
    assert walk_route(legs, 1_000, 2, one_to_one) == 1_000
    # ...and a slot nothing reached is zero, not the last value computed.
    assert walk_route(legs, 1_000, 7, one_to_one) == 0


def test_a_slot_out_of_range_is_a_dead_route():
    assert walk_route([leg(dst=128)], 1_000, 0, one_to_one) == 0


def test_an_unquotable_leg_propagates_rather_than_scoring_zero():
    """The caller has to be able to tell "cannot answer" from "reverts".

    Collapsing the two would score a perfectly good route as dead because one
    of its legs was a wrapper.
    """
    def refuse(_leg, _dx):
        raise LegUnquotable("not mine")

    with pytest.raises(LegUnquotable):
        walk_route([leg()], 1_000, 1, refuse)
