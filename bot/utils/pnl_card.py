"""PnL card image generator for social sharing.

Generates branded Suwappu PnL cards as PNG images for sharing
on Telegram Stories, Twitter/X, and other platforms.
"""

import io
import logging
from typing import Dict, Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Card dimensions (optimized for Telegram/Twitter sharing)
CARD_WIDTH = 800
CARD_HEIGHT = 480

# Colors
DARK_BG = (18, 18, 30)          # #12121E
CARD_BG = (28, 28, 48)          # #1C1C30
GREEN = (20, 241, 149)          # #14F195 (Suwappu green)
RED = (255, 69, 58)             # #FF453A
WHITE = (255, 255, 255)
GRAY = (160, 160, 180)          # #A0A0B4
LIGHT_GRAY = (100, 100, 120)    # #646478
BRAND_PURPLE = (98, 126, 234)   # #627EEA


def _get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Get a font, falling back to default if custom fonts not available."""
    try:
        if bold:
            return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except (OSError, IOError):
        return ImageFont.load_default()


def generate_swap_pnl_card(
    token: str,
    entry_price: float,
    current_price: float,
    roi_percent: float,
    profit_usd: float,
    chain: str = "solana",
    amount_held: Optional[float] = None,
) -> bytes:
    """Generate a PnL card for a single swap/position.

    Args:
        token: Token symbol (e.g., "BONK")
        entry_price: Price at time of purchase
        current_price: Current token price
        roi_percent: Return on investment percentage
        profit_usd: Absolute profit/loss in USD
        chain: Chain name
        amount_held: Optional token amount held

    Returns:
        PNG image as bytes
    """
    is_profit = roi_percent >= 0
    accent = GREEN if is_profit else RED

    img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), DARK_BG)
    draw = ImageDraw.Draw(img)

    # Card background with rounded effect
    draw.rounded_rectangle(
        [20, 20, CARD_WIDTH - 20, CARD_HEIGHT - 20],
        radius=24,
        fill=CARD_BG,
    )

    # Header: Suwappu branding
    font_brand = _get_font(18, bold=True)
    draw.text((50, 42), "SUWAPPU", fill=BRAND_PURPLE, font=font_brand)

    font_chain = _get_font(14)
    draw.text((CARD_WIDTH - 150, 44), chain.upper(), fill=LIGHT_GRAY, font=font_chain)

    # Separator line
    draw.line([(50, 72), (CARD_WIDTH - 50, 72)], fill=LIGHT_GRAY, width=1)

    # Token name
    font_token = _get_font(36, bold=True)
    draw.text((50, 90), f"${token}", fill=WHITE, font=font_token)

    # ROI percentage (large, centered)
    sign = "+" if is_profit else ""
    roi_text = f"{sign}{roi_percent:.1f}%"
    font_roi = _get_font(72, bold=True)
    bbox = draw.textbbox((0, 0), roi_text, font=font_roi)
    roi_width = bbox[2] - bbox[0]
    roi_x = (CARD_WIDTH - roi_width) // 2
    draw.text((roi_x, 150), roi_text, fill=accent, font=font_roi)

    # Profit in USD
    sign_usd = "+" if profit_usd >= 0 else ""
    profit_text = f"{sign_usd}${abs(profit_usd):,.2f}"
    font_profit = _get_font(28, bold=True)
    bbox = draw.textbbox((0, 0), profit_text, font=font_profit)
    profit_width = bbox[2] - bbox[0]
    profit_x = (CARD_WIDTH - profit_width) // 2
    draw.text((profit_x, 240), profit_text, fill=accent, font=font_profit)

    # Entry / Current price row
    y_prices = 310
    font_label = _get_font(14)
    font_value = _get_font(20, bold=True)

    # Entry price (left)
    draw.text((50, y_prices), "ENTRY", fill=GRAY, font=font_label)
    draw.text((50, y_prices + 22), _format_price(entry_price), fill=WHITE, font=font_value)

    # Current price (center)
    draw.text((320, y_prices), "CURRENT", fill=GRAY, font=font_label)
    draw.text((320, y_prices + 22), _format_price(current_price), fill=WHITE, font=font_value)

    # Amount held (right)
    if amount_held is not None:
        draw.text((580, y_prices), "HELD", fill=GRAY, font=font_label)
        draw.text(
            (580, y_prices + 22),
            _format_amount(amount_held, token),
            fill=WHITE,
            font=font_value,
        )

    # Footer separator
    draw.line([(50, CARD_HEIGHT - 70), (CARD_WIDTH - 50, CARD_HEIGHT - 70)], fill=LIGHT_GRAY, width=1)

    # Footer: call to action
    font_footer = _get_font(14)
    draw.text((50, CARD_HEIGHT - 52), "Trade on Suwappu  |  t.me/suwappubot", fill=LIGHT_GRAY, font=font_footer)

    # Convert to bytes
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    return buffer.getvalue()


def generate_portfolio_pnl_card(
    total_value_usd: float,
    total_pnl_usd: float,
    pnl_percent: float,
    swap_count: int,
    period_days: int = 30,
    top_holdings: Optional[Dict[str, float]] = None,
    username: Optional[str] = None,
) -> bytes:
    """Generate a portfolio summary PnL card.

    Args:
        total_value_usd: Current portfolio value
        total_pnl_usd: Total P&L in USD
        pnl_percent: P&L as percentage
        swap_count: Number of swaps in period
        period_days: Lookback period
        top_holdings: Dict of token -> value_usd (top 5)
        username: Optional Telegram username

    Returns:
        PNG image as bytes
    """
    is_profit = total_pnl_usd >= 0
    accent = GREEN if is_profit else RED

    img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), DARK_BG)
    draw = ImageDraw.Draw(img)

    # Card background
    draw.rounded_rectangle(
        [20, 20, CARD_WIDTH - 20, CARD_HEIGHT - 20],
        radius=24,
        fill=CARD_BG,
    )

    # Header
    font_brand = _get_font(18, bold=True)
    draw.text((50, 42), "SUWAPPU", fill=BRAND_PURPLE, font=font_brand)

    font_period = _get_font(14)
    period_text = f"{period_days}D P&L"
    draw.text((CARD_WIDTH - 120, 44), period_text, fill=LIGHT_GRAY, font=font_period)

    if username:
        font_user = _get_font(14)
        draw.text((180, 44), f"@{username}", fill=GRAY, font=font_user)

    # Separator
    draw.line([(50, 72), (CARD_WIDTH - 50, 72)], fill=LIGHT_GRAY, width=1)

    # Portfolio value
    font_label = _get_font(14)
    font_big = _get_font(42, bold=True)

    draw.text((50, 88), "PORTFOLIO VALUE", fill=GRAY, font=font_label)
    draw.text((50, 110), f"${total_value_usd:,.2f}", fill=WHITE, font=font_big)

    # PnL
    sign = "+" if is_profit else ""
    pnl_text = f"{sign}${abs(total_pnl_usd):,.2f}  ({sign}{pnl_percent:.1f}%)"
    font_pnl = _get_font(24, bold=True)
    draw.text((50, 170), pnl_text, fill=accent, font=font_pnl)

    # Stats row
    y_stats = 220
    font_stat_label = _get_font(12)
    font_stat_value = _get_font(20, bold=True)

    draw.text((50, y_stats), "TRADES", fill=GRAY, font=font_stat_label)
    draw.text((50, y_stats + 18), str(swap_count), fill=WHITE, font=font_stat_value)

    # Top holdings
    if top_holdings:
        y_hold = 280
        draw.text((50, y_hold), "TOP HOLDINGS", fill=GRAY, font=font_label)
        y_hold += 24

        font_hold = _get_font(16, bold=True)
        font_hold_val = _get_font(16)

        for i, (token, value) in enumerate(list(top_holdings.items())[:5]):
            if i >= 5:
                break
            x_pos = 50 + (i * 148)
            draw.text((x_pos, y_hold), token, fill=WHITE, font=font_hold)
            draw.text((x_pos, y_hold + 22), f"${value:,.0f}", fill=GRAY, font=font_hold_val)

    # Footer
    draw.line([(50, CARD_HEIGHT - 70), (CARD_WIDTH - 50, CARD_HEIGHT - 70)], fill=LIGHT_GRAY, width=1)
    font_footer = _get_font(14)
    draw.text((50, CARD_HEIGHT - 52), "Trade on Suwappu  |  t.me/suwappubot", fill=LIGHT_GRAY, font=font_footer)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    return buffer.getvalue()


def _format_price(price: float) -> str:
    """Format price for display."""
    if price >= 1000:
        return f"${price:,.0f}"
    elif price >= 1:
        return f"${price:.2f}"
    elif price >= 0.001:
        return f"${price:.4f}"
    elif price >= 0.000001:
        return f"${price:.6f}"
    else:
        return f"${price:.10f}"


def _format_amount(amount: float, token: str) -> str:
    """Format token amount for display."""
    if amount >= 1_000_000:
        return f"{amount/1_000_000:.1f}M"
    elif amount >= 1_000:
        return f"{amount/1_000:.1f}K"
    elif amount >= 1:
        return f"{amount:.2f}"
    else:
        return f"{amount:.6f}"
