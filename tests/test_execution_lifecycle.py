from decimal import Decimal

import pytest

from bot.services.execution_lifecycle import (
    EventSequenceError,
    ExecutionSnapshot,
    IllegalTransitionError,
    LifecycleEvent,
    ParentState,
    reduce_event,
    replay,
)


def _state_event(event_id: str, sequence: int, source: ParentState, target: ParentState):
    return LifecycleEvent(
        event_id=event_id,
        sequence=sequence,
        event_type="parent_state_changed",
        from_state=source,
        to_state=target,
    )


def test_replay_derives_partial_and_weighted_average_fill():
    events = [
        _state_event("e1", 1, ParentState.DRAFT, ParentState.QUOTING),
        _state_event("e2", 2, ParentState.QUOTING, ParentState.READY),
        _state_event("e3", 3, ParentState.READY, ParentState.AUTHORIZING),
        _state_event("e4", 4, ParentState.AUTHORIZING, ParentState.ACTIVE),
        LifecycleEvent(
            event_id="e5",
            sequence=5,
            event_type="fill_recorded",
            payload={"fill_key": "venue:1", "quantity": "4", "price": "100"},
        ),
        LifecycleEvent(
            event_id="e6",
            sequence=6,
            event_type="fill_recorded",
            payload={"fill_key": "venue:2", "quantity": "6", "price": "110"},
        ),
    ]

    snapshot = replay("parent-1", events, requested_quantity=Decimal("10"))

    assert snapshot.state == ParentState.FILLED
    assert snapshot.filled_quantity == Decimal("10")
    assert snapshot.average_fill_price == Decimal("106")
    assert snapshot.sequence == 6


def test_duplicate_event_id_is_noop():
    snapshot = ExecutionSnapshot(parent_order_id="parent-1")
    first = _state_event("e1", 1, ParentState.DRAFT, ParentState.QUOTING)

    after_first = reduce_event(snapshot, first)
    after_duplicate = reduce_event(after_first, first)

    assert after_duplicate is after_first
    assert after_duplicate.sequence == 1
    assert after_duplicate.state == ParentState.QUOTING


def test_duplicate_external_fill_key_advances_event_without_double_counting():
    snapshot = replay(
        "parent-1",
        [
            _state_event("e1", 1, ParentState.DRAFT, ParentState.QUOTING),
            _state_event("e2", 2, ParentState.QUOTING, ParentState.READY),
            _state_event("e3", 3, ParentState.READY, ParentState.ACTIVE),
            LifecycleEvent(
                event_id="e4",
                sequence=4,
                event_type="fill_recorded",
                payload={"fill_key": "venue:fill-1", "quantity": "2", "price": "100"},
            ),
            LifecycleEvent(
                event_id="e5",
                sequence=5,
                event_type="fill_recorded",
                payload={"fill_key": "venue:fill-1", "quantity": "2", "price": "100"},
            ),
        ],
        requested_quantity=Decimal("5"),
    )

    assert snapshot.state == ParentState.PARTIAL
    assert snapshot.filled_quantity == Decimal("2")
    assert snapshot.sequence == 5


def test_sequence_gap_fails_closed():
    snapshot = ExecutionSnapshot(parent_order_id="parent-1")

    with pytest.raises(EventSequenceError):
        reduce_event(
            snapshot,
            _state_event("e2", 2, ParentState.DRAFT, ParentState.QUOTING),
        )


def test_illegal_state_transition_fails_closed():
    snapshot = ExecutionSnapshot(parent_order_id="parent-1")

    with pytest.raises(IllegalTransitionError):
        reduce_event(
            snapshot,
            _state_event("e1", 1, ParentState.DRAFT, ParentState.FILLED),
        )


def test_ambiguous_outcome_reconciles_to_partial_fill():
    snapshot = replay(
        "parent-1",
        [
            _state_event("e1", 1, ParentState.DRAFT, ParentState.QUOTING),
            _state_event("e2", 2, ParentState.QUOTING, ParentState.READY),
            _state_event("e3", 3, ParentState.READY, ParentState.AUTHORIZING),
            LifecycleEvent(
                event_id="e4",
                sequence=4,
                event_type="reconciliation_started",
                from_state=ParentState.AUTHORIZING,
            ),
            LifecycleEvent(
                event_id="e5",
                sequence=5,
                event_type="reconciliation_resolved",
                from_state=ParentState.RECONCILING,
                payload={"resolved_state": "active"},
            ),
            LifecycleEvent(
                event_id="e6",
                sequence=6,
                event_type="fill_recorded",
                payload={"fill_key": "tx:0xabc:0", "quantity": "1", "price": "99"},
            ),
        ],
        requested_quantity=Decimal("3"),
    )

    assert snapshot.state == ParentState.PARTIAL
    assert snapshot.filled_quantity == Decimal("1")
