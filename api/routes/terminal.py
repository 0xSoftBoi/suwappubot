"""Public terminal data endpoints used by terminal.suwappu.bot."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/terminal", tags=["terminal"])

# Log route registration for debugging production issues.
_route_count_at_init = len(router.routes)
logger.info(f"Terminal router initialized with {_route_count_at_init} routes")

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


# Chains whose native coin *is* ETH. Native ETH on Base/Arbitrum/Optimism is the
# same asset as on mainnet, so the desk keeps the CEX-grade Coinbase ETH-USD
# candles instead of hunting for a per-chain pool (which failed and blanked
# the chart the moment a trader switched chains).
def _eth_native_chains() -> set:
    chains = {"ethereum", "eth"}
    try:
        from bot.config.chains import CHAINS

        for name, cfg in CHAINS.items():
            if str(getattr(cfg, "native_token", "")).upper() == "ETH":
                chains.add(str(name).lower())
    except Exception:
        chains.update({"arbitrum", "base", "optimism", "linea", "zksync", "scroll", "blast"})
    return chains


ETH_NATIVE_CHAINS = _eth_native_chains()


def _is_eth_usdc_chart(pair: str, chain: str) -> bool:
    return chain.lower() in ETH_NATIVE_CHAINS and pair.lower() in ETH_NATIVE_ADDRESSES


# --- Per-token charts via GeckoTerminal pool OHLCV (any token, not just ETH/USDC) ---

# Suwappu chain name -> GeckoTerminal network id. Covers 44 of the 45 chains in
# bot/config/chains.py (verified live against GeckoTerminal's network list on
# 2026-08-13). `worldchain` is NOT on GeckoTerminal and is deliberately omitted.
GECKO_NETWORK = {
    "ethereum": "eth",
    "eth": "eth",
    "base": "base",
    "arbitrum": "arbitrum",
    "arbitrum_one": "arbitrum",
    "optimism": "optimism",
    "op": "optimism",
    "polygon": "polygon_pos",
    "polygon_pos": "polygon_pos",
    "bsc": "bsc",
    "bnb": "bsc",
    "avalanche": "avax",
    "avax": "avax",
    "solana": "solana",
    "sol": "solana",
    # Exact id matches on GeckoTerminal.
    "abstract": "abstract",
    "apechain": "apechain",
    "aurora": "aurora",
    "berachain": "berachain",
    "blast": "blast",
    "citrea": "citrea",
    "flare": "flare",
    "fraxtal": "fraxtal",
    "goat": "goat",
    "hemi": "hemi",
    "hyperevm": "hyperevm",
    "ink": "ink",
    "kaia": "kaia",
    "linea": "linea",
    "lisk": "lisk",
    "mantle": "mantle",
    "mode": "mode",
    "opbnb": "opbnb",
    "plasma": "plasma",
    "robinhood": "robinhood",
    "rootstock": "rootstock",
    "scroll": "scroll",
    "soneium": "soneium",
    "sonic": "sonic",
    "swellchain": "swellchain",
    "taiko": "taiko",
    "tempo": "tempo",
    "tron": "tron",
    "unichain": "unichain",
    "zksync": "zksync",
    # Aliases: Suwappu chain name differs from the GeckoTerminal network id.
    "bob": "bob-network",
    "fantom": "ftm",
    "flow": "flow-evm",
    "gnosis": "xdai",
    "sei": "sei-evm",
    "starknet": "starknet-alpha",
}
# GeckoTerminal network -> DexScreener chainId. ONLY populated where verified
# live (resolved a real token per network via GeckoTerminal's top-pools
# endpoint, then confirmed the same chainId came back from DexScreener's
# `/latest/dex/tokens/<addr>`). Networks not listed here are deliberately left
# unmapped — see the fail-closed comment in `_resolve_pool` for why guessing
# is unsafe (e.g. an `ink` token resolves to pairs on base/ink/optimism/
# soneium/unichain; picking the wrong one charts the wrong asset).
DEXSCREENER_CHAIN = {
    "eth": "ethereum",
    "base": "base",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "polygon_pos": "polygon",
    "bsc": "bsc",
    "avax": "avalanche",
    "solana": "solana",
    "abstract": "abstract",
    "apechain": "apechain",
    "berachain": "berachain",
    "blast": "blast",
    "flare": "flare",
    "flow-evm": "flowevm",
    "ftm": "fantom",
    "hyperevm": "hyperevm",
    "ink": "ink",
    "linea": "linea",
    "mantle": "mantle",
    "opbnb": "opbnb",
    "robinhood": "robinhood",
    "scroll": "scroll",
    "sei-evm": "seiv2",
    "soneium": "soneium",
    "sonic": "sonic",
    "starknet-alpha": "starknet",
    "tron": "tron",
    "unichain": "unichain",
    "zksync": "zksync",
}
# interval -> (GeckoTerminal timeframe, aggregate)
GECKO_TIMEFRAME = {
    "1m": ("minute", 1),
    "5m": ("minute", 5),
    "15m": ("minute", 15),
    "1h": ("hour", 1),
    "4h": ("hour", 4),
    "1D": ("day", 1),
    "1d": ("day", 1),
}


async def _resolve_pool(token_address: str, network: str) -> str | None:
    """Find the highest-liquidity pool for a token on a chain via DexScreener.

    Fails CLOSED: a token address is not unique across chains (DexScreener
    returns pairs for every chain that happens to have a token at that
    address — e.g. an `ink`-network token resolves to pairs on base/ink/
    optimism/soneium/unichain). Without a verified DEXSCREENER_CHAIN entry we
    cannot filter down to the right chain, so `max(pairs, key=liquidity)`
    could silently pick the highest-liquidity pool on a DIFFERENT chain and
    chart the wrong asset. Returning None (no chart) is the safe outcome;
    guessing a chainId is not.
    """
    ds_chain = DEXSCREENER_CHAIN.get(network)
    if not ds_chain:
        return None
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                f"https://api.dexscreener.com/latest/dex/tokens/{token_address}",
                headers={"User-Agent": "suwappu-terminal/1.0"},
            )
            resp.raise_for_status()
            pairs = resp.json().get("pairs") or []
    except Exception:
        return None
    pairs = [p for p in pairs if (p.get("chainId") or "").lower() == ds_chain]
    if not pairs:
        return None
    best = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
    return best.get("pairAddress")


# --- Simple in-process TTL caches (same pattern as `_leaderboard_cache` below).
# Bounded size + explicit TTLs so a burst of distinct tokens/intervals can't
# grow these unboundedly, and so we don't blow through GeckoTerminal's ~30
# req/min free-tier limit on repeat chart loads.
_POOL_CACHE_TTL_SECONDS = 3600  # a token's best pool rarely changes within an hour
_POOL_NEG_CACHE_TTL_SECONDS = 60  # transient upstream failure -> retry soon
_POOL_CACHE_MAX_ENTRIES = 2000
_pool_cache: dict[tuple[str, str], tuple[float, str | None]] = {}

_OHLCV_CACHE_MAX_ENTRIES = 2000
# interval -> candle cache TTL. Minute candles move fast (short TTL); hour+
# candles barely change within a few minutes (longer TTL is safe and cuts
# GeckoTerminal calls the most for the default 1h/1D chart views).
_OHLCV_CACHE_TTL_SECONDS = {
    "1m": 30,
    "5m": 30,
    "15m": 60,
    "1h": 120,
    "4h": 180,
    "1D": 300,
    "1d": 300,
}
_ohlcv_cache: dict[tuple[str, str, str, int], tuple[float, list[dict]]] = {}


_CACHE_MISS = object()


def _cache_get(cache: dict, key):
    """Returns the cached value, or the `_CACHE_MISS` sentinel on a miss/expiry
    (distinct from `None`, which is itself a valid cached value here — e.g. a
    token with no resolvable pool)."""
    entry = cache.get(key)
    if not entry:
        return _CACHE_MISS
    expires_at, value = entry
    if time.monotonic() >= expires_at:
        return _CACHE_MISS
    return value


def _cache_set(cache: dict, key, value, max_entries: int, ttl: float) -> None:
    if len(cache) >= max_entries:
        # Cheap bound: drop an arbitrary (oldest-inserted, dict-ordered) entry
        # rather than tracking LRU order for this simple TTL cache.
        cache.pop(next(iter(cache)), None)
    cache[key] = (time.monotonic() + ttl, value)


async def _resolve_pool_cached(token_address: str, network: str) -> str | None:
    key = (token_address.lower(), network)
    cached = _cache_get(_pool_cache, key)
    if cached is not _CACHE_MISS:
        return cached
    pool = await _resolve_pool(token_address, network)
    # `_resolve_pool` returns None both for "no pool exists" AND for a transient
    # DexScreener failure, which it swallows. Caching that for the full hour
    # would let one upstream blip blank the chart for 60 minutes, so negative
    # results get a much shorter TTL and retry soon.
    ttl = _POOL_CACHE_TTL_SECONDS if pool else _POOL_NEG_CACHE_TTL_SECONDS
    _cache_set(_pool_cache, key, pool, _POOL_CACHE_MAX_ENTRIES, ttl)
    return pool


async def _gecko_ohlcv(network: str, pool: str, interval: str, limit: int) -> list[dict]:
    timeframe, aggregate = GECKO_TIMEFRAME.get(interval, ("hour", 1))
    url = f"https://api.geckoterminal.com/api/v2/networks/{network}/pools/{pool}/ohlcv/{timeframe}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                url,
                params={"aggregate": aggregate, "limit": min(limit, 1000)},
                headers={"User-Agent": "suwappu-terminal/1.0", "Accept": "application/json"},
            )
            resp.raise_for_status()
            ohlcv = (resp.json().get("data") or {}).get("attributes", {}).get("ohlcv_list") or []
    except Exception:
        return []
    # GeckoTerminal returns newest-first [ts, o, h, l, c, v]; chart wants oldest-first.
    candles = [
        {
            "time": int(c[0]),
            "open": float(c[1]),
            "high": float(c[2]),
            "low": float(c[3]),
            "close": float(c[4]),
            "volume": float(c[5]),
        }
        for c in ohlcv
        if c and len(c) >= 6
    ]
    candles.sort(key=lambda c: c["time"])
    return candles[-limit:]


async def _gecko_ohlcv_cached(network: str, pool: str, interval: str, limit: int) -> list[dict]:
    key = (network, pool, interval, limit)
    ttl = _OHLCV_CACHE_TTL_SECONDS.get(interval, 120)
    cached = _cache_get(_ohlcv_cache, key)
    if cached is not _CACHE_MISS:
        return cached
    candles = await _gecko_ohlcv(network, pool, interval, limit)
    _cache_set(_ohlcv_cache, key, candles, _OHLCV_CACHE_MAX_ENTRIES, ttl)
    return candles


def _levels_with_totals(levels: list[list[str]], depth: int) -> list[dict]:
    total = 0.0
    parsed = []
    for level in levels[:depth]:
        price_raw, size_raw = level[0], level[1]
        price = float(price_raw)
        size = float(size_raw)
        total += size
        parsed.append(
            {
                "price": price,
                "size": size,
                "total": total,
            }
        )
    return parsed


@router.get("/chart/ohlcv")
async def get_terminal_ohlcv(
    pair: str = Query(...),
    chain: str = Query(default="ethereum"),
    interval: str = Query(default="1h"),
    limit: int = Query(default=300, ge=1, le=500),
):
    """Return OHLCV candles. ETH/USDC uses Coinbase (CEX-grade); any other token
    uses GeckoTerminal pool OHLCV (pool resolved via DexScreener)."""
    # ETH/USDC: keep the high-quality Coinbase feed.
    if _is_eth_usdc_chart(pair, chain):
        granularity = GRANULARITY_MAP.get(interval, 3600)
        try:
            candles = await _coinbase_get(
                f"/products/{COINBASE_PRODUCT}/candles", {"granularity": granularity}
            )
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

    # Any other token: GeckoTerminal pool OHLCV (both steps cached — see
    # `_resolve_pool_cached` / `_gecko_ohlcv_cached` above).
    network = GECKO_NETWORK.get(chain.lower())
    if not network:
        return []
    pool = await _resolve_pool_cached(pair, network)
    if not pool:
        return []
    return await _gecko_ohlcv_cached(network, pool, interval, limit)


# --- Perps candles via the public HyperLiquid candleSnapshot API ---

HL_INFO_URL = "https://api.hyperliquid.xyz/info"
# Frontend chart-toolbar interval id -> (HyperLiquid interval, step in ms).
HL_INTERVALS = {
    "1m": ("1m", 60_000),
    "5m": ("5m", 300_000),
    "15m": ("15m", 900_000),
    "1h": ("1h", 3_600_000),
    "4h": ("4h", 14_400_000),
    "1D": ("1d", 86_400_000),
    "1d": ("1d", 86_400_000),
}


@router.get("/perps/candles")
async def get_terminal_perps_candles(
    coin: str = Query(...),
    interval: str = Query(default="1h"),
    limit: int = Query(default=300, ge=1, le=500),
):
    """OHLCV candles for a HyperLiquid perp via the public candleSnapshot API.
    `coin` is the HL asset symbol (ETH, BTC, …); ``ETH-USD`` / ``ETH/USD`` are
    accepted and reduced to the bare asset."""
    asset = coin.upper().split("-")[0].split("/")[0].strip()
    if not asset:
        return []
    hl_interval, step_ms = HL_INTERVALS.get(interval, ("1h", 3_600_000))
    end_ms = int(datetime.now().timestamp() * 1000)
    start_ms = end_ms - step_ms * min(limit, 500)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                HL_INFO_URL,
                json={
                    "type": "candleSnapshot",
                    "req": {
                        "coin": asset,
                        "interval": hl_interval,
                        "startTime": start_ms,
                        "endTime": end_ms,
                    },
                },
                headers={"User-Agent": "suwappu-terminal/1.0", "Accept": "application/json"},
            )
            resp.raise_for_status()
            raw = resp.json() or []
    except Exception:
        return []
    candles = [
        {
            "time": int(c["t"]) // 1000,  # HL open time is ms epoch; chart wants seconds
            "open": float(c["o"]),
            "high": float(c["h"]),
            "low": float(c["l"]),
            "close": float(c["c"]),
            "volume": float(c.get("v") or 0),
        }
        for c in raw
        if isinstance(c, dict) and c.get("t") is not None
    ]
    candles.sort(key=lambda c: c["time"])
    return candles[-limit:]


def _hl_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@router.get("/perps/context")
async def get_terminal_perps_context():
    """Per-market intelligence for the HyperLiquid perps desk via the public
    ``metaAndAssetCtxs`` endpoint — mark/oracle price, spot-perp basis, hourly
    funding, open interest (notional), 24h volume and 24h change. All free, no
    key. Returned newest-data-first by open interest so the heaviest markets lead."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                HL_INFO_URL,
                json={"type": "metaAndAssetCtxs"},
                headers={"User-Agent": "suwappu-terminal/1.0", "Accept": "application/json"},
            )
            resp.raise_for_status()
            payload = resp.json() or []
    except Exception:
        return []
    if not isinstance(payload, list) or len(payload) < 2:
        return []
    universe = (payload[0] or {}).get("universe") or []
    ctxs = payload[1] or []
    out = []
    for meta, ctx in zip(universe, ctxs):
        if not isinstance(meta, dict) or not isinstance(ctx, dict):
            continue
        asset = meta.get("name")
        if not asset:
            continue
        mark = _hl_float(ctx.get("markPx"))
        oracle = _hl_float(ctx.get("oraclePx"))
        prev = _hl_float(ctx.get("prevDayPx"))
        oi_coin = _hl_float(ctx.get("openInterest"))
        out.append(
            {
                "asset": asset,
                "name": f"{asset}-USD",
                "markPrice": mark,
                "oraclePrice": oracle,
                # premium is the spot-perp basis as a decimal; expose as a percent.
                "basisPct": _hl_float(ctx.get("premium")) * 100,
                # hourly funding rate as a decimal (e.g. 0.0000125 == 0.00125%/hr).
                "funding": _hl_float(ctx.get("funding")),
                # open interest in USD notional (HL reports it in coin units).
                "oiNotional": oi_coin * mark,
                # 24h notional (USD) traded volume.
                "dayVolume": _hl_float(ctx.get("dayNtlVlm")),
                # 24h price change vs the prior-day reference price, in percent.
                "dayChangePct": ((mark - prev) / prev * 100) if prev else 0.0,
                "maxLeverage": meta.get("maxLeverage") or 0,
            }
        )
    out.sort(key=lambda m: m["oiNotional"], reverse=True)
    return out


