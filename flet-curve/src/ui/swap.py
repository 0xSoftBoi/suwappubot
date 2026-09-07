"""The Swap page: any coin to any coin, through the electric router.

Curve's own swap widget is the shape people expect and this follows it -- sell
box, buy box, the figures underneath, an approve step and a swap step -- with
one addition the router earns: on a wide screen the route is drawn beside it,
because this one *splits*, and a picture of a single path would be a picture
of the special case.

What this file owns is the widget.  Deciding when a quote happens belongs to
`router.host`, which has no Flet in it, and drawing the route belongs to
`ui.routegraph`, which has no Flet in its arithmetic.
"""

from __future__ import annotations

import asyncio
import contextlib
from itertools import pairwise

import flet as ft
import flet.canvas as cv

from curve.format import token_amount
from curve.models import Coin
from router.universe import CoinEntry, matching_coins
from wallet.erc20 import format_units, parse_units

from . import AnyEvent, assets, buttons, download, routegraph, safe_update, theme
from .alarm import Alarm, Band
from .logos import coin_stack, token_mark
from .responsive import Layout
from .status import DONE, FAILED, StatusPanel
from .typography import BODY, LABEL, SMALL, TITLE

#: How wide the widget is allowed to get.  Curve's own is about this, and a
#: swap box that spans a desktop window reads as a form rather than a control.
WIDGET_WIDTH = 480.0

#: What the diagram is given when it is stacked under the widget rather than
#: set beside it.  Beside the widget it takes whatever is left.
DIAGRAM_MIN_WIDTH = 420.0

#: How tall the paper is.  A number rather than the widget's own height:
#: Flet has no `IntrinsicHeight`, and a `Row` that stretches its children needs
#: a bounded height, which inside the page's scroller there is none of --
#: asking for it drew nothing at all.  Set to about what the widget stands at
#: with both buttons showing, and left there: the widget grows and shrinks as
#: an approval step or a status line comes and goes, and a picture that
#: followed it would be the most restless thing on the page.  Measured at 500
#: once the buttons grew to the height of a field, less the frame's own three.
DIAGRAM_HEIGHT = 497.0

#: How tall the route is when it is stacked under the widget instead of set
#: beside it, where there is less width for the same picture.
DIAGRAM_STACKED_HEIGHT = 300.0

#: What the frame says before there is a route in it -- so that the frame can
#: be there from the start rather than appearing under someone's hands.
EMPTY_ROUTE = "The route appears here"

#: How much room the sticker leaves around itself in an otherwise empty
#: frame.  It fills the rest, keeping its own shape.
MEME_INSET = 28.0

#: How long each one stays before the next.  Long enough not to be a thing
#: flashing beside a number somebody is reading, short enough to be worth
#: waiting through a warm for.
MEME_EVERY = 30.0

#: How long a frame that *had* a route stays blank before one goes up.  The
#: flip button empties the panel and fills it again as soon as the new quote
#: lands, and a picture appearing for the few hundred milliseconds in between
#: is a flash rather than something to look at.  A frame that never had a
#: route -- an opening tab, waiting out a warm -- does not wait at all.
MEME_AFTER = 1.5

#: Air either side of a column's label.  Two labels closer than this are two
#: words read as one, so the later of them is left out -- an eighteen-leg
#: route, which this router really does produce, puts a column every twenty
#: pixels.  The bands still show the shape; the names that survive are the
#: ones with room to be read.
LABEL_AIR = 4.0

#: How wide a column's label is allowed to be, and never less than.  A label
#: claims only the room its own text needs: measuring them all at the widest
#: made a five-letter name push its neighbour out for nothing.
LABEL_BOX = 96.0
LABEL_MIN = 34.0

#: How far under its column a label sits.
LABEL_DROP = 5.0

#: The size a pool's name is drawn at on its ribbon -- a step under a column
#: name, because a column is what the trade is *between* and a pool is how it
#: got there.
LEG_LABEL = 10.0

#: How tall a ribbon must be before its name is written on it.  Below this the
#: text is taller than the flow it names and reads as a caption for whatever
#: is behind it.
LEG_MIN_BAND = 15.0

#: Air around a pool name, and how much of its run it may take.  A name
#: filling its ribbon end to end reads as a label for the columns either side.
LEG_AIR = 5.0
LEG_ROOM = 0.86

#: How far the figures under the amounts sit in from the widget's edge.  The
#: impact row is a tinted band and the rest are untinted ones, so they all
#: carry the same padding or the tinted one reads as indented.
ROW_INDENT = 6

#: The save button in the widget's top corner, and the icon inside it.  The
#: title is centred against this width, so the two move together.
SAVE_BUTTON = 34
SAVE_ICON = 18

#: What an amount box says before there is a balance to put there.
HINT = "0.0"

#: And what colour it says it in.  Paler than the theme's quiet ink, because
#: what the hint has to say is "this is not the number you are typing" and
#: nothing here but the colour says it.
HINT_COLOUR = ft.Colors.with_opacity(0.55, ft.Colors.ON_SURFACE_VARIANT)

#: The size a coin's mark is drawn at in the picker and the boxes -- the same
#: 20 the pool page's coin dropdown uses for its own.
MARK = 20

#: And on the route, where it sits beside a name at `LABEL`.  Small enough
#: that a picture with a dozen columns is still a picture of the flow rather
#: than a row of badges.
ROUTE_MARK = 14

#: Between that mark and the name it belongs to.
MARK_GAP = 4.0

#: The size a pool's coins are stacked at on its ribbon.  Smaller than a
#: column's mark, because a column is what the trade is *between* and a pool
#: is how it got there.
POOL_MARK = 13

#: ...and the smallest they are worth drawing at.  Below this a token mark is
#: a coloured dot, which says a pool has coins and nothing about which.
POOL_MARK_MIN = 9

#: How many of a pool's coins are stacked before the rest become "+n", and
#: how much each overlaps the one before -- `logos.coin_stack`'s own, since
#: what is being computed here is the width of what it will draw.
POOL_MARK_LIMIT = 4
STACK_OVERLAP = 0.34

#: Above this a price impact is worth a warning rather than a number.  The
#: same threshold the in-pool swap uses, so the two tabs agree about what
#: "high" means.
IMPACT_HIGH_BP = 100.0

#: What the picker's popped-open list is sized to.
PICKER_WIDTH = 340
PICKER_HEIGHT = 420

#: How wide the closed picker sits in a box.  A `SearchBar` has no width of
#: its own, so beside an expanding amount field it took the whole row and the
#: amount disappeared -- which is not a layout to leave to whoever wins.
PICKER_BAR_WIDTH = 148

#: The corner of the picker's bar, taken from the dense outlined field the
#: pool page's coin dropdown is: Material's own.
PICKER_RADIUS = 2

#: How tall both halves of a row are.  One number for the amount box and the
#: coin beside it, because they sit side by side and a dense `TextField` comes
#: out at 40 next to a `SearchBar` at 48 -- which reads as one of them having
#: gone wrong rather than as two sizes.
FIELD_HEIGHT = 48

#: And how big the figure in them is.  Larger than `BODY`: the amount and the
#: coin are what the whole widget is for, and at the body size they were the
#: same weight as the five lines of detail underneath.
FIELD_TEXT = 18


