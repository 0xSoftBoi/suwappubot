"""Managed-agent execution ambiguity handling.

This module sits at the Python internal execution boundary. ``swap_engine`` is
shared by many callers and historically converts any provider-dispatch exception
into a terminal legacy ``FAILED`` row. For the managed-agent path we have a
stable idempotency key, so transport/bridge outcomes that may have crossed the
external boundary are reclassified to ``RECONCILING`` before the HTTP response
leaves Python.

The reclassification and canonical execution projection happen in the same DB
transaction. It NEVER retries or submits anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Optional

from bot.models.swap import SwapStatus, SwapTransaction
from bot.services.legacy_swap_execution_adapter import project_legacy_swap
from database.db import get_session


# Categories produced by error_guidance that are inherently compatible with an
# external side effect already existing. ``unknown`` is intentionally NOT on
# this list by itself; broad unknown errors should not all be converted to
# reconciliation without additional transport evidence.
_AMBIGUOUS_CATEGORIES = frozenset({"rpc_timeout", "bridge_timeout"})

# Conservative transport/server hints used only when the classifier could not
# assign one of the explicit categories above. These are failures for which the
# caller cannot prove the provider did not receive/process the request.
_AMBIGUOUS_MESSAGE_FRAGMENTS = (
    "timeout",
    "timed out",
    "connection reset",
    "connection aborted",
    "connection closed",
    "server disconnected",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "status 500",
    "status 502",
    "status 503",
    "status 504",
)


@dataclass(frozen=True)
class ReconciliationRequired:
    swap_id: int
    status: str
    provider: Optional[str]
    tx_hash: Optional[str]
    error_category: Optional[str]


def _looks_indeterminate(swap: SwapTransaction, error: Exception) -> bool:
    if swap.error_category in _AMBIGUOUS_CATEGORIES:
        return True

    text = " ".join(
        part
        for part in (
            str(error),
            swap.error_message or "",
        )
        if part
    ).lower()
    return any(fragment in text for fragment in _AMBIGUOUS_MESSAGE_FRAGMENTS)


def _recovery_route_data(swap: SwapTransaction, error: Exception) -> str:
    try:
        existing = json.loads(swap.route_data or "{}")
        if not isinstance(existing, dict):
            existing = {}
    except (TypeError, ValueError, json.JSONDecodeError):
        existing = {}

    # Operational metadata only. Do not persist raw signed payloads, secrets, or
    # unbounded exception representations into route_data.
    existing["recovery"] = {
        "schema": "ambiguous-execution/v1",
        "reason": "provider_outcome_indeterminate",
        "error_category": swap.error_category,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "message": str(error)[:500],
    }
    return json.dumps(existing, sort_keys=True, separators=(",", ":"))


def mark_ambiguous_agent_swap_for_reconciliation(
    idempotency_key: Optional[str],
    error: Exception,
) -> Optional[ReconciliationRequired]:
    """Atomically convert an ambiguous managed-agent failure to reconciliation.

    Returns ``None`` when there is no exact idempotency key, no matching durable
    swap row, the row has already reached a non-failure state, or the error is a
    definitive/non-transport failure. The function never creates a new swap and
    never invokes a provider.
    """

    key = (idempotency_key or "").strip()
    if not key:
        return None

    with get_session() as session:
        swap = (
            session.query(SwapTransaction)
            .filter(SwapTransaction.idempotency_key == key)
            .first()
        )
        if swap is None:
            return None

        # A concurrent completion/submission wins. Never regress durable truth.
        if swap.status not in {
            SwapStatus.FAILED.value,
            SwapStatus.RECONCILING.value,
        }:
            return None

        if swap.status == SwapStatus.RECONCILING.value:
            # Idempotent retry of the boundary handler. Ensure canonical state is
            # repaired if a previous process died after the legacy write.
            project_legacy_swap(session, swap)
            return ReconciliationRequired(
                swap_id=swap.id,
                status=swap.status,
                provider=swap.route_provider,
                tx_hash=swap.tx_hash,
                error_category=swap.error_category,
            )

        if not _looks_indeterminate(swap, error):
            return None

        swap.status = SwapStatus.RECONCILING.value
        swap.route_data = _recovery_route_data(swap, error)
        # Keep the original classified error/error_message for diagnosis. The
        # status change expresses epistemic uncertainty, not a new root cause.
        session.flush()

        # This creates/advances the canonical parent to RECONCILING and, when no
        # tx identity is known, marks child sequence 0 as UNKNOWN. Both writes
        # commit or roll back with the legacy status change.
        project_legacy_swap(session, swap)

        return ReconciliationRequired(
            swap_id=swap.id,
            status=swap.status,
            provider=swap.route_provider,
            tx_hash=swap.tx_hash,
            error_category=swap.error_category,
        )
