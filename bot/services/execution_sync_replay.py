"""Read-only historical replay for Execution Synchronization.

This module joins the execution-intelligence data Suwappu already persists:
`swap_route_candidates` (the quote-time choice set) and `swap_transactions`
(the route that actually executed). Provider priors are calibrated only from
terminal executed swaps. Rejected routes remain MODELED counterfactuals.

Nothing here writes to the database or changes production routing.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Optional

from bot.services.execution_sync import ExecutionCandidate, ExecutionIntent, optimize
from bot.services.execution_sync_calibration import ProviderCalibration, calibrate_provider


DEFAULT_MIN_PROVIDER_EVIDENCE = 20
DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 180


@dataclass(frozen=True)
class ReplayRace:
    quote_id: str
    swap_id: Optional[int]
    production_provider: Optional[str]
    shadow_provider: Optional[str]
    production_quoted_output_usd: Optional[float]
    shadow_modeled_output_usd: Optional[float]
    modeled_delta_usd: Optional[float]
    candidate_count: int
    eligible_candidate_count: int
    insufficient_evidence_providers: tuple[str, ...]
    modeled: bool = True


@dataclass(frozen=True)
class ReplaySummary:
    races: int
    comparable_races: int
    changed_selection_races: int
    modeled_positive_delta_races: int
    modeled_total_delta_usd: float
    modeled_median_delta_usd: Optional[float]
    calibrations: Mapping[str, ProviderCalibration]
    results: tuple[ReplayRace, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "races": self.races,
            "comparable_races": self.comparable_races,
            "changed_selection_races": self.changed_selection_races,
            "modeled_positive_delta_races": self.modeled_positive_delta_races,
            "modeled_total_delta_usd": self.modeled_total_delta_usd,
            "modeled_median_delta_usd": self.modeled_median_delta_usd,
            "calibrations": {k: asdict(v) for k, v in self.calibrations.items()},
            "results": [asdict(r) for r in self.results],
            "modeled": True,
            "caveat": (
                "Alternative-route outcomes are historical counterfactual models, "
                "not observed fills. Only the production route actually executed."
            ),
        }


def _provider(value: Any) -> str:
    return str(value or "unknown").lower()


def _float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def build_calibrations(swaps: Iterable[Any]) -> dict[str, ProviderCalibration]:
    rows = list(swaps)
    providers = sorted({_provider(getattr(row, "route_provider", None)) for row in rows})
    return {provider: calibrate_provider(provider, rows) for provider in providers}


def replay_candidate(
    row: Any,
    calibration: ProviderCalibration,
    *,
    min_provider_evidence: int = DEFAULT_MIN_PROVIDER_EVIDENCE,
) -> Optional[ExecutionCandidate]:
    """Convert one persisted route candidate into a USD-homogeneous candidate.

    Historical replay deliberately uses `quoted_to_amount_usd` as output, so
    output and explicit gas/fee costs share the same unit. Candidates with too
    little executed-provider evidence are excluded rather than assigned an
    overconfident prior.
    """
    if calibration.observations < min_provider_evidence:
        return None

    quoted_usd = _float(getattr(row, "quoted_to_amount_usd", None))
    if quoted_usd is None or quoted_usd <= 0:
        return None

    fill_ratio = calibration.median_fill_ratio
    if fill_ratio is None:
        # We can still model availability/reliability, but not realized output.
        # Exclude it from optimizer replay until actual settled-output evidence
        # exists; otherwise the comparison mixes observed and assumed fills.
        return None

    modeled_output = quoted_usd * fill_ratio
    gas = max(0.0, _float(getattr(row, "quoted_gas_usd", None)) or 0.0)
    fee = max(0.0, _float(getattr(row, "quoted_fee_usd", None)) or 0.0)
    latency = calibration.median_latency_seconds
    if latency is None:
        latency = max(0.0, _float(getattr(row, "quoted_duration_s", None)) or 0.0)

    timestamp = _utc(getattr(row, "created_at", None))
    provider = _provider(getattr(row, "provider", None))

    # These are replay priors, not security attestations. Security remains
    # neutral here; production promotion still requires the live hard-policy
    # layer and provider allowlist.
    return ExecutionCandidate(
        provider=provider,
        from_chain=str(getattr(row, "from_chain", "")),
        to_chain=str(getattr(row, "to_chain", "")),
        from_token=str(getattr(row, "from_token", "")),
        to_token=str(getattr(row, "to_token", "")),
        from_amount_human=0.0,
        expected_output=modeled_output,
        guaranteed_min_output=modeled_output,
        gas_cost_usd=gas,
        fee_cost_usd=fee,
        total_cost_usd=gas + fee,
        expected_latency_seconds=float(latency),
        price_impact=0.0,
        settlement_probability=calibration.success_rate,
        security_score=0.5,
        mev_protected=False,
        quote_timestamp=timestamp,
        expires_in_seconds=60,
        raw_quote={
            "historical_replay": True,
            "evidence_count": calibration.observations,
            "realized_evidence_count": calibration.realized_observations,
            "fill_ratio": calibration.median_fill_ratio,
        },
    )


def replay_race(
    rows: Iterable[Any],
    calibrations: Mapping[str, ProviderCalibration],
    *,
    min_provider_evidence: int = DEFAULT_MIN_PROVIDER_EVIDENCE,
) -> ReplayRace:
    rows = list(rows)
    if not rows:
        raise ValueError("replay_race requires at least one candidate")

    quote_id = str(getattr(rows[0], "quote_id", ""))
    selected_row = next((row for row in rows if bool(getattr(row, "was_selected", False))), None)
    production_provider = _provider(getattr(selected_row, "provider", None)) if selected_row else None
    production_output = _float(getattr(selected_row, "quoted_to_amount_usd", None)) if selected_row else None
    swap_id = getattr(selected_row, "swap_id", None) if selected_row else None

    candidates: list[ExecutionCandidate] = []
    insufficient: set[str] = set()
    for row in rows:
        provider = _provider(getattr(row, "provider", None))
        calibration = calibrations.get(provider)
        if calibration is None or calibration.observations < min_provider_evidence:
            insufficient.add(provider)
            continue
        candidate = replay_candidate(
            row, calibration, min_provider_evidence=min_provider_evidence
        )
        if candidate is not None:
            candidates.append(candidate)

    # Evaluate at quote time, not today, otherwise every historical quote is
    # correctly-but-uselessly rejected as stale.
    quote_time = min((_utc(getattr(row, "created_at", None)) for row in rows), default=datetime.now(timezone.utc))
    decision = optimize(candidates, ExecutionIntent(), now=quote_time)
    shadow = decision.selected

    delta = None
    if shadow is not None and production_output is not None:
        delta = shadow.expected_output - production_output

    return ReplayRace(
        quote_id=quote_id,
        swap_id=int(swap_id) if swap_id is not None else None,
        production_provider=production_provider,
        shadow_provider=shadow.provider if shadow else None,
        production_quoted_output_usd=production_output,
        shadow_modeled_output_usd=shadow.expected_output if shadow else None,
        modeled_delta_usd=delta,
        candidate_count=len(rows),
        eligible_candidate_count=len(candidates),
        insufficient_evidence_providers=tuple(sorted(insufficient)),
    )


def summarize_replay(
    races: Iterable[ReplayRace], calibrations: Mapping[str, ProviderCalibration]
) -> ReplaySummary:
    results = tuple(races)
    comparable = [r for r in results if r.modeled_delta_usd is not None]
    changed = [
        r for r in comparable
        if r.shadow_provider is not None and r.production_provider is not None
        and r.shadow_provider != r.production_provider
    ]
    deltas = sorted(float(r.modeled_delta_usd) for r in comparable if r.modeled_delta_usd is not None)
    median_delta = None
    if deltas:
        n = len(deltas)
        mid = n // 2
        median_delta = deltas[mid] if n % 2 else (deltas[mid - 1] + deltas[mid]) / 2

    return ReplaySummary(
        races=len(results),
        comparable_races=len(comparable),
        changed_selection_races=len(changed),
        modeled_positive_delta_races=sum(1 for r in comparable if float(r.modeled_delta_usd) > 0),
        modeled_total_delta_usd=sum(float(r.modeled_delta_usd) for r in comparable),
        modeled_median_delta_usd=median_delta,
        calibrations=calibrations,
        results=results,
    )


class ExecutionSyncReplayStore:
    """Read-only DB adapter over existing execution-intelligence tables."""

    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _session(self):
        if self._session_factory is not None:
            return self._session_factory()
        from database.db import get_session

        return get_session()

    def load_terminal_swaps(self, window_days: int = DEFAULT_WINDOW_DAYS) -> list[Any]:
        from sqlalchemy import text
        from types import SimpleNamespace

        window_days = max(1, min(int(window_days), MAX_WINDOW_DAYS))
        cutoff = datetime.utcnow() - timedelta(days=window_days)
        with self._session() as session:
            rows = session.execute(
                text("""
                    SELECT route_provider, status, created_at, completed_at,
                           to_amount_usd, realized_to_amount_usd
                    FROM swap_transactions
                    WHERE created_at >= :cutoff
                      AND status IN ('completed', 'failed')
                      AND route_provider IS NOT NULL
                """),
                {"cutoff": cutoff},
            ).fetchall()
        return [
            SimpleNamespace(
                route_provider=r[0], status=r[1], created_at=r[2], completed_at=r[3],
                to_amount_usd=r[4], realized_to_amount_usd=r[5]
            )
            for r in rows
        ]

    def load_races(self, window_days: int = DEFAULT_WINDOW_DAYS) -> dict[str, list[Any]]:
        from sqlalchemy import text
        from types import SimpleNamespace

        window_days = max(1, min(int(window_days), MAX_WINDOW_DAYS))
        cutoff = datetime.utcnow() - timedelta(days=window_days)
        with self._session() as session:
            rows = session.execute(
                text("""
                    SELECT quote_id, swap_id, provider, from_chain, to_chain,
                           from_token, to_token, quoted_to_amount_usd,
                           quoted_gas_usd, quoted_fee_usd, quoted_duration_s,
                           was_selected, created_at
                    FROM swap_route_candidates
                    WHERE created_at >= :cutoff
                    ORDER BY quote_id, rank, id
                """),
                {"cutoff": cutoff},
            ).fetchall()

        grouped: dict[str, list[Any]] = {}
        for r in rows:
            obj = SimpleNamespace(
                quote_id=r[0], swap_id=r[1], provider=r[2], from_chain=r[3], to_chain=r[4],
                from_token=r[5], to_token=r[6], quoted_to_amount_usd=r[7],
                quoted_gas_usd=r[8], quoted_fee_usd=r[9], quoted_duration_s=r[10],
                was_selected=r[11], created_at=r[12],
            )
            grouped.setdefault(str(r[0]), []).append(obj)
        return grouped

    def run(
        self,
        *,
        window_days: int = DEFAULT_WINDOW_DAYS,
        min_provider_evidence: int = DEFAULT_MIN_PROVIDER_EVIDENCE,
    ) -> ReplaySummary:
        swaps = self.load_terminal_swaps(window_days)
        calibrations = build_calibrations(swaps)
        grouped = self.load_races(window_days)
        results = [
            replay_race(rows, calibrations, min_provider_evidence=min_provider_evidence)
            for rows in grouped.values()
        ]
        return summarize_replay(results, calibrations)
