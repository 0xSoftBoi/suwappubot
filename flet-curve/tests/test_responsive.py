"""Breakpoints, and what every view does at each of them."""

from __future__ import annotations

import pytest

from ui.responsive import (
    ALL_COLUMNS,
    CARD_BREAKPOINT,
    COMPACT_BREAKPOINT,
    COMPACT_COLUMNS,
    MAX_CONTENT_WIDTH,
    STACK_BREAKPOINT,
    content_width,
    layout_for,
)

#: Real devices, so the breakpoints are checked against sizes that exist.
PHONE = 390.0        # iPhone 15
PHONE_LANDSCAPE = 844.0
TABLET = 820.0       # iPad Air portrait
LAPTOP = 1280.0
DESKTOP = 1920.0


def test_a_phone_gets_cards() -> None:
    layout = layout_for(PHONE)
    assert layout.cards
    assert layout.columns == ()
    assert layout.stacked
    assert not layout.shows_column_headers


def test_a_tablet_gets_a_table_with_fewer_columns() -> None:
    layout = layout_for(TABLET)
    assert not layout.cards
    assert layout.columns == COMPACT_COLUMNS
    assert "base" not in layout.columns  # the first to go
    assert layout.shows_column_headers


def test_a_laptop_gets_everything() -> None:
    layout = layout_for(LAPTOP)
    assert layout.columns == ALL_COLUMNS
    assert not layout.cards
    assert not layout.stacked


def test_a_desktop_is_the_same_as_a_laptop() -> None:
    assert layout_for(DESKTOP) == layout_for(LAPTOP)


def test_the_pool_page_stacks_before_the_table_becomes_cards() -> None:
    assert STACK_BREAKPOINT > CARD_BREAKPOINT
    assert layout_for(PHONE_LANDSCAPE).stacked
    assert not layout_for(PHONE_LANDSCAPE).cards


@pytest.mark.parametrize("width", [0.0, 1.0, 320.0, 767.0, 999.0, 1000.0, 5000.0])
def test_every_width_yields_a_usable_layout(width: float) -> None:
    layout = layout_for(width)
    assert layout.name in ("wide", "compact", "cards")
    assert layout.cards == (layout.columns == ())
    assert layout.shows_column_headers != layout.cards


def test_columns_only_ever_shrink_as_the_window_narrows() -> None:
    widths = [2000.0, 1400.0, 1100.0, 1000.0, 900.0, 800.0, 760.0, 600.0, 320.0]
    previous = set(ALL_COLUMNS)
    for width in widths:
        columns = set(layout_for(width).columns)
        assert columns <= previous, width
        previous = columns


def test_the_breakpoints_are_exact() -> None:
    assert layout_for(CARD_BREAKPOINT - 0.1).cards
    assert not layout_for(CARD_BREAKPOINT).cards
    assert layout_for(COMPACT_BREAKPOINT - 0.1).columns == COMPACT_COLUMNS
    assert layout_for(COMPACT_BREAKPOINT).columns == ALL_COLUMNS
    assert layout_for(STACK_BREAKPOINT - 0.1).stacked
    assert not layout_for(STACK_BREAKPOINT).stacked


# -- how wide the page is allowed to get ------------------------------------


def test_an_ordinary_window_is_not_capped() -> None:
    assert content_width(390.0) is None
    assert content_width(1280.0) is None
    assert content_width(MAX_CONTENT_WIDTH) is None


def test_a_very_wide_window_stops_the_page_growing() -> None:
    assert content_width(1441.0) == MAX_CONTENT_WIDTH
    assert content_width(2560.0) == MAX_CONTENT_WIDTH
    assert content_width(5120.0) == MAX_CONTENT_WIDTH


def test_the_cap_never_makes_the_page_wider_than_the_window() -> None:
    for width in (320.0, 760.0, 1000.0, 1439.0, 1440.0, 1441.0, 3840.0):
        capped = content_width(width)
        assert capped is None or capped <= width