# --- Smart-money / whale positioning, reconstructed from public HL positions ---
# Only possible because HyperLiquid is on-chain: every trader's open positions
# (with the exchange-computed liquidation price) are public. We take the top
# accounts off the leaderboard, read their live positions for a coin, and
# aggregate long-vs-short — the contrarian/confirmation signal Coinglass-style
# tools charge for, here free and exchange-native.

HL_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
_leaderboard_cache: dict = {"at": None, "addresses": []}


async def _hl_post(client: httpx.AsyncClient, body: dict):
    resp = await client.post(
        HL_INFO_URL,
        json=body,
        headers={"User-Agent": "suwappu-terminal/1.0", "Accept": "application/json"},
    )
    resp.raise_for_status()
    return resp.json()


async def _top_leaderboard_addresses(limit: int) -> list[str]:
    """Top accounts by equity from the HL leaderboard, cached ~10 min (the feed
    is multi-MB and slow-moving)."""
    cached_at = _leaderboard_cache["at"]
    if cached_at and (datetime.now() - cached_at).total_seconds() < 600:
        return _leaderboard_cache["addresses"][:limit]
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                HL_LEADERBOARD_URL, headers={"User-Agent": "suwappu-terminal/1.0"}
            )
            resp.raise_for_status()
            rows = (resp.json() or {}).get("leaderboardRows") or []
    except Exception:
        return _leaderboard_cache["addresses"][:limit]
    ranked = sorted(
        ((r.get("ethAddress"), _to_float(r.get("accountValue"), 0.0) or 0.0) for r in rows),
        key=lambda x: x[1],
        reverse=True,
    )
    addresses = [a for a, _ in ranked if a][:200]
    _leaderboard_cache["at"] = datetime.now()
    _leaderboard_cache["addresses"] = addresses
    return addresses[:limit]


@router.get("/perps/whales")
async def get_terminal_perps_whales(
    coin: str = Query(...),
    sample: int = Query(default=60, ge=10, le=120),
):
    """Smart-money positioning for a HyperLiquid perp: sample the top accounts'
    live positions in `coin`, aggregate long-vs-short notional, and surface the
    biggest individual whale positions (size, leverage, entry, exchange-computed
    liquidation price, unrealized PnL). Public on-chain data only."""
    asset = coin.upper().split("-")[0].split("/")[0].strip()
    if not asset:
        return _empty_whales(coin)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            meta_ctx = await _hl_post(client, {"type": "metaAndAssetCtxs"})
            universe = (meta_ctx[0] or {}).get("universe") or []
            ctxs = meta_ctx[1] or []
            mark = 0.0
            for u, c in zip(universe, ctxs):
                if u.get("name") == asset:
                    mark = _hl_float(c.get("markPx"))
                    break

            addresses = await _top_leaderboard_addresses(sample)
            if not addresses:
                return _empty_whales(coin, mark)

            sem = asyncio.Semaphore(16)

            async def fetch_state(addr: str):
                async with sem:
                    try:
                        return addr, await _hl_post(
                            client, {"type": "clearinghouseState", "user": addr}
                        )
                    except Exception:
                        return addr, None

            states = await asyncio.gather(*(fetch_state(a) for a in addresses))
    except Exception:
        return _empty_whales(coin)

    long_notional = short_notional = 0.0
    long_count = short_count = 0
    positions: list[dict] = []
    for addr, state in states:
        if not isinstance(state, dict):
            continue
        for ap in state.get("assetPositions") or []:
            p = ap.get("position") or {}
            if p.get("coin") != asset:
                continue
            szi = _hl_float(p.get("szi"))
            if szi == 0:
                continue
            size = abs(szi)
            notional = size * mark
            side = "long" if szi > 0 else "short"
            if side == "long":
                long_notional += notional
                long_count += 1
            else:
                short_notional += notional
                short_count += 1
            lev = p.get("leverage") or {}
            positions.append(
                {
                    "address": f"{addr[:6]}…{addr[-4:]}",
                    "side": side,
                    "size": size,
                    "notional": notional,
                    "leverage": _to_float(lev.get("value")) or 0,
                    "entryPrice": _hl_float(p.get("entryPx")),
                    "liquidationPrice": _hl_float(p.get("liquidationPx")) or None,
                    "unrealizedPnl": _hl_float(p.get("unrealizedPnl")),
                }
            )

    positions.sort(key=lambda x: x["notional"], reverse=True)
    total = long_notional + short_notional
    return {
        "coin": f"{asset}-USD",
        "markPrice": mark,
        "sampled": len(addresses),
        "longNotional": long_notional,
        "shortNotional": short_notional,
        "longCount": long_count,
        "shortCount": short_count,
        "longPct": round(long_notional / total * 100, 1) if total else 50.0,
        # "Squeeze fuel": short notional whose liq price sits above mark (gets
        # squeezed on a rip); downside = long notional liquidating below mark.
        "shortLiqAboveNotional": sum(
            p["notional"]
            for p in positions
            if p["side"] == "short" and p["liquidationPrice"] and p["liquidationPrice"] > mark
        ),
        "longLiqBelowNotional": sum(
            p["notional"]
            for p in positions
            if p["side"] == "long" and p["liquidationPrice"] and p["liquidationPrice"] < mark
        ),
        "positions": positions[:14],
    }


