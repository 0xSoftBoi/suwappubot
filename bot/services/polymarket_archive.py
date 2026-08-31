"""Client for the Polymarket Orderbook Archive (archive.pendulumflow.com).

Free historical Polymarket orderbook data: hourly Parquet files, no auth,
CC BY 4.0. Three corpora ("eras") with DIFFERENT schemas that must not be
concatenated blindly:

- pmxt/v1/          mirror of pmxt's capture, 2026-02-21T18 .. 2026-04-16T05, no trades
- pmxt/v2/          mirror of pmxt's capture, 2026-04-13T19 .. 2026-08-09T23, trades
- third-party/ag6/  ag6's capture mirrored 2026-08-26, 2026-08-09T20 .. 2026-08-15T09,
                    same 16-column schema as pmxt/v2, single source, NO licence stated
- v3/               pendulumflow's native capture, 2026-08-18T06 .. ongoing,
                    microsecond arrival times + per-hour manifest.json sidecar

The chain is not continuous: after ag6 ends there is a 68-hour hole,
2026-08-15T10 .. 2026-08-18T05, that nothing covers.

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
    "Data: Polymarket Orderbook Archive (archive.pendulumflow.com) — v3 by "
    "pendulumflow, pmxt eras by pmxt (archive.pmxt.dev), both CC BY 4.0; "
    "third-party/ag6 by ag6 (no licence stated). "
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
    has_sha256sums: bool  # <prefix>SHA256SUMS.txt published (all but ag6)
    license: str
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


# Preference order on overlap: native v3, then the licensed pmxt mirrors
# (v2 over v1 where they overlap), then unaudited third-party ag6 only where
# nothing else serves the hour (2026-08-10T00 .. 2026-08-15T09).
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
        has_sha256sums=True,
        license="CC BY 4.0 (credit pendulumflow)",
        note=(
            "Native pendulumflow capture, replay grade: several machines, exact "
            "de-duplication via sequence, microsecond arrival times. "
            "timestamp_received is arrival time; use `timestamp` for event time. "
            "Rows are grouped by event type and the hour's manifest.json gives each "
            "type its own byte range, row count and sha256 — one event type can be "
            "fetched with an HTTP Range request without downloading the hour."
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
        has_sha256sums=True,
        license="CC BY 4.0 (credit pmxt, archive.pmxt.dev)",
        note=(
            "Mirror of pmxt's capture, snapshot grade, single source. No sequence "
            "column: ms timestamps can tie and export order is not guaranteed. "
            "Overlaps pmxt/v1 2026-04-13..04-16 with same basenames but different "
            "bytes — never key files by basename across eras."
        ),
    ),
    ArchiveEra(
        key="third-party/ag6",
        prefix="third-party/ag6/",
        start=_utc(2026, 8, 9, 20),
        end=_utc(2026, 8, 15, 9),
        event_types=("price_change", "book", "last_trade_price", "tick_size_change"),
        timestamp_unit="ms",
        has_trades=True,
        has_sequence=False,
        has_manifest=False,
        has_sha256sums=False,
        license="none stated (credit ag6)",
        note=(
            "Third-party capture by ag6, mirrored 2026-08-26 from "
            "polymarket-archive.ag6.ai. Single source, no witness pipeline, no "
            "per-hour coverage verdicts; the archive's quality audit of it is "
            "pending. Same 16-column schema as pmxt/v2 (measured). Includes a "
            "COMPLETE 2026-08-10T00, the hour pmxt's own capture truncated. "
            "Overlaps pmxt/v2 for its first 4 hours."
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
        has_sha256sums=True,
        license="CC BY 4.0 (credit pmxt, archive.pmxt.dev)",
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


def sha256sums_url(era_key: str) -> Optional[str]:
    """URL of the era's SHA256SUMS.txt, or None (ag6 publishes none)."""
    era = _ERAS_BY_KEY.get(era_key)
    if era is None or not era.has_sha256sums:
        return None
    return f"{ARCHIVE_BASE_URL}/{era.prefix}SHA256SUMS.txt"


async def latest_available_hour(max_probes: int = 24) -> Optional[dict]:
    """Newest v3 hour actually served, found by probing backwards from now.

    Publication lags capture — ~6h observed live on 2026-08-31 — so HEAD-probe
    the hour file itself instead of guessing, walking back up to max_probes
    hours. Returns an hour_urls() entry or None if nothing responds. HEADs are
    cheap; the walk stops at the first hit.
    """
    session = await get_session()
    hour = _floor_hour(datetime.now(timezone.utc)) - timedelta(hours=1)
    for _ in range(max_probes):
        entry = hour_urls(hour)
        if entry is not None:
            try:
                async with session.head(entry["url"]) as resp:
                    if resp.status in (200, 206):
                        return entry
            except Exception:  # pragma: no cover - network best-effort
                logger.debug("latest-hour probe failed for %s", entry["url"], exc_info=True)
        hour -= timedelta(hours=1)
    return None


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
    """Per-hour coverage verdicts for one era (COVERAGE.json), or None.

    Shape (probed live): {counts: {hours, complete, partial, refused},
    hours: {"YYYY-MM-DDTHH": {status, minutes, precision, witnesses, ...}},
    generated_utc, instrument, ...}. Coverage is computed retroactively, so
    it lags the newest published hours. Only v3 publishes this today; the
    pmxt-era URLs 404 and this returns None for them.
    """
    era = _ERAS_BY_KEY.get(era_key)
    if era is None:
        return None
    return await _fetch_json_cached(f"{era.prefix}COVERAGE.json")


async def get_schema(era_key: str) -> Any:
    """Published Parquet schema for one era (SCHEMA.json), or None.

    Only v3 publishes this today; pmxt-era URLs 404 and return None.
    """
    era = _ERAS_BY_KEY.get(era_key)
    if era is None:
        return None
    return await _fetch_json_cached(f"{era.prefix}SCHEMA.json")


async def get_incidents() -> Any:
    """The archive's incident register (INCIDENTS.json), or None."""
    return await _fetch_json_cached("INCIDENTS.json")


async def get_hour_manifest(hour: datetime) -> Any:
    """v3 hour manifest, or None.

    Shape (probed live): top-level `sha256`/`bytes`/`row_count` for the whole
    file, and `products` keyed by EVENT TYPE (book, price_change,
    last_trade_price, ...) each carrying `byte_range` [start, end) — rows are
    grouped by event type, so one type can be pulled with an HTTP Range
    request — plus per-type `sha256`, `row_count`, `columns`, `order_by`.
    """
    era = resolve_era(hour, "v3")
    if era is None:
        return None
    path = era.manifest_path(_floor_hour(hour))
    return await _fetch_json_cached(path)


def _floor_hour(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
