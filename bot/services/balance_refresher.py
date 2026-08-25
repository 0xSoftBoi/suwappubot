"""Background service to keep balance cache warm for active wallets."""

import asyncio
import logging
import time
from typing import Optional, Set

from bot.models.user import Wallet
from bot.services.wallet import WalletService
from database.db import get_session

logger = logging.getLogger(__name__)


# How long one refresh pass may run before the supervisor retires it. This is
# generous on purpose: now that the beat no longer waits on the pass, the
# budget only has to bound resource use, not protect liveness. It used to be
# pinned under the 300s staleness threshold, which forced a slow-but-healthy
# pass to be killed just to keep the service from reading as dead.
_PASS_BUDGET_SECONDS = 600
# One batch of BATCH_SIZE wallets.
_BATCH_BUDGET_SECONDS = 30
# Grace before the first pass, so the loop is not competing with the rest of
# startup. Must stay well under the staleness threshold: nothing beats until
# this elapses, so a long warmup would read as a dead service on every boot.
_WARMUP_SECONDS = 30
# Beat cadence. Deliberately decoupled from _refresh_interval: liveness is a
# property of the supervisor, not of how long a pass happens to take.
_HEARTBEAT_INTERVAL_SECONDS = 30
# Must be >= the balance_refresher staleness threshold in api/main.py, or the
# key evicts before /health can ever see it as stale (it would read "dead"
# because the key is missing, which is the same word for a different fault).
_HEARTBEAT_TTL_SECONDS = 300
# How long a cancelled pass gets to actually die before we stop waiting on it.
_CANCEL_GRACE_SECONDS = 15
# Abandoned (cancelled but still running) passes tolerated before we stop
# starting new ones. Each one may still be holding RPC sockets.
_MAX_ABANDONED_PASSES = 3
# TTL on the "a pass completed" marker. Only needs to outlive the /health
# stall threshold; see SERVICE_PASS_STALL_SECONDS in api/main.py.
_LAST_PASS_TTL_SECONDS = 3600

_HEARTBEAT_KEY = "service:balance_refresher:heartbeat"
_LAST_PASS_KEY = "service:balance_refresher:last_pass"


