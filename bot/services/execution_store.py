"""Transactional persistence for the canonical execution lifecycle.

Every adapter must use this store (or a future equivalent repository API) for
parent-event sequencing. That keeps state reduction, the materialized parent
snapshot, and the transactional outbox in one database transaction.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Optional
import uuid

from sqlalchemy.orm import Session

from bot.models.execution import (
    ExecutionCandidatePlan,
    ExecutionChildPlacement,
    ExecutionEvent,
    ExecutionFill,
    ExecutionIntent,
    ExecutionOutbox,
    ExecutionParentOrder,
)
from bot.services.execution_lifecycle import (
    ExecutionSnapshot,
    LifecycleEvent,
    ParentState,
    reduce_event,
)


class ExecutionStoreError(RuntimeError):
    """Base persistence-layer error for canonical execution state."""


class ParentNotFoundError(ExecutionStoreError):
    """Raised when an event references an unknown parent order."""


def _uuid() -> str:
    return str(uuid.uuid4())


def _decimal_or_none(value: Optional[str]) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ExecutionStoreError(f"invalid persisted decimal value: {value!r}") from exc


def _snapshot_from_parent(parent: ExecutionParentOrder) -> ExecutionSnapshot:
    return ExecutionSnapshot(
        parent_order_id=parent.id,
        state=ParentState(parent.state),
        sequence=parent.state_version,
        requested_quantity=_decimal_or_none(parent.requested_quantity),
        filled_quantity=_decimal_or_none(parent.filled_quantity) or Decimal("0"),
        average_fill_price=_decimal_or_none(parent.average_fill_price),
    )


class ExecutionStore:
    """Single transactional write path for canonical operational execution truth."""

    def ensure_legacy_parent(
        self,
        session: Session,
        *,
        source_type: str,
        source_ref: str,
        principal_key: str,
        intent_type: str,
        substrate: str,
        provider: Optional[str] = None,
        user_id: Optional[int] = None,
        side: Optional[str] = None,
        amount_mode: Optional[str] = None,
        from_chain: Optional[str] = None,
        to_chain: Optional[str] = None,
        from_asset: Optional[str] = None,
        to_asset: Optional[str] = None,
        requested_quantity: Optional[str] = None,
        quantity_asset: Optional[str] = None,
        requested_notional: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        constraints: Optional[Mapping[str, Any]] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> ExecutionParentOrder:
        """Create-or-return the canonical parent for one legacy execution row.

        ``(source_type, source_ref)`` is the migration identity. Adapters can
        safely call this after restart/replay without creating a second parent.
        """

        source_type = source_type.strip()
        source_ref = source_ref.strip()
        if not source_type or not source_ref:
            raise ExecutionStoreError("source_type and source_ref are required")

        existing = (
            session.query(ExecutionParentOrder)
            .filter(
                ExecutionParentOrder.source_type == source_type,
                ExecutionParentOrder.source_ref == source_ref,
            )
            .first()
        )
        if existing:
            return existing

        intent_id = _uuid()
        candidate_id = _uuid()
        parent_id = _uuid()

        intent = ExecutionIntent(
            id=intent_id,
            user_id=user_id,
            principal_key=principal_key,
            idempotency_key=idempotency_key,
            intent_type=intent_type,
            side=side,
            amount_mode=amount_mode,
            from_chain=from_chain,
            to_chain=to_chain,
            from_asset=from_asset,
            to_asset=to_asset,
            requested_quantity=requested_quantity,
            quantity_asset=quantity_asset,
            requested_notional=requested_notional,
            constraints_json=dict(constraints or {}),
            metadata_json=dict(metadata or {}),
        )
        candidate = ExecutionCandidatePlan(
            id=candidate_id,
            intent_id=intent_id,
            ordinal=0,
            substrate=substrate,
            provider=provider,
            selected=True,
        )
        parent = ExecutionParentOrder(
            id=parent_id,
            intent_id=intent_id,
            selected_candidate_id=candidate_id,
            source_type=source_type,
            source_ref=source_ref,
            state=ParentState.DRAFT.value,
            state_version=0,
            requested_quantity=requested_quantity,
            quantity_asset=quantity_asset,
            filled_quantity="0",
            submit_idempotency_key=idempotency_key,
        )
        session.add_all([intent, candidate, parent])
        session.flush()
        return parent

    def append_event(
        self,
        session: Session,
        *,
        parent_order_id: str,
        event_type: str,
        event_id: Optional[str] = None,
        payload: Optional[Mapping[str, Any]] = None,
        from_state: Optional[ParentState] = None,
        to_state: Optional[ParentState] = None,
        actor_type: Optional[str] = None,
        actor_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        causation_id: Optional[str] = None,
        topic: str = "execution.lifecycle",
        occurred_at: Optional[datetime] = None,
    ) -> ExecutionEvent:
        """Append one event and materialize its parent snapshot atomically.

        The parent row is locked before assigning the next sequence. A caller
        may supply a deterministic event ID; retrying the same event then
        returns the already-persisted row rather than advancing sequence again.
        """

        event_id = event_id or _uuid()
        duplicate = session.query(ExecutionEvent).filter(ExecutionEvent.id == event_id).first()
        if duplicate:
            return duplicate

        parent = (
            session.query(ExecutionParentOrder)
            .filter(ExecutionParentOrder.id == parent_order_id)
            .with_for_update()
            .first()
        )
        if not parent:
            raise ParentNotFoundError(parent_order_id)

        current = _snapshot_from_parent(parent)
        lifecycle_event = LifecycleEvent(
            event_id=event_id,
            sequence=current.sequence + 1,
            event_type=event_type,
            payload=dict(payload or {}),
            from_state=from_state,
            to_state=to_state,
        )
        next_snapshot = reduce_event(current, lifecycle_event)

        row = ExecutionEvent(
            id=event_id,
            parent_order_id=parent.id,
            sequence=lifecycle_event.sequence,
            event_type=event_type,
            from_state=from_state.value if from_state is not None else None,
            to_state=to_state.value if to_state is not None else None,
            payload_json=dict(payload or {}),
            actor_type=actor_type,
            actor_id=actor_id,
            correlation_id=correlation_id,
            causation_id=causation_id,
            occurred_at=occurred_at or datetime.utcnow(),
        )
        outbox = ExecutionOutbox(
            id=_uuid(),
            event_id=event_id,
            topic=topic,
            payload_json={
                "event_id": event_id,
                "parent_order_id": parent.id,
                "sequence": lifecycle_event.sequence,
                "event_type": event_type,
                "from_state": row.from_state,
                "to_state": row.to_state,
                "payload": dict(payload or {}),
            },
        )

        parent.state = next_snapshot.state.value
        parent.state_version = next_snapshot.sequence
        parent.filled_quantity = str(next_snapshot.filled_quantity)
        parent.average_fill_price = (
            str(next_snapshot.average_fill_price)
            if next_snapshot.average_fill_price is not None
            else None
        )
        parent.updated_at = datetime.utcnow()
        if next_snapshot.state in {
            ParentState.FILLED,
            ParentState.CANCELLED,
            ParentState.FAILED,
            ParentState.EXPIRED,
        }:
            parent.completed_at = parent.completed_at or datetime.utcnow()

        session.add_all([row, outbox])
        session.flush()
        return row

    def record_fill(
        self,
        session: Session,
        *,
        parent_order_id: str,
        external_source: str,
        external_fill_id: str,
        quantity: str,
        price: str,
        occurred_at: datetime,
        child_placement_id: Optional[str] = None,
        quantity_asset: Optional[str] = None,
        price_asset: Optional[str] = None,
        input_asset: Optional[str] = None,
        input_amount: Optional[str] = None,
        output_asset: Optional[str] = None,
        output_amount: Optional[str] = None,
        fee_amount: Optional[str] = None,
        fee_asset: Optional[str] = None,
        liquidity_role: Optional[str] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> ExecutionFill:
        """Persist an authoritative fill exactly once and emit its event.

        Adapters must provide a stable external fill identity (venue fill ID,
        or a deterministic chain identity such as tx-hash + log index). That
        identity is the dedupe boundary across worker restarts and webhooks.
        """

        external_source = external_source.strip()
        external_fill_id = external_fill_id.strip()
        if not external_source or not external_fill_id:
            raise ExecutionStoreError("stable external_source/external_fill_id are required")

        # Serialize fill aggregation on the parent. This also makes duplicate
        # detection deterministic when two observers race on the same fill.
        parent = (
            session.query(ExecutionParentOrder)
            .filter(ExecutionParentOrder.id == parent_order_id)
            .with_for_update()
            .first()
        )
        if not parent:
            raise ParentNotFoundError(parent_order_id)

        existing = (
            session.query(ExecutionFill)
            .filter(
                ExecutionFill.external_source == external_source,
                ExecutionFill.external_fill_id == external_fill_id,
            )
            .first()
        )
        if existing:
            return existing

        fill = ExecutionFill(
            id=_uuid(),
            parent_order_id=parent.id,
            child_placement_id=child_placement_id,
            external_source=external_source,
            external_fill_id=external_fill_id,
            quantity=quantity,
            quantity_asset=quantity_asset,
            price=price,
            price_asset=price_asset,
            input_asset=input_asset,
            input_amount=input_amount,
            output_asset=output_asset,
            output_amount=output_amount,
            fee_amount=fee_amount,
            fee_asset=fee_asset,
            liquidity_role=liquidity_role,
            metadata_json=dict(metadata or {}),
            occurred_at=occurred_at,
        )
        session.add(fill)
        session.flush()

        event_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"suwappu:execution-fill:{external_source}:{external_fill_id}",
            )
        )
        self.append_event(
            session,
            parent_order_id=parent.id,
            event_id=event_id,
            event_type="fill_recorded",
            payload={
                "fill_key": f"{external_source}:{external_fill_id}",
                "fill_id": fill.id,
                "quantity": quantity,
                "price": price,
            },
            correlation_id=external_fill_id,
        )
        return fill


execution_store = ExecutionStore()
