"""Execution receipt helpers for shadow-mode welfare measurement."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import timezone
from typing import Any, Optional


@dataclass(frozen=True)
class ExecutionReceipt:
    swap_id: int
    provider: str
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    quoted_output: Optional[float]
    realized_output: Optional[float]
    gas_cost_usd: float
    fee_cost_usd: float
    status: str
    submitted_at: Optional[str]
    completed_at: Optional[str]
    settlement_latency_seconds: Optional[float]
    tx_hash: Optional[str]
    destination_tx_hash: Optional[str]
    execution_welfare_bps: Optional[float]
    baseline_output: Optional[float]

    def to_event(self) -> dict[str, Any]:
        return {"event": "execution_sync_receipt", **asdict(self)}


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _latency_seconds(created_at: Any, completed_at: Any) -> Optional[float]:
    if created_at is None or completed_at is None:
        return None
    start = created_at if getattr(created_at, "tzinfo", None) else created_at.replace(tzinfo=timezone.utc)
    end = completed_at if getattr(completed_at, "tzinfo", None) else completed_at.replace(tzinfo=timezone.utc)
    return max(0.0, (end - start).total_seconds())


def execution_welfare_bps(realized_output: Optional[float], baseline_output: Optional[float]) -> Optional[float]:
    if realized_output is None or baseline_output is None or baseline_output <= 0:
        return None
    return ((realized_output / baseline_output) - 1.0) * 10_000.0


def receipt_from_swap_transaction(
    tx: Any,
    *,
    realized_output: Optional[float] = None,
    baseline_output: Optional[float] = None,
) -> ExecutionReceipt:
    """Build terminal telemetry without treating quote-time output as realized."""
    quoted_output = getattr(tx, "to_amount_usd", None)
    if quoted_output is not None:
        quoted_output = float(quoted_output)
    created_at = getattr(tx, "created_at", None)
    completed_at = getattr(tx, "completed_at", None)
    return ExecutionReceipt(
        swap_id=int(getattr(tx, "id")),
        provider=str(getattr(tx, "route_provider", "unknown") or "unknown"),
        from_chain=str(getattr(tx, "from_chain", "")),
        to_chain=str(getattr(tx, "to_chain", "")),
        from_token=str(getattr(tx, "from_token", "")),
        to_token=str(getattr(tx, "to_token", "")),
        quoted_output=quoted_output,
        realized_output=realized_output,
        gas_cost_usd=float(getattr(tx, "gas_fee", 0.0) or 0.0),
        fee_cost_usd=float(getattr(tx, "bridge_fee", 0.0) or 0.0),
        status=str(getattr(tx, "status", "unknown")),
        submitted_at=_iso(created_at),
        completed_at=_iso(completed_at),
        settlement_latency_seconds=_latency_seconds(created_at, completed_at),
        tx_hash=getattr(tx, "tx_hash", None),
        destination_tx_hash=getattr(tx, "destination_tx_hash", None),
        execution_welfare_bps=execution_welfare_bps(realized_output, baseline_output),
        baseline_output=baseline_output,
    )