def as_coin(entry: CoinEntry) -> Coin:
    """A `CoinEntry` in the shape `token_mark` and the formatters want."""
    return Coin(address=entry.address, symbol=entry.symbol,
                decimals=entry.decimals)


class CoinPicker(ft.SearchBar):
    """A searchable coin selector, ordered by how busy the coin is.

    The network picker's control, for the network picker's reasons: a
    `SearchBar` is two things, so the bar names the coin and the box a tap
    opens is empty -- an editable `Dropdown` would put typed letters into the
    middle of the symbol already in it.
    """

    def __init__(self, page: ft.Page, chain: str, *, on_pick, label: str):
        self._page = page
        self._chain = chain
        self._entries: list[CoinEntry] = []
        self._picked: CoinEntry | None = None
        self._on_pick = on_pick
        super().__init__(
            value="",
            bar_hint_text=label,
            bar_text_style=ft.TextStyle(size=FIELD_TEXT),
            view_hint_text="Search name or paste an address",
            # Dressed as the pool page's coin dropdown, which is a dense
            # outlined field: same corner, same outline, same weight of text,
            # same height as the amount box beside it.  A `SearchBar` styles
            # itself as a search bar otherwise -- a tall shadowed pill, which
            # beside a Material text field reads as a different kind of
            # control rather than the same one with more coins in it.
            bar_shape=ft.RoundedRectangleBorder(radius=PICKER_RADIUS),
            bar_elevation=0,
            bar_bgcolor=ft.Colors.TRANSPARENT,
            bar_overlay_color=ft.Colors.TRANSPARENT,
            bar_border_side=theme.field_border(),
            bar_trailing=[ft.Icon(ft.Icons.ARROW_DROP_DOWN, size=18,
                                  color=ft.Colors.ON_SURFACE_VARIANT)],
            bar_size_constraints=ft.BoxConstraints(min_height=FIELD_HEIGHT,
                                                   max_height=FIELD_HEIGHT),
            bar_padding=ft.Padding.only(left=8, right=0),
            width=PICKER_BAR_WIDTH,
            view_size_constraints=ft.BoxConstraints(
                min_width=PICKER_WIDTH, max_width=PICKER_WIDTH,
                max_height=PICKER_HEIGHT),
            view_shape=ft.RoundedRectangleBorder(radius=12),
            on_tap=self._opened,
            on_change=self._typed,
            on_tap_outside_bar=self._left,
            on_tap_outside_view=self._left,
        )

    # ------------------------------------------------------------ the coins

    def offer(self, entries: list[CoinEntry], chain: str | None = None) -> None:
        """The coins this chain has, busiest first."""
        if chain is not None:
            self._chain = chain
        self._entries = list(entries)
        if self._picked is not None:
            match = next((e for e in self._entries
                          if e.address == self._picked.address), None)
            self.pick(match, tell=False)
        self.controls = self._rows()

    @property
    def picked(self) -> CoinEntry | None:
        return self._picked

    def pick(self, entry: CoinEntry | None, *, tell: bool = True) -> None:
        before = self._picked
        self._picked = entry
        self.value = entry.symbol if entry else ""
        self.bar_leading = (
            ft.Container(token_mark(as_coin(entry), self._chain, MARK),
                         padding=ft.Padding.only(left=4, right=MARK_GAP * 2))
            if entry else None
        )
        safe_update(self)
        if tell:
            # What it was showing goes with it: choosing the coin the other
            # picker holds is the pair the other way round, and the caller
            # cannot work that out once this has been overwritten.
            self._on_pick(entry, before)

    # ---------------------------------------------------------- the control

    def _rows(self, query: str = "") -> list[ft.Control]:
        return [self._row(entry) for entry in matching_coins(self._entries, query)]

    def _row(self, entry: CoinEntry) -> ft.Control:
        return ft.ListTile(
            leading=token_mark(as_coin(entry), self._chain, MARK),
            title=ft.Text(entry.symbol, size=BODY, no_wrap=True),
            subtitle=ft.Text(entry.name or entry.address, size=LABEL,
                             color=ft.Colors.ON_SURFACE_VARIANT, no_wrap=True),
            trailing=self._holding(entry),
            dense=True,
            selected=self._picked is not None and entry.address == self._picked.address,
            on_click=lambda _e, chosen=entry: self._chose(chosen),
        )

    def _holding(self, entry: CoinEntry) -> ft.Control | None:
        """What the wallet holds of this coin, where it holds any.

        Only on the coins that carry one, so the rest of the list is not a
        column of blanks -- and the amount over what it is worth, because the
        amount is what goes in the box and the dollars are what says whether
        it is worth going in.
        """
        if not entry.balance:
            return None
        held = format_units(entry.balance, entry.decimals, precision=entry.decimals)
        return ft.Column(
            [
                ft.Text(token_amount(float(held)), size=LABEL, no_wrap=True,
                        text_align=ft.TextAlign.RIGHT),
                ft.Text(f"${entry.worth:,.2f}", size=LABEL - 1, no_wrap=True,
                        color=ft.Colors.ON_SURFACE_VARIANT,
                        text_align=ft.TextAlign.RIGHT),
            ],
            spacing=0,
            tight=True,
            horizontal_alignment=ft.CrossAxisAlignment.END,
        )

    def _opened(self, _e: AnyEvent) -> None:
        """Open on an empty box, offering every coin.

        Opening is ours to do: a `SearchBar` reports the tap and waits.
        """
        self.value = ""
        self.controls = self._rows()
        safe_update(self)
        self._page.run_task(self.open_view)

    def _typed(self, event: AnyEvent) -> None:
        typed = getattr(event, "data", None)
        self.controls = self._rows(typed if isinstance(typed, str) else "")
        safe_update(self)

    def _left(self, _e: AnyEvent) -> None:
        """Dismissed without choosing: the coin is what it was."""
        self.value = self._picked.symbol if self._picked else ""
        self.controls = self._rows()
        safe_update(self)

    def _chose(self, entry: CoinEntry) -> None:
        # `close_view` waits on the client, so it is a task: this runs from a
        # click handler, which cannot await.  It closes on the text the bar
        # should show, which lands after `pick` has written it.
        self._page.run_task(self.close_view, entry.symbol)
        self.pick(entry)


