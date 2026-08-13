"""Venue data capture service — Round 5 of docs/plans/market-data-parity.md.

capture -> normalize -> store for three "Databento of web3" datasets nobody
else persists a time series of:

  * **Perps** (60s): Hyperliquid REST ``metaAndAssetCtxs`` — funding rate,
    open interest, mark/index price, 24h volume per market. Feeds
    ``perp_metrics`` (bot/models/market_data.py).
  * **Predictions** (300s / 5 min): Polymarket Gamma active markets sorted by
    volume — per-outcome implied probability, volume, liquidity, end date.
    Feeds ``prediction_snapshots``.
  * **Lend** (600s / 10 min): Morpho GraphQL markets — supply/borrow APY,
    TVL, utilization per lending market. Feeds ``lend_metrics``.

Lifecycle mirrors bot/services/market_data.py: a start(bot=None)/stop() pair,
a settings feature-flag no-op guard, three independent asyncio loops (one per
dataset, each with its own interval), and all DB access through
``database.db.run_in_db`` so the event loop is never blocked. Every loop
iteration is wrapped in try/except so a bad/missing upstream response never
kills the loop — it just logs a warning and retries on the next tick.

The row-normalization functions (``normalize_hyperliquid_perp_metrics``,
``normalize_polymarket_market``, ``normalize_morpho_market``) are pure —
no I/O — so they're unit-testable against captured/synthetic payloads
without a network call. Every numeric field is parsed defensively via
``Decimal(str(...))``; unparseable values become ``None`` rather than
raising, and rows with no usable identity (missing symbol/market id) are
skipped.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from sqlalchemy import text

from bot.config.settings import settings
from bot.services.hyperliquid_client import hyperliquid_client
from bot.services.morpho_api import morpho_api as morpho_api_client
from bot.services.polymarket_api import GAMMA_BASE_URL
from bot.utils.http_client import get_session as get_http_session
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

MAX_QUESTION_LEN = 500

PREDICTION_MARKET_LIMIT = 100
LEND_MARKET_LIMIT = 100

_PERP_INSERT_IGNORE_SQL = text("""
    INSERT INTO perp_metrics
        (venue, symbol, ts, funding_rate, open_interest, mark_price, index_price, volume_24h)
    VALUES
        (:venue, :symbol, :ts, :funding_rate, :open_interest, :mark_price, :index_price, :volume_24h)
    ON CONFLICT (venue, symbol, ts) DO NOTHING
    """)

_PREDICTION_INSERT_IGNORE_SQL = text("""
    INSERT INTO prediction_snapshots
        (venue, market_id, condition_id, question, outcome, ts, price, volume, liquidity, end_date)
    VALUES
        (:venue, :market_id, :condition_id, :question, :outcome, :ts, :price, :volume, :liquidity, :end_date)
    ON CONFLICT (venue, market_id, outcome, ts) DO NOTHING
    """)

_LEND_INSERT_IGNORE_SQL = text("""
    INSERT INTO lend_metrics
        (venue, market_id, chain_id, loan_symbol, collateral_symbol, ts,
         supply_apy, borrow_apy, tvl, utilization)
    VALUES
        (:venue, :market_id, :chain_id, :loan_symbol, :collateral_symbol, :ts,
         :supply_apy, :borrow_apy, :tvl, :utilization)
    ON CONFLICT (venue, market_id, ts) DO NOTHING
    """)

# Morpho public GraphQL — top lending markets by supply, across all chains.
# ``totalSupplyUsd`` is aliased onto ``supplyAssetsUsd`` (the schema's actual
# TVL field) so the row shape below can read a stable key regardless of which
# name the API exposes at a given time.
_MORPHO_MARKETS_QUERY = """
query TopLendMarkets($first: Int!) {
  markets(first: $first, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
    items {
      uniqueKey
      loanAsset { symbol }
      collateralAsset { symbol }
      morphoBlue { chain { id } }
      state {
        supplyApy
        borrowApy
        utilization
        totalSupplyUsd: supplyAssetsUsd
      }
    }
  }
}
"""


# === Time bucketing ===


def bucket_minute(now: datetime) -> datetime:
    """Truncate to the minute boundary (perp snapshots, 60s cadence)."""
    return now.replace(second=0, microsecond=0)


def bucket_n_minutes(now: datetime, n: int) -> datetime:
    """Truncate to the nearest ``n``-minute boundary (predictions=5, lend=10)."""
    floored = (now.minute // n) * n
    return now.replace(minute=floored, second=0, microsecond=0)


# === Defensive parsing helpers ===


def _safe_decimal(value: Any) -> Optional[Decimal]:
    """Parse a possibly-stringified numeric venue field into a Decimal.

    Returns ``None`` (never raises) for missing/unparseable values so a
    single bad field degrades that column, not the whole row.
    """
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not d.is_finite():
        return None
    return d


def _maybe_json_list(value: Any) -> list:
    """Gamma returns outcomes/prices as either a real list or a JSON string."""
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            return []
    return []


def _parse_datetime(value: Any) -> Optional[datetime]:
    """Parse Gamma's ISO8601 (often ``...Z``-suffixed) end-date strings."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(v)
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _row_for_sql(row: dict) -> dict:
    """Convert Decimal values to float for raw-SQL param binding.

    sqlite3's DB-API does not accept ``Decimal`` as a bound parameter type
    (unlike the ORM's typed Numeric columns, which convert automatically);
    Postgres/psycopg2 handles Decimal fine, so this is a no-op there but kept
    uniform for both backends, mirroring market_data.py's float-at-the-edge
    convention.
    """
    out = {}
    for k, v in row.items():
        out[k] = float(v) if isinstance(v, Decimal) else v
    return out


