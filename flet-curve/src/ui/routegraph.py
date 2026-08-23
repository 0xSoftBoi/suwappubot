"""Laying out a route as a diagram, with no Flet in the arithmetic.

The router hands over a structured `Diagram` -- buses (a token rail), elements
(a leg), and the order the buses come in.  Its own `render_text` turns that
into box-drawing characters; this turns the same model into rectangles, and
`swap.py` turns those into canvas shapes.

Kept apart from the drawing for the reason the chart's `viewport.py` is: the
geometry is where the mistakes are -- a band that overlaps its neighbour, a
column that runs off the edge, a share that does not add up -- and none of
that needs a window to find.

The shape is Odos's, because it is the one that shows what this router
actually does: flow *splits*, and a picture of a single path would be a
picture of the special case.

**Columns are layers, not list positions.**  A route is a DAG, not a chain:
its buses arrive in an order that says nothing about how far along each one
is, so putting bus `k` in column `k` let a leg run backwards and drew one
ribbon straight over another.  Each bus goes in the column of its *longest*
path from the source, which is what makes every leg run strictly left to
right.  Within a column the buses are ordered by barycentre sweeps in both
directions, and each bus's ribbons leave and arrive in the order of the bus at
the other end -- between them that is what keeps the ribbons from crossing
more than the route itself requires.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import pairwise

#: How wide a bus column is drawn.
BUS_WIDTH = 10.0

#: Between two buses stacked in one column -- and it is this wide because a
#: bus carries its name and its amount underneath, which have to fit.
NODE_GAP = 30.0

#: What a band is never thinner than.  A leg carrying 0.4% of the flow is
#: still a leg someone may want to see; below a couple of pixels it is a line
#: nobody can tell from the gap above it.
MIN_BAND = 2.5

#: Room under the lowest bus for its label.
LABEL_HEIGHT = 26.0

#: One thing stacked in a column: a bus, or a ribbon passing through.  The
#: column is part of the key, so a leg with a lane in several of them is
#: several things and can sit at a different height in each.
Item = tuple[str, int, int]

#: Between a ribbon passing through a column and whatever it sits beside.  A
#: hair, because it carries no label -- it is there to be told apart from its
#: neighbour and nothing more.
WAY_GAP = 3.0

#: How many times the ordering is swept back and forth.  Each pass is cheap
#: -- a route is a few dozen buses -- and the picture stops changing after a
#: handful, so this is well past where it settles.
SWEEPS = 8

#: How many rounds of adjacent swaps follow each sweep.  A round that changes
#: nothing stops early, and in practice two are enough; this is headroom.
TRANSPOSES = 4

#: Prefixes the registry puts on a pool's name that say nothing about which
#: pool it is.  Longest first, since some are prefixes of the others.
BOILERPLATE = (
    "Curve.fi Factory Plain Pool: ",
    "Curve.fi Factory Pool: ",
    "Curve.fi Factory USD Metapool: ",
    "Factory Plain Pool: ",
    "Curve.fi ",
)

#: What a leg *is*, for the ones whose name only restates the two columns it
#: already runs between -- a vault deposit says "crvUSD -> scrvUSD", which the
#: picture says twice already.
LEG_KINDS = {
    "ERC4626_DEPOSIT": "deposit",
    "ERC4626_REDEEM": "redeem",
    "WRAP_NATIVE": "wrap",
    "UNWRAP_NATIVE": "unwrap",
    "WSTETH_WRAP": "wrap",
    "WSTETH_UNWRAP": "unwrap",
    "STAKE_NATIVE": "stake",
    "LEND_MINT": "lend",
    "LEND_REDEEM": "redeem",
    "DEPOSIT_FIXED": "add liquidity",
    "DEPOSIT_DYN": "add liquidity",
    "DEPOSIT_FIXED_NOFLAG": "add liquidity",
    "WITHDRAW_STABLE": "withdraw",
    "WITHDRAW_CRYPTO": "withdraw",
}

#: How much of the frame the ribbons are allowed to fill.  Not all of it: a
#: one-leg route carries 100% of the flow and would be drawn as a rectangle of
#: colour touching the frame on every side, which reads as a swatch rather
#: than as a picture of anything.
FILL = 0.82


@dataclass(frozen=True, slots=True)
class BusBox:
    """One token rail, as a column."""

    slot: int
    symbol: str
    amount: str
    #: The token's own address, for its logo.  The router names the rail and
    #: also says which token it holds; only the name is on the picture, but
    #: the mark beside the name comes from the address.
    token: str
    x: float
    y: float
    width: float
    height: float
    layer: int = 0
    is_source: bool = False
    is_dest: bool = False

    @property
    def middle(self) -> float:
        return self.y + self.height / 2


@dataclass(frozen=True, slots=True)
class Band:
    """One leg, as a ribbon.

    `points` are its top edge, left to right: where it leaves its bus, both
    sides of every column it passes on the way, and where it arrives.  A leg
    between neighbouring columns has two; one that spans further has a pair
    for each column in between, and those are what keep it out of everything
    that lives there.
    """

    index: int
    label: str
    kind: str
    share: float
    points: tuple[tuple[float, float], ...]
    height: float
    colour: int = 0
    detail: str = ""

    def waist(self) -> tuple[float, float, float]:
        """Where a name goes on this ribbon, and how much room it has.

        The middle of its longest straight run, rather than the middle of the
        ribbon: a leg spanning several columns has its midpoint over one of
        them as often as not, and a name there sits on a bus rather than on
        the flow.  Returns the centre of that run and its width.
        """
        widest = max(pairwise(self.points), key=lambda pair: pair[1][0] - pair[0][0])
        (x0, y0), (x1, y1) = widest
        return (x0 + x1) / 2, (y0 + y1) / 2 + self.height / 2, x1 - x0

    @property
    def x0(self) -> float:
        return self.points[0][0]

    @property
    def y0(self) -> float:
        return self.points[0][1]

    @property
    def x1(self) -> float:
        return self.points[-1][0]

    @property
    def y1(self) -> float:
        return self.points[-1][1]


@dataclass(frozen=True, slots=True)
class Layout:
    """A whole diagram, positioned."""

    buses: list[BusBox] = field(default_factory=list)
    bands: list[Band] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0

    @property
    def columns(self) -> int:
        return len({bus.layer for bus in self.buses})


def layout(diagram, width: float, height: float, *, bus_width: float = BUS_WIDTH,
           gap: float = NODE_GAP, min_band: float = MIN_BAND) -> Layout:
    """Position a `Diagram` inside `width` x `height`."""
    elements = list(getattr(diagram, "elements", ()) or ())
    buses = {bus.slot: bus for bus in getattr(diagram, "buses", ()) or ()}
    if not elements:
        return Layout(width=width, height=height)

    depth = layers(diagram)
    columns = max(depth.values()) + 1
    span = max(1, columns - 1)
    step = (width - bus_width) / span if span else 0.0
    drawable = max(1.0, height - LABEL_HEIGHT)

    weight = flows(diagram)
    through = _through(elements, weight)
    by_layer: dict[int, list[int]] = {}
    for slot, level in depth.items():
        by_layer.setdefault(level, []).append(slot)

    # Height first: a column's contents and the air between them together
    # fill the frame, so the most crowded column is what everything else is
    # scaled against.  Flow is conserved, so every column carries about the
    # same amount -- what differs is how many gaps it has to find room for.
    crowd = max(len(slots) for slots in by_layer.values())
    passing = _passing(elements, depth)
    usable = max(min_band, drawable * FILL
                 - gap * max(0, crowd - 1) - WAY_GAP * passing)
    busiest = max((sum(through.get(s, 0.0) for s in slots)
                   for slots in by_layer.values()), default=1.0) or 1.0
    scale = usable / busiest

    # Every column holds its buses *and* the ribbons merely passing through
    # it.  Without that a leg spanning several columns has no lane of its own
    # and is drawn straight over whatever lives in them, which is the whole of
    # what still looked tangled.
    spans = {element.index: (depth[element.src_slot], depth[element.dst_slot])
             for element in elements
             if element.src_slot in depth and element.dst_slot in depth}
    # Keyed by the column as well as by what it is: a leg spanning three
    # columns has a lane in two of them, and keyed only by the leg those two
    # were one thing -- with one position between them, in whichever column
    # happened to be looked at first.
    items: dict[int, list[Item]] = {
        level: [("bus", slot, level) for slot in slots]
        for level, slots in by_layer.items()
    }
    for index, (start, end) in spans.items():
        for level in range(start + 1, end):
            items.setdefault(level, []).append(("way", index, level))

    tall_of: dict[Item, float] = {}
    for group in items.values():
        for item in group:
            kind, key, _ = item
            share = through.get(key, 0.0) if kind == "bus" else weight.get(key, 0.0)
            tall_of[item] = max(min_band, share * scale)

    ordering = _untangle(items, elements, spans)

    boxes: dict[int, BusBox] = {}
    waypoints: dict[tuple[int, int], float] = {}
    for level in sorted(items):
        group = ordering[level]
        gaps = sum(_gap_between(group[k], group[k + 1], gap)
                   for k in range(len(group) - 1))
        tall = sum(tall_of[item] for item in group) + gaps
        top = max(0.0, (drawable - tall) / 2)
        for k, item in enumerate(group):
            kind, key, _ = item
            high = tall_of[item]
            if kind == "bus":
                bus = buses.get(key)
                boxes[key] = BusBox(
                    slot=key,
                    symbol=getattr(bus, "symbol", "") or "",
                    amount=getattr(bus, "amount", "") or "",
                    token=getattr(bus, "token", "") or "",
                    x=level * step,
                    y=top,
                    width=bus_width,
                    height=high,
                    layer=level,
                    is_source=bool(getattr(bus, "is_source", False)),
                    is_dest=bool(getattr(bus, "is_dest", False)),
                )
            else:
                waypoints[(key, level)] = top
            top += high
            if k + 1 < len(group):
                top += _gap_between(item, group[k + 1], gap)

    bands = _ribbons(elements, boxes, waypoints, spans, weight, scale, min_band,
                     step, bus_width)
    return Layout(list(boxes.values()), bands, width, height)


def _gap_between(one: Item, two: Item, gap: float) -> float:
    """Air between two things stacked in one column.

    A full gap between buses, which carry a name and an amount underneath; a
    hair between anything else, because a ribbon passing through needs to be
    told apart from its neighbour and nothing more.
    """
    return gap if one[0] == "bus" and two[0] == "bus" else WAY_GAP


def layers(diagram) -> dict[int, int]:
    """Which column each bus belongs in: its longest path from the source.

    Longest rather than shortest, because that is what guarantees every leg
    runs strictly forward -- a bus reached both directly and through two
    others has to sit past both of them, or the direct leg draws backwards
    over the top of them.

    Over a topological order of the buses rather than over the list of legs.
    The list is ordered for *execution* -- a node's inflows precede its
    outflows -- and reading it directly puts a token in the column before the
    token it is made from the moment that order differs.

    The order is found here rather than assumed, and it has to be, because the
    bus graph is not always acyclic: a route may sell a token it bought back,
    and the router says so ("4 pool(s) used more than once").  A leg that
    closes a cycle is left out of the layering -- it still gets drawn, as a
    ribbon running the length of the picture -- because relaxing over one
    pushes every bus rightwards until it hits whatever bound is put on the
    loop, which crushed the whole diagram into the last fifth of its frame.
    """
    elements = list(getattr(diagram, "elements", ()) or ())
    after: dict[int, list[int]] = {}
    into: dict[int, int] = {}
    for element in elements:
        after.setdefault(element.src_slot, []).append(element.dst_slot)
        after.setdefault(element.dst_slot, [])
        into.setdefault(element.src_slot, 0)
        into[element.dst_slot] = into.get(element.dst_slot, 0) + 1

    ready = [slot for slot, count in into.items() if count == 0]
    order: list[int] = []
    while ready:
        slot = ready.pop(0)
        order.append(slot)
        for onward in after.get(slot, ()):
            into[onward] -= 1
            if into[onward] == 0:
                ready.append(onward)
    # Whatever a cycle held back goes last, in the order the router listed it.
    seen = set(order)
    order += [slot for slot in after if slot not in seen]

    depth = dict.fromkeys(after, 0)
    place = {slot: k for k, slot in enumerate(order)}
    for slot in order:
        for onward in after.get(slot, ()):
            if place[onward] > place[slot]:
                depth[onward] = max(depth[onward], depth[slot] + 1)
    return depth


def flows(diagram) -> dict[int, float]:
    """Each leg's share of the *whole* route, by element index.

    Split by what the legs carry rather than by `share_pct`.  A share is of
    what leaves that leg's own node, which composes only where every leg
    means it the same way -- and a *conversion* does not: the deposit that
    fills a merged node stands in for the arcs behind it and reads 100%, so
    multiplying it by what the source holds claimed the whole trade for it
    while the legs beside it claimed their own share as well.  Measured on
    crvUSD -> sDOLA: the source emitted 115.13% of itself and the node it fed
    passed on 84.87% of what it was given, which is a Sankey that does not
    balance and looked like one.

    Every bus is one token, so the legs out of it are all denominated in that
    token and their `amount_in` divides it directly.  In equals out at every
    bus by construction, whatever a share meant.

    The elements are already ordered for execution -- a node's inflows precede
    its outflows -- which is the order this needs.  See `layers`.
    """
    elements = list(getattr(diagram, "elements", ()) or ())
    if not elements:
        return {}
    sources = {bus.slot for bus in getattr(diagram, "buses", ()) or ()
               if getattr(bus, "is_source", False)}
    if not sources:
        order = list(getattr(diagram, "order", ()) or ())
        sources = {order[0]} if order else {elements[0].src_slot}

    leaving: dict[int, float] = {}
    for element in elements:
        leaving[element.src_slot] = (
            leaving.get(element.src_slot, 0.0) + _carried(element))

    held: dict[int, float] = dict.fromkeys(sources, 1.0)
    out: dict[int, float] = {}
    for element in elements:
        total = leaving.get(element.src_slot, 0.0)
        part = (_carried(element) / total) if total > 0 else 0.0
        carried = held.get(element.src_slot, 0.0) * part
        out[element.index] = carried
        held[element.dst_slot] = held.get(element.dst_slot, 0.0) + carried
    return out


def _carried(element) -> float:
    """What a leg takes out of its bus, in that bus's own token.

    `rendermodel.format_units` groups its thousands, so this is "100,000.00"
    rather than a number.  Read with the separators left in, every leg is
    worth nothing and every band comes out at the minimum.
    """
    try:
        return max(0.0, float(str(element.amount_in).replace(",", "")))
    except (TypeError, ValueError):
        return 0.0


def _through(elements, weight: dict[int, float]) -> dict[int, float]:
    """How much of the route passes through each bus."""
    incoming: dict[int, float] = {}
    outgoing: dict[int, float] = {}
    for element in elements:
        carried = weight.get(element.index, 0.0)
        outgoing[element.src_slot] = outgoing.get(element.src_slot, 0.0) + carried
        incoming[element.dst_slot] = incoming.get(element.dst_slot, 0.0) + carried
    slots = set(incoming) | set(outgoing)
    return {slot: max(incoming.get(slot, 0.0), outgoing.get(slot, 0.0))
            for slot in slots}


def _passing(elements, depth: dict[int, int]) -> int:
    """The most ribbons that pass through any one column without stopping."""
    counts: dict[int, int] = {}
    for element in elements:
        if element.src_slot not in depth or element.dst_slot not in depth:
            continue
        for level in range(depth[element.src_slot] + 1, depth[element.dst_slot]):
            counts[level] = counts.get(level, 0) + 1
    return max(counts.values(), default=0)


def _untangle(items: dict[int, list[Item]], elements,
              spans: dict[int, tuple[int, int]]) -> dict[int, list[Item]]:
    """Order each column so as few ribbons cross as possible.

    Sugiyama's, which is three things and needs all three:

    * **barycentre sweeps** -- a thing wants to sit at the average height of
      what it is joined to, so each pass sorts a column by where its
      neighbours sit in the column before (going forward) or after (going
      back), and the directions alternate.  Done once forward, which is what
      this was, the first column is ordered by nothing at all and the last has
      no say in anything;
    * **an adjacent swap pass**, because a barycentre is a position and what
      is being minimised is *crossings*.  Two columns can sit at a barycentre
      the sweeps will not leave and still cross, and swapping one neighbouring
      pair fixes it -- USDC above frxUSD, both fed from the source, with their
      destinations the other way round;
    * **keeping the best order seen**, counted rather than assumed.  Neither
      heuristic improves monotonically, so the last pass is not the best one;
      both are tried from the same start and the winner is whichever actually
      crossed least.

    Optimal ordering is NP-hard.  This is the part of it that is cheap, on a
    graph of a few dozen items.

    Ribbons passing through a column are ordered with everything else in it,
    which is what gives them a lane rather than a line drawn over the top.
    """
    before: dict[Item, list[Item]] = {}
    after: dict[Item, list[Item]] = {}
    edges: list[tuple[Item, Item]] = []

    def join(one: Item, two: Item) -> None:
        after.setdefault(one, []).append(two)
        before.setdefault(two, []).append(one)
        edges.append((one, two))

    for element in elements:
        if element.index not in spans:
            continue
        start, end = spans[element.index]
        chain: list[Item] = [("bus", element.src_slot, start)]
        chain += [("way", element.index, level) for level in range(start + 1, end)]
        chain.append(("bus", element.dst_slot, end))
        for one, two in pairwise(chain):
            join(one, two)

    levels = sorted(items)
    # Edges grouped by the column they leave, because every one of them spans
    # exactly one column and a swap inside a column can only change the
    # crossings on its two sides.  Counting the whole picture for every
    # candidate swap instead cost 109 ms a redraw, and a redraw happens on
    # every keystroke and every drag of the window edge.
    at_level: dict[int, list] = {}
    for edge in edges:
        at_level.setdefault(edge[0][2], []).append(edge)
    first = {level: list(group) for level, group in items.items()}
    best = {level: list(group) for level, group in first.items()}
    fewest = _crossings(best, edges)

    if not fewest:
        return best
    for pick in (_mean, _median):
        order = {level: list(group) for level, group in first.items()}
        for _ in range(SWEEPS):
            settled = True
            for towards, over in ((before, levels[1:]), (after, levels[:-1][::-1])):
                _sweep(order, towards, over, pick)
                _transpose(order, at_level, levels)
                crossed = _crossings(order, edges)
                if crossed < fewest:
                    fewest = crossed
                    best = {level: list(group) for level, group in order.items()}
                    settled = False
                # Nothing beats none, and most routes reach it on the first
                # pass -- worth the check, because this runs on every redraw
                # and a redraw runs on every frame of a window drag.
                if not fewest:
                    return best
            if settled:
                break           # a whole round changed nothing; more will not
    return best


def _sweep(order: dict[int, list], towards: dict, over: list[int], pick) -> None:
    """One pass, sorting each column by where its neighbours sit."""
    place = {item: k for group in order.values() for k, item in enumerate(group)}
    for level in over:
        order[level].sort(key=lambda item: pick(
            [place[n] for n in towards.get(item, ()) if n in place], place[item]))
        # The column just settled is what the next one sorts against, so a
        # pass carries its improvement along instead of every column answering
        # to where things were before the pass began.
        place.update({item: k for k, item in enumerate(order[level])})


def _transpose(order: dict[int, list], at_level: dict[int, list],
               levels: list[int]) -> None:
    """Swap neighbours while that leaves fewer crossings behind.

    What gets out of the local minimum a barycentre settles into: two columns
    fed from the same source whose destinations are the other way round sit at
    a barycentre the sweeps will not leave, and one swap undoes it.

    When nothing is strictly better it steps *sideways* once per pair -- takes
    a swap that changes nothing -- and carries on.  Some improvements need two
    columns to move together and neither move pays on its own: the route in
    the picture that prompted this needed USDC and frxUSD swapped in one
    column *and* a lane lifted past DAI in the next, and stopping at the first
    plateau left both crossings in place.  Nothing is ever kept because of a
    sideways step; the caller only keeps an order that counted better.

    Only the links either side of the column being changed are counted -- the
    rest of the picture cannot have moved.
    """
    place = {item: k for group in order.values() for k, item in enumerate(group)}
    drifted: set[tuple[int, int]] = set()
    loose = False
    for _ in range(TRANSPOSES):
        moved = stepped = False
        for level in levels:
            group = order[level]
            # The two sides are counted apart: an index in one column means
            # nothing beside an index in another, and comparing across the two
            # made the pass "improve" the picture into more crossings than it
            # started with.
            into = at_level.get(level - 1, [])
            out = at_level.get(level, [])
            for k in range(len(group) - 1):
                one, two = group[k], group[k + 1]
                was = _inversions(into, place) + _inversions(out, place)
                place[one], place[two] = k + 1, k
                now = _inversions(into, place) + _inversions(out, place)
                sideways = loose and now == was and (level, k) not in drifted
                if now < was or sideways:
                    group[k], group[k + 1] = two, one
                    moved = moved or now < was
                    if sideways:
                        drifted.add((level, k))
                        stepped = True
                else:
                    place[one], place[two] = k, k + 1
        if moved or stepped:
            continue
        if loose:
            return
        loose = True


def _inversions(edges: list, place: dict) -> int:
    """How many of these links cross each other."""
    total = 0
    for k, (one, two) in enumerate(edges):
        for other, further in edges[k + 1:]:
            if (place[one] - place[other]) * (place[two] - place[further]) < 0:
                total += 1
    return total


def _crossings(order: dict[int, list], edges: list) -> int:
    """How many pairs of links cross, over the whole picture.

    Two links between the same pair of columns cross when they arrive in the
    opposite order to the one they left in -- which is the whole of it, since
    every link here spans exactly one column.
    """
    place = {item: k for group in order.values() for k, item in enumerate(group)}
    total = 0
    for k, (one, two) in enumerate(edges):
        if one not in place or two not in place:
            continue
        for other, further in edges[k + 1:]:
            if other not in place or further not in place:
                continue
            if one[2] != other[2]:
                continue
            if (place[one] - place[other]) * (place[two] - place[further]) < 0:
                total += 1
    return total


def _mean(values: list[float], fallback: float) -> float:
    return sum(values) / len(values) if values else fallback


def _median(values: list[float], fallback: float) -> float:
    """The other classic heuristic.

    It ignores how far away an outlying neighbour is, where the mean is
    dragged by it -- so the two settle in different places and one of them is
    usually better than the other.  Which one is not worth predicting, so both
    are run.
    """
    if not values:
        return fallback
    values = sorted(values)
    middle = len(values) // 2
    if len(values) % 2:
        return values[middle]
    return (values[middle - 1] + values[middle]) / 2


def _ribbons(elements, boxes: dict[int, BusBox],
             waypoints: dict[tuple[int, int], float],
             spans: dict[int, tuple[int, int]], weight: dict[int, float],
             scale: float, min_band: float, step: float,
             bus_width: float) -> list[Band]:
    """Where each leg leaves, what it passes on the way, and where it arrives.

    A bus's ribbons leave and arrive in the order of the bus at the other end,
    so two legs sharing a node do not swap places crossing it.
    """
    leaving: dict[int, float] = {slot: box.y for slot, box in boxes.items()}
    arriving: dict[int, float] = {slot: box.y for slot, box in boxes.items()}

    out_order: dict[int, list] = {}
    in_order: dict[int, list] = {}
    for element in elements:
        out_order.setdefault(element.src_slot, []).append(element)
        in_order.setdefault(element.dst_slot, []).append(element)
    for group in out_order.values():
        group.sort(key=lambda e: _partner(e, e.dst_slot, boxes, waypoints, spans, +1))
    for group in in_order.values():
        group.sort(key=lambda e: _partner(e, e.src_slot, boxes, waypoints, spans, -1))

    starts: dict[int, float] = {}
    for slot, group in out_order.items():
        for element in group:
            tall = max(min_band, weight.get(element.index, 0.0) * scale)
            starts[element.index] = leaving.get(slot, 0.0)
            leaving[slot] = leaving.get(slot, 0.0) + tall
    ends: dict[int, float] = {}
    for slot, group in in_order.items():
        for element in group:
            tall = max(min_band, weight.get(element.index, 0.0) * scale)
            ends[element.index] = arriving.get(slot, 0.0)
            arriving[slot] = arriving.get(slot, 0.0) + tall

    bands: list[Band] = []
    for element in elements:
        source, target = boxes.get(element.src_slot), boxes.get(element.dst_slot)
        if source is None or target is None:
            continue
        start, end = spans.get(element.index, (source.layer, target.layer))
        points: list[tuple[float, float]] = [
            (source.x + source.width, starts[element.index])]
        for level in range(start + 1, end):
            y = waypoints.get((element.index, level))
            if y is None:
                continue
            points.append((level * step, y))
            points.append((level * step + bus_width, y))
        points.append((target.x, ends[element.index]))
        bands.append(Band(
            index=element.index,
            label=getattr(element, "label", "") or "",
            kind=getattr(element.kind, "name", str(element.kind)),
            share=float(element.share_pct),
            points=tuple(points),
            height=max(min_band, weight.get(element.index, 0.0) * scale),
            colour=element.index,
            detail=getattr(element, "detail", "") or "",
        ))
    return bands


def _partner(element, slot: int, boxes: dict[int, BusBox],
             waypoints: dict[tuple[int, int], float],
             spans: dict[int, tuple[int, int]], forward: int) -> float:
    """How high a leg's next stop sits, for ordering ribbons at a node.

    Its own waypoint in the adjoining column where it has one, because that
    is where the ribbon actually goes next; the far bus may be several
    columns away and says nothing useful about which way to leave.  Leaving
    looks at the first, arriving at the last.
    """
    start, end = spans.get(element.index, (0, 0))
    levels = range(start + 1, end)
    for level in (levels if forward > 0 else reversed(levels)):
        y = waypoints.get((element.index, level))
        if y is not None:
            return y
    box = boxes.get(slot)
    return box.middle if box is not None else 0.0


def pool_name(band) -> str:
    """What to call a leg on the picture.

    The registry's own name with its boilerplate off, except where that name
    is just the two tokens either side -- "crvUSD -> scrvUSD" is a vault
    deposit, and the picture has already said both of those twice.  What it
    has not said is that the leg is a deposit.
    """
    name = (band.label or "").strip()
    for prefix in BOILERPLATE:
        if name.startswith(prefix):
            name = name[len(prefix):].strip()
            break
    if not name or "->" in name:
        return LEG_KINDS.get(band.kind, "")
    return name


def summarise(diagram) -> tuple[int, int]:
    """`(pools, legs)` -- what the widget says under the amounts.

    Pools rather than legs, counted distinctly: a route that uses one pool
    twice is two legs through one market, and someone reading "3 pools" and
    counting three names is not being told something different.
    """
    elements = list(getattr(diagram, "elements", ()) or ())
    pools = {e.target.lower() for e in elements if getattr(e, "target", "")}
    return len(pools), len(elements)


#: What an exported diagram is drawn at.  Bigger than the frame on screen,
#: because the file is for putting in something else and a 480-pixel picture
#: of a fifteen-pool route is not worth saving.
EXPORT_WIDTH = 1400.0
EXPORT_HEIGHT = 620.0

#: Air around the drawing in an exported file.  The source and destination
#: names are centred on columns that sit on the frame's edges, so without it
#: half of each is outside the picture.
EXPORT_MARGIN = 60.0


def to_svg(diagram, *, width: float = EXPORT_WIDTH, height: float = EXPORT_HEIGHT,
           title: str = "", colours=(), paper: str = "#ffffff",
           ink: str = "#1a1a1a", quiet: str = "#666666") -> str:
    """The same layout, as a file someone can keep.

    SVG rather than a screenshot of the canvas: it is text, it is the same on
    both platforms, and it scales -- and the geometry is already computed, so
    this is a second renderer over `layout` rather than a second drawing.

    Marks are left out.  They are PNGs in a bundle fetched at runtime, and
    embedding them would make this a binary that has to wait for the network;
    the names are what the picture is read by anyway.
    """
    inset = EXPORT_MARGIN
    got = layout(diagram, width - inset * 2, height - LABEL_HEIGHT - inset * 2)
    palette = list(colours) or ["#4878a8", "#a87848", "#78a848", "#8848a8",
                                "#48a8a8", "#a84878"]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" '
        f'height="{height:.0f}" viewBox="0 0 {width:.0f} {height:.0f}">',
        f'<rect width="100%" height="100%" fill="{paper}"/>',
    ]
    if title:
        out.append(f'<text x="14" y="24" font-family="sans-serif" '
                   f'font-size="15" fill="{ink}">{_escaped(title)}</text>')
    top = inset + (24.0 if title else 0.0)

    out.append(f'<g transform="translate({inset:.0f} 0)">')
    for band in got.bands:
        colour = palette[band.colour % len(palette)]
        out.append(f'<path d="{_svg_ribbon(band, top)}" fill="{colour}" '
                   f'fill-opacity="0.55"/>')
    for bus in got.buses:
        shade = ink if (bus.is_source or bus.is_dest) else quiet
        out.append(
            f'<rect x="{bus.x:.1f}" y="{bus.y + top:.1f}" width="{bus.width:.1f}" '
            f'height="{bus.height:.1f}" rx="3" fill="{shade}"/>')
        # Every column, not just the two ends.  On screen the ones in
        # between are identified by the marks on the pool chips either side
        # of them; a file has no marks in it, so a name is all there is.
        label = bus.symbol
        if not label:
            continue
        middle = bus.x + bus.width / 2
        out.append(
            f'<text x="{middle:.1f}" y="{bus.y + bus.height + top + 14:.1f}" '
            f'text-anchor="middle" font-family="sans-serif" font-size="12" '
            f'font-weight="bold" fill="{ink}">{_escaped(label)}</text>')
        if bus.amount:
            out.append(
                f'<text x="{middle:.1f}" y="{bus.y + bus.height + top + 27:.1f}" '
                f'text-anchor="middle" font-family="sans-serif" font-size="11" '
                f'fill="{quiet}">{_escaped(bus.amount)}</text>')
    for band in got.bands:
        name = pool_name(band)
        if not name or band.height < 12:
            continue
        x, y, _room = band.waist()
        out.append(
            f'<text x="{x:.1f}" y="{y + top + 3:.1f}" text-anchor="middle" '
            f'font-family="sans-serif" font-size="10" fill="{ink}">'
            f'{_escaped(name)}</text>')
    out.append("</g>")
    out.append("</svg>")
    return "\n".join(out)


def _svg_ribbon(band: Band, top: float) -> str:
    """One ribbon's outline: along the top edge, down, and back."""
    points = [(x, y + top) for x, y in band.points]
    parts = [f"M {points[0][0]:.1f} {points[0][1]:.1f}"]
    for (x0, y0), (x1, y1) in pairwise(points):
        middle = (x0 + x1) / 2
        parts.append(f"C {middle:.1f} {y0:.1f} {middle:.1f} {y1:.1f} "
                     f"{x1:.1f} {y1:.1f}")
    parts.append(f"L {points[-1][0]:.1f} {points[-1][1] + band.height:.1f}")
    for (x1, y1), (x0, y0) in pairwise(points[::-1]):
        middle = (x0 + x1) / 2
        parts.append(f"C {middle:.1f} {y1 + band.height:.1f} "
                     f"{middle:.1f} {y0 + band.height:.1f} "
                     f"{x0:.1f} {y0 + band.height:.1f}")
    parts.append("Z")
    return " ".join(parts)


def _escaped(text: str) -> str:
    """XML's five, so a token called `A&B` does not break the file."""
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&apos;"))
