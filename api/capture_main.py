"""Capture-only entrypoint for the market-data platform.

`api.main` boots the whole product: the Telegram bot plus fee_sweeper,
order_service, tx_poller, alert_service and friends. Running a second copy of
that against a shared database would double-run money paths (fee sweeps, limit
orders), so it is NOT safe to scale out for data capture.

This entrypoint starts ONLY the two read-only capture services:

  * market_data_service — OHLCV candles (CoinGecko poll + GeckoTerminal backfill)
  * venue_data_service  — Hyperliquid perp metrics, Polymarket odds, Morpho rates

Both are append-only writers into market_candles / perp_metrics /
prediction_snapshots / lend_metrics. No wallet, fee, order or bot code runs
here, so this can be deployed alongside the main service safely.

Run with:  uvicorn api.capture_main:app --host 0.0.0.0 --port $PORT
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

logger = logging.getLogger(__name__)

_started: list[str] = []
_errors: dict[str, str] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from database.db import init_db

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for the capture worker")

    # Creates/updates market_candles, perp_metrics, prediction_snapshots and
    # lend_metrics via _ensure_schema(). Additive + idempotent, and safe to run
    # concurrently with the main service doing the same.
    if not init_db(database_url):
        raise RuntimeError("init_db failed — capture worker cannot start")
    logger.info("✓ Database ready (schema ensured)")

    from bot.services.market_data import market_data_service
    from bot.services.venue_data import venue_data_service

    for name, service in (
        ("market_data", market_data_service),
        ("venue_data", venue_data_service),
    ):
        try:
            await service.start()
            _started.append(name)
            logger.info("✓ %s capture service started", name)
        except Exception as exc:  # never let one bad source block the other
            _errors[name] = str(exc)
            logger.error("✗ %s capture service failed to start: %s", name, exc)

    try:
        yield
    finally:
        for name, service in (
            ("market_data", market_data_service),
            ("venue_data", venue_data_service),
        ):
            try:
                await service.stop()
            except Exception as exc:
                logger.warning("%s capture service stop failed: %s", name, exc)


app = FastAPI(title="Suwappu Market Data Capture", lifespan=lifespan)


@app.get("/health")
async def health():
    """Railway healthcheck. Degraded (not failed) if a source errored, so one
    dead upstream doesn't crash-loop the worker."""
    return {
        "status": "ok" if not _errors else "degraded",
        "service": "suwappu-market-data-capture",
        "started": _started,
        "errors": _errors,
    }
