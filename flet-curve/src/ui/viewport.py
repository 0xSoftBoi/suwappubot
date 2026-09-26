"""The visible window over a candle series, and the pixel<->data mapping."""

from __future__ import annotations

from dataclasses import dataclass

#: Must match the `label_size` given to the left/bottom axes in `candles.py`.
LEFT_AXIS_WIDTH = 64.0
BOTTOM_AXIS_HEIGHT = 28.0

#: Never let the window get narrower than this many candles, or a scroll
#: burst zooms until the chart is a single bar.
MIN_VISIBLE = 5.0
#: How much one wheel notch scales the window.
ZOOM_STEP = 0.15


@dataclass(slots=True)
class Viewport:
    """The visible x (candle index) and y (price) window."""

    x_min: float
    x_max: float
    y_min: float
    y_max: float

    @property
    def x_span(self) -> float:
        return max(self.x_max - self.x_min, 1e-9)

    @property
    def y_span(self) -> float:
        return max(self.y_max - self.y_min, 1e-12)

    def panned(self, dx: float, dy: float) -> Viewport:
        return Viewport(
            self.x_min + dx, self.x_max + dx, self.y_min + dy, self.y_max + dy
        )

    def zoomed_y(self, factor: float, focus: float) -> Viewport:
        """Scale the price window, holding `focus` (a price) still."""
        below = (focus - self.y_min) * factor
        above = (self.y_max - focus) * factor
        return Viewport(self.x_min, self.x_max, focus - below, focus + above)

    def with_y(self, y_min: float, y_max: float) -> Viewport:
        return Viewport(self.x_min, self.x_max, y_min, y_max)

    def zoomed_x(self, factor: float, focus: float) -> Viewport:
        """Scale the x window by `factor`, holding `focus` (a data x) still."""
        left = (focus - self.x_min) * factor
        right = (self.x_max - focus) * factor
        return Viewport(focus - left, focus + right, self.y_min, self.y_max)

    def clamped(self, count: int) -> Viewport:
        """Keep the window over the data and no narrower than `MIN_VISIBLE`."""
        if count <= 0:
            return self
        span = min(max(self.x_span, MIN_VISIBLE), max(float(count), MIN_VISIBLE))
        x_min, x_max = self.x_min, self.x_min + span
        slack = span / 2
        lowest, highest = -slack, (count - 1) + slack
        if x_min < lowest:
            x_min, x_max = lowest, lowest + span
        if x_max > highest:
            x_max = highest
            x_min = x_max - span
        return Viewport(x_min, x_max, self.y_min, self.y_max)


@dataclass(slots=True, frozen=True)
class Plot:
    """Where the plot area sits inside the chart box, in pixels."""

    width: float
    height: float

    @property
    def left(self) -> float:
        return LEFT_AXIS_WIDTH

    @property
    def top(self) -> float:
        return 0.0

    @property
    def right(self) -> float:
        return max(self.width, self.left + 1.0)

    @property
    def bottom(self) -> float:
        return max(self.height - BOTTOM_AXIS_HEIGHT, self.top + 1.0)

    @property
    def inner_width(self) -> float:
        return max(self.right - self.left, 1.0)

    @property
    def inner_height(self) -> float:
        return max(self.bottom - self.top, 1.0)

    def contains(self, px: float, py: float) -> bool:
        return self.left <= px <= self.right and self.top <= py <= self.bottom

    # -- pixels -> data ---------------------------------------------------

    def data_x(self, px: float, view: Viewport) -> float:
        ratio = (px - self.left) / self.inner_width
        return view.x_min + ratio * view.x_span

    def data_y(self, py: float, view: Viewport) -> float:
        ratio = (py - self.top) / self.inner_height
        return view.y_max - ratio * view.y_span

    # -- data -> pixels ---------------------------------------------------

    def pixel_x(self, x: float, view: Viewport) -> float:
        return self.left + (x - view.x_min) / view.x_span * self.inner_width

    def pixel_y(self, y: float, view: Viewport) -> float:
        return self.top + (view.y_max - y) / view.y_span * self.inner_height

    # -- deltas -----------------------------------------------------------

    def dx(self, pixels: float, view: Viewport) -> float:
        return pixels / self.inner_width * view.x_span

    def dy(self, pixels: float, view: Viewport) -> float:
        return pixels / self.inner_height * view.y_span
