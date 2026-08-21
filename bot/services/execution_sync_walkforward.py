"""Walk-forward historical evaluation for Execution Synchronization.

Each race is evaluated only with provider evidence that existed strictly before
that race's quote timestamp. This avoids look-ahead leakage from fitting and
scoring on the same historical window.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from bot.services.execution_sync_replay import (
    DEFAULT_MIN_PROVIDER_EVIDENCE,
    ExecutionSyncReplayStore,
    ReplayRace,
    build_calibrations,
    replay_race,
)


def _utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    raise ValueError("walk-forward rows require created_at timestamps")


@dataclass(frozen=True)
class WalkForwardFold:
    quote_id: str
    quote_time: datetime
    training_observations: int
    replay: ReplayRace


@dataclass(frozen=True)
class WalkForwardSummary:
    folds: int
    comparable_folds: int
    changed_selection_folds: int
    positive_delta_folds: int
    modeled_total_delta_usd: float
    modeled_median_delta_usd: Optional[float]
    observed_production_fill_folds: int
    skipped_no_prior_evidence: int
    results: tuple[WalkForwardFold, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "folds": self.folds,
            "comparable_folds": self.comparable_folds,
            "changed_selection_folds": self.changed_selection_folds,
            "positive_delta_folds": self.positive_delta_folds,
            "modeled_total_delta_usd": self.modeled_total_delta_usd,
            "modeled_median_delta_usd": self.modeled_median_delta_usd,
            "observed_production_fill_folds": self.observed_production_fill_folds,
            "skipped_no_prior_evidence": self.skipped_no_prior_evidence,
            "results": [
                {
                    "quote_id": f.quote_id,
                    "quote_time": f.quote_time.isoformat(),
                    "training_observations": f.training_observations,
                    "replay": asdict(f.replay),
                }
                for f in self.results
            ],
            "modeled": True,
            "walk_forward": True,
            "caveat": (
                "Every race is scored using only terminal executions observed before "
                "its quote time. Rejected-route outcomes remain modeled counterfactuals."
            ),
        }


def run_walk_forward(
    races: Iterable[Iterable[Any]],
    terminal_swaps: Iterable[Any],
    *,
    min_provider_evidence: int = DEFAULT_MIN_PROVIDER_EVIDENCE,
) -> WalkForwardSummary:
    """Replay races chronologically without look-ahead calibration leakage."""
    swaps = sorted(list(terminal_swaps), key=lambda row: _utc(getattr(row, "created_at", None)))

    normalized_races: list[tuple[datetime, list[Any]]] = []
    for rows_iter in races:
        rows = list(rows_iter)
        if not rows:
            continue
        quote_time = min(_utc(getattr(row, "created_at", None)) for row in rows)
        normalized_races.append((quote_time, rows))
    normalized_races.sort(key=lambda item: item[0])

    folds: list[WalkForwardFold] = []
    skipped = 0
    swap_idx = 0
    prior_swaps: list[Any] = []

    for quote_time, rows in normalized_races:
        # Strict inequality: a terminal observation at the exact quote timestamp
        # is not assumed known to the router yet.
        while (
            swap_idx < len(swaps)
            and _utc(getattr(swaps[swap_idx], "created_at", None)) < quote_time
        ):
            prior_swaps.append(swaps[swap_idx])
            swap_idx += 1

        if not prior_swaps:
            skipped += 1
            continue

        calibrations = build_calibrations(prior_swaps)
        replay = replay_race(
            rows,
            calibrations,
            min_provider_evidence=min_provider_evidence,
        )
        if replay.eligible_candidate_count == 0:
            skipped += 1
            continue

        folds.append(
            WalkForwardFold(
                quote_id=replay.quote_id,
                quote_time=quote_time,
                training_observations=len(prior_swaps),
                replay=replay,
            )
        )

    comparable = [f for f in folds if f.replay.modeled_delta_usd is not None]
    deltas = sorted(float(f.replay.modeled_delta_usd) for f in comparable)
    median_delta = None
    if deltas:
        mid = len(deltas) // 2
        median_delta = deltas[mid] if len(deltas) % 2 else (deltas[mid - 1] + deltas[mid]) / 2

    return WalkForwardSummary(
        folds=len(folds),
        comparable_folds=len(comparable),
        changed_selection_folds=sum(
            1
            for f in comparable
            if f.replay.shadow_provider is not None
            and f.replay.production_provider is not None
            and f.replay.shadow_provider != f.replay.production_provider
        ),
        positive_delta_folds=sum(1 for f in comparable if float(f.replay.modeled_delta_usd) > 0),
        modeled_total_delta_usd=sum(float(f.replay.modeled_delta_usd) for f in comparable),
        modeled_median_delta_usd=median_delta,
        observed_production_fill_folds=sum(
            1 for f in folds if f.replay.production_observed_output_usd is not None
        ),
        skipped_no_prior_evidence=skipped,
        results=tuple(folds),
    )


class ExecutionSyncWalkForwardStore:
    """Read-only DB-backed walk-forward evaluator."""

    def __init__(self, replay_store: Optional[ExecutionSyncReplayStore] = None):
        self.replay_store = replay_store or ExecutionSyncReplayStore()

    def run(
        self,
        *,
        window_days: int = 30,
        min_provider_evidence: int = DEFAULT_MIN_PROVIDER_EVIDENCE,
    ) -> WalkForwardSummary:
        swaps = self.replay_store.load_terminal_swaps(window_days)
        grouped = self.replay_store.load_races(window_days)
        return run_walk_forward(
            grouped.values(),
            swaps,
            min_provider_evidence=min_provider_evidence,
        )