def _empty_whales(coin: str, mark: float = 0.0) -> dict:
    asset = coin.upper().split("-")[0].split("/")[0].strip()
    return {
        "coin": f"{asset}-USD",
        "markPrice": mark,
        "sampled": 0,
        "longNotional": 0.0,
        "shortNotional": 0.0,
        "longCount": 0,
        "shortCount": 0,
        "longPct": 50.0,
        "shortLiqAboveNotional": 0.0,
        "longLiqBelowNotional": 0.0,
        "positions": [],
    }


# --- Prediction probability history via the public Polymarket CLOB API ---

POLYMARKET_CLOB_URL = "https://clob.polymarket.com"
# Range button id -> (Polymarket interval window, fidelity in minutes).
POLY_HISTORY_RANGES = {
    "1H": ("1h", 1),
    "6H": ("6h", 5),
    "1D": ("1d", 15),
    "1W": ("1w", 60),
    "1M": ("1m", 180),
    "ALL": ("max", 720),
}


@router.get("/predict/history")
async def get_terminal_predict_history(
    tokenId: str = Query(...),
    range: str = Query(default="1W"),
):
    """Probability history for a single Polymarket outcome (CLOB token id).
    Returns line points ``{time, value}`` where value is the % probability."""
    poly_interval, fidelity = POLY_HISTORY_RANGES.get(range.upper(), ("1w", 60))
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{POLYMARKET_CLOB_URL}/prices-history",
                params={"market": tokenId, "interval": poly_interval, "fidelity": fidelity},
                headers={"User-Agent": "suwappu-terminal/1.0", "Accept": "application/json"},
            )
            resp.raise_for_status()
            history = (resp.json() or {}).get("history") or []
    except Exception:
        return []
    points = [
        {"time": int(p["t"]), "value": round(float(p["p"]) * 100, 2)}
        for p in history
        if isinstance(p, dict) and p.get("t") is not None and p.get("p") is not None
    ]
    points.sort(key=lambda p: p["time"])
    return points


# --- Market regime strip: Fear&Greed + dominance/mcap + stablecoin supply ---

FNG_URL = "https://api.alternative.me/fng/"
COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global"
DEFILLAMA_STABLES_URL = "https://stablecoins.llama.fi/stablecoins"


async def _get_json(client: httpx.AsyncClient, url: str, params: dict | None = None):
    resp = await client.get(
        url,
        params=params,
        headers={"User-Agent": "suwappu-terminal/1.0", "Accept": "application/json"},
    )
    resp.raise_for_status()
    return resp.json()


@router.get("/market/regime")
async def get_terminal_market_regime():
    """Always-on macro context for the terminal header: crypto Fear & Greed
    (alternative.me), BTC dominance + total market cap + 24h change
    (CoinGecko), and total stablecoin supply / "dry powder" (DefiLlama). All
    public + free; any source that fails is returned null so the UI degrades
    gracefully tile-by-tile."""
    async with httpx.AsyncClient(timeout=8.0) as client:
        fng_raw, global_raw, stables_raw = await asyncio.gather(
            _get_json(client, FNG_URL),
            _get_json(client, COINGECKO_GLOBAL_URL),
            _get_json(client, DEFILLAMA_STABLES_URL, {"includePrices": "false"}),
            return_exceptions=True,
        )

    fear_greed = None
    if isinstance(fng_raw, dict):
        entry = (fng_raw.get("data") or [{}])[0]
        if entry.get("value") is not None:
            fear_greed = {
                "value": _to_int(entry.get("value")),
                "label": entry.get("value_classification") or "",
            }

    btc_dominance = total_mcap = mcap_change_24h = None
    if isinstance(global_raw, dict):
        g = global_raw.get("data") or {}
        btc_dominance = _to_float((g.get("market_cap_percentage") or {}).get("btc"))
        total_mcap = _to_float((g.get("total_market_cap") or {}).get("usd"))
        mcap_change_24h = _to_float(g.get("market_cap_change_percentage_24h_usd"))

    stablecoin_mcap = None
    if isinstance(stables_raw, dict):
        assets = stables_raw.get("peggedAssets") or []
        total = 0.0
        for a in assets:
            total += _to_float((a.get("circulating") or {}).get("peggedUSD")) or 0.0
        stablecoin_mcap = total or None

    return {
        "fearGreed": fear_greed,
        "btcDominance": btc_dominance,
        "totalMcap": total_mcap,
        "mcapChange24h": mcap_change_24h,
        "stablecoinMcap": stablecoin_mcap,
    }


def _to_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# --- Cross-market Signals scanner: "what matters right now" across HL perps ---

# Ignore illiquid markets so signals come from real, tradeable size.
SIGNAL_MIN_OI = 5_000_000  # $5M open interest


def _signal(
    category: str, severity: str, emoji: str, title: str, detail: str, market: str = ""
) -> dict:
    # severity: alert | warn | info
    return {
        "id": f"{category}:{market or title}",
        "category": category,
        "severity": severity,
        "emoji": emoji,
        "title": title,
        "detail": detail,
        "market": market,
    }


