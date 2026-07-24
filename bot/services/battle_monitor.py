"""Background monitor for battle settlement.

Mirrors the lifecycle of perps_monitor / predict_monitor:
  - start(bot) / stop() public API
  - asyncio task running a tight poll loop
  - heartbeat written to Redis for health checks
  - per-battle errors isolated (one bad settlement never stops the loop)

The poll interval is 30 seconds, which is tight enough to settle 1-minute
battles within one interval of their expiry without hammering the DB.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)


class BattleMonitor:
    """Polls and settles expired open battles."""

    POLL_INTERVAL = 30  # seconds

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None

    async def start(self, bot=None):
        if self._running:
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Battle monitor started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Battle monitor stopped")

    async def _monitor_loop(self):
        import time as _time
        from bot.utils.redis_cache import redis_cache

        while self._running:
            try:
                await self._tick()
                await redis_cache.set(
                    "service:battle_monitor:heartbeat", _time.time(), ttl_seconds=90
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Battle monitor error: %s", e)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _tick(self):
        from bot.services.battle_service import battle_service

        settled = await battle_service.settle_expired_battles()

        # Notify users about settled battles if a bot instance is available.
        if settled and self._bot:
            await self._notify_settled()

    async def _notify_settled(self):
        """Send settlement notifications for battles settled in the last tick."""
        from datetime import datetime, timezone, timedelta
        from database.db import get_session
        from bot.models.battle import Battle

        cutoff = datetime.now(timezone.utc) - timedelta(seconds=self.POLL_INTERVAL + 5)

        with get_session() as session:
            recent = (
                session.query(Battle)
                .filter(
                    Battle.status.in_(["settled", "voided"]),
                    Battle.settled_at >= cutoff,
                )
                .all()
            )
            # Expunge before closing session.
            for b in recent:
                session.expunge(b)

        for battle in recent:
            try:
                await self._send_result(battle)
            except Exception as e:
                logger.warning("battle notify failed id=%s: %s", battle.id, e)

    async def _send_result(self, battle):
        """Send a Telegram DM with the battle result."""
        if not self._bot:
            return

        from bot.models.user import User
        from database.db import get_session
        from bot.services.battle_service import PREDICTION_WIN_MULTIPLIER

        with get_session() as session:
            user = session.query(User).filter_by(id=battle.user_id).first()
            if not user or not user.telegram_id:
                return
            telegram_id = user.telegram_id

        outcome = battle.outcome or "void"
        pnl = float(battle.pnl_usd or 0)
        sign = "+" if pnl >= 0 else ""
        market_short = battle.market.split("-")[0]
        backing = getattr(battle, "backing", "perps")

        if outcome == "win":
            result_label = "WIN"
        elif outcome == "loss":
            result_label = "LOSS"
        else:
            result_label = "VOID"

        # Show payout rate for prediction battles so users know what multiplier was used.
        payout_note = ""
        if backing == "prediction" and outcome == "win":
            payout_note = f"\nPayout:    {float(PREDICTION_WIN_MULTIPLIER):.1f}x stake"

        text = (
            f"**Battle #{battle.id} settled — {result_label}**\n\n"
            f"Market:    {market_short}\n"
            f"Direction: {'UP' if battle.direction == 'up' else 'DOWN'}\n"
            f"Stake:     ${float(battle.stake_usd):,.2f}\n"
            f"Result:    {sign}${pnl:,.4f}{payout_note}\n"
            f"Entry:     ${float(battle.entry_price):,.2f}\n"
            f"Settle:    ${float(battle.settle_price or 0):,.2f}\n\n"
            f"Use /battle to start a new battle."
        )

        try:
            await self._bot.send_message(
                chat_id=telegram_id,
                text=text,
                parse_mode="Markdown",
            )
        except Exception as e:
            logger.warning("battle DM failed user=%s: %s", battle.user_id, e)


battle_monitor = BattleMonitor()
