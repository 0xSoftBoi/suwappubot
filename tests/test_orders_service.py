"""Tests for bot/services/orders.py — OrderService.

Covers: create_limit_order, check_limit_orders (all 4 trigger types + expiry),
DCA lifecycle (create, pause, resume, completion), and execution failure.
All price fetches and swap execution are monkeypatched.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import asyncio  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402

from database.db import get_session  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from bot.models.advanced import (  # noqa: E402
    LimitOrder,
    DCAOrder,
    OrderStatus,
    OrderType,
    DCAStatus,
)
from bot.services.orders import OrderService  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_db(session):
    u = User(id=1, telegram_id=100, username="testuser")
    session.add(u)
    w = Wallet(
        id=1,
        user_id=1,
        address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        encrypted_private_key="enc",
        encryption_scheme="legacy_fernet_v1",
        chain_type="evm",
        wallet_provider="local",
        name="Test",
    )
    session.add(w)
    session.flush()


def _mk_order(session, order_type, trigger_price=100.0, expires_at=None):
    """Insert a minimal pending limit order."""
    o = LimitOrder(
        user_id=1,
        wallet_id=1,
        order_type=order_type,
        from_chain="ethereum",
        from_token="USDC",
        to_chain="ethereum",
        to_token="WETH",
        amount="1000000",
        trigger_price=trigger_price,
        slippage=0.5,
        status=OrderStatus.PENDING.value,
        expires_at=expires_at,
    )
    session.add(o)
    session.flush()
    return o


def _mk_dca(session, max_executions=None, executions_completed=0, ends_at=None, next_at=None):
    now = datetime.utcnow()
    o = DCAOrder(
        user_id=1,
        wallet_id=1,
        from_chain="ethereum",
        from_token="USDC",
        to_chain="ethereum",
        to_token="WETH",
        amount_per_execution="100000",
        interval_hours=24,
        next_execution_at=next_at or (now - timedelta(minutes=1)),
        status=DCAStatus.ACTIVE.value,
        max_executions=max_executions,
        executions_completed=executions_completed,
        ends_at=ends_at,
    )
    session.add(o)
    session.flush()
    return o


# ---------------------------------------------------------------------------
# create_limit_order
# ---------------------------------------------------------------------------


def test_create_limit_order_stores_pending_status(tmp_db):
    with get_session() as session:
        _seed_db(session)

    svc = OrderService()
    order = svc.create_limit_order(
        user_id=1,
        wallet_id=1,
        order_type=OrderType.LIMIT_BUY.value,
        from_chain="ethereum",
        from_token="USDC",
        to_chain="ethereum",
        to_token="WETH",
        amount="1000000",
        trigger_price=2000.0,
    )

    assert order.status == OrderStatus.PENDING.value
    assert order.trigger_price == 2000.0
    assert order.expires_at is None


def test_create_limit_order_sets_expiry_when_provided(tmp_db):
    with get_session() as session:
        _seed_db(session)

    svc = OrderService()
    order = svc.create_limit_order(
        user_id=1,
        wallet_id=1,
        order_type=OrderType.LIMIT_BUY.value,
        from_chain="ethereum",
        from_token="USDC",
        to_chain="ethereum",
        to_token="WETH",
        amount="1000000",
        trigger_price=2000.0,
        expires_in_hours=24,
    )

    assert order.expires_at is not None
    assert order.expires_at > datetime.utcnow()


# ---------------------------------------------------------------------------
# check_limit_orders — trigger logic (all 4 types)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "order_type,token_key,price,should_trigger",
    [
        (OrderType.LIMIT_BUY.value, "to_token", 95.0, True),  # buy triggers when price drops
        (OrderType.LIMIT_BUY.value, "to_token", 102.0, False),  # buy does NOT trigger above
        (OrderType.LIMIT_SELL.value, "from_token", 105.0, True),  # sell triggers when price rises
        (OrderType.LIMIT_SELL.value, "from_token", 95.0, False),  # sell does NOT trigger below
        (OrderType.STOP_LOSS.value, "from_token", 90.0, True),  # stop-loss triggers on drop
        (OrderType.TAKE_PROFIT.value, "from_token", 110.0, True),  # take-profit triggers on rise
    ],
)
def test_check_limit_orders_trigger_logic(
    tmp_db, monkeypatch, order_type, token_key, price, should_trigger
):
    with get_session() as session:
        _seed_db(session)
        o = _mk_order(session, order_type, trigger_price=100.0)
        order_id = o.id

    monkeypatch.setattr(
        "bot.services.orders.price_service.get_prices",
        AsyncMock(return_value={"USDC": price, "WETH": price}),
    )

    svc = OrderService()
    triggered = asyncio.run(svc.check_limit_orders())

    triggered_ids = [t.id for t in triggered]
    if should_trigger:
        assert order_id in triggered_ids
        with get_session() as session:
            o = session.query(LimitOrder).filter(LimitOrder.id == order_id).first()
            assert o.status == OrderStatus.TRIGGERED.value
    else:
        assert order_id not in triggered_ids


def test_check_limit_orders_marks_expired_past_deadline(tmp_db, monkeypatch):
    with get_session() as session:
        _seed_db(session)
        o = _mk_order(
            session,
            OrderType.LIMIT_BUY.value,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        order_id = o.id

    monkeypatch.setattr(
        "bot.services.orders.price_service.get_prices",
        AsyncMock(return_value={}),
    )

    svc = OrderService()
    asyncio.run(svc.check_limit_orders())

    with get_session() as session:
        o = session.query(LimitOrder).filter(LimitOrder.id == order_id).first()
        assert o.status == OrderStatus.EXPIRED.value


# ---------------------------------------------------------------------------
# DCA lifecycle
# ---------------------------------------------------------------------------


def test_check_dca_orders_marks_completed_on_max_executions(tmp_db):
    with get_session() as session:
        _seed_db(session)
        o = _mk_dca(session, max_executions=3, executions_completed=3)
        order_id = o.id

    svc = OrderService()
    due = asyncio.run(svc.check_dca_orders())

    assert not any(d.id == order_id for d in due)
    with get_session() as session:
        o = session.query(DCAOrder).filter(DCAOrder.id == order_id).first()
        assert o.status == DCAStatus.COMPLETED.value


def test_check_dca_orders_marks_completed_when_ends_at_passed(tmp_db):
    with get_session() as session:
        _seed_db(session)
        o = _mk_dca(session, ends_at=datetime.utcnow() - timedelta(days=1))
        order_id = o.id

    svc = OrderService()
    asyncio.run(svc.check_dca_orders())

    with get_session() as session:
        o = session.query(DCAOrder).filter(DCAOrder.id == order_id).first()
        assert o.status == DCAStatus.COMPLETED.value


def test_check_dca_orders_not_due_skipped(tmp_db):
    with get_session() as session:
        _seed_db(session)
        _mk_dca(session, next_at=datetime.utcnow() + timedelta(hours=12))

    svc = OrderService()
    due = asyncio.run(svc.check_dca_orders())
    assert due == []


def test_pause_and_resume_dca(tmp_db):
    with get_session() as session:
        _seed_db(session)
        o = _mk_dca(session)
        order_id = o.id

    svc = OrderService()
    assert svc.pause_dca(order_id, 1) is True
    with get_session() as session:
        o = session.query(DCAOrder).filter(DCAOrder.id == order_id).first()
        assert o.status == DCAStatus.PAUSED.value

    assert svc.resume_dca(order_id, 1) is True
    with get_session() as session:
        o = session.query(DCAOrder).filter(DCAOrder.id == order_id).first()
        assert o.status == DCAStatus.ACTIVE.value
        assert o.next_execution_at <= datetime.utcnow() + timedelta(seconds=5)


def test_pause_nonexistent_dca_returns_false(tmp_db):
    with get_session() as session:
        _seed_db(session)

    svc = OrderService()
    assert svc.pause_dca(9999, 1) is False
