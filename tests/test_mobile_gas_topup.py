"""Wiring tests for the gas auto-top-up integration in api/routes/mobile.py —
MONEY-PATH.

bot/services/gas_topup_service.py's caps/happy-path/failure logic is covered
directly in tests/test_gas_topup_service.py. This file covers the WIRING:
  - ordering — a top-up is only ever reachable after the request's balance/
    amount has already been validated, on both /send and /earn/deposit
  - idempotent retry never invokes the top-up-capable code path twice
  - /send's zero-ETH-wallet happy path (top-up then sign+broadcast)
  - top-up failure/cap-exceeded surfaces as a clean, retryable error on both
    /send (SendRejected -> 400) and /earn (GasTopUpFailed -> 503,
    GasTopUpCapExceeded -> 400)
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routes.mobile as mobile_mod
import bot.services.gas_topup_service as gas_topup_mod
from bot.services.savings_service import SavingsError, savings_service

_SECRET = "test-secret"

TO_ADDR = "0x" + "55" * 20
WALLET_ADDR = "0x" + "11" * 20


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(mobile_mod.router)
    return TestClient(app)


def _fake_wallet(address=WALLET_ADDR, wallet_id=7):
    return SimpleNamespace(id=wallet_id, address=address, chain_type="evm")


@pytest.fixture()
def client(monkeypatch):
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    monkeypatch.setattr(mobile_mod, "_is_contract_address", lambda addr: False)
    monkeypatch.setattr(
        mobile_mod, "_db_wallet_lock_try_acquire", MagicMock(return_value="test-holder")
    )
    monkeypatch.setattr(mobile_mod, "_db_wallet_lock_release", MagicMock(return_value=None))
    monkeypatch.setattr(mobile_mod, "_db_send_idem_lookup", MagicMock(return_value=None))
    # Default: "wallet already has enough gas" so tests that don't care about
    # top-up behavior never touch it. Tests below override explicitly.
    monkeypatch.setattr(gas_topup_mod, "ensure_gas", MagicMock(return_value=False))
    monkeypatch.setattr(
        gas_topup_mod, "estimate_gas_wei_for_action", MagicMock(return_value=21_000)
    )
    # F2 fix: deposit now estimates gas via a dedicated live estimator (sum
    # of approve+supply), not the flat estimate_gas_wei_for_action path.
    monkeypatch.setattr(
        gas_topup_mod, "estimate_gas_wei_for_deposit", MagicMock(return_value=21_000)
    )
    return app_client()


@pytest.fixture(autouse=True)
def _reset_module_state():
    mobile_mod._earn_action_limiter._user_requests.clear()
    mobile_mod._send_action_limiter._user_requests.clear()
    mobile_mod._earn_wallet_locks.clear()
    mobile_mod._earn_idem_entries.clear()
    yield
    mobile_mod._earn_action_limiter._user_requests.clear()
    mobile_mod._send_action_limiter._user_requests.clear()
    mobile_mod._earn_wallet_locks.clear()
    mobile_mod._earn_idem_entries.clear()


# ═══════════════════════════════════════════════════════════════════
#  /send — HTTP-level ordering + idempotency
# ═══════════════════════════════════════════════════════════════════


def test_send_ordering_insufficient_balance_never_reaches_topup_capable_code(client, monkeypatch):
    """Balance/amount validation happens BEFORE `_send_usdc_base` (the only
    place a gas top-up can be triggered) is ever called — an unfunded
    request never spends on a top-up."""
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("1")))
    send_mock = MagicMock()
    monkeypatch.setattr(mobile_mod, "_send_usdc_base", send_mock)

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "10"}, headers=auth_headers()
    )

    assert resp.status_code == 400
    assert "Insufficient" in resp.json()["detail"]
    send_mock.assert_not_called()


def test_send_idempotent_retry_does_not_double_invoke_topup_capable_code(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    send_mock = MagicMock(return_value=("0xonce", False))
    monkeypatch.setattr(mobile_mod, "_send_usdc_base", send_mock)

    headers = {**auth_headers(), "Idempotency-Key": "gas-topup-retry-1"}
    resp1 = client.post("/v1/mobile/send", json={"to": TO_ADDR, "amount": "5"}, headers=headers)
    resp2 = client.post("/v1/mobile/send", json={"to": TO_ADDR, "amount": "5"}, headers=headers)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json() == resp2.json()
    # `_send_usdc_base` is the ONLY code path that can trigger a gas top-up —
    # a retry that never reaches it a second time structurally cannot
    # double-spend on a second top-up either.
    send_mock.assert_called_once()


# ═══════════════════════════════════════════════════════════════════
#  `_send_usdc_base` — direct wiring tests (gas precheck / top-up / retry)
# ═══════════════════════════════════════════════════════════════════


def _patch_send_chain(monkeypatch, balances, tx_gas=100_000, tx_gas_price=1_000_000_000):
    import bot.handlers.bulk_pay as bulk_pay_mod
    import bot.services.rpc_manager as rpc_manager_mod
    import bot.services.wallet as wallet_mod

    web3 = MagicMock()
    web3.eth.get_balance = MagicMock(side_effect=list(balances))
    web3.eth.get_transaction_count = MagicMock(return_value=5)
    web3.eth.send_raw_transaction = MagicMock(return_value=b"\x01" * 32)
    monkeypatch.setattr(rpc_manager_mod.rpc_manager, "get_web3", MagicMock(return_value=web3))
    # F7's L1 fee lookup calls web3.eth.contract(...).functions.getL1Fee(...).call(),
    # and MagicMock's auto __int__ default (1) would otherwise silently add 1
    # wei to every gas_cost computed below — pin it to a known value instead.
    monkeypatch.setattr(gas_topup_mod, "estimate_l1_data_fee_wei", MagicMock(return_value=0))

    monkeypatch.setattr(
        bulk_pay_mod,
        "_build_erc20_transfer_tx",
        MagicMock(
            return_value={
                "to": TO_ADDR,
                "data": "0x",
                "gas": tx_gas,
                "gasPrice": tx_gas_price,
                "nonce": 5,
                "chainId": 8453,
            }
        ),
    )
    monkeypatch.setattr(
        wallet_mod.WalletService,
        "sign_evm_transaction",
        AsyncMock(return_value="0x" + "11" * 40),
    )
    return web3


def test_send_usdc_base_no_topup_when_balance_sufficient(monkeypatch):
    gas_cost = 100_000 * 1_000_000_000
    _patch_send_chain(monkeypatch, balances=[gas_cost + 1])
    ensure_gas_mock = MagicMock()
    monkeypatch.setattr(gas_topup_mod, "ensure_gas", ensure_gas_mock)

    tx_hash, is_pending = mobile_mod._send_usdc_base(_fake_wallet(), TO_ADDR, Decimal("5"), 42)

    assert is_pending is False
    assert tx_hash
    ensure_gas_mock.assert_not_called()


def test_send_usdc_base_tops_up_zero_eth_wallet_then_sends(monkeypatch):
    """Happy path: a zero-ETH wallet still succeeds at sending USDC."""
    gas_cost = 100_000 * 1_000_000_000
    _patch_send_chain(monkeypatch, balances=[0, gas_cost + 1])
    ensure_gas_mock = MagicMock(return_value=True)
    monkeypatch.setattr(gas_topup_mod, "ensure_gas", ensure_gas_mock)

    tx_hash, is_pending = mobile_mod._send_usdc_base(_fake_wallet(), TO_ADDR, Decimal("5"), 42)

    assert is_pending is False
    assert tx_hash
    ensure_gas_mock.assert_called_once()
    kwargs = ensure_gas_mock.call_args.kwargs
    assert kwargs["user_id"] == 42
    # Only ever tops up the AUTHENTICATED user's own resolved wallet.
    assert kwargs["wallet_address"].lower() == WALLET_ADDR.lower()
    assert kwargs["estimated_gas_wei"] == gas_cost


def test_send_usdc_base_topup_failure_surfaces_as_clean_retryable_rejection(monkeypatch):
    _patch_send_chain(monkeypatch, balances=[0])
    monkeypatch.setattr(
        gas_topup_mod,
        "ensure_gas",
        MagicMock(side_effect=gas_topup_mod.GasTopUpFailed("We couldn't get your wallet ready.")),
    )

    with pytest.raises(mobile_mod.SendRejected):
        mobile_mod._send_usdc_base(_fake_wallet(), TO_ADDR, Decimal("5"), 42)


def test_send_usdc_base_topup_cap_exceeded_surfaces_as_clean_rejection(monkeypatch):
    _patch_send_chain(monkeypatch, balances=[0])
    monkeypatch.setattr(
        gas_topup_mod,
        "ensure_gas",
        MagicMock(side_effect=gas_topup_mod.GasTopUpCapExceeded("Daily gas top-up limit reached.")),
    )

    with pytest.raises(mobile_mod.SendRejected):
        mobile_mod._send_usdc_base(_fake_wallet(), TO_ADDR, Decimal("5"), 42)


def test_send_usdc_base_still_short_after_topup_never_signs_or_broadcasts(monkeypatch):
    """`ensure_gas` reporting success must be re-verified, not trusted blindly
    — if the wallet is still short, never proceed to sign/broadcast."""
    web3 = _patch_send_chain(monkeypatch, balances=[0, 1])
    monkeypatch.setattr(gas_topup_mod, "ensure_gas", MagicMock(return_value=True))

    with pytest.raises(mobile_mod.SendRejected):
        mobile_mod._send_usdc_base(_fake_wallet(), TO_ADDR, Decimal("5"), 42)

    web3.eth.send_raw_transaction.assert_not_called()


# ═══════════════════════════════════════════════════════════════════
#  /earn/deposit — ordering + cap/failure mapping
# ═══════════════════════════════════════════════════════════════════


def test_earn_deposit_unfunded_amount_skips_topup(client, monkeypatch):
    """An explicit amount greater than the live balance is bound to be
    rejected by SavingsService anyway — the top-up must never fire for it."""
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("5")))
    monkeypatch.setattr(
        savings_service, "deposit", MagicMock(side_effect=SavingsError("Insufficient USDC."))
    )
    ensure_gas_mock = MagicMock()
    monkeypatch.setattr(gas_topup_mod, "ensure_gas", ensure_gas_mock)

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "50"}, headers=auth_headers())

    assert resp.status_code == 400
    ensure_gas_mock.assert_not_called()


def test_earn_deposit_funded_amount_tops_up_before_depositing(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    order = []
    monkeypatch.setattr(
        gas_topup_mod, "ensure_gas", MagicMock(side_effect=lambda **kw: order.append("topup"))
    )
    monkeypatch.setattr(
        savings_service,
        "deposit",
        MagicMock(side_effect=lambda *a, **kw: order.append("deposit") or ["0xsupply"]),
    )

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 200
    assert order == ["topup", "deposit"]


def test_earn_topup_cap_exceeded_maps_to_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        gas_topup_mod,
        "ensure_gas",
        MagicMock(side_effect=gas_topup_mod.GasTopUpCapExceeded("Daily gas top-up limit reached.")),
    )

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 400
    assert "gas top-up" in resp.json()["detail"].lower()


def test_earn_topup_failed_maps_to_503_retryable(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        gas_topup_mod,
        "ensure_gas",
        MagicMock(side_effect=gas_topup_mod.GasTopUpFailed("We couldn't get your wallet ready.")),
    )

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 503
