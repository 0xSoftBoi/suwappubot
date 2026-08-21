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


# --------------------------------------------------------------------------
# 3. Dead/gated endpoints must not be re-probed (or re-logged) every 10 minutes
#
# Measured in prod 2026-08-15: ~20 endpoints sat at 288 consecutive failures —
# what a 600s-capped backoff looks like after two days — and each re-logged a
# WARNING on every probe. The resulting flood left the worker's log buffer
# covering only a few minutes, so an unrelated incident could not be debugged
# from the logs at all.
# --------------------------------------------------------------------------

from bot.services.rpc_manager import RPCEndpoint, RPCTier, _safe_url


def _endpoint(url="https://polygon.meowrpc.com"):
    return RPCEndpoint(url=url, chain="polygon", tier=RPCTier.PUBLIC)


@pytest.mark.parametrize(
    "error",
    [
        "Cannot connect to host polygon.meowrpc.com:443 ssl:default [Name or service not known]",
        "Temporary failure in name resolution",
        "http_403",
        "http_401",
    ],
)
def test_unrecoverable_errors_get_the_long_cooldown_not_ten_minutes(error):
    """DNS death and 401/403 gating are properties of the endpoint, not blips."""
    ep = _endpoint()
    ep.record_failure(error)
    remaining = ep.circuit_open_until - __import__("time").monotonic()
    # Must be the quota-class cooldown (6h), not the 600s generic backoff.
    assert remaining > 3600, f"{error!r} got only {remaining:.0f}s cooldown"


def test_transient_errors_still_use_the_short_backoff():
    """Guard against over-matching: a normal timeout must stay recoverable."""
    ep = _endpoint()
    for _ in range(3):
        ep.record_failure("timeout")
    remaining = ep.circuit_open_until - __import__("time").monotonic()
    assert 0 < remaining <= 600


def test_circuit_open_logs_once_per_cooldown_not_once_per_probe(caplog):
    """The wall of identical lines is the actual outage-debugging problem."""
    ep = _endpoint()
    with caplog.at_level("WARNING"):
        for _ in range(25):
            ep.record_failure("http_403")
    opens = [r for r in caplog.records if "circuit OPEN" in r.getMessage()]
    assert len(opens) == 1, f"expected 1 log line, got {len(opens)}"


def test_fatal_errors_also_log_once(caplog):
    ep = _endpoint()
    with caplog.at_level("WARNING"):
        for _ in range(10):
            ep.record_failure("eth_call unsupported", fatal=True)
    opens = [r for r in caplog.records if "circuit OPEN" in r.getMessage()]
    assert len(opens) == 1


def test_logged_urls_never_leak_credentials(caplog):
    """`url[:60]` truncated PAST `/v2/`, leaking ~17 chars of an Alchemy key."""
    secret = "ykAk5ChQy84xeQQFpSUPERSECRETKEY"
    ep = _endpoint(f"https://robinhood-mainnet.g.alchemy.com/v2/{secret}")
    with caplog.at_level("WARNING"):
        ep.record_failure("http_403")
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert secret not in logged
    assert secret[:12] not in logged, "partial key still leaked"
    # ...but the host must survive, or the line stops being actionable.
    assert "robinhood-mainnet.g.alchemy.com" in logged


def test_safe_url_keeps_host_and_drops_secrets():
    assert _safe_url("https://eth.meowrpc.com") == "https://eth.meowrpc.com"
    assert _safe_url("https://x.g.alchemy.com/v2/KEY") == "https://x.g.alchemy.com/v2/***"
    assert _safe_url("not a url") == "<malformed-url>"
