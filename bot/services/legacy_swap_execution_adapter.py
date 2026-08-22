"""Project legacy ``SwapTransaction`` rows into the canonical execution model.

Phase B starts as a shadow adapter: it does not change signing/provider behavior.
It converts facts the existing swap engine/poller already knows into canonical
operational truth and refuses to manufacture fills from quote-time estimates.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional
import uuid

from sqlalchemy.orm import Session

from bot.models.execution import ExecutionChildPlacement, ExecutionParentOrder
from bot.models.swap import SwapStatus, SwapTransaction
from bot.services.execution_lifecycle import ParentState
from bot.services.execution_store import ExecutionStore, ExecutionStoreError, execution_store


class LegacySwapProjectionError(ExecutionStoreError):
    """Raised when a legacy swap cannot be projected without inventing facts."""


_STATUS_TARGET = {
    SwapStatus.PENDING.value: ParentState.DRAFT,
    SwapStatus.QUOTE_RECEIVED.value: ParentState.READY,
    SwapStatus.AWAITING_APPROVAL.value: ParentState.AUTHORIZING,
    SwapStatus.APPROVED.value: ParentState.AUTHORIZING,
    SwapStatus.SIGNED.value: ParentState.AUTHORIZING,
    SwapStatus.EXECUTING.value: ParentState.ACTIVE,
    SwapStatus.SUBMITTED.value: ParentState.ACTIVE,
    SwapStatus.CONFIRMING.value: ParentState.ACTIVE,
    SwapStatus.CANCELLED.value: ParentState.CANCELLED,
}


def _stable_event_id(swap_id: int, fact: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"suwappu:legacy-swap:{swap_id}:{fact}"))


def _decimal(value: Optional[str], field: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise LegacySwapProjectionError(f"legacy swap has invalid {field}: {value!r}") from exc
    if not parsed.is_finite() or parsed <= 0:
        raise LegacySwapProjectionError(f"legacy swap {field} must be finite and > 0")
    return parsed


def _status_path(current: ParentState, target: ParentState) -> list[ParentState]:
    """Return a conservative canonical path for a legacy coarse-grained status."""

    if current == target:
        return []

    forward = [
        ParentState.DRAFT,
        ParentState.QUOTING,
        ParentState.READY,
        ParentState.AUTHORIZING,
        ParentState.ACTIVE,
    ]
    if current in forward and target in forward:
        start = forward.index(current)
        end = forward.index(target)
        if end >= start:
            return forward[start + 1 : end + 1]

    if target in {
        ParentState.CANCELLED,
        ParentState.FAILED,
        ParentState.RECONCILING,
        ParentState.FILLED,
    }:
        return [target]

    raise LegacySwapProjectionError(
        f"cannot safely project canonical state {current.value} -> {target.value}"
    )


def _ensure_child(session: Session, parent: ExecutionParentOrder, swap: SwapTransaction):
    child = (
        session.query(ExecutionChildPlacement)
        .filter(
            ExecutionChildPlacement.parent_order_id == parent.id,
            ExecutionChildPlacement.child_sequence == 0,
        )
        .first()
    )
    if child is None:
        child = ExecutionChildPlacement(
            id=str(uuid.uuid4()),
            parent_order_id=parent.id,
            child_sequence=0,
            substrate="direct_tx",
            provider=swap.route_provider,
            chain=swap.from_chain,
            side=None,
            requested_quantity=swap.from_amount,
            quantity_asset=swap.from_token,
            state="created",
            idempotency_key=swap.idempotency_key,
            external_tx_hash=swap.tx_hash,
            submitted_at=swap.updated_at if swap.tx_hash else None,
        )
        session.add(child)
        session.flush()
    elif swap.tx_hash and not child.external_tx_hash:
        child.external_tx_hash = swap.tx_hash
        child.submitted_at = child.submitted_at or swap.updated_at or datetime.utcnow()
        child.state = "submitted"
        session.flush()
    return child


def _append_path(
    store: ExecutionStore,
    session: Session,
    swap: SwapTransaction,
    parent: ExecutionParentOrder,
    target: ParentState,
) -> None:
    current = ParentState(parent.state)
    for next_state in _status_path(current, target):
        store.append_event(
            session,
            parent_order_id=parent.id,
            event_id=_stable_event_id(swap.id, f"state:{next_state.value}"),
            event_type="parent_state_changed",
            from_state=ParentState(parent.state),
            to_state=next_state,
            payload={"legacy_swap_status": swap.status},
            correlation_id=f"swap:{swap.id}",
        )


def _record_realized_fill(
    store: ExecutionStore,
    session: Session,
    swap: SwapTransaction,
    parent: ExecutionParentOrder,
    child: ExecutionChildPlacement,
) -> None:
    input_amount = _decimal(swap.from_amount, "from_amount")
    output_amount = _decimal(swap.realized_to_amount, "realized_to_amount")
    execution_rate = output_amount / input_amount

    # The legacy model currently exposes one realized receive amount rather
    # than venue-level fill IDs. Use a deterministic swap-scoped identity until
    # provider adapters expose tx-log / venue-fill identities directly.
    external_source = swap.route_provider or "legacy_swap"
    external_fill_id = f"swap:{swap.id}:realized"
    store.record_fill(
        session,
        parent_order_id=parent.id,
        child_placement_id=child.id,
        external_source=external_source,
        external_fill_id=external_fill_id,
        quantity=str(input_amount),
        quantity_asset=swap.from_token,
        price=str(execution_rate),
        price_asset=f"{swap.to_token}/{swap.from_token}",
        input_asset=swap.from_token,
        input_amount=str(input_amount),
        output_asset=swap.to_token,
        output_amount=str(output_amount),
        fee_amount=str(swap.gas_fee) if swap.gas_fee is not None else None,
        fee_asset=None,
        occurred_at=swap.completed_at or swap.updated_at or datetime.utcnow(),
        metadata={
            "legacy_swap_id": swap.id,
            "tx_hash": swap.tx_hash,
            "destination_tx_hash": swap.destination_tx_hash,
            "quote_to_amount": swap.to_amount,
        },
    )


def project_legacy_swap(
    session: Session,
    swap: SwapTransaction,
    *,
    store: ExecutionStore = execution_store,
) -> ExecutionParentOrder:
    """Idempotently project the latest legacy swap facts into canonical state.

    Safety rules:
    - quote-time ``to_amount`` is never used as a realized fill;
    - completed-without-realized-output enters ``reconciling``;
    - failed-after-broadcast enters ``reconciling`` because the legacy row does
      not prove whether the external transaction reverted, timed out, or later
      settled;
    - a definitive pre-broadcast failure may become canonical ``failed``.
    """

    parent = store.ensure_legacy_parent(
        session,
        source_type="swap",
        source_ref=str(swap.id),
        principal_key=f"user:{swap.user_id}",
        user_id=swap.user_id,
        intent_type="swap",
        substrate="direct_tx",
        provider=swap.route_provider,
        amount_mode="exact_in",
        from_chain=swap.from_chain,
        to_chain=swap.to_chain,
        from_asset=swap.from_token,
        to_asset=swap.to_token,
        requested_quantity=swap.from_amount,
        quantity_asset=swap.from_token,
        idempotency_key=swap.idempotency_key,
        constraints={"slippage_bps": swap.slippage},
        metadata={"legacy_swap_id": swap.id},
    )
    child = _ensure_child(session, parent, swap)

    # Persist the legacy observation even when it does not change canonical
    # state. This gives support/reconciliation an auditable correlation trail.
    store.append_event(
        session,
        parent_order_id=parent.id,
        event_id=_stable_event_id(swap.id, f"legacy-status:{swap.status}"),
        event_type="legacy_status_observed",
        payload={
            "status": swap.status,
            "tx_hash": swap.tx_hash,
            "error_category": swap.error_category,
        },
        correlation_id=f"swap:{swap.id}",
    )

    if swap.status == SwapStatus.COMPLETED.value:
        if swap.realized_to_amount:
            _append_path(store, session, swap, parent, ParentState.ACTIVE)
            _record_realized_fill(store, session, swap, parent, child)
            return parent
        _append_path(store, session, swap, parent, ParentState.RECONCILING)
        return parent

    if swap.status == SwapStatus.FAILED.value:
        target = ParentState.RECONCILING if swap.tx_hash else ParentState.FAILED
        _append_path(store, session, swap, parent, target)
        return parent

    target = _STATUS_TARGET.get(swap.status)
    if target is None:
        raise LegacySwapProjectionError(f"unsupported legacy swap status: {swap.status!r}")
    _append_path(store, session, swap, parent, target)
    return parent
