"""`RouteQuoter._walk`, in Python.

The contract runs a route over a slot accumulator: legs arrive topologically
ordered and grouped by `src_slot`, the group's base balance is snapshotted when
the group opens, and `bps` is a share of that snapshot rather than of whatever
is left -- so a split does not depend on the order its branches drain.  This is
the same walk, so a route whose every leg is a pool we evaluate from its own
parameters can be quoted without asking anyone.

It is a *port*, and the details that look incidental are the ones that matter:

* the group opens on a **change** of `src_slot` (`src != cur`), so a group is a
  contiguous run.  Revisiting a slot later opens a new group against its new
  balance, which is not the same as remembering the first snapshot.
* `dx == 0` **continues**.  A split can round its smallest branch down to
  nothing, and that is a leg with no work to do rather than a dead route.
* a leg that reverts, or returns zero, **kills the route** and the answer is 0.
* the result is `bal[dst_slot]`, not the last leg's output.

`quote_leg` returns `None` for "this leg cannot be quoted here", which is not a
revert: the caller uses it to hand the whole route to the chain instead.
"""

from __future__ import annotations

from collections.abc import Callable

from .types import Leg

BPS = 10_000
MAX_SLOTS = 128


class LegUnquotable(Exception):
    """This leg is not one the caller can answer -- ask the chain instead."""


def walk_route(
    legs: list[Leg],
    amount_in: int,
    dst_slot: int,
    quote_leg: Callable[[Leg, int], int],
) -> int:
    """Output of one route, or 0 if it is dead.

    `quote_leg(leg, dx)` returns the leg's output; it may raise
    `LegUnquotable`, which propagates, so a caller that cannot serve every leg
    finds out before it has half an answer.
    """
    bal: dict[int, int] = {0: amount_in}
    cur = -1
    base = 0

    for leg in legs:
        src, dst = leg.src_slot, leg.dst_slot
        if not (0 <= src < MAX_SLOTS) or not (0 <= dst < MAX_SLOTS):
            return 0

        if src != cur:
            cur = src
            base = bal.get(src, 0)

        have = bal.get(src, 0)
        # `bps == 0` is the last leg out of a node, sweeping the remainder.
        dx = have if leg.bps == 0 else min(base * leg.bps // BPS, have)
        if dx == 0:
            continue

        value = quote_leg(leg, dx)
        if value <= 0:
            return 0

        bal[src] = have - dx
        bal[dst] = bal.get(dst, 0) + value

    return bal.get(dst_slot, 0)
