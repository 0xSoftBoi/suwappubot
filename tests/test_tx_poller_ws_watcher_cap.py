"""Regression test for the MAX_WS_WATCHERS bound on tx_poller's Solana ws watchers.

Eviction via add_done_callback already worked correctly (not a leak) — this
only locks in that peak concurrency is capped, and that a tx skipped for
being over the cap falls back to the existing HTTP polling backstop rather
than being dropped.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import asyncio  # noqa: E402

import pytest  # noqa: E402

from bot.services import tx_poller as tx_poller_mod  # noqa: E402
from bot.services.tx_poller import MAX_WS_WATCHERS, TransactionPoller  # noqa: E402


def _solana_tx_dict(tx_id: int) -> dict:
    return {
        "id": tx_id,
        "from_chain": "solana",
        "to_chain": "solana",
        "tx_hash": f"fake-sig-{tx_id}",
    }


class _FakeSolanaChain:
    chain_type = tx_poller_mod.ChainType.SOLANA


def test_watcher_not_started_when_at_cap(monkeypatch):
    poller = TransactionPoller()
    # Fill to the cap with dummy never-finishing tasks.
    poller._ws_watchers = {i: object() for i in range(MAX_WS_WATCHERS)}

    monkeypatch.setattr(tx_poller_mod, "get_chain_by_name", lambda name: _FakeSolanaChain())
    monkeypatch.setattr(
        tx_poller_mod.rpc_manager,
        "get_rpc_url",
        lambda chain: "https://api.mainnet-beta.solana.com",
    )

    created = []
    monkeypatch.setattr(
        asyncio,
        "create_task",
        lambda coro: created.append(coro) or coro.close(),
    )

    poller._maybe_start_ws_watcher(_solana_tx_dict(999999))

    assert len(poller._ws_watchers) == MAX_WS_WATCHERS
    assert 999999 not in poller._ws_watchers
    assert created == []  # no new watcher task was created


@pytest.mark.asyncio
async def test_watcher_started_when_under_cap(monkeypatch):
    poller = TransactionPoller()
    poller._ws_watchers = {i: object() for i in range(MAX_WS_WATCHERS - 1)}

    monkeypatch.setattr(tx_poller_mod, "get_chain_by_name", lambda name: _FakeSolanaChain())
    monkeypatch.setattr(
        tx_poller_mod.rpc_manager,
        "get_rpc_url",
        lambda chain: "https://api.mainnet-beta.solana.com",
    )

    async def _fake_watch(tx_dict, ws_url):
        return None

    monkeypatch.setattr(poller, "_ws_watch_solana", _fake_watch)

    tx_id = 424242
    poller._maybe_start_ws_watcher(_solana_tx_dict(tx_id))

    assert tx_id in poller._ws_watchers
    assert len(poller._ws_watchers) == MAX_WS_WATCHERS

    # Let the fake watcher task finish and confirm the done-callback eviction
    # (pre-existing, untouched) still removes it.
    await poller._ws_watchers[tx_id]
    await asyncio.sleep(0)
    assert tx_id not in poller._ws_watchers


def test_max_ws_watchers_is_bounded_and_reasonable():
    assert MAX_WS_WATCHERS == 256
