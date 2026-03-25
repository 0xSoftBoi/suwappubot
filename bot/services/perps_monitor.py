"""Background monitor for perpetual trading positions."""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal

from bot.services.hyperliquid_client import hyperliquid_client
from bot.models.perps import PerpPosition, HyperLiquidAccount
from database.db import get_session

logger = logging.getLogger(__name__)


class PerpsMonitor:
    """Background service to monitor perpetual positions."""

    POLL_INTERVAL = 10  # seconds

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None  # Telegram bot for notifications

    async def start(self, bot=None):
        """Start the position monitor."""
        if self._running:
            return

        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Perps position monitor started")

    async def stop(self):
        """Stop the monitor."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Perps position monitor stopped")

    async def _monitor_loop(self):
        """Main monitoring loop."""
        while self._running:
            try:
                await self._sync_all_positions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Perps monitor error: {e}")

            await asyncio.sleep(self.POLL_INTERVAL)

    async def _sync_all_positions(self):
        """Sync all active positions with HyperLiquid."""
        with get_session() as session:
            # Get all users with open positions
            active_user_ids = (
                session.query(PerpPosition.user_id)
                .filter(PerpPosition.status == "open")
                .distinct()
                .all()
            )
            user_ids = [uid[0] for uid in active_user_ids]

        for user_id in user_ids:
            try:
                await self._sync_user_positions(user_id)
            except Exception as e:
                logger.error(f"Failed to sync positions for user {user_id}: {e}")

    async def _sync_user_positions(self, user_id: int):
        """Sync positions for a single user."""
        with get_session() as session:
            account = session.query(HyperLiquidAccount).filter_by(
                user_id=user_id, is_active=True
            ).first()

            if not account or not account.hl_address:
                return

            hl_address = account.hl_address

        # Get live positions from HyperLiquid
        hl_positions = await hyperliquid_client.get_open_positions(hl_address)

        with get_session() as session:
            local_positions = session.query(PerpPosition).filter_by(
                user_id=user_id, status="open"
            ).all()

            for local_pos in local_positions:
                hl_match = next(
                    (p for p in hl_positions if p["market"] == local_pos.market and p["side"] == local_pos.side),
                    None,
                )

                if hl_match:
                    # Update local position with live data
                    old_pnl = float(local_pos.unrealized_pnl or 0)
                    new_pnl = float(hl_match.get("unrealized_pnl", 0))

                    local_pos.mark_price = Decimal(str(hl_match.get("entry_price", 0)))
                    local_pos.unrealized_pnl = Decimal(str(new_pnl))
                    local_pos.liquidation_price = Decimal(str(hl_match.get("liquidation_price", 0)))
                    local_pos.size = Decimal(str(hl_match.get("size", float(local_pos.size))))

                    # Check TP/SL triggers (if not handled by exchange)
                    mark = float(local_pos.mark_price or 0)
                    if local_pos.tp_price and mark > 0:
                        tp = float(local_pos.tp_price)
                        if (local_pos.side == "long" and mark >= tp) or \
                           (local_pos.side == "short" and mark <= tp):
                            await self._notify_user(
                                user_id,
                                f"Take profit triggered for {local_pos.market} {local_pos.side}! "
                                f"Mark: ${mark:,.2f}, TP: ${tp:,.2f}"
                            )

                    if local_pos.sl_price and mark > 0:
                        sl = float(local_pos.sl_price)
                        if (local_pos.side == "long" and mark <= sl) or \
                           (local_pos.side == "short" and mark >= sl):
                            await self._notify_user(
                                user_id,
                                f"Stop loss triggered for {local_pos.market} {local_pos.side}! "
                                f"Mark: ${mark:,.2f}, SL: ${sl:,.2f}"
                            )

                else:
                    # Position closed/liquidated on exchange
                    local_pos.status = "liquidated"
                    local_pos.closed_at = datetime.now(timezone.utc)

                    await self._notify_user(
                        user_id,
                        f"Position {local_pos.market} {local_pos.side} has been liquidated/closed on HyperLiquid."
                    )

    async def _notify_user(self, user_id: int, message: str):
        """Send notification to user via Telegram."""
        if not self._bot:
            return

        try:
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).get(user_id)
                if user and user.telegram_id:
                    await self._bot.send_message(
                        chat_id=user.telegram_id,
                        text=f"\U0001f4ca **Perps Alert**\n\n{message}",
                        parse_mode="Markdown",
                    )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")


# Global instance
perps_monitor = PerpsMonitor()
