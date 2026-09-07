"""Chart data preparation, and the crosshair."""

from __future__ import annotations

import math
from types import SimpleNamespace

import flet_charts as fc
import pytest

from curve.api import Candle
from ui.candles import (
    DATE_LABELS,
    MAX_CANDLES,
    MIN_CANDLES,
    PRICE_LABELS,
    TARGET_PITCH_PX,
    WICK_HEADROOM,
    CandleChart,
    build_spots,
    crosshair_shapes,
    date_axis,
    fit,
    format_price,
    interval_decimals,
    nice_interval,
    price_axis,
    price_decimals,
    visible_slice,
)
from ui.viewport import Plot, Viewport

COLOURS = {"line_color": "#888", "text_color": "#000", "box_color": "#fff"}


def series(prices: list[tuple[float, float, float, float]]) -> list[Candle]:
    return [
        Candle(time=1_700_000_000 + i * 3600, open=o, high=h, low=lo, close=c)
        for i, (o, h, lo, c) in enumerate(prices)
    ]


def flat(n: int = 20) -> list[Candle]:
    return series([(1.0, 1.2, 0.8, 1.1)] * n)


def plot() -> Plot:
    return Plot(800.0, 400.0)


# -- fitting ---------------------------------------------------------------


def test_fit_covers_every_candle_with_headroom() -> None:
    view = fit(series([(1.0, 2.0, 0.5, 1.5), (1.5, 1.8, 1.2, 1.3)]))
    assert view.y_min < 0.5
    assert view.y_max > 2.0
    assert view.x_min < 0
    assert view.x_max >= 1


def test_fit_on_a_flat_series_invents_a_range() -> None:
    view = fit(series([(1.0, 1.0, 1.0, 1.0)] * 5))
    assert view.y_max > view.y_min


def test_fit_on_a_zero_priced_series_is_survivable() -> None:
    view = fit(series([(0.0, 0.0, 0.0, 0.0)]))
    assert view.y_max > view.y_min


def test_fit_ignores_an_absurd_wick() -> None:
    candles = series([(1.015, 1.017, 1.014, 1.016)] * 50)
    candles[20] = Candle(candles[20].time, 1.0158, 1.0160, 0.0243, 1.0160)
    view = fit(candles)
    assert view.y_min > 1.0  # the glitch is outside the fitted window
    assert view.y_min < 1.014  # but real lows are still inside


def test_fit_keeps_a_plausible_wick() -> None:
    candles = series([(1.015, 1.017, 1.014, 1.016)] * 50)
    body_span = 0.017 - 1.014
    dip = 1.014 - body_span * (WICK_HEADROOM - 1)
    candles[20] = Candle(candles[20].time, 1.015, 1.016, dip, 1.016)
    assert fit(candles).y_min <= dip


def test_fit_never_clips_a_body() -> None:
    candles = series([(1.0, 1.0, 1.0, 1.0)] * 20)
    candles[5] = Candle(candles[5].time, 1.0, 5.0, 1.0, 5.0)   # body reaches 5.0
    view = fit(candles)
    assert view.y_max >= 5.0


def test_fit_leaves_a_volatile_series_alone() -> None:
    candles = series(
        [(1400 + i * 4, 1420 + i * 4, 1380 + i * 4, 1410 + i * 4) for i in range(200)]
    )
    view = fit(candles)
    assert view.y_min <= min(c.low for c in candles)
    assert view.y_max >= max(c.high for c in candles)


def test_fit_on_an_empty_series_is_usable() -> None:
    view = fit([])
    assert view.y_max > view.y_min
    assert view.x_max > view.x_min


# -- axis precision --------------------------------------------------------


def test_axis_labels_are_all_distinct_on_a_tight_range() -> None:
    labels = [
        lb.label.value for lb in price_axis(Viewport(0, 10, 1.0268, 1.0271)).labels
    ]
    assert len(set(labels)) == len(labels), labels


def test_axis_labels_are_distinct_across_very_different_scales() -> None:
    for lo, hi in ((1.0268, 1.0271), (0.9, 1.1), (1800.0, 2600.0), (1e-7, 3e-7)):
        labels = [lb.label.value for lb in price_axis(Viewport(0, 10, lo, hi)).labels]
        assert len(set(labels)) == len(labels), (lo, hi, labels)


def test_axis_labels_are_never_padded_with_dead_zeros() -> None:
    labels = [lb.label.value for lb in price_axis(Viewport(0, 10, 0.9, 1.1)).labels]
    assert "1.0" in labels and "1.000000" not in labels


def test_price_decimals_stays_within_sane_bounds() -> None:
    assert price_decimals(0) == 2
    assert 2 <= price_decimals(1e-12) <= 10
    assert price_decimals(5000.0) == 2


