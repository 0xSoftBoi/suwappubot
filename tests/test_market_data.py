"""Tests for bot/services/market_data.py — MarketDataService.

Covers: 1m candle open/high/low/close correctness on capture, upsert
high/low/close semantics on conflict, 1m -> 5m/1h rollup aggregation,
tracked-token set = TOKENS registry union active alert symbols, and a clean
start/stop lifecycle with capture disabled via the settings flag.

All price fetches are monkeypatched — no network calls. Uses the shared
sqlite `tmp_db` fixture (see tests/conftest.py) so DB access goes through the
real market_candles schema created by database.db._ensure_schema().
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from datetime import datetime, timedelta, timezone  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402

from database.db import get_session  # noqa: E402
from bot.config.tokens import TokenConfig  # noqa: E402
from bot.models.advanced import AdvancedPriceAlert  # noqa: E402
from bot.models.market_data import MarketCandle  # noqa: E402
from bot.models.user import User  # noqa: E402
from bot.services.market_data import MarketDataService  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAKE_TOKENS = {
    "ETH": TokenConfig(
        symbol="ETH",
        name="Ether",
        decimals=18,
        addresses={"ethereum": "0xETH"},
        logo_emoji="",
        is_stablecoin=False,
    ),
    "SOL": TokenConfig(
        symbol="SOL",
        name="Solana",
        decimals=9,
        addresses={"solana": "SoLAddr"},
        logo_emoji="",
        is_stablecoin=False,
    ),
}


def _candles(session, symbol="ETH", chain="ethereum", timeframe="1m"):
    return (
        session.query(MarketCandle)
        .filter(
            MarketCandle.symbol == symbol,
            MarketCandle.chain == chain,
            MarketCandle.timeframe == timeframe,
        )
        .order_by(MarketCandle.ts.asc())
        .all()
    )


# ---------------------------------------------------------------------------
# 1m capture: open/high/low/close correctness
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_capture_tick_writes_ohlc_equal_to_single_sample(tmp_db, monkeypatch):
    """A single price sample in a tick becomes open=high=low=close for that candle."""
    svc = MarketDataService()
    monkeypatch.setattr("bot.services.market_data.TOKENS", {"ETH": FAKE_TOKENS["ETH"]})
    monkeypatch.setattr(svc, "_get_tracked_symbol_chain_map", lambda: {"ETH": "ethereum"})
    monkeypatch.setattr(
        "bot.services.market_data.price_service.get_prices",
        AsyncMock(return_value={"ETH": 3000.5}),
    )

    await svc._capture_tick()

    with get_session() as session:
        rows = _candles(session)
        assert len(rows) == 1
        row = rows[0]
        assert float(row.open) == 3000.5
        assert float(row.high) == 3000.5
        assert float(row.low) == 3000.5
        assert float(row.close) == 3000.5
        assert row.source == "coingecko"
        assert row.token_address == "0xETH"


@pytest.mark.asyncio
async def test_capture_tick_skips_none_and_non_positive_prices(tmp_db, monkeypatch):
    svc = MarketDataService()
    monkeypatch.setattr(
        svc, "_get_tracked_symbol_chain_map", lambda: {"ETH": "ethereum", "SOL": "solana"}
    )
    monkeypatch.setattr(
        "bot.services.market_data.price_service.get_prices",
        AsyncMock(return_value={"ETH": None, "SOL": 0}),
    )

    await svc._capture_tick()

    with get_session() as session:
        assert session.query(MarketCandle).count() == 0


@pytest.mark.asyncio
async def test_capture_tick_no_op_when_no_tracked_tokens(tmp_db, monkeypatch):
    svc = MarketDataService()
    monkeypatch.setattr(svc, "_get_tracked_symbol_chain_map", lambda: {})
    get_prices_mock = AsyncMock(return_value={})
    monkeypatch.setattr("bot.services.market_data.price_service.get_prices", get_prices_mock)

    await svc._capture_tick()

    get_prices_mock.assert_not_called()
    with get_session() as session:
        assert session.query(MarketCandle).count() == 0


# ---------------------------------------------------------------------------
# Upsert: conflict widens high/low, updates close, keeps existing open
# ---------------------------------------------------------------------------


def test_upsert_rows_updates_high_low_close_on_conflict(tmp_db):
    svc = MarketDataService()
    bucket = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

    first = dict(
        symbol="ETH",
        chain="ethereum",
        token_address="0xETH",
        timeframe="1m",
        ts=bucket,
        open=100.0,
        high=100.0,
        low=100.0,
        close=100.0,
        volume=None,
        source="coingecko",
    )
    svc._upsert_rows([first])

    # Second write to the same bucket: higher high, lower low, new close —
    # open must NOT change (first sample of the bucket owns it).
    second = dict(first, open=90.0, high=110.0, low=80.0, close=95.0)
    svc._upsert_rows([second])

    with get_session() as session:
        rows = _candles(session)
        assert len(rows) == 1
        row = rows[0]
        assert float(row.open) == 100.0  # unchanged — upsert never touches open
        assert float(row.high) == 110.0  # widened
        assert float(row.low) == 80.0  # widened
        assert float(row.close) == 95.0  # latest wins


def test_upsert_rows_preserves_volume_when_new_volume_is_none(tmp_db):
    svc = MarketDataService()
    bucket = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

    base = dict(
        symbol="ETH",
        chain="ethereum",
        token_address="0xETH",
        timeframe="1m",
        ts=bucket,
        open=100.0,
        high=100.0,
        low=100.0,
        close=100.0,
        volume=500.0,
        source="coingecko",
    )
    svc._upsert_rows([base])
    svc._upsert_rows([dict(base, close=101.0, volume=None)])

    with get_session() as session:
        row = _candles(session)[0]
        assert float(row.volume) == 500.0
        assert float(row.close) == 101.0


def test_upsert_distinct_symbol_chain_timeframe_ts_creates_separate_rows(tmp_db):
    svc = MarketDataService()
    bucket = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    row_a = dict(
        symbol="ETH",
        chain="ethereum",
        token_address="0xETH",
        timeframe="1m",
        ts=bucket,
        open=100.0,
        high=100.0,
        low=100.0,
        close=100.0,
        volume=None,
        source="coingecko",
    )
    row_b = dict(row_a, symbol="SOL", chain="solana", token_address="SoLAddr", close=50.0)
    svc._upsert_rows([row_a, row_b])

    with get_session() as session:
        assert session.query(MarketCandle).count() == 2


# ---------------------------------------------------------------------------
# Rollup: 1m -> 5m aggregation correctness
# ---------------------------------------------------------------------------


def _seed_1m_candles(svc, symbol, chain, start, prices):
    """Write one 1m candle per price starting at `start`, one minute apart."""
    rows = []
    for i, price in enumerate(prices):
        rows.append(
            dict(
                symbol=symbol,
                chain=chain,
                token_address="0xETH",
                timeframe="1m",
                ts=start + timedelta(minutes=i),
                open=price,
                high=price + 1,
                low=price - 1,
                close=price,
                volume=10.0,
                source="coingecko",
            )
        )
    svc._upsert_rows(rows)


def test_rollup_1m_to_5m_aggregates_ohlcv_correctly(tmp_db):
    svc = MarketDataService()
    # A fully-elapsed 5m bucket: candles well in the past.
    bucket_start = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(
        minutes=30
    )
    bucket_start = bucket_start.replace(minute=(bucket_start.minute // 5) * 5)
    prices = [100.0, 105.0, 95.0, 102.0, 98.0]  # open=100, high=106, low=94, close=98
    _seed_1m_candles(svc, "ETH", "ethereum", bucket_start, prices)

    svc._rollup_timeframe("1m", "5m", 300, timedelta(days=2))

    with get_session() as session:
        rows = _candles(session, "ETH", "ethereum", "5m")
        assert len(rows) == 1
        row = rows[0]
        assert row.ts.replace(tzinfo=timezone.utc) == bucket_start
        assert float(row.open) == 100.0
        assert float(row.high) == 106.0
        assert float(row.low) == 94.0
        assert float(row.close) == 98.0
        assert float(row.volume) == 50.0  # sum of the five 10.0 volumes


def test_rollup_skips_in_progress_bucket(tmp_db):
    """A 5m bucket that hasn't fully elapsed yet must not be finalized."""
    svc = MarketDataService()
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    bucket_start = now.replace(minute=(now.minute // 5) * 5)
    # Only feed the current (still in-progress) minute of the bucket.
    _seed_1m_candles(svc, "ETH", "ethereum", bucket_start, [100.0])

    svc._rollup_timeframe("1m", "5m", 300, timedelta(days=2))

    with get_session() as session:
        assert len(_candles(session, "ETH", "ethereum", "5m")) == 0


def test_rollup_5m_to_1h_aggregates_ohlcv_correctly(tmp_db):
    svc = MarketDataService()
    bucket_start = datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    ) - timedelta(hours=3)
    rows = []
    prices = [10.0, 20.0, 5.0, 15.0]  # open=10 high=21 low=4 close=15
    for i, price in enumerate(prices):
        rows.append(
            dict(
                symbol="ETH",
                chain="ethereum",
                token_address="0xETH",
                timeframe="5m",
                ts=bucket_start + timedelta(minutes=5 * i),
                open=price,
                high=price + 1,
                low=price - 1,
                close=price,
                volume=None,
                source="coingecko",
            )
        )
    svc._upsert_rows(rows)

    svc._rollup_timeframe("5m", "1h", 3600, timedelta(days=30))

    with get_session() as session:
        rows = _candles(session, "ETH", "ethereum", "1h")
        assert len(rows) == 1
        row = rows[0]
        assert float(row.open) == 10.0
        assert float(row.high) == 21.0
        assert float(row.low) == 4.0
        assert float(row.close) == 15.0
        assert row.volume is None  # no source volumes present


def test_rollup_respects_lookback_cutoff(tmp_db):
    """Candles older than the lookback window must not be rolled up."""
    svc = MarketDataService()
    old_bucket = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(days=10)
    old_bucket = old_bucket.replace(minute=(old_bucket.minute // 5) * 5)
    _seed_1m_candles(svc, "ETH", "ethereum", old_bucket, [100.0] * 5)

    # lookback of 2 days excludes the 10-day-old candles.
    svc._rollup_timeframe("1m", "5m", 300, timedelta(days=2))

    with get_session() as session:
        assert len(_candles(session, "ETH", "ethereum", "5m")) == 0


# ---------------------------------------------------------------------------
# Tracked-token set = TOKENS registry union active alert symbols
# ---------------------------------------------------------------------------


def test_tracked_set_is_union_of_tokens_and_active_alerts(tmp_db, monkeypatch):
    monkeypatch.setattr(
        "bot.services.market_data.TOKENS",
        {"ETH": FAKE_TOKENS["ETH"], "SOL": FAKE_TOKENS["SOL"]},
    )

    with get_session() as session:
        user = User(id=1, telegram_id=100, username="tester")
        session.add(user)
        session.flush()
        session.add(
            AdvancedPriceAlert(
                user_id=1,
                token_symbol="pepe",  # lowercase on purpose — must normalize to PEPE
                chain="ethereum",
                alert_type="price_above",
                target_price=1.0,
                is_active=True,
            )
        )
        # Inactive alert must NOT be tracked.
        session.add(
            AdvancedPriceAlert(
                user_id=1,
                token_symbol="DOGE",
                chain="ethereum",
                alert_type="price_above",
                target_price=1.0,
                is_active=False,
            )
        )

    svc = MarketDataService()
    mapping = svc._get_tracked_symbol_chain_map()

    assert mapping["ETH"] == "ethereum"
    assert mapping["SOL"] == "solana"
    assert mapping["PEPE"] == "ethereum"
    assert "DOGE" not in mapping


def test_tracked_set_alert_symbol_does_not_override_registered_token_chain(tmp_db, monkeypatch):
    """A TOKENS-registered symbol's canonical chain wins over an alert's chain."""
    monkeypatch.setattr("bot.services.market_data.TOKENS", {"ETH": FAKE_TOKENS["ETH"]})

    with get_session() as session:
        user = User(id=1, telegram_id=100, username="tester")
        session.add(user)
        session.flush()
        session.add(
            AdvancedPriceAlert(
                user_id=1,
                token_symbol="ETH",
                chain="base",  # different chain than TOKENS registers ETH under
                alert_type="price_above",
                target_price=1.0,
                is_active=True,
            )
        )

    svc = MarketDataService()
    mapping = svc._get_tracked_symbol_chain_map()

    assert mapping["ETH"] == "ethereum"  # TOKENS wins, not the alert's chain


def test_tracked_set_survives_db_error(tmp_db, monkeypatch, caplog):
    """If the alerts query blows up, TOKENS-registered symbols are still tracked."""
    monkeypatch.setattr("bot.services.market_data.TOKENS", {"ETH": FAKE_TOKENS["ETH"]})

    def boom():
        raise RuntimeError("db is on fire")

    monkeypatch.setattr("bot.services.market_data.get_session", boom)

    svc = MarketDataService()
    mapping = svc._get_tracked_symbol_chain_map()

    assert mapping == {"ETH": "ethereum"}


# ---------------------------------------------------------------------------
# Lifecycle: start()/stop() clean with capture disabled
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_is_noop_when_capture_disabled(monkeypatch):
    monkeypatch.setattr("bot.services.market_data.settings.market_data_capture_enabled", False)
    svc = MarketDataService()

    await svc.start()

    assert svc._running is False
    assert svc._capture_task is None
    assert svc._rollup_task is None
    assert svc._backfill_task is None

    # stop() on a never-started service must not raise.
    await svc.stop()


@pytest.mark.asyncio
async def test_start_stop_cleans_up_tasks_when_enabled(monkeypatch):
    monkeypatch.setattr("bot.services.market_data.settings.market_data_capture_enabled", True)
    svc = MarketDataService()
    # Prevent the loops from doing real DB/network work while running.
    monkeypatch.setattr(svc, "_capture_tick", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_rollup_all", lambda: None)
    monkeypatch.setattr(svc, "_backfill_once", AsyncMock(return_value=None))

    await svc.start()

    assert svc._running is True
    assert svc._capture_task is not None
    assert svc._rollup_task is not None
    assert svc._backfill_task is not None

    await svc.stop()

    assert svc._running is False
    assert svc._capture_task.done()
    assert svc._rollup_task.done()
    assert svc._backfill_task.done()


@pytest.mark.asyncio
async def test_start_twice_does_not_spawn_duplicate_tasks(monkeypatch):
    monkeypatch.setattr("bot.services.market_data.settings.market_data_capture_enabled", True)
    svc = MarketDataService()
    monkeypatch.setattr(svc, "_capture_tick", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_rollup_all", lambda: None)
    monkeypatch.setattr(svc, "_backfill_once", AsyncMock(return_value=None))

    await svc.start()
    first_capture_task = svc._capture_task
    await svc.start()  # second call must be a no-op

    assert svc._capture_task is first_capture_task

    await svc.stop()