class BalanceRefresher:
    """Periodically refreshes balance cache for all active wallets.

    The refresh work runs in its own task, supervised by a loop that does
    nothing but beat and police the budget. That separation is the whole point:
    a pass that ignores cancellation used to take the liveness signal down with
    it, because the loop was *awaiting* the pass when it wedged.

    Three production incidents, same shape. First the heartbeat was written
    after the work with a TTL shorter than a cycle, so the key expired between
    beats. Then the pass was bounded with `asyncio.wait_for`, which cancels and
    then *awaits* the cancellation — so a child stuck in an uncancellable RPC
    read left `wait_for` waiting forever, no TimeoutError, no beat, no log, for
    hours. Every bound built out of `wait_for` inherits that flaw. So: the
    supervisor never awaits the pass, and a pass that refuses to die is
    abandoned rather than waited on.
    """

    def __init__(self, refresh_interval: int = 60):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._refresh_interval = refresh_interval
        self._wallet_service = WalletService()
        # Cancelled passes that have not yet honoured the cancellation. Held
        # only so they can be counted and so their exceptions are retrieved.
        self._abandoned: Set[asyncio.Task] = set()
        logger.info(f"Balance refresher initialized (interval: {refresh_interval}s)")

    async def start(self):
        """Start the background refresh service."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._refresh_loop())
        logger.info("Balance refresher started")

    async def stop(self):
        """Stop the background refresh service."""
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
        logger.info("Balance refresher stopped")

    # -- liveness ----------------------------------------------------------

    async def _beat(self):
        """Publish the liveness heartbeat.

        Written by the supervisor and nothing else, so it answers exactly one
        question: is this loop still turning? Whether the *work* is making
        progress is a separate signal (_LAST_PASS_KEY) precisely so a wedged
        pass cannot hide behind a healthy loop, nor a healthy loop be reported
        dead because of a slow pass.
        """
        from bot.utils.redis_cache import redis_cache

        await redis_cache.set(_HEARTBEAT_KEY, time.time(), ttl_seconds=_HEARTBEAT_TTL_SECONDS)

    async def _mark_pass_complete(self):
        """Record that a refresh pass ran to completion."""
        from bot.utils.redis_cache import redis_cache

        await redis_cache.set(_LAST_PASS_KEY, time.time(), ttl_seconds=_LAST_PASS_TTL_SECONDS)

    # -- pass lifecycle ----------------------------------------------------

    def _reap(self, task: asyncio.Task):
        """Retrieve a finished pass's outcome so it is never a silent failure."""
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error(f"Balance refresh error: {exc}")

    async def _retire(self, task: asyncio.Task) -> None:
        """Cancel an over-budget pass, but never block on it.

        `asyncio.wait` returns when the grace elapses whether or not the task
        honoured the cancellation. That is the difference from `wait_for`,
        which awaits the cancellation and therefore hangs forever on a task
        that will not die — the exact production wedge this service hit.
        """
        task.cancel()
        _, pending = await asyncio.wait({task}, timeout=_CANCEL_GRACE_SECONDS)
        if pending:
            self._abandoned.add(task)
            task.add_done_callback(self._abandoned.discard)
            logger.error(
                "Balance refresh pass exceeded %ss and did not honour cancellation; "
                "abandoning it (%d abandoned). The loop continues and keeps beating.",
                _PASS_BUDGET_SECONDS,
                len(self._abandoned),
            )
        else:
            logger.warning(
                "Balance refresh pass exceeded %ss and was cancelled; "
                "the loop continues and will beat again",
                _PASS_BUDGET_SECONDS,
            )
            self._reap(task)

    async def _refresh_loop(self):
        """Supervise refresh passes and beat regardless of what they do.

        The only awaits here are the beat and the inter-tick sleep. Neither can
        be blocked by refresh work, which is what keeps the liveness signal
        honest when a pass goes bad.
        """
        await asyncio.sleep(_WARMUP_SECONDS)

        pass_task: Optional[asyncio.Task] = None
        pass_started = 0.0
        next_pass_at = 0.0

        try:
            while self._running:
                try:
                    await self._beat()

                    now = time.monotonic()

                    if pass_task is not None and pass_task.done():
                        if not pass_task.cancelled() and pass_task.exception() is None:
                            await self._mark_pass_complete()
                        self._reap(pass_task)
                        pass_task = None
                        next_pass_at = now + self._refresh_interval

                    if pass_task is not None and now - pass_started > _PASS_BUDGET_SECONDS:
                        await self._retire(pass_task)
                        pass_task = None
                        next_pass_at = time.monotonic() + self._refresh_interval

                    if pass_task is None and now >= next_pass_at:
                        if len(self._abandoned) >= _MAX_ABANDONED_PASSES:
                            # Piling more work on top of wedged passes only
                            # burns sockets. Keep beating — the loop really is
                            # alive — and let the stale _LAST_PASS_KEY tell
                            # /health the work is not getting done.
                            logger.error(
                                "Balance refresher not starting a new pass: %d abandoned "
                                "passes are still running",
                                len(self._abandoned),
                            )
                        else:
                            pass_task = asyncio.create_task(self._refresh_all())
                            pass_started = now
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.error(f"Balance refresh error: {e}")

                if not self._running:
                    break
                await asyncio.sleep(_HEARTBEAT_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return
        finally:
            if pass_task is not None and not pass_task.done():
                pass_task.cancel()

    async def _refresh_all(self):
        """Refresh balances for all active wallets, one batch at a time."""
        if not self._running:
            return

        from bot.services.alchemy_client import alchemy_circuit

        if alchemy_circuit.is_open:
            logger.debug("Skipping balance refresh — Alchemy circuit breaker is open")
            return

        # Get all unique (address, chain_type) pairs from active wallets
        seen: set[tuple[str, str]] = set()
        targets: list[tuple[str, str]] = []

        with get_session() as session:
            wallets = (
                session.query(Wallet.address, Wallet.chain_type)
                .filter(
                    Wallet.is_active == True,  # noqa: E712
                )
                .all()
            )

            for address, chain_type in wallets:
                key = (address, chain_type)
                if key not in seen:
                    seen.add(key)
                    targets.append(key)

        if not targets:
            return

        logger.debug(f"Refreshing balances for {len(targets)} unique wallets")

        # Refresh wallets in small batches to balance throughput vs event loop fairness
        BATCH_SIZE = 5
        for i in range(0, len(targets), BATCH_SIZE):
            if not self._running:
                return
            batch = targets[i : i + BATCH_SIZE]  # noqa: E203
            tasks = [
                asyncio.create_task(self._safe_refresh(address, chain_type))
                for address, chain_type in batch
            ]
            # asyncio.wait, not wait_for(gather(...)): gather waits for the
            # SLOWEST member, and wait_for would then await that member's
            # cancellation. One provider that accepts the connection and never
            # answers is enough to make that await permanent. `wait` returns on
            # the deadline no matter what the stragglers do.
            _, pending = await asyncio.wait(tasks, timeout=_BATCH_BUDGET_SECONDS)
            for task in pending:
                task.cancel()
                # Never awaited, so retrieve the outcome via callback instead —
                # otherwise a straggler that fails logs "exception was never
                # retrieved" noise on shutdown.
                task.add_done_callback(_swallow)
            if pending:
                logger.debug("Balance refresh batch timed out; continuing with the next batch")
            # Pause between batches to yield control to user-facing requests
            await asyncio.sleep(1)

    async def _safe_refresh(self, address: str, chain_type: str):
        """Refresh a single wallet's balance, swallowing errors."""
        try:
            await self._wallet_service.get_balances_by_address(address, chain_type)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"Failed to refresh {address} ({chain_type}): {e}")


def _swallow(task: asyncio.Task):
    """Retrieve a cancelled straggler's outcome without acting on it."""
    if task.cancelled():
        return
    task.exception()


# Global instance
balance_refresher = BalanceRefresher()
