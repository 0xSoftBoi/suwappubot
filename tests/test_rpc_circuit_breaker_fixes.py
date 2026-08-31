"""Regression tests for the 7-day tempo circuit-breaker retry storm.

Two bugs, both fixed here:

1. `_select_endpoint` fell through to `min(endpoints, key=circuit_open_until)`
   when every endpoint for a chain was circuit-open, calling a known-dead
   endpoint anyway. It must now raise `AllEndpointsUnavailable` instead.
2. Deterministic contract-level errors ("execution reverted", JSON-RPC error
   code 3) were recorded as endpoint failures, which tripped every circuit on
   a chain in lockstep for a revert that will happen identically on every
   endpoint. `record_failure` must ignore these entirely.

Plus a bounded-concurrency test for tx_poller's websocket watcher cap.
"""

import os
import time

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest  # noqa: E402

from bot.services.rpc_manager import (  # noqa: E402
    AllEndpointsUnavailable,
    RPCEndpoint,
    RPCManager,
    RPCTier,
)


def _ep(url: str, chain: str, *, open_for: float = 0.0) -> RPCEndpoint:
    ep = RPCEndpoint(url=url, chain=chain, tier=RPCTier.PUBLIC)
    if open_for:
        ep.circuit_open_until = time.monotonic() + open_for
    return ep


def _mgr(endpoints_by_chain) -> RPCManager:
    mgr = RPCManager()
    mgr._endpoints = dict(endpoints_by_chain)
    return mgr


# ── Bug 1: fail fast instead of returning a dead endpoint ───────────────────


def test_select_endpoint_raises_when_all_circuits_open():
    mgr = _mgr(
        {
            "tempo": [
                _ep("https://a.example/rpc", "tempo", open_for=60),
                _ep("https://b.example/rpc", "tempo", open_for=120),
            ]
        }
    )
    with pytest.raises(AllEndpointsUnavailable):
        mgr._select_endpoint("tempo")


def test_select_endpoint_exception_carries_chain_name():
    mgr = _mgr({"tempo": [_ep("https://a.example/rpc", "tempo", open_for=60)]})
    with pytest.raises(AllEndpointsUnavailable) as exc_info:
        mgr._select_endpoint("tempo")
    assert exc_info.value.chain_name == "tempo"


def test_all_endpoints_unavailable_is_a_connection_error():
    """Subclasses ConnectionError so it's caught by callers' existing broad
    `except Exception` / `except ConnectionError` handlers without any
    per-caller special-casing (matches wallet.py's chain_all_circuits_open
    convention: `raise ConnectionError("all_circuits_open")`)."""
    assert issubclass(AllEndpointsUnavailable, ConnectionError)


def test_get_rpc_url_raises_instead_of_returning_dead_endpoint():
    mgr = _mgr({"tempo": [_ep("https://dead.example/rpc", "tempo", open_for=60)]})
    with pytest.raises(AllEndpointsUnavailable):
        mgr.get_rpc_url("tempo")


def test_select_endpoint_still_picks_healthy_endpoint_when_available():
    """Sanity check the happy path wasn't disturbed."""
    mgr = _mgr(
        {
            "eth": [
                _ep("https://open.example/rpc", "eth", open_for=60),
                _ep("https://healthy.example/rpc", "eth"),
            ]
        }
    )
    ep = mgr._select_endpoint("eth")
    assert ep.url == "https://healthy.example/rpc"


# ── Bug 2: contract reverts must not open the circuit ────────────────────────


def test_execution_reverted_does_not_open_circuit():
    ep = _ep("https://a.example/rpc", "tempo")
    for _ in range(5):
        ep.record_failure(
            "rpc_error: {'code': 3, 'message': 'execution reverted: TIP20 token error: Uninitialized'}"
        )
    assert ep.is_circuit_open is False
    assert ep.consecutive_failures == 0
    assert ep.total_requests == 0


def test_execution_reverted_message_variant_does_not_open_circuit():
    ep = _ep("https://a.example/rpc", "tempo")
    ep.record_failure("execution reverted")
    assert ep.is_circuit_open is False
    assert ep.consecutive_failures == 0


