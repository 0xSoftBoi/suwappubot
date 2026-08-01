import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.webapp import router
from database.db import get_session, init_db
from bot.models.advanced import LimitOrder, OrderStatus
from bot.models.user import User, Wallet

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client(monkeypatch):
    # api.main bakes JWT_SECRET at import time, so the SECRET_KEY env set at the
    # top of this file only wins if nothing imported api.main first. Under the
    # full suite something already has, leaving an ephemeral random secret that
    # rejects our tokens — so pin it here, as test_webapp_referrals.py does.
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def seed_user_wallet():
    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="terminal-user"),
                Wallet(
                    id=1,
                    user_id=1,
                    address="0xlimitwallet",
                    chain_type="evm",
                    wallet_provider="turnkey",
                    turnkey_wallet_id="wallet-id",
                    turnkey_account_id="account-id",
                    is_active=True,
                    is_default=True,
                ),
            ]
        )


def test_webapp_limit_order_create_list_cancel(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'webapp-limit-orders.db'}")
    seed_user_wallet()

    async def fake_get_price(token: str):
        return {"ETH": 3500.0, "USDC": 1.0}.get(token.upper())

    monkeypatch.setattr("bot.services.price_service.price_service.get_price", fake_get_price)

    client = app_client(monkeypatch)
    create = client.post(
        "/webapp/limit-orders",
        headers=auth_headers(),
        json={
            "orderType": "limit_sell",
            "fromToken": "ETH",
            "toToken": "USDC",
            "fromChain": "ethereum",
            "toChain": "ethereum",
            "amount": 0.1,
            "triggerPrice": 4000,
            "slippage": 0.5,
            "expiresInHours": 24,
        },
    )

    assert create.status_code == 200
    body = create.json()
    assert body["orderType"] == "limit_sell"
    assert body["amountRaw"] == "100000000000000000"
    assert body["status"] == OrderStatus.PENDING.value

    listed = client.get("/webapp/limit-orders", headers=auth_headers())
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == body["id"]

    cancelled = client.post(f"/webapp/limit-orders/{body['id']}/cancel", headers=auth_headers())
    assert cancelled.status_code == 200
    with get_session() as session:
        order = session.query(LimitOrder).filter(LimitOrder.id == int(body["id"])).first()
        assert order.status == OrderStatus.CANCELLED.value


def test_webapp_limit_order_rejects_sell_below_market(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'webapp-limit-order-invalid.db'}")
    seed_user_wallet()

    async def fake_get_price(token: str):
        return {"ETH": 3500.0, "USDC": 1.0}.get(token.upper())

    monkeypatch.setattr("bot.services.price_service.price_service.get_price", fake_get_price)

    client = app_client(monkeypatch)
    response = client.post(
        "/webapp/limit-orders",
        headers=auth_headers(),
        json={
            "orderType": "limit_sell",
            "fromToken": "ETH",
            "toToken": "USDC",
            "amount": 0.1,
            "triggerPrice": 3000,
        },
    )

    assert response.status_code == 400
    assert "above the current market price" in response.json()["detail"]
