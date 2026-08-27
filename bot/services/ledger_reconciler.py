"""Nightly money-path reconciliation (completes W1.3).

`scripts/replay/` can rebuild per-user money state from the canonical event stream and
compare it against the aggregates production maintains incrementally. That is only worth
building if something actually runs it. This is that something: a background task that
replays yesterday's window once a day and tells an admin when the reconstruction and the
ledger disagree by more than the stated epsilon.

Tektonic's checkpoint discipline is the point. Their reconstruction held maximum
divergence below $0.01 across 437,723 accounts at 847 checkpoints, and it held because
divergence was checked continuously against ground truth rather than asserted at the end.
An incremental counter that has drifted does not announce itself; the only way to find out
is to recompute from the events and compare.

**Alert channel.** The plan said "alerts through `alert_service`", which was wrong:
`alert_service` is the user-facing *price* alert service. Reconciliation failure is an
operational event, so it goes where `health_monitor` sends its alerts -
`support_notifier.post_admin_update`, which reaches the support group and every admin.

Failure policy: this service must never take the bot down. A reconciliation run that
raises is logged and retried on the next cycle; a run that finds divergence alerts and
keeps going. Silence from this service means either "clean" or "broken", so it also
reports a clean run at a low frequency rather than being permanently mute (see
`_maybe_report_clean`).
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)

# The replay lives under scripts/ rather than bot/ because it must also run standalone,
# anywhere a DATABASE_URL does, without importing the bot package.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

DEFAULT_INTERVAL_SECONDS = 24 * 60 * 60
DEFAULT_WINDOW_DAYS = 1
# The published acceptance number, recorded in docs/DECISIONS.md.
DEFAULT_EPSILON = Decimal("0.01")
# Alerting on every divergent account would page someone with 400 lines. Cap it.
MAX_ALERTED_DIVERGENCES = 8
# Report a clean run roughly weekly, so prolonged silence is distinguishable from a
# service that died. Same reasoning as the health monitor's dead-man's switch.
CLEAN_REPORT_EVERY = 7


class LedgerReconciler:
    """Replays the money-path event stream nightly and alerts on divergence."""

    def __init__(self) -> None:
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._bot = None
        self._interval = DEFAULT_INTERVAL_SECONDS
        self._window_days = DEFAULT_WINDOW_DAYS
        self._epsilon = DEFAULT_EPSILON
        self._clean_runs_since_report = 0
        self.last_run_at: Optional[datetime] = None
        self.last_result: Optional[str] = None
        self.last_max_delta: Optional[str] = None

    async def start(
        self,
        bot=None,
        interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
        window_days: int = DEFAULT_WINDOW_DAYS,
        epsilon: Decimal = DEFAULT_EPSILON,
    ) -> None:
        if self._running:
            return
        self._running = True
        self._bot = bot
        self._interval = max(300, int(interval_seconds))
        self._window_days = max(1, int(window_days))
        self._epsilon = Decimal(epsilon)
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "Ledger reconciler started (every %ss, %sd window, epsilon %s)",
            self._interval,
            self._window_days,
            self._epsilon,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                logger.debug("Ledger reconciler cancelled during stop()")
        logger.info("Ledger reconciler stopped")

    async def _loop(self) -> None:
        # Stagger the first run: startup is the worst time to add a full-window replay
        # on top of every other service's initialisation.
        await asyncio.sleep(120)
        while self._running:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - must never kill the loop
                logger.error("Ledger reconciliation failed: %s", exc, exc_info=True)
                self.last_result = f"error: {exc}"
            await asyncio.sleep(self._interval)

    async def run_once(self) -> dict:
        """Replay one window. Returns a small summary dict; never raises for divergence."""
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=self._window_days)

        # The replay is CPU-bound and synchronous (SQLAlchemy Core + arithmetic). Off the
        # event loop, or a large window blocks every handler for the duration.
        report = await asyncio.to_thread(self._replay_sync, start, end)
        self.last_run_at = end
        self.last_max_delta = str(report["max_delta"])

        if report["ok"]:
            self.last_result = "clean"
            self._clean_runs_since_report += 1
            logger.info(
                "Ledger reconciliation clean: %s events, %s accounts, %s checkpoints, "
                "max delta %s",
                report["events"],
                report["accounts"],
                report["checkpoints"],
                report["max_delta"],
            )
            await self._maybe_report_clean(report)
        else:
            self.last_result = "diverged"
            self._clean_runs_since_report = 0
            logger.error(
                "Ledger reconciliation DIVERGED: max delta %s over %s events",
                report["max_delta"],
                report["events"],
            )
            await self._alert_divergence(report, start, end)

        return report

    def _replay_sync(self, start: datetime, end: datetime) -> dict:
        """Synchronous replay body, run in a worker thread."""
        from sqlalchemy import create_engine

        from scripts.replay.canonical import build_canonical_stream, stream_digest
        from scripts.replay.engine import load_opening_balances, load_points_snapshot, replay

        from bot.config.settings import settings

        database_url = getattr(settings, "database_url", None) or os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("no database URL available for reconciliation")

        engine = create_engine(database_url, future=True)
        try:
            with engine.connect() as conn:
                events, warnings = build_canonical_stream(conn, start, end)
                snapshot = load_points_snapshot(conn)
                opening = load_opening_balances(conn, start)
        finally:
            engine.dispose()

        # Collect every divergence rather than halting: a nightly report that stops at the
        # first bad account tells you nothing about blast radius, and unlike an
        # interactive debugging run there is nobody here to re-run it with --no-halt.
        _, report = replay(
            events,
            snapshot=snapshot,
            opening=opening,
            epsilon=self._epsilon,
            halt_on_divergence=False,
        )

        return {
            "ok": report.ok,
            "events": report.events_processed,
            "accounts": report.accounts_touched,
            "checkpoints": len(report.checkpoints),
            "max_delta": report.max_delta,
            "events_per_second": round(report.events_per_second, 1),
            "stream_digest": stream_digest(events)[:16],
            "warnings": warnings,
            "divergences": [
                {
                    "user_id": dv.user_id,
                    "metric": dv.metric,
                    "reconstructed": str(dv.reconstructed),
                    "observed": str(dv.observed),
                    "delta": str(dv.delta),
                }
                for dv in report.divergences
            ],
        }

    async def _alert_divergence(self, report: dict, start: datetime, end: datetime) -> None:
        divergences = report["divergences"]
        lines = [
            "*Ledger reconciliation DIVERGED*",
            f"Window: {start:%Y-%m-%d %H:%M} to {end:%Y-%m-%d %H:%M} UTC",
            f"Events: {report['events']} across {report['accounts']} accounts",
            f"Max divergence: {report['max_delta']} (epsilon {self._epsilon})",
            f"Accounts affected: {len({d['user_id'] for d in divergences})}",
            "",
        ]
        for d in divergences[:MAX_ALERTED_DIVERGENCES]:
            lines.append(
                f"user {d['user_id']} {d['metric']}: "
                f"replay {d['reconstructed']} vs ledger {d['observed']} "
                f"(delta {d['delta']})"
            )
        if len(divergences) > MAX_ALERTED_DIVERGENCES:
            lines.append(f"... and {len(divergences) - MAX_ALERTED_DIVERGENCES} more")
        lines += [
            "",
            "Reproduce:",
            f"`python3 -m scripts.replay --start {start:%Y-%m-%d} "
            f"--end {end:%Y-%m-%d} --no-halt`",
        ]
        await self._notify("\n".join(lines))

    async def _maybe_report_clean(self, report: dict) -> None:
        """Prove the reconciler is alive, occasionally.

        A monitor that only ever speaks on failure is indistinguishable from a monitor
        that has been silently dead for a month.
        """
        if self._clean_runs_since_report < CLEAN_REPORT_EVERY:
            return
        self._clean_runs_since_report = 0
        await self._notify(
            "*Ledger reconciliation clean*\n"
            f"{CLEAN_REPORT_EVERY} consecutive clean runs. "
            f"Last: {report['events']} events, {report['accounts']} accounts, "
            f"max divergence {report['max_delta']}."
        )

    async def _notify(self, text: str) -> None:
        """Best-effort admin notification - must never crash the loop."""
        try:
            from bot.services.support_notifier import post_admin_update

            await post_admin_update(self._bot, text)
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to send reconciliation alert: %s", exc)

    def status(self) -> dict:
        """For /health and the admin status command."""
        return {
            "running": self._running,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "last_result": self.last_result,
            "last_max_delta": self.last_max_delta,
            "epsilon": str(self._epsilon),
            "window_days": self._window_days,
        }


ledger_reconciler = LedgerReconciler()
