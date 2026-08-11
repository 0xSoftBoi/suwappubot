"""Tests for GET /v1/mobile/earn, POST /v1/mobile/earn/deposit,
POST /v1/mobile/earn/withdraw (api/routes/mobile.py).

Exposes the existing Aave V3 USDC savings service (bot/services/savings_service.py)
to the Gekko mobile app. The routes never re-implement on-chain calls — they
resolve the wallet from the authenticated JWT (or a JWT-owned `walletId`),
validate the amount, and delegate to the SAME SavingsService.deposit/withdraw
used by the Telegram /save flow.

MONEY-PATH: this touches deposit/withdraw dispatch, per-wallet locking,
idempotency-key replay, and amount validation/quantization (no fee changes,
no new approvals — savings_service.deposit already handles approve-then-supply).
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import asyncio
import threading
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

import api.routes.mobile as mobile_mod
from bot.services.savings_service import SavingsError, SavingsPending, savings_service

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(mobile_mod.router)
    return TestClient(app)


@pytest.fixture()
def client(monkeypatch):
    import api.main as main_mod
    import bot.services.gas_topup_service as gas_topup_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    # Gas auto-top-up (MONEY-PATH) is exercised by tests/test_gas_topup_service.py
    # and tests/test_mobile_gas_topup.py directly. These pre-existing deposit/
    # withdraw tests are about savings dispatch, not gas — default to "wallet
    # already has enough gas, no top-up needed" so they never make a real
    # web3/RPC call. Tests that DO care about gas top-up override these.
    monkeypatch.setattr(gas_topup_mod, "ensure_gas", MagicMock(return_value=False))
    monkeypatch.setattr(gas_topup_mod, "estimate_gas_wei_for_action", MagicMock(return_value=21000))
    return app_client()


@pytest.fixture(autouse=True)
def _reset_earn_module_state():
    """The per-user rate limiter, per-wallet locks, and idempotency cache are
    module-level singletons (by design — they must survive across requests
    within a process). Reset them between tests so one test's calls never
    count against another test's rate limit / idempotency replay."""
    mobile_mod._earn_action_limiter._user_requests.clear()
    mobile_mod._earn_wallet_locks.clear()
    mobile_mod._earn_idem_entries.clear()
    yield
    mobile_mod._earn_action_limiter._user_requests.clear()
    mobile_mod._earn_wallet_locks.clear()
    mobile_mod._earn_idem_entries.clear()


def _fake_wallet(address="0x" + "11" * 20, wallet_id=7):
    return SimpleNamespace(id=wallet_id, address=address, chain_type="evm")


# ── auth ─────────────────────────────────────────────────────────────


def test_get_earn_requires_auth(client):
    assert client.get("/v1/mobile/earn").status_code == 401


def test_deposit_requires_auth(client):
    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"})
    assert resp.status_code == 401


def test_withdraw_requires_auth(client):
    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "10"})
    assert resp.status_code == 401


# ── GET /earn (multi-wallet aggregation) ────────────────────────────────


def test_get_earn_shape_with_position_and_idle(client, monkeypatch):
    wallet = _fake_wallet()
    monkeypatch.setattr(mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[wallet]))
    monkeypatch.setattr(savings_service, "get_apy", MagicMock(return_value=4.25))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("150.5")))
    monkeypatch.setattr(
        savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("20.0"))
    )

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["apy"] == 4.25
    assert body["coverage"] == "complete"
    assert body["positions"] == [
        {
            "walletId": wallet.id,
            "walletAddress": wallet.address,
            "protocol": "aave_v3",
            "chain": "base",
            "token": "USDC",
            "balance": "150.5",
            "balanceUsd": 150.5,
            "apy": 4.25,
        }
    ]
    assert body["idle"] == [
        {
            "walletId": wallet.id,
            "walletAddress": wallet.address,
            "chain": "base",
            "token": "USDC",
            "balance": "20.0",
            "balanceUsd": 20.0,
        }
    ]


def test_get_earn_no_wallet_returns_empty_lists(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[]))
    monkeypatch.setattr(savings_service, "get_apy", MagicMock(return_value=3.0))

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["apy"] == 3.0
    assert body["positions"] == []
    assert body["idle"] == []
    assert body["coverage"] == "complete"


def test_get_earn_marks_best_effort_on_balance_read_failure(client, monkeypatch):
    monkeypatch.setattr(
        mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[_fake_wallet()])
    )
    monkeypatch.setattr(savings_service, "get_apy", MagicMock(return_value=3.0))
    monkeypatch.setattr(
        savings_service,
        "get_position",
        MagicMock(side_effect=SavingsError("Could not fetch your savings balance.")),
    )
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("1")))

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 200
    assert resp.json()["coverage"] == "best_effort"