def test_interval_decimals_does_not_over_pad() -> None:
    assert interval_decimals(0.0001) == 4
    assert interval_decimals(0.1) == 1
    assert interval_decimals(250) == 0
    assert interval_decimals(2.5) == 1
    assert interval_decimals(0) == 2


def test_large_prices_are_grouped_not_padded() -> None:
    assert format_price(2431.5, 2) == "2,432"
    assert format_price(1.0268, 4) == "1.0268"
    assert format_price(0) == "0"


def test_nice_interval_picks_round_steps() -> None:
    for span, target in ((1.0, 4), (0.0003, 4), (800.0, 4), (0.2, 4)):
        step = nice_interval(span, target)
        mantissa = step / 10 ** math.floor(math.log10(step))
        assert round(mantissa, 6) in (1.0, 2.0, 2.5, 5.0), step


def test_nice_interval_survives_degenerate_input() -> None:
    assert nice_interval(0, 4) == 1.0
    assert nice_interval(1.0, 0) == 1.0


# -- axes ------------------------------------------------------------------


def test_price_axis_labels_sit_on_multiples_of_the_interval() -> None:
    axis = price_axis(Viewport(0, 10, 0.9, 1.1))
    assert axis.label_spacing > 0
    assert 2 <= len(axis.labels) <= PRICE_LABELS + 2
    for label in axis.labels:
        multiples = label.value / axis.label_spacing
        assert abs(multiples - round(multiples)) < 1e-6, label.value


def test_price_axis_labels_stay_inside_the_window() -> None:
    view = Viewport(0, 10, 0.9, 1.1)
    for label in price_axis(view).labels:
        assert view.y_min <= label.value <= view.y_max


def test_date_axis_thins_labels_so_they_cannot_collide() -> None:
    candles = flat(365)
    assert len(date_axis(candles, fit(candles)).labels) <= DATE_LABELS + 2


def test_date_axis_follows_the_window_when_zoomed() -> None:
    candles = flat(300)
    zoomed = date_axis(candles, Viewport(100.0, 110.0, 1.0, 2.0))
    assert zoomed.labels, "a zoomed window should still be labelled"
    for label in zoomed.labels:
        assert 100 <= label.value <= 110


def test_date_axis_labels_index_real_candles() -> None:
    candles = flat(12)
    for label in date_axis(candles, fit(candles)).labels:
        assert 0 <= label.value < len(candles)


def test_date_axis_on_an_empty_series() -> None:
    assert date_axis([], fit([])).labels == []


# -- spots -----------------------------------------------------------------


def test_spots_carry_ohlc_and_are_indexed_from_zero() -> None:
    spots = build_spots(series([(1.0, 1.2, 0.8, 1.1), (1.1, 1.3, 1.0, 0.9)]))
    assert [s.x for s in spots] == [0, 1]
    assert isinstance(spots[0], fc.CandlestickChartSpot)
    assert (spots[0].open, spots[0].high, spots[0].low, spots[0].close) == (
        1.0,
        1.2,
        0.8,
        1.1,
    )


def test_spots_suppress_the_built_in_tooltip() -> None:
    assert all(not s.show_tooltip for s in build_spots(flat(3)))


def test_flat_candles_are_floored_so_they_still_draw() -> None:
    candles = [Candle(1_700_000_000, 1.0, 1.0, 1.0, 1.0)]
    spot = build_spots(candles, fit(candles), min_extent=0.01)[0]
    assert spot.high - spot.low == pytest.approx(0.01)
    assert (spot.high + spot.low) / 2 == pytest.approx(1.0)


def test_the_floor_leaves_normal_candles_untouched() -> None:
    candles = [Candle(1_700_000_000, 1.0, 2.0, 0.5, 1.5)]
    spot = build_spots(candles, fit(candles), min_extent=0.01)[0]
    assert (spot.high, spot.low) == (2.0, 0.5)


def test_the_floor_never_touches_open_or_close() -> None:
    candles = [Candle(1_700_000_000, 1.0, 1.0, 1.0, 1.0)]
    spot = build_spots(candles, fit(candles), min_extent=0.01)[0]
    assert (spot.open, spot.close) == (1.0, 1.0)


def test_the_crosshair_still_reads_the_true_prices() -> None:
    chart = CandleChart()
    chart.set_candles([Candle(1_700_000_000, 1.0, 1.0, 1.0, 1.0)] * 5)
    assert all(c.high == 1.0 and c.low == 1.0 for c in chart._candles)


def test_build_spots_on_an_empty_series() -> None:
    assert build_spots([]) == []


# -- crosshair -------------------------------------------------------------


