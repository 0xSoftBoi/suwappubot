"""Tests for bot/utils/chart_render.py — pure Pillow candlestick renderer.

No DB, no network, no Telegram objects — candles-in, PNG-bytes-out.
"""

from datetime import datetime, timedelta, timezone
from io import BytesIO

from PIL import Image

from bot.utils.chart_render import render_candlestick_png


def _make_candles(n: int, start_price: float = 100.0) -> list[dict]:
    candles = []
    price = start_price
    now = datetime.now(timezone.utc)
    for i in range(n):
        o = price
        c = price * (1.01 if i % 2 == 0 else 0.99)
        h = max(o, c) * 1.005
        l = min(o, c) * 0.995  # noqa: E741
        candles.append(
            {
                "ts": now - timedelta(hours=(n - i)),
                "open": o,
                "high": h,
                "low": l,
                "close": c,
            }
        )
        price = c
    return candles


def test_render_produces_valid_png_for_synthetic_candles():
    candles = _make_candles(60)
    png_bytes = render_candlestick_png(candles, "ETH", "1h")

    assert png_bytes is not None
    assert isinstance(png_bytes, bytes)
    assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    img = Image.open(BytesIO(png_bytes))
    img.verify()  # raises if the PNG is corrupt
    # Re-open since verify() leaves the file object unusable for further reads.
    img2 = Image.open(BytesIO(png_bytes))
    assert img2.format == "PNG"
    assert img2.size[0] > 0 and img2.size[1] > 0


def test_render_handles_single_candle():
    candles = _make_candles(1)
    png_bytes = render_candlestick_png(candles, "SOL", "1d")

    assert png_bytes is not None
    img = Image.open(BytesIO(png_bytes))
    img.verify()


def test_render_handles_flat_single_candle_with_no_range():
    # open == high == low == close: degenerate zero-range series should not
    # divide-by-zero or produce a broken image.
    candles = [
        {
            "ts": datetime.now(timezone.utc),
            "open": 50.0,
            "high": 50.0,
            "low": 50.0,
            "close": 50.0,
        }
    ]
    png_bytes = render_candlestick_png(candles, "USDC", "1m")

    assert png_bytes is not None
    img = Image.open(BytesIO(png_bytes))
    img.verify()


def test_render_returns_none_for_empty_candles():
    assert render_candlestick_png([], "ETH", "1h") is None


def test_render_returns_none_for_malformed_candles():
    assert render_candlestick_png([{"open": "not-a-number"}], "ETH", "1h") is None


def test_render_respects_custom_dimensions():
    candles = _make_candles(10)
    png_bytes = render_candlestick_png(candles, "BTC", "1d", width=400, height=200)

    img = Image.open(BytesIO(png_bytes))
    assert img.size == (400, 200)
