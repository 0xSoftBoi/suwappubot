"""Public terminal data endpoints used by terminal.suwappu.bot."""

from __future__ import annotations

from fastapi import APIRouter, Query

router = APIRouter(prefix="/terminal", tags=["terminal"])


@router.get("/chart/ohlcv")
async def get_terminal_ohlcv(
    pair: str = Query(...),
    chain: str = Query(default="ethereum"),
    interval: str = Query(default="1h"),
    limit: int = Query(default=300, ge=1, le=500),
):
    """Return OHLCV candles when a real market data provider is connected."""
    _ = (pair, chain, interval, limit)
    return []