def test_crosshair_draws_two_lines_through_the_cursor() -> None:
    candles = flat(50)
    shapes = crosshair_shapes(plot(), fit(candles), candles, 400.0, 200.0, **COLOURS)
    lines = [s for s in shapes if type(s).__name__ == "Line"]
    assert len(lines) == 2
    vertical = next(s for s in lines if s.x1 == s.x2)
    horizontal = next(s for s in lines if s.y1 == s.y2)
    assert vertical.x1 == 400.0
    assert horizontal.y1 == 200.0


def test_crosshair_reads_out_the_price_under_the_cursor() -> None:
    candles = flat(50)
    view, p, py = fit(candles), plot(), 200.0
    shapes = crosshair_shapes(p, view, candles, 400.0, py, **COLOURS)
    texts = [s.value for s in shapes if type(s).__name__ == "Text"]
    assert format_price(p.data_y(py, view), price_decimals(view.y_span)) in texts


def test_crosshair_reads_out_the_time_and_ohlc_of_the_hovered_candle() -> None:
    candles = flat(50)
    shapes = crosshair_shapes(plot(), fit(candles), candles, 400.0, 200.0, **COLOURS)
    joined = " ".join(s.value for s in shapes if type(s).__name__ == "Text")
    assert ":" in joined  # an HH:MM stamp
    for marker in ("O ", "H ", "L ", "C "):
        assert marker in joined


def test_crosshair_is_empty_outside_the_plot_area() -> None:
    candles = flat(50)
    view, p = fit(candles), plot()
    assert crosshair_shapes(p, view, candles, 10.0, 200.0, **COLOURS) == []
    assert crosshair_shapes(p, view, candles, 400.0, 395.0, **COLOURS) == []


def test_crosshair_past_the_last_candle_still_shows_a_price() -> None:
    candles = flat(10)
    shapes = crosshair_shapes(
        plot(), Viewport(500.0, 600.0, 1.0, 2.0), candles, 400.0, 200.0, **COLOURS
    )
    assert shapes  # the lines and the price box
    joined = " ".join(s.value for s in shapes if type(s).__name__ == "Text")
    assert "O " not in joined  # but no candle to describe


# -- the control -----------------------------------------------------------


def test_chart_builds_and_shows_a_message_when_empty() -> None:
    chart = CandleChart()
    chart.set_candles([])
    assert chart._empty.visible
    assert not chart._chart.visible


def test_setting_candles_fits_the_window_and_populates_the_axes() -> None:
    chart = CandleChart()
    chart.set_candles(flat(8))
    assert not chart._empty.visible
    assert chart._chart.visible
    assert len(chart._chart.spots) == 8
    assert chart._chart.min_y < chart._chart.max_y
    assert chart._chart.min_x < chart._chart.max_x
    assert chart._chart.left_axis is not None
    assert chart._chart.bottom_axis is not None


def test_new_data_refits_rather_than_keeping_a_stale_zoom() -> None:
    chart = CandleChart()
    chart.set_candles(flat(100))
    chart._view = Viewport(10.0, 20.0, 1.0, 1.05)
    chart.set_candles(flat(30))
    assert chart._view.x_span > 20  # refitted to the new series


def test_double_tap_resets_the_view() -> None:
    chart = CandleChart()
    chart.set_candles(flat(100))
    fitted = chart._view
    chart._view = Viewport(10.0, 20.0, 1.0, 1.05)
    chart.reset_view()
    assert chart._view.x_span == fitted.x_span


def test_the_chart_has_no_animation_at_all() -> None:
    animation = CandleChart()._chart.animation
    duration = animation.duration
    assert duration.days == 0
    assert duration.hours == 0
    assert duration.minutes == 0
    assert duration.seconds == 0
    assert duration.milliseconds == 0
    assert duration.microseconds == 0


# -- price auto-fit --------------------------------------------------------


def rising(n: int) -> list[Candle]:
    """A series that climbs, so a window's range differs from the whole."""
    return series([(1.0 + i * 0.01, 1.0 + i * 0.01 + 0.005,
                    1.0 + i * 0.01 - 0.005, 1.0 + i * 0.01) for i in range(n)])


def test_visible_slice_follows_the_window() -> None:
    candles = rising(100)
    sliced = visible_slice(candles, Viewport(10.0, 20.0, 0, 1))
    assert len(sliced) <= 12
    assert sliced[0] in candles[9:12]


def test_visible_slice_never_returns_nothing() -> None:
    candles = rising(10)
    assert visible_slice(candles, Viewport(500.0, 600.0, 0, 1))
    assert visible_slice([], Viewport(0, 10, 0, 1)) == []


def test_price_refits_to_the_visible_candles_when_zoomed() -> None:
    candles = rising(200)
    chart = CandleChart()
    chart.set_candles(candles)
    whole = chart._view.y_span

    chart._view = Viewport(10.0, 20.0, chart._view.y_min, chart._view.y_max)
    chart._refit_price()
    assert chart._view.y_span < whole / 5


