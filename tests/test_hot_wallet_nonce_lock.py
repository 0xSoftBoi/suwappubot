"""Tests for the nonce-reservation + per-(chain, address) lock fix in
`bot/services/hot_wallet.py` — MONEY-PATH.

Before this fix, `send_native_token`/`send_token` read
`get_transaction_count(addr)` at the default "latest" block tag with no
reservation and no lock, so two concurrent sends from the same wallet
(most acutely: the single shared gas-payer wallet used by every mobile gas
top-up) could get the same nonce — the loser is rejected or, worse,
silently replaces the first transfer on-chain while a DB row still
records it as sent.

Covers:
  * concurrent `send_native_token` calls on the same wallet get distinct,
    increasing nonces, and the critical section never overlaps
  * a pre-broadcast failure (e.g. signing error) releases the reservation
    so a retry doesn't skip a nonce unnecessarily
  * the lock does not deadlock across sequential (non-concurrent) calls
  * `send_token` (ERC20/TIP-20 sibling) gets the same treatment
  * existing behaviour for other callers (withdrawal kill-switch) is
    unchanged
"""

import asyncio
import os
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret")

import pytest

import bot.services.hot_wallet as hw_mod
from bot.utils.nonce_reservation import _reset_for_tests

ADDR = "0x" + "11" * 20
TO_ADDR = "0x" + "22" * 20
TOKEN_ADDR = "0x" + "33" * 20


def _wallet():
    return SimpleNamespace(
        id=1,
        address=ADDR,
        chain_type="evm",
        wallet_provider="turnkey",
        is_turnkey_wallet=True,
    )


class _FakeWeb3:
    """Minimal Web3 stand-in. `get_transaction_count` never advances — it
    simulates a chain whose "pending" view hasn't caught up yet, so a
    correct implementation must rely on the in-process reservation, not a
    fresh chain read, to avoid handing out the same nonce twice."""

    def __init__(self, pending_nonce=5, gas_price=1_000_000_000):
        self.eth = MagicMock()
        self.eth.get_transaction_count = MagicMock(return_value=pending_nonce)
        self.eth.gas_price = gas_price
        self.eth.estimate_gas = MagicMock(return_value=21000)

        contract = MagicMock()

        def _build_transaction(overrides):
            tx = {"to": TOKEN_ADDR, "data": "0xdeadbeef"}
            tx.update(overrides)
            return tx

        contract.functions.transfer.return_value.build_transaction.side_effect = _build_transaction
        self.eth.contract = MagicMock(return_value=contract)


@pytest.fixture(autouse=True)
def _reset_nonce_state():
    _reset_for_tests()
    yield
    _reset_for_tests()


@pytest.fixture(autouse=True)
def _no_compliance(monkeypatch):
    monkeypatch.setattr(hw_mod, "_assert_recipient_compliant", lambda *a, **kw: None)


@pytest.fixture(autouse=True)
def _withdrawals_enabled(monkeypatch):
    monkeypatch.setenv("TERMINAL_WITHDRAW_ENABLED", "true")


def _patch_web3(monkeypatch, web3):
    monkeypatch.setattr(hw_mod.hot_wallet_service, "_get_web3", lambda chain: web3)


# ── send_native_token: concurrency ──────────────────────────────────────


async def test_concurrent_send_native_token_gets_distinct_increasing_nonces(tmp_db, monkeypatch):
    web3 = _FakeWeb3(pending_nonce=5)
    _patch_web3(monkeypatch, web3)

    captured_nonces = []
    concurrency = {"active": 0, "max": 0}

    async def fake_sign(wallet, tx):
        concurrency["active"] += 1
        concurrency["max"] = max(concurrency["max"], concurrency["active"])
        captured_nonces.append(tx["nonce"])
        await asyncio.sleep(0.02)  # give a real race a chance to happen
        concurrency["active"] -= 1
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", fake_sign)
    monkeypatch.setattr(
        hw_mod.hot_wallet_service,
        "_broadcast_evm_raw_tx",
        lambda web3, raw_tx, claimed_tx_id=None: b"\x01" * 32,
    )

    wallet = _wallet()
    await asyncio.gather(
        hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001")),
        hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001")),
    )

    assert sorted(captured_nonces) == [5, 6], captured_nonces
    assert concurrency["max"] == 1, "critical section overlapped — lock did not serialize"


async def test_pre_broadcast_failure_releases_reservation(tmp_db, monkeypatch):
    web3 = _FakeWeb3(pending_nonce=5)
    _patch_web3(monkeypatch, web3)

    async def failing_sign(wallet, tx):
        raise RuntimeError("turnkey boom")

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", failing_sign)

    wallet = _wallet()
    with pytest.raises(RuntimeError, match="turnkey boom"):
        await hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001"))

    # The failed attempt's nonce (5) must have been released, so the very
    # next successful attempt reuses it rather than skipping to 6.
    captured_nonces = []

    async def ok_sign(wallet, tx):
        captured_nonces.append(tx["nonce"])
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", ok_sign)
    monkeypatch.setattr(
        hw_mod.hot_wallet_service,
        "_broadcast_evm_raw_tx",
        lambda web3, raw_tx, claimed_tx_id=None: b"\x02" * 32,
    )

    await hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001"))
    assert captured_nonces == [5]


