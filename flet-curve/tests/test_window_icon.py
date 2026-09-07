"""The desktop window icon: its data file, and its refusal to try."""

from __future__ import annotations

import struct

import pytest

from ui.window_icon import ICON_DATA, _load_icon, apply_window_icon

#: What `build_icons.py` renders. A window manager picks the size closest to
#: what it is drawing, so a titlebar gets a 16 or 24 rendered at that size
#: rather than a 128 squeezed down to a smear.
EXPECTED_SIZES = (16, 24, 32, 48, 64, 128)


def test_the_icon_data_is_committed() -> None:
    assert ICON_DATA.is_file(), f"{ICON_DATA.name} missing -- run tools/build_icons.py"


def test_it_is_a_whole_number_of_cardinals() -> None:
    assert ICON_DATA.stat().st_size % 4 == 0


def test_it_holds_the_sizes_a_window_manager_wants() -> None:
    words = _load_icon()
    assert words is not None

    sizes = []
    index = 0
    while index < len(words):
        width, height = words[index], words[index + 1]
        sizes.append((width, height))
        index += 2 + width * height
    assert index == len(words), "a size block runs off the end of the file"
    assert sizes == [(size, size) for size in EXPECTED_SIZES]


def test_the_pixels_are_argb_with_a_mark_in_them() -> None:
    words = _load_icon()
    assert words is not None
    for offset in (0, 2 + 16 * 16):  # the 16px block, then the 24px one
        width, height = words[offset], words[offset + 1]
        pixels = words[offset + 2 : offset + 2 + width * height]
        alpha = [pixel >> 24 for pixel in pixels]
        assert max(alpha) >= 250, "the mark never becomes solid"
        assert sum(1 for a in alpha if a) > width * height // 4, "mostly empty"
        assert all(pixel <= 0xFFFFFFFF for pixel in pixels)


def test_a_missing_data_file_is_not_an_error(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("ui.window_icon.ICON_DATA", tmp_path / "gone.argb")
    assert _load_icon() is None
    monkeypatch.setenv("DISPLAY", ":0")
    assert apply_window_icon() == 0


def test_a_truncated_data_file_is_not_an_error(monkeypatch, tmp_path) -> None:
    broken = tmp_path / "half.argb"
    broken.write_bytes(struct.pack("<I", 16)[:3])
    monkeypatch.setattr("ui.window_icon.ICON_DATA", broken)
    assert _load_icon() is None


def test_nothing_is_attempted_without_a_display(monkeypatch) -> None:
    monkeypatch.delenv("DISPLAY", raising=False)
    assert apply_window_icon() == 0


@pytest.mark.parametrize("platform", ["darwin", "win32", "emscripten"])
def test_nothing_is_attempted_off_x11(monkeypatch, platform: str) -> None:
    monkeypatch.setattr("ui.window_icon.sys.platform", platform)
    monkeypatch.setenv("DISPLAY", ":0")
    assert apply_window_icon() == 0
