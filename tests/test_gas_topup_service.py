"""Tests for bot/services/gas_topup_service.py — MONEY-PATH.

Auto gas top-up from the hot wallet so a Gekko user never needs to hold ETH
to move USDC on Base. Covers: no-op when balance is already sufficient, the
per-transaction ceiling, per-user daily caps (count + value), the global
daily circuit breaker, the happy path (zero-ETH wallet gets topped up and
the audit row is written), and every retryable-failure path (broadcast
failure, confirmation timeout, on-chain revert, no gas payer configured).
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import bot.services.gas_topup_service as topup_mod
import bot.services.hot_wallet as hot_wallet_mod
import bot.services.price_service as price_service_mod
import bot.services.rpc_manager as rpc_manager_mod
from bot.models.gas_topup import GasTopUp
from bot.models.user import User
from database.db import get_session

WALLET = "0x" + "22" * 20
GAS_WALLET_ADDR = "0x" + "33" * 20
OTHER_WALLET = "0x" + "44" * 20


def _make_user(telegram_id: int) -> int:
    with get_session() as session:
        user = User(telegram_id=telegram_id, username=f"u{telegram_id}", tos_accepted=True)
        session.add(user)
        session.flush()
        return user.id


def _fake_web3(balances, gas_price=1_000_000_000, receipt_status=1, receipt_error=None):
    """`balances` is consumed in order by successive `eth.get_balance` calls."""
    web3 = MagicMock()
    web3.eth.get_balance = MagicMock(side_effect=list(balances))
    web3.eth.gas_price = gas_price
    if receipt_error is not None:
        web3.eth.wait_for_transaction_receipt = MagicMock(side_effect=receipt_error)
    else:
        web3.eth.wait_for_transaction_receipt = MagicMock(return_value={"status": receipt_status})
    return web3


@pytest.fixture(autouse=True)
def _patch_price(monkeypatch):
    """Deterministic ETH price for every test unless a test overrides it."""
    monkeypatch.setattr(
        price_service_mod.price_service, "get_prices", AsyncMock(return_value={"ETH": 3000.0})
    )


@pytest.fixture()
def fake_gas_wallet():
    return SimpleNamespace(address=GAS_WALLET_ADDR, id=1)


def _rows_for(user_id: int):
    with get_session() as session:
        return session.query(GasTopUp).filter(GasTopUp.user_id == user_id).all()


# ── no-op when balance is already sufficient ────────────────────────────


def test_no_topup_when_balance_sufficient(tmp_db, monkeypatch):
    user_id = _make_user(101)
    web3 = _fake_web3(balances=[10**18])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    result = topup_mod.ensure_gas(
        user_id=user_id,
        wallet_address=WALLET,
        chain_name="base",
        estimated_gas_wei=1000,
        reason="test",
    )

    assert result is False
    send_mock.assert_not_called()
    assert _rows_for(user_id) == []


# ── happy path: zero-ETH wallet gets topped up ──────────────────────────


def test_topup_happy_path_zero_eth_wallet(tmp_db, monkeypatch, fake_gas_wallet):
    user_id = _make_user(102)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    send_mock = AsyncMock(return_value="0xtopuphash")
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    result = topup_mod.ensure_gas(
        user_id=user_id,
        wallet_address=WALLET,
        chain_name="base",
        estimated_gas_wei=21_000 * 1_000_000_000,
        reason="mobile_send",
    )

    assert result is True
    send_mock.assert_awaited_once()
    kwargs = send_mock.await_args.kwargs
    # Only ever sends to the wallet address the caller resolved (the
    # authenticated user's own wallet) — never anything else.
    assert kwargs["to_address"].lower() == WALLET.lower()
    assert kwargs["wallet"] is fake_gas_wallet

    rows = _rows_for(user_id)
    assert len(rows) == 1
    assert rows[0].tx_hash == "0xtopuphash"
    assert rows[0].wallet_address.lower() == WALLET.lower()
    assert rows[0].reason == "mobile_send"
    assert rows[0].status == "sent"
    assert rows[0].amount_wei > 0


# ── per-transaction ceiling ──────────────────────────────────────────────


def test_per_tx_ceiling_exceeded_raises_without_spending(tmp_db, monkeypatch):
    user_id = _make_user(103)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=10**18,  # ~1 ETH, way beyond the $0.50 ceiling
            reason="test",
        )

    send_mock.assert_not_called()
    assert _rows_for(user_id) == []


# ── per-user daily caps ──────────────────────────────────────────────────


def test_per_user_daily_count_cap(tmp_db, monkeypatch):
    user_id = _make_user(104)
    with get_session() as session:
        for _ in range(topup_mod.MAX_TOPUPS_PER_USER_PER_DAY):
            session.add(
                GasTopUp(
                    user_id=user_id,
                    wallet_address=WALLET,
                    chain="base",
                    amount_wei=1,
                    tx_hash="0xseed",
                    reason="seed",
                    status="sent",
                )
            )
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=100,
            reason="test",
        )

    send_mock.assert_not_called()


def test_per_user_daily_value_cap(tmp_db, monkeypatch):
    user_id = _make_user(105)
    ceiling = topup_mod._max_topup_wei()
    max_daily = ceiling * topup_mod.USER_DAILY_TOPUP_MULTIPLE
    with get_session() as session:
        session.add(
            GasTopUp(
                user_id=user_id,
                wallet_address=WALLET,
                chain="base",
                amount_wei=max_daily - 10,
                tx_hash="0xseed",
                reason="seed",
                status="sent",
            )
        )
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with pytest.raises(topup_mod.GasTopUpCapExceeded):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=ceiling,
            reason="test",
        )

    send_mock.assert_not_called()


# ── global daily circuit breaker ─────────────────────────────────────────


def test_global_daily_circuit_breaker_trips_and_logs_critical(tmp_db, monkeypatch, caplog):
    user_id = _make_user(106)
    other_user_id = _make_user(107)
    ceiling = topup_mod._max_topup_wei()
    max_global = ceiling * topup_mod.GLOBAL_DAILY_TOPUP_MULTIPLE
    with get_session() as session:
        session.add(
            GasTopUp(
                user_id=other_user_id,
                wallet_address=OTHER_WALLET,
                chain="base",
                amount_wei=max_global - 10,
                tx_hash="0xseed",
                reason="seed",
                status="sent",
            )
        )
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    send_mock = AsyncMock()
    monkeypatch.setattr(hot_wallet_mod.hot_wallet_service, "send_native_token", send_mock)

    with caplog.at_level("CRITICAL"):
        with pytest.raises(topup_mod.GasTopUpCapExceeded):
            topup_mod.ensure_gas(
                user_id=user_id,
                wallet_address=WALLET,
                chain_name="base",
                estimated_gas_wei=ceiling,
                reason="test",
            )

    send_mock.assert_not_called()
    assert any("CIRCUIT BREAKER" in rec.message for rec in caplog.records)


# ── failure / retryable paths ────────────────────────────────────────────


def test_no_gas_payer_wallet_raises_retryable_failure(tmp_db, monkeypatch):
    user_id = _make_user(108)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service, "get_gas_payer_wallet", MagicMock(return_value=None)
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )


def test_topup_broadcast_failure_raises_retryable_and_records_nothing(
    tmp_db, monkeypatch, fake_gas_wallet
):
    user_id = _make_user(109)
    web3 = _fake_web3(balances=[0])
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "send_native_token",
        AsyncMock(side_effect=RuntimeError("rpc down")),
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    # Nothing was ever broadcast, so there is nothing to audit — never
    # claims a spend that didn't happen.
    assert _rows_for(user_id) == []


def test_topup_confirmation_timeout_raises_retryable_but_records_the_spend(
    tmp_db, monkeypatch, fake_gas_wallet
):
    user_id = _make_user(110)
    web3 = _fake_web3(balances=[0], receipt_error=TimeoutError("no receipt"))
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service, "send_native_token", AsyncMock(return_value="0xslow")
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )

    # Real funds were broadcast even though confirmation timed out — the
    # audit trail must not silently lose that spend.
    rows = _rows_for(user_id)
    assert len(rows) == 1
    assert rows[0].tx_hash == "0xslow"


def test_topup_reverted_onchain_raises_retryable_failure(tmp_db, monkeypatch, fake_gas_wallet):
    user_id = _make_user(111)
    web3 = _fake_web3(balances=[0], receipt_status=0)
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "get_gas_payer_wallet",
        MagicMock(return_value=fake_gas_wallet),
    )
    monkeypatch.setattr(
        hot_wallet_mod.hot_wallet_service,
        "send_native_token",
        AsyncMock(return_value="0xreverted"),
    )

    with pytest.raises(topup_mod.GasTopUpFailed):
        topup_mod.ensure_gas(
            user_id=user_id,
            wallet_address=WALLET,
            chain_name="base",
            estimated_gas_wei=21_000,
            reason="test",
        )


# ── price fallback ────────────────────────────────────────────────────────


def test_max_topup_wei_falls_back_when_price_lookup_fails(monkeypatch):
    monkeypatch.setattr(
        price_service_mod.price_service,
        "get_prices",
        AsyncMock(side_effect=RuntimeError("price api down")),
    )
    ceiling = topup_mod._max_topup_wei()
    assert ceiling == min(
        topup_mod.GAS_TOPUP_FALLBACK_MAX_WEI, topup_mod.GAS_TOPUP_ABSOLUTE_MAX_WEI
    )
