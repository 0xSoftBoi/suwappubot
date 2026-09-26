"""Shared pytest fixtures for suwappubot.

Provides re-usable mocks for expensive or external dependencies so individual
test files don't have to repeat boilerplate — and so tests never accidentally
touch the real network, DB, or message broker.

Usage::

    def test_something(mock_redis, mock_telegram):
        ...
"""

import os
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

# Minimal env for import-time settings validation
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")  # never hit real KMS in tests
# api.main freezes JWT_SECRET at import time (random if SECRET_KEY is unset).
# Any test module importing api.main before a per-module setdefault runs would
# freeze a random secret and 401 every webapp JWT test that runs later — so the
# secret must be pinned here, before any test module is imported.
os.environ.setdefault("SECRET_KEY", "test-secret")


# ---------------------------------------------------------------------------
# Event loop (pytest-asyncio)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_db(tmp_path):
    """Isolated SQLite database for each test, cleaned up afterwards."""
    from database.db import init_db

    url = f"sqlite:///{tmp_path / 'test.db'}"
    assert init_db(url), "DB init failed"
    yield url
    # tmp_path cleanup is handled by pytest


# ---------------------------------------------------------------------------
# Redis cache
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_redis(monkeypatch):
    """In-memory Redis mock — no network, no TTL expiry drift."""
    store: dict = {}

    cache = AsyncMock()
    cache.get = AsyncMock(side_effect=lambda k: store.get(k))
    cache.set = AsyncMock(side_effect=lambda k, v, **_: store.update({k: v}))
    cache.delete = AsyncMock(side_effect=lambda k: store.pop(k, None))
    cache.get_del = AsyncMock(side_effect=lambda k: store.pop(k, None))
    cache.ping = AsyncMock(return_value=True)
    cache.get_stats = AsyncMock(return_value={"backend": "mock", "connected": True})

    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", cache)
    return cache


# ---------------------------------------------------------------------------
# Telegram bot
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_telegram(monkeypatch):
    """Mock Telegram Bot so tests never touch the Telegram API."""
    bot = AsyncMock()
    bot.send_message = AsyncMock(return_value=MagicMock(message_id=1))
    bot.edit_message_text = AsyncMock()
    bot.answer_callback_query = AsyncMock()
    monkeypatch.setattr("telegram.Bot.send_message", bot.send_message)
    return bot


# ---------------------------------------------------------------------------
# Web3 / RPC
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_web3():
    """Mock Web3 instance — no RPC calls."""
    w3 = MagicMock()
    w3.eth.get_balance = MagicMock(return_value=10**18)  # 1 ETH
    w3.eth.get_transaction_count = MagicMock(return_value=42)
    w3.eth.gas_price = 20 * 10**9  # 20 gwei
    w3.eth.send_raw_transaction = MagicMock(return_value=bytes.fromhex("ab" * 32))
    w3.eth.wait_for_transaction_receipt = MagicMock(return_value={"status": 1})
    return w3


# ---------------------------------------------------------------------------
# Swap engine
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_swap_engine():
    """Mock SwapEngine — returns a canned quote without hitting any provider."""
    from bot.services.swap_engine import SwapQuote
    from datetime import datetime

    engine = AsyncMock()
    engine.get_quote = AsyncMock(
        return_value=SwapQuote(
            provider="lifi",
            from_chain="ethereum",
            to_chain="base",
            from_token="USDC",
            to_token="WETH",
            from_amount="1000000",
            from_amount_human=1.0,
            to_amount="500000000000000",
            to_amount_human=0.0005,
            to_amount_min="490000000000000",
            gas_cost_usd=0.5,
            fee_cost_usd=0.0,
            total_cost_usd=0.5,
            estimated_time=60,
            price_impact=0.1,
            exchange_rate=0.0005,
            raw_quote={"provider": "lifi"},
            timestamp=datetime.utcnow(),
        )
    )
    engine.execute_swap = AsyncMock(
        return_value=MagicMock(id=1, tx_hash="0x" + "ab" * 32, status="SUBMITTED")
    )
    return engine