def test_get_earn_aggregates_across_multiple_wallets(client, monkeypatch):
    w1 = _fake_wallet(address="0x" + "11" * 20, wallet_id=7)
    w2 = _fake_wallet(address="0x" + "22" * 20, wallet_id=8)
    monkeypatch.setattr(mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[w1, w2]))
    monkeypatch.setattr(savings_service, "get_apy", MagicMock(return_value=4.0))

    def _position(addr):
        return Decimal("100") if addr == w1.address else Decimal("0")

    def _idle(addr):
        return Decimal("0") if addr == w1.address else Decimal("50")

    monkeypatch.setattr(savings_service, "get_position", MagicMock(side_effect=_position))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(side_effect=_idle))

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert {p["walletId"] for p in body["positions"]} == {7}
    assert {i["walletId"] for i in body["idle"]} == {8}


def test_get_earn_apy_failure_maps_to_503(client, monkeypatch):
    monkeypatch.setattr(
        savings_service,
        "get_apy",
        MagicMock(side_effect=SavingsError("Could not fetch the current savings rate.")),
    )

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 503


# ── amount validation (deposit + withdraw share _parse_earn_amount) ────


@pytest.mark.parametrize(
    "bad_amount",
    ["-5", "0", "abc", "NaN", "Infinity", "", "  ", "0.005", "0.009999"],
)
def test_deposit_rejects_invalid_amounts(client, monkeypatch, bad_amount):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/earn/deposit", json={"amount": bad_amount}, headers=auth_headers()
    )

    assert resp.status_code == 400
    assert "txHash" not in resp.json()


def test_deposit_rejects_dust_below_minimum(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "0.005"}, headers=auth_headers())

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Minimum amount is 0.01 USDC"


def test_deposit_rejects_amount_above_magnitude_bound(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/earn/deposit", json={"amount": "1000001"}, headers=auth_headers()
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid amount"


def test_deposit_huge_exponent_amount_is_400_not_500(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/earn/deposit", json={"amount": "1E+999990"}, headers=auth_headers()
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid amount"


def test_deposit_no_wallet_returns_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=None))

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 400


# ── walletId (multi-wallet deposit/withdraw targeting) ──────────────────


def test_deposit_with_unknown_walletId_returns_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet_by_id", AsyncMock(return_value=None))

    resp = client.post(
        "/v1/mobile/earn/deposit",
        json={"amount": "10", "walletId": 999},
        headers=auth_headers(),
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Unknown wallet"


def test_deposit_with_valid_walletId_targets_that_wallet(client, monkeypatch):
    wallet = _fake_wallet(address="0x" + "33" * 20, wallet_id=42)
    resolve_by_id = AsyncMock(return_value=wallet)
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet_by_id", resolve_by_id)
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    resp = client.post(
        "/v1/mobile/earn/deposit",
        json={"amount": "10", "walletId": 42},
        headers=auth_headers(),
    )

    assert resp.status_code == 200
    resolve_by_id.assert_awaited_once_with(1, 42)
    args, _ = deposit_mock.call_args
    assert args[0] is wallet


# ── deposit happy path ──────────────────────────────────────────────


def test_deposit_happy_path(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xapprove", "0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "25.5"}, headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    # Echoed amount is quantized to 6dp (LOW finding) so it always matches
    # the wei actually executed on-chain — trailing zeros are expected.
    assert body == {"ok": True, "txHash": "0xsupply", "amount": "25.500000"}
    args, _ = deposit_mock.call_args
    assert args[1] == Decimal("25.5")


def test_deposit_quantizes_amount_to_6dp_round_down(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    resp = client.post(
        "/v1/mobile/earn/deposit", json={"amount": "25.1234567"}, headers=auth_headers()
    )

    assert resp.status_code == 200
    assert resp.json()["amount"] == "25.123456"
    args, _ = deposit_mock.call_args
    assert args[1] == Decimal("25.123456")


def test_deposit_max_uses_live_idle_balance(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("42.123456"))
    )
    deposit_mock = MagicMock(return_value=["0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "max"}, headers=auth_headers())

    assert resp.status_code == 200
    assert resp.json()["amount"] == "42.123456"
    args, _ = deposit_mock.call_args
    assert args[1] == Decimal("42.123456")


def test_deposit_max_with_zero_idle_returns_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("0")))

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "max"}, headers=auth_headers())

    assert resp.status_code == 400