# === Normalization: Hyperliquid perps ===


def normalize_hyperliquid_perp_metrics(payload: Any, ts: datetime) -> list[dict]:
    """Normalize a raw ``metaAndAssetCtxs`` response into perp_metrics rows.

    ``payload`` is the two-element list Hyperliquid's ``/info`` endpoint
    returns for that request type: ``[meta, asset_ctxs]``, where
    ``meta["universe"][i]`` pairs positionally with ``asset_ctxs[i]`` — one
    entry per perp market. Malformed/short payloads yield an empty list
    rather than raising.
    """
    rows: list[dict] = []
    if not isinstance(payload, (list, tuple)) or len(payload) < 2:
        return rows
    meta, asset_ctxs = payload[0], payload[1]
    if not isinstance(meta, dict) or not isinstance(asset_ctxs, list):
        return rows
    universe = meta.get("universe")
    if not isinstance(universe, list):
        return rows

    for i, info in enumerate(universe):
        if i >= len(asset_ctxs):
            break
        if not isinstance(info, dict):
            continue
        ctx = asset_ctxs[i]
        if not isinstance(ctx, dict):
            continue
        name = info.get("name")
        if not name or not str(name).strip():
            continue
        rows.append(
            dict(
                venue="hyperliquid",
                symbol=str(name).strip(),
                ts=ts,
                funding_rate=_safe_decimal(ctx.get("funding")),
                open_interest=_safe_decimal(ctx.get("openInterest")),
                mark_price=_safe_decimal(ctx.get("markPx")),
                index_price=_safe_decimal(ctx.get("oraclePx")),
                volume_24h=_safe_decimal(ctx.get("dayNtlVlm")),
            )
        )
    return rows


# === Normalization: Polymarket predictions ===


def normalize_polymarket_market(data: dict, ts: datetime) -> list[dict]:
    """Normalize one raw Gamma market dict into one prediction_snapshots row
    per outcome. Returns an empty list for a market with no usable
    outcomes/prices or no identity (market id / condition id)."""
    rows: list[dict] = []
    if not isinstance(data, dict):
        return rows

    raw_id = data.get("id")
    condition_id = data.get("conditionId") or data.get("condition_id")
    market_id = str(raw_id).strip() if raw_id is not None else ""
    if not market_id and condition_id:
        market_id = str(condition_id).strip()
    if not market_id:
        return rows

    question = str(data.get("question") or "").strip()[:MAX_QUESTION_LEN] or None

    outcomes = _maybe_json_list(data.get("outcomes"))
    prices = _maybe_json_list(data.get("outcomePrices"))
    if not outcomes or not prices:
        return rows

    volume = _safe_decimal(data.get("volumeNum", data.get("volume")))
    liquidity = _safe_decimal(data.get("liquidityNum", data.get("liquidity")))
    end_date = _parse_datetime(data.get("endDate") or data.get("end_date_iso"))

    for i, outcome in enumerate(outcomes):
        if i >= len(prices):
            break
        outcome_name = str(outcome).strip()
        if not outcome_name:
            continue
        rows.append(
            dict(
                venue="polymarket",
                market_id=market_id,
                condition_id=str(condition_id).strip() if condition_id else None,
                question=question,
                outcome=outcome_name,
                ts=ts,
                price=_safe_decimal(prices[i]),
                volume=volume,
                liquidity=liquidity,
                end_date=end_date,
            )
        )
    return rows


