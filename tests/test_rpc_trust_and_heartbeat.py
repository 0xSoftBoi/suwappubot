"""Regression tests for two production defects found after the monitoring deploy.

1. `/health` reported `balance_refresher: unknown` forever, because the service
   wrote its heartbeat *after* a refresh pass with a TTL shorter than one cycle.
2. chainlist.org kept injecting `rpc.ankr.com/<chain>` endpoints that answer
   `-32000 Unauthorized`, tripping the RPC circuit breaker on polygon + gnosis.
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from bot.services.balance_refresher import BalanceRefresher
from bot.services.rpc_manager import TRUSTED_RPC_DOMAINS, _is_trusted_rpc_url

# --------------------------------------------------------------------------
# 1. balance_refresher heartbeat
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_heartbeat_written_before_refresh_and_outlives_a_cycle():
    """The heartbeat must be set before the work, with a TTL > one full cycle.

    Writing it after `_refresh_all()` with a 60s TTL meant the key expired
    during the very next sleep, so /health saw no key and said "unknown".
    """
    refresher = BalanceRefresher(refresh_interval=60)
    order: list[str] = []
    captured: dict = {}

    async def fake_set(key, value, ttl_seconds=None):
        order.append("heartbeat")
        captured["key"] = key
        captured["ttl"] = ttl_seconds

    async def fake_refresh_all():
        order.append("refresh")
        refresher._running = False  # one iteration only

    cache = AsyncMock()
    cache.set = AsyncMock(side_effect=fake_set)

    with (
        patch("bot.utils.redis_cache.redis_cache", cache),
        patch.object(refresher, "_refresh_all", side_effect=fake_refresh_all),
        patch("asyncio.sleep", new=AsyncMock()),
    ):
        refresher._running = True
        await refresher._refresh_loop()

    assert order == ["heartbeat", "refresh"], f"heartbeat must precede work, got {order}"
    assert captured["key"] == "service:balance_refresher:heartbeat"
    # /health marks a service dead past 90s; the TTL must exceed both that and
    # one refresh cycle, otherwise the key vanishes and reads as "unknown".
    assert captured["ttl"] >= 180
    assert captured["ttl"] > 60 + 90


@pytest.mark.asyncio
async def test_heartbeat_still_written_when_refresh_raises():
    """A failing refresh pass must not silence the liveness signal."""
    refresher = BalanceRefresher(refresh_interval=60)
    beats = 0

    async def fake_set(key, value, ttl_seconds=None):
        nonlocal beats
        beats += 1

    async def boom():
        refresher._running = False
        raise RuntimeError("alchemy exploded")

    cache = AsyncMock()
    cache.set = AsyncMock(side_effect=fake_set)

    with (
        patch("bot.utils.redis_cache.redis_cache", cache),
        patch.object(refresher, "_refresh_all", side_effect=boom),
        patch("asyncio.sleep", new=AsyncMock()),
    ):
        refresher._running = True
        await refresher._refresh_loop()

    assert beats == 1, "loop is alive even though the refresh failed"


# --------------------------------------------------------------------------
# 2. chainlist trust gate
# --------------------------------------------------------------------------


def test_ankr_is_not_trusted_from_chainlist():
    """Ankr's public endpoints require auth — never accept them from discovery."""
    assert "ankr.com" not in TRUSTED_RPC_DOMAINS
    assert not _is_trusted_rpc_url("https://rpc.ankr.com/polygon")
    assert not _is_trusted_rpc_url("https://rpc.ankr.com/gnosis")


def test_known_good_providers_still_trusted():
    """The fix must not narrow the gate beyond Ankr."""
    for url in (
        "https://polygon-bor-rpc.publicnode.com",
        "https://1rpc.io/matic",
        "https://polygon.drpc.org",
    ):
        assert _is_trusted_rpc_url(url), url


def test_attacker_domain_still_rejected():
    assert not _is_trusted_rpc_url("https://evil.example.com/rpc")
    assert not _is_trusted_rpc_url("https://rpc.ankr.com.evil.tld/polygon")
