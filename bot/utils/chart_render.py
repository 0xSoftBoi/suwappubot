"""Render a candlestick chart as an in-memory PNG — Pillow only.

Backs the /chart command (bot/handlers/chart.py). Deliberately pure:
candles-in, PNG-bytes-out, no DB access, no network calls, no Telegram
objects — so it's trivially unit-testable (tests/test_chart_render.py) and
never blocks the event loop on anything but CPU-bound drawing.

Matplotlib is NOT a dependency here on purpose — Pillow is already vendored
for bot/utils/pnl_card_image.py and bot/utils/qr_code.py, and a candlestick
chart is simple enough to draw with plain rectangles/lines.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional, Sequence

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

CHART_WIDTH = 1000
CHART_HEIGHT = 600

_BG = (13, 17, 23)
_GRID = (32, 38, 47)
_GREEN = (46, 204, 113)
_RED = (231, 76, 60)
_WHITE = (240, 242, 245)
_MUTED = (148, 158, 173)

# Plot-area padding: room for the title at top, right-axis price labels, and
# a small bottom margin.
_PAD_TOP = 70
_PAD_BOTTOM = 30
_PAD_LEFT = 20
_PAD_RIGHT = 130


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Best-effort TTF loading with a guaranteed fallback (mirrors pnl_card_image)."""
    candidates = (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        if bold
        else ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()


def _text_width(draw: "ImageDraw.ImageDraw", text: str, font: ImageFont.ImageFont) -> int:
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]
    except Exception:
        try:
            return int(draw.textlength(text, font=font))
        except Exception:
            return len(text) * (getattr(font, "size", 10) // 2 or 6)


def _format_price(v: float) -> str:
    if v == 0:
        return "0.00"
    a = abs(v)
    if a < 0.001:
        return f"{v:.8f}".rstrip("0").rstrip(".")
    if a < 1:
        return f"{v:.6f}"
    if a < 1000:
        return f"{v:,.4f}"
    return f"{v:,.2f}"


def render_candlestick_png(
    candles: Sequence[dict],
    symbol: str,
    timeframe: str,
    *,
    width: int = CHART_WIDTH,
    height: int = CHART_HEIGHT,
) -> Optional[bytes]:
    """Render up to N OHLC candles as a dark-mode candlestick PNG.

    Each candle dict must have numeric ``open``/``high``/``low``/``close``
    keys (float or Decimal — coerced to float here) and, optionally, a
    ``ts`` (datetime) used only for internal ordering context (not drawn
    on the axis, to keep this simple and dependency-free).

    Returns ``None`` for empty input rather than raising — callers (the
    /chart handler) treat "no data" as a normal, expected outcome rather
    than an error worth logging a traceback for.
    """
    if not candles:
        return None

    try:
        ohlc = [
            (
                float(c["open"]),
                float(c["high"]),
                float(c["low"]),
                float(c["close"]),
            )
            for c in candles
        ]
    except (KeyError, TypeError, ValueError) as e:
        logger.warning(f"chart_render: malformed candle input: {e}")
        return None

    img = Image.new("RGB", (width, height), color=_BG)
    draw = ImageDraw.Draw(img)

    plot_left = _PAD_LEFT
    plot_right = width - _PAD_RIGHT
    plot_top = _PAD_TOP
    plot_bottom = height - _PAD_BOTTOM
    plot_h = plot_bottom - plot_top

    lo = min(c[2] for c in ohlc)
    hi = max(c[1] for c in ohlc)
    if hi <= lo:
        # Flat/degenerate series (e.g. a single candle with open==close and
        # no wick range) — pad the range so the candle isn't a zero-height
        # sliver.
        pad = (abs(hi) * 0.01) or 1.0
        hi += pad
        lo -= pad

    def y_of(price: float) -> float:
        t = (price - lo) / (hi - lo)
        return plot_bottom - t * plot_h

    # Gridlines (4 horizontal bands).
    for i in range(5):
        y = plot_top + (plot_h * i / 4)
        draw.line([(plot_left, y), (plot_right, y)], fill=_GRID, width=1)

    n = len(ohlc)
    slot_w = (plot_right - plot_left) / n
    body_w = max(2, slot_w * 0.6)

    for i, (o, h, l, c) in enumerate(ohlc):
        cx = plot_left + slot_w * (i + 0.5)
        color = _GREEN if c >= o else _RED

        # Wick.
        draw.line([(cx, y_of(h)), (cx, y_of(l))], fill=color, width=max(1, int(slot_w * 0.08)))

        # Body.
        y_open = y_of(o)
        y_close = y_of(c)
        top_y = min(y_open, y_close)
        bot_y = max(y_open, y_close)
        if bot_y - top_y < 1:
            bot_y = top_y + 1  # doji: draw a visible thin bar, not nothing
        draw.rectangle(
            [cx - body_w / 2, top_y, cx + body_w / 2, bot_y],
            fill=color,
        )

    # Right-axis labels: max, min, last close.
    font_axis = _load_font(20)
    font_title = _load_font(26, bold=True)

    last_close = ohlc[-1][3]
    label_x = plot_right + 10

    def draw_label(price: float, fill) -> None:
        y = y_of(price)
        text = _format_price(price)
        draw.text((label_x, y - 8), text, font=font_axis, fill=fill)

    draw_label(hi, _MUTED)
    draw_label(lo, _MUTED)
    last_color = _GREEN if last_close >= ohlc[0][0] else _RED
    draw_label(last_close, last_color)
    try:
        draw.line(
            [(plot_right, y_of(last_close)), (width - 10, y_of(last_close))],
            fill=last_color,
            width=1,
        )
    except Exception:
        pass

    # Title.
    title = f"{symbol.upper()}/USD · {timeframe} · Suwappu Data"
    tw = _text_width(draw, title, font_title)
    draw.text((max(0, (width - tw) // 2), 20), title, font=font_title, fill=_WHITE)

    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
