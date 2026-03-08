"""Background service to keep balance cache warm for active wallets."""

import asyncio
import logging
from typing import Optional

from bot.models.user import Wallet
from bot.services.wallet import WalletService
from database.db import get_session

logger = logging.getLogger(__name__)


class BalanceRefresher:
    """Periodically refreshes balance cache for all active wallets."""

    def __init__(self, refresh_interval: int = 45, concurrency: int = 5):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._refresh_interval = refresh_interval
        self._concurrency = concurrency
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
        # Wait a bit on startup to let other services initialize
        await asyncio.sleep(10)

        while self._running:
            try:
                await self._refresh_all()
            except Exception as e:
                logger.error(f"Balance refresh error: {e}")

            await asyncio.sleep(self._refresh_interval)

    async def _refresh_all(self):
        """Refresh balances for all active wallets."""
        # Get all unique (address, chain_type) pairs from active wallets
        seen: set[tuple[str, str]] = set()
        targets: list[tuple[str, str]] = []

        with get_session() as session:
            wallets = session.query(Wallet.address, Wallet.chain_type).filter(
                Wallet.is_active == True,
            ).all()

            for address, chain_type in wallets:
                key = (address, chain_type)
                if key not in seen:
                    seen.add(key)
                    targets.append(key)

        if not targets:
            return

        logger.debug(f"Refreshing balances for {len(targets)} unique wallets")

        # Use a semaphore to limit concurrent RPC calls
        sem = asyncio.Semaphore(self._concurrency)

        async def _refresh_one(address: str, chain_type: str):
            async with sem:
                try:
                    await self._wallet_service.get_balances_by_address(address, chain_type)
                except Exception as e:
                    logger.debug(f"Failed to refresh {address} ({chain_type}): {e}")

        await asyncio.gather(
            *[_refresh_one(addr, ct) for addr, ct in targets],
            return_exceptions=True,
        )


# Global instance
balance_refresher = BalanceRefresher()
