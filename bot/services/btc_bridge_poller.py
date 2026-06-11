"""Background poller for Atomiq BTC bridge swaps (Starknet Phase 3).

Every ~20s it advances every unfinished BtcSwap via BtcBridge.advance_swap,
with per-swap error isolation (one swap blowing up never blocks the rest).
Started from api/main.py lifespan, guarded by settings.starknet_btc_bridge_enabled.
"""

import asyncio
import logging
from typing import Optional

from bot.services.btc_bridge import BtcBridge, btc_bridge

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 20.0


class BtcBridgePoller:
    """Async loop that drives unfinished Atomiq swaps to completion."""

    def __init__(self, bridge: Optional[BtcBridge] = None, interval: float = POLL_INTERVAL_SECONDS):
        self.bridge = bridge or btc_bridge
        self.interval = interval
        self.running = False
        self.bot = None
        self._task: Optional[asyncio.Task] = None

    async def start(self, bot=None):
        if self.running:
            return
        self.bot = bot
        self.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("✓ BTC bridge poller started (interval=%ss)", self.interval)

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("BTC bridge poller stopped")

    async def _loop(self):
        # Startup reconciliation (best-effort)
        try:
            await self.bridge.resume_pending()
        except Exception as e:
            logger.warning("BTC bridge resume_pending failed: %s", str(e)[:200])

        while self.running:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pragma: no cover - defensive outer guard
                logger.error("BTC bridge poll cycle error: %s", str(e)[:300])
            await asyncio.sleep(self.interval)

    async def poll_once(self) -> int:
        """Advance every unfinished swap once. Returns count of swaps polled.

        Errors are isolated per swap so a single failing swap (RPC outage,
        bad wallet, Atomiq 5xx) cannot stall the others.
        """
        ids = self._unfinished_ids()
        for btc_swap_id in ids:
            try:
                next_poll = await self.bridge.advance_swap(btc_swap_id)
                if next_poll is None:
                    # The swap just transitioned to a terminal state (it was
                    # unfinished when we listed it) — tell the user.
                    await self._notify_finished(btc_swap_id)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning("BTC bridge: advance_swap(%s) failed: %s", btc_swap_id, str(e)[:300])
        return len(ids)

    async def _notify_finished(self, btc_swap_id: int) -> None:
        """Best-effort Telegram notification when a swap reaches terminal state."""
        if self.bot is None:
            return
        try:
            from bot.models.btc_swap import BtcSwap
            from bot.models.user import User
            from database.db import get_session

            with get_session() as session:
                row = (
                    session.query(
                        BtcSwap.direction, BtcSwap.amount_raw, BtcSwap.success, User.telegram_id
                    )
                    .join(User, User.id == BtcSwap.user_id)
                    .filter(BtcSwap.id == btc_swap_id, BtcSwap.finished == True)  # noqa: E712
                    .first()
                )
            if row is None or row[3] is None:
                return
            direction, amount_raw, success, telegram_id = row
            labels = {
                "ln_in": "Lightning deposit",
                "btc_out": "BTC withdrawal",
                "ln_out": "Lightning withdrawal",
            }
            try:
                sats_text = f"{int(amount_raw):,} sats"
            except (TypeError, ValueError):
                sats_text = ""
            verb = "✅ completed" if success else "❌ failed"
            text = f"₿ Your {labels.get(direction, 'BTC bridge swap')} {sats_text} {verb}. See /btc → 📋 My BTC swaps."
            await self.bot.send_message(chat_id=telegram_id, text=text)
        except Exception as e:
            logger.warning(
                "BTC bridge: completion notify failed for %s: %s", btc_swap_id, str(e)[:200]
            )

    @staticmethod
    def _unfinished_ids() -> list:
        from bot.models.btc_swap import BtcSwap
        from database.db import get_session

        with get_session() as session:
            rows = (
                session.query(BtcSwap.id)
                .filter(BtcSwap.finished == False)  # noqa: E712
                .order_by(BtcSwap.id)
                .all()
            )
        return [r[0] for r in rows]


# Global instance
btc_bridge_poller = BtcBridgePoller()