@router.get("/signals")
async def get_terminal_signals():
    """A live cross-market signal feed derived from HyperLiquid's all-markets
    feed + macro regime — top movers, funding extremes, squeeze setups, and the
    Fear & Greed regime. One scan, plain-language cards, ranked by urgency."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            meta_ctx, fng_raw = await asyncio.gather(
                _hl_post(client, {"type": "metaAndAssetCtxs"}),
                _get_json(client, FNG_URL),
                return_exceptions=True,
            )
    except Exception:
        return []

    signals: list[dict] = []

    # Regime card from Fear & Greed.
    if isinstance(fng_raw, dict):
        entry = (fng_raw.get("data") or [{}])[0]
        val = _to_int(entry.get("value"))
        if val is not None:
            label = entry.get("value_classification") or ""
            if val <= 24:
                signals.append(
                    _signal(
                        "regime",
                        "alert",
                        "😱",
                        f"Extreme Fear ({val})",
                        "Market sentiment is capitulating — historically a contrarian buy zone.",
                    )
                )
            elif val >= 76:
                signals.append(
                    _signal(
                        "regime",
                        "alert",
                        "🤑",
                        f"Extreme Greed ({val})",
                        "Sentiment is euphoric — historically a zone to de-risk.",
                    )
                )
            else:
                signals.append(
                    _signal(
                        "regime",
                        "info",
                        "🌡️",
                        f"Fear & Greed: {label} ({val})",
                        "Overall crypto risk appetite right now.",
                    )
                )

    # Per-market signals from metaAndAssetCtxs.
    markets = []
    if isinstance(meta_ctx, list) and len(meta_ctx) >= 2:
        universe = (meta_ctx[0] or {}).get("universe") or []
        ctxs = meta_ctx[1] or []
        for u, c in zip(universe, ctxs):
            if not isinstance(u, dict) or not isinstance(c, dict):
                continue
            asset = u.get("name")
            mark = _hl_float(c.get("markPx"))
            prev = _hl_float(c.get("prevDayPx"))
            oi = _hl_float(c.get("openInterest")) * mark
            if not asset or mark <= 0 or oi < SIGNAL_MIN_OI:
                continue
            markets.append(
                {
                    "asset": asset,
                    "market": f"{asset}-USD",
                    "change": ((mark - prev) / prev * 100) if prev else 0.0,
                    "funding": _hl_float(c.get("funding")),
                    "oi": oi,
                }
            )

    if markets:
        # Top movers (24h).
        by_change = sorted(markets, key=lambda m: m["change"], reverse=True)
        for m in by_change[:2]:
            if m["change"] > 2:
                signals.append(
                    _signal(
                        "mover",
                        "info",
                        "🚀",
                        f"{m['asset']} +{m['change']:.1f}% (24h)",
                        f"Leading the board · {_fmt_usd(m['oi'])} open interest.",
                        m["market"],
                    )
                )
        for m in by_change[-2:]:
            if m["change"] < -2:
                signals.append(
                    _signal(
                        "mover",
                        "info",
                        "🔻",
                        f"{m['asset']} {m['change']:.1f}% (24h)",
                        f"Worst performer · {_fmt_usd(m['oi'])} open interest.",
                        m["market"],
                    )
                )

        # Funding extremes = crowded positioning.
        by_funding = sorted(markets, key=lambda m: m["funding"], reverse=True)
        hi = by_funding[0]
        if hi["funding"] * 100 >= 0.005:  # >= 0.005%/h
            signals.append(
                _signal(
                    "funding",
                    "warn",
                    "💸",
                    f"{hi['asset']} funding {hi['funding']*100:+.4f}%/h",
                    "Longs are paying heavily — crowded long, squeeze risk.",
                    hi["market"],
                )
            )
        lo = by_funding[-1]
        if lo["funding"] * 100 <= -0.005:
            signals.append(
                _signal(
                    "funding",
                    "warn",
                    "🧲",
                    f"{lo['asset']} funding {lo['funding']*100:+.4f}%/h",
                    "Shorts are paying — crowded short, fuel for a squeeze.",
                    lo["market"],
                )
            )

        # Squeeze setups: funding fights the price move.
        for m in markets:
            fpct = m["funding"] * 100
            if fpct <= -0.002 and m["change"] >= 2:
                signals.append(
                    _signal(
                        "squeeze",
                        "alert",
                        "⚡",
                        f"{m['asset']} short squeeze building",
                        f"Up {m['change']:.1f}% while shorts pay funding — trapped shorts.",
                        m["market"],
                    )
                )
            elif fpct >= 0.002 and m["change"] <= -2:
                signals.append(
                    _signal(
                        "squeeze",
                        "alert",
                        "⚡",
                        f"{m['asset']} long flush risk",
                        f"Down {m['change']:.1f}% while longs pay funding — trapped longs.",
                        m["market"],
                    )
                )

    # Rank: alert > warn > info, de-duplicated by id.
    order = {"alert": 0, "warn": 1, "info": 2}
    seen, ranked = set(), []
    for s in sorted(signals, key=lambda x: order.get(x["severity"], 3)):
        if s["id"] in seen:
            continue
        seen.add(s["id"])
        ranked.append(s)
    return ranked[:14]


def _fmt_usd(n: float) -> str:
    if n >= 1e9:
        return f"${n/1e9:.1f}B"
    if n >= 1e6:
        return f"${n/1e6:.0f}M"
    if n >= 1e3:
        return f"${n/1e3:.0f}K"
    return f"${n:.0f}"


# --- Token safety: GoPlus + Honeypot.is (EVM) / RugCheck (Solana), all free ---

# Suwappu chain id -> GoPlus numeric chain id (EVM only).
GOPLUS_CHAIN_IDS = {
    "ethereum": "1",
    "eth": "1",
    "bsc": "56",
    "bnb": "56",
    "base": "8453",
    "arbitrum": "42161",
    "arbitrum_one": "42161",
    "optimism": "10",
    "op": "10",
    "polygon": "137",
    "polygon_pos": "137",
    "avalanche": "43114",
    "avax": "43114",
}


def _pct(value) -> Optional[float]:
    """Parse a GoPlus/Honeypot tax-or-percent field (often a 0–1 ratio string or
    a 0–100 number) into a percent."""
    f = _to_float(value)
    if f is None:
        return None
    return round(f * 100, 2) if f <= 1 else round(f, 2)


def _flag(label: str, level: str) -> dict:
    return {"label": label, "level": level}  # level: danger | warn | ok


def _empty_report(chain: str, address: str) -> dict:
    return {
        "chain": chain,
        "address": address,
        "isHoneypot": None,
        "canSell": None,
        "buyTaxPct": None,
        "sellTaxPct": None,
        "mintable": None,
        "freezable": None,
        "ownerRenounced": None,
        "lpLockedPct": None,
        "topHolderPct": None,
        "holderCount": None,
        "score": None,
        "riskLevel": "unknown",
        "flags": [],
        "sources": [],
    }


async def _evm_safety(chain: str, address: str) -> dict:
    """GoPlus token_security + Honeypot.is sell-simulation for an EVM token."""
    report = _empty_report(chain, address)
    gp_id = GOPLUS_CHAIN_IDS[chain.lower()]
    addr = address.lower()
    async with httpx.AsyncClient(timeout=8.0) as client:
        gp_raw, hp_raw = await asyncio.gather(
            _get_json(
                client,
                f"https://api.gopluslabs.io/api/v1/token_security/{gp_id}",
                {"contract_addresses": addr},
            ),
            _get_json(
                client,
                "https://api.honeypot.is/v2/IsHoneypot",
                {"address": addr, "chainID": gp_id},
            ),
            return_exceptions=True,
        )

    flags: list[dict] = []
    if isinstance(gp_raw, dict):
        report["sources"].append("goplus")
        t = (gp_raw.get("result") or {}).get(addr) or {}
        if t:
            report["isHoneypot"] = t.get("is_honeypot") == "1"
            report["buyTaxPct"] = _pct(t.get("buy_tax"))
            report["sellTaxPct"] = _pct(t.get("sell_tax"))
            report["mintable"] = t.get("is_mintable") == "1"
            report["ownerRenounced"] = t.get("can_take_back_ownership") == "0" and not (
                t.get("hidden_owner") == "1"
            )
            report["holderCount"] = _to_int(t.get("holder_count"))
            lp = t.get("lp_holders") or []
            locked = sum(
                _to_float(h.get("percent"), 0.0) or 0.0 for h in lp if h.get("is_locked") == 1
            )
            report["lpLockedPct"] = round(locked * 100, 1) if lp else None
            holders = t.get("holders") or []
            if holders:
                report["topHolderPct"] = round(
                    sum(_to_float(h.get("percent"), 0.0) or 0.0 for h in holders[:10]) * 100, 1
                )
            if t.get("cannot_sell_all") == "1":
                flags.append(_flag("Can't sell entire balance", "danger"))
            if t.get("transfer_pausable") == "1":
                flags.append(_flag("Transfers can be paused", "warn"))
            if t.get("slippage_modifiable") == "1":
                flags.append(_flag("Tax can be changed by owner", "warn"))
            if t.get("is_open_source") == "0":
                flags.append(_flag("Source not verified", "warn"))

    # Honeypot.is runs a real buy+sell simulation — authoritative on can-sell.
    if isinstance(hp_raw, dict):
        report["sources"].append("honeypot.is")
        hr = hp_raw.get("honeypotResult") or {}
        sim = hp_raw.get("simulationResult") or {}
        if hr.get("isHoneypot") is not None:
            report["isHoneypot"] = bool(hr.get("isHoneypot"))
        if sim.get("buyTax") is not None:
            report["buyTaxPct"] = _pct(sim.get("buyTax"))
        if sim.get("sellTax") is not None:
            report["sellTaxPct"] = _pct(sim.get("sellTax"))

    report["canSell"] = (not report["isHoneypot"]) if report["isHoneypot"] is not None else None
    report["flags"] = _derive_flags(report, flags)
    report["score"], report["riskLevel"] = _derive_risk(report)
    return report


async def _solana_safety(chain: str, address: str) -> dict:
    """RugCheck report summary for a Solana mint."""
    report = _empty_report(chain, address)
    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            rc = await _get_json(
                client, f"https://api.rugcheck.xyz/v1/tokens/{address}/report/summary"
            )
        except Exception:
            rc = None
    flags: list[dict] = []
    if isinstance(rc, dict):
        report["sources"].append("rugcheck")
        for r in rc.get("risks") or []:
            raw = (r.get("level") or "").lower()
            level = "danger" if raw in ("danger", "high") else "warn"
            label = r.get("name") or "Risk"
            flags.append(_flag(label, level))
            name = label.lower()
            if "mint" in name:
                report["mintable"] = True
            if "freeze" in name:
                report["freezable"] = True
            if "honeypot" in name:
                report["isHoneypot"] = True
        # RugCheck score is a RISK score (higher = riskier); map to a 0–100 trust.
        risk_score = _to_float(rc.get("score"))
        if risk_score is not None:
            report["score"] = max(0, min(100, round(100 - risk_score / 10)))
    report["canSell"] = (not report["isHoneypot"]) if report["isHoneypot"] is not None else None
    report["flags"] = _derive_flags(report, flags)
    score, level = _derive_risk(report)
    if report["score"] is None:
        report["score"] = score
    report["riskLevel"] = level
    return report


def _derive_flags(report: dict, base: list[dict]) -> list[dict]:
    flags = list(base)
    if report.get("isHoneypot"):
        flags.insert(0, _flag("Honeypot — cannot sell", "danger"))
    if report.get("mintable"):
        flags.append(_flag("Mint authority active", "warn"))
    if report.get("freezable"):
        flags.append(_flag("Freeze authority active", "warn"))
    for tax_key, side in (("buyTaxPct", "Buy"), ("sellTaxPct", "Sell")):
        tax = report.get(tax_key)
        if tax is not None and tax >= 10:
            flags.append(_flag(f"High {side.lower()} tax {tax:.0f}%", "warn"))
    top = report.get("topHolderPct")
    if top is not None and top >= 50:
        flags.append(_flag(f"Top 10 hold {top:.0f}%", "warn" if top < 70 else "danger"))
    # De-dup by label, preserve order.
    seen, out = set(), []
    for f in flags:
        if f["label"] not in seen:
            seen.add(f["label"])
            out.append(f)
    return out


def _derive_risk(report: dict) -> tuple[Optional[int], str]:
    flags = report.get("flags") or []
    if report.get("isHoneypot") or any(f["level"] == "danger" for f in flags):
        return (report.get("score") if report.get("score") is not None else 10), "danger"
    if any(f["level"] == "warn" for f in flags):
        return (report.get("score") if report.get("score") is not None else 55), "caution"
    if not report.get("sources"):
        return None, "unknown"
    return (report.get("score") if report.get("score") is not None else 90), "safe"


@router.get("/token/safety")
async def get_terminal_token_safety(
    chain: str = Query(...),
    address: str = Query(...),
):
    """Aggregated token-safety report from free providers — GoPlus + Honeypot.is
    (EVM) or RugCheck (Solana): honeypot/can-sell, buy/sell tax, mint/freeze
    authority, LP-locked, top-holder concentration, plus human-readable risk
    flags and a 0–100 trust score. Degrades to ``riskLevel: unknown`` rather
    than failing if upstreams are down."""
    chain_l = chain.lower()
    try:
        if chain_l in ("solana", "sol"):
            return await _solana_safety(chain, address)
        if chain_l in GOPLUS_CHAIN_IDS:
            return await _evm_safety(chain, address)
    except Exception:
        return _empty_report(chain, address)
    return _empty_report(chain, address)


DEXSCREENER_SEARCH_URL = "https://api.dexscreener.com/latest/dex/search"
FINAL_STRETCH_CHAIN = "solana"
# Pre-migration (pump.fun bonding-curve) pairs have no dedicated public feed,
# so we proxy "final stretch" with the newest, lowest-liquidity live pairs on
# the canonical memecoin chain — same DexScreener source the webapp/terminal
# Pulse "new" stage already uses, just narrowed to a pre-graduation band.
FINAL_STRETCH_MAX_LIQUIDITY_USD = 60_000
FINAL_STRETCH_MAX_AGE_MINUTES = 24 * 60


def _final_stretch_insiders_pct(buys: int, sells: int) -> Optional[float]:
    """Best-effort proxy for insider concentration: a heavily buy-skewed early
    tape (few sells relative to buys) is the observable signature of coordinated
    insider/sniper buying. Returns None (unknown) rather than a fabricated
    number when there isn't enough tape to judge."""
    total = buys + sells
    if total < 5:
        return None
    return round(max(0.0, min(100.0, (buys - sells) / total * 100)), 1)


def _final_stretch_bundle_pct(pair: dict) -> Optional[float]:
    """Bundle-buy detection (many wallets funded from one source in the same
    block) needs on-chain tracing we don't run here — honestly unknown rather
    than guessed. Left as None; a real detector can populate this later."""
    return None


