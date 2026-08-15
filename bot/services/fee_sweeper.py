"""Automatic fee sweeper background task."""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal

from bot.services.fee_service import fee_service

logger = logging.getLogger(__name__)


# Configuration
SWEEP_INTERVAL_SECONDS = 3600  # Sweep every hour
MIN_SWEEP_AMOUNT_USD = 1.0  # Only sweep if fees > $1
SWEEP_TIMEOUT_SECONDS = 180  # Bound the on-chain sweep RPC so the loop can't hang


class FeeSweeper:
    """Background task for automatic fee sweeping."""

    def __init__(self):
        self._running = False
        self._task = None
        self._last_sweep = None

    async def start(self):
        """Start the automatic sweeper."""
        if self._running:
            logger.warning("Fee sweeper already running")
            return

        self._running = True
        self._task = asyncio.create_task(self._sweep_loop())
        logger.info("Fee sweeper started")

    async def stop(self):
        """Stop the automatic sweeper."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Fee sweeper stopped")

    async def _sweep_loop(self):
        """Main sweep loop."""
        # Wait a bit before first sweep
        await asyncio.sleep(60)

        while self._running:
            try:
                await self._do_sweep()
            except Exception as e:
                logger.error(f"Fee sweep error: {e}")

            # Wait for next interval
            await asyncio.sleep(SWEEP_INTERVAL_SECONDS)

    async def _do_sweep(self):
        """Perform a sweep of all uncollected fees."""
        uncollected = fee_service.get_uncollected_fees()

        if not uncollected:
            logger.debug("No uncollected fees to sweep")
            return

        # Filter by minimum amount
        to_sweep = [f for f in uncollected if f["amount_usd"] >= MIN_SWEEP_AMOUNT_USD]

        if not to_sweep:
            logger.debug(f"Uncollected fees below minimum ${MIN_SWEEP_AMOUNT_USD}")
            return

        logger.info(f"Auto-sweeping {len(to_sweep)} fee batches")

        try:
            results = await asyncio.wait_for(
                fee_service.sweep_all_fees(), timeout=SWEEP_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Fee sweep timed out after %ss; will retry next interval",
                SWEEP_TIMEOUT_SECONDS,
            )
            return

        successful = [r for r in results if r["success"]]
        failed = [r for r in results if not r["success"]]

        if successful:
            total_usd = sum(r.get("amount", 0) for r in successful)
            logger.info(
                f"Auto-sweep complete: {len(successful)} batches, "
                f"~${total_usd:.2f} swept to collector"
            )

        if failed:
            for f in failed:
                try:
                    logger.warning(f"Sweep failed for {f['chain']}/{f['token']}: {f['message']}")
                except Exception as e:
                    logger.error("Failed to log sweep failure for target=%s: %s", f, e)
                    continue

        # Trigger vault deposit for protocol's 60% share if AAVE_ENABLED and threshold met
        try:
            from bot.config.settings import settings

            if getattr(settings, "aave_enabled", False) and successful:
                from decimal import Decimal
                from bot.services.treasury_vault_service import treasury_vault_service

                total_swept = Decimal(
                    str(sum(r.get("amount_usd", r.get("amount", 0)) for r in successful))
                )
                protocol_portion = total_swept * Decimal("0.60")
                min_deposit = Decimal(str(getattr(settings, "vault_min_deposit_usdc", 50.0)))
                if protocol_portion >= min_deposit:
                    tx = treasury_vault_service.deposit_to_vault(protocol_portion)
                    logger.info(
                        "Vault deposit %.2f USDC → Aave v3 Base tx=%s", protocol_portion, tx
                    )
        except Exception as vault_err:
            # Non-fatal to the sweep loop, but the protocol's 60% share is
            # failing to reach the vault — that must be loud, not a warning.
            logger.error("Vault deposit failed for protocol share: %s", vault_err)

        self._last_sweep = datetime.now(timezone.utc)

    async def sweep_now(self):
        """Trigger an immediate sweep."""
        logger.info("Manual sweep triggered")
        await self._do_sweep()
        return fee_service.get_uncollected_fees()


# Global instance
fee_sweeper = FeeSweeper()


async def start_fee_sweeper():
    """Start the fee sweeper (call from main)."""
    await fee_sweeper.start()


async def stop_fee_sweeper():
    """Stop the fee sweeper (call on shutdown)."""
    await fee_sweeper.stop()
