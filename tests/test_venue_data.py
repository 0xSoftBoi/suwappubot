"""Tests for bot/services/venue_data.py — VenueDataService.

Covers: pure normalization of raw Hyperliquid/Polymarket/Morpho payloads into
perp_metrics/prediction_snapshots/lend_metrics rows (including malformed
payloads being skipped without raising), time bucketing helpers, and a clean
start/stop lifecycle with capture disabled via the settings flag.

All fetches are monkeypatched or simply never invoked (disabled-flag tests)
— no network calls.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from datetime import datetime, timezone  # noqa: E402
from decimal import Decimal  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402

from bot.services.venue_data import (  # noqa: E402
    VenueDataService,
    bucket_minute,
    bucket_n_minutes,
    normalize_hyperliquid_perp_metrics,
    normalize_morpho_market,
    normalize_polymarket_market,
)

# ---------------------------------------------------------------------------
# Time bucketing
# ---------------------------------------------------------------------------


def test_bucket_minute_truncates_seconds_and_micros():
    now = datetime(2026, 1, 1, 12, 34, 56, 789, tzinfo=timezone.utc)
    assert bucket_minute(now) == datetime(2026, 1, 1, 12, 34, 0, tzinfo=timezone.utc)


def test_bucket_n_minutes_floors_to_boundary():
    now = datetime(2026, 1, 1, 12, 37, 45, tzinfo=timezone.utc)
    assert bucket_n_minutes(now, 5) == datetime(2026, 1, 1, 12, 35, 0, tzinfo=timezone.utc)
    assert bucket_n_minutes(now, 10) == datetime(2026, 1, 1, 12, 30, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Hyperliquid perp normalization
# ---------------------------------------------------------------------------

TS = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def test_normalize_hl_perp_metrics_happy_path():
    payload = [
        {"universe": [{"name": "BTC"}, {"name": "ETH"}]},
        [
            {
                "funding": "0.0001",
                "openInterest": "1234.5",
                "markPx": "65000.1",
                "oraclePx": "64999.9",
                "dayNtlVlm": "9999999.5",
            },
            {
                "funding": "-0.00005",
                "openInterest": "500",
                "markPx": "3200",
                "oraclePx": "3199.5",
                "dayNtlVlm": "500000",
            },
        ],
    ]

    rows = normalize_hyperliquid_perp_metrics(payload, TS)

    assert len(rows) == 2
    btc = rows[0]
    assert btc["venue"] == "hyperliquid"
    assert btc["symbol"] == "BTC"
    assert btc["ts"] == TS
    assert btc["funding_rate"] == Decimal("0.0001")
    assert btc["open_interest"] == Decimal("1234.5")
    assert btc["mark_price"] == Decimal("65000.1")
    assert btc["index_price"] == Decimal("64999.9")
    assert btc["volume_24h"] == Decimal("9999999.5")
    assert rows[1]["symbol"] == "ETH"


def test_normalize_hl_perp_metrics_skips_entries_without_name():
    payload = [
        {"universe": [{"name": ""}, {"name": "ETH"}]},
        [{"markPx": "1"}, {"markPx": "3200"}],
    ]
    rows = normalize_hyperliquid_perp_metrics(payload, TS)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "ETH"


def test_normalize_hl_perp_metrics_unparseable_numeric_becomes_none():
    payload = [
        {"universe": [{"name": "BTC"}]},
        [{"funding": "not-a-number", "markPx": None, "openInterest": "n/a"}],
    ]
    rows = normalize_hyperliquid_perp_metrics(payload, TS)
    assert len(rows) == 1
    assert rows[0]["funding_rate"] is None
    assert rows[0]["mark_price"] is None
    assert rows[0]["open_interest"] is None


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        [{}],
        "not a list",
        [{"universe": "not a list"}, []],
        [{"universe": [{"name": "BTC"}]}, "not a list"],
        [None, None],
        [{"universe": [None]}, [{"markPx": "1"}]],
    ],
)
def test_normalize_hl_perp_metrics_malformed_payload_never_raises(payload):
    assert normalize_hyperliquid_perp_metrics(payload, TS) == []


# ---------------------------------------------------------------------------
# Polymarket prediction normalization
# ---------------------------------------------------------------------------


def test_normalize_polymarket_market_happy_path():
    data = {
        "id": "12345",
        "conditionId": "0xabc",
        "question": "Will it happen?",
        "outcomes": '["Yes", "No"]',
        "outcomePrices": '["0.65", "0.35"]',
        "volumeNum": 1000.5,
        "liquidityNum": 200.25,
        "endDate": "2026-12-31T23:59:59Z",
    }

    rows = normalize_polymarket_market(data, TS)

    assert len(rows) == 2
    yes = next(r for r in rows if r["outcome"] == "Yes")
    assert yes["venue"] == "polymarket"
    assert yes["market_id"] == "12345"
    assert yes["condition_id"] == "0xabc"
    assert yes["question"] == "Will it happen?"
    assert yes["price"] == Decimal("0.65")
    assert yes["volume"] == Decimal("1000.5")
    assert yes["liquidity"] == Decimal("200.25")
    assert yes["end_date"] == datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    assert yes["ts"] == TS

    no = next(r for r in rows if r["outcome"] == "No")
    assert no["price"] == Decimal("0.35")


def test_normalize_polymarket_market_truncates_long_question():
    data = {
        "id": "1",
        "question": "x" * 900,
        "outcomes": '["Yes", "No"]',
        "outcomePrices": '["0.5", "0.5"]',
    }
    rows = normalize_polymarket_market(data, TS)
    assert len(rows) == 2
    assert len(rows[0]["question"]) == 500


def test_normalize_polymarket_market_falls_back_to_condition_id_when_no_id():
    data = {
        "conditionId": "0xdead",
        "outcomes": '["Yes", "No"]',
        "outcomePrices": '["0.1", "0.9"]',
    }
    rows = normalize_polymarket_market(data, TS)
    assert len(rows) == 2
    assert all(r["market_id"] == "0xdead" for r in rows)


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"id": "1"},  # no outcomes/prices
        {"id": "1", "outcomes": "[]", "outcomePrices": "[]"},
        {"id": "1", "outcomes": "not json", "outcomePrices": '["0.5"]'},
        None,
        "not a dict",
        {"outcomes": '["Yes"]', "outcomePrices": '["0.5"]'},  # no id, no condition_id
    ],
)
def test_normalize_polymarket_market_malformed_payload_never_raises(data):
    assert normalize_polymarket_market(data, TS) == []


def test_normalize_polymarket_market_skips_outcome_price_mismatch_gracefully():
    data = {
        "id": "1",
        "outcomes": '["Yes", "No", "Maybe"]',
        "outcomePrices": '["0.5", "0.5"]',  # shorter than outcomes
    }
    rows = normalize_polymarket_market(data, TS)
    assert len(rows) == 2  # only outcomes that have a matching price


# ---------------------------------------------------------------------------
# Morpho lend market normalization
# ---------------------------------------------------------------------------


def test_normalize_morpho_market_happy_path():
    item = {
        "uniqueKey": "0xmarket1",
        "loanAsset": {"symbol": "USDC"},
        "collateralAsset": {"symbol": "cbBTC"},
        "morphoBlue": {"chain": {"id": 8453}},
        "state": {
            "supplyApy": "0.045",
            "borrowApy": "0.072",
            "utilization": "0.63",
            "totalSupplyUsd": "1500000.75",
        },
    }

    row = normalize_morpho_market(item, TS)

    assert row is not None
    assert row["venue"] == "morpho"
    assert row["market_id"] == "0xmarket1"
    assert row["chain_id"] == 8453
    assert row["loan_symbol"] == "USDC"
    assert row["collateral_symbol"] == "cbBTC"
    assert row["supply_apy"] == Decimal("0.045")
    assert row["borrow_apy"] == Decimal("0.072")
    assert row["tvl"] == Decimal("1500000.75")
    assert row["utilization"] == Decimal("0.63")
    assert row["ts"] == TS


def test_normalize_morpho_market_missing_unique_key_returns_none():
    item = {"loanAsset": {"symbol": "USDC"}}
    assert normalize_morpho_market(item, TS) is None


def test_normalize_morpho_market_partial_state_leaves_fields_none():
    item = {"uniqueKey": "0xmarket2", "state": {"supplyApy": "bogus"}}
    row = normalize_morpho_market(item, TS)
    assert row is not None
    assert row["market_id"] == "0xmarket2"
    assert row["supply_apy"] is None
    assert row["chain_id"] is None
    assert row["loan_symbol"] is None


@pytest.mark.parametrize(
    "item",
    [
        None,
        "not a dict",
        {},
        {"uniqueKey": ""},
        {"uniqueKey": "x", "morphoBlue": "not a dict", "state": "not a dict"},
        {"uniqueKey": "x", "loanAsset": "oops", "collateralAsset": None},
    ],
)
def test_normalize_morpho_market_malformed_payload_never_raises(item):
    # Either None or a row with defensively-nulled fields — must never raise.
    result = normalize_morpho_market(item, TS)
    assert result is None or isinstance(result, dict)


# ---------------------------------------------------------------------------
# Lifecycle: start()/stop() clean with capture disabled / enabled
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_is_noop_when_capture_disabled(monkeypatch):
    monkeypatch.setattr("bot.services.venue_data.settings.venue_data_capture_enabled", False)
    svc = VenueDataService()

    await svc.start()

    assert svc._running is False
    assert svc._perp_task is None
    assert svc._prediction_task is None
    assert svc._lend_task is None

    # stop() on a never-started service must not raise.
    await svc.stop()


@pytest.mark.asyncio
async def test_start_stop_cleans_up_tasks_when_enabled(monkeypatch):
    monkeypatch.setattr("bot.services.venue_data.settings.venue_data_capture_enabled", True)
    svc = VenueDataService()
    monkeypatch.setattr(svc, "_perp_tick", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_prediction_tick", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_lend_tick", AsyncMock(return_value=None))

    await svc.start()

    assert svc._running is True
    assert svc._perp_task is not None
    assert svc._prediction_task is not None
    assert svc._lend_task is not None

    await svc.stop()

    assert svc._running is False
    assert svc._perp_task.done()
    assert svc._prediction_task.done()
    assert svc._lend_task.done()


@pytest.mark.asyncio
async def test_start_twice_does_not_spawn_duplicate_tasks(monkeypatch):
    monkeypatch.setattr("bot.services.venue_data.settings.venue_data_capture_enabled", True)
    svc = VenueDataService()
    monkeypatch.setattr(svc, "_perp_tick", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_prediction_tick", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_lend_tick", AsyncMock(return_value=None))

    await svc.start()
    first_perp_task = svc._perp_task
    await svc.start()  # second call must be a no-op

    assert svc._perp_task is first_perp_task

    await svc.stop()
