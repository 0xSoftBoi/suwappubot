"""Solana RPC rate-limit containment.

Production symptom these cover (python-worker, 2026-11-20): a steady stream
of ``Solana RPC rate limited (429) fetching token accounts`` followed by
``Skipping cache ... due to RPC failures``. Because a failed balance fetch is
deliberately never cached, every 429 guaranteed a refetch on the next
refresher pass — the harder it failed, the harder it retried.

Two independent causes, one test class each:

1. Solana had **no keyed endpoint**. ``HELIUS_API_KEY`` was set on the
   service and used by the ``/webapp/solana/*`` proxy, but was never wired
   into the RPC pool the bot reads through, so Solana fell through to the
   shared public defaults that 429 aggressively.
2. The refresher's batch put ~15 simultaneous Solana requests on one
   endpoint (5 wallets x 3 calls). Providers limit requests/second, so the
   burst rate-limited itself.
"""

from __future__ import annotations

import asyncio
import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.config.settings import settings  # noqa: E402
from bot.services import wallet as wallet_module  # noqa: E402
from bot.services.rpc_manager import RPCManager, RPCTier  # noqa: E402

# --- 1. Helius is wired in as a keyed Solana endpoint ----------------------


def _solana_endpoints(monkeypatch, helius_key: str):
    monkeypatch.setattr(settings, "helius_api_key", helius_key, raising=False)
    mgr = RPCManager()
    mgr._load_configured_endpoints()
    return mgr._endpoints.get("solana", [])


def test_helius_is_registered_as_a_paid_solana_endpoint(monkeypatch):
    eps = _solana_endpoints(monkeypatch, "test-key-123")
    helius = [e for e in eps if "helius-rpc.com" in e.url]
    assert helius, "Helius key is set but produced no Solana endpoint"
    assert helius[0].tier is RPCTier.PAID
    assert "api-key=test-key-123" in helius[0].url


def test_no_helius_key_leaves_solana_on_public_endpoints(monkeypatch):
    """Absent a key, behaviour is unchanged — no crash, no empty pool."""
    eps = _solana_endpoints(monkeypatch, "")
    assert not [e for e in eps if "helius-rpc.com" in e.url]
    assert eps, "Solana must still have its public fallbacks"


def test_helius_is_solana_only(monkeypatch):
    """The key must not leak onto EVM chains, which cannot speak to it."""
    monkeypatch.setattr(settings, "helius_api_key", "test-key-123", raising=False)
    mgr = RPCManager()
    mgr._load_configured_endpoints()
    for chain, eps in mgr._endpoints.items():
        if chain == "solana":
            continue
        assert not [e for e in eps if "helius" in e.url], f"Helius leaked onto {chain}"


# --- 2. Concurrency is bounded --------------------------------------------


class _FakeResponse:
    def __init__(self, status=200, payload=None, headers=None):
        self.status = status
        self._payload = payload if payload is not None else {"result": "ok"}
        self.headers = headers or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._payload


# Bound before any test patches asyncio.sleep, so the fake session's own
# pause is never mistaken for the code-under-test's Retry-After sleep.
_REAL_SLEEP = asyncio.sleep


class _TrackingSession:
    """Records peak concurrent in-flight posts."""

    def __init__(self, hold_ticks=5, status=200, headers=None):
        self.inflight = 0
        self.peak = 0
        self._hold_ticks = hold_ticks
        self._status = status
        self._headers = headers or {}

    def post(self, url, json=None):
        session = self

        class _Ctx:
            async def __aenter__(self):
                session.inflight += 1
                session.peak = max(session.peak, session.inflight)
                # Deliberately NOT asyncio.sleep: the Retry-After tests patch
                # it, and this fixture's own yield must not pollute them.
                for _ in range(session._hold_ticks):
                    await _REAL_SLEEP(0)
                return _FakeResponse(session._status, headers=session._headers)

            async def __aexit__(self, *exc):
                session.inflight -= 1
                return False

        return _Ctx()


@pytest.fixture
def svc(monkeypatch):
    monkeypatch.setattr(
        wallet_module.rpc_manager, "get_rpc_url", lambda chain: "https://solana.test"
    )
    monkeypatch.setattr(wallet_module.rpc_manager, "report_success", lambda *a, **k: None)
    monkeypatch.setattr(wallet_module.rpc_manager, "report_failure", lambda *a, **k: None)
    return wallet_module.WalletService.__new__(wallet_module.WalletService)


async def test_concurrent_posts_are_capped(svc):
    """The refresher's ~15-wide burst must not reach the endpoint."""
    session = _TrackingSession()
    await asyncio.gather(*[svc._solana_rpc_post(session, {"id": i}, f"ctx{i}") for i in range(15)])
    assert session.peak <= wallet_module._SOLANA_RPC_MAX_CONCURRENCY, (
        f"peak concurrency {session.peak} exceeded the cap "
        f"{wallet_module._SOLANA_RPC_MAX_CONCURRENCY}"
    )
    assert session.peak > 1, "serialized entirely — the semaphore is too tight"


async def test_all_requests_still_complete(svc):
    session = _TrackingSession(hold_ticks=0)
    results = await asyncio.gather(
        *[svc._solana_rpc_post(session, {"id": i}, f"ctx{i}") for i in range(12)]
    )
    assert len(results) == 12
    assert all(r == {"result": "ok"} for r in results)


async def test_semaphore_is_released_on_failure(svc):
    """A 429 must not leak a permit, or the pool deadlocks after N failures."""
    failing = _TrackingSession(hold_ticks=0, status=429)
    for _ in range(wallet_module._SOLANA_RPC_MAX_CONCURRENCY + 2):
        with pytest.raises(ConnectionError):
            await svc._solana_rpc_post(failing, {}, "ctx")
    # The pool must still serve a healthy request afterwards.
    ok = _TrackingSession(hold_ticks=0)
    assert await svc._solana_rpc_post(ok, {}, "ctx") == {"result": "ok"}


# --- 3. Retry-After is honoured, but bounded ------------------------------


async def test_retry_after_is_honoured(svc, monkeypatch):
    slept: list[float] = []

    async def _fake_sleep(d):
        slept.append(d)

    monkeypatch.setattr(wallet_module.asyncio, "sleep", _fake_sleep)
    session = _TrackingSession(hold_ticks=0, status=429, headers={"Retry-After": "2"})
    with pytest.raises(ConnectionError):
        await svc._solana_rpc_post(session, {}, "ctx")
    assert slept == [2.0]


async def test_absurd_retry_after_is_clamped(svc, monkeypatch):
    """A hostile header must not park a task past the 30s batch budget."""
    slept: list[float] = []

    async def _fake_sleep(d):
        slept.append(d)

    monkeypatch.setattr(wallet_module.asyncio, "sleep", _fake_sleep)
    session = _TrackingSession(hold_ticks=0, status=429, headers={"Retry-After": "86400"})
    with pytest.raises(ConnectionError):
        await svc._solana_rpc_post(session, {}, "ctx")
    assert slept == [wallet_module._SOLANA_MAX_RETRY_AFTER_SECONDS]


async def test_garbage_retry_after_does_not_sleep(svc, monkeypatch):
    slept: list[float] = []

    async def _fake_sleep(d):
        slept.append(d)

    monkeypatch.setattr(wallet_module.asyncio, "sleep", _fake_sleep)
    session = _TrackingSession(hold_ticks=0, status=429, headers={"Retry-After": "soon"})
    with pytest.raises(ConnectionError):
        await svc._solana_rpc_post(session, {}, "ctx")
    assert slept == []