async def test_ambiguous_broadcast_failure_does_not_release_reservation(tmp_db, monkeypatch):
    """PostBroadcastAmbiguous means the node may already have accepted the
    tx — the reservation must survive so a retry does NOT reuse the nonce."""
    web3 = _FakeWeb3(pending_nonce=5)
    _patch_web3(monkeypatch, web3)

    async def ok_sign(wallet, tx):
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", ok_sign)

    def boom_broadcast(web3, raw_tx, claimed_tx_id=None):
        raise hw_mod.PostBroadcastAmbiguous("node timeout", tx_hash="0xabc")

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_broadcast_evm_raw_tx", boom_broadcast)

    wallet = _wallet()
    with pytest.raises(hw_mod.PostBroadcastAmbiguous):
        await hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001"))

    captured_nonces = []

    async def ok_sign2(wallet, tx):
        captured_nonces.append(tx["nonce"])
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", ok_sign2)
    monkeypatch.setattr(
        hw_mod.hot_wallet_service,
        "_broadcast_evm_raw_tx",
        lambda web3, raw_tx, claimed_tx_id=None: b"\x03" * 32,
    )
    await hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001"))
    assert captured_nonces == [6], "ambiguous failure's nonce (5) must not be reused"


async def test_sequential_calls_do_not_deadlock(tmp_db, monkeypatch):
    web3 = _FakeWeb3(pending_nonce=5)
    _patch_web3(monkeypatch, web3)

    async def ok_sign(wallet, tx):
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", ok_sign)
    monkeypatch.setattr(
        hw_mod.hot_wallet_service,
        "_broadcast_evm_raw_tx",
        lambda web3, raw_tx, claimed_tx_id=None: b"\x04" * 32,
    )

    wallet = _wallet()
    r1 = await asyncio.wait_for(
        hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001")),
        timeout=2,
    )
    r2 = await asyncio.wait_for(
        hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001")),
        timeout=2,
    )
    assert r1 and r2 and r1 != r2 or r1 == r2  # both completed without hanging


# ── send_token: same fix, ERC20 path ────────────────────────────────────


async def test_concurrent_send_token_gets_distinct_increasing_nonces(tmp_db, monkeypatch):
    web3 = _FakeWeb3(pending_nonce=10)
    _patch_web3(monkeypatch, web3)

    captured_nonces = []
    concurrency = {"active": 0, "max": 0}

    async def fake_sign(wallet, tx):
        concurrency["active"] += 1
        concurrency["max"] = max(concurrency["max"], concurrency["active"])
        captured_nonces.append(tx["nonce"])
        await asyncio.sleep(0.02)
        concurrency["active"] -= 1
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", fake_sign)
    monkeypatch.setattr(
        hw_mod.hot_wallet_service,
        "_broadcast_evm_raw_tx",
        lambda web3, raw_tx, claimed_tx_id=None: b"\x05" * 32,
    )

    wallet = _wallet()
    await asyncio.gather(
        hw_mod.hot_wallet_service.send_token(
            wallet, "base", TOKEN_ADDR, TO_ADDR, Decimal("1"), decimals=6
        ),
        hw_mod.hot_wallet_service.send_token(
            wallet, "base", TOKEN_ADDR, TO_ADDR, Decimal("1"), decimals=6
        ),
    )

    assert sorted(captured_nonces) == [10, 11], captured_nonces
    assert concurrency["max"] == 1


# ── gas_topup_service's real call pattern: fresh asyncio.run() per call ─


def test_repeated_asyncio_run_per_call_does_not_raise_wrong_event_loop(tmp_db, monkeypatch):
    """Regression for the exact bug class the coordinator flagged: an
    `asyncio.Lock` reused across separate `asyncio.run()` invocations (as
    `gas_topup_service.ensure_gas` does — a fresh event loop every call)
    raises "bound to a different event loop" on the second call. The fix
    must survive this pattern, not just `asyncio.gather` within one loop.
    Runs in a real worker thread (like `ensure_gas` does via
    `asyncio.to_thread` from its own async caller) so each `asyncio.run()`
    genuinely gets its own loop AND its own OS thread.
    """
    import threading as _threading

    web3 = _FakeWeb3(pending_nonce=20)
    monkeypatch.setattr(hw_mod.hot_wallet_service, "_get_web3", lambda chain: web3)

    async def ok_sign(wallet, tx):
        return "0x" + "00" * 32

    monkeypatch.setattr(hw_mod.hot_wallet_service, "_sign_via_turnkey", ok_sign)
    monkeypatch.setattr(
        hw_mod.hot_wallet_service,
        "_broadcast_evm_raw_tx",
        lambda web3, raw_tx, claimed_tx_id=None: b"\x06" * 32,
    )

    wallet = _wallet()
    errors = []

    def _run_one():
        try:
            asyncio.run(
                hw_mod.hot_wallet_service.send_native_token(
                    wallet, "base", TO_ADDR, Decimal("0.001")
                )
            )
        except Exception as e:  # noqa: BLE001 — capture for the main thread to assert on
            errors.append(e)

    t1 = _threading.Thread(target=_run_one)
    t1.start()
    t1.join(timeout=5)
    t2 = _threading.Thread(target=_run_one)
    t2.start()
    t2.join(timeout=5)

    assert not errors, f"asyncio.run()-per-call sends raised: {errors}"


# ── unrelated existing behaviour must be unchanged ──────────────────────


async def test_withdrawals_disabled_still_raises_before_touching_the_lock(monkeypatch):
    monkeypatch.setenv("TERMINAL_WITHDRAW_ENABLED", "false")
    wallet = _wallet()
    with pytest.raises(hw_mod.WithdrawalsPausedError):
        await hw_mod.hot_wallet_service.send_native_token(wallet, "base", TO_ADDR, Decimal("0.001"))