def test_deposit_service_error_maps_to_400_without_leaking_traceback(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        savings_service,
        "deposit",
        MagicMock(side_effect=SavingsError("Insufficient USDC. You have 5.00 USDC.")),
    )

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "50"}, headers=auth_headers())

    assert resp.status_code == 400
    assert "Insufficient USDC" in resp.json()["detail"]


def test_deposit_unexpected_exception_does_not_leak_raw_error(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        savings_service,
        "deposit",
        MagicMock(side_effect=RuntimeError("private key file not found: /secret/path")),
    )

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "50"}, headers=auth_headers())

    assert resp.status_code == 500
    assert "private key" not in resp.json()["detail"]
    assert "/secret/path" not in resp.json()["detail"]


def test_deposit_pending_confirmation_returns_202(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        savings_service,
        "deposit",
        MagicMock(
            side_effect=SavingsPending(
                "Your deposit was submitted but confirmation timed out.", tx_hash="deadbeef"
            )
        ),
    )

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 202
    assert resp.json() == {"ok": False, "status": "pending", "txHash": "deadbeef"}


# ── withdraw ─────────────────────────────────────────────────────────


def test_withdraw_happy_path(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("200")))
    withdraw_mock = MagicMock(return_value="0xwithdraw")
    monkeypatch.setattr(savings_service, "withdraw", withdraw_mock)

    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "30"}, headers=auth_headers())

    assert resp.status_code == 200
    # Quantized to 6dp (LOW finding) — trailing zeros are expected.
    assert resp.json() == {"ok": True, "txHash": "0xwithdraw", "amount": "30.000000"}
    args, _ = withdraw_mock.call_args
    assert args[1] == Decimal("30")


def test_withdraw_max_passes_none_sentinel_and_marks_approximate(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service, "get_position", MagicMock(return_value=Decimal("87.654321"))
    )
    withdraw_mock = MagicMock(return_value="0xwithdrawall")
    monkeypatch.setattr(savings_service, "withdraw", withdraw_mock)

    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "max"}, headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["txHash"] == "0xwithdrawall"
    assert body["amount"] == "87.654321"
    assert body["approximate"] is True
    args, _ = withdraw_mock.call_args
    assert args[1] is None  # full-balance sentinel understood by SavingsService


def test_withdraw_partial_amount_has_no_approximate_flag(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("200")))
    monkeypatch.setattr(savings_service, "withdraw", MagicMock(return_value="0xwithdraw"))

    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "30"}, headers=auth_headers())

    assert resp.status_code == 200
    assert "approximate" not in resp.json()


def test_withdraw_service_error_maps_to_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("5")))
    monkeypatch.setattr(
        savings_service,
        "withdraw",
        MagicMock(side_effect=SavingsError("Insufficient savings. You have 5.00 USDC saved.")),
    )

    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "50"}, headers=auth_headers())

    assert resp.status_code == 400
    assert "Insufficient savings" in resp.json()["detail"]


def test_withdraw_pending_confirmation_returns_202(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("50")))
    monkeypatch.setattr(
        savings_service,
        "withdraw",
        MagicMock(
            side_effect=SavingsPending(
                "Your withdrawal was submitted but confirmation timed out.", tx_hash="cafebabe"
            )
        ),
    )

    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "30"}, headers=auth_headers())

    assert resp.status_code == 202
    assert resp.json() == {"ok": False, "status": "pending", "txHash": "cafebabe"}


@pytest.mark.parametrize("bad_amount", ["-1", "0", "not-a-number", "0.005"])
def test_withdraw_rejects_invalid_amounts(client, monkeypatch, bad_amount):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/earn/withdraw", json={"amount": bad_amount}, headers=auth_headers()
    )

    assert resp.status_code == 400


# ── idempotency-key replay ───────────────────────────────────────────


def test_deposit_idempotency_key_replay_skips_second_service_call(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    headers = {**auth_headers(), "Idempotency-Key": "retry-abc"}
    resp1 = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=headers)
    resp2 = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=headers)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json() == resp2.json()
    assert deposit_mock.call_count == 1