# === Normalization: Morpho lend markets ===


def normalize_morpho_market(item: dict, ts: datetime) -> Optional[dict]:
    """Normalize one raw Morpho GraphQL market item into a lend_metrics row.

    Returns ``None`` for an item with no ``uniqueKey`` (no usable identity).
    """
    if not isinstance(item, dict):
        return None
    market_id = str(item.get("uniqueKey") or "").strip()
    if not market_id:
        return None

    loan_asset = item.get("loanAsset") or {}
    collateral_asset = item.get("collateralAsset") or {}
    morpho_blue = item.get("morphoBlue") or {}
    chain = morpho_blue.get("chain") or {} if isinstance(morpho_blue, dict) else {}
    state = item.get("state") or {}
    if not isinstance(state, dict):
        state = {}

    chain_id = None
    raw_chain_id = chain.get("id") if isinstance(chain, dict) else None
    if raw_chain_id is not None:
        try:
            chain_id = int(raw_chain_id)
        except (TypeError, ValueError):
            chain_id = None

    loan_symbol = loan_asset.get("symbol") if isinstance(loan_asset, dict) else None
    collateral_symbol = (
        collateral_asset.get("symbol") if isinstance(collateral_asset, dict) else None
    )

    return dict(
        venue="morpho",
        market_id=market_id,
        chain_id=chain_id,
        loan_symbol=(str(loan_symbol).strip() if loan_symbol else None),
        collateral_symbol=(str(collateral_symbol).strip() if collateral_symbol else None),
        ts=ts,
        supply_apy=_safe_decimal(state.get("supplyApy")),
        borrow_apy=_safe_decimal(state.get("borrowApy")),
        tvl=_safe_decimal(state.get("totalSupplyUsd")),
        utilization=_safe_decimal(state.get("utilization")),
    )


