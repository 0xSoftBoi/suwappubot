"""L4 deterministic replay engine with continuous checkpoint validation (W1.2/W1.3).

Replays the canonical event stream against a snapshot anchor, hashing reconstructed
state against ground truth every N events and halting on the first divergence past a
stated epsilon.

Checkpointing continuously rather than comparing totals at the end is the whole design:
an end-of-run total says something is wrong somewhere in the stream, a checkpoint every
100 events says which event broke it.

Money is carried in ``Decimal`` throughout (see ``bot/utils/money``); the only floats in
this file are the ones SQLAlchemy hands back from ``Float`` columns, and they are
converted at the boundary.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Callable, Optional, Sequence

from scripts.replay._money import q_points, q_usd
from scripts.replay.canonical import CanonicalEvent

# Default cadence and tolerance. Both are deliberately explicit rather than inferred:
# the acceptance number is a claim we publish, per the plan's W1.5.
DEFAULT_CHECKPOINT_EVERY = 100
DEFAULT_EPSILON = Decimal("0.01")


@dataclass
class AccountState:
    """Reconstructed per-user state at an event boundary."""

    user_id: int
    volume_usd: Decimal = Decimal(0)
    fees_accrued_usd: Decimal = Decimal(0)
    fees_swept_usd: Decimal = Decimal(0)
    referral_usd: Decimal = Decimal(0)
    spend_usd: Decimal = Decimal(0)
    points_earned: Decimal = Decimal(0)
    points_spent: Decimal = Decimal(0)
    swaps: int = 0
    events: int = 0

    @property
    def points_balance(self) -> Decimal:
        return q_points(self.points_earned - self.points_spent)

    @property
    def fees_outstanding_usd(self) -> Decimal:
        return q_usd(self.fees_accrued_usd - self.fees_swept_usd)

    def digest(self) -> str:
        payload = "|".join(
            format(v, "f")
            for v in (
                self.volume_usd,
                self.fees_accrued_usd,
                self.fees_swept_usd,
                self.referral_usd,
                self.spend_usd,
                self.points_earned,
                self.points_spent,
            )
        )
        return f"{self.user_id}:{payload}:{self.swaps}"


@dataclass
class Divergence:
    """One reconstructed-vs-ground-truth mismatch."""

    checkpoint: int
    event_index: int
    user_id: int
    metric: str
    reconstructed: Decimal
    observed: Decimal
    event_digest: str

    @property
    def delta(self) -> Decimal:
        return abs(self.reconstructed - self.observed)

    def describe(self) -> str:
        return (
            f"checkpoint {self.checkpoint} (event {self.event_index}) "
            f"user {self.user_id} {self.metric}: "
            f"reconstructed={self.reconstructed} observed={self.observed} "
            f"delta={self.delta} last_event={self.event_digest}"
        )


@dataclass
class Checkpoint:
    index: int
    event_index: int
    ts: Optional[datetime]
    state_hash: str
    accounts_compared: int
    max_delta: Decimal
    divergences: list[Divergence] = field(default_factory=list)


@dataclass
class ReplayReport:
    events_processed: int = 0
    accounts_touched: int = 0
    checkpoints: list[Checkpoint] = field(default_factory=list)
    divergences: list[Divergence] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    halted_at: Optional[int] = None
    max_delta: Decimal = Decimal(0)
    events_per_second: float = 0.0
    final_state_hash: str = ""

    @property
    def ok(self) -> bool:
        return not self.divergences and self.halted_at is None

    def summary(self) -> str:
        verdict = "PASS" if self.ok else "FAIL"
        return (
            f"{verdict} - {self.events_processed} events, "
            f"{self.accounts_touched} accounts, "
            f"{len(self.checkpoints)} checkpoints, "
            f"max divergence {self.max_delta}, "
            f"{self.events_per_second:.0f} events/sec"
        )


# --- Snapshot (L2) --------------------------------------------------------------------

_POINTS_SNAPSHOT_SQL = """
    SELECT user_id, total_points_earned, points_spent, current_points,
           total_swaps, total_volume_usd
      FROM user_points
"""


_OPENING_POINTS_SQL = """
    SELECT user_id,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)  AS earned,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS spent
      FROM point_transactions
     WHERE created_at < :start
     GROUP BY user_id
