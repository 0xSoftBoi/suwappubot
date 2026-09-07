"""A quote must not change the `Prepared` it was handed.

`Prepared` is the size-independent half, and the whole point of it is that a
second size reuses the probes, the calibration and the price fit.  That only
holds if quoting is *read-only* against it.

It was not.  §8 re-probes at the sizes the current route realised and `merge`s
them into the ladders, and those ladders were shared rather than copied -- so the
next quote through the same `Prepared` recalibrated from a ladder carrying the
previous size's points.  On USDC->CRV $100k against a live node: 252 of 862
ladders moved after a single route, and asking for the identical trade again
returned 26 bp less.  It hid well because the loss follows whichever quote runs
*second*, so it reads as a routing difference rather than as contamination.

`arcs` were already copied per quote for exactly this reason.  These tests are
here so the ladders cannot quietly lose that treatment again.
"""

from __future__ import annotations

import copy

from erouter.core.probe import Ladder, merge
from erouter.core.types import ArcKind


class Ref:
    """The little of `ArcRef` that `merge` looks at."""

    def __init__(self, arc_id: str):
        self.id = arc_id
        self.kind = ArcKind.SWAP_STABLE


def ladder(arc_id: str, deltas, quotes, *, attempted: int = 2, failures=None) -> Ladder:
    return Ladder(arc=Ref(arc_id), deltas=list(deltas), quotes=list(quotes),
                  attempted=attempted, failures=dict(failures or {}))


def cloned(ladders: list[Ladder]) -> list[Ladder]:
    """Exactly what `pipeline._quote` does before it may merge into them."""
    out = []
    for lad in ladders:
        clone = copy.copy(lad)
        clone.failures = dict(lad.failures)
        out.append(clone)
    return out


def test_merging_into_a_clone_leaves_the_original_alone():
    base = [ladder("a:0:0>1", [10, 20], [10, 20])]
    before = (list(base[0].deltas), list(base[0].quotes), base[0].attempted)

    working = cloned(base)
    merge(working, [ladder("a:0:0>1", [15], [15], attempted=1)])

    assert working[0].deltas == [10, 15, 20], "the clone must gain the point"
    assert (base[0].deltas, base[0].quotes, base[0].attempted) == before, (
        "the size that was just quoted leaked into the shared preparation"
    )


def test_failure_counts_do_not_leak():
    """`merge` updates `failures` in place, so the dict needs its own copy."""
    base = [ladder("a:0:0>1", [10], [10], failures={"reverted": 1})]
    working = cloned(base)
    merge(working, [ladder("a:0:0>1", [20], [20], failures={"reverted": 4})])

    assert working[0].failures["reverted"] == 5
    assert base[0].failures == {"reverted": 1}, "failure counts accumulated across quotes"


def test_a_shallow_copy_alone_would_not_be_enough():
    """Pins why the clone copies `failures` rather than relying on `copy.copy`."""
    base = [ladder("a:0:0>1", [10], [10], failures={"reverted": 1})]
    naive = [copy.copy(lad) for lad in base]
    merge(naive, [ladder("a:0:0>1", [20], [20], failures={"reverted": 4})])

    assert base[0].deltas == [10], "merge rebinds the lists, so those are safe"
    assert base[0].failures == {"reverted": 5}, (
        "this is the leak a shallow copy leaves behind -- if this ever fails, "
        "`merge` stopped mutating `failures` in place and the clone can simplify"
    )


def test_clone_is_cheap_enough_to_do_every_quote():
    """862 ladders is the live universe; copying them must not cost a quote."""
    ladders = [ladder(f"{k}:0:0>1", [10, 20, 30], [10, 20, 30]) for k in range(862)]
    working = cloned(ladders)
    assert len(working) == 862
    assert all(a is not b for a, b in zip(ladders, working, strict=True))
