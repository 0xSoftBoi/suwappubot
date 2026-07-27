"""Background monitor for perpetual trading positions."""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal

from bot.services.hyperliquid_client import hyperliquid_client
from bot.models.perps import PerpPosition, HyperLiquidAccount
from bot.utils.safe_send import safe_send
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
        import time as _time
        from bot.utils.redis_cache import redis_cache

        while self._running:
            try:
                await self._sync_all_positions()
                await redis_cache.set(
                    "service:perps_monitor:heartbeat", _time.time(), ttl_seconds=60
                )
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
            account = (
                session.query(HyperLiquidAccount).filter_by(user_id=user_id, is_active=True).first()
            )

            if not account or not account.hl_address:
                return

            hl_address = account.hl_address

        # Get live positions from HyperLiquid
        hl_positions = await hyperliquid_client.get_open_positions(hl_address)

        with get_session() as session:
            local_positions = (
                session.query(PerpPosition).filter_by(user_id=user_id, status="open").all()
            )

            for local_pos in local_positions:
                hl_match = next(
                    (
                        p
                        for p in hl_positions
                        if p["market"] == local_pos.market and p["side"] == local_pos.side
                    ),
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

                    # Check TP/SL triggers (if not handled by exchange). Dedup via
                    # tp_notified_at/sl_notified_at — without this the condition
                    # stayed true on every 10s poll and re-sent the DM forever
                    # once mark price crossed the trigger.
                    #
                    # The flag is written only when _notify_user reports the DM
                    # actually went out. Setting it first would mean a transient
                    # Telegram failure (or the monitor polling before the bot is
                    # wired) permanently suppresses that position's alert — and
                    # a missed stop-loss on a leveraged position costs far more
                    # than a duplicate take-profit ping.
                    mark = float(local_pos.mark_price or 0)
                    if local_pos.tp_price and mark > 0 and not local_pos.tp_notified_at:
                        tp = float(local_pos.tp_price)
                        if (local_pos.side == "long" and mark >= tp) or (
                            local_pos.side == "short" and mark <= tp
                        ):
                            if await self._notify_user(
                                user_id,
                                f"Take profit triggered for {local_pos.market} {local_pos.side}! "
                                f"Mark: ${mark:,.2f}, TP: ${tp:,.2f}",
                            ):
                                local_pos.tp_notified_at = datetime.now(timezone.utc)

                    if local_pos.sl_price and mark > 0 and not local_pos.sl_notified_at:
                        sl = float(local_pos.sl_price)
                        if (local_pos.side == "long" and mark <= sl) or (
                            local_pos.side == "short" and mark >= sl
                        ):
                            if await self._notify_user(
                                user_id,
                                f"Stop loss triggered for {local_pos.market} {local_pos.side}! "
                                f"Mark: ${mark:,.2f}, SL: ${sl:,.2f}",
                            ):
                                local_pos.sl_notified_at = datetime.now(timezone.utc)

                else:
                    # Position closed/liquidated on exchange
                    local_pos.status = "liquidated"
                    local_pos.closed_at = datetime.now(timezone.utc)
                    # Clear dedup flags so a position reopened on this row (if one
                    # ever is) can alert again.
                    local_pos.tp_notified_at = None
                    local_pos.sl_notified_at = None

                    await self._notify_user(
                        user_id,
                        f"Position {local_pos.market} {local_pos.side} has been liquidated/closed on HyperLiquid.",
                    )

    async def _notify_user(self, user_id: int, message: str) -> bool:
        """Send notification to user via Telegram. Returns True if delivered.

        Callers use the return value to decide whether to persist a
        notified-at dedup flag: marking an alert as sent when it never left
        the process would suppress it permanently, and a missed stop-loss
        alert on a leveraged position is far more costly than a duplicate.

        Note the deliberate consequence for a user who has MUTED risk events:
        safe_send returns False, so the dedup flag is never written and this
        re-evaluates on every poll. That costs only a 30s-cached preference
        lookup (no DM, no API call), and it means the alert is delivered if
        they unmute while the position is still past its trigger — which is
        the behaviour we want. It is not the notification loop this flag was
        added to stop.
        """
        if not self._bot:
            return False

        try:
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).get(user_id)
                telegram_id = user.telegram_id if user else None

            if not telegram_id:
                return False

            return await safe_send(
                self._bot,
                telegram_id,
                f"\U0001f4ca **Perps Alert**\n\n{message}",
                category="risk_event",
                parse_mode="Markdown",
            )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")
            return False


# Global instance
perps_monitor = PerpsMonitor()