def _final_stretch_row(pair: dict) -> dict:
    base = pair.get("baseToken") or {}
    tx = (pair.get("txns") or {}).get("h24") or {}
    buys = int(tx.get("buys") or 0)
    sells = int(tx.get("sells") or 0)
    created_ms = pair.get("pairCreatedAt") or 0
    created_iso = (
        datetime.fromtimestamp(created_ms / 1000, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
        if created_ms
        else ""
    )
    liq = float((pair.get("liquidity") or {}).get("usd") or 0)
    return {
        "address": base.get("address"),
        "symbol": base.get("symbol"),
        "name": base.get("name") or base.get("symbol"),
        "chain": FINAL_STRETCH_CHAIN,
        "stage": "final_stretch",
        "createdAt": created_iso,
        "marketCap": float(pair.get("marketCap") or pair.get("fdv") or 0),
        "volume24h": float((pair.get("volume") or {}).get("h24") or 0),
        "liquidityUsd": liq,
        "priceUsd": float(pair.get("priceUsd") or 0),
        "txns24h": buys + sells,
        "buys24h": buys,
        "sells24h": sells,
        "insidersPercent": _final_stretch_insiders_pct(buys, sells),
        "bundlePercent": _final_stretch_bundle_pct(pair),
        # No dedicated bonding-curve source yet, so progress is left unknown
        # (None) rather than fabricated — the frontend hides the column
        # gracefully when this is null.
        "bondingProgress": None,
    }


@router.get("/discovery/final-stretch")
async def get_terminal_final_stretch(limit: int = Query(default=30, ge=1, le=100)):
    """Public, read-only "Final Stretch" discovery feed — pre-migration
    (pre-graduation) tokens on the canonical memecoin chain, proxied from live
    DexScreener pairs narrowed to a low-liquidity / recently-created band.
    Display-and-filter only: no swap/order/execution logic. Degrades to an
    empty list (never 5xx) if the upstream is unavailable, matching the other
    public discovery endpoints in this module."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                DEXSCREENER_SEARCH_URL,
                params={"q": FINAL_STRETCH_CHAIN},
                headers={"User-Agent": "suwappu-terminal/1.0"},
            )
            response.raise_for_status()
            data = response.json()
    except Exception:
        logger.warning("final-stretch: DexScreener fetch failed", exc_info=True)
        return []

    now_ms = datetime.now(tz=timezone.utc).timestamp() * 1000
    pairs = [
        p
        for p in (data.get("pairs") or [])
        if str(p.get("chainId", "")).lower() == FINAL_STRETCH_CHAIN
        and (p.get("baseToken") or {}).get("address")
    ]

    # Narrow to the "pre-migration" band: young + still-thin liquidity.
    candidates = []
    for p in pairs:
        liq = float((p.get("liquidity") or {}).get("usd") or 0)
        created_ms = p.get("pairCreatedAt") or 0
        age_min = (now_ms - created_ms) / 60_000 if created_ms else None
        if liq > FINAL_STRETCH_MAX_LIQUIDITY_USD:
            continue
        if age_min is not None and age_min > FINAL_STRETCH_MAX_AGE_MINUTES:
            continue
        candidates.append(p)

    # De-dupe by token, keep the highest-liquidity pair per mint.
    best: dict[str, dict] = {}
    for p in candidates:
        addr = p["baseToken"]["address"]
        liq = float((p.get("liquidity") or {}).get("usd") or 0)
        prev = best.get(addr)
        if not prev or liq > float((prev.get("liquidity") or {}).get("usd") or 0):
            best[addr] = p

    ordered = sorted(best.values(), key=lambda p: p.get("pairCreatedAt") or 0, reverse=True)[:limit]
    return [_final_stretch_row(p) for p in ordered]


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
            "time": int(
                datetime.fromisoformat(trade["time"].replace("Z", "+00:00")).timestamp() * 1000
            ),
        }
        for trade in trades
    ]


# ──────────────────────────────────────────────────────────────────────
# Authenticated trading-execution routes (HyperLiquid perps + Polymarket
# predictions). These delegate ALL signing/crypto to the existing proven
# services — this layer is auth + validate + delegate only.
# ──────────────────────────────────────────────────────────────────────


def _terminal_user(request: Request) -> dict:
    """Extract and validate the JWT payload. Raises 401 on failure.

    The user id used everywhere below is ``int(payload["user_id"])`` — the
    DB ``users.id``. Perps tables (HyperLiquidAccount.user_id, PerpPosition.
    user_id) and prediction tables (PredictionPosition.user_id) are all keyed
    by this id.
    """
    # Deferred import: api.main imports this router, so a module-level import
    # would create a circular import at startup.
    from api.main import decode_jwt_token

    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.cookies.get("suwappu_auth")
    if token:
        payload = decode_jwt_token(token)
        if payload and payload.get("user_id"):
            return payload
    raise HTTPException(status_code=401, detail="Sign in to trade")


def _to_float(value, default: Optional[float] = None) -> Optional[float]:
    """Coerce Decimal/None/str to float for JSON serialization. Returns
    `default` (None unless given) when the value can't be parsed — callers may
    pass a numeric default to use it directly in sums."""
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _jsonify(obj):
    """Recursively convert Decimals to floats inside dicts/lists for JSON."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _jsonify(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonify(v) for v in obj]
    return obj


_CONDITION_ID_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


async def _resolve_condition_id(market_id: str) -> str:
    """Return the on-chain CTF condition id for a prediction market.

    A position's ``market_id`` MUST be the condition id (0x… bytes32): that's
    what ``predict_monitor`` settles by (CLOB ``get_clob_market(condition_id)``)
    and what on-chain redemption uses. The terminal sends the condition id when
    the browse payload carries it; this falls back to resolving it from the
    Gamma numeric id so the stored value is always correct. If neither works the
    order still places (placement only needs the token id) but we log loudly,
    since auto-settlement won't fire for a non-condition market_id.
    """
    mid = (market_id or "").strip()
    if _CONDITION_ID_RE.match(mid):
        return mid
    if mid.isdigit():
        try:
            from bot.services.polymarket_api import polymarket_client

            info = await polymarket_client.get_market(mid)
            if info and info.condition_id:
                return info.condition_id
        except Exception as e:
            logger.warning("could not resolve condition_id from gamma id %s: %s", mid, e)
    logger.warning(
        "predict order market_id %r is not a condition id; auto-settlement may not fire", mid
    )
    return mid


# --- Perps request models ---


class PerpsConnectBody(BaseModel):
    apiKey: str
    apiSecret: str


class PerpsExecuteBody(BaseModel):
    market: str
    side: str  # "long" | "short"
    size: float
    leverage: int = 1
    marginMode: str = "cross"  # "cross" | "isolated"
    orderType: str = "market"  # "market" | "limit"
    limitPrice: Optional[float] = None  # required when orderType == "limit"
    tpPrice: Optional[float] = None  # market only
    slPrice: Optional[float] = None  # market only


class PerpsCloseBody(BaseModel):
    positionId: int
    percent: float = 100.0


class PerpsCancelBody(BaseModel):
    market: str
    orderId: str


class PerpsTpSlBody(BaseModel):
    positionId: int
    takeProfit: Optional[float] = None
    stopLoss: Optional[float] = None


# --- Predict request models ---


class PredictOrderBody(BaseModel):
    tokenId: str
    marketId: str
    question: str
    outcome: str
    side: str  # "BUY" | "SELL"
    amount: float
    price: float


# ── Perps (HyperLiquid) ───────────────────────────────────────────────


@router.get("/perps/account")
async def terminal_perps_account(request: Request):
    """Report the user's HyperLiquid connection + live account health.

    ``accountValue`` (equity), ``maintenanceMarginUsed`` and ``totalMarginUsed``
    let the order ticket show a real margin ratio / health bar. The live fetch is
    best-effort — if HyperLiquid is unreachable the financial fields come back
    null and the UI falls back to its estimate.
    """
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    acct = perps_service.get_account(uid)
    if not acct:
        return {"connected": False, "address": None}

    out = {
        "connected": True,
        "address": acct.hl_address,
        "accountValue": None,
        "maintenanceMarginUsed": None,
        "totalMarginUsed": None,
        "withdrawable": None,
    }

    try:
        state = await perps_service._client.get_account_state(acct.hl_address)
        if state:
            summary = state.get("margin_summary", {})
            out["accountValue"] = _to_float(summary.get("accountValue"))
            out["totalMarginUsed"] = _to_float(summary.get("totalMarginUsed"))
            out["maintenanceMarginUsed"] = _to_float(state.get("maintenance_margin_used"))
            out["withdrawable"] = _to_float(state.get("withdrawable"))
    except Exception as e:
        logger.warning("terminal perps account state fetch failed: %s", e)

    return out


@router.post("/perps/connect")
async def terminal_perps_connect(request: Request, body: PerpsConnectBody):
    """Encrypt + store the user's HyperLiquid API credentials.

    Mirrors bot/handlers/perps.py:perps_setup_secret — encrypts both the API
    wallet key and secret with the app encryption key and derives the HL
    address from the secret. All encryption lives in the existing service.
    """
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service
    from bot.utils.encryption import encrypt_private_key
    from bot.config.settings import settings
    from eth_account import Account

    try:
        key = settings.encryption_key
        encrypted_key = encrypt_private_key(body.apiKey, key)
        encrypted_secret = encrypt_private_key(body.apiSecret, key)

        hl_address = ""
        try:
            hl_address = Account.from_key(body.apiSecret).address
        except Exception as e:
            logger.warning("Could not derive HL address from key: %s", e)
            raise HTTPException(
                status_code=400,
                detail="Invalid API secret — could not derive your HyperLiquid address.",
            )

        perps_service.setup_account(
            user_id=uid,
            hl_address=hl_address,
            api_key_encrypted=encrypted_key,
            api_secret_encrypted=encrypted_secret,
        )
        return {"connected": True, "address": hl_address}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("terminal perps connect failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not connect your HyperLiquid account.")


@router.get("/perps/positions")
async def terminal_perps_positions(request: Request):
    """Return the user's live open HyperLiquid positions.

    Live state is fetched from HyperLiquid keyed by the account address, then
    matched against local PerpPosition rows so the frontend gets the local
    id (needed to close). If a live position has no local row, id is null.
    """
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    acct = perps_service.get_account(uid)
    if not acct or not acct.hl_address:
        return {"positions": []}

    try:
        live = await perps_service._client.get_open_positions(acct.hl_address)
    except Exception as e:
        logger.error("terminal perps live positions failed: %s", e)
        live = []

    # Local rows give us the stable PerpPosition.id for closing.
    local = await perps_service.get_positions(uid, status="open")
    local_by_key = {(p.market, p.side): p for p in local}

    positions = []
    for p in live:
        key = (p.get("market"), p.get("side"))
        local_pos = local_by_key.get(key)
        positions.append(
            {
                "id": local_pos.id if local_pos else None,
                "market": p.get("market"),
                "side": p.get("side"),
                "size": _to_float(p.get("size")),
                "leverage": _to_float(p.get("leverage")),
                "entryPrice": _to_float(p.get("entry_price")),
                "markPrice": _to_float(p.get("entry_price")),
                "unrealizedPnl": _to_float(p.get("unrealized_pnl")),
                "liquidationPrice": _to_float(p.get("liquidation_price")),
            }
        )
    return {"positions": positions}


@router.get("/perps/orders")
async def terminal_perps_orders(request: Request):
    """Return the user's resting (open) HyperLiquid orders, e.g. limit entries."""
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    try:
        orders = await perps_service.get_open_orders(uid)
    except Exception as e:
        logger.error("terminal perps open orders failed: %s", e)
        orders = []

    return {
        "orders": [
            {
                "orderId": o.get("order_id"),
                "market": o.get("market"),
                "side": o.get("side"),
                "size": _to_float(o.get("size")),
                "price": _to_float(o.get("price")),
                "orderType": o.get("order_type"),
                "reduceOnly": bool(o.get("reduce_only")),
                "isTrigger": bool(o.get("is_trigger")),
                "triggerPrice": _to_float(o.get("trigger_price")),
            }
            for o in orders
        ]
    }


@router.post("/perps/cancel")
async def terminal_perps_cancel(request: Request, body: PerpsCancelBody):
    """Cancel a resting HyperLiquid order for the signed-in user."""
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    try:
        ok = await perps_service.cancel_order(
            user_id=uid, market=body.market, order_id=body.orderId
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("terminal perps cancel failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not cancel the order. Try again.")

    if not ok:
        raise HTTPException(status_code=502, detail="Could not cancel the order. Try again.")
    return {"ok": True}


@router.post("/perps/tpsl")
async def terminal_perps_tpsl(request: Request, body: PerpsTpSlBody):
    """Set or move the take profit / stop loss protecting an open position.

    Each leg is a reduce-only trigger order resting on HyperLiquid. The old
    trigger is cancelled before the new one is placed, and the stored price is
    only updated once the exchange accepts it — so a price shown in the UI
    always corresponds to protection that actually exists.
    """
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    if body.takeProfit is None and body.stopLoss is None:
        raise HTTPException(status_code=400, detail="Set a take profit or a stop loss price.")
    for label, value in (("Take profit", body.takeProfit), ("Stop loss", body.stopLoss)):
        if value is not None and value <= 0:
            raise HTTPException(status_code=400, detail=f"{label} must be greater than zero.")

    try:
        await perps_service.modify_tp_sl(
            user_id=uid,
            position_id=body.positionId,
            tp_price=body.takeProfit,
            sl_price=body.stopLoss,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("terminal perps tp/sl update failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="HyperLiquid did not accept the change. Your existing protection is unchanged.",
        )

    return {"ok": True, "takeProfit": body.takeProfit, "stopLoss": body.stopLoss}


@router.post("/perps/execute")
async def terminal_perps_execute(request: Request, body: PerpsExecuteBody):
    """Open a HyperLiquid perp position (market) or rest a limit entry.

    Market orders fill immediately and create a position (with optional TP/SL).
    Limit orders rest until the market reaches the price — no position exists
    until the fill surfaces in the live positions poll. Signing is delegated to
    perps_service.
    """
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    order_type = (body.orderType or "market").strip().lower()
    if order_type not in ("market", "limit"):
        raise HTTPException(status_code=400, detail="orderType must be market or limit.")
    margin_mode = (body.marginMode or "cross").strip().lower()
    if margin_mode not in ("cross", "isolated"):
        raise HTTPException(status_code=400, detail="marginMode must be cross or isolated.")
    is_limit = order_type == "limit"

    try:
        if is_limit:
            if body.limitPrice is None:
                raise ValueError("Limit price is required for a limit order.")
            order = await perps_service.place_limit_order(
                user_id=uid,
                market=body.market,
                side=body.side,
                size=body.size,
                limit_price=body.limitPrice,
                leverage=body.leverage,
                margin_mode=margin_mode,
            )
            if not order:
                raise HTTPException(
                    status_code=502, detail="Order failed on HyperLiquid. Try again."
                )
            return {
                "ok": True,
                "kind": "order",
                "order": {
                    "id": order.id,
                    "market": order.market,
                    "side": order.side,
                    "size": _to_float(order.size),
                    "price": _to_float(order.price),
                    "status": order.status,
                },
            }

        pos = await perps_service.open_position(
            user_id=uid,
            market=body.market,
            side=body.side,
            size=body.size,
            leverage=body.leverage,
            tp_price=body.tpPrice,
            margin_mode=margin_mode,
            sl_price=body.slPrice,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("terminal perps execute failed: %s", e)
        raise HTTPException(status_code=502, detail="Order failed on HyperLiquid. Try again.")

    if not pos:
        raise HTTPException(status_code=502, detail="Order failed on HyperLiquid. Try again.")

    return {
        "ok": True,
        "kind": "position",
        "position": {
            "id": pos.id,
            "market": pos.market,
            "side": pos.side,
            "size": _to_float(pos.size),
            "entryPrice": _to_float(pos.entry_price),
            "leverage": _to_float(pos.leverage),
        },
    }


@router.post("/perps/close")
async def terminal_perps_close(request: Request, body: PerpsCloseBody):
    """Close (fully or partially) a HyperLiquid perp position."""
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.perps_service import perps_service

    try:
        result = await perps_service.close_position(
            user_id=uid,
            position_id=body.positionId,
            percent=body.percent,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("terminal perps close failed: %s", e)
        raise HTTPException(status_code=502, detail="Order failed on HyperLiquid. Try again.")

    return {"ok": True, "result": _jsonify(result)}


# ── Predict (Polymarket) ──────────────────────────────────────────────


@router.get("/predict/positions")
async def terminal_predict_positions(request: Request):
    """Return the user's Polymarket prediction positions from the DB."""
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.predict import PredictionPosition

    out = []
    with get_session() as session:
        rows = (
            session.query(PredictionPosition)
            .filter(PredictionPosition.user_id == uid)
            .order_by(PredictionPosition.id.desc())
            .all()
        )
        for p in rows:
            payout = _to_float(p.resolved_payout) or 0.0
            out.append(
                {
                    "id": p.id,
                    "marketId": p.market_id,
                    "question": p.market_question,
                    "outcome": p.outcome,
                    "tokenId": p.token_id,
                    "shares": _to_float(p.total_shares) or 0.0,
                    "avgPrice": _to_float(p.avg_entry_price) or 0.0,
                    "currentPrice": _to_float(p.current_price) or 0.0,
                    "unrealizedPnl": _to_float(p.unrealized_pnl) or 0.0,
                    "isResolved": bool(p.is_resolved),
                    "claimable": bool(p.is_resolved) and payout > 0 and not bool(p.claimed),
                }
            )
    return {"positions": out}


@router.post("/predict/order")
async def terminal_predict_order(request: Request, body: PredictOrderBody):
    """Place a Polymarket prediction order using the user's default EVM wallet.

    Wallet/private-key resolution mirrors bot/handlers/predict.py: load the
    user's default active EVM Wallet, pull the private key via wallet_service
    (backup key for Turnkey wallets), then delegate signing/placement to
    polymarket_client.place_order. On success, upsert the local
    PredictionOrder + PredictionPosition rows like the handler does.
    """
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.user import Wallet
    from bot.models.predict import PredictionOrder, PredictionPosition
    from bot.services.wallet import WalletService
    from bot.services.polymarket_api import polymarket_client

    wallet_service = WalletService()

    # Resolve the user's default EVM wallet + private key.
    with get_session() as session:
        wallet = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == uid,
                Wallet.chain_type == "evm",
                Wallet.is_default == True,  # noqa: E712
            )
            .first()
        )
        if not wallet:
            raise HTTPException(
                status_code=400,
                detail="You need a default EVM wallet to trade prediction markets.",
            )
        wallet_id = wallet.id
        try:
            if wallet.is_turnkey_wallet:
                private_key = wallet_service.get_backup_private_key(wallet)
            else:
                private_key = wallet_service.get_private_key(wallet)
        except Exception as e:
            logger.error("terminal predict wallet key resolution failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not access your wallet key.")

    if not private_key:
        raise HTTPException(status_code=400, detail="Could not access your wallet key.")

    # Store the on-chain condition id (not the Gamma numeric id) so predict_monitor
    # can settle/redeem this position on resolution.
    condition_id = await _resolve_condition_id(body.marketId)

    # Record a pending order row first (mirrors the handler).
    with get_session() as session:
        order = PredictionOrder(
            user_id=uid,
            wallet_id=wallet_id,
            market_id=condition_id,
            market_question=body.question,
            token_id=body.tokenId,
            outcome=body.outcome,
            side=body.side,
            amount_usdc=Decimal(str(body.amount)),
            price=Decimal(str(body.price)),
            status="pending",
        )
        session.add(order)
        session.flush()
        order_id = order.id

    # Delegate signing + placement to the existing service.
    try:
        result = await polymarket_client.place_order(
            private_key=private_key,
            token_id=body.tokenId,
            side=body.side,
            amount=body.amount,
            price=body.price,
            order_id=order_id,
        )
    except Exception as e:
        logger.error("terminal predict place_order failed: %s", e)
        with get_session() as session:
            db_order = session.query(PredictionOrder).filter(PredictionOrder.id == order_id).first()
            if db_order:
                db_order.status = "failed"
                db_order.error_message = str(e)
        raise HTTPException(status_code=502, detail="Order failed on Polymarket. Try again.")

    # Persist outcome + upsert position (mirrors handler).
    with get_session() as session:
        db_order = session.query(PredictionOrder).filter(PredictionOrder.id == order_id).first()
        if db_order:
            if result.success:
                db_order.status = "placed"
                db_order.clob_order_id = result.order_id
                shares = body.amount / body.price if body.price > 0 else 0
                db_order.shares = Decimal(str(shares))

                position = (
                    session.query(PredictionPosition)
                    .filter(
                        PredictionPosition.user_id == uid,
                        PredictionPosition.market_id == condition_id,
                        PredictionPosition.token_id == body.tokenId,
                    )
                    .first()
                )
                if position:
                    old_total = float(position.total_cost_usdc or 0)
                    old_shares = float(position.total_shares or 0)
                    new_total = old_total + body.amount
                    new_shares = old_shares + shares
                    position.total_shares = Decimal(str(new_shares))
                    position.total_cost_usdc = Decimal(str(new_total))
                    position.avg_entry_price = (
                        Decimal(str(new_total / new_shares)) if new_shares > 0 else Decimal("0")
                    )
                    position.current_price = Decimal(str(body.price))
                else:
                    session.add(
                        PredictionPosition(
                            user_id=uid,
                            market_id=condition_id,
                            market_question=body.question,
                            token_id=body.tokenId,
                            outcome=body.outcome,
                            total_shares=Decimal(str(shares)),
                            avg_entry_price=Decimal(str(body.price)),
                            total_cost_usdc=Decimal(str(body.amount)),
                            current_price=Decimal(str(body.price)),
                        )
                    )
            else:
                db_order.status = "failed"
                db_order.error_message = result.error

    return {
        "ok": result.success,
        "orderId": result.order_id,
        "error": getattr(result, "error", None) or None,
    }


class PredictRedeemBody(BaseModel):
    positionId: int


@router.post("/predict/redeem")
async def terminal_predict_redeem(request: Request, body: PredictRedeemBody):
    """Redeem a resolved, claimable winning Polymarket position on-chain for pUSD.

    Mirrors bot/handlers/predict.py:confirm_redeem_callback — validate the
    position is claimable, load the user's default EVM wallet (the Polymarket
    trading wallet that pays MATIC gas), then delegate the on-chain redeem to
    polymarket_client.redeem_position. On success mark the position claimed +
    store the tx hash. All signing reuses the existing service.
    """
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.user import Wallet
    from bot.models.predict import PredictionPosition
    from bot.services.polymarket_api import polymarket_client

    # Load + validate the position is actually claimable.
    with get_session() as session:
        pos = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.id == body.positionId,
                PredictionPosition.user_id == uid,
            )
            .first()
        )
        if not pos:
            raise HTTPException(status_code=404, detail="Position not found.")
        payout = _to_float(pos.resolved_payout) or 0.0
        if not (bool(pos.is_resolved) and payout > 0 and not bool(pos.claimed)):
            raise HTTPException(
                status_code=400,
                detail="This position isn't claimable (already redeemed or not resolved).",
            )
        stored_market_id = pos.market_id

    # Defensive: legacy rows may hold a Gamma numeric id instead of the condition
    # id; redemption needs the on-chain condition id.
    condition_id = await _resolve_condition_id(stored_market_id)

    # Resolve the user's default EVM wallet (Polymarket trading wallet, pays gas).
    with get_session() as session:
        wallet = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == uid,
                Wallet.chain_type == "evm",
                Wallet.is_default == True,  # noqa: E712
            )
            .first()
        )
        if not wallet:
            raise HTTPException(
                status_code=400,
                detail="You need a default EVM wallet to redeem.",
            )
        session.expunge(wallet)

    try:
        result = await polymarket_client.redeem_position(
            wallet=wallet,
            condition_id=condition_id,
        )
    except Exception as e:
        logger.error("terminal predict redeem failed: %s", e)
        raise HTTPException(status_code=502, detail="Redeem failed. Your position is unchanged.")

    if result.success:
        with get_session() as session:
            pos = (
                session.query(PredictionPosition)
                .filter(
                    PredictionPosition.id == body.positionId,
                    PredictionPosition.user_id == uid,
                )
                .first()
            )
            if pos:
                pos.claimed = True
                pos.redeem_tx_hash = result.tx_hash
        return {"ok": True, "txHash": result.tx_hash, "message": "Redeemed to pUSD on Polygon."}

    # Informational failure — funds are safe. `pending` = broadcast but unconfirmed.
    return {
        "ok": False,
        "pending": result.error_category == "pending",
        "txHash": result.tx_hash or None,
        "message": result.error or "Redeem could not be completed.",
        "category": result.error_category or None,
    }