"""


def load_points_snapshot(conn) -> dict[int, dict[str, Decimal]]:
    """L2 anchor: the aggregates production maintains incrementally.

    These are exactly the rows a replay is meant to check. If the running system's
    incremental accounting has drifted from the event log, this is where it surfaces.

    Note the semantics: these columns are **lifetime cumulative**, not point-in-time.
    A windowed replay is therefore only comparable to them once the window's opening
    balances have been loaded via :func:`load_opening_balances` - reconstructed
    (opening + window delta) against observed (lifetime). Comparing a one-day
    reconstruction directly against a lifetime aggregate diverges for every account
    with any prior history, which is a measurement error, not a ledger bug.
    """
    from sqlalchemy import text

    snapshot: dict[int, dict[str, Decimal]] = {}
    for row in conn.execute(text(_POINTS_SNAPSHOT_SQL)):
        m = row._mapping
        snapshot[int(m["user_id"])] = {
            "points_earned": q_points(m["total_points_earned"] or 0),
            "points_spent": q_points(m["points_spent"] or 0),
            "points_balance": q_points(m["current_points"] or 0),
            "swaps": Decimal(int(m["total_swaps"] or 0)),
            "volume_usd": q_usd(m["total_volume_usd"] or 0),
        }
    return snapshot


def load_opening_balances(conn, start: datetime) -> dict[int, dict[str, Decimal]]:
    """Reconstruct the point-in-time opening state at ``start`` from the event log.

    We keep no historical point-in-time aggregate, so the opening state is derived by
    folding every event before the window: the same object, computed rather than stored,
    with the side effect of exercising the summation path over the full history.
    """
    from sqlalchemy import text

    opening: dict[int, dict[str, Decimal]] = {}
    for row in conn.execute(text(_OPENING_POINTS_SQL), {"start": start}):
        m = row._mapping
        opening[int(m["user_id"])] = {
            "points_earned": q_points(m["earned"] or 0),
            "points_spent": q_points(m["spent"] or 0),
        }
    return opening


# --- Engine ---------------------------------------------------------------------------


class ReplayEngine:
    """Replays canonical events and validates against a snapshot as it goes."""

    def __init__(
        self,
        *,
        snapshot: Optional[dict[int, dict[str, Decimal]]] = None,
        opening: Optional[dict[int, dict[str, Decimal]]] = None,
        finalized_at: Optional[dict[int, int]] = None,
        checkpoint_every: int = DEFAULT_CHECKPOINT_EVERY,
        epsilon: Decimal = DEFAULT_EPSILON,
        halt_on_divergence: bool = True,
        metrics: Sequence[str] = ("points_earned", "points_spent"),
    ) -> None:
        self.snapshot = snapshot or {}
        self.opening = opening or {}
        # user_id -> index of that user's last event in the stream. An account is only
        # comparable to a lifetime aggregate once every one of its window events has
        # been applied; checking it earlier reports a divergence that is really just
        # "the replay has not finished with this user yet".
        self.finalized_at = finalized_at or {}
        self.checkpoint_every = max(1, int(checkpoint_every))
        self.epsilon = Decimal(epsilon)
        self.halt_on_divergence = halt_on_divergence
        self.metrics = tuple(metrics)
        self.states: dict[int, AccountState] = {}
        self._validated: set[int] = set()

    def _seed(self, user_id: int) -> AccountState:
        """New account state, pre-loaded with the opening balance at window start."""
        state = AccountState(user_id=user_id)
        opening = self.opening.get(user_id)
        if opening:
            state.points_earned = q_points(opening.get("points_earned", 0))
            state.points_spent = q_points(opening.get("points_spent", 0))
            state.volume_usd = q_usd(opening.get("volume_usd", 0))
        return state

    # -- state transitions ------------------------------------------------------------
    #
    # One handler per event kind, and an explicit failure for anything unhandled.
    # A silently skipped category does not cause a local error, it shifts every
    # subsequent balance, so an unknown kind must be loud rather than a no-op.

    def apply(self, event: CanonicalEvent) -> AccountState:
        state = self.states.get(event.user_id)
        if state is None:
            state = self._seed(event.user_id)
            self.states[event.user_id] = state

        kind = event.kind
        if kind == "swap_settled":
            state.volume_usd = q_usd(state.volume_usd + event.usd)
            state.swaps += 1
        elif kind == "fee_accrued":
            state.fees_accrued_usd = q_usd(state.fees_accrued_usd + event.usd)
        elif kind == "fee_swept":
            # A swept fee was accrued first; production writes one row that flips a flag,
            # so a sweep implies its own accrual.
            state.fees_accrued_usd = q_usd(state.fees_accrued_usd + event.usd)
            state.fees_swept_usd = q_usd(state.fees_swept_usd + event.usd)
        elif kind == "referral_earned":
            state.referral_usd = q_usd(state.referral_usd + event.usd)
        elif kind == "points_awarded":
            state.points_earned = q_points(state.points_earned + event.points)
        elif kind == "points_spent":
            state.points_spent = q_points(state.points_spent + abs(event.points))
        elif kind in ("spend_recorded", "withdrawal"):
            state.spend_usd = q_usd(state.spend_usd + event.usd)
        else:
            raise UnhandledEventKind(
                f"no state transition for event kind {kind!r} "
                f"({event.source_table}#{event.source_id}); add one rather than skipping it"
            )

        state.events += 1
        return state

    # -- validation -------------------------------------------------------------------

    def state_hash(self) -> str:
        """Hash of the whole reconstructed state, users in ascending order."""
        h = hashlib.sha256()
        for user_id in sorted(self.states):
            h.update(self.states[user_id].digest().encode())
        return h.hexdigest()[:32]

    def _observed(self, user_id: int, metric: str) -> Optional[Decimal]:
        row = self.snapshot.get(user_id)
        if row is None:
            return None
        return row.get(metric)

    def _reconstructed(self, state: AccountState, metric: str) -> Decimal:
        return {
            "points_earned": state.points_earned,
            "points_spent": state.points_spent,
            "points_balance": state.points_balance,
            "volume_usd": state.volume_usd,
            "swaps": Decimal(state.swaps),
            "fees_accrued_usd": state.fees_accrued_usd,
        }[metric]

    def checkpoint(
        self, index: int, event_index: int, event: Optional[CanonicalEvent]
    ) -> Checkpoint:
        cp = Checkpoint(
            index=index,
            event_index=event_index,
            ts=event.ts if event else None,
            state_hash=self.state_hash(),
            accounts_compared=0,
            max_delta=Decimal(0),
        )
        if not self.snapshot:
            return cp

        for user_id, state in self.states.items():
            if user_id not in self.snapshot:
                continue
            # Only compare accounts the replay has finished with. `finalized_at` is
            # empty on the last checkpoint, where every account is by definition final.
            last_index = self.finalized_at.get(user_id)
            if last_index is not None and last_index > event_index:
                continue
            if user_id in self._validated:
                continue
            self._validated.add(user_id)
            cp.accounts_compared += 1
            for metric in self.metrics:
                observed = self._observed(user_id, metric)
                if observed is None:
                    continue
                reconstructed = self._reconstructed(state, metric)
                delta = abs(reconstructed - observed)
                if delta > cp.max_delta:
                    cp.max_delta = delta
                if delta > self.epsilon:
                    cp.divergences.append(
                        Divergence(
                            checkpoint=index,
                            event_index=event_index,
                            user_id=user_id,
                            metric=metric,
                            reconstructed=reconstructed,
                            observed=observed,
                            event_digest=event.digest() if event else "",
                        )
                    )
        return cp


class UnhandledEventKind(RuntimeError):
    """An event kind with no state transition. Never swallow this."""


def replay(
    events: Sequence[CanonicalEvent],
    *,
    snapshot: Optional[dict[int, dict[str, Decimal]]] = None,
    opening: Optional[dict[int, dict[str, Decimal]]] = None,
    checkpoint_every: int = DEFAULT_CHECKPOINT_EVERY,
    epsilon: Decimal = DEFAULT_EPSILON,
    halt_on_divergence: bool = True,
    metrics: Sequence[str] = ("points_earned", "points_spent"),
    progress: Optional[Callable[[int, int], None]] = None,
) -> tuple[ReplayEngine, ReplayReport]:
    """Replay ``events``, checkpointing against ``snapshot``.

    Checkpoints run only at the *end* of the stream when no snapshot is supplied, since
    there is nothing to compare against; the state hash is still produced so two runs
    can be diffed against each other.
    """
    import time

    # Index of each account's final event, so a checkpoint can validate an account the
    # moment the replay is done with it rather than waiting for the end of the stream.
    finalized_at: dict[int, int] = {}
    for i, event in enumerate(events, start=1):
        finalized_at[event.user_id] = i

    engine = ReplayEngine(
        snapshot=snapshot,
        opening=opening,
        finalized_at=finalized_at,
        checkpoint_every=checkpoint_every,
        epsilon=epsilon,
        halt_on_divergence=halt_on_divergence,
        metrics=metrics,
    )
    report = ReplayReport()
    started = time.perf_counter()
    checkpoint_index = 0

    for i, event in enumerate(events, start=1):
        engine.apply(event)
        report.events_processed = i
        if progress and i % 5000 == 0:
            progress(i, len(events))

        if i % engine.checkpoint_every == 0:
            checkpoint_index += 1
            cp = engine.checkpoint(checkpoint_index, i, event)
            report.checkpoints.append(cp)
            if cp.max_delta > report.max_delta:
                report.max_delta = cp.max_delta
            if cp.divergences:
                report.divergences.extend(cp.divergences)
                if halt_on_divergence:
                    report.halted_at = i
                    break

    # Final checkpoint always runs, even mid-cadence.
    if report.halted_at is None:
        checkpoint_index += 1
        cp = engine.checkpoint(
            checkpoint_index,
            report.events_processed,
            events[report.events_processed - 1] if report.events_processed else None,
        )
        report.checkpoints.append(cp)
        if cp.max_delta > report.max_delta:
            report.max_delta = cp.max_delta
        report.divergences.extend(cp.divergences)

    elapsed = max(time.perf_counter() - started, 1e-9)
    report.events_per_second = report.events_processed / elapsed
    report.accounts_touched = len(engine.states)
    report.final_state_hash = engine.state_hash()
    return engine, report


__all__ = [
    "AccountState",
    "Checkpoint",
    "Divergence",
    "ReplayEngine",
    "ReplayReport",
    "UnhandledEventKind",
    "DEFAULT_CHECKPOINT_EVERY",
    "DEFAULT_EPSILON",
    "load_points_snapshot",
    "replay",
]
