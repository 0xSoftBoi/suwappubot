"""The route diagram's geometry, which is where its mistakes are.

A ribbon that overlaps its neighbour, a column off the edge, shares that do
not add up -- none of that needs a window to find, which is why the arithmetic
is a module of its own.

The one that got out: buses were put in the column of their position in the
router's list, which says nothing about how far along a bus is.  A leg then
ran backwards and drew one ribbon straight over another.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import pairwise

import pytest

from ui.routegraph import (
    MIN_BAND,
    NODE_GAP,
    WAY_GAP,
    flows,
    layers,
    layout,
    pool_name,
    summarise,
)


@dataclass
class FakeBus:
    slot: int
    symbol: str = ""
    amount: str = ""
    token: str = ""
    is_source: bool = False
    is_dest: bool = False


@dataclass
class FakeKind:
    name: str = "SWAP_STABLE"


@dataclass
class FakeElement:
    index: int
    src_slot: int
    dst_slot: int
    share_pct: float
    label: str = ""
    target: str = "0xpool"
    detail: str = ""
    kind: FakeKind = field(default_factory=FakeKind)
    #: What the leg takes out of its bus, which is what the widths are split
    #: by.  Defaults to the share, so a test that says 60/40 gets 60/40.
    amount_in: str = ""
    amount_out: str = ""

    def __post_init__(self) -> None:
        if not self.amount_in:
            self.amount_in = str(self.share_pct)
        if not self.amount_out:
            self.amount_out = self.amount_in


@dataclass
class FakeDiagram:
    buses: list = field(default_factory=list)
    elements: list = field(default_factory=list)
    order: list = field(default_factory=list)


def straight() -> FakeDiagram:
    """One leg, source to destination."""
    return FakeDiagram(
        buses=[FakeBus(0, "USDC", "1,000", is_source=True),
               FakeBus(1, "WETH", "0.41", is_dest=True)],
        elements=[FakeElement(0, 0, 1, 100.0, "3pool", "0xaaa")],
        order=[0, 1],
    )


def split() -> FakeDiagram:
    """Two legs out of the source, merging on the destination."""
    return FakeDiagram(
        buses=[FakeBus(0, "USDC", "1,000", is_source=True),
               FakeBus(1, "crvUSD", "999"),
               FakeBus(2, "WETH", "0.41", is_dest=True)],
        elements=[
            FakeElement(0, 0, 1, 60.0, "a", "0xaaa"),
            FakeElement(1, 0, 2, 40.0, "b", "0xbbb"),
            FakeElement(2, 1, 2, 100.0, "c", "0xccc"),
        ],
        order=[0, 1, 2],
    )


def overtake() -> FakeDiagram:
    """A leg that skips a column: half goes straight from source to
    destination while the other half stops at a token in between."""
    return FakeDiagram(
        buses=[FakeBus(0, "USDC", "1,000", is_source=True),
               FakeBus(1, "crvUSD", "500"),
               FakeBus(2, "WETH", "0.41", is_dest=True)],
        elements=[
            FakeElement(0, 0, 1, 50.0, "a", "0xaaa"),
            FakeElement(1, 1, 2, 100.0, "b", "0xbbb"),
            FakeElement(2, 0, 2, 50.0, "c", "0xccc"),
        ],
        order=[0, 1, 2],
    )


def test_an_empty_diagram_lays_out_to_nothing():
    got = layout(FakeDiagram(), 400, 200)
    assert got.buses == [] and got.bands == []
    assert (got.width, got.height) == (400, 200)


def test_a_column_keeps_the_address_of_the_token_it_holds():
    """What the logo beside its name is looked up by.  A symbol is ambiguous
    across chains and is not what the asset bundle is keyed on."""
    diagram = straight()
    diagram.buses[0].token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    got = layout(diagram, 400, 200)
    source = next(bus for bus in got.buses if bus.is_source)
    assert source.token == "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    assert next(b for b in got.buses if b.is_dest).token == "", "absent is fine"


def test_the_columns_span_the_width_and_stay_inside_it():
    got = layout(split(), 400, 200)
    assert got.columns == 3
    assert min(bus.x for bus in got.buses) == 0
    assert max(bus.x + bus.width for bus in got.buses) == 400


def test_every_leg_runs_left_to_right():
    """The regression. A bus put in the column of its list position let a leg
    run backwards, which draws one ribbon over another."""
    got = layout(split(), 400, 300)
    for band in got.bands:
        assert band.x1 > band.x0, f"leg {band.index} runs backwards"


def test_a_bus_sits_past_everything_that_reaches_it():
    """Longest path, not shortest: the destination here is reached directly
    *and* through crvUSD, so it has to sit past both."""
    depth = layers(split())
    assert depth[0] == 0
    assert depth[1] == 1
    assert depth[2] == 2, "reached directly at layer 1 and via crvUSD at 2"


def test_the_columns_do_not_depend_on_the_order_the_legs_arrive_in():
    """A leg listed before the leg that feeds it must not pull its bus left.

    The router orders legs so a node's inflows precede its outflows -- it has
    to, to execute them -- but relying on that put a token in the column
    *before* the token it is made from the moment the order differed.
    """
    forward = FakeDiagram(
        buses=[FakeBus(0, "A", is_source=True), FakeBus(1, "B"),
               FakeBus(2, "C", is_dest=True)],
        elements=[FakeElement(0, 0, 1, 100.0, target="0xa"),
                  FakeElement(1, 1, 2, 100.0, target="0xb")],
        order=[0, 1, 2],
    )
    backward = FakeDiagram(
        buses=list(forward.buses),
        # The same route, the second leg listed first.
        elements=[FakeElement(0, 1, 2, 100.0, target="0xb"),
                  FakeElement(1, 0, 1, 100.0, target="0xa")],
        order=[0, 1, 2],
    )
    assert layers(forward) == layers(backward) == {0: 0, 1: 1, 2: 2}
    for diagram in (forward, backward):
        for band in layout(diagram, 400, 300).bands:
            assert band.x1 > band.x0


def test_a_route_that_revisits_a_token_still_fits_its_frame():
    """The bus graph is not always acyclic -- a route can sell a token it
    bought back, which the router reports as a pool used more than once.

    Relaxing over such a loop pushed every bus rightwards until it hit the
    iteration bound, and the whole diagram ended up crushed into the last
    fifth of the paper.
    """
    diagram = FakeDiagram(
        buses=[FakeBus(0, "A", is_source=True), FakeBus(1, "B"),
               FakeBus(2, "C"), FakeBus(3, "D", is_dest=True)],
        elements=[
            FakeElement(0, 0, 1, 100.0, target="0xa"),
            FakeElement(1, 1, 2, 100.0, target="0xb"),
            FakeElement(2, 2, 1, 50.0, target="0xc"),   # back to B
            FakeElement(3, 2, 3, 50.0, target="0xd"),
        ],
        order=[0, 1, 2, 3],
    )
    depth = layers(diagram)
    assert max(depth.values()) <= 3, f"a loop must not inflate the columns: {depth}"
    got = layout(diagram, 400, 300)
    assert min(bus.x for bus in got.buses) == 0, "the picture starts at the edge"
    assert max(bus.x + bus.width for bus in got.buses) == 400


def test_a_single_leg_fills_the_height():
    got = layout(straight(), 400, 200)
    assert len(got.bands) == 1
    band = got.bands[0]
    assert band.height > 100, "one leg carries everything"
    assert band.x0 < band.x1


def test_ribbons_leaving_one_bus_are_contiguous_and_fill_it():
    """A Sankey's links meet at a node with no gap between them; the gaps in
    this picture are between *buses*."""
    got = layout(split(), 400, 300)
    source = next(bus for bus in got.buses if bus.is_source)
    out = sorted((b for b in got.bands if b.x0 == source.x + source.width),
                 key=lambda b: b.y0)
    assert len(out) == 2
    first, second = out
    assert second.y0 == first.y0 + first.height, "no gap, and no overlap"
    assert abs((second.y0 + second.height) - (source.y + source.height)) < 0.01


def test_ribbons_arriving_at_one_bus_do_not_overlap_either():
    got = layout(split(), 400, 300)
    dest = next(bus for bus in got.buses if bus.is_dest)
    into = sorted((b for b in got.bands if b.x1 == dest.x), key=lambda b: b.y1)
    assert len(into) == 2
    first, second = into
    assert second.y1 >= first.y1 + first.height - 0.01


def test_a_split_is_drawn_in_proportion():
    got = layout(split(), 400, 300)
    source = next(bus for bus in got.buses if bus.is_source)
    sixty, forty = sorted(
        (b for b in got.bands if b.x0 == source.x + source.width),
        key=lambda b: -b.share,
    )
    assert sixty.share == 60.0 and forty.share == 40.0
    assert abs(sixty.height / forty.height - 1.5) < 0.05, "60/40, near enough"


def test_a_leg_is_drawn_by_its_share_of_the_route_not_of_its_node():
    """The last leg of a split carries 100% *of its node*, which is 60% of the
    trade. Drawn as it comes it would look like the whole thing."""
    got = layout(split(), 400, 300)
    source = next(bus for bus in got.buses if bus.is_source)
    big = next(b for b in got.bands
               if b.x0 == source.x + source.width and b.share == 60.0)
    onward = next(b for b in got.bands if b.share == 100.0)
    assert abs(onward.height - big.height) < 0.01


def test_a_leg_carrying_almost_nothing_is_still_visible():
    diagram = FakeDiagram(
        buses=[FakeBus(0, "A", is_source=True), FakeBus(1, "B", is_dest=True)],
        elements=[FakeElement(0, 0, 1, 99.6, "big", "0xaaa"),
                  FakeElement(1, 0, 1, 0.4, "tiny", "0xbbb")],
        order=[0, 1],
    )
    got = layout(diagram, 400, 200)
    assert min(band.height for band in got.bands) >= MIN_BAND


def test_two_buses_in_one_column_are_stacked_with_room_for_their_names():
    diagram = FakeDiagram(
        buses=[FakeBus(0, "A", is_source=True), FakeBus(1, "B"),
               FakeBus(2, "C"), FakeBus(3, "D", is_dest=True)],
        elements=[
            FakeElement(0, 0, 1, 50.0, target="0xa"),
            FakeElement(1, 0, 2, 50.0, target="0xb"),
            FakeElement(2, 1, 3, 100.0, target="0xc"),
            FakeElement(3, 2, 3, 100.0, target="0xd"),
        ],
        order=[0, 1, 2, 3],
    )
    got = layout(diagram, 400, 400)
    middle = sorted((bus for bus in got.buses if bus.layer == 1),
                    key=lambda b: b.y)
    assert len(middle) == 2
    upper, lower = middle
    assert lower.y - (upper.y + upper.height) == NODE_GAP


def test_a_leg_that_skips_a_column_is_given_a_lane_through_it():
    """The one this picture kept getting wrong.

    A ribbon spanning several columns used to be a single curve between its
    two ends, drawn over whatever happened to live in between.  It now has a
    point on each side of every column it passes, and that point is placed by
    the same ordering as the buses -- so it goes round them, not through.
    """
    got = layout(overtake(), 400, 300)
    middle = next(bus for bus in got.buses if bus.layer == 1)
    span = next(band for band in got.bands
                if band.x0 < middle.x and band.x1 > middle.x + middle.width)
    inside = [(x, y) for x, y in band_points(span)
              if middle.x - 0.01 <= x <= middle.x + middle.width + 0.01]
    assert len(inside) == 2, "a point on each side of the column it passes"
    for _, y in inside:
        assert (y + span.height <= middle.y + 0.01
                or y >= middle.y + middle.height - 0.01), "clear of the bus"


def test_a_lane_keeps_its_distance_from_the_bus_it_passes():
    got = layout(overtake(), 400, 300)
    middle = next(bus for bus in got.buses if bus.layer == 1)
    span = next(band for band in got.bands
                if band.x0 < middle.x and band.x1 > middle.x + middle.width)
    y = next(y for x, y in band_points(span) if abs(x - middle.x) < 0.01)
    gap = (middle.y - (y + span.height) if y < middle.y
           else y - (middle.y + middle.height))
    assert gap >= WAY_GAP - 0.01


def test_the_whole_thing_stays_inside_the_frame():
    got = layout(split(), 400, 300)
    for bus in got.buses:
        assert bus.y >= 0
        assert bus.y + bus.height <= 300
    for band in got.bands:
        assert min(band.y0, band.y1) >= 0
        assert max(band.y0, band.y1) + band.height <= 300


def test_a_spanning_ribbon_stays_inside_the_frame_all_the_way_along():
    got = layout(overtake(), 400, 300)
    for band in got.bands:
        for _, y in band_points(band):
            assert y >= 0
            assert y + band.height <= 300


def band_points(band) -> list[tuple[float, float]]:
    return list(band.points)


def test_summarise_counts_pools_not_legs():
    """A route through one pool twice is two legs through one market."""
    diagram = FakeDiagram(elements=[
        FakeElement(0, 0, 1, 100.0, target="0xAAA"),
        FakeElement(1, 1, 2, 100.0, target="0xaaa"),
        FakeElement(2, 2, 3, 100.0, target="0xbbb"),
    ])
    assert summarise(diagram) == (2, 3)


def two_columns_must_move_together() -> FakeDiagram:
    """A real crvUSD -> sDOLA route, as the router solved it.

    Kept verbatim -- slots, shares and the order the router listed them --
    because what it is here for is a property of this particular shape:
    swapping USDC past frxUSD in one column leaves the crossing count exactly
    where it was, and so does lifting a lane past DAI in the next; only both
    together remove anything.  A search that stops at the first plateau leaves
    two crossings in the picture, and this is the picture they were reported
    in.
    """
    return FakeDiagram(
        buses=[FakeBus(0, "crvUSD", "2m", is_source=True), FakeBus(1, "scrvUSD"),
               FakeBus(2, "USDC"), FakeBus(3, "frxUSD"),
               FakeBus(4, "sDOLA", "1.42m", is_dest=True), FakeBus(5, "sUSDe"),
               FakeBus(6, "DAI"), FakeBus(7, "sUSDS"), FakeBus(8, "sDAI"),
               FakeBus(9, "DOLA")],
        elements=[
            FakeElement(1, 0, 2, 47.8019, target="0x4DEcE6"),
            FakeElement(2, 0, 3, 25.5872, target="0x13e12B"),
            FakeElement(3, 0, 1, 100.0, target="0x065597"),
            FakeElement(4, 0, 1, 100.0, target="0x065597"),
            FakeElement(5, 1, 4, 20.0338, target="0x76A962"),
            FakeElement(6, 1, 5, 6.5770, target="0xd29f89"),
            FakeElement(7, 2, 6, 100.0, target="0xbEbc44"),
            FakeElement(8, 3, 7, 61.7348, target="0x81A261"),
            FakeElement(9, 3, 4, 38.2652, target="0x9D8AFD"),
            FakeElement(10, 6, 8, 100.0, target="0x83f20f"),
            FakeElement(11, 8, 5, 100.0, target="0x167478"),
            FakeElement(12, 7, 9, 100.0, target="0x8b83c4"),
            FakeElement(13, 5, 9, 100.0, target="0x744793"),
            FakeElement(14, 9, 4, 100.0, target="0xb45ad1"),
        ],
        order=[0, 1, 2, 3, 6, 7, 8, 5, 9, 4],
    )


def crossing_pairs(got) -> list[tuple[int, int]]:
    """Which pairs of ribbons swap order somewhere along the picture.

    Sampled along the polyline rather than solved: what is being checked is
    what someone sees, and two ribbons that end up the other way round from
    how they started have crossed however they got there.
    """
    def height_at(band, x):
        points = band.points
        if x < points[0][0] or x > points[-1][0]:
            return None
        for (x0, y0), (x1, y1) in pairwise(points):
            if x0 <= x <= x1:
                if x1 == x0:
                    return y1 + band.height / 2
                part = (x - x0) / (x1 - x0)
                return y0 + (y1 - y0) * part + band.height / 2
        return None

    found = []
    for i, one in enumerate(got.bands):
        for two in got.bands[i + 1:]:
            above = None
            for step in range(201):
                x = step * got.width / 200
                first, second = height_at(one, x), height_at(two, x)
                if first is None or second is None:
                    continue
                now = first < second
                if above is not None and now != above:
                    found.append((one.index, two.index))
                    break
                above = now
    return found


def test_two_columns_that_have_to_move_together_still_untangle():
    assert crossing_pairs(layout(two_columns_must_move_together(), 1000, 400)) == []


def test_a_plain_split_has_nothing_to_untangle():
    assert crossing_pairs(layout(split(), 400, 300)) == []
    assert crossing_pairs(layout(overtake(), 400, 300)) == []


def test_a_registry_name_loses_only_its_boilerplate():
    """"Curve.fi Factory Plain Pool:" is on a great many of them and says
    nothing about which one."""
    class Leg:
        def __init__(self, label, kind="SWAP_STABLE"):
            self.label, self.kind = label, kind

    assert pool_name(Leg("Curve.fi Factory Plain Pool: crvUSD/USDC")) == "crvUSD/USDC"
    assert pool_name(Leg("Curve.fi DAI/USDC/USDT")) == "DAI/USDC/USDT"
    assert pool_name(Leg("crvUSD/frxUSD")) == "crvUSD/frxUSD"
    assert pool_name(Leg("SaveDola")) == "SaveDola"


def test_a_leg_named_after_its_two_ends_says_what_it_does_instead():
    """The columns either side already carry both names, twice over.  What
    the picture does not otherwise say is that this one is a deposit."""
    class Leg:
        def __init__(self, label, kind):
            self.label, self.kind = label, kind

    assert pool_name(Leg("crvUSD -> scrvUSD", "ERC4626_DEPOSIT")) == "deposit"
    assert pool_name(Leg("ETH -> WETH", "WRAP_NATIVE")) == "wrap"
    assert pool_name(Leg("", "SWAP_STABLE")) == "", "nothing to say, so nothing"
    assert pool_name(Leg("A -> B", "SWAP_STABLE")) == "", "and no guessing"


# -- the widths have to balance --------------------------------------------


def test_a_conversion_does_not_claim_the_whole_trade():
    """A deposit that fills a merged node reads 100% of its node.

    So do the legs beside it read their own share of the same node, and
    multiplying the two together had the source emitting more than it held:
    measured on crvUSD -> sDOLA, 115.13% of itself, while the node the deposit
    fed passed on 84.87% of what it was given.  The picture showed it -- a
    band leaving a bus wider than the band that filled it.
    """
    diagram = FakeDiagram(
        buses=[FakeBus(0, "crvUSD", is_source=True), FakeBus(1, "scrvUSD"),
               FakeBus(2, "frxUSD"), FakeBus(3, "sDOLA", is_dest=True)],
        elements=[
            # Straight out of the source, a tenth of it.
            FakeElement(0, 0, 2, 12.03, amount_in="12030"),
            # ...and the conversion that takes the rest, which says 100%.
            FakeElement(1, 0, 1, 100.0, amount_in="87970"),
            FakeElement(2, 1, 3, 100.0, amount_in="87970"),
            FakeElement(3, 2, 3, 100.0, amount_in="12030"),
        ],
    )

    weight = flows(diagram)

    out_of_source = weight[0] + weight[1]
    assert out_of_source == pytest.approx(1.0), (
        f"the source emitted {out_of_source:.4f} of itself"
    )
    assert weight[1] == pytest.approx(weight[2]), (
        "the node the conversion fed passed on something else"
    )


def test_every_bus_passes_on_what_it_was_given():
    """In equals out, at every bus that is neither source nor destination."""
    diagram = FakeDiagram(
        buses=[FakeBus(0, "A", is_source=True), FakeBus(1, "B"),
               FakeBus(2, "C"), FakeBus(3, "D", is_dest=True)],
        elements=[
            FakeElement(0, 0, 1, 100.0, amount_in="70"),
            FakeElement(1, 0, 2, 100.0, amount_in="30"),
            FakeElement(2, 1, 3, 60.0, amount_in="42"),
            FakeElement(3, 1, 2, 40.0, amount_in="28"),
            FakeElement(4, 2, 3, 100.0, amount_in="58"),
        ],
    )

    weight = flows(diagram)

    into: dict[int, float] = {}
    out: dict[int, float] = {}
    for element in diagram.elements:
        out[element.src_slot] = out.get(element.src_slot, 0.0) + weight[element.index]
        into[element.dst_slot] = into.get(element.dst_slot, 0.0) + weight[element.index]
    for slot in (1, 2):
        assert into[slot] == pytest.approx(out[slot]), f"bus {slot} does not balance"
    assert into[3] == pytest.approx(1.0), "the destination did not receive the trade"


def test_a_grouped_amount_is_still_a_number():
    """`rendermodel.format_units` groups its thousands, so an amount arrives
    as "100,000.00" -- read as-is, every band comes out at the minimum."""
    diagram = FakeDiagram(
        buses=[FakeBus(0, "A", is_source=True), FakeBus(1, "B", is_dest=True)],
        elements=[
            FakeElement(0, 0, 1, 25.0, amount_in="1,000.000000"),
            FakeElement(1, 0, 1, 75.0, amount_in="3,000.000000"),
        ],
    )

    weight = flows(diagram)

    assert weight[0] == pytest.approx(0.25)
    assert weight[1] == pytest.approx(0.75)
