"""Public terminal data endpoints used by terminal.suwappu.bot."""

from __future__ import annotations

from datetime import datetime

import httpx
from fastapi import APIRouter, Query

router = APIRouter(prefix="/terminal", tags=["terminal"])

COINBASE_BASE_URL = "https://api.exchange.coinbase.com"
COINBASE_PRODUCT = "ETH-USD"
ETH_NATIVE_ADDRESSES = {
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "0x0000000000000000000000000000000000000000",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
}
GRANULARITY_MAP = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1D": 86400,
    "1d": 86400,
}


async def _coinbase_get(path: str, params: dict | None = None) -> list | dict:
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(
            f"{COINBASE_BASE_URL}{path}",
            params=params,
            headers={"User-Agent": "suwappu-terminal/1.0"},
        )
        response.raise_for_status()
        return response.json()


def _is_eth_usdc_chart(pair: str, chain: str) -> bool:
    return chain.lower() == "ethereum" and pair.lower() in ETH_NATIVE_ADDRESSES


def _levels_with_totals(levels: list[list[str]], depth: int) -> list[dict]:
    total = 0.0
    parsed = []
    for level in levels[:depth]:
        price_raw, size_raw = level[0], level[1]
        price = float(price_raw)
        size = float(size_raw)
        total += size
        parsed.append({
            "price": price,
            "size": size,
            "total": total,
        })
    return parsed


@router.get("/chart/ohlcv")
async def get_terminal_ohlcv(
    pair: str = Query(...),
    chain: str = Query(default="ethereum"),
    interval: str = Query(default="1h"),
    limit: int = Query(default=300, ge=1, le=500),
):
    """Return real OHLCV candles for the default ETH/USDC terminal market."""
    if not _is_eth_usdc_chart(pair, chain):
        return []

    granularity = GRANULARITY_MAP.get(interval, 3600)
    try:
        candles = await _coinbase_get(f"/products/{COINBASE_PRODUCT}/candles", {"granularity": granularity})
    except Exception:
        return []

    return [
        {
            "time": int(candle[0]),
            "open": float(candle[3]),
            "high": float(candle[2]),
            "low": float(candle[1]),
            "close": float(candle[4]),
            "volume": float(candle[5]),
        }
        for candle in reversed(candles[:limit])
    ]


@router.get("/orderbook")
async def get_terminal_orderbook(
    symbol: str = Query(default="ETHUSDC"),
    depth: int = Query(default=15, ge=1, le=50),
):
    """Return real ETH/USD depth for the default ETH/USDC terminal market."""
    if symbol.upper() not in {"ETHUSDC", "ETH-USD"}:
        return {"bids": [], "asks": [], "spread": 0, "spreadPercent": 0, "midPrice": 0}

    try:
        book = await _coinbase_get(f"/products/{COINBASE_PRODUCT}/book", {"level": 2})
    except Exception:
        return {"bids": [], "asks": [], "spread": 0, "spreadPercent": 0, "midPrice": 0}

    bids = _levels_with_totals(book.get("bids", []), depth)
    asks = _levels_with_totals(book.get("asks", []), depth)
    if not bids or not asks:
        return {"bids": [], "asks": [], "spread": 0, "spreadPercent": 0, "midPrice": 0}

    best_bid = bids[0]["price"]
    best_ask = asks[0]["price"]
    mid_price = (best_bid + best_ask) / 2
    spread = best_ask - best_bid
    return {
        "bids": bids,
        "asks": asks,
        "spread": spread,
        "spreadPercent": (spread / mid_price) * 100 if mid_price else 0,
        "midPrice": mid_price,
    }


@router.get("/trades")
async def get_terminal_trades(
    symbol: str = Query(default="ETHUSDC"),
    limit: int = Query(default=50, ge=1, le=100),
):
    """Return real recent ETH/USD trades for the default ETH/USDC terminal market."""
    if symbol.upper() not in {"ETHUSDC", "ETH-USD"}:
        return []

    try:
        trades = await _coinbase_get(f"/products/{COINBASE_PRODUCT}/trades", {"limit": limit})
    except Exception:
        return []

    return [
        {
            "id": str(trade["trade_id"]),
            "price": float(trade["price"]),
            "size": float(trade["size"]),
            "side": trade["side"],
            "time": int(datetime.fromisoformat(trade["time"].replace("Z", "+00:00")).timestamp() * 1000),
        }
        for trade in trades
    ]