# === Custodial wallet: deposit addresses, balances, withdrawals (web parity) ===
# Mirrors the proven Telegram custodial flow (bot/handlers/custodial.py +
# bot/services/hot_wallet.py): an omnibus hot-wallet deposit address per chain
# type + a per-user CustodialBalance ledger. Read paths are safe; the withdraw
# path reuses the bot's exact send → debit-after-success → record ordering.

_BASE58_ALPHABET = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")


def _is_base58_addr(s: str) -> bool:
    return bool(s) and all(c in _BASE58_ALPHABET for c in s)


def _valid_withdraw_address(chain: str, address: str) -> bool:
    """Per-chain destination validation — same rules as the bot, so a wrong-
    format address can't burn funds (e.g. an EVM 0x pasted as a Solana dest)."""
    address = (address or "").strip()
    chain_l = (chain or "").lower()
    if chain_l in ("solana", "sol"):
        return _is_base58_addr(address) and 32 <= len(address) <= 44
    if chain_l in ("tron", "trx"):
        return address.startswith("T") and _is_base58_addr(address) and len(address) == 34
    if not address.startswith("0x") or len(address) != 42:
        return False
    try:
        int(address[2:], 16)
        return True
    except ValueError:
        return False


def _withdraw_enabled() -> bool:
    """Server-side kill-switch for web withdrawals. Enabled by default; set
    TERMINAL_WITHDRAW_ENABLED=false in the environment to pause withdrawals
    instantly without a redeploy (deposits are unaffected)."""
    return os.getenv("TERMINAL_WITHDRAW_ENABLED", "true").strip().lower() not in (
        "false",
        "0",
        "no",
        "off",
    )


