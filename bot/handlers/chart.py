"""/chart command — candlestick chart rendered from bot/models/market_data.py.

`/chart <SYMBOL> [timeframe]` e.g. `/chart ETH 1h`. Loads up to the last 60
candles for (symbol, best-covered chain) from market_candles (populated by
bot/services/market_data.py) and renders a PNG via bot/utils/chart_render.py
(pure Pillow, unit-tested separately).
"""

import logging
from io import BytesIO

from sqlalchemy import func
from telegram import Update
from telegram.ext import ContextTypes, CommandHandler

from bot.models.market_data import MarketCandle
from bot.utils.chart_render import render_candlestick_png
from bot.utils.formatters import format_usd
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)

ALLOWED_TIMEFRAMES = {"1m", "5m", "1h", "1d"}
DEFAULT_TIMEFRAME = "1h"
MAX_CANDLES = 60


@enforce_tos
async def chart_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /chart <SYMBOL> [timeframe]."""
    args = context.args or []

    if not args:
        await update.message.reply_text(
            "📈 *Usage:* `/chart <SYMBOL> [timeframe]`\n"
            "Example: `/chart ETH 1h`\n\n"
            f"Timeframes: {', '.join(sorted(ALLOWED_TIMEFRAMES))} (default `{DEFAULT_TIMEFRAME}`)",
            parse_mode="Markdown",
        )
        return

    symbol = args[0].strip().upper()
    timeframe = DEFAULT_TIMEFRAME
    if len(args) > 1:
        requested_tf = args[1].strip().lower()
        if requested_tf not in ALLOWED_TIMEFRAMES:
            await update.message.reply_text(
                f"❌ Invalid timeframe `{requested_tf}`. Choose one of: "
                f"{', '.join(sorted(ALLOWED_TIMEFRAMES))}",
                parse_mode="Markdown",
            )
            return
        timeframe = requested_tf

    with get_session() as session:
        # Prefer the chain with the most candle rows for this symbol/timeframe.
        chain_row = (
            session.query(MarketCandle.chain, func.count(MarketCandle.id).label("n"))
            .filter(MarketCandle.symbol == symbol, MarketCandle.timeframe == timeframe)
            .group_by(MarketCandle.chain)
            .order_by(func.count(MarketCandle.id).desc())
            .first()
        )

        if not chain_row:
            # No data for this symbol/timeframe — suggest a few symbols that
            # DO have data, via one cheap DISTINCT query.
            available = (
                session.query(MarketCandle.symbol)
                .distinct()
                .order_by(MarketCandle.symbol.asc())
                .limit(5)
                .all()
            )
            suggestions = ", ".join(f"`{s[0]}`" for s in available)
            if suggestions:
                await update.message.reply_text(
                    f"📉 No chart data yet for *{symbol}* ({timeframe}).\n\n"
                    f"Symbols with data right now: {suggestions}",
                    parse_mode="Markdown",
                )
            else:
                await update.message.reply_text(
                    f"📉 No chart data yet for *{symbol}* — market data capture "
                    "hasn't collected any candles yet. Try again shortly.",
                    parse_mode="Markdown",
                )
            return

        chain = chain_row[0]

        rows = (
            session.query(MarketCandle)
            .filter(
                MarketCandle.symbol == symbol,
                MarketCandle.chain == chain,
                MarketCandle.timeframe == timeframe,
            )
            .order_by(MarketCandle.ts.desc())
            .limit(MAX_CANDLES)
            .all()
        )

        # Snapshot into plain dicts before leaving the session (avoid
        # detached-instance access below, same pattern as balance.py).
        candles = [
            {
                "ts": r.ts,
                "open": float(r.open),
                "high": float(r.high),
                "low": float(r.low),
                "close": float(r.close),
                "source": r.source,
            }
            for r in reversed(rows)  # ascending order for the renderer
        ]

    if not candles:
        await update.message.reply_text(
            f"📉 No chart data yet for *{symbol}* ({timeframe}).", parse_mode="Markdown"
        )
        return

    png_bytes = render_candlestick_png(candles, symbol, timeframe)
    if png_bytes is None:
        await update.message.reply_text("❌ Couldn't render that chart. Please try again later.")
        return

    first_price = candles[0]["open"]
    last_price = candles[-1]["close"]
    change_pct = ((last_price - first_price) / first_price * 100) if first_price else 0.0
    change_sign = "🟢" if change_pct >= 0 else "🔴"
    source = candles[-1].get("source") or "market data"

    caption = (
        f"📈 *{symbol}/USD* · `{timeframe}` · {chain}\n"
        f"Last: {format_usd(last_price)}\n"
        f"{change_sign} Change over window: {change_pct:+.2f}%\n"
        f"Candles: {len(candles)} · Source: {source}"
    )

    await update.message.reply_photo(
        photo=BytesIO(png_bytes),
        caption=caption,
        parse_mode="Markdown",
    )


# Create handler
chart_handler = CommandHandler("chart", chart_command)
