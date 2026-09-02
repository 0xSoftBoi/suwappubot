"""Background service that periodically records total-portfolio-value snapshots.

Mirrors bot/services/balance_refresher.py's supervisor/pass split: the
supervisor loop only beats and polices a budget, it never awaits the
snapshot pass itself, so a wedged pass cannot take the liveness signal down
with it.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Set

from bot.config.settings import settings
from bot.models.user import User, Wallet
from database.db import get_session

logger = logging.getLogger(__name__)

# Generous budget so a slow pass is bounded without being killed mid-flight.
_PASS_BUDGET_SECONDS = 600
# One batch of BATCH_SIZE users.
_BATCH_BUDGET_SECONDS = 30
# Grace before the first pass so this doesn't compete with the rest of startup.
_WARMUP_SECONDS = 45
# Beat cadence, decoupled from the snapshot interval itself.
_HEARTBEAT_INTERVAL_SECONDS = 30
_CANCEL_GRACE_SECONDS = 15
_MAX_ABANDONED_PASSES = 3


class PortfolioSnapshotter:
    """Periodically snapshots total portfolio value for users with addressed wallets.

    Interval defaults to settings.portfolio_snapshot_interval_seconds (env
    PORTFOLIO_SNAPSHOT_INTERVAL_SECONDS, default 900s / 15 minutes). Every
    pass writes a 'refresh'-sourced bot.models.portfolio_snapshot.PortfolioValueSnapshot
    row per eligible user, with a per-user try/except so one bad wallet or RPC
    failure never stops the rest of the pass.
    """

    def __init__(self, snapshot_interval: Optional[int] = None):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._snapshot_interval = snapshot_interval or settings.portfolio_snapshot_interval_seconds
        self._abandoned: Set[asyncio.Task] = set()
        logger.info("Portfolio snapshotter initialized (interval: %ss)", self._snapshot_interval)

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Portfolio snapshotter started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        for task in list(self._abandoned):
            task.cancel()
        self._abandoned.clear()
        logger.info("Portfolio snapshotter stopped")

    def _reap(self, task: asyncio.Task):
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error(f"Portfolio snapshot pass error: {exc}")

    async def _retire(self, task: asyncio.Task) -> None:
        task.cancel()
        _, pending = await asyncio.wait({task}, timeout=_CANCEL_GRACE_SECONDS)
        if pending:
            self._abandoned.add(task)
            task.add_done_callback(self._abandoned.discard)
            logger.error(
                "Portfolio snapshot pass exceeded %ss and did not honour cancellation; "
                "abandoning it (%d abandoned)",
                _PASS_BUDGET_SECONDS,
                len(self._abandoned),
            )
        else:
            self._reap(task)

    async def _loop(self):
        await asyncio.sleep(_WARMUP_SECONDS)

        pass_task: Optional[asyncio.Task] = None
        pass_started = 0.0
        next_pass_at = 0.0

        try:
            while self._running:
                try:
                    now = time.monotonic()

                    if pass_task is not None and pass_task.done():
                        self._reap(pass_task)
                        pass_task = None
                        next_pass_at = now + self._snapshot_interval

                    if pass_task is not None and now - pass_started > _PASS_BUDGET_SECONDS:
                        await self._retire(pass_task)
                        pass_task = None
                        next_pass_at = time.monotonic() + self._snapshot_interval

                    if pass_task is None and now >= next_pass_at:
                        if len(self._abandoned) >= _MAX_ABANDONED_PASSES:
                            logger.error(
                                "Portfolio snapshotter not starting a new pass: %d abandoned "
                                "passes are still running",
                                len(self._abandoned),
                            )
                        else:
                            pass_task = asyncio.create_task(self._snapshot_all())
                            pass_started = now
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.error(f"Portfolio snapshotter loop error: {e}")

                if not self._running:
                    break
                await asyncio.sleep(_HEARTBEAT_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return
        finally:
            if pass_task is not None and not pass_task.done():
                pass_task.cancel()

    async def _snapshot_all(self):
        """Snapshot every user who has at least one active, addressed wallet."""
        if not self._running:
            return

        with get_session() as session:
            user_ids = [
                row[0]
                for row in (
                    session.query(Wallet.user_id)
                    .filter(
                        Wallet.is_active == True,  # noqa: E712
                        Wallet.address.isnot(None),
                        Wallet.address != "",
                    )
                    .distinct()
                    .all()
                )
            ]

        if not user_ids:
            return

        logger.debug("Snapshotting portfolios for %d users", len(user_ids))

        BATCH_SIZE = 5
        for i in range(0, len(user_ids), BATCH_SIZE):
            if not self._running:
                return
            batch = user_ids[i : i + BATCH_SIZE]  # noqa: E203
            tasks = [asyncio.create_task(self._safe_snapshot(user_id)) for user_id in batch]
            _, pending = await asyncio.wait(tasks, timeout=_BATCH_BUDGET_SECONDS)
            for task in pending:
                task.cancel()
                task.add_done_callback(_swallow)
            await asyncio.sleep(1)

    async def _safe_snapshot(self, user_id: int):
        """Compute and persist one user's portfolio snapshot, swallowing errors."""
        try:
            from api.webapp import build_portfolio_for_user
            from bot.models.portfolio_snapshot import PortfolioValueSnapshot

            with get_session() as session:
                user = session.query(User).filter(User.id == user_id).first()
                if not user:
                    return
                portfolio = await build_portfolio_for_user(user, session)
                session.add(
                    PortfolioValueSnapshot(
                        user_id=user_id,
                        total_usd=portfolio.totalUsdValue,
                        token_count=len(portfolio.tokens),
                        source="refresh",
                        captured_at=datetime.now(timezone.utc),
                    )
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"Failed to snapshot portfolio for user {user_id}: {e}")


def _swallow(task: asyncio.Task):
    if task.cancelled():
        return
    task.exception()


# Global instance
portfolio_snapshotter = PortfolioSnapshotter()
