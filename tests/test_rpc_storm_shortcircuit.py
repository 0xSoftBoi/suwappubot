"""Regression tests for RPC-storm short-circuiting.

When every endpoint for a chain is circuit-open, hot callers must SKIP the
chain instead of firing doomed requests at known-dead RPCs. Each doomed
request opens a socket; under a sustained public-RPC outage that fd churn is
what crashed python-worker (c-ares netlink failure). These tests lock in the
skip behaviour so the storm can't recur.
"""

import os
import time

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest  # noqa: E402

from bot.services.rpc_manager import RPCEndpoint, RPCManager, RPCTier  # noqa: E402


def _ep(url: str, chain: str, *, open_for: float = 0.0) -> RPCEndpoint:
    ep = RPCEndpoint(url=url, chain=chain, tier=RPCTier.PUBLIC)
    if open_for:
        ep.circuit_open_until = time.monotonic() + open_for
    return ep


def _mgr(endpoints_by_chain) -> RPCManager:
    mgr = RPCManager()
    mgr._endpoints = dict(endpoints_by_chain)
    return mgr


def test_all_circuits_open_true_when_every_endpoint_open():
    mgr = _mgr(
        {
            "tempo": [
                _ep("https://a.example/rpc", "tempo", open_for=60),
                _ep("https://b.example/rpc", "tempo", open_for=60),
            ]
        }
    )
    assert mgr.chain_all_circuits_open("tempo") is True


def test_all_circuits_open_false_when_one_endpoint_healthy():
    mgr = _mgr(
        {
            "eth": [
                _ep("https://a.example/rpc", "eth", open_for=60),
                _ep("https://b.example/rpc", "eth"),  # healthy
            ]
        }
    )
    assert mgr.chain_all_circuits_open("eth") is False


def test_all_circuits_open_is_case_insensitive():
    mgr = _mgr({"solana": [_ep("https://a.example/rpc", "solana", open_for=60)]})
    assert mgr.chain_all_circuits_open("SOLANA") is True


def test_unknown_chain_returns_false_so_caller_falls_back():
    # Unknown chain must NOT be treated as "down" — callers should fall back to
    # normal selection (which raises a clear error) rather than silently skip.
    mgr = _mgr({})
    assert mgr.chain_all_circuits_open("does-not-exist") is False


def test_expired_circuit_no_longer_counts_as_open():
    ep = _ep("https://a.example/rpc", "tempo")
    ep.circuit_open_until = time.monotonic() - 1  # already elapsed
    mgr = _mgr({"tempo": [ep]})
    assert mgr.chain_all_circuits_open("tempo") is False


@pytest.mark.asyncio
async def test_evm_rpc_call_skips_network_when_all_circuits_open(monkeypatch):
    """_evm_rpc_call must raise BEFORE opening any aiohttp session."""
    from bot.services import wallet as wallet_mod

    monkeypatch.setattr(wallet_mod.rpc_manager, "chain_all_circuits_open", lambda chain: True)

    def _boom():
        raise AssertionError("a session was opened for a fully circuit-open chain")

    svc = wallet_mod.WalletService()
    monkeypatch.setattr(svc, "_http_session", _boom)

    with pytest.raises(ConnectionError, match="all_circuits_open"):
        await svc._evm_rpc_call("tempo", "eth_blockNumber", [])
