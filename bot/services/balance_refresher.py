"""Background service to keep balance cache warm for active wallets."""

import asyncio
import logging
from typing import Optional

from bot.models.user import Wallet
from bot.services.wallet import WalletService
from database.db import get_session

logger = logging.getLogger(__name__)


# Whole-pass budget. Must stay BELOW the balance_refresher staleness threshold
# in api/main.py (300s) so a slow pass can never cost the service a heartbeat.
_PASS_BUDGET_SECONDS = 240
# One batch of BATCH_SIZE wallets.
_BATCH_BUDGET_SECONDS = 30
# Grace before the first pass, so the loop is not competing with the rest of
# startup. Must stay well under the staleness threshold: nothing beats until
# this elapses, so a long warmup would read as a dead service on every boot.
_WARMUP_SECONDS = 30


class BalanceRefresher:
    """Periodically refreshes balance cache for all active wallets.

    Refreshes wallets one at a time with pauses between each to avoid
    starving the event loop of resources needed for user-facing requests.
    """

    def __init__(self, refresh_interval: int = 60):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._refresh_interval = refresh_interval
        self._wallet_service = WalletService()
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
        logger.info("Balance refresher stopped")

    async def _refresh_loop(self):
        """Main refresh loop."""
        import time as _time
        from bot.utils.redis_cache import redis_cache

        # Wait for services to fully initialize. Named rather than inline so the
        # warmup is visible next to the budgets it interacts with, and so a test
        # can drive the loop without waiting it out.
        await asyncio.sleep(_WARMUP_SECONDS)

        while self._running:
            try:
                # Heartbeat BEFORE the work, with a TTL comfortably longer than one
                # full cycle. A refresh pass costs roughly (wallets / BATCH_SIZE)
                # seconds on top of _refresh_interval, so writing a 60s TTL after
                # the work left the key expired for most of every cycle and /health
                # reported this service as "unknown" (missing key) indefinitely.
                # Front-loading it also keeps liveness honest when _refresh_all
                # raises: the loop is alive, and a genuinely stuck loop still goes
                # stale once the TTL lapses. Matches withdraw_reconciler /
                # predict_monitor, which use 180s for the same reason.
                await redis_cache.set(
                    "service:balance_refresher:heartbeat", _time.time(), ttl_seconds=300
                )
                # Bounded, and the bound is load-bearing. _refresh_all gathers
                # batches of wallet-balance RPC calls with no per-call deadline,
                # so a single provider that accepts a connection and never
                # answers wedges the gather, wedges the pass, and wedges this
                # loop permanently. Observed in production: the beat was written
                # once at boot, expired at its 300s TTL, and was never rewritten
                # again — /health reported the service as "unknown" for four
                # days while the task was technically still alive.
                #
                # The budget must be under the 300s staleness threshold in
                # api/main.py, or a slow-but-healthy pass would still be able to
                # miss a beat and read as dead.
                try:
                    await asyncio.wait_for(self._refresh_all(), timeout=_PASS_BUDGET_SECONDS)
                except asyncio.TimeoutError:
                    logger.warning(
                        "Balance refresh pass exceeded %ss and was cancelled; "
                        "the loop continues and will beat again",
                        _PASS_BUDGET_SECONDS,
                    )
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.error(f"Balance refresh error: {e}")

            if not self._running:
                return
            await asyncio.sleep(self._refresh_interval)

    async def _refresh_all(self):
        """Refresh balances for all active wallets, one at a time."""
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
                    Wallet.is_active == True,
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
            batch = targets[i : i + BATCH_SIZE]
            tasks = []
            for address, chain_type in batch:
                tasks.append(self._safe_refresh(address, chain_type))
            # Per-batch deadline as well as the whole-pass one: gather waits for
            # the SLOWEST member, so without this a single unresponsive provider
            # holds its four batch-mates hostage and burns the entire pass
            # budget on five wallets.
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True),
                    timeout=_BATCH_BUDGET_SECONDS,
                )
            except asyncio.TimeoutError:
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


# Global instance
balance_refresher = BalanceRefresher()
