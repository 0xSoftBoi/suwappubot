"""Execution Synchronization primitives and shadow optimizer.

Provider quotes are normalized into one candidate model, hard constraints are
applied first, dominated candidates are removed with a Pareto frontier, and only
then are feasible candidates ranked by expected utility. Production routing stays
authoritative until realized execution data proves promotion is safe.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Optional, Sequence
import math


@dataclass(frozen=True)
class ExecutionIntent:
    min_output: float = 0.0
    max_total_cost_usd: Optional[float] = None
    max_latency_seconds: Optional[float] = None
    min_settlement_probability: float = 0.0
    min_security_score: float = 0.0
    max_price_impact: Optional[float] = None
    require_mev_protection: bool = False
    allowed_providers: frozenset[str] = field(default_factory=frozenset)
    forbidden_providers: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class ExecutionCandidate:
    provider: str
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount_human: float
    expected_output: float
    guaranteed_min_output: float
    gas_cost_usd: float
    fee_cost_usd: float
    total_cost_usd: float
    expected_latency_seconds: float
    price_impact: float
    settlement_probability: float
    security_score: float
    mev_protected: bool
    quote_timestamp: datetime
    expires_in_seconds: int
    raw_quote: Mapping[str, Any] = field(default_factory=dict, compare=False)

    @property
    def expires_at(self) -> datetime:
        return self.quote_timestamp + timedelta(seconds=max(0, self.expires_in_seconds))


@dataclass(frozen=True)
class ConstraintViolation:
    code: str
    detail: str


@dataclass(frozen=True)
class CandidateEvaluation:
    candidate: ExecutionCandidate
    feasible: bool
    violations: tuple[ConstraintViolation, ...]
    utility: float


@dataclass(frozen=True)
class UtilityWeights:
    usd_cost_penalty: float = 0.001
    latency_penalty_per_second: float = 0.00001
    failure_penalty: float = 1.0
    security_penalty: float = 0.05
    mev_penalty: float = 0.01
    price_impact_penalty: float = 0.001


@dataclass(frozen=True)
class ShadowDecision:
    selected: Optional[ExecutionCandidate]
    frontier: tuple[ExecutionCandidate, ...]
    evaluations: tuple[CandidateEvaluation, ...]


_PROVIDER_PRIORS: dict[str, dict[str, float | bool]] = {
    "cow": {"settlement_probability": 0.995, "security_score": 0.90, "mev_protected": True},
    "jito": {"settlement_probability": 0.990, "security_score": 0.85, "mev_protected": True},
    "jupiter": {"settlement_probability": 0.990, "security_score": 0.85, "mev_protected": False},
    "cctp": {"settlement_probability": 0.995, "security_score": 0.95, "mev_protected": False},
    "across": {"settlement_probability": 0.990, "security_score": 0.88, "mev_protected": False},
    "ccip": {"settlement_probability": 0.990, "security_score": 0.92, "mev_protected": False},
    "layerzero": {"settlement_probability": 0.985, "security_score": 0.82, "mev_protected": False},
    "wormhole": {"settlement_probability": 0.985, "security_score": 0.84, "mev_protected": False},
    "lifi": {"settlement_probability": 0.985, "security_score": 0.80, "mev_protected": False},
    "socket": {"settlement_probability": 0.985, "security_score": 0.80, "mev_protected": False},
    "zerox": {"settlement_probability": 0.990, "security_score": 0.85, "mev_protected": False},
    "0x": {"settlement_probability": 0.990, "security_score": 0.85, "mev_protected": False},
    "okx_dex": {"settlement_probability": 0.990, "security_score": 0.82, "mev_protected": False},
    "sunswap": {"settlement_probability": 0.990, "security_score": 0.82, "mev_protected": False},
    "tempo_dex": {"settlement_probability": 0.995, "security_score": 0.90, "mev_protected": False},
}


def candidate_from_swap_quote(quote: Any) -> ExecutionCandidate:
    provider = str(getattr(quote, "provider", "unknown")).lower()
    prior = _PROVIDER_PRIORS.get(
        provider,
        {"settlement_probability": 0.97, "security_score": 0.70, "mev_protected": False},
    )
    raw = getattr(quote, "raw_quote", {}) or {}

    timestamp = getattr(quote, "timestamp", None) or datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    expected_output = float(getattr(quote, "to_amount_human", 0.0) or 0.0)
    guaranteed = raw.get("guaranteed_min_output_human", expected_output)

    return ExecutionCandidate(
        provider=provider,
        from_chain=str(getattr(quote, "from_chain", "")),
        to_chain=str(getattr(quote, "to_chain", "")),
        from_token=str(getattr(quote, "from_token", "")),
        to_token=str(getattr(quote, "to_token", "")),
        from_amount_human=float(getattr(quote, "from_amount_human", 0.0) or 0.0),
        expected_output=expected_output,
        guaranteed_min_output=float(guaranteed),
        gas_cost_usd=max(0.0, float(getattr(quote, "gas_cost_usd", 0.0) or 0.0)),
        fee_cost_usd=max(0.0, float(getattr(quote, "fee_cost_usd", 0.0) or 0.0)),
        total_cost_usd=max(0.0, float(getattr(quote, "total_cost_usd", 0.0) or 0.0)),
        expected_latency_seconds=max(0.0, float(getattr(quote, "estimated_time", 0.0) or 0.0)),
        price_impact=max(0.0, float(getattr(quote, "price_impact", 0.0) or 0.0)),
        settlement_probability=min(
            1.0, max(0.0, float(raw.get("settlement_probability", prior["settlement_probability"])))
        ),
        security_score=min(
            1.0, max(0.0, float(raw.get("security_score", prior["security_score"])))
        ),
        mev_protected=bool(raw.get("mev_protected", prior["mev_protected"])),
        quote_timestamp=timestamp,
        expires_in_seconds=max(0, int(getattr(quote, "expires_in", 30) or 0)),
        raw_quote=raw,
    )


def validate_candidate(
    candidate: ExecutionCandidate, intent: ExecutionIntent, *, now: Optional[datetime] = None
) -> tuple[ConstraintViolation, ...]:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    violations: list[ConstraintViolation] = []
    if now > candidate.expires_at:
        violations.append(ConstraintViolation("stale_quote", "quote expired before optimization"))
    if candidate.guaranteed_min_output < intent.min_output:
        violations.append(ConstraintViolation("min_output", "guaranteed output below user minimum"))
    if (
        intent.max_total_cost_usd is not None
        and candidate.total_cost_usd > intent.max_total_cost_usd
    ):
        violations.append(
            ConstraintViolation("max_cost", "total execution cost exceeds user maximum")
        )
    if (
        intent.max_latency_seconds is not None
        and candidate.expected_latency_seconds > intent.max_latency_seconds
    ):
        violations.append(
            ConstraintViolation("max_latency", "expected latency exceeds user maximum")
        )
    if candidate.settlement_probability < intent.min_settlement_probability:
        violations.append(
            ConstraintViolation("settlement_probability", "settlement probability below minimum")
        )
    if candidate.security_score < intent.min_security_score:
        violations.append(ConstraintViolation("security", "security score below minimum"))
    if intent.max_price_impact is not None and candidate.price_impact > intent.max_price_impact:
        violations.append(ConstraintViolation("price_impact", "price impact exceeds maximum"))
    if intent.require_mev_protection and not candidate.mev_protected:
        violations.append(ConstraintViolation("mev_policy", "MEV protection is required"))
    if intent.allowed_providers and candidate.provider not in intent.allowed_providers:
        violations.append(
            ConstraintViolation("provider_not_allowed", "provider is outside allow-list")
        )
    if candidate.provider in intent.forbidden_providers:
        violations.append(ConstraintViolation("provider_forbidden", "provider is forbidden"))
    return tuple(violations)


def expected_utility(
    candidate: ExecutionCandidate, weights: UtilityWeights = UtilityWeights()
) -> float:
    return (
        candidate.expected_output
        - weights.usd_cost_penalty * candidate.total_cost_usd
        - weights.latency_penalty_per_second * candidate.expected_latency_seconds
        - weights.failure_penalty * (1.0 - candidate.settlement_probability)
        - weights.security_penalty * (1.0 - candidate.security_score)
        - weights.mev_penalty * (0.0 if candidate.mev_protected else 1.0)
        - weights.price_impact_penalty * candidate.price_impact
    )


def _dominates(a: ExecutionCandidate, b: ExecutionCandidate) -> bool:
    am = (
        a.expected_output,
        -a.total_cost_usd,
        -a.expected_latency_seconds,
        a.settlement_probability,
        a.security_score,
        -a.price_impact,
    )
    bm = (
        b.expected_output,
        -b.total_cost_usd,
        -b.expected_latency_seconds,
        b.settlement_probability,
        b.security_score,
        -b.price_impact,
    )
    return all(x >= y for x, y in zip(am, bm)) and any(x > y for x, y in zip(am, bm))


def pareto_frontier(candidates: Sequence[ExecutionCandidate]) -> tuple[ExecutionCandidate, ...]:
    return tuple(
        c for c in candidates if not any(_dominates(o, c) for o in candidates if o is not c)
    )


def optimize(
    candidates: Iterable[ExecutionCandidate],
    intent: ExecutionIntent,
    *,
    weights: UtilityWeights = UtilityWeights(),
    now: Optional[datetime] = None,
) -> ShadowDecision:
    evaluations: list[CandidateEvaluation] = []
    feasible: list[ExecutionCandidate] = []
    for candidate in candidates:
        violations = validate_candidate(candidate, intent, now=now)
        utility = -math.inf if violations else expected_utility(candidate, weights)
        evaluations.append(CandidateEvaluation(candidate, not violations, violations, utility))
        if not violations:
            feasible.append(candidate)
    frontier = pareto_frontier(feasible)
    selected = max(frontier, key=lambda c: expected_utility(c, weights), default=None)
    return ShadowDecision(selected, frontier, tuple(evaluations))


def evaluate_swap_quotes_shadow(
    quotes: Iterable[Any], *, now: Optional[datetime] = None
) -> ShadowDecision:
    return optimize(tuple(candidate_from_swap_quote(q) for q in quotes), ExecutionIntent(), now=now)


def shadow_event(
    *, production_provider: str, production_output: float, decision: ShadowDecision
) -> dict[str, Any]:
    selected = decision.selected
    return {
        "event": "execution_sync_shadow_decision",
        "production_provider": production_provider,
        "production_output": production_output,
        "shadow_provider": selected.provider if selected else None,
        "shadow_expected_output": selected.expected_output if selected else None,
        "candidate_count": len(decision.evaluations),
        "feasible_count": sum(1 for e in decision.evaluations if e.feasible),
        "frontier_count": len(decision.frontier),
        "candidates": [
            {
                "provider": e.candidate.provider,
                "expected_output": e.candidate.expected_output,
                "total_cost_usd": e.candidate.total_cost_usd,
                "latency_seconds": e.candidate.expected_latency_seconds,
                "settlement_probability": e.candidate.settlement_probability,
                "security_score": e.candidate.security_score,
                "mev_protected": e.candidate.mev_protected,
                "feasible": e.feasible,
                "violations": [v.code for v in e.violations],
                "utility": None if math.isinf(e.utility) else e.utility,
            }
            for e in decision.evaluations
        ],
    }