def test_json_rpc_code_3_without_reverted_text_does_not_open_circuit():
    ep = _ep("https://a.example/rpc", "tempo")
    ep.record_failure("rpc_error: {'code': 3, 'message': 'custom contract error'}")
    assert ep.is_circuit_open is False
    assert ep.consecutive_failures == 0


def test_all_tempo_endpoints_survive_a_shared_contract_revert():
    """The exact production scenario: every tempo endpoint gets the identical
    deterministic revert for the same call. None should trip."""
    mgr = _mgr(
        {
            "tempo": [
                _ep("https://rpc.tempo.xyz", "tempo"),
                _ep("https://tempo-mainnet.drpc.org", "tempo"),
            ]
        }
    )
    revert = "rpc_error: {'code': 3, 'message': \"execution reverted: TIP20 token error: Uninitialized\"}"
    for ep in mgr._endpoints["tempo"]:
        for _ in range(10):
            ep.record_failure(revert)

    # All endpoints stay closed, and normal selection succeeds (no
    # AllEndpointsUnavailable, no dead-endpoint fallback).
    selected = mgr._select_endpoint("tempo")
    assert selected.url in {"https://rpc.tempo.xyz", "https://tempo-mainnet.drpc.org"}


def test_genuine_transport_failures_still_open_circuit():
    """Non-revert failures (timeouts, 429s, connection errors) must keep
    opening the circuit exactly as before — this fix must not weaken them."""
    ep = _ep("https://a.example/rpc", "tempo")
    for _ in range(3):
        ep.record_failure("timeout")
    assert ep.is_circuit_open is True
    assert ep.consecutive_failures == 3


def test_429_still_opens_circuit():
    ep = _ep("https://a.example/rpc", "tempo")
    for _ in range(3):
        ep.record_failure("rate_limited_429")
    assert ep.is_circuit_open is True


def test_quota_error_still_opens_circuit_on_first_occurrence():
    ep = _ep("https://a.example/rpc", "tempo")
    ep.record_failure("-32001 quota exceeded")
    assert ep.is_circuit_open is True


def test_mixed_revert_and_transport_failures_only_count_transport():
    """A chain flapping between a revert and a real timeout should only
    accumulate consecutive_failures from the timeouts."""
    ep = _ep("https://a.example/rpc", "tempo")
    ep.record_failure("execution reverted: foo")
    ep.record_failure("timeout")
    ep.record_failure("execution reverted: foo")
    ep.record_failure("timeout")
    ep.record_failure("timeout")
    assert ep.consecutive_failures == 3
    assert ep.is_circuit_open is True


@pytest.mark.asyncio
async def test_evm_rpc_call_reverts_propagate_without_opening_circuit(monkeypatch):
    """End-to-end: wallet._evm_rpc_call's rpc_error path must not trip the
    breaker for a deterministic contract revert."""
    from bot.services import wallet as wallet_mod
    from bot.services.rpc_manager import rpc_manager

    class _FakeResp:
        status = 200

        async def json(self):
            return {
                "error": {
                    "code": 3,
                    "message": "execution reverted: TIP20 token error: Uninitialized",
                }
            }

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class _FakeSession:
        def post(self, *a, **kw):
            return _FakeResp()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    ep = RPCEndpoint(url="https://rpc.tempo.xyz", chain="tempo", tier=RPCTier.PUBLIC)
    # monkeypatch (not a direct mutation) so the real singleton's _endpoints
    # dict — shared across the whole test session — is restored afterward.
    monkeypatch.setattr(rpc_manager, "_endpoints", {"tempo": [ep]})
    monkeypatch.setattr(rpc_manager, "chain_all_circuits_open", lambda chain: False)
    monkeypatch.setattr(rpc_manager, "get_rpc_url", lambda chain: ep.url)

    svc = wallet_mod.WalletService()
    monkeypatch.setattr(svc, "_http_session", lambda: _FakeSession())

    with pytest.raises(ConnectionError, match="execution reverted"):
        await svc._evm_rpc_call("tempo", "eth_call", [])

    assert ep.is_circuit_open is False
    assert ep.consecutive_failures == 0
