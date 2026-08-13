"""Market data capture service — Phase 2 of docs/plans/market-data-parity.md.

capture -> normalize -> store: polls tracked-token USD prices every 60s,
aggregates into 1m OHLCV candles, rolls those up into 5m/1h/1d candles, and
does a one-time tiered backfill from GeckoTerminal on startup: ~365 days of
1d candles, ~30 days of 1h candles, and ~24h of 1m candles per (symbol,
chain). Feeds the ``market_candles`` table (bot/models/market_data.py) that
the api-ts Historical API (Phase 3) serves from.

Lifecycle mirrors bot/services/alerts.py / bot/services/hl_ws_alerts.py:
a start(bot=None)/stop() pair, an internal feature-flag no-op guard, and all
DB access performed with sync SQLAlchemy sessions run through
``database.db.run_in_db`` (thread pool) so the event loop is never blocked.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from bot.config.settings import settings
from bot.config.tokens import TOKENS
from bot.models.advanced import AdvancedPriceAlert as PriceAlert
from bot.services.price_service import price_service
from bot.utils.http_client import get_session as get_http_session
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# Suwappu chain slug -> GeckoTerminal network id. Mirrors the verified subset in
# api/routes/terminal.py's GECKO_NETWORK. Duplicated (not imported) on purpose —
# bot/services must not depend on api/routes (that would invert the layering:
# api/ already depends on bot/). Chains missing here simply skip backfill; the
# 60s capture + rollup loops work for every tracked token regardless.
GECKO_NETWORK = {
    "ethereum": "eth",
    "base": "base",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "polygon": "polygon_pos",
    "bsc": "bsc",
    "avalanche": "avax",
    "solana": "solana",
}
DEXSCREENER_CHAIN = {  # GeckoTerminal network id -> DexScreener chainId
    "eth": "ethereum",
    "base": "base",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "polygon_pos": "polygon",
    "bsc": "bsc",
    "avax": "avalanche",
    "solana": "solana",
}

CAPTURE_SOURCE = "coingecko"
BACKFILL_SOURCE = "geckoterminal"
BACKFILL_SLEEP_SECONDS = 1.5  # be polite to GeckoTerminal/DexScreener

# (our timeframe, GeckoTerminal ohlcv path segment, aggregate, candle limit).
# Mirrors api/routes/terminal.py's GECKO_TIMEFRAME. Backfilled in this order
# (coarsest first) per (symbol, chain); each tier only runs if that
# symbol/chain/timeframe has no rows yet.
BACKFILL_TIERS = [
    ("1d", "day", 1, 365),  # ~365 days of 1d candles
    ("1h", "hour", 1, 24 * 30),  # ~30 days of 1h candles
    ("1m", "minute", 1, 24 * 60),  # ~24h of 1m candles
]

# (source_timeframe, target_timeframe, bucket_seconds, lookback)
ROLLUP_SPECS = [
    ("1m", "5m", 300, timedelta(days=2)),
    ("5m", "1h", 3600, timedelta(days=30)),
    ("1h", "1d", 86400, timedelta(days=400)),
]

_UPSERT_SQL_PG = text("""
    INSERT INTO market_candles
        (symbol, chain, token_address, timeframe, ts, open, high, low, close, volume, source)
    VALUES
        (:symbol, :chain, :token_address, :timeframe, :ts, :open, :high, :low, :close, :volume, :source)
    ON CONFLICT (symbol, chain, timeframe, ts) DO UPDATE SET
        high = GREATEST(market_candles.high, EXCLUDED.high),
        low = LEAST(market_candles.low, EXCLUDED.low),
        close = EXCLUDED.close,
        volume = COALESCE(EXCLUDED.volume, market_candles.volume),
        source = EXCLUDED.source
    """)

_UPSERT_SQL_SQLITE = text("""
    INSERT INTO market_candles
        (symbol, chain, token_address, timeframe, ts, open, high, low, close, volume, source)
    VALUES
        (:symbol, :chain, :token_address, :timeframe, :ts, :open, :high, :low, :close, :volume, :source)
    ON CONFLICT (symbol, chain, timeframe, ts) DO UPDATE SET
        high = MAX(market_candles.high, excluded.high),
        low = MIN(market_candles.low, excluded.low),
        close = excluded.close,
        volume = COALESCE(excluded.volume, market_candles.volume),
        source = excluded.source
    """)

_INSERT_IGNORE_SQL = text("""
    INSERT INTO market_candles
        (symbol, chain, token_address, timeframe, ts, open, high, low, close, volume, source)
    VALUES
        (:symbol, :chain, :token_address, :timeframe, :ts, :open, :high, :low, :close, :volume, :source)
    ON CONFLICT (symbol, chain, timeframe, ts) DO NOTHING
    """)


class MarketDataService:
    """Captures tracked-token USD prices into 1m/5m/1h/1d OHLCV candles."""

    def __init__(self):
        self._running = False
        self._capture_task: Optional[asyncio.Task] = None
        self._rollup_task: Optional[asyncio.Task] = None
        self._backfill_task: Optional[asyncio.Task] = None
        self._capture_interval = 60
        self._rollup_interval = 300  # 5 minutes

    # === Lifecycle ===

    async def start(self, bot=None):
        if self._running:
            return
        if not getattr(settings, "market_data_capture_enabled", True):
            logger.info("Market data capture disabled (MARKET_DATA_CAPTURE_ENABLED=false)")
            return

        self._running = True
        self._capture_task = asyncio.create_task(self._capture_loop())
        self._rollup_task = asyncio.create_task(self._rollup_loop())
        # Backfill is one-shot and can take a while (many tokens x rate-limited
        # upstreams) — fire-and-forget so startup is never blocked on it.
        self._backfill_task = asyncio.create_task(self._backfill_once())
        logger.info("Market data capture service started")

    async def stop(self):
        self._running = False
        for task in (self._capture_task, self._rollup_task, self._backfill_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("Market data capture service stopped")

    # === Tracked set ===

    def _get_tracked_symbol_chain_map(self) -> dict[str, str]:
        """Union of bot/config/tokens.py registry symbols + active alert symbols.

        Maps SYMBOL -> one canonical chain slug to store candles under. Price is
        chain-agnostic USD (price_service), so one representative chain per
        symbol (the token's first registered chain, or the alert's chain for
        alert-only symbols) is enough to satisfy the (symbol, chain, timeframe,
        ts) unique key.
        """
        mapping: dict[str, str] = {}
        for symbol, cfg in TOKENS.items():
            if cfg.addresses:
                mapping[symbol.upper()] = next(iter(cfg.addresses))

        try:
            with get_session() as session:
                rows = (
                    session.query(PriceAlert.token_symbol, PriceAlert.chain)
                    .filter(PriceAlert.is_active == True)
                    .distinct()
                    .all()
                )
            for symbol, chain in rows:
                su = (symbol or "").strip().upper()
                if su and su not in mapping:
                    mapping[su] = (chain or "ethereum").strip().lower()
        except Exception as e:
            logger.warning(f"market_data: could not load alert tokens: {e}")

        return mapping

    # === Capture: 1m candle ticks ===

    async def _capture_loop(self):
        while self._running:
            try:
                await self._capture_tick()
            except Exception as e:
                logger.error(f"market_data: capture tick failed: {e}")
            await asyncio.sleep(self._capture_interval)

    async def _capture_tick(self):
        symbol_chain = await run_in_db(self._get_tracked_symbol_chain_map)
        if not symbol_chain:
            return

        symbols = list(symbol_chain.keys())
        try:
            prices = await asyncio.wait_for(price_service.get_prices(symbols), timeout=15)
        except asyncio.TimeoutError:
            logger.warning("market_data: price fetch timed out; skipping this tick")
            return
        except Exception as e:
            logger.warning(f"market_data: price fetch failed: {e}")
            return

        # Single fetch per 60s tick == single sample per 1m bucket, so this
        # tick's price is open=high=low=close for that candle. The upsert
        # still widens high/low on conflict so a restart mid-minute or a
        # second write to the same bucket stays correct.
        bucket = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        rows = []
        for symbol, price in prices.items():
            if price is None or price <= 0:
                continue
            chain = symbol_chain.get(symbol)
            if not chain:
                continue
            token_address = None
            cfg = TOKENS.get(symbol)
            if cfg:
                token_address = cfg.addresses.get(chain)
            rows.append(
                dict(
                    symbol=symbol,
                    chain=chain,
                    token_address=token_address,
                    timeframe="1m",
                    ts=bucket,
                    open=float(price),
                    high=float(price),
                    low=float(price),
                    close=float(price),
                    volume=None,
                    source=CAPTURE_SOURCE,
                )
            )

        if not rows:
            return

        await run_in_db(self._upsert_rows, rows)

    def _upsert_rows(self, rows: list[dict]):
        with get_session() as session:
            dialect = session.bind.dialect.name if session.bind is not None else ""
            sql = _UPSERT_SQL_PG if dialect == "postgresql" else _UPSERT_SQL_SQLITE
            for row in rows:
                try:
                    session.execute(sql, row)
                except Exception as e:
                    logger.warning(
                        f"market_data: upsert failed for {row['symbol']}/{row['chain']}"
                        f"/{row['timeframe']}@{row['ts']}: {e}"
                    )

    def _insert_ignore_rows(self, rows: list[dict]):
        with get_session() as session:
            for row in rows:
                try:
                    session.execute(_INSERT_IGNORE_SQL, row)
                except Exception as e:
                    logger.warning(
                        f"market_data: backfill insert failed for {row['symbol']}/{row['chain']}"
                        f"/{row['timeframe']}@{row['ts']}: {e}"
                    )

    # === Rollup: 1m -> 5m -> 1h -> 1d ===

    async def _rollup_loop(self):
        while self._running:
            try:
                await run_in_db(self._rollup_all)
            except Exception as e:
                logger.error(f"market_data: rollup failed: {e}")
            await asyncio.sleep(self._rollup_interval)

    def _rollup_all(self):
        for source_tf, target_tf, bucket_seconds, lookback in ROLLUP_SPECS:
            try:
                self._rollup_timeframe(source_tf, target_tf, bucket_seconds, lookback)
            except Exception as e:
                logger.warning(f"market_data: rollup {source_tf}->{target_tf} failed: {e}")

    def _rollup_timeframe(
        self, source_tf: str, target_tf: str, bucket_seconds: int, lookback: timedelta
    ):
        """Aggregate completed source-timeframe candles into target-timeframe rows.

        Done in Python (not a DB-side date_trunc) so it's identical across
        sqlite (dev) and postgres (prod) — the two dialects bucket timestamps
        differently and this only runs on a handful of tracked tokens.
        """
        from bot.models.market_data import MarketCandle

        now = datetime.now(timezone.utc)
        cutoff = now - lookback

        with get_session() as session:
            rows = (
                session.query(MarketCandle)
                .filter(MarketCandle.timeframe == source_tf, MarketCandle.ts >= cutoff)
                .order_by(MarketCandle.symbol, MarketCandle.chain, MarketCandle.ts.asc())
                .all()
            )

            buckets: dict[tuple, list] = {}
            for row in rows:
                ts = row.ts if row.ts.tzinfo else row.ts.replace(tzinfo=timezone.utc)
                bucket_start_epoch = int(ts.timestamp() // bucket_seconds) * bucket_seconds
                bucket_start = datetime.fromtimestamp(bucket_start_epoch, tz=timezone.utc)
                key = (row.symbol, row.chain, bucket_start)
                buckets.setdefault(key, []).append(row)

            upserts = []
            for (symbol, chain, bucket_start), candles in buckets.items():
                # Only roll up buckets that have fully elapsed, so an
                # in-progress bucket isn't prematurely finalized.
                if now < bucket_start + timedelta(seconds=bucket_seconds):
                    continue
                candles.sort(key=lambda c: c.ts)
                volumes = [float(c.volume) for c in candles if c.volume is not None]
                upserts.append(
                    dict(
                        symbol=symbol,
                        chain=chain,
                        token_address=candles[-1].token_address,
                        timeframe=target_tf,
                        ts=bucket_start,
                        open=float(candles[0].open),
                        high=max(float(c.high) for c in candles),
                        low=min(float(c.low) for c in candles),
                        close=float(candles[-1].close),
                        volume=(sum(volumes) if volumes else None),
                        source=candles[-1].source,
                    )
                )

            if not upserts:
                return

            dialect = session.bind.dialect.name if session.bind is not None else ""
            sql = _UPSERT_SQL_PG if dialect == "postgresql" else _UPSERT_SQL_SQLITE
            for row in upserts:
                try:
                    session.execute(sql, row)
                except Exception as e:
                    logger.warning(
                        f"market_data: rollup upsert failed for {row['symbol']}/{row['chain']}"
                        f"/{row['timeframe']}@{row['ts']}: {e}"
                    )

    # === Backfill: one-time tiered candles from GeckoTerminal ===
    # 1d (~365d) -> 1h (~30d) -> 1m (~24h), per (symbol, chain). Each tier is
    # independently guarded so a partially-backfilled symbol (e.g. only 1d
    # done from a prior deploy) only fetches the tiers still missing.

    async def _backfill_once(self):
        try:
            symbol_chain = await run_in_db(self._get_tracked_symbol_chain_map)
        except Exception as e:
            logger.error(f"market_data: backfill token lookup failed: {e}")
            return

        for symbol, chain in symbol_chain.items():
            if not self._running:
                return
            network = GECKO_NETWORK.get(chain)
            if not network:
                continue  # chain not covered by our GeckoTerminal aliases

            cfg = TOKENS.get(symbol)
            token_address = cfg.addresses.get(chain) if cfg else None
            if not token_address:
                continue

            pool: Optional[str] = None
            pool_resolved = False
            for timeframe, gecko_timeframe, aggregate, limit in BACKFILL_TIERS:
                if not self._running:
                    return

                try:
                    already_backfilled = await run_in_db(self._has_rows, symbol, chain, timeframe)
                    if already_backfilled:
                        continue

                    if not pool_resolved:
                        pool = await self._resolve_pool(token_address, network)
                        pool_resolved = True
                        await asyncio.sleep(BACKFILL_SLEEP_SECONDS)
                    if not pool:
                        break  # no pool found; skip remaining tiers for this token

                    candles = await self._fetch_geckoterminal_ohlcv(
                        network, pool, gecko_timeframe, aggregate, limit
                    )
                    if candles:
                        rows = [
                            dict(
                                symbol=symbol,
                                chain=chain,
                                token_address=token_address,
                                timeframe=timeframe,
                                ts=datetime.fromtimestamp(c["time"], tz=timezone.utc),
                                open=c["open"],
                                high=c["high"],
                                low=c["low"],
                                close=c["close"],
                                volume=c.get("volume"),
                                source=BACKFILL_SOURCE,
                            )
                            for c in candles
                        ]
                        await run_in_db(self._insert_ignore_rows, rows)
                        logger.info(
                            f"market_data: backfilled {len(rows)} {timeframe} candles"
                            f" for {symbol}/{chain}"
                        )
                except Exception as e:
                    logger.warning(
                        f"market_data: {timeframe} backfill failed for {symbol}/{chain}: {e}"
                    )

                await asyncio.sleep(BACKFILL_SLEEP_SECONDS)

    def _has_rows(self, symbol: str, chain: str, timeframe: str) -> bool:
        from bot.models.market_data import MarketCandle

        with get_session() as session:
            exists = (
                session.query(MarketCandle.id)
                .filter(
                    MarketCandle.symbol == symbol,
                    MarketCandle.chain == chain,
                    MarketCandle.timeframe == timeframe,
                )
                .first()
            )
            return exists is not None

    async def _resolve_pool(self, token_address: str, network: str) -> Optional[str]:
        """Find the highest-liquidity pool for a token on a chain via DexScreener."""
        ds_chain = DEXSCREENER_CHAIN.get(network)
        try:
            session = await get_http_session()
            url = f"https://api.dexscreener.com/latest/dex/tokens/{token_address}"
            async with session.get(url, headers={"User-Agent": "suwappu-market-data/1.0"}) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                pairs = data.get("pairs") or []
        except Exception:
            return None
        if ds_chain:
            pairs = [p for p in pairs if (p.get("chainId") or "").lower() == ds_chain]
        if not pairs:
            return None
        best = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
        return best.get("pairAddress")

    async def _fetch_geckoterminal_ohlcv(
        self, network: str, pool: str, gecko_timeframe: str, aggregate: int, limit: int
    ) -> list[dict]:
        url = f"https://api.geckoterminal.com/api/v2/networks/{network}/pools/{pool}/ohlcv/{gecko_timeframe}"
        try:
            session = await get_http_session()
            async with session.get(
                url,
                params={"aggregate": aggregate, "limit": min(limit, 1000)},
                headers={
                    "User-Agent": "suwappu-market-data/1.0",
                    "Accept": "application/json",
                },
            ) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                ohlcv = (data.get("data") or {}).get("attributes", {}).get("ohlcv_list") or []
        except Exception:
            return []

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
        return candles


# Global instance
market_data_service = MarketDataService()
