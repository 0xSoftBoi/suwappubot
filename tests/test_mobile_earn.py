"""Tests for GET /v1/mobile/earn, POST /v1/mobile/earn/deposit,
POST /v1/mobile/earn/withdraw (api/routes/mobile.py).

Exposes the existing Aave V3 USDC savings service (bot/services/savings_service.py)
to the Gekko mobile app. The routes never re-implement on-chain calls — they
resolve the wallet from the authenticated JWT, validate the amount, and
delegate to the SAME SavingsService.deposit/withdraw used by the Telegram
/save flow.

MONEY-PATH: this touches deposit/withdraw dispatch (no fee changes, no new
approvals — savings_service.deposit already handles approve-then-supply).
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
from bot.services.savings_service import SavingsError, savings_service

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

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    return app_client()


def _fake_wallet(address="0x" + "11" * 20, wallet_id=7):
    return SimpleNamespace(id=wallet_id, address=address)


# ── auth ─────────────────────────────────────────────────────────────


def test_get_earn_requires_auth(client):
    assert client.get("/v1/mobile/earn").status_code == 401


def test_deposit_requires_auth(client):
    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"})
    assert resp.status_code == 401


def test_withdraw_requires_auth(client):
    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "10"})
    assert resp.status_code == 401


# ── GET /earn ────────────────────────────────────────────────────────


def test_get_earn_shape_with_position_and_idle(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
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
            "protocol": "aave_v3",
            "chain": "base",
            "token": "USDC",
            "balance": "150.5",
            "balanceUsd": 150.5,
            "apy": 4.25,
        }
    ]
    assert body["idle"] == [
        {"chain": "base", "token": "USDC", "balance": "20.0", "balanceUsd": 20.0}
    ]


def test_get_earn_no_wallet_returns_empty_lists(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=None))
    monkeypatch.setattr(savings_service, "get_apy", MagicMock(return_value=3.0))

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["apy"] == 3.0
    assert body["positions"] == []
    assert body["idle"] == []
    assert body["coverage"] == "complete"


def test_get_earn_marks_best_effort_on_balance_read_failure(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
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


def test_get_earn_apy_failure_maps_to_503(client, monkeypatch):
    monkeypatch.setattr(
        savings_service,
        "get_apy",
        MagicMock(side_effect=SavingsError("Could not fetch the current savings rate.")),
    )

    resp = client.get("/v1/mobile/earn", headers=auth_headers())

    assert resp.status_code == 503


# ── amount validation (deposit + withdraw share _parse_earn_amount) ────


@pytest.mark.parametrize("bad_amount", ["-5", "0", "abc", "NaN", "Infinity", "", "  "])
def test_deposit_rejects_invalid_amounts(client, monkeypatch, bad_amount):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/earn/deposit", json={"amount": bad_amount}, headers=auth_headers()
    )

    assert resp.status_code == 400
    assert "txHash" not in resp.json()


def test_deposit_no_wallet_returns_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=None))

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "10"}, headers=auth_headers())

    assert resp.status_code == 400


# ── deposit happy path ──────────────────────────────────────────────


def test_deposit_happy_path(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    deposit_mock = MagicMock(return_value=["0xapprove", "0xsupply"])
    monkeypatch.setattr(savings_service, "deposit", deposit_mock)

    resp = client.post("/v1/mobile/earn/deposit", json={"amount": "25.5"}, headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": True, "txHash": "0xsupply", "amount": "25.5"}
    args, _ = deposit_mock.call_args
    assert args[1] == Decimal("25.5")


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


# ── withdraw ─────────────────────────────────────────────────────────


def test_withdraw_happy_path(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("200")))
    withdraw_mock = MagicMock(return_value="0xwithdraw")
    monkeypatch.setattr(savings_service, "withdraw", withdraw_mock)

    resp = client.post("/v1/mobile/earn/withdraw", json={"amount": "30"}, headers=auth_headers())

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "txHash": "0xwithdraw", "amount": "30"}
    args, _ = withdraw_mock.call_args
    assert args[1] == Decimal("30")


def test_withdraw_max_passes_none_sentinel_to_service(client, monkeypatch):
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
    args, _ = withdraw_mock.call_args
    assert args[1] is None  # full-balance sentinel understood by SavingsService


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


@pytest.mark.parametrize("bad_amount", ["-1", "0", "not-a-number"])
def test_withdraw_rejects_invalid_amounts(client, monkeypatch, bad_amount):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_position", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/earn/withdraw", json={"amount": bad_amount}, headers=auth_headers()
    )

    assert resp.status_code == 400
