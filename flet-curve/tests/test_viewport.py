"""Pan, zoom and the pixel<->data mapping."""

from __future__ import annotations

import pytest

from ui.viewport import (
    BOTTOM_AXIS_HEIGHT,
    LEFT_AXIS_WIDTH,
    MIN_VISIBLE,
    Plot,
    Viewport,
)


def view() -> Viewport:
    return Viewport(0.0, 100.0, 1.0, 2.0)


def plot() -> Plot:
    return Plot(800.0, 400.0)


# -- panning ---------------------------------------------------------------


def test_pan_shifts_both_axes_without_resizing_the_window() -> None:
    panned = view().panned(10.0, 0.5)
    assert (panned.x_min, panned.x_max) == (10.0, 110.0)
    assert (panned.y_min, panned.y_max) == (1.5, 2.5)
    assert panned.x_span == view().x_span


def test_pan_is_reversible() -> None:
    there_and_back = view().panned(7.0, 0.25).panned(-7.0, -0.25)
    assert there_and_back.x_min == pytest.approx(view().x_min)
    assert there_and_back.y_max == pytest.approx(view().y_max)


# -- zooming ---------------------------------------------------------------


def test_zoom_holds_the_focus_point_still() -> None:
    original = view()
    for focus in (0.0, 25.0, 50.0, 100.0):
        for factor in (0.5, 0.8, 1.25, 2.0):
            zoomed = original.zoomed_x(factor, focus)
            before = (focus - original.x_min) / original.x_span
            after = (focus - zoomed.x_min) / zoomed.x_span
            assert after == pytest.approx(before), (focus, factor)


def test_zoom_in_narrows_and_zoom_out_widens() -> None:
    assert view().zoomed_x(0.5, 50.0).x_span == pytest.approx(50.0)
    assert view().zoomed_x(2.0, 50.0).x_span == pytest.approx(200.0)


def test_zoom_leaves_the_price_axis_alone() -> None:
    zoomed = view().zoomed_x(0.5, 50.0)
    assert (zoomed.y_min, zoomed.y_max) == (1.0, 2.0)


def test_vertical_zoom_holds_the_focus_price_still() -> None:
    original = view()
    for focus in (1.0, 1.25, 2.0):
        for factor in (0.5, 2.0):
            zoomed = original.zoomed_y(factor, focus)
            before = (focus - original.y_min) / original.y_span
            after = (focus - zoomed.y_min) / zoomed.y_span
            assert after == pytest.approx(before), (focus, factor)


def test_vertical_zoom_leaves_time_alone() -> None:
    zoomed = view().zoomed_y(0.5, 1.5)
    assert (zoomed.x_min, zoomed.x_max) == (0.0, 100.0)


def test_with_y_replaces_only_the_price_window() -> None:
    replaced = view().with_y(5.0, 6.0)
    assert (replaced.y_min, replaced.y_max) == (5.0, 6.0)
    assert (replaced.x_min, replaced.x_max) == (0.0, 100.0)


# -- clamping --------------------------------------------------------------


def test_clamp_keeps_the_window_over_the_data() -> None:
    far_right = Viewport(5000.0, 5100.0, 1.0, 2.0).clamped(200)
    assert far_right.x_max <= 200 + far_right.x_span
    assert far_right.x_span == pytest.approx(100.0)


def test_clamp_allows_a_little_overscroll_but_not_the_void() -> None:
    clamped = Viewport(-9999.0, -9899.0, 1.0, 2.0).clamped(200)
    assert clamped.x_min < 0  # some slack past the start
    assert clamped.x_min > -clamped.x_span  # but not unbounded


def test_clamp_enforces_a_minimum_window() -> None:
    tiny = Viewport(50.0, 50.001, 1.0, 2.0).clamped(200)
    assert tiny.x_span >= MIN_VISIBLE


def test_clamp_never_asks_for_more_than_there_is() -> None:
    huge = Viewport(0.0, 10_000.0, 1.0, 2.0).clamped(30)
    assert huge.x_span <= 30


def test_clamp_on_an_empty_series_is_a_no_op() -> None:
    original = view()
    assert original.clamped(0) is original


def test_repeated_pan_and_clamp_stays_bounded() -> None:
    v = Viewport(0.0, 50.0, 1.0, 2.0)
    for _ in range(200):
        v = v.panned(25.0, 0.0).clamped(100)
    assert -50 <= v.x_min <= 150
    assert v.x_span == pytest.approx(50.0)


# -- the plot box ----------------------------------------------------------


def test_plot_area_excludes_the_axis_gutters() -> None:
    p = plot()
    assert p.left == LEFT_AXIS_WIDTH
    assert p.bottom == 400.0 - BOTTOM_AXIS_HEIGHT
    assert p.inner_width == 800.0 - LEFT_AXIS_WIDTH


def test_a_box_too_small_for_its_gutters_never_divides_by_zero() -> None:
    p = Plot(10.0, 10.0)
    assert p.inner_width >= 1.0
    assert p.inner_height >= 1.0
    assert p.data_x(5.0, view()) == p.data_x(5.0, view())  # no NaN


def test_contains_rejects_the_axis_gutters() -> None:
    p = plot()
    assert p.contains(p.left + 10, p.top + 10)
    assert not p.contains(p.left - 10, p.top + 10)  # in the price gutter
    assert not p.contains(p.left + 10, p.bottom + 10)  # in the date gutter


# -- coordinate mapping ----------------------------------------------------


def test_pixels_and_data_round_trip() -> None:
    p, v = plot(), view()
    for px in (p.left, p.left + 100, p.right):
        assert p.pixel_x(p.data_x(px, v), v) == pytest.approx(px)
    for py in (p.top, p.top + 100, p.bottom):
        assert p.pixel_y(p.data_y(py, v), v) == pytest.approx(py)


def test_price_grows_upward_on_screen() -> None:
    p, v = plot(), view()
    assert p.data_y(p.top, v) > p.data_y(p.bottom, v)
    assert p.pixel_y(v.y_max, v) < p.pixel_y(v.y_min, v)


def test_the_edges_of_the_plot_map_to_the_edges_of_the_window() -> None:
    p, v = plot(), view()
    assert p.data_x(p.left, v) == pytest.approx(v.x_min)
    assert p.data_x(p.right, v) == pytest.approx(v.x_max)
    assert p.data_y(p.top, v) == pytest.approx(v.y_max)
    assert p.data_y(p.bottom, v) == pytest.approx(v.y_min)


def test_deltas_scale_with_the_window() -> None:
    p = plot()
    wide = Viewport(0.0, 100.0, 1.0, 2.0)
    narrow = Viewport(0.0, 10.0, 1.0, 2.0)
    assert p.dx(100.0, wide) > p.dx(100.0, narrow)
    assert p.dy(100.0, wide) == pytest.approx(p.dy(100.0, narrow))
