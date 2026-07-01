"""Render a branded PnL share card as an in-memory PNG.

Used by the /hx (history) and /pos (positions) "Share result" flows to turn a
swap or position's PnL into a shareable image card instead of plain text.

Design goals:
- Never crash the share flow. All font/asset loading is best-effort with
  fallbacks to ``ImageFont.load_default()``.
- Fast: pure PIL drawing, no network calls, no disk I/O beyond optional
  bundled fonts.
- Self-contained: returns a ``BytesIO`` ready to hand to
  ``bot.send_photo`` / ``message.reply_photo``.
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

CARD_WIDTH = 1080
CARD_HEIGHT = 1080

# Suwappu brand-ish palette.
_BG_TOP = (13, 17, 23)
_BG_BOTTOM = (22, 27, 34)
_GREEN = (46, 204, 113)
_RED = (231, 76, 60)
_WHITE = (240, 242, 245)
_MUTED = (148, 158, 173)
_ACCENT = (88, 101, 242)
_CARD_BORDER = (45, 51, 63)


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Best-effort TTF loading with a guaranteed fallback.

    Tries a handful of common system font paths (DejaVu is bundled with
    most Pillow installs / Linux base images). Falls back to PIL's built-in
    bitmap font if nothing is found, so this never raises.
    """
    candidates = (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        if bold
        else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        # Newer Pillow supports a size arg on the default bitmap font.
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
        # Very old Pillow / default font fallback.
        try:
            return draw.textlength(text, font=font)
        except Exception:
            return len(text) * (getattr(font, "size", 10) // 2 or 6)


def _center_text(
    draw: "ImageDraw.ImageDraw",
    y: int,
    text: str,
    font: ImageFont.ImageFont,
    fill,
    width: int = CARD_WIDTH,
) -> None:
    w = _text_width(draw, text, font)
    x = max(0, (width - w) // 2)
    draw.text((x, y), text, font=font, fill=fill)


def _format_usd(v: float) -> str:
    sign = "-" if v < 0 else "+"
    a = abs(v)
    if a >= 1000:
        return f"{sign}${a:,.0f}"
    return f"{sign}${a:,.2f}"


def _format_price(v: float) -> str:
    if v == 0:
        return "$0.00"
    if v < 0.001:
        return f"${v:.8f}".rstrip("0").rstrip(".")
    if v < 1:
        return f"${v:.6f}"
    return f"${v:,.2f}"


def _vertical_gradient(width: int, height: int, top, bottom) -> Image.Image:
    """Cheap top-to-bottom gradient background without extra deps."""
    base = Image.new("RGB", (1, height), color=0)
    draw = ImageDraw.Draw(base)
    for y in range(height):
        t = y / max(1, height - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        draw.point((0, y), fill=(r, g, b))
    return base.resize((width, height))


def render_pnl_card(
    *,
    token: str,
    roi_pct: float,
    pnl_usd: float,
    entry: float,
    exit_price: float,
    ref_code: Optional[str] = None,
) -> BytesIO:
    """Render a branded PnL share card and return it as an in-memory PNG.

    Never raises for font/asset reasons — all rendering steps degrade
    gracefully so callers can rely on this always producing *some* image.
    """
    try:
        img = _vertical_gradient(CARD_WIDTH, CARD_HEIGHT, _BG_TOP, _BG_BOTTOM)
    except Exception:
        img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), color=_BG_TOP)

    draw = ImageDraw.Draw(img)
    is_profit = roi_pct >= 0
    accent = _GREEN if is_profit else _RED

    # Outer card border / inset panel for a "card" feel.
    margin = 40
    try:
        draw.rounded_rectangle(
            [margin, margin, CARD_WIDTH - margin, CARD_HEIGHT - margin],
            radius=36,
            outline=_CARD_BORDER,
            width=3,
        )
    except Exception:
        draw.rectangle(
            [margin, margin, CARD_WIDTH - margin, CARD_HEIGHT - margin],
            outline=_CARD_BORDER,
            width=3,
        )

    font_brand = _load_font(46, bold=True)
    font_token = _load_font(56, bold=True)
    font_roi = _load_font(150, bold=True)
    font_label = _load_font(34)
    font_value = _load_font(44, bold=True)
    font_footer = _load_font(30)
    font_ref = _load_font(30, bold=True)

    # Brand header.
    _center_text(draw, 90, "SUWAPPU", font_brand, _ACCENT)

    # Token symbol.
    token_display = (token or "TOKEN").upper()[:16]
    _center_text(draw, 170, token_display, font_token, _WHITE)

    # Big ROI%.
    roi_str = f"{'+' if roi_pct >= 0 else ''}{roi_pct:.2f}%"
    _center_text(draw, 300, roi_str, font_roi, accent)

    # PnL USD.
    pnl_str = f"{_format_usd(pnl_usd)}"
    _center_text(draw, 490, pnl_str, font_value, accent)

    # Entry -> Exit row.
    entry_exit = f"Entry {_format_price(entry)}   →   Exit {_format_price(exit_price)}"
    _center_text(draw, 590, entry_exit, font_label, _MUTED)

    # Divider.
    div_y = 690
    draw.line(
        [(margin + 60, div_y), (CARD_WIDTH - margin - 60, div_y)],
        fill=_CARD_BORDER,
        width=2,
    )

    # Footer tagline. Plain ASCII — the bundled fallback fonts don't carry
    # emoji glyphs and would render a "tofu" box instead.
    _center_text(draw, div_y + 40, "Swapped via Suwappu Bot", font_footer, _MUTED)

    # Referral link, if provided.
    if ref_code:
        try:
            bot_username = "suwappubot"
            try:
                from bot.config.settings import settings

                bot_username = settings.telegram_bot_username or bot_username
            except Exception:
                pass
            ref_line = f"t.me/{bot_username}?start={ref_code}"
            _center_text(draw, div_y + 90, ref_line, font_ref, _ACCENT)

            # Scannable QR of the referral link — scan it to open the bot with the
            # referral attached (the growth loop). Best-effort in its own guard so
            # a qrcode failure never drops the (already-rendered) text link.
            try:
                import qrcode

                qr = qrcode.QRCode(box_size=6, border=2)
                qr.add_data(f"https://{ref_line}")
                qr.make(fit=True)
                qr_img = (
                    qr.make_image(fill_color="white", back_color=_BG_BOTTOM)
                    .convert("RGB")
                    .resize((180, 180))
                )
                img.paste(qr_img, ((CARD_WIDTH - 180) // 2, div_y + 145))
            except Exception:
                logger.debug("pnl_card_image: QR render skipped", exc_info=True)
        except Exception:
            logger.debug("pnl_card_image: failed to render ref link", exc_info=True)

    # Watermark, bottom-right, low-opacity feel via muted color.
    try:
        wm = "suwappu.bot"
        w = _text_width(draw, wm, font_footer)
        draw.text(
            (CARD_WIDTH - margin - w - 20, CARD_HEIGHT - margin - 50),
            wm,
            font=font_footer,
            fill=_MUTED,
        )
    except Exception:
        logger.debug("pnl_card_image: failed to render watermark", exc_info=True)

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf
