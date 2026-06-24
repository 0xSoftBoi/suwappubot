"""Public terminal data endpoints used by terminal.suwappu.bot."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from decimal import Decimal
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

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


# --- Per-token charts via GeckoTerminal pool OHLCV (any token, not just ETH/USDC) ---

# Suwappu chain name -> GeckoTerminal/DexScreener network ids.
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
}
DEXSCREENER_CHAIN = {  # GeckoTerminal network -> DexScreener chainId
    "eth": "ethereum",
    "base": "base",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "polygon_pos": "polygon",
    "bsc": "bsc",
    "avax": "avalanche",
    "solana": "solana",
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
    """Find the highest-liquidity pool for a token on a chain via DexScreener."""
    ds_chain = DEXSCREENER_CHAIN.get(network)
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
    if ds_chain:
        pairs = [p for p in pairs if (p.get("chainId") or "").lower() == ds_chain]
    if not pairs:
        return None
    best = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
    return best.get("pairAddress")


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

    # Any other token: GeckoTerminal pool OHLCV.
    network = GECKO_NETWORK.get(chain.lower())
    if not network:
        return []
    pool = await _resolve_pool(pair, network)
    if not pool:
        return []
    return await _gecko_ohlcv(network, pool, interval, limit)


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


def _to_float(value) -> Optional[float]:
    """Coerce Decimal/None/str to float for JSON serialization."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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
    local = perps_service.get_positions(uid, status="open")
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

    is_limit = (body.orderType or "market").lower() == "limit"

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