def test_price_stops_refitting_once_the_user_drags_it() -> None:
    chart = CandleChart()
    chart.set_candles(rising(200))
    chart._auto_price = False
    before = (chart._view.y_min, chart._view.y_max)
    chart._view = Viewport(10.0, 20.0, *before)
    chart._refit_price()
    assert (chart._view.y_min, chart._view.y_max) == before


def test_a_vertical_drag_takes_over_the_price_axis() -> None:
    chart = CandleChart()
    chart.set_candles(rising(100))
    assert chart._auto_price
    chart._panned(SimpleNamespace(local_delta=SimpleNamespace(x=0.0, y=-20.0)))
    assert not chart._auto_price


def test_a_purely_horizontal_drag_leaves_auto_price_on() -> None:
    chart = CandleChart()
    chart.set_candles(rising(100))
    chart._panned(SimpleNamespace(local_delta=SimpleNamespace(x=-30.0, y=0.0)))
    assert chart._auto_price


def test_new_data_and_double_tap_both_restore_auto_price() -> None:
    chart = CandleChart()
    chart.set_candles(rising(100))
    chart._auto_price = False
    chart.reset_view()
    assert chart._auto_price

    chart._auto_price = False
    chart.set_candles(rising(50))
    assert chart._auto_price


# -- vertical zoom ---------------------------------------------------------


def scroll(x: float, y: float, dy: float) -> SimpleNamespace:
    return SimpleNamespace(
        local_position=SimpleNamespace(x=x, y=y),
        scroll_delta=SimpleNamespace(y=dy),
    )


def test_wheel_over_the_price_gutter_zooms_price() -> None:
    chart = CandleChart()
    chart.set_candles(rising(100))
    chart._plot = Plot(800.0, 340.0)
    before = chart._view
    chart._scrolled(scroll(x=20.0, y=150.0, dy=-1.0))  # inside the left gutter
    assert chart._view.y_span < before.y_span
    assert chart._view.x_span == pytest.approx(before.x_span)
    assert not chart._auto_price


def test_wheel_over_the_plot_zooms_time_and_refits_price() -> None:
    chart = CandleChart()
    chart.set_candles(rising(200))
    chart._plot = Plot(800.0, 340.0)
    before = chart._view
    chart._scrolled(scroll(x=400.0, y=150.0, dy=-1.0))
    assert chart._view.x_span < before.x_span
    assert chart._view.y_span < before.y_span  # price followed the window
    assert chart._auto_price


# -- how many candles fit --------------------------------------------------


def test_capacity_holds_the_pitch_constant_across_widths() -> None:
    chart = CandleChart()
    pitches = []
    for width in (400, 800, 1200, 1600):
        chart._plot = Plot(width, 340)
        capacity = chart.candle_capacity()
        pitches.append(chart._plot.inner_width / capacity)
    assert max(pitches) - min(pitches) < 0.5, pitches
    assert all(abs(p - TARGET_PITCH_PX) < 0.5 for p in pitches), pitches


def test_capacity_grows_with_width() -> None:
    chart = CandleChart()
    chart._plot = Plot(400, 340)
    narrow = chart.candle_capacity()
    chart._plot = Plot(1200, 340)
    assert chart.candle_capacity() > narrow


def test_capacity_is_bounded_at_both_ends() -> None:
    chart = CandleChart()
    chart._plot = Plot(10, 340)
    assert chart.candle_capacity() == MIN_CANDLES
    chart._plot = Plot(100_000, 340)
    assert chart.candle_capacity() == MAX_CANDLES


def test_the_gap_is_never_wider_than_a_candle() -> None:
    measured_candle_px = 3.0
    assert TARGET_PITCH_PX - measured_candle_px <= measured_candle_px


def test_a_small_resize_does_not_refetch() -> None:
    calls = []
    chart = CandleChart(on_capacity_change=lambda: calls.append(1))
    chart._resized(SimpleNamespace(width=830.0, height=340.0))
    assert calls == []  # close enough to the 800px it was built with


def test_the_first_layout_refetches_when_it_differs_from_the_guess() -> None:
    calls = []
    chart = CandleChart(on_capacity_change=lambda: calls.append(1))
    chart._resized(SimpleNamespace(width=440.0, height=340.0))
    assert calls == [1]


def test_a_large_resize_refetches() -> None:
    calls = []
    chart = CandleChart(on_capacity_change=lambda: calls.append(1))
    chart._resized(SimpleNamespace(width=800.0, height=340.0))
    chart._resized(SimpleNamespace(width=1600.0, height=340.0))
    assert calls == [1]