class RouteDiagram(ft.Container):
    """The chosen route, drawn as flow through columns of tokens.

    A `cv.Canvas` for the ribbons and positioned controls for the labels: a
    canvas has no text-with-a-logo shape, and the marks are images.  The
    geometry is `ui.routegraph`, which is tested without a window.
    """

    def __init__(self, page: ft.Page, chain: str, corner: ft.Control | None = None):
        self._page = page
        self._chain = chain
        self._pool_coins: dict[str, list[Coin]] = {}
        self._diagram = None
        self._canvas = cv.Canvas(shapes=[], expand=True,
                                 on_resize=self._resized)
        self._labels = ft.Stack([], expand=True)
        self._empty = ft.Text(EMPTY_ROUTE, size=SMALL,
                              color=ft.Colors.ON_SURFACE_VARIANT,
                              text_align=ft.TextAlign.CENTER)
        # An empty frame with one line of grey text in the middle of it is a
        # lot of nothing to look at while somebody decides what to type -- and
        # the warm takes twenty seconds, which is the longest anyone looks at
        # this panel.  `CONTAIN` with nothing else set is what keeps the shape
        # while it takes the room.
        self._meme = ft.Image(src="", fit=ft.BoxFit.CONTAIN, expand=True,
                              visible=False)
        self._slideshow: object | None = None
        self._due = False
        self._size = (0.0, 0.0)
        # Whatever the caller wants in the corner -- the save button, which
        # acts on this picture and so belongs on it.  Last in the stack so it
        # is above the ribbons, and positioned rather than laid out, because a
        # row for it would take height off the drawing.
        layers: list[ft.Control] = [
            self._canvas, self._labels,
            ft.Container(
                ft.Column(
                    [self._meme, self._empty], spacing=10, expand=True,
                    alignment=ft.MainAxisAlignment.CENTER,
                    horizontal_alignment=ft.CrossAxisAlignment.CENTER),
                alignment=ft.Alignment.CENTER, expand=True,
                padding=MEME_INSET),
        ]
        if corner is not None:
            layers.append(ft.Container(corner, right=0, top=0))
        super().__init__(
            ft.Stack(layers, expand=True),
            padding=ft.Padding.all(14),
            border_radius=14,
            expand=True,
        )
        self.waiting = EMPTY_ROUTE
        # From the first frame, not from the first quote.  The warm is twenty
        # seconds of nothing to do, and it is exactly the stretch this panel
        # was empty for -- the caption was all anybody saw of it.
        self._show_meme(True)

    def before_update(self) -> None:
        # A sheet of paper with the route drawn on it, rather than another
        # panel of controls: it is the one thing here that is a picture, and
        # `panel_shadow` is Chad-only -- in the Material themes the frame was
        # a rectangle of background with a hairline round it.
        self.shadow = theme.paper_shadow(self._page)
        self.border = theme.panel_border(self._page)
        self.bgcolor = theme.paper_bg(self._page)

    @property
    def route(self):
        """The diagram being drawn, or None -- for whoever wants to save it."""
        return self._diagram

    def set_chain(self, chain: str) -> None:
        """A different chain, whose pools are different pools.

        The table goes with it: an address that meant one pool here means
        nothing on the next network, and a stale entry would put the wrong
        coins on a ribbon rather than none.
        """
        if chain != self._chain:
            self._pool_coins = {}
        self._chain = chain

    def offer_pools(self, rows) -> None:
        """Which coins each pool holds, for the marks on its ribbon.

        Off the same rows the pickers are built from, so this costs nothing
        that has not already been paid: the router's `detail` is the pool's
        address and that is what the table is keyed on.
        """
        # Nothing offered is not the same as no pools: the coins get re-offered
        # whenever the *ordering* changes -- when a wallet connects, or after a
        # swap of ours moves what it holds -- and those callers have no rows to
        # hand over.  Clearing the table for them left every ribbon on the
        # picture without its logo, for the whole of a session with a wallet in
        # it.  `set_chain` is what empties this.
        if not rows:
            return
        table: dict[str, list[Coin]] = {}
        for row in rows or ():
            address = str(row.get("address") or "").lower()
            if not address:
                continue
            table[address] = [
                Coin(address=str(coin.get("address") or ""),
                     symbol=coin.get("symbol") or "?",
                     decimals=int(coin.get("decimals") or 18))
                for coin in row.get("coins") or []
                if coin.get("address")
            ]
        self._pool_coins = table

    def show(self, diagram, chain: str | None = None) -> None:
        """Draw a route, or go back to waiting for one.

        The frame stays either way.  It used to appear with the first quote,
        which shifted the widget sideways the moment someone finished typing
        -- the one moment they are looking at it.
        """
        if chain is not None:
            self._chain = chain
        had_route = self._diagram is not None
        self._diagram = diagram
        self._empty.value = "" if diagram is not None else self.waiting
        self._show_meme(diagram is None,
                        after=MEME_AFTER if had_route else 0.0)
        self._draw()
        safe_update(self)

    def forget(self) -> None:
        """Drop the route, and wait with a picture straight away.

        Not the momentary blank that `show(None)` leaves: that one is for the
        gap between two routes on the same network, where a new one is on its
        way.  This is a different network arriving, whose warm is twenty
        seconds, and the route on screen belongs to the one being left.
        """
        self._diagram = None
        self._canvas.shapes = []
        self._labels.controls = []
        self._empty.value = self.waiting
        self._show_meme(True)
        safe_update(self)

    def say(self, message: str) -> None:
        """No route to draw, and a reason for it."""
        self._diagram = None
        self._canvas.shapes = []
        self._labels.controls = []
        self._empty.value = message
        # Not beside a reason something went wrong: a joke there reads as the
        # app being pleased with itself about a failure.
        self._show_meme(False)
        safe_update(self)

    def _show_meme(self, wanted: bool, after: float = 0.0) -> None:
        """The sticker that waits where a route will go.

        It says nothing beside itself: a caption explaining that the route
        appears here, under a picture that is plainly not a route, is a line
        nobody needs twice.  The caption comes back on its own when there is
        no picture to put there.
        """
        if not wanted:
            self._meme.visible = False
            return
        if self._meme.visible:
            self._empty.value = ""
            self._keep_turning()
            return
        if after <= 0:
            self._put_meme_up()
            return
        # Nothing at all while the wait runs: the caption flashing in the gap
        # is the same complaint as the picture flashing in it.
        self._empty.value = ""
        if self._due:
            return
        self._due = True
        started = None
        with contextlib.suppress(Exception):
            started = self._page.run_task(self._meme_when_due, after)
        if started is None:
            # No loop to wait on, so there is nothing to wait for.
            self._due = False
            self._put_meme_up()

    async def _meme_when_due(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            if self._diagram is None and not self._meme.visible:
                self._put_meme_up()
                safe_update(self)
        finally:
            self._due = False

    def _put_meme_up(self) -> None:
        self._turn_meme()
        self._keep_turning()
        if self._meme.visible:
            self._empty.value = ""

    def _turn_meme(self) -> None:
        """Put up a different one, or none if the pack was never bundled."""
        source = assets.meme()
        self._meme.src = source or ""
        self._meme.visible = bool(source)

    def _keep_turning(self) -> None:
        """One picture for a whole warm is a long look at one joke.

        Started when the first one goes up rather than in the constructor,
        which runs before there is a loop to run it on.
        """
        if self._slideshow is not None:
            return
        with contextlib.suppress(Exception):
            self._slideshow = self._page.run_task(self._slideshow_loop)

    async def _slideshow_loop(self) -> None:
        while True:
            await asyncio.sleep(MEME_EVERY)
            if not self._meme.visible:
                continue
            self._turn_meme()
            self._empty.value = ""
            safe_update(self)

    def _resized(self, event) -> None:
        self._size = (getattr(event, "width", 0.0) or 0.0,
                      getattr(event, "height", 0.0) or 0.0)
        self._draw()
        safe_update(self._canvas)
        safe_update(self._labels)

    def _draw(self) -> None:
        width, height = self._size
        if self._diagram is None or width < 40 or height < 40:
            self._canvas.shapes = []
            self._labels.controls = []
            return
        got = routegraph.layout(self._diagram, width, height - routegraph.LABEL_HEIGHT)
        shapes: list[cv.Shape] = []
        for band in got.bands:
            shapes.append(cv.Path(
                _ribbon(band.points, band.height),
                paint=ft.Paint(color=_band_colour(band.colour),
                               style=ft.PaintingStyle.FILL),
            ))
        for bus in got.buses:
            shapes.append(cv.Rect(
                bus.x, bus.y, bus.width, bus.height, border_radius=3,
                paint=ft.Paint(
                    color=ft.Colors.PRIMARY if (bus.is_source or bus.is_dest)
                    else ft.Colors.ON_SURFACE_VARIANT,
                    style=ft.PaintingStyle.FILL),
            ))
        self._canvas.shapes = shapes
        self._labels.controls = self._label_row(got, width)

    def _label_row(self, got, width: float) -> list[ft.Control]:
        """The column names there is room to read, and no two on top of
        each other.

        The source and the destination carry their name and their amount;
        the columns in between carry neither, and the pools on the ribbons
        say what happens there.  Claimed as a box rather than as a distance
        along the row, because the destination's label is nudged inside the
        frame and against a fixed step that nudge landed it on its neighbour.
        """
        claimed: list[tuple[float, float, float, float]] = []
        drawn: list[ft.Control] = []
        # Only the two ends.  Every column named was a name every twenty
        # pixels on a long route, and the columns in between are already
        # accounted for by the pool on the ribbon that reaches them -- what
        # the trade is *between* is the pair, and that is these two.
        ends = [bus for bus in got.buses if bus.is_source or bus.is_dest]
        for bus in sorted(ends, key=lambda b: b.x):
            box = _label_width(bus)
            left = min(max(0.0, bus.x + bus.width / 2 - box / 2),
                       max(0.0, width - box))
            top = bus.y + bus.height + LABEL_DROP
            span = (left - LABEL_AIR, top, left + box + LABEL_AIR,
                    top + routegraph.LABEL_HEIGHT)
            if any(_overlap(span, taken) for taken in claimed):
                continue
            claimed.append(span)
            drawn.append(self._label(bus, left, top, box))
        return drawn + self._leg_row(got.bands, width, claimed)

    def _leg_row(self, bands, width: float, claimed: list) -> list[ft.Control]:
        """Which pool each ribbon goes through, written on the ribbon.

        After the columns, and biggest ribbon first: the columns are what the
        trade is between and have to be there, and where two names will not
        both fit the one carrying more of the flow is the one worth reading.
        A ribbon too thin to hold the text keeps quiet -- there are
        eighteen-leg routes, and eighteen pool names is not a picture of
        anything.
        """
        drawn: list[ft.Control] = []
        for band in sorted(bands, key=lambda b: -b.height):
            if band.height < LEG_MIN_BAND:
                continue
            name = routegraph.pool_name(band)
            if not name:
                continue
            coins = self._pool_coins.get((band.detail or "").lower()) or []
            middle, centre, room = band.waist()
            # A little wider than the estimate, and the content centred in it:
            # the estimate decides whether the name is drawn at all, and being
            # wrong about that is better than being wrong about the clipping.
            #
            # The name first, and the marks in whatever is left beside it.
            # They are the ornament and the name is the thing being read, so
            # on a narrow panel they give way to it -- but giving way is
            # shrinking rather than leaving, since the room they were asked to
            # vacate is mostly still there once the name has had its share.
            allowed = room * LEG_ROOM
            name_only = _text_width(name, LEG_LABEL, bold=False) + LEG_AIR * 2
            if name_only > allowed:
                continue
            mark = _marks_that_fit(len(coins), allowed - name_only)
            if not mark:
                coins = []
            box = name_only + _stack_width(len(coins), mark)
            tall = max(LEG_LABEL, mark if coins else 0) + LEG_AIR
            left = min(max(0.0, middle - box / 2), max(0.0, width - box))
            top = centre - tall / 2
            span = (left - LEG_AIR, top, left + box + LEG_AIR, top + tall)
            if any(_overlap(span, taken) for taken in claimed):
                continue
            claimed.append(span)
            drawn.append(ft.Container(
                self._leg_chip(name, coins, mark),
                left=left, top=top, width=box,
                alignment=ft.Alignment.TOP_CENTER,
            ))
        return drawn

    def _leg_chip(self, name: str, coins: list[Coin],
                  mark: float = POOL_MARK) -> ft.Control:
        """A pool's name on the same kind of chip a column's name sits on,
        with its coins stacked in front of it the way the pool list draws
        them -- so a pool reads as the same object in both places.

        `mark` is what the marks are drawn at, which is as big as the room
        beside the name allowed.
        """
        text = ft.Text(name, size=LEG_LABEL, no_wrap=True,
                       color=ft.Colors.ON_SURFACE)
        content: ft.Control = text
        if coins:
            content = ft.Row(
                [coin_stack(coins, self._chain, mark, POOL_MARK_LIMIT), text],
                spacing=MARK_GAP, tight=True,
                alignment=ft.MainAxisAlignment.CENTER,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            )
        return ft.Container(
            content,
            bgcolor=ft.Colors.with_opacity(0.78, theme.paper_bg(self._page)),
            border_radius=4,
            padding=ft.Padding.symmetric(vertical=1, horizontal=3),
            alignment=ft.Alignment.CENTER,
        )

    def _label(self, bus, left: float, top: float, box: float) -> ft.Control:
        """A column's token, under it, on a chip so it reads over a ribbon."""
        text = ft.Column(
            [
                self._name(bus),
                ft.Text(_compact(bus.amount), size=LABEL - 1, no_wrap=True,
                        color=ft.Colors.ON_SURFACE_VARIANT),
            ],
            spacing=0,
            horizontal_alignment=ft.CrossAxisAlignment.CENTER,
        )
        chip = ft.Container(
            text,
            bgcolor=ft.Colors.with_opacity(0.78, theme.paper_bg(self._page)),
            border_radius=4,
            padding=ft.Padding.symmetric(vertical=1, horizontal=3),
            alignment=ft.Alignment.TOP_CENTER,
        )
        return ft.Container(chip, left=left, top=top, width=box,
                            alignment=ft.Alignment.TOP_CENTER)


    def _name(self, bus) -> ft.Control:
        """A column's symbol, with its logo where the router named the token.

        `BusView` carries the address the rail holds, which is what the mark
        is looked up by -- the symbol alone is ambiguous across chains and is
        not what the asset bundle is keyed on.
        """
        name = ft.Text(bus.symbol, size=LABEL, no_wrap=True,
                       weight=ft.FontWeight.BOLD)
        if not bus.token:
            return name
        coin = Coin(address=bus.token, symbol=bus.symbol, decimals=18)
        return ft.Row(
            [token_mark(coin, self._chain, ROUTE_MARK), name],
            spacing=MARK_GAP,
            tight=True,
            alignment=ft.MainAxisAlignment.CENTER,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )


def _stack_width(coins: int, mark: float = POOL_MARK) -> float:
    """How wide `coin_stack` comes out for this many coins, plus its gap.

    It reports its own width, but this decides whether to build one at all.
    """
    shown = min(coins, POOL_MARK_LIMIT)
    if not shown:
        return 0.0
    return mark * (1 - STACK_OVERLAP) * (shown - 1) + mark + MARK_GAP


def _marks_that_fit(coins: int, room: float) -> float:
    """The biggest the marks can be drawn in the room left beside the name.

    Taking them off entirely to make a name fit leaves the space they would
    have used empty -- fifteen to twenty-five points of it on a narrow panel,
    which is a smaller stack rather than no stack.  Inverts `_stack_width`.
    """
    shown = min(coins, POOL_MARK_LIMIT)
    if not shown:
        return 0.0
    span = (1 - STACK_OVERLAP) * (shown - 1) + 1
    mark = (room - MARK_GAP) / span if span else 0.0
    return min(POOL_MARK, mark) if mark >= POOL_MARK_MIN else 0.0


def same_coin(one: CoinEntry | None, other: CoinEntry | None) -> bool:
    """The same token, whatever case the two addresses arrived in."""
    if one is None or other is None:
        return False
    return one.address.lower() == other.address.lower()


def _text_width(text: str, size: float, *, bold: bool) -> float:
    """Roughly how wide this reads at this size.

    Estimated rather than measured: Flet reports a control's size only after
    it is laid out, and this decides whether to lay it out at all.  The factor
    is the widest a character of the theme's body font runs -- generous on
    purpose, because an underestimate does not leave a label out, it clips one
    and sits it on its neighbour.
    """
    return len(text) * size * (0.78 if bold else 0.58)


def _overlap(one, two) -> bool:
    """Whether two label boxes share any ground."""
    return (one[0] < two[2] and two[0] < one[2]
            and one[1] < two[3] and two[1] < one[3])


def _label_width(bus) -> float:
    """Roughly how much room a column's label needs: its widest line."""
    mark = ROUTE_MARK + MARK_GAP if bus.token else 0.0
    wide = max(_text_width(bus.symbol, LABEL, bold=True) + mark,
               _text_width(_compact(bus.amount), LABEL - 1, bold=False))
    # The cap is on the *text*, and the mark gets its own room on top of it:
    # a logo is not a longer name, and taking it out of the name's allowance
    # would clip the name of any token whose symbol already filled it.
    return min(LABEL_BOX + mark, max(LABEL_MIN, wide + 6))


def _ribbon(points, height: float) -> list[cv.Path.PathElement]:
    """A leg as a closed shape: along the top edge, down, and back.

    Cubics between the points rather than lines, so a band that climbs or
    falls between columns reads as one ribbon rather than a staircase -- the
    shape Odos uses, and the reason to draw a path here rather than a
    rectangle.  A leg that spans several columns has a point on each side of
    every column it passes, and the horizontal pairs come out flat, which is
    what makes it look like it is threading between them rather than over.
    """
    top: list[cv.Path.PathElement] = [cv.Path.MoveTo(points[0][0], points[0][1])]
    for (x0, y0), (x1, y1) in pairwise(points):
        middle = (x0 + x1) / 2
        top.append(cv.Path.CubicTo(middle, y0, middle, y1, x1, y1))
    back: list[cv.Path.PathElement] = [
        cv.Path.LineTo(points[-1][0], points[-1][1] + height)]
    for (x1, y1), (x0, y0) in pairwise(points[::-1]):
        middle = (x0 + x1) / 2
        back.append(cv.Path.CubicTo(middle, y1 + height, middle, y0 + height,
                                    x0, y0 + height))
    return [*top, *back, cv.Path.Close()]


def _compact(amount: str) -> str:
    """A bus's amount, short enough to sit under a column.

    The router formats these to the wei -- "694,145.425897" -- which is right
    in a terminal where the number is the answer, and is a column and a half
    of clutter here where the *picture* is.  Two significant places and a
    suffix says the same thing at a glance.
    """
    try:
        value = float(amount.replace(",", ""))
    except (TypeError, ValueError):
        return amount
    for cut, suffix in ((1e9, "b"), (1e6, "m"), (1e3, "k")):
        if abs(value) >= cut:
            return f"{value / cut:,.2f}{suffix}".replace(".00", "")
    if value and abs(value) < 0.01:
        # Through the shared formatter, which keeps significant figures where
        # fixed places would round a real holding away.  Six places of its own
        # turned a billionth into "0." -- a trailing dot and nothing else.
        return token_amount(value)
    return f"{value:,.4f}".rstrip("0").rstrip(".")


#: A band's colour, by its position in the route.  Theme roles rather than
#: fixed hues, so the diagram is legible in all three themes -- and cycled,
#: because a thirteen-leg route has more legs than the palette has roles.
_BAND_COLOURS = (
    ft.Colors.PRIMARY,
    ft.Colors.TERTIARY,
    ft.Colors.SECONDARY,
    ft.Colors.PRIMARY_CONTAINER,
    ft.Colors.TERTIARY_CONTAINER,
    ft.Colors.SECONDARY_CONTAINER,
)


def _band_colour(index: int) -> str:
    """Enough colour to tell one leg from the next, and no more.

    These are ribbons over a sheet of paper, not areas of a chart: at full
    strength a route with two legs is two slabs, and the token names sitting
    under them stop being readable.
    """
    return ft.Colors.with_opacity(0.55, _BAND_COLOURS[index % len(_BAND_COLOURS)])


class SwapView(ft.Container):
    """The page: the widget, and the route beside it when there is room."""

    def __init__(self, page: ft.Page, chain: str, *, on_amount, on_pair,
                 on_max, on_approve, on_swap):
        self._page = page
        self.chain = chain
        self._layout: Layout | None = None
        self._stacked = False
        self._has_route = False
        self._on_amount = on_amount
        self._on_pair = on_pair
        self._on_max = on_max
        self._on_approve = on_approve
        self._on_swap = on_swap
        self._busy = False
        self._blocked = False
        self._empty = True

        self.sell = CoinPicker(page, chain, on_pick=self._sell_picked, label="Sell")
        self.buy = CoinPicker(page, chain, on_pick=self._buy_picked, label="Buy")

        self.max_button = ft.TextButton(
            "MAX", on_click=self._max_clicked,
            style=ft.ButtonStyle(
                padding=ft.Padding.symmetric(horizontal=8),
                text_style=ft.TextStyle(size=LABEL, weight=ft.FontWeight.BOLD)),
        )
        # MAX rides *inside* the field, as it does on the pool page -- beside
        # it the two halves of the trade were different widths, which reads as
        # a mistake rather than as a button.
        self.amount = ft.TextField(
            hint_text=HINT,
            # Not `dense`: it shrinks the box back to 40 whatever height is
            # asked for, and 40 beside the picker's 48 reads as a mistake.
            height=FIELD_HEIGHT,
            content_padding=ft.Padding.symmetric(horizontal=12, vertical=0),
            text_style=ft.TextStyle(size=FIELD_TEXT),
            # The hint is a balance, which is a detail; the value is the
            # subject.  Same box, two sizes and two weights of colour -- a
            # number in the same ink as a typed one reads as a typed one.
            hint_style=ft.TextStyle(size=SMALL, color=HINT_COLOUR),
            on_change=self._typed,
            expand=True,
            suffix_icon=self.max_button,
            suffix_icon_size_constraints=ft.BoxConstraints(
                min_width=58, min_height=28),
        )
        # A field rather than a `Text`, so the two halves of the trade are the
        # same shape; read-only because the router decides this number.
        self.receive = ft.TextField(
            hint_text=HINT, read_only=True, value="", expand=True,
            height=FIELD_HEIGHT, text_style=ft.TextStyle(size=FIELD_TEXT),
            content_padding=ft.Padding.symmetric(horizontal=12, vertical=0),
            hint_style=ft.TextStyle(size=SMALL, color=HINT_COLOUR))
        self.reverse = ft.IconButton(
            ft.Icons.SWAP_VERT, tooltip="Swap direction",
            on_click=self._flip_clicked, icon_size=20)
        self.save_button = ft.IconButton(
            ft.Icons.DOWNLOAD_OUTLINED, tooltip="Save the route as a picture",
            on_click=self._save_clicked, icon_size=SAVE_ICON, visible=False,
            width=SAVE_BUTTON, height=SAVE_BUTTON)

        self.rows = _InfoRows(page)
        # Why a quoted route cannot be *sent*, which is a different thing
        # from a transaction going wrong and belongs next to the button
        # rather than in the status panel.
        self.blocked = ft.Text("", size=SMALL, color=ft.Colors.ERROR,
                               visible=False)
        self.status = StatusPanel(page)
        # As tall as the amount box and the coin beside it.  These are what
        # the widget is *for*, and at the default height they were the
        # smallest things in it.
        self.approve_button = buttons.Themed(
            "1. Approve spending", page=page, on_click=self._approve_clicked,
            visible=False, expand=True, height=FIELD_HEIGHT)
        self.submit_button = buttons.Themed(
            "Swap", page=page, on_click=self._swap_clicked, disabled=True,
            expand=True, height=FIELD_HEIGHT)

        self.diagram = RouteDiagram(page, chain, corner=self.save_button)
        self.widget = ft.Container(
            ft.Column(
                [
                    self._heading(),
                    self._row(self.amount, self.sell),
                    ft.Row([self.reverse], alignment=ft.MainAxisAlignment.CENTER),
                    self._row(self.receive, self.buy),
                    self.rows.control,
                    self.approve_button,
                    self.submit_button,
                    self.blocked,
                    self.status,
                ],
                spacing=14,
                horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
            ),
            padding=ft.Padding.all(18),
            border_radius=14,
            width=WIDGET_WIDTH,
        )
        self._body = ft.Row(
            [self.widget],
            alignment=ft.MainAxisAlignment.CENTER,
            vertical_alignment=ft.CrossAxisAlignment.START,
            spacing=24,
            wrap=False,
        )
        super().__init__(self._body, padding=ft.Padding.symmetric(vertical=18))

    def before_update(self) -> None:
        self.widget.shadow = theme.panel_shadow(self._page)
        self.widget.border = theme.panel_border(self._page)
        self.widget.bgcolor = ft.Colors.SURFACE_CONTAINER_LOW

    # ------------------------------------------------------------- assembly

    def _heading(self) -> ft.Control:
        """The name, in the middle of the widget.

        The save button used to sit at the end of this row, which put it on
        the widget -- and what it saves is the picture next to it.  It is in
        the picture's own corner now, so it is beside the thing it acts on.
        """
        return ft.Row(
            [ft.Text("Swap", size=TITLE, weight=ft.FontWeight.BOLD,
                     expand=True, text_align=ft.TextAlign.CENTER)],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=0,
        )

    def _row(self, field: ft.Control, picker: CoinPicker) -> ft.Control:
        """One half of the trade: the field, and the coin beside it.

        An ordinary bordered field beside the picker, the way the pool page's
        panels put theirs -- the tall tinted blocks this had were a third
        style in an app that already has one, and they made the widget twice
        the height it needs to be.  No "Sell"/"Buy" captions either: the arrow
        between them says which way round it is, and the balance is the box's
        own hint rather than a line under it.
        """
        return ft.Row(
            [ft.Container(field, expand=True), picker],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=8,
        )

    def set_layout(self, layout: Layout) -> None:
        """Draw the route beside the widget where there is room for it."""
        self._layout = layout
        self._stacked = layout.stacked
        self._sync_body()

    def _sync_body(self) -> None:
        """Where the widget sits, and whether the route sits beside it.

        Beside it whenever the screen is wide enough, route or no route: the
        frame appearing with the first quote moved the widget sideways at the
        exact moment someone had finished typing into it.
        """
        if self._stacked:
            # A phone has no room beside the widget, so the route goes under
            # it -- and the widget stops being 480 wide, because a fixed width
            # larger than the window is an overflow, and an overflowing
            # transform is what Flutter refuses to draw *at all*: the whole
            # page came back blank rather than clipped.
            self.widget.width = None
            self.diagram.width = None
            self.diagram.expand = False
            self.diagram.height = DIAGRAM_STACKED_HEIGHT
            # Hidden rather than absent until there is a route: taking it out
            # of the tree and putting it back is a change to the subtree the
            # amount field lives in, and updating that subtree sends the
            # server's copy of the field back to the browser -- over whatever
            # the reader has typed since.  The first quote of a session lands
            # mid-word, so that is exactly when it happened.
            self.diagram.visible = self._has_route
            self._body.controls = [
                ft.Column([self.widget, self.diagram], spacing=18,
                          horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
                          expand=True)
            ]
        else:
            self.widget.width = WIDGET_WIDTH
            self.diagram.width = None
            self.diagram.expand = True
            self.diagram.height = DIAGRAM_HEIGHT
            self.diagram.visible = True
            self._body.controls = [self.widget, self.diagram]
        safe_update(self)

    # -------------------------------------------------------------- the pair

    def offer(self, entries, chain: str, *, pools=(), owned=None) -> None:
        """The coins this chain has, and the order each side shows them in.

        `owned` is the same coins with the wallet's holdings lifted to the
        top, and it goes to the side being *sold* -- those are the ones
        someone can actually spend, and they are what they came to spend.

        The buying side keeps the plain order, by how busy the markets are.
        What somebody already holds says nothing about what they want to buy,
        and a balance shown against a coin they are buying is answering a
        question they did not ask.
        """
        self.chain = chain
        self.sell.offer(owned or entries, chain)
        self.buy.offer(entries, chain)
        self.diagram.set_chain(chain)
        self.diagram.offer_pools(pools)

    def set_pair(self, sell: CoinEntry | None, buy: CoinEntry | None) -> None:
        self.sell.pick(sell, tell=False)
        self.buy.pick(buy, tell=False)
        self._sync_hints()

    @property
    def pair(self) -> tuple[CoinEntry | None, CoinEntry | None]:
        return self.sell.picked, self.buy.picked

    def amount_in(self) -> int:
        """What is in the box, in the sell coin's own units."""
        coin = self.sell.picked
        text = (self.amount.value or "").strip().replace(",", "")
        if coin is None or not text:
            return 0
        try:
            return parse_units(text, coin.decimals)
        except (ValueError, IndexError):
            return 0

    def show_balances(self, sell: int | None, buy: int | None) -> None:
        """The balance as the box's own hint, not a line under it.

        A hint shows only while the box is empty, which is exactly when the
        balance is worth reading -- and it buys back the two lines the pair
        of captions was costing, on a widget that has to fit a phone.
        """
        self.amount.hint_text = _balance_line(self.sell.picked, sell) or HINT
        self.receive.hint_text = _balance_line(self.buy.picked, buy) or HINT
        self.max_button.visible = bool(sell)
        safe_update(self.amount)
        safe_update(self.receive)
        safe_update(self.max_button)

    def fill_max(self, balance: int) -> None:
        """Sell the whole balance, to the last wei the token has.

        Every decimal, not a rounded figure: a MAX that leaves dust behind is
        a MAX that did not do what it said.
        """
        coin = self.sell.picked
        if coin is None:
            return
        self.amount.value = format_units(balance, coin.decimals,
                                         precision=coin.decimals)
        safe_update(self.amount)
        self._on_amount(self.amount_in())

    # ------------------------------------------------------------ the answer

    def show_quote(self, quote, plan=None) -> None:
        """The output, the figures under it, and the route."""
        sell, buy = self.sell.picked, self.buy.picked
        if quote is None or quote.result is None or quote.result.route is None:
            self.receive.value = ""
            self.rows.clear()
            self.diagram.show(None)
            self._set_has_route(False)
            self._empty = True
            self.submit_button.disabled = True
            self._sync()
            return
        result = quote.result
        out = result.verified_out or 0
        self.receive.value = (
            token_amount(out / 10 ** buy.decimals, places=6) if buy else "")
        self.rows.show(result, plan, sell, buy)
        self._empty = out <= 0
        self.submit_button.disabled = self._busy or self._blocked or self._empty
        self._sync()

    def show_wrap(self, amount: int, plan=None) -> None:
        """A native/wrapped swap, which has no route and no rate to give.

        One for one, both ways, for ever -- so the figures that describe a
        route describe nothing here, and saying "0.00 bp" of a thing that
        cannot slip would be answering a question nobody asked.
        """
        sell, buy = self.sell.picked, self.buy.picked
        self.receive.value = (
            token_amount(amount / 10 ** buy.decimals, places=6)
            if buy and amount else "")
        self.rows.show_wrap(sell, buy)
        self._empty = amount <= 0
        self.submit_button.disabled = self._busy or self._blocked or self._empty
        self._sync()

    def show_route(self, diagram) -> None:
        self.diagram.show(diagram, self.chain)
        # Shown rather than dimmed: an empty frame has nothing to save, and a
        # disabled button in the corner of it is an offer being withdrawn
        # where there was never an offer.
        self.save_button.visible = diagram is not None
        safe_update(self.save_button)
        self._set_has_route(diagram is not None)

    def _set_has_route(self, has: bool) -> None:
        """Show or hide the stacked route, and touch nothing else.

        Only the frame is updated, never the widget above it: see
        `_sync_body`.
        """
        if has == self._has_route:
            return
        self._has_route = has
        if self._stacked:
            self.diagram.visible = has
            safe_update(self.diagram)

    def say(self, message: str, colour: str | None = None, *,
            pending: bool = False) -> None:
        self.status.say(message, colour, pending=pending)

    def clear_status(self) -> None:
        self.status.clear()

    def cannot_send(self, reason: str) -> None:
        """Say a quoted route cannot be sent, or take that back.

        The quote itself stays: it was verified on chain like any other, and
        the number is the answer to what was asked.  What is not on offer is
        the button.
        """
        self._blocked = bool(reason)
        self.blocked.value = reason
        self.blocked.visible = bool(reason)
        self.submit_button.disabled = self._busy or self._blocked or self._empty
        safe_update(self.blocked)
        safe_update(self.submit_button)

    def show_gas(self, text: str, *, estimated: bool = False) -> None:
        """What the route costs to send, once there is a figure for it.

        Marked when it came from a run with the approval granted locally
        rather than from the call as it stands -- that is the only way to have
        a figure before the token is approved, and it is worth saying which of
        the two is on screen.
        """
        self.rows.set_gas(f"≈ {text}" if text and estimated else text)
        safe_update(self.rows.control)

    def show_approval(self, needed: bool) -> None:
        """Two steps or one, the way Curve's own widget puts it."""
        self.approve_button.visible = needed
        self.submit_button.content = "2. Swap" if needed else "Swap"
        safe_update(self.approve_button)
        safe_update(self.submit_button)

    def busy(self, busy: bool) -> None:
        """Nothing is clickable while a transaction is in flight.

        The flag outlives the call on purpose: a refresh landing mid-send
        would otherwise re-enable Submit under an already-built transaction,
        which is how a double-send happens.
        """
        self._busy = busy
        self.approve_button.disabled = busy
        self.submit_button.disabled = busy or self._blocked or self._empty
        self.amount.disabled = busy
        safe_update(self.approve_button)
        safe_update(self.submit_button)
        safe_update(self.amount)

    def forget_chain(self) -> None:
        """Everything on screen belongs to the network being left."""
        self.amount.value = ""
        self.receive.value = ""
        self.rows.clear()
        self.diagram.forget()
        self.clear_status()
        self.cannot_send("")
        self._empty = True
        self._sync()

    def clear_amount(self) -> None:
        self.amount.value = ""
        self.receive.value = ""
        self.rows.clear()
        self.diagram.show(None)
        self._sync()

    # ------------------------------------------------------------- handlers

    def _typed(self, _e: AnyEvent) -> None:
        self._on_amount(self.amount_in())

    def _max_clicked(self, _e: AnyEvent) -> None:
        self._on_max()

    def _flip_clicked(self, _e: AnyEvent) -> None:
        sell, buy = self.sell.picked, self.buy.picked
        self.sell.pick(buy, tell=False)
        self.buy.pick(sell, tell=False)
        # The figures turn round with the coins.  Selling 1,000 USDT for
        # 0.01 WBTC and then pressing this is a request to sell that 0.01
        # WBTC back -- not to sell a thousand of them, which is what carrying
        # the typed number across would ask for.  So what the output box
        # worked out becomes what the input box asks for, and the output is
        # left to the quote that follows rather than guessed at here.
        # Without its thousands separators: what goes in is read back as a
        # number, and a separator is only ever in the way there -- doubly so
        # where a comma is how a decimal point is written.
        worked_out = (self.receive.value or "").strip().replace(",", "")
        if worked_out:
            self.amount.value = worked_out
            self.receive.value = ""
            safe_update(self.amount)
            safe_update(self.receive)
        self._sync_hints()
        self._on_pair(buy, sell)

    def _save_clicked(self, _e: AnyEvent) -> None:
        self._page.run_task(self._save_route)

    async def _save_route(self) -> None:
        """The route as an SVG, wherever this platform puts files.

        A picture of the geometry rather than of the canvas: it is the same
        on both platforms, it scales, and the layout is already computed --
        so this is a second renderer over `layout`, not a screenshot.
        """
        diagram = self.diagram.route
        if diagram is None:
            return
        sell, buy = self.sell.picked, self.buy.picked
        pair = (f"{sell.symbol}-{buy.symbol}" if sell and buy else "route")
        title = f"{self.amount.value or ''} {sell.symbol if sell else ''} to " \
                f"{buy.symbol if buy else ''}".strip()
        try:
            where = await download.save_text(
                f"curve-route-{pair}.svg",
                routegraph.to_svg(diagram, title=title),
                media="image/svg+xml",
                page=self._page,
                title="Save the route",
            )
        except Exception as exc:
            self.say(f"Could not save the route: {exc}", FAILED)
            return
        if where is None:
            return          # the dialog was closed, which is an answer
        self.say(f"Saved the route to {where}" if where
                 else "Saved the route", DONE)

    def _sell_picked(self, entry: CoinEntry | None,
                     before: CoinEntry | None) -> None:
        self._picked(self.buy, entry, before)

    def _buy_picked(self, entry: CoinEntry | None,
                    before: CoinEntry | None) -> None:
        self._picked(self.sell, entry, before)

    def _picked(self, other: CoinPicker, entry: CoinEntry | None,
                before: CoinEntry | None) -> None:
        """One of the pickers changed.

        Choosing the coin the *other* one already holds is nobody's way of
        asking to swap a coin for itself.  It is the pair the other way round
        -- which is what the flip button is for -- so the other picker takes
        what this one was showing, and the pair comes out swapped rather than
        doubled.
        """
        if same_coin(entry, other.picked):
            other.pick(before, tell=False)
        self._sync_hints()
        self._on_pair(self.sell.picked, self.buy.picked)

    def _approve_clicked(self, event: AnyEvent) -> None:
        self._page.run_task(self._on_approve)

    def _swap_clicked(self, event: AnyEvent) -> None:
        self._page.run_task(self._on_swap)

    def _sync_hints(self) -> None:
        self.sell.bar_hint_text = "Sell"
        self.buy.bar_hint_text = "Buy"
        safe_update(self.sell)
        safe_update(self.buy)

    def _sync(self) -> None:
        safe_update(self.receive)
        safe_update(self.submit_button)
        safe_update(self.rows.control)


class _InfoRows:
    """The figures under the amounts: what this trade costs and promises."""

    def __init__(self, page: ft.Page) -> None:
        self._page = page
        self._rows: dict[str, ft.Text] = {}
        self._alarms = Alarm(page)
        self._high = False
        lines: list[ft.Control] = []
        for key, label in (
            ("slippage", "Slippage"),
            ("impact", "Price impact"),
            ("rate", "Exchange rate"),
            ("route", "Trade route"),
            ("gas", "Estimated tx cost"),
        ):
            value = ft.Text("-", size=SMALL, no_wrap=True,
                            color=ft.Colors.ON_SURFACE_VARIANT)
            self._rows[key] = value
            # Every row is a band and only one of them is ever tinted: they
            # have to sit at the same height and the same indent, and a row
            # that grew padding the moment it had something to say would be
            # the list shifting under someone reading it.
            line = Band(
                ft.Row(
                    [ft.Text(label, size=SMALL,
                             color=ft.Colors.ON_SURFACE_VARIANT), value],
                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                ),
                page,
                # The one figure here worth interrupting someone for, and it
                # flashes the way the pool page's does -- same band, same
                # timing, same colour -- because someone comparing a route
                # against a pool is comparing the two tabs.
                # Untinted to start with: `_tint_impact` colours the impact
                # row when there is an impact to colour.
                kind="",
                padding=ft.Padding.symmetric(horizontal=ROW_INDENT, vertical=1),
            )
            if key == "impact":
                self.impact_panel = line
            lines.append(line)
        self.control = ft.Column(lines, spacing=1)

    @property
    def flashing(self):
        """Which band is pulsing, if any."""
        return self._alarms.panel

    def clear(self) -> None:
        for value in self._rows.values():
            value.value = "-"
            value.color = ft.Colors.ON_SURFACE_VARIANT
        self._set_high(False)
        self._tint_impact(False)

    def set_gas(self, text: str) -> None:
        self._set("gas", text)

    def show_wrap(self, sell=None, buy=None) -> None:
        """What there is to say about a wrapping, which is not much.

        No pool, no slippage, no impact and a rate of one -- said rather than
        left as dashes, because a dash reads as "not worked out yet" where
        this is "there is nothing here to work out".
        """
        symbols = (getattr(sell, "symbol", "?"), getattr(buy, "symbol", "?"))
        self._set("route", "the wrapper, no pool")
        self._set("slippage", "none")
        self._set("impact", "none")
        self._set("rate", "1 {} = 1 {}".format(*symbols))
        self._set_high(False)
        self._tint_impact(False)

    def show(self, result, plan, sell=None, buy=None) -> None:
        pools, legs = routegraph.summarise(_diagram_of(result))
        self._set("route", f"{pools} pool{'s' if pools != 1 else ''} · "
                           f"{legs} leg{'s' if legs != 1 else ''}")
        impact = float(getattr(result, "price_impact_bp", 0.0) or 0.0)
        high = impact >= IMPACT_HIGH_BP
        self._set("impact", f"{impact:.2f} bp",
                  ft.Colors.ERROR if high else None)
        self._set_high(high)
        self._tint_impact(True)
        self._set("rate", _rate_line(result, sell, buy))
        # Just "auto".  The bound is *per leg*, derived from the least each
        # pool can charge, so a single figure for a fifteen-pool route is a
        # number that describes none of them -- and the compounded total it
        # used to show read like a slippage setting, which it is not.
        self._set("slippage", "auto")
        if plan is None or not plan.gas:
            # No figure: the route did not execute locally, which for an
            # unapproved token is the expected answer and not a fault.
            self._set("gas", "-")

    def _tint_impact(self, showing: bool) -> None:
        """Colour the impact row only once there is an impact in it.

        The tint is what says "this is the line to look at", and a line
        reading "-" is not: an empty widget was arriving already coloured, so
        the colour meant nothing by the time it did.  The band stays either
        way -- it is what keeps the five rows the same height.
        """
        kind = "impact" if showing else ""
        if self.impact_panel.kind == kind:
            return
        self.impact_panel.kind = kind
        safe_update(self.impact_panel)

    def _set_high(self, high: bool) -> None:
        """Arm or disarm the flash, and only when it actually changed."""
        if high == self._high:
            return
        self._high = high
        self._alarms.point_at(self.impact_panel if high else None)

    def _set(self, key: str, text: str, colour: str | None = None) -> None:
        row = self._rows[key]
        row.value = text or "-"
        row.color = colour or ft.Colors.ON_SURFACE_VARIANT


def _rate_line(result, sell, buy) -> str:
    """What one of the sell coin buys, which is the figure people compare."""
    out = getattr(result, "verified_out", 0) or 0
    amount_in = getattr(result, "amount_in", 0) or 0
    if not (out and amount_in and sell and buy):
        return ""
    rate = (out / 10 ** buy.decimals) / (amount_in / 10 ** sell.decimals)
    return f"1 {sell.symbol} = {token_amount(rate, places=6)} {buy.symbol}"


def _diagram_of(result):
    """The `Diagram` for a result, or something `summarise` can count."""
    return getattr(result, "diagram", None) or _Elements(result)


class _Elements:
    """Enough of a `Diagram` to count pools and legs off a raw route."""

    def __init__(self, result) -> None:
        route = getattr(result, "route", None)
        self.elements = [
            type("E", (), {"target": leg.target})()
            for leg in (getattr(route, "legs", ()) or ())
        ]


def _balance_line(coin: CoinEntry | None, balance: int | None) -> str:
    """What the wallet holds, as a number and nothing else.

    Not "Balance 8,598.43 USDC": it is sitting in a box with the coin named
    beside it, so two of those three words are already on screen.  What is
    *not* obvious is that the number is not an amount being swapped, and that
    is a job for the colour rather than for a caption.

    Grouped and trimmed rather than to the wei -- this is read at a glance to
    decide what to type, and MAX still fills in the exact figure.
    """
    if coin is None or balance is None:
        return ""
    held = format_units(balance, coin.decimals, precision=coin.decimals)
    return token_amount(float(held))