def test_deposit_different_idempotency_keys_both_execute(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    resp1 = client.post(
        "/v1/mobile/earn/deposit",
        json={"amount": "10"},
        headers={**auth_headers(), "Idempotency-Key": "key-a"},
    )
    resp2 = client.post(
        "/v1/mobile/earn/deposit",
        json={"amount": "10"},
        headers={**auth_headers(), "Idempotency-Key": "key-b"},
    )

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert deposit_mock.call_count == 2


# ── rate limiting ────────────────────────────────────────────────────


def test_deposit_rate_limited_after_six_per_minute(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("1000"))
    )
    monkeypatch.setattr(savings_service, "deposit", MagicMock(return_value=["0xtx"]))

    for i in range(6):
        resp = client.post(
            "/v1/mobile/earn/deposit",
            json={"amount": "1"},
            headers={**auth_headers(), "Idempotency-Key": f"burst-{i}"},
        )
        assert resp.status_code == 200, resp.json()

    resp = client.post(
        "/v1/mobile/earn/deposit",
        json={"amount": "1"},
        headers={**auth_headers(), "Idempotency-Key": "burst-7"},
    )
    assert resp.status_code == 429


# ── concurrency: same-wallet calls serialize ─────────────────────────


@pytest.mark.asyncio
async def test_concurrent_deposit_calls_for_same_wallet_serialize(monkeypatch):
    """Two overlapping deposit calls for the SAME (user, wallet) must not
    both read a balance / execute concurrently — the second call blocks on
    the per-wallet lock until the first fully finishes."""
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("1000"))
    )

    calls: list[str] = []
    first_call_started = threading.Event()
    release_first_call = threading.Event()

    def _dispatch(wallet, amount):
        calls.append("start")
        if calls.count("start") == 1:
            first_call_started.set()
            assert release_first_call.wait(timeout=5), "test deadlocked waiting for release"
        calls.append("end")
        return [f"0xtx{len(calls)}"]

    monkeypatch.setattr(savings_service, "deposit", MagicMock(side_effect=_dispatch))

    app = FastAPI()
    app.include_router(mobile_mod.router)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        task1 = asyncio.create_task(
            ac.post(
                "/v1/mobile/earn/deposit",
                json={"amount": "1"},
                headers={**auth_headers(), "Idempotency-Key": "concurrent-1"},
            )
        )
        await asyncio.to_thread(first_call_started.wait, 5)

        task2 = asyncio.create_task(
            ac.post(
                "/v1/mobile/earn/deposit",
                json={"amount": "2"},
                headers={**auth_headers(), "Idempotency-Key": "concurrent-2"},
            )
        )
        # Give task2's coroutine a chance to run and hit the wallet lock —
        # it must still be blocked, not yet inside savings_service.deposit.
        await asyncio.sleep(0.2)
        assert calls.count("start") == 1

        release_first_call.set()
        resp1, resp2 = await asyncio.gather(task1, task2)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    # Fully sequential: the second call's start/end never interleaves with
    # the first's — it only begins once the first has entirely finished.
    assert calls == ["start", "end", "start", "end"]


# ── cross-replica DB wallet lock on the earn path ──────────────────────
# /send and /earn reserve nonces on the SAME wallet, so both must take the
# cross-process lock — the in-process lock only serializes a single replica.


def test_deposit_returns_503_when_db_wallet_lock_is_held(client, monkeypatch):
    """Another replica holding the wallet lock must block the deposit rather
    than let a second nonce reservation race it."""
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)
    monkeypatch.setattr(mobile_mod, "_db_wallet_lock_try_acquire", MagicMock(return_value=None))

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 503
    # The on-chain call must never have been reached.
    deposit_mock.assert_not_called()


def test_deposit_releases_db_wallet_lock_after_success(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(savings_service, "deposit", MagicMock(return_value=["0xsupply"]))
    monkeypatch.setattr(
        mobile_mod, "_db_wallet_lock_try_acquire", MagicMock(return_value="holder-abc")
    )
    release = MagicMock(return_value=None)
    monkeypatch.setattr(mobile_mod, "_db_wallet_lock_release", release)

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 200
    release.assert_called_once()
    assert release.call_args[0][1] == "holder-abc"


def test_deposit_releases_db_wallet_lock_when_service_fails(client, monkeypatch):
    """A failed deposit must not leave the wallet wedged until the TTL."""
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        savings_service, "deposit", MagicMock(side_effect=SavingsError("on-chain revert"))
    )
    monkeypatch.setattr(
        mobile_mod, "_db_wallet_lock_try_acquire", MagicMock(return_value="holder-xyz")
    )
    release = MagicMock(return_value=None)
    monkeypatch.setattr(mobile_mod, "_db_wallet_lock_release", release)

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 400
    release.assert_called_once()
    assert release.call_args[0][1] == "holder-xyz"
