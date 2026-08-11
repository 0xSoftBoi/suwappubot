"""Tests for the newer Gekko mobile endpoints in api/routes/mobile.py:

  GET  /v1/mobile/wallets   — list the caller's wallets (read-only)
  POST /v1/mobile/send      — USDC-on-Base send (MONEY-PATH)
  GET  /v1/mobile/borrow    — Morpho Blue borrow snapshot (read-only)
  GET  /v1/mobile/statement — monthly account statement (read-only)

Every write path is a thin wrapper around an existing, already-tested
service (bot.services.savings_service for balance reads, WalletService +
bot.handlers.bulk_pay's ERC-20 tx builder for send, bot.services.morpho_api
for borrow) — these tests mock at that boundary, never at web3/RPC.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import math
from datetime import datetime, timezone
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


@pytest.fixture(autouse=True)
def _reset_module_state():
    """Same module-level singletons /earn's tests reset — /send shares the
    per-wallet lock + idempotency cache with /earn on purpose (see the
    MONEY-PATH comment above the /send section in mobile.py)."""
    mobile_mod._earn_action_limiter._user_requests.clear()
    mobile_mod._send_action_limiter._user_requests.clear()
    mobile_mod._earn_wallet_locks.clear()
    mobile_mod._earn_idem_entries.clear()
    yield
    mobile_mod._earn_action_limiter._user_requests.clear()
    mobile_mod._send_action_limiter._user_requests.clear()
    mobile_mod._earn_wallet_locks.clear()
    mobile_mod._earn_idem_entries.clear()


def _fake_wallet(address="0x" + "11" * 20, wallet_id=7, name="Mobile Wallet"):
    return SimpleNamespace(
        id=wallet_id, address=address, chain_type="evm", name=name, is_default=True
    )


TO_ADDR = "0x" + "22" * 20


# ── GET /wallets ─────────────────────────────────────────────────────


def test_list_wallets_requires_auth(client):
    assert client.get("/v1/mobile/wallets").status_code == 401


def test_list_wallets_matches_post_wallets_shape(client, monkeypatch):
    w1 = _fake_wallet(address="0x" + "11" * 20, wallet_id=1, name="Main")
    w2 = SimpleNamespace(
        id=2, address="0x" + "33" * 20, chain_type="evm", name="Second", is_default=False
    )

    class _FakeWalletService:
        def get_user_wallets(self, user_id):
            return [w1, w2]

    import bot.services.wallet as wallet_mod

    monkeypatch.setattr(wallet_mod, "WalletService", lambda: _FakeWalletService())

    resp = client.get("/v1/mobile/wallets", headers=auth_headers())

    assert resp.status_code == 200
    assert resp.json() == [
        {"address": w1.address, "name": "Main", "chainType": "evm", "isDefault": True},
        {"address": w2.address, "name": "Second", "chainType": "evm", "isDefault": False},
    ]


def test_list_wallets_empty(client, monkeypatch):
    class _FakeWalletService:
        def get_user_wallets(self, user_id):
            return []

    import bot.services.wallet as wallet_mod

    monkeypatch.setattr(wallet_mod, "WalletService", lambda: _FakeWalletService())

    resp = client.get("/v1/mobile/wallets", headers=auth_headers())

    assert resp.status_code == 200
    assert resp.json() == []


# ── POST /send: auth + validation ───────────────────────────────────


def test_send_requires_auth(client):
    resp = client.post("/v1/mobile/send", json={"to": TO_ADDR, "amount": "1"})
    assert resp.status_code == 401


def test_send_rejects_unsupported_token(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))

    resp = client.post(
        "/v1/mobile/send",
        json={"to": TO_ADDR, "amount": "1", "token": "ETH"},
        headers=auth_headers(),
    )

    assert resp.status_code == 400


def test_send_rejects_unsupported_chain(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))

    resp = client.post(
        "/v1/mobile/send",
        json={"to": TO_ADDR, "amount": "1", "chain": "ethereum"},
        headers=auth_headers(),
    )

    assert resp.status_code == 400


@pytest.mark.parametrize(
    "bad_to",
    [
        "not-an-address",
        "0x123",
        "0x" + "00" * 20,  # zero address
        "0x" + "gg" * 20,
    ],
)
def test_send_rejects_invalid_address(client, monkeypatch, bad_to):
    resp = client.post(
        "/v1/mobile/send", json={"to": bad_to, "amount": "1"}, headers=auth_headers()
    )
    assert resp.status_code == 400


def test_send_rejects_self_send(client, monkeypatch):
    wallet = _fake_wallet(address="0x" + "ab" * 20)
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=wallet))

    # Same address, different case — "0x" prefix stays lowercase (required
    # for validate_evm_address), only the hex body is uppercased, so this is
    # still a valid EVM address that must be caught as a self-send.
    mixed_case_same_address = "0x" + wallet.address[2:].upper()

    resp = client.post(
        "/v1/mobile/send",
        json={"to": mixed_case_same_address, "amount": "1"},
        headers=auth_headers(),
    )

    assert resp.status_code == 400
    assert "own wallet" in resp.json()["detail"]


def test_send_no_wallet_returns_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=None))

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "1"}, headers=auth_headers()
    )

    assert resp.status_code == 400


@pytest.mark.parametrize("bad_amount", ["-5", "0", "abc", "0.005", "1000001"])
def test_send_rejects_invalid_amount_bounds(client, monkeypatch, bad_amount):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": bad_amount}, headers=auth_headers()
    )

    assert resp.status_code == 400


def test_send_insufficient_balance_returns_400(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("5")))

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "10"}, headers=auth_headers()
    )

    assert resp.status_code == 400
    assert "Insufficient" in resp.json()["detail"]


def test_send_balance_read_failure_maps_to_503(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service,
        "get_usdc_balance",
        MagicMock(side_effect=SavingsError("Could not fetch your USDC balance.")),
    )

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "1"}, headers=auth_headers()
    )

    assert resp.status_code == 503


# ── POST /send: happy path / pending / idempotency / rate limit ────────


def test_send_happy_path(client, monkeypatch):
    wallet = _fake_wallet()
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=wallet))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    send_mock = MagicMock(return_value=("0xabc123", False))
    monkeypatch.setattr(mobile_mod, "_send_usdc_base", send_mock)

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "10.5"}, headers=auth_headers()
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "ok": True,
        "txHash": "0xabc123",
        "amount": "10.500000",
        "to": TO_ADDR,
    }
    args, _ = send_mock.call_args
    assert args[0] is wallet
    assert args[1] == TO_ADDR
    assert args[2] == Decimal("10.5")


def test_send_max_uses_live_balance(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("42.123456"))
    )
    send_mock = MagicMock(return_value=("0xmax", False))
    monkeypatch.setattr(mobile_mod, "_send_usdc_base", send_mock)

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "max"}, headers=auth_headers()
    )

    assert resp.status_code == 200
    assert resp.json()["amount"] == "42.123456"


def test_send_broadcast_ambiguous_returns_202_pending(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        mobile_mod, "_send_usdc_base", MagicMock(return_value=("0xpending123", True))
    )

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "10"}, headers=auth_headers()
    )

    assert resp.status_code == 202
    assert resp.json() == {"ok": False, "status": "pending", "txHash": "0xpending123"}


def test_send_unexpected_exception_maps_to_500_without_leaking(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    monkeypatch.setattr(
        mobile_mod,
        "_send_usdc_base",
        MagicMock(side_effect=RuntimeError("private key file not found: /secret/path")),
    )

    resp = client.post(
        "/v1/mobile/send", json={"to": TO_ADDR, "amount": "10"}, headers=auth_headers()
    )

    assert resp.status_code == 500
    assert "/secret/path" not in resp.json()["detail"]


def test_send_idempotency_key_replay_skips_second_dispatch(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("100")))
    send_mock = MagicMock(return_value=("0xonce", False))
    monkeypatch.setattr(mobile_mod, "_send_usdc_base", send_mock)

    headers = {**auth_headers(), "Idempotency-Key": "retry-1"}
    resp1 = client.post("/v1/mobile/send", json={"to": TO_ADDR, "amount": "5"}, headers=headers)
    resp2 = client.post("/v1/mobile/send", json={"to": TO_ADDR, "amount": "5"}, headers=headers)

    assert resp1.status_code == 200
    assert resp1.json() == resp2.json()
    assert send_mock.call_count == 1


def test_send_rate_limited_after_six_per_minute(client, monkeypatch):
    monkeypatch.setattr(mobile_mod, "_resolve_earn_wallet", AsyncMock(return_value=_fake_wallet()))
    monkeypatch.setattr(
        savings_service, "get_usdc_balance", MagicMock(return_value=Decimal("1000"))
    )
    monkeypatch.setattr(mobile_mod, "_send_usdc_base", MagicMock(return_value=("0xtx", False)))

    for i in range(6):
        resp = client.post(
            "/v1/mobile/send",
            json={"to": TO_ADDR, "amount": "1"},
            headers={**auth_headers(), "Idempotency-Key": f"burst-{i}"},
        )
        assert resp.status_code == 200, resp.json()

    resp = client.post(
        "/v1/mobile/send",
        json={"to": TO_ADDR, "amount": "1"},
        headers={**auth_headers(), "Idempotency-Key": "burst-7"},
    )
    assert resp.status_code == 429


# ── GET /borrow ──────────────────────────────────────────────────────


def _fake_position(collateral_btc=0.0, collateral_value_usdc=0.0, debt_usdc=0.0, hf=None):
    return {
        "collateral_btc": collateral_btc,
        "collateral_value_usdc": collateral_value_usdc,
        "debt_usdc": debt_usdc,
        "health_factor": hf if hf is not None else math.inf,
    }


def test_borrow_requires_auth(client):
    assert client.get("/v1/mobile/borrow").status_code == 401


def test_borrow_empty_position(client, monkeypatch):
    from bot.services.morpho_api import morpho_api

    monkeypatch.setattr(mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[]))
    monkeypatch.setattr(morpho_api, "get_market_apys", AsyncMock(return_value={"borrow_apy": 0.05}))

    resp = client.get("/v1/mobile/borrow", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "collateral": [],
        "borrowed": [],
        "healthFactor": None,
        "availableToBorrowUsd": 0.0,
        "coverage": "complete",
    }


def test_borrow_populated_position(client, monkeypatch):
    from bot.config.morpho_config import MAX_LTV
    from bot.services.morpho_api import morpho_api

    wallet = _fake_wallet()
    monkeypatch.setattr(mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[wallet]))
    monkeypatch.setattr(
        morpho_api, "get_market_apys", AsyncMock(return_value={"borrow_apy": 0.061})
    )
    position = _fake_position(
        collateral_btc=0.5, collateral_value_usdc=50000.0, debt_usdc=10000.0, hf=2.5
    )
    monkeypatch.setattr(morpho_api, "get_position", MagicMock(return_value=position))

    resp = client.get("/v1/mobile/borrow", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["collateral"] == [
        {"token": "cbBTC", "chain": "base", "balance": "0.5", "balanceUsd": 50000.0}
    ]
    assert body["borrowed"] == [
        {
            "token": "USDC",
            "chain": "base",
            "balance": "10000.0",
            "balanceUsd": 10000.0,
            "apr": 0.061,
        }
    ]
    assert body["healthFactor"] == 2.5
    assert body["availableToBorrowUsd"] == pytest.approx(50000.0 * MAX_LTV - 10000.0)
    assert body["coverage"] == "complete"


def test_borrow_apy_service_error_maps_to_503(client, monkeypatch):
    from bot.services.morpho_api import MorphoError, morpho_api

    monkeypatch.setattr(
        morpho_api,
        "get_market_apys",
        AsyncMock(side_effect=MorphoError("Could not fetch Morpho rates.")),
    )

    resp = client.get("/v1/mobile/borrow", headers=auth_headers())

    assert resp.status_code == 503


def test_borrow_marks_best_effort_on_position_read_failure(client, monkeypatch):
    from bot.services.morpho_api import MorphoError, morpho_api

    wallet = _fake_wallet()
    monkeypatch.setattr(mobile_mod, "_get_user_evm_wallets", AsyncMock(return_value=[wallet]))
    monkeypatch.setattr(morpho_api, "get_market_apys", AsyncMock(return_value={"borrow_apy": 0.05}))
    monkeypatch.setattr(
        morpho_api,
        "get_position",
        MagicMock(side_effect=MorphoError("Could not fetch your Morpho position.")),
    )

    resp = client.get("/v1/mobile/borrow", headers=auth_headers())

    assert resp.status_code == 200
    assert resp.json()["coverage"] == "best_effort"


# ── GET /statement ───────────────────────────────────────────────────


def test_statement_requires_auth(client):
    assert client.get("/v1/mobile/statement").status_code == 401


def test_statement_rejects_malformed_month(client):
    for bad in ["2026", "2026/08", "abcd-ef", "2026-13", "2026-00", ""]:
        resp = client.get(f"/v1/mobile/statement?month={bad}", headers=auth_headers())
        assert resp.status_code == 400, bad


def test_statement_defaults_to_current_month(client, tmp_db, monkeypatch):
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)
    resp = client.get("/v1/mobile/statement", headers=auth_headers())
    assert resp.status_code == 200
    assert resp.json()["period"] == datetime.now(timezone.utc).strftime("%Y-%m")


def test_statement_aggregates_across_sources(client, tmp_db, monkeypatch):
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)

    from bot.models.mobile_transfer import MobileTransfer
    from bot.models.savings import SavingsEvent
    from bot.models.swap import SwapStatus, SwapTransaction
    from database.db import get_session

    in_month = datetime(2026, 6, 15, tzinfo=timezone.utc)
    out_of_month = datetime(2026, 7, 1, tzinfo=timezone.utc)

    with get_session() as session:
        session.add(
            SavingsEvent(
                user_id=1,
                wallet_id=1,
                action="deposit",
                amount=Decimal("100.5"),
                tx_hash="0xdep",
                created_at=in_month,
            )
        )
        session.add(
            SavingsEvent(
                user_id=1,
                wallet_id=1,
                action="withdraw",
                amount=Decimal("20"),
                tx_hash="0xwd",
                created_at=in_month,
            )
        )
        # Different user — must not leak into user 1's statement.
        session.add(
            SavingsEvent(
                user_id=2,
                wallet_id=99,
                action="deposit",
                amount=Decimal("999"),
                tx_hash="0xother",
                created_at=in_month,
            )
        )
        # Outside the requested month — must be excluded.
        session.add(
            SavingsEvent(
                user_id=1,
                wallet_id=1,
                action="deposit",
                amount=Decimal("500"),
                tx_hash="0xnextmonth",
                created_at=out_of_month,
            )
        )
        session.add(
            MobileTransfer(
                user_id=1,
                wallet_id=1,
                to_address=TO_ADDR,
                amount=Decimal("15.25"),
                amount_usd=Decimal("15.25"),
                tx_hash="0xsend",
                status="sent",
                created_at=in_month,
            )
        )
        session.add(
            SwapTransaction(
                user_id=1,
                from_chain="base",
                from_token="USDC",
                from_amount="30",
                from_amount_usd=30.0,
                to_chain="base",
                to_token="ETH",
                status=SwapStatus.COMPLETED.value,
                tx_hash="0xswap",
                created_at=in_month,
            )
        )
        # Failed swap — must be excluded from volume/transactions.
        session.add(
            SwapTransaction(
                user_id=1,
                from_chain="base",
                from_token="USDC",
                from_amount="999",
                from_amount_usd=999.0,
                to_chain="base",
                to_token="ETH",
                status=SwapStatus.FAILED.value,
                tx_hash="0xfailedswap",
                created_at=in_month,
            )
        )

    resp = client.get("/v1/mobile/statement?month=2026-06", headers=auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["period"] == "2026-06"
    assert body["yieldEarnedUsd"] == 0.0
    assert body["depositedUsd"] == pytest.approx(100.5)
    assert body["withdrawnUsd"] == pytest.approx(20.0)
    assert body["sentUsd"] == pytest.approx(15.25)
    assert body["swapVolumeUsd"] == pytest.approx(30.0)

    tx_hashes = {t["txHash"] for t in body["transactions"]}
    assert tx_hashes == {"0xdep", "0xwd", "0xsend", "0xswap"}
    assert "0xother" not in tx_hashes
    assert "0xnextmonth" not in tx_hashes
    assert "0xfailedswap" not in tx_hashes

    send_tx = next(t for t in body["transactions"] if t["txHash"] == "0xsend")
    assert send_tx["type"] == "send"
    assert send_tx["counterparty"] == TO_ADDR

    swap_tx = next(t for t in body["transactions"] if t["txHash"] == "0xswap")
    assert swap_tx["type"] == "swap"
    assert swap_tx["counterparty"] == "USDC → ETH"

    # Sorted desc by date.
    dates = [t["date"] for t in body["transactions"]]
    assert dates == sorted(dates, reverse=True)


def test_statement_caps_at_200_rows(client, tmp_db, monkeypatch):
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)

    from bot.models.savings import SavingsEvent
    from database.db import get_session

    with get_session() as session:
        for i in range(210):
            session.add(
                SavingsEvent(
                    user_id=1,
                    wallet_id=1,
                    action="deposit",
                    amount=Decimal("1"),
                    tx_hash=f"0xtx{i}",
                    created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
                )
            )

    resp = client.get("/v1/mobile/statement?month=2026-06", headers=auth_headers())

    assert resp.status_code == 200
    assert len(resp.json()["transactions"]) == 200
