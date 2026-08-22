"""Deterministic reducer for canonical Terminal execution state.

The reducer is deliberately provider-agnostic. Adapters translate provider/chain
observations into immutable lifecycle events; this module validates sequence and
state transitions and derives fill aggregates from those events.
"""

from dataclasses import dataclass, field, replace
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Iterable, Mapping, Optional


class ParentState(str, Enum):
    DRAFT = "draft"
    QUOTING = "quoting"
    READY = "ready"
    AUTHORIZING = "authorizing"
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    PAUSED = "paused"
    PARTIAL = "partial"
    RECONCILING = "reconciling"
    FILLED = "filled"
    CANCELLED = "cancelled"
    FAILED = "failed"
    EXPIRED = "expired"


TERMINAL_STATES = {
    ParentState.FILLED,
    ParentState.CANCELLED,
    ParentState.FAILED,
    ParentState.EXPIRED,
}

_ALLOWED_TRANSITIONS = {
    ParentState.DRAFT: {ParentState.QUOTING, ParentState.CANCELLED, ParentState.FAILED},
    ParentState.QUOTING: {
        ParentState.READY,
        ParentState.CANCELLED,
        ParentState.FAILED,
        ParentState.EXPIRED,
    },
    ParentState.READY: {
        ParentState.AUTHORIZING,
        ParentState.SCHEDULED,
        ParentState.ACTIVE,
        ParentState.CANCELLED,
        ParentState.FAILED,
        ParentState.EXPIRED,
    },
    ParentState.AUTHORIZING: {
        ParentState.READY,
        ParentState.SCHEDULED,
        ParentState.ACTIVE,
        ParentState.RECONCILING,
        ParentState.CANCELLED,
        ParentState.FAILED,
        ParentState.EXPIRED,
    },
    ParentState.SCHEDULED: {
        ParentState.ACTIVE,
        ParentState.PAUSED,
        ParentState.RECONCILING,
        ParentState.CANCELLED,
        ParentState.FAILED,
        ParentState.EXPIRED,
    },
    ParentState.ACTIVE: {
        ParentState.PAUSED,
        ParentState.PARTIAL,
        ParentState.RECONCILING,
        ParentState.FILLED,
        ParentState.CANCELLED,
        ParentState.FAILED,
    },
    ParentState.PAUSED: {
        ParentState.ACTIVE,
        ParentState.PARTIAL,
        ParentState.RECONCILING,
        ParentState.FILLED,
        ParentState.CANCELLED,
        ParentState.FAILED,
    },
    ParentState.PARTIAL: {
        ParentState.ACTIVE,
        ParentState.PAUSED,
        ParentState.RECONCILING,
        ParentState.FILLED,
        ParentState.CANCELLED,
        ParentState.FAILED,
    },
    ParentState.RECONCILING: {
        ParentState.ACTIVE,
        ParentState.PAUSED,
        ParentState.PARTIAL,
        ParentState.FILLED,
        ParentState.CANCELLED,
        ParentState.FAILED,
        ParentState.EXPIRED,
    },
    ParentState.FILLED: set(),
    ParentState.CANCELLED: set(),
    ParentState.FAILED: set(),
    ParentState.EXPIRED: set(),
}


class LifecycleError(ValueError):
    """Base error for invalid persisted lifecycle input."""


class EventSequenceError(LifecycleError):
    """Raised when replay sees a gap or unexpected sequence number."""


class IllegalTransitionError(LifecycleError):
    """Raised when an event attempts an invalid parent-state transition."""


class InvalidFillError(LifecycleError):
    """Raised when a fill event cannot be interpreted safely."""


@dataclass(frozen=True)
class LifecycleEvent:
    event_id: str
    sequence: int
    event_type: str
    payload: Mapping[str, Any] = field(default_factory=dict)
    from_state: Optional[ParentState] = None
    to_state: Optional[ParentState] = None


@dataclass(frozen=True)
class ExecutionSnapshot:
    parent_order_id: str
    state: ParentState = ParentState.DRAFT
    sequence: int = 0
    requested_quantity: Optional[Decimal] = None
    filled_quantity: Decimal = Decimal("0")
    average_fill_price: Optional[Decimal] = None
    applied_event_ids: frozenset[str] = field(default_factory=frozenset)
    applied_fill_keys: frozenset[str] = field(default_factory=frozenset)


def _as_state(value: Any) -> ParentState:
    if isinstance(value, ParentState):
        return value
    try:
        return ParentState(str(value))
    except ValueError as exc:
        raise IllegalTransitionError(f"unknown parent state: {value!r}") from exc


