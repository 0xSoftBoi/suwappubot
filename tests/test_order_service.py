import asyncio
import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from database.db import get_session, init_db  # noqa: E402
from bot.models.advanced import LimitOrder, OrderStatus, OrderType  # noqa: E402
from bot.models.swap import SwapStatus, SwapTransaction  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from bot.services.orders import OrderService  # noqa: E402


@pytest.fixture()
def sqlite_db(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'order-service.db'}"
    assert init_db(database_url)
    yield


class FakeSwapEngine:
    def __init__(self, captured):
        self.captured = captured

    async def get_quote(self, **kwargs):
        self.captured["quote_kwargs"] = kwargs
        return type("Quote", (), kwargs)()

    async def execute_swap(self, *, quote, wallet_id, user_id, idempotency_key, automated=False):
        self.captured["execute_kwargs"] = {
            "quote": quote,
            "wallet_id": wallet_id,
            "user_id": user_id,
            "idempotency_key": idempotency_key,
            "automated": automated,
        }
        with get_session() as session:
            swap = SwapTransaction(
                user_id=user_id,
                from_chain=quote.from_chain,
                from_token=quote.from_token,
                from_amount=str(quote.amount),
                from_amount_usd=quote.amount,
                to_chain=quote.to_chain,
                to_token=quote.to_token,
                to_amount="0",
                status=SwapStatus.SUBMITTED.value,
                tx_hash="0xlimit",
                idempotency_key=idempotency_key,
            )
            session.add(swap)
            session.flush()
            return swap


class FakeBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, **kwargs):
        self.messages.append(kwargs)


def test_limit_order_executes_through_swap_engine(sqlite_db):
    captured = {}
    service = OrderService()
    service._swap_engine = FakeSwapEngine(captured)

    with get_session() as session:
        user = User(id=1, username="limit-user")
        wallet = Wallet(
            id=1,
            user_id=1,
            address="0xlimitwallet",
            chain_type="evm",
            encrypted_private_key="encrypted",
            is_active=True,
            is_default=True,
        )
        order = LimitOrder(
            id=1,
            user_id=1,
            wallet_id=1,
            order_type=OrderType.LIMIT_SELL.value,
            status=OrderStatus.TRIGGERED.value,
            from_chain="ethereum",
            from_token="ETH",
            to_chain="ethereum",
            to_token="USDC",
            amount=str(2 * 10**18),
            trigger_price=4000,
            slippage=0.5,
        )
        session.add_all([user, wallet, order])

    with get_session() as session:
        order = session.query(LimitOrder).filter(LimitOrder.id == 1).first()

    asyncio.run(service._execute_limit_order(order))

    assert captured["quote_kwargs"]["amount"] == 2
    assert captured["quote_kwargs"]["from_address"] == "0xlimitwallet"
    assert captured["quote_kwargs"]["slippage"] == 0.5
    assert captured["execute_kwargs"]["wallet_id"] == 1
    assert captured["execute_kwargs"]["user_id"] == 1
    assert captured["execute_kwargs"]["idempotency_key"].startswith("lo:1:")
    assert captured["execute_kwargs"]["automated"] is True

    with get_session() as session:
        db_order = session.query(LimitOrder).filter(LimitOrder.id == 1).first()
        assert db_order.status == OrderStatus.EXECUTED.value
        assert db_order.tx_hash == "0xlimit"
        assert db_order.executed_at is not None


def test_limit_order_notification_uses_single_markdown_link(sqlite_db):
    service = OrderService()
    service._bot = FakeBot()
    tx_hash = "0x" + "a" * 64

    with get_session() as session:
        user = User(id=1, telegram_id=123, username="limit-user")
        order = LimitOrder(
            id=1,
            user_id=1,
            wallet_id=1,
            order_type=OrderType.LIMIT_SELL.value,
            status=OrderStatus.EXECUTED.value,
            from_chain="base",
            from_token="ETH",
            to_chain="base",
            to_token="USDC",
            amount=str(2 * 10**18),
            trigger_price=4000,
        )
        session.add_all([user, order])

    with get_session() as session:
        order = session.query(LimitOrder).filter(LimitOrder.id == 1).first()

    swap_tx = type("SwapTx", (), {"tx_hash": tx_hash})()
    asyncio.run(service._notify_order_executed(order, swap_tx))

    assert len(service._bot.messages) == 1
    message = service._bot.messages[0]
    assert message["chat_id"] == 123
    assert "[View Transaction]([" not in message["text"]
    assert f"]({tx_hash}" not in message["text"]
    assert "](https://" in message["text"]


def test_limit_order_expiration_handles_naive_utc_datetimes(sqlite_db):
    service = OrderService()

    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="limit-user"),
                Wallet(
                    id=1,
                    user_id=1,
                    address="0xlimitwallet",
                    chain_type="evm",
                    encrypted_private_key="encrypted",
                    is_active=True,
                    is_default=True,
                ),
                LimitOrder(
                    id=1,
                    user_id=1,
                    wallet_id=1,
                    order_type=OrderType.LIMIT_BUY.value,
                    status=OrderStatus.PENDING.value,
                    from_chain="ethereum",
                    from_token="USDC",
                    to_chain="ethereum",
                    to_token="ETH",
                    amount="1000000000",
                    trigger_price=3000,
                    expires_at=datetime.utcnow() - timedelta(minutes=1),
                ),
            ]
        )

    triggered = asyncio.run(service.check_limit_orders())

    assert triggered == []
    with get_session() as session:
        db_order = session.query(LimitOrder).filter(LimitOrder.id == 1).first()
        assert db_order.status == OrderStatus.EXPIRED.value
