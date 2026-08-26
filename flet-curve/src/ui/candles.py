"""The pool price chart: `flet-charts`' `CandlestickChart`, made navigable."""

from __future__ import annotations

import math
import time
from collections.abc import Callable

import flet as ft
import flet.canvas as cv
import flet_charts as fc

from curve.api import Candle

from . import safe_update
from .typography import SMALL, TINY
from .viewport import MIN_VISIBLE, ZOOM_STEP, Plot, Viewport

#: Roughly how many labels to put on each axis.
PRICE_LABELS = 5
DATE_LABELS = 6

#: Hover fires per mouse move, and each one is a round trip to Python.
HOVER_INTERVAL = 0.04

#: Candles kept either side of the visible window.
SPOT_MARGIN = 8

#: Target pixels per candle slot. `CandlestickChart` draws candle bodies at
#: a fixed width -- measured at ~3 logical pixels, and unchanged whether it
#: is handed 20 spots or 365 -- so the only lever on how the chart *looks*
#: is how many candles share the plot width.
TARGET_PITCH_PX = 5.5

#: Bounds on that count, for very small or very wide charts.
MIN_CANDLES = 40
MAX_CANDLES = 400

#: How much the capacity must change before the series is refetched.
CAPACITY_TOLERANCE = 0.25

#: Smallest high-low extent a candle is drawn with, in pixels.
MIN_CANDLE_PX = 1.5


def price_decimals(span: float) -> int:
    """How many decimals a value needs across a given span."""
    if span <= 0:
        return 2
    return max(2, min(10, math.ceil(-math.log10(span)) + 2))


def interval_decimals(interval: float) -> int:
    """Exactly the decimals needed to write `interval` without padding."""
    if interval <= 0:
        return 2
    for decimals in range(11):
        scaled = interval * 10**decimals
        if abs(scaled - round(scaled)) < 1e-9:
            return decimals
    return 10


def format_price(value: float, decimals: int = 4) -> str:
    if value == 0:
        return "0"
    if abs(value) >= 1000 and decimals <= 2:
        return f"{value:,.0f}"
    return f"{value:.{decimals}f}"


def format_date(timestamp: int) -> str:
    return time.strftime("%d %b", time.gmtime(timestamp))


def format_datetime(timestamp: int) -> str:
    return time.strftime("%d %b %H:%M", time.gmtime(timestamp))


def nice_interval(span: float, target: int) -> float:
    """A round tick interval covering `span` in about `target` steps."""
    if span <= 0 or target <= 0:
        return 1.0
    raw = span / target
    magnitude = 10.0 ** math.floor(math.log10(raw))
    for step in (1.0, 2.0, 2.5, 5.0, 10.0):
        if raw <= step * magnitude:
            return step * magnitude
    return 10.0 * magnitude


#: How far beyond the body range a wick may reach and still set the scale,
#: in multiples of that range.
WICK_HEADROOM = 3.0


def price_bounds(candles: list[Candle]) -> tuple[float, float]:
    """The price range to show for a set of candles, padded by 4%."""
    if not candles:
        return 0.0, 1.0

    body_low = min(min(c.open, c.close) for c in candles)
    body_high = max(max(c.open, c.close) for c in candles)
    body_span = (body_high - body_low) or abs(body_high) * 0.001 or 0.001

    floor = body_low - WICK_HEADROOM * body_span
    ceiling = body_high + WICK_HEADROOM * body_span
    low = min([c.low for c in candles if c.low >= floor], default=body_low)
    high = max([c.high for c in candles if c.high <= ceiling], default=body_high)
    low, high = min(low, body_low), max(high, body_high)

    if high <= low:
        spread = abs(high) * 0.001 or 0.001
        return low - spread, high + spread
    margin = (high - low) * 0.04
    return low - margin, high + margin


def visible_slice(candles: list[Candle], view: Viewport) -> list[Candle]:
    """The candles inside the window, for refitting the price axis."""
    if not candles:
        return []
    start = max(0, math.floor(view.x_min))
    end = min(len(candles), math.ceil(view.x_max) + 1)
    return candles[start:end] or candles


def fit(candles: list[Candle]) -> Viewport:
    """The window showing the whole series."""
    low, high = price_bounds(candles)
    return Viewport(-0.5, max(len(candles) - 0.5, 0.5), low, high)


def _axis_label(text: str) -> ft.Control:
    return ft.Text(text, size=TINY, color=ft.Colors.ON_SURFACE_VARIANT)


def price_axis(view: Viewport) -> fc.ChartAxis:
    """Price labels along the left edge."""
    interval = nice_interval(view.y_span, PRICE_LABELS - 1)
    decimals = interval_decimals(interval)
    values: list[float] = []
    tick = math.ceil(view.y_min / interval) * interval
    while tick <= view.y_max and len(values) < PRICE_LABELS + 2:
        values.append(tick)
        tick += interval
    return fc.ChartAxis(
        label_size=64,
        label_spacing=interval,
        labels=[
            fc.ChartAxisLabel(value=v, label=_axis_label(format_price(v, decimals)))
            for v in values
        ],
    )


