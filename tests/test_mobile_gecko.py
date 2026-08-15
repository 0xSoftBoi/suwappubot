"""Read-only analytics contracts for Gecko's first mobile slice."""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routes.mobile as mobile_routes
from api.routes.mobile import _answer_from_snapshot, _snapshot_payload, _unique_wallets


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(mobile_routes.router)
    return TestClient(app)


def test_snapshot_requires_end_user_auth():
    response = _client().get("/v1/mobile/snapshot")

    assert response.status_code == 401


def test_snapshot_scopes_reads_to_jwt_user(monkeypatch):
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", "gecko-test-secret")
    monkeypatch.setattr(mobile_routes, "_require_db", lambda: None)
    build = AsyncMock(
        side_effect=lambda user_id: {
            "owner": user_id,
            "totalValueUsd": 0,
            "byToken": [],
            "byChain": [],
            "history": [],
            "coverage": "best_effort",
            "lastUpdated": "2026-08-08T00:00:00",
        }
    )
    monkeypatch.setattr(mobile_routes, "_build_snapshot", build)
    token = jwt.encode({"user_id": 41}, "gecko-test-secret", algorithm="HS256")

    response = _client().get(
        "/v1/mobile/snapshot",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["owner"] == 41
    build.assert_awaited_once_with(41)


def test_snapshot_prices_real_balances_and_computes_allocation():
    snapshot = _snapshot_payload(
        {
            "base": {"ETH": Decimal("2"), "USDC": Decimal("1000")},
            "solana": {"USDC": Decimal("500")},
        },
        {"ETH": 3000.0, "USDC": 1.0},
        [{"date": "2026-08-01", "value_usd": 7000}],
    )

    assert snapshot["totalValueUsd"] == 7500.0
    assert snapshot["byToken"][0] == {
        "symbol": "ETH",
        "valueUsd": 6000.0,
        "allocationPct": 80.0,
    }
    assert snapshot["history"] == [{"date": "2026-08-01", "valueUsd": 7000.0}]
    assert snapshot["coverage"] == "best_effort"


def test_snapshot_does_not_invent_value_when_price_is_missing():
    snapshot = _snapshot_payload(
        {"base": {"MYSTERY": Decimal("123")}},
        {"MYSTERY": None},
        [],
    )

    assert snapshot["totalValueUsd"] == 0.0
    assert snapshot["byToken"] == []


def test_ask_money_movement_stops_at_preview_boundary():
    response = _answer_from_snapshot(
        "Buy $50 of ETH",
        {"totalValueUsd": 1000, "byToken": [], "history": []},
        [],
    )

    assert response["type"] == "action_preview"
    assert response["data"] == {"requiresConfirmation": True}
    assert "will not move funds" in response["answer"]


def test_ask_change_refuses_to_fabricate_history():
    response = _answer_from_snapshot(
        "What changed this week?",
        {"totalValueUsd": 1000, "byToken": [], "coverage": "complete", "history": []},
        [],
    )

    assert response["type"] == "change"
    assert response["data"] is None
    assert "don't have a saved snapshot" in response["answer"]


def test_ask_change_does_not_call_month_old_data_a_weekly_change():
    response = _answer_from_snapshot(
        "What changed this week?",
        {
            "totalValueUsd": 1200,
            "byToken": [],
            "coverage": "complete",
            "history": [{"date": "2020-01-01", "valueUsd": 1000}],
        },
        [],
    )

    assert response["type"] == "change"
    assert response["data"] is None


def test_ask_change_withholds_delta_when_source_coverage_is_not_provable():
    response = _answer_from_snapshot(
        "Am I up this week?",
        {
            "totalValueUsd": 1200,
            "byToken": [],
            "coverage": "best_effort",
            "history": [{"date": "2099-01-01", "valueUsd": 1000}],
        },
        [],
    )

    assert response["type"] == "change"
    assert response["data"] is None
    assert "rather withhold" in response["answer"]


def test_duplicate_wallet_rows_are_not_counted_twice():
    wallets = [
        SimpleNamespace(id=1, address="0xAbC", chain_type="evm"),
        SimpleNamespace(id=2, address="0xabc", chain_type="evm"),
        SimpleNamespace(id=3, address="CaseSensitive", chain_type="solana"),
        SimpleNamespace(id=4, address="casesensitive", chain_type="solana"),
    ]

    unique = _unique_wallets(wallets)

    assert [wallet.id for wallet in unique] == [1, 3, 4]


def test_ask_concentration_uses_snapshot_math():
    response = _answer_from_snapshot(
        "How concentrated am I?",
        {
            "totalValueUsd": 1000,
            "byToken": [{"symbol": "USDC", "valueUsd": 750, "allocationPct": 75.0}],
            "history": [],
        },
        [],
    )

    assert response["type"] == "concentration"
    assert "USDC at 75.0%" in response["answer"]
