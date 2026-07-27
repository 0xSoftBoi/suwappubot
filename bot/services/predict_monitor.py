"""Background monitor for Polymarket prediction-market positions.

Polymarket has no webhooks, so position state goes stale the moment an order is
placed: ``current_price``/``unrealized_pnl`` are frozen at entry and a market that
resolves YES/NO is never settled or surfaced to the user. This loop polls the CLOB
to keep open positions live (midpoint price + unrealized PnL) and, when a market
resolves, marks the position settled, records the payout, and notifies the user —
the same reconciliation HyperLiquid gets from ``hl_ecosystem_monitor``. Mirrors that
monitor's lifecycle (start/stop, heartbeat, per-user error isolation).
"""

import asyncio
import logging
from decimal import Decimal

from bot.services.polymarket_api import polymarket_client
from bot.models.predict import PredictionPosition
from bot.utils.safe_send import safe_send
from database.db import get_session

logger = logging.getLogger(__name__)


class PredictMonitor:
    """Polls and reconciles open Polymarket prediction-market positions."""

    # Prediction markets move slower than perps; 120s keeps PnL fresh without
    # hammering the public CLOB endpoints.
    POLL_INTERVAL = 120

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
        logger.info("Prediction-market monitor started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Prediction-market monitor stopped")

    async def _monitor_loop(self):
        import time as _time
        from bot.utils.redis_cache import redis_cache

        while self._running:
            try:
                await self._tick()
                await redis_cache.set(
                    "service:predict_monitor:heartbeat", _time.time(), ttl_seconds=180
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Predict monitor error: {e}")
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _tick(self):
        # Settle first so resolved positions drop out of the price refresh.
        await self._settle_resolved()
        await self._refresh_prices()

    @staticmethod
    def compute_pnl(total_shares, current_price, total_cost) -> Decimal:
        """Unrealized PnL = mark value of shares minus cost basis."""
        shares = float(total_shares or 0)
        price = float(current_price or 0)
        cost = float(total_cost or 0)
        return Decimal(str(round(shares * price - cost, 6)))

    async def _refresh_prices(self):
        """Refresh ``current_price``/``unrealized_pnl`` for open, unresolved positions."""
        with get_session() as session:
            token_ids = [
                tid
                for (tid,) in session.query(PredictionPosition.token_id)
                .filter(
                    PredictionPosition.is_resolved.is_(False),
                    PredictionPosition.total_shares > 0,
                )
                .distinct()
                .all()
                if tid
            ]

        # One midpoint fetch per distinct token, then fan the price out to every
        # position holding it.
        prices: dict[str, float] = {}
        for token_id in token_ids:
            try:
                mid = await polymarket_client.get_midpoint(token_id)
            except Exception as e:
                logger.debug("midpoint fetch failed for %s: %s", token_id, e)
                mid = None
            if mid is not None:
                prices[token_id] = mid

        if not prices:
            return

        with get_session() as session:
            rows = (
                session.query(PredictionPosition)
                .filter(
                    PredictionPosition.is_resolved.is_(False),
                    PredictionPosition.total_shares > 0,
                    PredictionPosition.token_id.in_(list(prices.keys())),
                )
                .all()
            )
            for pos in rows:
                price = prices.get(pos.token_id)
                if price is None:
                    continue
                pos.current_price = Decimal(str(round(price, 4)))
                pos.unrealized_pnl = self.compute_pnl(pos.total_shares, price, pos.total_cost_usdc)

    async def _settle_resolved(self):
        """Detect resolved markets and settle the positions that hold them."""
        with get_session() as session:
            market_ids = [
                mid
                for (mid,) in session.query(PredictionPosition.market_id)
                .filter(
                    PredictionPosition.is_resolved.is_(False),
                    PredictionPosition.total_shares > 0,
                )
                .distinct()
                .all()
                if mid
            ]

        for market_id in market_ids:
            try:
                clob_market = await polymarket_client.get_clob_market(market_id)
                resolution = polymarket_client.resolve_winner(clob_market)
                if not resolution:
                    continue
                winners = resolution["winning_token_ids"]

                notes = []
                with get_session() as session:
                    rows = (
                        session.query(PredictionPosition)
                        .filter(
                            PredictionPosition.market_id == market_id,
                            PredictionPosition.is_resolved.is_(False),
                            PredictionPosition.total_shares > 0,
                        )
                        .all()
                    )
                    for pos in rows:
                        won = str(pos.token_id) in winners
                        shares = float(pos.total_shares or 0)
                        cost = float(pos.total_cost_usdc or 0)
                        # Resolved YES tokens redeem at $1/share; losers at $0.
                        payout = shares if won else 0.0
                        pos.is_resolved = True
                        pos.resolved_payout = Decimal(str(round(payout, 6)))
                        pos.current_price = Decimal("1.0") if won else Decimal("0.0")
                        pos.unrealized_pnl = Decimal(str(round(payout - cost, 6)))
                        notes.append(
                            (
                                pos.user_id,
                                won,
                                payout,
                                payout - cost,
                                pos.market_question or "your market",
                                pos.outcome,
                            )
                        )

                for user_id, won, payout, profit, question, outcome in notes:
                    # Whole-product points: flat bonus on a winning settlement.
                    # Idempotent — positions are settled once (the query filters
                    # is_resolved == False), so each win fires a single award.
                    # Never let a points error break the settlement notify loop.
                    if won:
                        try:
                            from bot.services.points_service import points_service

                            points_service.award_points(
                                user_id=user_id,
                                action="predict_win",
                                description=f"Won prediction (${payout:,.2f} payout)",
                                metadata={"amount_usd": float(payout)},
                            )
                        except Exception as e:
                            logger.debug("predict_win award skipped: %s", e)
                    if won:
                        msg = (
                            f"\U0001f3af *Market resolved — you won!*\n\n"
                            f"{question}\n"
                            f"Your {outcome} position redeems for "
                            f"*${payout:,.2f}* ({profit:+,.2f} profit).\n\n"
                            f"_Settled via Polymarket on Polygon._"
                        )
                    else:
                        msg = (
                            f"\U0001f3c1 *Market resolved*\n\n"
                            f"{question}\n"
                            f"Your {outcome} position did not win "
                            f"({profit:+,.2f}).\n\n"
                            f"_Better luck on the next one — /predict to keep trading._"
                        )
                    await self._notify_user(user_id, msg)
            except Exception as e:
                logger.debug("settle failed for market %s: %s", market_id, e)

    async def _notify_user(self, user_id: int, message: str):
        if not self._bot:
            return
        try:
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).get(user_id)
                if user and user.telegram_id:
                    await safe_send(
                        self._bot,
                        user.telegram_id,
                        message,
                        category="order_triggered",
                        parse_mode="Markdown",
                    )
        except Exception as e:
            logger.error(f"Failed to notify user {user_id}: {e}")


# Global instance
predict_monitor = PredictMonitor()
