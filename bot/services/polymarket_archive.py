"""Client for the Polymarket Orderbook Archive (archive.pendulumflow.com).

Free historical Polymarket orderbook data: hourly Parquet files, no auth,
CC BY 4.0. Three corpora ("eras") with DIFFERENT schemas that must not be
concatenated blindly:

- pmxt/v1/  mirror of pmxt's capture, 2026-02-21T18 .. 2026-04-16T05, no trades
- pmxt/v2/  mirror of pmxt's capture, 2026-04-13T19 .. 2026-08-09T23, trades
- v3/       pendulumflow's native capture, 2026-08-18T06 .. ongoing,
            microsecond arrival times + per-hour manifest.json sidecar

Files are huge (~10^8 rows/hour), so this module never parses Parquet: it
resolves eras, constructs download/manifest URLs, and fetches the archive's
small JSON metadata (COVERAGE.json, SCHEMA.json, INCIDENTS.json, manifests).
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bot.utils.cache import AsyncCache
from bot.utils.http_client import get_session
from bot.utils.retry import async_retry

logger = logging.getLogger(__name__)

ARCHIVE_BASE_URL = "https://archive.pendulumflow.com"

# The archive is CC BY 4.0 and donation-funded; it asks exactly one thing of
# automated readers: say where the data came from. Keep this on any surface
# that shows archive data.
ATTRIBUTION = (
    "Data: Polymarket Orderbook Archive (archive.pendulumflow.com), CC BY 4.0 — "
    "v3 by pendulumflow, pmxt eras by pmxt (archive.pmxt.dev). "
    "The archive is free and runs on donations."
)

# Range queries are URL construction only, but keep responses bounded.
MAX_RANGE_HOURS = 168


@dataclass(frozen=True)
class ArchiveEra:
    """One corpus of the archive. `end` is None while capture is ongoing."""

    key: str
    prefix: str  # URL prefix under the base, with trailing slash
    start: datetime
    end: Optional[datetime]
    event_types: tuple
    timestamp_unit: str  # "ms" or "us"
    has_trades: bool
    has_sequence: bool
    has_manifest: bool  # per-hour manifest.json sidecar (v3 only)
    note: str

    def hour_path(self, hour: datetime) -> str:
        stamp = hour.strftime("%Y-%m-%dT%H")
        if self.key == "v3":
            return f"v3/{hour.strftime('%Y-%m-%d')}/{hour.strftime('%H')}/{stamp}.parquet"
        return f"{self.prefix}polymarket_orderbook_{stamp}.parquet"

    def manifest_path(self, hour: datetime) -> Optional[str]:
        if not self.has_manifest:
            return None
        return f"v3/{hour.strftime('%Y-%m-%d')}/{hour.strftime('%H')}/manifest.json"

    def covers(self, hour: datetime) -> bool:
        if hour < self.start:
            return False
        return self.end is None or hour <= self.end


def _utc(y: int, m: int, d: int, h: int) -> datetime:
    return datetime(y, m, d, h, tzinfo=timezone.utc)


# Preference order on overlap: native v3, then v2 (has trades), then v1.
ERAS = (
    ArchiveEra(
        key="v3",
        prefix="v3/",
        start=_utc(2026, 8, 18, 6),
        end=None,
        event_types=(
            "best_bid_ask",
            "book",
            "last_trade_price",
            "market_resolved",
            "new_market",
            "price_change",
            "tick_size_change",
        ),
        timestamp_unit="us",
        has_trades=True,
        has_sequence=True,
        has_manifest=True,
        note=(
            "Native pendulumflow capture, replay grade: several machines, exact "
            "de-duplication via sequence, microsecond arrival times. "
            "timestamp_received is arrival time; use `timestamp` for event time."
        ),
    ),
    ArchiveEra(
        key="pmxt/v2",
        prefix="pmxt/v2/",
        start=_utc(2026, 4, 13, 19),
        end=_utc(2026, 8, 9, 23),
        event_types=("price_change", "book", "last_trade_price", "tick_size_change"),
        timestamp_unit="ms",
        has_trades=True,
        has_sequence=False,
        has_manifest=False,
        note=(
            "Mirror of pmxt's capture, snapshot grade, single source. No sequence "
            "column: ms timestamps can tie and export order is not guaranteed. "
            "Overlaps pmxt/v1 2026-04-13..04-16 with same basenames but different "
            "bytes — never key files by basename across eras."
        ),
    ),
    ArchiveEra(
        key="pmxt/v1",
        prefix="pmxt/v1/",
        start=_utc(2026, 2, 21, 18),
        end=_utc(2026, 4, 16, 5),
        event_types=("price_change", "book_snapshot"),
        timestamp_unit="ms",
        has_trades=False,
        has_sequence=False,
        has_manifest=False,
        note=(
            "Mirror of pmxt's earliest capture. Five columns, payload is a JSON "
            "string. Contains NO trade events and cannot be reconciled against "
            "on-chain fills. 23 hours exist but hold zero rows."
        ),
    ),
)

_ERAS_BY_KEY = {era.key: era for era in ERAS}

# Metadata files are small and change at most hourly.
_metadata_cache = AsyncCache(default_ttl=300)


def get_era(key: str) -> Optional[ArchiveEra]:
    return _ERAS_BY_KEY.get(key)


def resolve_era(hour: datetime, era_key: Optional[str] = None) -> Optional[ArchiveEra]:
    """Pick the era serving a UTC hour; preference v3 > pmxt/v2 > pmxt/v1."""
    hour = _floor_hour(hour)
    if era_key is not None:
        era = _ERAS_BY_KEY.get(era_key)
        return era if era is not None and era.covers(hour) else None
    for era in ERAS:
        if era.covers(hour):
            return era
    return None


def hour_urls(hour: datetime, era_key: Optional[str] = None) -> Optional[dict]:
    """Download + manifest URLs for one UTC hour, or None if no era serves it."""
    hour = _floor_hour(hour)
    era = resolve_era(hour, era_key)
    if era is None:
        return None
    manifest_path = era.manifest_path(hour)
    return {
        "hour_utc": hour.strftime("%Y-%m-%dT%H:00Z"),
        "era": era.key,
        "url": f"{ARCHIVE_BASE_URL}/{era.hour_path(hour)}",
        "manifest_url": (
            f"{ARCHIVE_BASE_URL}/{manifest_path}" if manifest_path is not None else None
        ),
    }


def hours_in_range(
    start: datetime,
    end: datetime,
    era_key: Optional[str] = None,
    max_hours: int = MAX_RANGE_HOURS,
) -> list:
    """Per-hour URL entries for [start, end], capped at max_hours.

    Hours no era serves are included with era=None so gaps are visible
    instead of silently dropped (the eras have real holes between them).
    """
    start, end = _floor_hour(start), _floor_hour(end)
    if end < start:
        raise ValueError("end is before start")
    if (end - start) > timedelta(hours=max_hours - 1):
        raise ValueError(f"range exceeds {max_hours} hours")
    out = []
    hour = start
    while hour <= end:
        entry = hour_urls(hour, era_key)
        if entry is None:
            entry = {
                "hour_utc": hour.strftime("%Y-%m-%dT%H:00Z"),
                "era": None,
                "url": None,
                "manifest_url": None,
            }
        out.append(entry)
        hour += timedelta(hours=1)
    return out


@async_retry(max_attempts=3, delay=1.0, backoff=2.0)
async def _fetch_json(path: str) -> Any:
    session = await get_session()
    url = f"{ARCHIVE_BASE_URL}/{path}"
    async with session.get(url) as resp:
        if resp.status == 404:
            return None
        resp.raise_for_status()
        return await resp.json(content_type=None)


async def _fetch_json_cached(path: str) -> Any:
    cached = await _metadata_cache.get(path)
    if cached is not None:
        return cached
    data = await _fetch_json(path)
    if data is not None:
        await _metadata_cache.set(path, data)
    return data


async def get_coverage(era_key: str) -> Any:
    """Per-hour coverage verdicts for one era (COVERAGE.json), or None."""
    era = _ERAS_BY_KEY.get(era_key)
    if era is None:
        return None
    return await _fetch_json_cached(f"{era.prefix}COVERAGE.json")


async def get_schema(era_key: str) -> Any:
    """Published Parquet schema for one era (SCHEMA.json), or None."""
    era = _ERAS_BY_KEY.get(era_key)
    if era is None:
        return None
    return await _fetch_json_cached(f"{era.prefix}SCHEMA.json")


async def get_incidents() -> Any:
    """The archive's incident register (INCIDENTS.json), or None."""
    return await _fetch_json_cached("INCIDENTS.json")


async def get_hour_manifest(hour: datetime) -> Any:
    """v3 hour manifest (sha256, row counts, witness stats pointer), or None."""
    era = resolve_era(hour, "v3")
    if era is None:
        return None
    path = era.manifest_path(_floor_hour(hour))
    return await _fetch_json_cached(path)


def _floor_hour(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
