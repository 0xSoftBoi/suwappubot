from datetime import datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

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
from bot.services.execution_lifecycle import ParentState
from bot.services.legacy_swap_execution_adapter import project_legacy_swap
from database.db import Base

TABLES = [
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


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=TABLES)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _session():
    return _session_factory()()


def _swap(*, swap_id: int, status: str, tx_hash=None, realized=None):
    return SwapTransaction(
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
        realized_to_amount=realized,
        status=status,
        tx_hash=tx_hash,
        idempotency_key=f"quote-{swap_id}",
        route_provider="lifi",
        gas_fee=1.25,
        bridge_fee=0.40,
        slippage=50,
        created_at=datetime(2026, 8, 22, 12, 0, 0),
        updated_at=datetime(2026, 8, 22, 12, 0, 5),
        completed_at=(
            datetime(2026, 8, 22, 12, 0, 20)
            if status == SwapStatus.COMPLETED.value
            else None
        ),
    )


def test_completed_with_realized_output_becomes_fill_without_using_quote_amount():
    session = _session()
    swap = _swap(
        swap_id=1,
        status=SwapStatus.COMPLETED.value,
        tx_hash="0xabc",
        realized="0.047",
    )
    session.add(swap)
    session.flush()

    parent = project_legacy_swap(session, swap)
    session.commit()

    assert parent.state == ParentState.FILLED.value
    assert Decimal(parent.filled_quantity) == Decimal("100")

    fill = session.query(ExecutionFill).one()
    assert fill.input_asset == "USDC"
    assert fill.input_amount == "100"
    assert fill.output_asset == "ETH"
    assert fill.output_amount == "0.047"
    assert fill.output_amount != swap.to_amount
    assert fill.price_asset == "ETH"
    assert Decimal(fill.price) == Decimal("0.00047")
    assert fill.fee_amount is None
    assert fill.metadata_json["legacy_gas_fee_usd_estimate"] == 1.25
    assert fill.metadata_json["legacy_bridge_fee_usd_estimate"] == 0.4

    # Retry projection is exactly-once for parent, events, fill and outbox.
    event_count = session.query(ExecutionEvent).count()
    outbox_count = session.query(ExecutionOutbox).count()
    same_parent = project_legacy_swap(session, swap)
    session.commit()

    assert same_parent.id == parent.id
    assert session.query(ExecutionFill).count() == 1
    assert session.query(ExecutionEvent).count() == event_count
    assert session.query(ExecutionOutbox).count() == outbox_count


def test_completed_without_realized_output_goes_active_then_reconciling():
    session = _session()
    swap = _swap(
        swap_id=2,
        status=SwapStatus.COMPLETED.value,
        tx_hash="0xdef",
        realized=None,
    )
    session.add(swap)
    session.flush()

    parent = project_legacy_swap(session, swap)
    session.commit()

    assert parent.state == ParentState.RECONCILING.value
    assert session.query(ExecutionFill).count() == 0

    transitions = [
        row.to_state
        for row in session.query(ExecutionEvent).order_by(ExecutionEvent.sequence).all()
        if row.event_type == "parent_state_changed"
    ]
    assert transitions[-2:] == [ParentState.ACTIVE.value, ParentState.RECONCILING.value]


def test_failed_after_broadcast_is_ambiguous_and_child_is_submitted():
    session = _session()
    swap = _swap(
        swap_id=3,
        status=SwapStatus.FAILED.value,
        tx_hash="0xfeed",
        realized=None,
    )
    session.add(swap)
    session.flush()

    parent = project_legacy_swap(session, swap)
    session.commit()

    assert parent.state == ParentState.RECONCILING.value
    child = session.query(ExecutionChildPlacement).one()
    assert child.state == "submitted"
    assert child.external_tx_hash == "0xfeed"
    assert child.submitted_at is not None
    assert session.query(ExecutionFill).count() == 0


def test_definitive_prebroadcast_failure_can_be_terminal_failed():
    session = _session()
    swap = _swap(
        swap_id=4,
        status=SwapStatus.FAILED.value,
        tx_hash=None,
        realized=None,
    )
    session.add(swap)
    session.flush()

    parent = project_legacy_swap(session, swap)
    session.commit()

    assert parent.state == ParentState.FAILED.value
    assert session.query(ExecutionFill).count() == 0


def test_submitted_then_completed_after_restart_reuses_parent_and_records_realized_fill():
    SessionLocal = _session_factory()
    first_session = SessionLocal()
    swap = _swap(
        swap_id=5,
        status=SwapStatus.SUBMITTED.value,
        tx_hash="0xbeef",
        realized=None,
    )
    first_session.add(swap)
    first_session.flush()

    parent = project_legacy_swap(first_session, swap)
    first_parent_id = parent.id
    assert parent.state == ParentState.ACTIVE.value
    first_session.commit()
    first_session.close()

    # Simulate a worker/API restart: a fresh ORM session sees the legacy row
    # after the poller observed authoritative completion and realized receive.
    second_session = SessionLocal()
    swap = second_session.get(SwapTransaction, 5)
    swap.status = SwapStatus.COMPLETED.value
    swap.realized_to_amount = "0.048"
    swap.completed_at = datetime(2026, 8, 22, 12, 0, 30)
    second_session.flush()

    parent = project_legacy_swap(second_session, swap)
    second_session.commit()

    assert parent.id == first_parent_id
    assert parent.state == ParentState.FILLED.value
    assert second_session.query(ExecutionParentOrder).count() == 1
    assert second_session.query(ExecutionFill).count() == 1
    fill = second_session.query(ExecutionFill).one()
    assert fill.output_amount == "0.048"


def test_child_tx_identity_cannot_silently_change_after_projection():
    session = _session()
    swap = _swap(
        swap_id=6,
        status=SwapStatus.SUBMITTED.value,
        tx_hash="0xfirst",
        realized=None,
    )
    session.add(swap)
    session.flush()
    project_legacy_swap(session, swap)
    session.commit()

    swap.tx_hash = "0xsecond"

    try:
        project_legacy_swap(session, swap)
    except Exception as exc:
        assert "external tx identity changed" in str(exc)
    else:
        raise AssertionError("changed money-moving identity must fail closed")