class VenueDataService:
    """Captures perp/prediction/lend venue metrics on three independent loops."""

    def __init__(self):
        self._running = False
        self._perp_task: Optional[asyncio.Task] = None
        self._prediction_task: Optional[asyncio.Task] = None
        self._lend_task: Optional[asyncio.Task] = None

        self._perp_interval = 60
        self._prediction_interval = 300
        self._lend_interval = 600

        self._prediction_market_limit = PREDICTION_MARKET_LIMIT
        self._lend_market_limit = LEND_MARKET_LIMIT

    # === Lifecycle ===

    async def start(self, bot=None):
        if self._running:
            return
        if not getattr(settings, "venue_data_capture_enabled", True):
            logger.info("Venue data capture disabled (VENUE_DATA_CAPTURE_ENABLED=false)")
            return

        self._running = True
        self._perp_task = asyncio.create_task(self._perp_loop())
        self._prediction_task = asyncio.create_task(self._prediction_loop())
        self._lend_task = asyncio.create_task(self._lend_loop())
        logger.info("Venue data capture service started")

    async def stop(self):
        self._running = False
        for task in (self._perp_task, self._prediction_task, self._lend_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("Venue data capture service stopped")

    # === Perps: Hyperliquid metaAndAssetCtxs, 60s ===

    async def _perp_loop(self):
        while self._running:
            try:
                await self._perp_tick()
            except Exception as e:
                logger.error(f"venue_data: perp tick failed: {e}")
            await asyncio.sleep(self._perp_interval)

    async def _perp_tick(self):
        try:
            payload = await hyperliquid_client.get_meta_and_asset_ctxs()
        except Exception as e:
            logger.warning(f"venue_data: hyperliquid metaAndAssetCtxs fetch failed: {e}")
            return
        if not payload:
            return

        ts = bucket_minute(datetime.now(timezone.utc))
        rows = normalize_hyperliquid_perp_metrics(payload, ts)
        if not rows:
            return

        await run_in_db(self._insert_ignore_perp_rows, rows)

    def _insert_ignore_perp_rows(self, rows: list[dict]):
        with get_session() as session:
            for row in rows:
                try:
                    session.execute(_PERP_INSERT_IGNORE_SQL, _row_for_sql(row))
                except Exception as e:
                    logger.warning(
                        f"venue_data: perp insert failed for {row.get('symbol')}@{row.get('ts')}: {e}"
                    )

    # === Predictions: Polymarket Gamma, 300s ===

    async def _prediction_loop(self):
        while self._running:
            try:
                await self._prediction_tick()
            except Exception as e:
                logger.error(f"venue_data: prediction tick failed: {e}")
            await asyncio.sleep(self._prediction_interval)

    async def _prediction_tick(self):
        markets = await self._fetch_top_prediction_markets(self._prediction_market_limit)
        if not markets:
            return

        ts = bucket_n_minutes(datetime.now(timezone.utc), 5)
        rows: list[dict] = []
        for m in markets:
            try:
                rows.extend(normalize_polymarket_market(m, ts))
            except Exception as e:
                logger.warning(f"venue_data: polymarket market normalize failed: {e}")

        if not rows:
            return

        await run_in_db(self._insert_ignore_prediction_rows, rows)

    async def _fetch_top_prediction_markets(self, limit: int) -> list[dict]:
        """Top active Polymarket markets by volume via the Gamma markets list."""
        try:
            session = await get_http_session()
            params = {
                "_limit": limit,
                "active": "true",
                "closed": "false",
                "order": "volume",
                "ascending": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/markets", params=params) as resp:
                if resp.status != 200:
                    logger.warning(f"venue_data: polymarket markets list returned {resp.status}")
                    return []
                data = await resp.json()
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.warning(f"venue_data: polymarket markets list fetch failed: {e}")
            return []

    def _insert_ignore_prediction_rows(self, rows: list[dict]):
        with get_session() as session:
            for row in rows:
                try:
                    session.execute(_PREDICTION_INSERT_IGNORE_SQL, _row_for_sql(row))
                except Exception as e:
                    logger.warning(
                        f"venue_data: prediction insert failed for "
                        f"{row.get('market_id')}/{row.get('outcome')}@{row.get('ts')}: {e}"
                    )

    # === Lend: Morpho GraphQL, 600s ===

    async def _lend_loop(self):
        while self._running:
            try:
                await self._lend_tick()
            except Exception as e:
                logger.error(f"venue_data: lend tick failed: {e}")
            await asyncio.sleep(self._lend_interval)

    async def _lend_tick(self):
        items = await self._fetch_top_lend_markets(self._lend_market_limit)
        if not items:
            return

        ts = bucket_n_minutes(datetime.now(timezone.utc), 10)
        rows: list[dict] = []
        for item in items:
            try:
                row = normalize_morpho_market(item, ts)
            except Exception as e:
                logger.warning(f"venue_data: morpho market normalize failed: {e}")
                continue
            if row:
                rows.append(row)

        if not rows:
            return

        await run_in_db(self._insert_ignore_lend_rows, rows)

    async def _fetch_top_lend_markets(self, limit: int) -> list[dict]:
        """Top Morpho lending markets by supply, via the public GraphQL API."""
        try:
            data = await morpho_api_client._graphql(_MORPHO_MARKETS_QUERY, {"first": limit})
            items = ((data or {}).get("markets") or {}).get("items") or []
            return items if isinstance(items, list) else []
        except Exception as e:
            logger.warning(f"venue_data: morpho markets list fetch failed: {e}")
            return []

    def _insert_ignore_lend_rows(self, rows: list[dict]):
        with get_session() as session:
            for row in rows:
                try:
                    session.execute(_LEND_INSERT_IGNORE_SQL, _row_for_sql(row))
                except Exception as e:
                    logger.warning(
                        f"venue_data: lend insert failed for "
                        f"{row.get('market_id')}@{row.get('ts')}: {e}"
                    )


# Global instance
venue_data_service = VenueDataService()
