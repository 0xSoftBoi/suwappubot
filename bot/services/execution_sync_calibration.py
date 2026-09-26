"""Calibration helpers for Execution Synchronization.

Counterfactual routes are never labeled as realized. Historical completed swaps
calibrate provider priors (fill accuracy, success and latency); rejected quote
candidates can then be replayed with those priors as *modeled* outcomes only.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from statistics import median
from typing import Any, Iterable, Optional


@dataclass(frozen=True)
class ProviderCalibration:
    provider: str
    observations: int
    realized_observations: int
    success_rate: float
    median_latency_seconds: Optional[float]
    median_fill_ratio: Optional[float]
    fill_ratio_std_error: Optional[float]


@dataclass(frozen=True)
class ModeledCandidateOutcome:
    provider: str
    quoted_output_usd: Optional[float]
    modeled_realized_output_usd: Optional[float]
    success_probability: float
    median_latency_seconds: Optional[float]
    evidence_count: int
    is_counterfactual: bool = True


def _provider(value: Any) -> str:
    return str(value or "unknown").lower()


def calibrate_provider(provider: str, swaps: Iterable[Any]) -> ProviderCalibration:
    """Estimate conservative provider behavior from swaps that actually executed."""
    provider = _provider(provider)
    rows = [s for s in swaps if _provider(getattr(s, "route_provider", None)) == provider]
    if not rows:
        return ProviderCalibration(provider, 0, 0, 0.0, None, None, None)

    successes = []
    latencies = []
    fill_ratios = []
    for tx in rows:
        status = str(getattr(tx, "status", "")).lower()
        success = status == "completed"
        successes.append(1.0 if success else 0.0)

        created_at = getattr(tx, "created_at", None)
        completed_at = getattr(tx, "completed_at", None)
        if success and created_at is not None and completed_at is not None:
            latency = (completed_at - created_at).total_seconds()
            if latency >= 0:
                latencies.append(float(latency))

        quoted = getattr(tx, "to_amount_usd", None)
        realized = getattr(tx, "realized_to_amount_usd", None)
        if success and quoted and realized is not None and float(quoted) > 0:
            ratio = float(realized) / float(quoted)
            # Reject clearly corrupted observations; legitimate fills should be
            # near the quote, while this bound still permits severe slippage.
            if 0.25 <= ratio <= 4.0:
                fill_ratios.append(ratio)

    fill_se = None
    if len(fill_ratios) >= 2:
        mean = sum(fill_ratios) / len(fill_ratios)
        variance = sum((x - mean) ** 2 for x in fill_ratios) / (len(fill_ratios) - 1)
        fill_se = sqrt(variance / len(fill_ratios))

    return ProviderCalibration(
        provider=provider,
        observations=len(rows),
        realized_observations=len(fill_ratios),
        success_rate=sum(successes) / len(successes),
        median_latency_seconds=median(latencies) if latencies else None,
        median_fill_ratio=median(fill_ratios) if fill_ratios else None,
        fill_ratio_std_error=fill_se,
    )


def model_candidate(candidate: Any, calibration: ProviderCalibration) -> ModeledCandidateOutcome:
    """Apply observed provider calibration to a rejected/alternative quote.

    The result is explicitly counterfactual. It is suitable for shadow replay,
    never for claims about what a user actually would have received.
    """
    quoted = getattr(candidate, "quoted_to_amount_usd", None)
    quoted_usd = float(quoted) if quoted is not None else None
    modeled = None
    if quoted_usd is not None and calibration.median_fill_ratio is not None:
        modeled = quoted_usd * calibration.median_fill_ratio

    return ModeledCandidateOutcome(
        provider=_provider(getattr(candidate, "provider", calibration.provider)),
        quoted_output_usd=quoted_usd,
        modeled_realized_output_usd=modeled,
        success_probability=calibration.success_rate,
        median_latency_seconds=calibration.median_latency_seconds,
        evidence_count=calibration.observations,
    )