@router.get("/wallet/summary")
async def terminal_wallet_summary(request: Request):
    """Custodial wallet overview for the signed-in user: this user's OWN deposit
    address and their balances.

    Previously this returned the shared omnibus address. EVM carries no memo
    field, so an inbound transfer to a shared address says nothing about who
    sent it — the address has to be the attribution. Minted on first view and
    never reassigned, because a deposit can arrive long after the user saved it.

    Solana is reported as null until the SPL side of the watcher lands: an
    address nothing credits must not be presented as a way to add funds.
    """
    uid = int(_terminal_user(request)["user_id"])
    from bot.services.deposit_watcher import ALLOWLIST, CONFIRMATIONS
    from bot.services.hot_wallet import hot_wallet_service

    evm = await hot_wallet_service.get_or_create_user_deposit_wallet(uid, "evm")
    balances_raw = hot_wallet_service.get_all_custodial_balances(uid) or {}

    balances = []
    for chain, tokens in balances_raw.items():
        for token_symbol, amt in (tokens or {}).items():
            value = _to_float(amt) or 0.0
            if value > 0:
                balances.append({"chain": chain, "token": token_symbol, "amount": value})
    balances.sort(key=lambda b: b["amount"], reverse=True)

    # Tell the client exactly what will be credited, so the UI can state it
    # instead of implying that anything sent to the address shows up. Only
    # allowlisted ERC-20s are booked; native transfers emit no log and are not
    # detected at all.
    creditable = sorted({sym for syms in ALLOWLIST.values() for sym in syms})

    return {
        "evmDepositAddress": evm.address if evm else None,
        "solanaDepositAddress": None,
        "balances": balances,
        "withdrawEnabled": _withdraw_enabled(),
        "creditableTokens": creditable,
        "creditableChains": sorted(ALLOWLIST.keys()),
        "depositConfirmations": CONFIRMATIONS,
    }


class WalletWithdrawBody(BaseModel):
    chain: str
    token: str
    # Accept amount as a string so we parse with Decimal(amount) directly and
    # never round-trip through a binary float (Decimal(str(float)) inherits
    # float rounding error). Client should send the exact decimal string.
    amount: str
    toAddress: str
    memo: Optional[str] = None
    # REQUIRED client-supplied idempotency key. A retry (e.g. after a dropped
    # response) that reuses the same key is short-circuited instead of
    # re-sending funds. Optional here only because pydantic needs a default to
    # produce a clean 400 instead of a generic validation error; enforced as
    # mandatory in the handler below. The server never generates one on the
    # caller's behalf — that would defeat dedupe entirely.
    idempotency_key: Optional[str] = None


@router.post("/wallet/withdraw")
async def terminal_wallet_withdraw(request: Request, body: WalletWithdrawBody):
    """Withdraw a custodial balance to an external address.

    Order of operations is deliberately: validate -> ATOMIC RESERVE (debit) ->
    on-chain send -> record. The reserve is a single conditional UPDATE
    (hot_wallet_service.reserve_custodial_balance) that only succeeds if the
    balance covers the amount, so two concurrent withdraws can no longer both
    pass a check and both send (TOCTOU close). If the on-chain send fails, the
    reserved amount is refunded (operation="add") so a failed/reverted send
    never leaves the user debited.
    """
    if not _withdraw_enabled():
        raise HTTPException(
            status_code=503, detail="Withdrawals are temporarily paused. Please try again shortly."
        )
    uid = int(_terminal_user(request)["user_id"])
    chain = (body.chain or "").strip()
    token = (body.token or "").strip().upper()
    to_address = (body.toAddress or "").strip()
    idempotency_key = (body.idempotency_key or "").strip() or None

    # Idempotency is MANDATORY for withdrawals — an optional key makes the
    # whole replay defense opt-in. We never generate one server-side on the
    # caller's behalf; that would defeat dedupe (a naive client retry would
    # just get a fresh key each time).
    if not idempotency_key:
        raise HTTPException(
            status_code=400,
            detail="idempotency_key is required for withdrawals.",
        )

    if not _valid_withdraw_address(chain, to_address):
        raise HTTPException(
            status_code=400, detail="That destination address isn't valid for this network."
        )

    from decimal import Decimal as _D, InvalidOperation
    from bot.services.hot_wallet import (
        hot_wallet_service,
        WithdrawalsPausedError,
        PostBroadcastAmbiguous,
        ComplianceBlockedError,
        quantize_to_decimals,
    )
    from bot.models.custodial import TransactionType
    from bot.config.tokens import TOKENS, get_token_address

    try:
        amount = _D(body.amount)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Enter a valid amount.")
    if not (amount and amount > 0):
        raise HTTPException(status_code=400, detail="Enter an amount greater than zero.")

    chain_type = "solana" if chain.lower() in ("solana", "sol") else "evm"
    hot_wallet = hot_wallet_service.get_deposit_wallet(chain_type)
    if not hot_wallet:
        raise HTTPException(status_code=503, detail="Withdrawals are temporarily unavailable.")

    token_address = get_token_address(token, chain)
    memo = body.memo or ""
    token_cfg = TOKENS.get(token) if token_address else None
    is_native = not (
        token_address and token_address != "0x0000000000000000000000000000000000000000"
    )
    if not is_native and not token_cfg:
        raise HTTPException(status_code=400, detail=f"Unknown token {token}.")
    # Native decimals: 9 for Solana lamports, 18 for EVM wei.
    decimals = token_cfg.decimals if token_cfg else (9 if chain_type == "solana" else 18)
    # Quantize BEFORE both the ledger debit and the on-chain int conversion so
    # the two always agree exactly (no dust asymmetry from flooring only on
    # the on-chain side).
    amount = quantize_to_decimals(amount, decimals)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Enter an amount greater than zero.")

    # Idempotency claim: atomically insert a PENDING placeholder guarded by the
    # unique index on (user_id, idempotency_key). This closes the TOCTOU that a
    # plain "check then later insert" would have — only one concurrent request
    # with the same key (for this user) can win the claim; the loser is
    # short-circuited immediately instead of proceeding to reserve/send.
    claimed_tx_id = hot_wallet_service.claim_idempotency_key(
        idempotency_key=idempotency_key,
        user_id=uid,
        tx_type=TransactionType.WITHDRAWAL,
        chain=chain,
        token_symbol=token,
        amount=amount,
        to_address=to_address,
    )
    if claimed_tx_id is None:
        existing = hot_wallet_service.get_transaction_by_idempotency_key(uid, idempotency_key)
        raise HTTPException(
            status_code=409,
            detail={
                "message": "This withdrawal was already submitted.",
                "txHash": existing.tx_hash if existing else None,
                "status": existing.status if existing else None,
            },
        )

    # Reserve: atomically debit before any on-chain action is taken.
    reserved = hot_wallet_service.reserve_custodial_balance(
        user_id=uid, chain=chain, token_symbol=token, amount=amount
    )
    if not reserved:
        # Never broadcast — safe to release the idempotency claim entirely.
        hot_wallet_service.release_claimed_transaction(claimed_tx_id)
        balance = hot_wallet_service.get_custodial_balance(uid, chain, token)
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance — you have {_to_float(balance)} {token} on {chain}.",
        )

    try:
        if not is_native:
            tx_hash = await hot_wallet_service.send_token(
                wallet=hot_wallet,
                chain_name=chain,
                token_address=token_address,
                to_address=to_address,
                amount=amount,
                decimals=token_cfg.decimals,
                memo=memo,
                claimed_tx_id=claimed_tx_id,
            )
        else:
            tx_hash = await hot_wallet_service.send_native_token(
                wallet=hot_wallet,
                chain_name=chain,
                to_address=to_address,
                amount=amount,
                claimed_tx_id=claimed_tx_id,
            )
    except PostBroadcastAmbiguous as exc:
        # DO NOT refund and DO NOT release the idempotency placeholder here.
        # The node call failed/threw AFTER the tx may already have been
        # accepted and propagated (timeout, dropped response, "already
        # known", transient 5xx) — we genuinely don't know if funds moved.
        # Refunding now (or releasing the key so a retry re-sends) risks a
        # double-spend in the user's favor if the original tx actually lands.
        # Leave the reservation debited and the placeholder PENDING; the
        # withdraw reconciler resolves it against real chain state.
        #
        # The deterministic hash is normally already stamped pre-broadcast
        # (see hot_wallet._broadcast_evm_raw_tx / _send_sol_native /
        # _send_spl_token), but record it again here from the exception as an
        # explicit, idempotent backstop so it is never silently dropped.
        hot_wallet_service.record_pending_tx_hash(claimed_tx_id, exc.tx_hash)
        logger.exception(
            "terminal withdraw broadcast ambiguous for user %s (tx_id=%s, tx_hash=%s) — left PENDING for reconciler",
            uid,
            claimed_tx_id,
            exc.tx_hash,
        )
        raise HTTPException(
            status_code=202,
            detail=(
                "Your withdrawal was submitted but we couldn't confirm it reached the network. "
                "We're checking — it will either complete or be refunded automatically; no action needed."
            ),
        )
    except HTTPException as exc:
        # Failed before broadcast (e.g. unknown token) — safe to fully undo.
        hot_wallet_service.update_custodial_balance(
            user_id=uid, chain=chain, token_symbol=token, amount=amount, operation="add"
        )
        hot_wallet_service.release_claimed_transaction(claimed_tx_id)
        raise exc
    except WithdrawalsPausedError as exc:
        # Kill-switch check happens before any node call — safe to fully undo.
        hot_wallet_service.update_custodial_balance(
            user_id=uid, chain=chain, token_symbol=token, amount=amount, operation="add"
        )
        hot_wallet_service.release_claimed_transaction(claimed_tx_id)
        raise HTTPException(status_code=503, detail=str(exc))
    except ComplianceBlockedError as exc:
        # Sanctions screening happens before any node call — safe to fully
        # undo. Surface a clear 403 instead of the generic 502 the catch-all
        # below returns, so the caller (and the user) know this is a
        # compliance block, not a transient on-chain/RPC failure.
        logger.warning("terminal withdraw blocked by compliance for user %s: %s", uid, exc)
        hot_wallet_service.update_custodial_balance(
            user_id=uid, chain=chain, token_symbol=token, amount=amount, operation="add"
        )
        hot_wallet_service.release_claimed_transaction(claimed_tx_id)
        raise HTTPException(
            status_code=403,
            detail="This withdrawal cannot be completed due to compliance restrictions.",
        )
    except Exception:
        # Anything else here (RPC URL missing, gas estimate failure, nonce
        # fetch, signing) happens strictly BEFORE the broadcast call — the
        # broadcast call itself is wrapped and raises PostBroadcastAmbiguous
        # instead of a bare Exception, so reaching this branch means nothing
        # was ever sent to the network. Safe to fully undo.
        logger.exception("terminal withdraw send failed for user %s", uid)
        hot_wallet_service.update_custodial_balance(
            user_id=uid, chain=chain, token_symbol=token, amount=amount, operation="add"
        )
        hot_wallet_service.release_claimed_transaction(claimed_tx_id)
        raise HTTPException(
            status_code=502,
            detail="The withdrawal couldn't be submitted on-chain. Your balance is unchanged.",
        )

    # Balance was already debited by the reserve step above. Finalize the
    # claimed idempotency placeholder.
    hot_wallet_service.finalize_claimed_transaction(
        tx_id=claimed_tx_id, tx_hash=tx_hash, from_address=hot_wallet.address
    )
    return {"ok": True, "txHash": tx_hash, "status": "submitted"}