def _validate_transition(current: ParentState, target: ParentState) -> None:
    if current == target:
        return
    if current in TERMINAL_STATES:
        raise IllegalTransitionError(f"terminal state {current.value} cannot transition")
    if target not in _ALLOWED_TRANSITIONS[current]:
        raise IllegalTransitionError(f"illegal transition {current.value} -> {target.value}")


def _positive_decimal(value: Any, field_name: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise InvalidFillError(f"invalid {field_name}: {value!r}") from exc
    if not parsed.is_finite() or parsed <= 0:
        raise InvalidFillError(f"{field_name} must be finite and > 0")
    return parsed


def _advance(
    snapshot: ExecutionSnapshot,
    event: LifecycleEvent,
    **changes: Any,
) -> ExecutionSnapshot:
    event_ids = set(snapshot.applied_event_ids)
    event_ids.add(event.event_id)
    return replace(
        snapshot,
        sequence=event.sequence,
        applied_event_ids=frozenset(event_ids),
        **changes,
    )


def reduce_event(snapshot: ExecutionSnapshot, event: LifecycleEvent) -> ExecutionSnapshot:
    """Apply one event to a snapshot.

    Duplicate event IDs are ignored. New events must be contiguous by sequence;
    persistence owns assigning that sequence under transaction/row lock.
    """

    if event.event_id in snapshot.applied_event_ids:
        return snapshot

    expected = snapshot.sequence + 1
    if event.sequence != expected:
        raise EventSequenceError(
            f"parent {snapshot.parent_order_id}: expected sequence {expected}, got {event.sequence}"
        )

    if event.from_state is not None and event.from_state != snapshot.state:
        raise IllegalTransitionError(
            f"event expects {event.from_state.value}, snapshot is {snapshot.state.value}"
        )

    if event.event_type == "parent_state_changed":
        raw_target = event.to_state or event.payload.get("to_state")
        if raw_target is None:
            raise IllegalTransitionError("parent_state_changed requires to_state")
        target = _as_state(raw_target)
        _validate_transition(snapshot.state, target)
        return _advance(snapshot, event, state=target)

    if event.event_type == "reconciliation_started":
        _validate_transition(snapshot.state, ParentState.RECONCILING)
        return _advance(snapshot, event, state=ParentState.RECONCILING)

    if event.event_type == "reconciliation_resolved":
        if snapshot.state != ParentState.RECONCILING:
            raise IllegalTransitionError("reconciliation can only resolve from reconciling")
        raw_target = event.to_state or event.payload.get("resolved_state")
        if raw_target is None:
            raise IllegalTransitionError("reconciliation_resolved requires resolved_state")
        target = _as_state(raw_target)
        _validate_transition(snapshot.state, target)
        return _advance(snapshot, event, state=target)

    if event.event_type == "fill_recorded":
        fill_key = str(event.payload.get("fill_key") or event.event_id)
        if fill_key in snapshot.applied_fill_keys:
            return _advance(snapshot, event)

        quantity = _positive_decimal(event.payload.get("quantity"), "quantity")
        price = _positive_decimal(event.payload.get("price"), "price")

        previous_notional = (
            snapshot.filled_quantity * snapshot.average_fill_price
            if snapshot.average_fill_price is not None
            else Decimal("0")
        )
        new_quantity = snapshot.filled_quantity + quantity
        new_average = (previous_notional + (quantity * price)) / new_quantity

        target = ParentState.PARTIAL
        if snapshot.requested_quantity is not None and new_quantity >= snapshot.requested_quantity:
            target = ParentState.FILLED

        if target != snapshot.state:
            _validate_transition(snapshot.state, target)

        fill_keys = set(snapshot.applied_fill_keys)
        fill_keys.add(fill_key)
        return _advance(
            snapshot,
            event,
            state=target,
            filled_quantity=new_quantity,
            average_fill_price=new_average,
            applied_fill_keys=frozenset(fill_keys),
        )

    # Audit/adapter events that do not change the materialized parent snapshot
    # still advance sequence, preserving one canonical replay order.
    return _advance(snapshot, event)


def replay(
    parent_order_id: str,
    events: Iterable[LifecycleEvent],
    requested_quantity: Optional[Decimal] = None,
) -> ExecutionSnapshot:
    """Rebuild a parent snapshot from persisted events ordered by sequence."""

    snapshot = ExecutionSnapshot(
        parent_order_id=parent_order_id,
        requested_quantity=requested_quantity,
    )
    for event in sorted(events, key=lambda item: item.sequence):
        snapshot = reduce_event(snapshot, event)
    return snapshot
