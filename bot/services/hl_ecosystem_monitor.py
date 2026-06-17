"""Background monitor for HyperLiquid ecosystem state (TWAP, staking, vaults).

Webhooks don't exist for these, so we poll: TWAP orders are marked finished
once their duration elapses (and the user is notified), undelegations are
cleared once their 1-day lockup passes, and vault equity/PnL is refreshed so
the portfolio stays accurate. Mirrors the PerpsMonitor lifecycle.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from bot.services.hyperliquid_client import hyperliquid_client
from bot.models.perps import HyperLiquidAccount
from bot.models.hl_ecosystem import HLTwapOrder, HLStakeRecord, HLVaultPosition
from database.db import get_session

logger = logging.getLogger(__name__)


class HLEcosystemMonitor:
    """Polls and reconciles HyperLiquid staking, vault, and TWAP state."""

    POLL_INTERVAL = 60  # seconds

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
        logger.info("HyperLiquid ecosystem monitor started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("HyperLiquid ecosystem monitor stopped")

    async def _monitor_loop(self):
        import time as _time
        from bot.utils.redis_cache import redis_cache

        while self._running:
            try:
                await self._tick()
                await redis_cache.set(
                    "service:hl_ecosystem_monitor:heartbeat", _time.time(), ttl_seconds=180
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"HL ecosystem monitor error: {e}")
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _tick(self):
        await self._finish_elapsed_twaps()
        await self._clear_unlocked_undelegations()
        await self._refresh_vault_positions()

    async def _finish_elapsed_twaps(self):
        """Mark running TWAPs finished once their slice window elapses; notify."""
        now = datetime.now(timezone.utc)
        to_notify = []
        with get_session() as session:
            running = session.query(HLTwapOrder).filter(HLTwapOrder.status == "running").all()
            for t in running:
                created = t.created_at or now
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if now >= created + timedelta(minutes=int(t.minutes) + 1):
                    t.status = "finished"
                    t.finished_at = now
                    to_notify.append((t.user_id, t.side, float(t.size), t.market, t.minutes))
        for user_id, side, size, market, minutes in to_notify:
            await self._notify_user(
                user_id,
                f"\U0001f552 TWAP complete: {side.upper()} {size} {market} over {minutes}m finished.",
            )

    async def _clear_unlocked_undelegations(self):
        """Notify + clear stake records whose 1-day undelegation lockup has passed."""
        now = datetime.now(timezone.utc)
        to_notify = []
        with get_session() as session:
            locked = (
                session.query(HLStakeRecord).filter(HLStakeRecord.locked_until.isnot(None)).all()
            )
            for r in locked:
                lu = r.locked_until
                if lu and lu.tzinfo is None:
                    lu = lu.replace(tzinfo=timezone.utc)
                if lu and now >= lu:
                    r.locked_until = None
                    to_notify.append((r.user_id, r.validator_name or r.validator[:10]))
        for user_id, name in to_notify:
            await self._notify_user(
                user_id,
                f"\U0001f53a Unstaking from {name} unlocked — HYPE is back in your staking balance "
                "(`/stakemove <amount> out` to move it to spot).",
            )

    async def _refresh_vault_positions(self):
        """Refresh stored vault equity/PnL so the portfolio view stays accurate."""
        with get_session() as session:
            rows = session.query(HLVaultPosition).filter(HLVaultPosition.is_open.is_(True)).all()
            user_ids = {r.user_id for r in rows}
        for user_id in user_ids:
            try:
                with get_session() as session:
                    account = (
                        session.query(HyperLiquidAccount)
                        .filter_by(user_id=user_id, is_active=True)
                        .first()
                    )
                    addr = account.hl_address if account else None
                if not addr:
                    continue
                equities = {
                    (e.get("vaultAddress", "") or "").lower(): float(e.get("equity", 0) or 0)
                    for e in await hyperliquid_client.get_user_vault_equities(addr)
                }
                with get_session() as session:
                    positions = (
                        session.query(HLVaultPosition)
                        .filter_by(user_id=user_id, is_open=True)
                        .all()
                    )
                    for p in positions:
                        eq = equities.get(p.vault_address.lower())
                        if eq is not None:
                            p.equity_usd = Decimal(str(round(eq, 2)))
                            p.is_open = eq > 0
            except Exception as e:
                logger.debug("vault refresh failed for user %s: %s", user_id, e)

    async def _notify_user(self, user_id: int, message: str):
        if not self._bot:
            return
        try:
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).get(user_id)
                if user and user.telegram_id:
                    await self._bot.send_message(
                        chat_id=user.telegram_id, text=message, parse_mode="Markdown"
                    )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")


# Global instance
hl_ecosystem_monitor = HLEcosystemMonitor()