# === Token Intel (Bubblemaps-style dev tracking) ===
# Exposes the existing bot/services/token_intel service + dev-watch models
# over HTTP for the terminal web UI. No new business logic here — this is
# auth + validate + delegate to the same service/models the Telegram
# /intel and /devwatch commands use (bot/handlers/intel.py).
#
# Route registration order matters: the two-segment "/intel/devwatch/hits"
# GET route MUST be registered before the generic two-segment
# "/intel/{chain}/{token_address}" GET route below it, or Starlette would
# match "devwatch"/"hits" as chain/token_address first.


class DevWatchAddBody(BaseModel):
    deployer_address: str
    chain: str
    label: Optional[str] = None


def _devwatch_dict(watch, hit_count: int = 0) -> dict:
    return {
        "id": watch.id,
        "deployerAddress": watch.deployer_address,
        "chain": watch.chain,
        "label": watch.label,
        "createdAt": watch.created_at.isoformat() if watch.created_at else None,
        "hitCount": hit_count,
    }


@router.get("/intel/health")
async def terminal_intel_health():
    """Simple health check for intel routes."""
    return {"status": "intel_routes_active"}


@router.get("/intel/devwatch")
async def terminal_devwatch_list(request: Request):
    # NOTE: This endpoint retrieves the authenticated user's deployed-dev watch list.
    """The signed-in user's watched-deployer list, each with a recent-hits count."""
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.intel import DeployerWatch, DeployerWatchHit
    from sqlalchemy import func

    out = []
    with get_session() as session:
        watches = (
            session.query(DeployerWatch)
            .filter(DeployerWatch.user_id == uid)
            .order_by(DeployerWatch.id.asc())
            .all()
        )
        watch_ids = [w.id for w in watches]
        hit_counts: dict = {}
        if watch_ids:
            rows = (
                session.query(DeployerWatchHit.watch_id, func.count(DeployerWatchHit.id))
                .filter(DeployerWatchHit.watch_id.in_(watch_ids))
                .group_by(DeployerWatchHit.watch_id)
                .all()
            )
            hit_counts = {wid: cnt for wid, cnt in rows}
        out = [_devwatch_dict(w, hit_counts.get(w.id, 0)) for w in watches]
    return {"watches": out}


@router.get("/intel/devwatch/hits")
async def terminal_devwatch_hits(request: Request, limit: int = Query(default=50, ge=1, le=200)):
    """Recent DeployerWatchHit rows across all of the signed-in user's watches,
    newest first, each carrying the parent watch's label for display."""
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.intel import DeployerWatch, DeployerWatchHit

    out = []
    with get_session() as session:
        rows = (
            session.query(DeployerWatchHit, DeployerWatch)
            .join(DeployerWatch, DeployerWatchHit.watch_id == DeployerWatch.id)
            .filter(DeployerWatch.user_id == uid)
            .order_by(DeployerWatchHit.detected_at.desc())
            .limit(limit)
            .all()
        )
        for hit, watch in rows:
            out.append(
                {
                    "id": hit.id,
                    "watchId": hit.watch_id,
                    "tokenAddress": hit.token_address,
                    "chain": hit.chain,
                    "detectedAt": hit.detected_at.isoformat() if hit.detected_at else None,
                    "label": watch.label,
                    "deployerAddress": watch.deployer_address,
                }
            )
    return {"hits": out}


@router.post("/intel/devwatch")
async def terminal_devwatch_add(request: Request, body: DevWatchAddBody):
    """Add a deployer to the signed-in user's watchlist. Idempotent on the
    (user_id, deployer_address, chain) unique constraint — a duplicate add
    returns the existing row rather than erroring."""
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.intel import DeployerWatch

    address = (body.deployer_address or "").strip()
    chain = (body.chain or "").strip().lower()
    label = (body.label or "").strip() or None
    if not address or not chain:
        raise HTTPException(status_code=400, detail="deployer_address and chain are required.")

    def _find_existing(session) -> Optional[DeployerWatch]:
        return (
            session.query(DeployerWatch)
            .filter(
                DeployerWatch.user_id == uid,
                DeployerWatch.deployer_address == address,
                DeployerWatch.chain == chain,
            )
            .first()
        )

    try:
        with get_session() as session:
            existing = _find_existing(session)
            if existing:
                return _devwatch_dict(existing)
            watch = DeployerWatch(user_id=uid, deployer_address=address, chain=chain, label=label)
            session.add(watch)
            session.flush()
            result = _devwatch_dict(watch)
        return result
    except IntegrityError:
        # Lost a race against a concurrent identical insert — return the row
        # the other request created instead of erroring (idempotent add).
        with get_session() as session:
            existing = _find_existing(session)
            if existing:
                return _devwatch_dict(existing)
        raise HTTPException(status_code=409, detail="Could not add watch. Try again.")


@router.delete("/intel/devwatch/{watch_id}")
async def terminal_devwatch_delete(request: Request, watch_id: int):
    """Remove a watched deployer. Scoped to the signed-in user — a watch_id
    belonging to another user 404s rather than being deleted (no IDOR)."""
    uid = int(_terminal_user(request)["user_id"])
    from database.db import get_session
    from bot.models.intel import DeployerWatch

    with get_session() as session:
        watch = (
            session.query(DeployerWatch)
            .filter(DeployerWatch.id == watch_id, DeployerWatch.user_id == uid)
            .first()
        )
        if not watch:
            raise HTTPException(status_code=404, detail="Watch not found.")
        session.delete(watch)
    return {"ok": True}


@router.get("/intel/{chain}/{token_address}")
async def terminal_token_intel(chain: str, token_address: str, request: Request):
    """Full TokenIntelReport for a token, serialized via dataclasses.asdict.

    ``chain="auto"`` triggers the same address-family auto-detection used by
    the Telegram /intel command (bot.utils.validators.detect_address_chain +
    bot.handlers.intel._resolve_chain). Never 500s on an upstream data-source
    failure — TokenIntelService.analyze() already degrades field-by-field
    internally; if it somehow raises anyway, this still returns a valid
    (mostly-empty) report with a `notes` entry explaining the degradation.
    """
    from bot.handlers.intel import _resolve_chain as _intel_resolve_chain
    from bot.services.token_intel import token_intel_service
    from bot.services.token_intel.intel_service import TokenIntelReport
    from bot.utils.rate_limiter import RateLimitExceeded, UserRateLimiter
    from bot.utils.validators import detect_address_chain

    # This route is unauthenticated and each cache miss fans out to Blockscout /
    # DexScreener / RPC, so throttle per client IP to avoid amplifying abuse into
    # an upstream ban. Same UserRateLimiter pattern as the WhatsApp webhook.
    limiter = getattr(terminal_token_intel, "_limiter", None)
    if limiter is None:
        limiter = UserRateLimiter(max_requests=30, window_seconds=60)
        terminal_token_intel._limiter = limiter
    client_ip = request.client.host if request.client else "unknown"
    try:
        # NB: check() signals rejection by raising, it does not return False.
        await limiter.check(client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded, try again shortly",
            headers={"Retry-After": str(max(1, int(getattr(e, "retry_after", 60))))},
        )

    token_address = (token_address or "").strip()
    resolved_chain = (chain or "").strip()

    if resolved_chain.lower() == "auto":
        is_valid, chain_family = detect_address_chain(token_address)
        if not is_valid:
            report = TokenIntelReport(
                token_address=token_address,
                chain="unknown",
                notes=["auto_detect_invalid_address"],
            )
            return asdict(report)
        detected = _intel_resolve_chain(chain_family, None)
        if not detected:
            report = TokenIntelReport(
                token_address=token_address,
                chain=chain_family or "unknown",
                notes=[f"auto_detect_unsupported_chain_family_{chain_family}"],
            )
            return asdict(report)
        resolved_chain = detected

    try:
        report = await token_intel_service.analyze(token_address, resolved_chain)
    except Exception as e:
        logger.error(
            "terminal intel analyze failed for %s/%s: %s", resolved_chain, token_address, e
        )
        report = TokenIntelReport(
            token_address=token_address,
            chain=resolved_chain,
            notes=["intel_analysis_failed"],
        )

    return asdict(report)
