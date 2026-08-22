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
from bot.services.execution_lifecycle import LifecycleEvent, ParentState, replay
from bot.services.execution_store import ExecutionStore
from database.db import Base


EXECUTION_TABLES = [
    ExecutionIntent.__table__,
    ExecutionCandidatePlan.__table__,
    ExecutionParentOrder.__table__,
    ExecutionChildPlacement.__table__,
    ExecutionFill.__table__,
    ExecutionSettlement.__table__,
    ExecutionEvent.__table__,
    ExecutionOutbox.__table__,
]


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=EXECUTION_TABLES)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def _change(store, session, parent, source, target, event_id):
    return store.append_event(
        session,
        parent_order_id=parent.id,
        event_id=event_id,
        event_type="parent_state_changed",
        from_state=source,
        to_state=target,
    )


def test_store_materializes_parent_and_outbox_from_same_event_stream():
    session = _session()
    store = ExecutionStore()

    parent = store.ensure_legacy_parent(
        session,
        source_type="swap",
        source_ref="123",
        principal_key="user:7",
        user_id=None,
        intent_type="swap",
        substrate="direct_tx",
        provider="lifi",
        amount_mode="exact_in",
        from_chain="ethereum",
        to_chain="base",
        from_asset="USDC",
        to_asset="ETH",
        requested_quantity="10",
        quantity_asset="ETH",
        idempotency_key="req-1",
    )

    # Restart/replay-safe creation: the legacy identity maps to one parent.
    same_parent = store.ensure_legacy_parent(
        session,
        source_type="swap",
        source_ref="123",
        principal_key="user:7",
        intent_type="swap",
        substrate="direct_tx",
    )
    assert same_parent.id == parent.id

    _change(store, session, parent, ParentState.DRAFT, ParentState.QUOTING, "e1")
    _change(store, session, parent, ParentState.QUOTING, ParentState.READY, "e2")
    _change(store, session, parent, ParentState.READY, ParentState.ACTIVE, "e3")

    first = store.record_fill(
        session,
        parent_order_id=parent.id,
        external_source="lifi",
        external_fill_id="0xabc:0",
        quantity="4",
        quantity_asset="ETH",
        price="100",
        price_asset="USDC",
        input_asset="USDC",
        input_amount="400",
        output_asset="ETH",
        output_amount="4",
        occurred_at=parent.created_at,
    )
    assert parent.state == ParentState.PARTIAL.value
    assert parent.filled_quantity == "4"

    duplicate = store.record_fill(
        session,
        parent_order_id=parent.id,
        external_source="lifi",
        external_fill_id="0xabc:0",
        quantity="4",
        price="100",
        occurred_at=parent.created_at,
    )
    assert duplicate.id == first.id
    assert parent.filled_quantity == "4"

    store.record_fill(
        session,
        parent_order_id=parent.id,
        external_source="lifi",
        external_fill_id="0xdef:0",
        quantity="6",
        quantity_asset="ETH",
        price="110",
        price_asset="USDC",
        input_asset="USDC",
        input_amount="660",
        output_asset="ETH",
        output_amount="6",
        occurred_at=parent.created_at,
    )

    session.commit()

    assert parent.state == ParentState.FILLED.value
    assert Decimal(parent.filled_quantity) == Decimal("10")
    assert Decimal(parent.average_fill_price) == Decimal("106")

    events = session.query(ExecutionEvent).order_by(ExecutionEvent.sequence).all()
    outbox = session.query(ExecutionOutbox).all()
    fills = session.query(ExecutionFill).all()

    assert len(events) == 5
    assert len(outbox) == len(events)
    assert len(fills) == 2
    assert {row.event_id for row in outbox} == {row.id for row in events}

    replayed = replay(
        parent.id,
        [
            LifecycleEvent(
                event_id=row.id,
                sequence=row.sequence,
                event_type=row.event_type,
                payload=row.payload_json or {},
                from_state=ParentState(row.from_state) if row.from_state else None,
                to_state=ParentState(row.to_state) if row.to_state else None,
            )
            for row in events
        ],
        requested_quantity=Decimal("10"),
    )
    assert replayed.state == ParentState.FILLED
    assert replayed.filled_quantity == Decimal(parent.filled_quantity)
    assert replayed.average_fill_price == Decimal(parent.average_fill_price)


def test_duplicate_event_id_does_not_append_second_outbox_row():
    session = _session()
    store = ExecutionStore()
    parent = store.ensure_legacy_parent(
        session,
        source_type="swap",
        source_ref="456",
        principal_key="user:8",
        intent_type="swap",
        substrate="direct_tx",
    )

    first = _change(
        store,
        session,
        parent,
        ParentState.DRAFT,
        ParentState.QUOTING,
        "fixed-event",
    )
    second = store.append_event(
        session,
        parent_order_id=parent.id,
        event_id="fixed-event",
        event_type="parent_state_changed",
        from_state=ParentState.DRAFT,
        to_state=ParentState.QUOTING,
    )
    session.commit()

    assert second.id == first.id
    assert parent.state_version == 1
    assert session.query(ExecutionEvent).count() == 1
    assert session.query(ExecutionOutbox).count() == 1
