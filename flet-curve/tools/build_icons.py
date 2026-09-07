#!/usr/bin/env python3
"""Render the app icon and favicon from the Curve mark."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # Pillow is a build-time dependency, not a runtime one
    from PIL.Image import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "src" / "assets" / "curve" / "branding" / "logo.svg"
ASSETS = ROOT / "src" / "assets"

#: Android crops a maskable icon to an arbitrary shape and guarantees only
#: the middle 80% survives.
SAFE_ZONE = 0.78

#: What the cropped icons sit on. White rather than the page background,
#: because these show up on a home screen next to other apps rather than
#: inside the app.
BACKDROP = (255, 255, 255, 255)


def render(size: int) -> Image:
    """The mark at `size`, transparent, antialiased by the SVG renderer."""
    from PIL import Image

    out = subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), str(LOGO)],
        check=True,
        capture_output=True,
    ).stdout
    import io

    return Image.open(io.BytesIO(out)).convert("RGBA")


def on_backdrop(size: int) -> Image:
    """The mark inset into the safe zone, on an opaque square."""
    from PIL import Image

    inner = round(size * SAFE_ZONE)
    canvas = Image.new("RGBA", (size, size), BACKDROP)
    mark = render(inner)
    offset = (size - inner) // 2
    canvas.alpha_composite(mark, (offset, offset))
    return canvas


def write(image: Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {image.size[0]}px  {path.stat().st_size:,} B")


def main() -> int:
    if not LOGO.exists():
        print(
            f"No logo at {LOGO.relative_to(ROOT)}.\n"
            "Run `git submodule update --init` then `python tools/build_assets.py`.",
            file=sys.stderr,
        )
        return 1
    if shutil.which("rsvg-convert") is None:
        print("rsvg-convert not found (librsvg).", file=sys.stderr)
        return 1
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow not installed.", file=sys.stderr)
        return 1

    print("Rendering the Curve mark:")
    write(render(32), ASSETS / "favicon.png")
    write_ico(ASSETS / "favicon.ico")
    write(render(1024), ASSETS / "icon.png")
    for size in (192, 512):
        write(render(size), ASSETS / "icons" / f"icon-{size}.png")
        write(on_backdrop(size), ASSETS / "icons" / f"icon-maskable-{size}.png")
    write(on_backdrop(192), ASSETS / "icons" / "apple-touch-icon-192.png")
    write(render(512), ASSETS / "icons" / "loading-animation.png")
    write_x11_icon(ASSETS / "window_icon.argb")
    print("These overwrite Flet's defaults on `flet publish` and `flet build`.")
    return 0


def write_ico(path: Path) -> None:
    """A real `favicon.ico`, for the path browsers probe on their own."""
    icon = render(48)
    icon.save(path, "ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {path.relative_to(ROOT)}  16/32/48px  {path.stat().st_size:,} B")


#: Sizes for the X11 window icon. A window manager picks whichever is
#: closest to what it is drawing -- a titlebar wants 24, a task switcher 48
#: or 64 -- and having a small one rendered rather than downscaled is the
#: difference between a legible titlebar and a smear.
X11_SIZES = (16, 24, 32, 48, 64, 128)


def write_x11_icon(path: Path) -> None:
    """The window icon, pre-decoded into what `_NET_WM_ICON` wants."""
    import struct

    words: list[int] = []
    for size in X11_SIZES:
        image = render(size)
        words += [size, size]
        raw = image.tobytes()  # RGBA, row-major, no padding
        for offset in range(0, len(raw), 4):
            r, g, b, a = raw[offset : offset + 4]
            words.append((a << 24) | (r << 16) | (g << 8) | b)
    path.write_bytes(struct.pack(f"<{len(words)}I", *words))
    print(f"  {path.relative_to(ROOT)}  {'/'.join(map(str, X11_SIZES))}px  "
          f"{path.stat().st_size:,} B")


if __name__ == "__main__":
    raise SystemExit(main())