def date_axis(candles: list[Candle], view: Viewport) -> fc.ChartAxis:
    """Dates along the bottom, thinned to whatever the window shows."""
    if not candles:
        return fc.ChartAxis(labels=[])
    stride = max(1, int(view.x_span) // DATE_LABELS)
    first = max(0, math.floor(view.x_min))
    last = min(len(candles) - 1, math.ceil(view.x_max))
    values = [i for i in range(0, len(candles), stride) if first <= i <= last]
    return fc.ChartAxis(
        label_size=28,
        label_spacing=stride,
        labels=[
            fc.ChartAxisLabel(value=i, label=_axis_label(format_date(candles[i].time)))
            for i in values
        ],
    )


def visible_range(candles: list[Candle], view: Viewport) -> tuple[int, int]:
    """The slice of candles worth sending for a given window."""
    if not candles:
        return 0, 0
    start = max(0, math.floor(view.x_min) - SPOT_MARGIN)
    end = min(len(candles), math.ceil(view.x_max) + SPOT_MARGIN + 1)
    return start, max(start, end)


def build_spots(
    candles: list[Candle],
    view: Viewport | None = None,
    min_extent: float = 0.0,
) -> list[fc.CandlestickChartSpot]:
    """Spots for the visible window, keyed by index into the full series."""
    if view is None:
        start, end = 0, len(candles)
    else:
        start, end = visible_range(candles, view)

    spots = []
    for index in range(start, end):
        candle = candles[index]
        high, low = candle.high, candle.low
        if min_extent > 0 and high - low < min_extent:
            middle = (high + low) / 2
            high, low = middle + min_extent / 2, middle - min_extent / 2
        spots.append(
            fc.CandlestickChartSpot(
                x=index,
                open=candle.open,
                high=high,
                low=low,
                close=candle.close,
                show_tooltip=False,
            )
        )
    return spots


def crosshair_shapes(
    plot: Plot,
    view: Viewport,
    candles: list[Candle],
    px: float,
    py: float,
    *,
    line_color: str,
    text_color: str,
    box_color: str,
) -> list[cv.Shape]:
    """Two dashed lines through the cursor, plus a price/time readout."""
    if not plot.contains(px, py):
        return []

    decimals = price_decimals(view.y_span)
    price = plot.data_y(py, view)
    paint = ft.Paint(color=line_color, stroke_width=1, stroke_dash_pattern=[4, 3])
    shapes: list[cv.Shape] = [
        cv.Line(px, plot.top, px, plot.bottom, paint=paint),
        cv.Line(plot.left, py, plot.right, py, paint=paint),
    ]

    shapes.append(
        cv.Rect(0, py - 8, plot.left - 2, 16, paint=ft.Paint(color=box_color))
    )
    shapes.append(
        cv.Text(
            4,
            py - 7,
            format_price(price, decimals),
            style=ft.TextStyle(size=TINY, color=text_color, weight=ft.FontWeight.BOLD),
        )
    )

    index = round(plot.data_x(px, view))
    if 0 <= index < len(candles):
        candle = candles[index]
        shapes.append(
            cv.Rect(px - 44, plot.bottom + 2, 88, 15, paint=ft.Paint(color=box_color))
        )
        shapes.append(
            cv.Text(
                px - 40,
                plot.bottom + 3,
                format_datetime(candle.time),
                style=ft.TextStyle(size=TINY, color=text_color),
            )
        )
        shapes.append(
            cv.Text(
                plot.left + 8,
                6,
                f"O {format_price(candle.open, decimals)}   "
                f"H {format_price(candle.high, decimals)}   "
                f"L {format_price(candle.low, decimals)}   "
                f"C {format_price(candle.close, decimals)}",
                style=ft.TextStyle(size=TINY, color=text_color),
            )
        )
    return shapes


class CandleChart(ft.Container):
    """A candlestick chart you can drag, zoom and read off."""

    def __init__(
        self, height: float = 340, on_capacity_change: Callable[[], None] | None = None
    ) -> None:
        self._candles: list[Candle] = []
        self._view = Viewport(0.0, 1.0, 0.0, 1.0)
        self._plot = Plot(800.0, height)
        self._last_hover = 0.0
        self._on_capacity_change = on_capacity_change
        self._last_capacity = 0  # set below, once _plot exists
        self._auto_price = True

        self._chart = fc.CandlestickChart(
            key="price-chart",
            spots=[],
            expand=True,
            visible=False,
            interactive=False,
            animation=ft.Animation(
                duration=ft.Duration(milliseconds=0),
                curve=ft.AnimationCurve.LINEAR,
            ),
            horizontal_grid_lines=fc.ChartGridLines(
                color=ft.Colors.OUTLINE_VARIANT, width=1
            ),
        )
        self._overlay = cv.Canvas(shapes=[], expand=True, on_resize=self._resized)
        self._last_capacity = self.candle_capacity()
        self._empty = ft.Text(
            "No price history for this pair.",
            size=SMALL,
            color=ft.Colors.ON_SURFACE_VARIANT,
        )
        self._gestures = ft.GestureDetector(
            content=ft.Stack(
                [
                    self._chart,
                    ft.Container(self._empty, alignment=ft.Alignment.CENTER),
                    self._overlay,
                ],
                expand=True,
            ),
            expand=True,
            mouse_cursor=ft.MouseCursor.PRECISE,
            drag_interval=16,
            hover_interval=16,
            on_pan_update=self._panned,
            on_scroll=self._scrolled,
            on_hover=self._hovered,
            on_exit=self._left,
            on_double_tap=lambda _e: self.reset_view(),
        )
        super().__init__(
            content=self._gestures,
            height=height,
            border_radius=8,
            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
            padding=ft.Padding.only(left=8, top=8, bottom=8, right=24),
            clip_behavior=ft.ClipBehavior.HARD_EDGE,
        )

    # -- data -------------------------------------------------------------

    def set_candles(self, candles: list[Candle]) -> None:
        self._candles = candles or []
        self._auto_price = True
        self._empty.visible = not self._candles
        self._chart.visible = bool(self._candles)
        self._view = fit(self._candles)
        self._clear_crosshair(redraw=False)
        self._apply_view()

    def reset_view(self) -> None:
        """Back to the whole series, and back to auto price. Double-tap."""
        self._auto_price = True
        self._view = fit(self._candles)
        self._clear_crosshair(redraw=False)
        self._apply_view()

    def _refit_price(self) -> None:
        """Rescale price to whatever is on screen, unless the user opted out."""
        if not self._auto_price or not self._candles:
            return
        low, high = price_bounds(visible_slice(self._candles, self._view))
        self._view = self._view.with_y(low, high)

    def _apply_view(self) -> None:
        view = self._view
        min_extent = view.y_span / self._plot.inner_height * MIN_CANDLE_PX
        self._chart.spots = build_spots(self._candles, view, min_extent)
        self._chart.min_x, self._chart.max_x = view.x_min, view.x_max
        self._chart.min_y, self._chart.max_y = view.y_min, view.y_max
        self._chart.left_axis = price_axis(view)
        self._chart.bottom_axis = date_axis(self._candles, view)
        safe_update(self)

    # -- interaction ------------------------------------------------------

    def candle_capacity(self) -> int:
        """How many candles this chart has room for at the target pitch."""
        raw = int(self._plot.inner_width / TARGET_PITCH_PX)
        return max(MIN_CANDLES, min(MAX_CANDLES, raw))

    def _resized(self, e: cv.CanvasResizeEvent) -> None:
        self._plot = Plot(e.width, e.height)
        capacity = self.candle_capacity()
        if self._last_capacity and self._on_capacity_change:
            change = abs(capacity - self._last_capacity) / self._last_capacity
            if change > CAPACITY_TOLERANCE:
                self._last_capacity = capacity
                self._on_capacity_change()
                return
        self._last_capacity = capacity

    def _panned(self, e: ft.DragUpdateEvent) -> None:
        """Drag the chart. The content follows the cursor, as it should."""
        if not self._candles:
            return
        delta = e.local_delta
        if delta is None:
            return
        view = self._view.panned(
            -self._plot.dx(delta.x, self._view),
            self._plot.dy(delta.y, self._view),
        )
        if delta.y:
            self._auto_price = False
        self._view = view.clamped(len(self._candles))
        self._clear_crosshair(redraw=False)
        self._apply_view()

    def _scrolled(self, e: ft.ScrollEvent) -> None:
        """The wheel zooms in time, anchored on the candle under the cursor."""
        if not self._candles:
            return
        direction = 1.0 if e.scroll_delta.y > 0 else -1.0
        factor = 1.0 + direction * ZOOM_STEP

        if e.local_position.x < self._plot.left:
            self._auto_price = False
            focus = self._plot.data_y(e.local_position.y, self._view)
            self._view = self._view.zoomed_y(factor, focus)
            self._apply_view()
            return

        focus = self._plot.data_x(e.local_position.x, self._view)
        zoomed = self._view.zoomed_x(factor, focus)
        if zoomed.x_span < MIN_VISIBLE and factor < 1.0:
            return  # already as tight as it goes
        self._view = zoomed.clamped(len(self._candles))
        self._refit_price()
        self._apply_view()

    def _hovered(self, e: ft.HoverEvent) -> None:
        if not self._candles:
            return
        now = time.monotonic()
        if now - self._last_hover < HOVER_INTERVAL:
            return
        self._last_hover = now
        self._draw_crosshair(e.local_position.x, e.local_position.y)

    def _left(self, _e: ft.HoverEvent) -> None:
        self._clear_crosshair()

    def _draw_crosshair(self, px: float, py: float) -> None:
        self._overlay.shapes = crosshair_shapes(
            self._plot,
            self._view,
            self._candles,
            px,
            py,
            line_color=ft.Colors.OUTLINE,
            text_color=ft.Colors.ON_SURFACE,
            box_color=ft.Colors.SURFACE_CONTAINER_HIGHEST,
        )
        safe_update(self._overlay)

    def _clear_crosshair(self, redraw: bool = True) -> None:
        if not self._overlay.shapes:
            return
        self._overlay.shapes = []
        if redraw:
            safe_update(self._overlay)
