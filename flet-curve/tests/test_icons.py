"""The icon font is cut to what this app draws, so this checks the cut."""

from __future__ import annotations

import re
from pathlib import Path

import flet as ft
import pytest

from tools.subset_icons import (
    ICON_USE,
    WIDGET_GLYPHS,
    app_icon_names,
    app_icons,
    glyph_name,
    keep,
    subset,
)

SRC = Path(__file__).resolve().parent.parent / "src"


def source_font() -> Path:
    """The full font, where `flet publish` copies it from."""
    import flet_web

    return Path(flet_web.__file__).parent / "web/assets/fonts/MaterialIcons-Regular.otf"


# -- the scan, which is what makes the keep-list self-maintaining ------------


def test_the_scan_finds_the_icons_this_app_draws() -> None:
    found = app_icon_names()

    assert "SEARCH" in found
    assert "ACCOUNT_BALANCE_WALLET" in found
    assert "OPEN_IN_NEW" in found
    assert len(found) >= 10


def test_every_icon_named_in_the_source_resolves_to_a_glyph() -> None:
    pytest.importorskip("fontTools")
    from fontTools.ttLib import TTFont

    font = TTFont(source_font())
    found = app_icons(font)
    assert set(found) == set(app_icon_names())
    for name, codepoint in found.items():
        assert isinstance(codepoint, int)
        assert font.getBestCmap()[codepoint] == glyph_name(name)
        assert getattr(ft.Icons, name, None) is not None


def test_the_style_suffix_survives_the_name() -> None:
    assert glyph_name("SEARCH") == "search_baseline"
    assert glyph_name("COPY_ALL_OUTLINED") == "copy_all_outlined"
    assert glyph_name("SOMETHING_ROUNDED") == "something_rounded"
    assert glyph_name("SOMETHING_SHARP") == "something_sharp"


def test_the_scan_matches_the_way_this_app_writes_an_icon() -> None:
    assert ICON_USE.findall("icon=ft.Icons.SEARCH,") == ["SEARCH"]
    assert ICON_USE.findall("ft.Icons.COPY_ALL_OUTLINED") == ["COPY_ALL_OUTLINED"]
    assert ICON_USE.findall("ft.Icons.ARROW_BACK)") == ["ARROW_BACK"]
    assert ICON_USE.findall("ft.IconsX.SEARCH") == []


def test_no_source_file_reaches_for_an_icon_some_other_way() -> None:
    suspicious = re.compile(r"getattr\(\s*ft\.Icons|ft\.Icons\s*\[|Icons\.__members__")
    for path in sorted(SRC.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        assert not suspicious.search(path.read_text(encoding="utf-8")), (
            f"{path.name} looks up an icon dynamically, which "
            "tools/subset_icons.py cannot see -- name it directly or the "
            "glyph will be stripped"
        )


# -- the cut itself ---------------------------------------------------------


def test_the_widget_glyph_names_still_exist_in_the_font() -> None:
    pytest.importorskip("fontTools")
    from fontTools.ttLib import TTFont

    font = TTFont(source_font())
    glyphs = set(font.getGlyphOrder())
    assert WIDGET_GLYPHS, "something must cover Flutter's own icons"
    for name in WIDGET_GLYPHS:
        assert name in glyphs, f"{name} is no longer in the font"


def test_every_icon_in_use_survives_the_subset(tmp_path) -> None:
    pytest.importorskip("fontTools")
    from fontTools.ttLib import TTFont

    cut = tmp_path / "MaterialIcons-Regular.otf"
    glyphs, before, after = subset(source_font(), cut)

    present = set(TTFont(cut).getBestCmap())
    for name, codepoint in app_icons(TTFont(source_font())).items():
        assert codepoint in present, f"ft.Icons.{name} was stripped from the font"

    assert glyphs == len(present) + 1, "every kept codepoint should have a glyph"
    assert after < before / 100, f"expected a big cut, got {before} -> {after}"


def test_the_subset_drops_what_is_not_asked_for(tmp_path) -> None:
    pytest.importorskip("fontTools")
    from fontTools.ttLib import TTFont

    full = TTFont(source_font())
    wanted = keep(full)

    cut = tmp_path / "MaterialIcons-Regular.otf"
    subset(source_font(), cut)

    present = set(TTFont(cut).getBestCmap())
    assert present == wanted
    assert len(present) < len(full.getBestCmap()) / 100
