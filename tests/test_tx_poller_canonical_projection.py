from contextlib import contextmanager
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import bot.services.tx_poller as tx_poller_module
from bot.models.execution import (
    ExecutionCandidatePlan,
    ExecutionChildPlacement,
    ExecutionEvent,
    ExecutionFill,
    ExecutionIntent,
    ExecutionOutbox,
    ExecutionParentOrder,
    ExecutionSettlement,
)
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.user import User
from bot.services.execution_lifecycle import ParentState
from bot.services.tx_poller import TransactionPoller
from database.db import Base

TABLES = [
    User.__table__,
    SwapTransaction.__table__,
    ExecutionIntent.__table__,
    ExecutionCandidatePlan.__table__,
    ExecutionParentOrder.__table__,
    ExecutionChildPlacement.__table__,
    ExecutionFill.__table__,
    ExecutionSettlement.__table__,
    ExecutionEvent.__table__,
    ExecutionOutbox.__table__,
]


def _database():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=TABLES)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _install_session_factory(monkeypatch, SessionLocal):
    @contextmanager
    def _get_session():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(tx_poller_module, "get_db_session", _get_session)


def _seed_swap(SessionLocal, *, swap_id=1):
    with SessionLocal() as session:
        session.add(User(id=7))
        session.add(
            SwapTransaction(
                id=swap_id,
                user_id=7,
                from_chain="ethereum",
                from_token="USDC",
                from_amount="100",
                from_amount_usd=100.0,
                to_chain="base",
                to_token="ETH",
                to_amount="0.05",
                to_amount_usd=101.0,
                status=SwapStatus.SUBMITTED.value,
                tx_hash="0xabc",
                idempotency_key=f"quote-{swap_id}",
                route_provider="lifi",
                slippage=50,
                created_at=datetime(2026, 8, 22, 12, 0, 0),
                updated_at=datetime(2026, 8, 22, 12, 0, 5),
            )
        )
        session.commit()


def _tx_dict(swap_id=1):
    return {
        "id": swap_id,
        "tx_hash": "0xabc",
        "from_chain": "ethereum",
        "to_chain": "base",
        "route_provider": "lifi",
        "status": SwapStatus.SUBMITTED.value,
        "user_id": 7,
        "from_token": "USDC",
        "to_token": "ETH",
        "from_amount": "100",
        "error_message": None,
        "created_at": datetime(2026, 8, 22, 12, 0, 0),
    }


@pytest.mark.asyncio
async def test_poller_commits_realized_receive_and_canonical_fill_together(monkeypatch):
    SessionLocal = _database()
    _seed_swap(SessionLocal)
    _install_session_factory(monkeypatch, SessionLocal)

    poller = TransactionPoller()
    poller._invalidate_balance_cache_dict = AsyncMock()
    poller._notify_user_dict = AsyncMock()

    tx_dict = _tx_dict()
    tx_dict["_realized_to_amount"] = "0.047"
    tx_dict["_realized_to_amount_usd"] = 99.5

    await poller._apply_status_update(
        tx_dict,
        SwapStatus.COMPLETED.value,
        dest_tx_hash="0xdestination",
    )

    with SessionLocal() as session:
        swap = session.get(SwapTransaction, 1)
        parent = session.query(ExecutionParentOrder).one()
        fill = session.query(ExecutionFill).one()

        assert swap.status == SwapStatus.COMPLETED.value
        assert swap.realized_to_amount == "0.047"
        assert swap.realized_to_amount_usd == 99.5
        assert swap.destination_tx_hash == "0xdestination"
        assert parent.state == ParentState.FILLED.value
        assert fill.input_amount == "100"
        assert fill.output_amount == "0.047"
        assert session.query(ExecutionOutbox).count() == session.query(ExecutionEvent).count()


@pytest.mark.asyncio
async def test_projection_failure_rolls_back_legacy_terminal_transition(monkeypatch):
    SessionLocal = _database()
    _seed_swap(SessionLocal, swap_id=2)
    _install_session_factory(monkeypatch, SessionLocal)

    def _fail_projection(session, swap):
        raise RuntimeError("canonical write failed")

    monkeypatch.setattr(tx_poller_module, "project_legacy_swap", _fail_projection)

    poller = TransactionPoller()
    poller._invalidate_balance_cache_dict = AsyncMock()
    poller._notify_user_dict = AsyncMock()

    tx_dict = _tx_dict(swap_id=2)
    tx_dict["_realized_to_amount"] = "0.047"

    await poller._apply_status_update(tx_dict, SwapStatus.COMPLETED.value)

    with SessionLocal() as session:
        swap = session.get(SwapTransaction, 2)
        assert swap.status == SwapStatus.SUBMITTED.value
        assert swap.realized_to_amount is None
        assert session.query(ExecutionParentOrder).count() == 0
        assert session.query(ExecutionFill).count() == 0
        assert session.query(ExecutionEvent).count() == 0


@pytest.mark.asyncio
async def test_existing_terminal_row_repairs_missing_canonical_projection(monkeypatch):
    SessionLocal = _database()
    _seed_swap(SessionLocal, swap_id=3)
    _install_session_factory(monkeypatch, SessionLocal)

    with SessionLocal() as session:
        swap = session.get(SwapTransaction, 3)
        swap.status = SwapStatus.COMPLETED.value
        swap.realized_to_amount = "0.046"
        swap.completed_at = datetime(2026, 8, 22, 12, 1, 0)
        session.commit()

    poller = TransactionPoller()
    poller._invalidate_balance_cache_dict = AsyncMock()
    poller._notify_user_dict = AsyncMock()

    await poller._apply_status_update(_tx_dict(swap_id=3), SwapStatus.COMPLETED.value)

    with SessionLocal() as session:
        parent = session.query(ExecutionParentOrder).one()
        assert parent.state == ParentState.FILLED.value
        assert session.query(ExecutionFill).count() == 1

    poller._invalidate_balance_cache_dict.assert_not_awaited()
    poller._notify_user_dict.assert_not_awaited()
