"""Limit orders and DCA service."""

import asyncio
import logging
from typing import Optional, List
from datetime import datetime, timedelta, timezone

from bot.models.advanced import (
    LimitOrder,
    OrderStatus,
    OrderType,
    DCAOrder,
    DCAExecution,
    DCAStatus,
    SwapTemplate,
)
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.favorites import UserSettings
from bot.services.price_service import price_service
from bot.services.swap_engine import SwapEngine
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)


# Idempotency keys for automated order execution.
#
# Two properties matter, and both are load-bearing for fund safety:
#
# 1. STABLE across retries. These used to carry a UTC hour bucket, which
#    silently defeated SwapEngine's idempotency guard on every clock rollover:
#    a new hour produced a key matching no row, so the guard never ran and the
#    order broadcast again regardless of what the previous attempt had done.
#    The swap's own status is what decides retryability, and the guard can only
#    read it if the key still finds the row. There is also a UNIQUE index on
#    swap_transactions.idempotency_key, which is the only cross-replica
#    serialisation point we have — a per-process lock cannot span replicas or
#    restarts — and a rotating key defeats that too.
#
# 2. UNIQUE to one order for all time. The row id alone is not: SQLite reuses
#    INTEGER PRIMARY KEY rowids after a DELETE, so a recreated order could
#    inherit a deleted order's swap row and be reported as executed with
#    someone else's tx_hash. created_at is immutable, so pairing the two is
#    stable and collision-free on any backend.
#
# Defined here, once, so the writer and resume_dca's precondition check cannot
# drift apart.
# created_at is a naive column, and naive_dt.timestamp() resolves it in the
# PROCESS's local timezone. Nothing sets TZ today so it lands on UTC, but
# setting TZ on one service later would shift every key by the offset, the
# lookup would match no row, and the guard would stop running — the very
# failure the hour bucket caused. Pin it to UTC so the key cannot depend on
# deployment config. The None fallback covers a row inserted outside
# SQLAlchemy, where the column has no server default.
def _created_stamp(order) -> int:
    if not order.created_at:
        return 0
    return int(order.created_at.replace(tzinfo=timezone.utc).timestamp())


def _limit_order_key(order) -> str:
    return f"lo:{order.id}:{_created_stamp(order)}"


def _dca_order_key(order) -> str:
    return f"dca:{order.id}:{_created_stamp(order)}:{order.executions_completed}"


class OrderService:
    """Service for managing limit orders and DCA."""

    def __init__(self):
        self._running = False
        self._task = None
        self._check_interval = 30  # Check every 30 seconds
        self._bot = None
        self._swap_engine = None

    # === Limit Orders ===

    def create_trailing_stop_order(
        self,
        user_id: int,
        wallet_id: int,
        from_chain: str,
        from_token: str,
        to_chain: str,
        to_token: str,
        amount: str,
        trailing_percent: float,
        slippage: float = 0.5,
        expires_in_hours: int = None,
    ) -> LimitOrder:
        """Create a trailing stop loss order.

        trigger_price is set to 0 — it is unused for TRAILING_STOP; the dynamic
        trigger is computed from highest_price_seen each poll cycle.

        # MONEY-PATH: trailing stop triggers sell execution
        """
        if not trailing_percent or trailing_percent <= 0:
            raise ValueError("trailing_percent must be positive")

        with get_session() as session:
            order = LimitOrder(
                user_id=user_id,
                wallet_id=wallet_id,
                order_type=OrderType.TRAILING_STOP.value,
                from_chain=from_chain,
                from_token=from_token,
                to_chain=to_chain,
                to_token=to_token,
                amount=amount,
                trigger_price=0.0,
                trailing_percent=trailing_percent,
                highest_price_seen=None,
                slippage=slippage,
            )
            if expires_in_hours:
                order.expires_at = datetime.utcnow() + timedelta(hours=expires_in_hours)
            session.add(order)
            session.flush()
            order_id = order.id

        with get_session() as session:
            return session.query(LimitOrder).filter(LimitOrder.id == order_id).first()

    def create_limit_order(
        self,
        user_id: int,
        wallet_id: int,
        order_type: str,
        from_chain: str,
        from_token: str,
        to_chain: str,
        to_token: str,
        amount: str,
        trigger_price: float,
        slippage: float = 0.5,
        expires_in_hours: int = None,
    ) -> LimitOrder:
        """Create a new limit order."""
        with get_session() as session:
            order = LimitOrder(
                user_id=user_id,
                wallet_id=wallet_id,
                order_type=order_type,
                from_chain=from_chain,
                from_token=from_token,
                to_chain=to_chain,
                to_token=to_token,
                amount=amount,
                trigger_price=trigger_price,
                slippage=slippage,
            )

            if expires_in_hours:
                order.expires_at = datetime.utcnow() + timedelta(hours=expires_in_hours)

            session.add(order)
            session.flush()
            order_id = order.id

        with get_session() as session:
            return session.query(LimitOrder).filter(LimitOrder.id == order_id).first()

    def get_user_orders(
        self,
        user_id: int,
        status: str = None,
        include_expired: bool = False,
    ) -> List[LimitOrder]:
        """Get limit orders for a user."""
        with get_session() as session:
            query = session.query(LimitOrder).filter(LimitOrder.user_id == user_id)

            if status:
                query = query.filter(LimitOrder.status == status)
            elif not include_expired:
                query = query.filter(
                    LimitOrder.status.in_(
                        [
                            OrderStatus.PENDING.value,
                            OrderStatus.TRIGGERED.value,
                        ]
                    )
                )

            return query.order_by(LimitOrder.created_at.desc()).all()

    def cancel_order(self, order_id: int, user_id: int) -> bool:
        """Cancel a limit order."""
        with get_session() as session:
            order = (
                session.query(LimitOrder)
                .filter(
                    LimitOrder.id == order_id,
                    LimitOrder.user_id == user_id,
                    LimitOrder.status == OrderStatus.PENDING.value,
                )
                .first()
            )

            if order:
                order.status = OrderStatus.CANCELLED.value
                return True
            return False

    async def check_limit_orders(self) -> List[LimitOrder]:
        """Check all pending limit orders and return triggered ones.

        Refactored to avoid holding a DB session across await boundaries.
        Phase 1: read from DB (thread pool). Phase 2: async price fetch.
        Phase 3: write updates back (thread pool).
        """

        # Phase 1: Read pending orders from DB (non-blocking)
        def _fetch_pending():
            with get_session() as session:
                orders = (
                    session.query(LimitOrder)
                    .filter(
                        LimitOrder.status == OrderStatus.PENDING.value,
                    )
                    .all()
                )
                # Detach from session by extracting needed fields
                result = []
                now = datetime.utcnow()
                expired_ids = []
                for o in orders:
                    if o.expires_at and o.expires_at < now:
                        expired_ids.append(o.id)
                        continue
                    result.append(
                        {
                            "id": o.id,
                            "order_type": o.order_type,
                            "from_token": o.from_token,
                            "to_token": o.to_token,
                            "trigger_price": o.trigger_price,
                            "trailing_percent": o.trailing_percent,
                            "highest_price_seen": o.highest_price_seen,
                        }
                    )
                # Mark expired in same session
                if expired_ids:
                    for oid in expired_ids:
                        order = session.query(LimitOrder).filter(LimitOrder.id == oid).first()
                        if order:
                            order.status = OrderStatus.EXPIRED.value
                return result

        order_data = await run_in_db(_fetch_pending)
        if not order_data:
            return []

        # Phase 2: Fetch prices (async, non-blocking)
        tokens = set()
        for od in order_data:
            if od["order_type"] in [OrderType.LIMIT_BUY.value, OrderType.STOP_LOSS.value]:
                tokens.add(od["to_token"])
            elif od["order_type"] == OrderType.TRAILING_STOP.value:
                tokens.add(od["from_token"])
            else:
                tokens.add(od["from_token"])

        try:
            prices = await asyncio.wait_for(price_service.get_prices(list(tokens)), timeout=10)
        except asyncio.TimeoutError:
            logger.warning("Limit-order price fetch timed out; skipping this cycle")
            return []

        # Phase 3: Evaluate triggers and write back (non-blocking)
        triggered_ids = []
        # TRAILING_STOP: map of order_id -> new peak price (to be persisted even if not triggered)
        trailing_peak_updates: dict = {}

        for od in order_data:
            otype = od["order_type"]
            if otype == OrderType.LIMIT_BUY.value:
                price = prices.get(od["to_token"], 0)
                should_trigger = price <= od["trigger_price"]
            elif otype == OrderType.LIMIT_SELL.value:
                price = prices.get(od["from_token"], 0)
                should_trigger = price >= od["trigger_price"]
            elif otype == OrderType.STOP_LOSS.value:
                price = prices.get(od["from_token"], 0)
                should_trigger = price <= od["trigger_price"]
            elif otype == OrderType.TAKE_PROFIT.value:
                price = prices.get(od["from_token"], 0)
                should_trigger = price >= od["trigger_price"]
            elif otype == OrderType.TRAILING_STOP.value:
                # MONEY-PATH: trailing stop triggers sell execution
                price = prices.get(od["from_token"], 0)
                if price <= 0:
                    continue
                pct = od.get("trailing_percent") or 0.0
                if pct <= 0:
                    continue
                prev_peak = od.get("highest_price_seen")
                new_peak = max(price, prev_peak) if prev_peak is not None else price
                trailing_peak_updates[od["id"]] = new_peak
                dynamic_trigger = new_peak * (1 - pct / 100)
                should_trigger = price <= dynamic_trigger
            else:
                continue

            if should_trigger and price > 0:
                triggered_ids.append((od["id"], price))

        if not triggered_ids and not trailing_peak_updates:
            return []

        triggered_id_set = {oid for oid, _ in triggered_ids}

        def _mark_triggered():
            with get_session() as session:
                # Persist highest_price_seen for all trailing stops seen this cycle
                # (even those not yet triggered, so the ratchet survives across polls)
                for oid, new_peak in trailing_peak_updates.items():
                    if oid not in triggered_id_set:
                        order = session.query(LimitOrder).filter(LimitOrder.id == oid).first()
                        if order:
                            order.highest_price_seen = new_peak
                # Flush peak updates before processing triggers to avoid a race where
                # the same order gets re-evaluated mid-session with stale peak data.
                session.flush()

                triggered = []
                for oid, exec_price in triggered_ids:
                    order = session.query(LimitOrder).filter(LimitOrder.id == oid).first()
                    if order:
                        if oid in trailing_peak_updates:
                            order.highest_price_seen = trailing_peak_updates[oid]
                        order.status = OrderStatus.TRIGGERED.value
                        order.execution_price = exec_price
                        triggered.append(order)
                return triggered

        return await run_in_db(_mark_triggered)

    # === DCA Orders ===

    def create_dca_order(
        self,
        user_id: int,
        wallet_id: int,
        from_chain: str,
        from_token: str,
        to_chain: str,
        to_token: str,
        amount_per_execution: str,
        interval_hours: int,
        max_executions: int = None,
        ends_in_days: int = None,
    ) -> DCAOrder:
        """Create a new DCA order."""
        with get_session() as session:
            order = DCAOrder(
                user_id=user_id,
                wallet_id=wallet_id,
                from_chain=from_chain,
                from_token=from_token,
                to_chain=to_chain,
                to_token=to_token,
                amount_per_execution=amount_per_execution,
                interval_hours=interval_hours,
                next_execution_at=datetime.utcnow(),  # Execute first one immediately
                max_executions=max_executions,
            )

            if ends_in_days:
                order.ends_at = datetime.utcnow() + timedelta(days=ends_in_days)

            session.add(order)
            session.flush()
            order_id = order.id

        with get_session() as session:
            return session.query(DCAOrder).filter(DCAOrder.id == order_id).first()

    def get_user_dca_orders(
        self,
        user_id: int,
        active_only: bool = True,
    ) -> List[DCAOrder]:
        """Get DCA orders for a user."""
        with get_session() as session:
            query = session.query(DCAOrder).filter(DCAOrder.user_id == user_id)

            if active_only:
                query = query.filter(DCAOrder.status == DCAStatus.ACTIVE.value)

            return query.order_by(DCAOrder.created_at.desc()).all()

    def pause_dca(self, order_id: int, user_id: int) -> bool:
        """Pause a DCA order."""
        with get_session() as session:
            order = (
                session.query(DCAOrder)
                .filter(
                    DCAOrder.id == order_id,
                    DCAOrder.user_id == user_id,
                    DCAOrder.status == DCAStatus.ACTIVE.value,
                )
                .first()
            )

            if order:
                order.status = DCAStatus.PAUSED.value
                return True
            return False

    def resume_dca(self, order_id: int, user_id: int) -> bool:
        """Resume a paused DCA order.

        Refuses while the plan's last attempt is still unverified. A tranche
        whose swap sits at UNKNOWN may already have moved funds, and its
        idempotency key cannot advance until that row resolves (the key is
        keyed on executions_completed, which deliberately did not increment).
        Resuming regardless would set next_execution_at to now, the scanner
        would pick the plan up on its next tick, the guard would hand back the
        same unverified row, and the plan would pause again — an immediate,
        unbreakable loop that also burns a provider quote on every pass.
        Resolve the swap first, then resume.
        """
        with get_session() as session:
            order = (
                session.query(DCAOrder)
                .filter(
                    DCAOrder.id == order_id,
                    DCAOrder.user_id == user_id,
                    DCAOrder.status == DCAStatus.PAUSED.value,
                )
                .first()
            )

            if not order:
                return False

            blocking = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.idempotency_key == _dca_order_key(order),
                    SwapTransaction.status == SwapStatus.UNKNOWN.value,
                )
                .first()
            )
            if blocking:
                logger.error(
                    "Refusing to resume DCA order %d: swap %s is UNKNOWN (may have "
                    "broadcast, outcome unverified). Verify it on-chain and resolve the "
                    "swap row first, or the plan would immediately re-pause.",
                    order.id,
                    blocking.id,
                )
                return False

            order.status = DCAStatus.ACTIVE.value
            order.next_execution_at = datetime.utcnow()
            return True

    def cancel_dca(self, order_id: int, user_id: int) -> bool:
        """Cancel a DCA order."""
        with get_session() as session:
            order = (
                session.query(DCAOrder)
                .filter(
                    DCAOrder.id == order_id,
                    DCAOrder.user_id == user_id,
                    DCAOrder.status.in_([DCAStatus.ACTIVE.value, DCAStatus.PAUSED.value]),
                )
                .first()
            )

            if order:
                order.status = DCAStatus.CANCELLED.value
                return True
            return False

    async def check_dca_orders(self) -> List[DCAOrder]:
        """Check DCA orders due for execution."""

        def _check():
            due_orders = []
            now = datetime.utcnow()

            with get_session() as session:
                orders = (
                    session.query(DCAOrder)
                    .filter(
                        DCAOrder.status == DCAStatus.ACTIVE.value,
                        DCAOrder.next_execution_at <= now,
                    )
                    .all()
                )

                for order in orders:
                    if order.ends_at and order.ends_at < now:
                        order.status = DCAStatus.COMPLETED.value
                        continue

                    if order.max_executions and order.executions_completed >= order.max_executions:
                        order.status = DCAStatus.COMPLETED.value
                        continue

                    due_orders.append(order)

            return due_orders

        return await run_in_db(_check)

    # === Swap Templates ===

    def create_template(
        self,
        user_id: int,
        name: str,
        from_chain: str,
        from_token: str,
        to_chain: str,
        to_token: str,
        default_amount: str = None,
        slippage: float = 0.5,
    ) -> SwapTemplate:
        """Create a swap template."""
        with get_session() as session:
            template = SwapTemplate(
                user_id=user_id,
                name=name,
                from_chain=from_chain,
                from_token=from_token,
                to_chain=to_chain,
                to_token=to_token,
                default_amount=default_amount,
                slippage=slippage,
            )
            session.add(template)
            session.flush()
            template_id = template.id

        with get_session() as session:
            return session.query(SwapTemplate).filter(SwapTemplate.id == template_id).first()

    def get_user_templates(self, user_id: int) -> List[SwapTemplate]:
        """Get swap templates for a user."""
        with get_session() as session:
            return (
                session.query(SwapTemplate)
                .filter(SwapTemplate.user_id == user_id)
                .order_by(SwapTemplate.use_count.desc())
                .all()
            )

    def use_template(self, template_id: int, user_id: int) -> Optional[SwapTemplate]:
        """Mark template as used and return it."""
        with get_session() as session:
            template = (
                session.query(SwapTemplate)
                .filter(
                    SwapTemplate.id == template_id,
                    SwapTemplate.user_id == user_id,
                )
                .first()
            )

            if template:
                template.use_count += 1
                template.last_used_at = datetime.utcnow()
                return template
            return None

    def delete_template(self, template_id: int, user_id: int) -> bool:
        """Delete a swap template."""
        with get_session() as session:
            template = (
                session.query(SwapTemplate)
                .filter(
                    SwapTemplate.id == template_id,
                    SwapTemplate.user_id == user_id,
                )
                .first()
            )

            if template:
                session.delete(template)
                return True
            return False

    # === Background Task ===

    async def start(self, bot=None, swap_engine: SwapEngine = None):
        """Start the order checking background task."""
        if self._running:
            return

        self._running = True
        self._bot = bot
        self._swap_engine = swap_engine or SwapEngine()
        self._task = asyncio.create_task(self._order_loop())
        logger.info("Order service started")

    async def stop(self):
        """Stop the order checking task."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                logger.debug("Order service task cancelled during stop()")
        logger.info("Order service stopped")

    async def _order_loop(self):
        """Main order checking loop."""
        while self._running:
            try:
                # Check limit orders
                triggered_limits = await self.check_limit_orders()
                for order in triggered_limits:
                    try:
                        await self._execute_limit_order(order)
                    except Exception as e:
                        logger.error(f"Limit order loop item failed: {e}")
                        continue

                # Check DCA orders
                due_dca = await self.check_dca_orders()
                for order in due_dca:
                    try:
                        await self._execute_dca_order(order)
                    except Exception as e:
                        logger.error(f"DCA order loop item failed: {e}")
                        continue

            except Exception as e:
                logger.error(f"Order check error: {e}")

            await asyncio.sleep(self._check_interval)

    async def _execute_limit_order(self, order: LimitOrder):
        """Execute a triggered limit order using SwapEngine."""
        if not self._swap_engine:
            logger.error("No swap engine configured for Limit Order execution")
            return

        logger.info(
            f"Executing Limit Order {order.id} ({order.order_type}) for user {order.user_id}"
        )

        try:
            # 1. Get Wallet
            from bot.services.wallet import WalletService

            ws = WalletService()
            wallet = ws.get_wallet_by_id(order.wallet_id)

            if not wallet:
                logger.error(f"Wallet {order.wallet_id} not found for Limit Order {order.id}")
                return

            # 2. Get Quote
            # Note: order.amount is stored as raw string
            # We need to convert it to human-readable for SwapEngine.get_quote
            from bot.config.tokens import get_token_decimals

            decimals = get_token_decimals(order.from_token, order.from_chain)
            amount_human = float(order.amount) / (10**decimals)

            quote = await self._swap_engine.get_quote(
                from_chain=order.from_chain,
                to_chain=order.to_chain,
                from_token=order.from_token,
                to_token=order.to_token,
                amount=amount_human,
                from_address=wallet.address,
                slippage=order.slippage,
                user_id=order.user_id,
            )

            # 3. Execute Swap
            #
            # The key is stable across retries ON PURPOSE. It used to carry a
            # UTC hour bucket, which silently defeated the idempotency guard
            # every time the clock rolled over: the guard looks the key up and
            # only permits a retry when the existing swap is FAILED or
            # CANCELLED, but a new hour produced a key that matched nothing, so
            # the guard was bypassed and the order broadcast again regardless
            # of what the first attempt had done. With a stable key the swap's
            # own status decides, which is what the guard is for — a genuinely
            # failed attempt still retries, and one whose outcome is unknown
            # does not.
            idempotency_key = _limit_order_key(order)

            swap_tx = await self._swap_engine.execute_swap(
                quote=quote,
                wallet_id=order.wallet_id,
                user_id=order.user_id,
                idempotency_key=idempotency_key,
                automated=True,
            )

            # 4. Update status on submission
            if swap_tx and swap_tx.status in [
                SwapStatus.SUBMITTED.value,
                SwapStatus.COMPLETED.value,
            ]:
                with get_session() as session:
                    db_order = session.query(LimitOrder).filter(LimitOrder.id == order.id).first()
                    if db_order:
                        db_order.status = OrderStatus.EXECUTED.value
                        db_order.executed_at = datetime.utcnow()
                        db_order.tx_hash = swap_tx.tx_hash

                # Notify user
                if self._bot:
                    await self._notify_order_executed(order, swap_tx)

            elif swap_tx and swap_tx.status == SwapStatus.UNKNOWN.value:
                # The swap may already have broadcast and we cannot prove it.
                # Take the order out of PENDING so the scanner stops re-firing
                # it: the stable idempotency key means each retry would just
                # hand back this same row, looping forever without ever
                # advancing, and the one thing we must never do is send again.
                # A human verifies on-chain and places a fresh order.
                with get_session() as session:
                    db_order = session.query(LimitOrder).filter(LimitOrder.id == order.id).first()
                    if db_order:
                        db_order.status = OrderStatus.FAILED.value
                logger.error(
                    "Limit order %d held: swap %s is UNKNOWN (may have broadcast, outcome "
                    "unverified). Not retried to avoid a duplicate send; needs on-chain "
                    "verification.",
                    order.id,
                    swap_tx.id,
                )

        except Exception as e:
            logger.error(f"Limit order execution failed for order {order.id}: {e}")
            with get_session() as session:
                db_order = session.query(LimitOrder).filter(LimitOrder.id == order.id).first()
                if db_order:
                    db_order.status = OrderStatus.FAILED.value

    async def _execute_dca_order(self, order: DCAOrder):
        """Execute a due DCA order using SwapEngine."""
        if not self._swap_engine:
            logger.error("No swap engine configured for DCA execution")
            return

        logger.info(f"Executing DCA order {order.id} for user {order.user_id}")

        try:
            # 1. Get Quote
            from bot.services.wallet import WalletService

            ws = WalletService()
            wallet = ws.get_wallet_by_id(order.wallet_id)

            if not wallet:
                logger.error(f"Wallet {order.wallet_id} not found for DCA {order.id}")
                return

            # Convert amount for quote
            from bot.config.tokens import get_token_decimals

            decimals = get_token_decimals(order.from_token, order.from_chain)
            amount_human = float(order.amount_per_execution) / (10**decimals)

            quote = await self._swap_engine.get_quote(
                from_chain=order.from_chain,
                to_chain=order.to_chain,
                from_token=order.from_token,
                to_token=order.to_token,
                amount=amount_human,
                from_address=wallet.address,
                user_id=order.user_id,
            )

            # 2. Execute Swap
            #
            # Keyed on the execution index, with no hour bucket — see the
            # limit-order path above for why the bucket was unsafe.
            # executions_completed only advances on a confirmed submit, so a
            # failed execution retries under the same key and the guard decides
            # from the swap's status.
            idempotency_key = _dca_order_key(order)

            swap_tx = await self._swap_engine.execute_swap(
                quote=quote,
                wallet_id=order.wallet_id,
                user_id=order.user_id,
                idempotency_key=idempotency_key,
                automated=True,
            )

            # 3. Update DCA Stats on success
            if swap_tx and swap_tx.status in [
                SwapStatus.SUBMITTED.value,
                SwapStatus.COMPLETED.value,
            ]:
                with get_session() as session:
                    db_order = session.query(DCAOrder).filter(DCAOrder.id == order.id).first()
                    if db_order:
                        db_order.executions_completed += 1
                        db_order.total_spent = str(
                            int(db_order.total_spent) + int(order.amount_per_execution)
                        )
                        # Update next execution time
                        db_order.next_execution_at = datetime.utcnow() + timedelta(
                            hours=db_order.interval_hours
                        )

                        # Record individual execution
                        execution = DCAExecution(
                            dca_order_id=order.id,
                            amount_spent=order.amount_per_execution,
                            amount_received=swap_tx.to_amount,
                            price=quote.exchange_rate,
                            tx_hash=swap_tx.tx_hash,
                        )
                        session.add(execution)

                # Notify user
                if self._bot:
                    await self._notify_dca_executed(order, swap_tx)

            elif swap_tx and swap_tx.status == SwapStatus.UNKNOWN.value:
                # May already have broadcast, outcome unprovable. Pause the
                # schedule rather than let it come due again: executions_completed
                # deliberately does NOT advance, so the key stays the same and
                # every future attempt would hand back this same row forever.
                # PAUSED stops the schedule coming due again. resume_dca
                # refuses while this swap is still UNKNOWN, so the plan cannot
                # be restarted into an instant re-pause loop; it continues only
                # once the tranche has been verified and the swap row resolved.
                with get_session() as session:
                    db_order = session.query(DCAOrder).filter(DCAOrder.id == order.id).first()
                    if db_order:
                        db_order.status = DCAStatus.PAUSED.value
                logger.error(
                    "DCA order %d paused: swap %s is UNKNOWN (may have broadcast, outcome "
                    "unverified). Execution %d not counted and not retried, to avoid a "
                    "duplicate send; needs on-chain verification before resuming.",
                    order.id,
                    swap_tx.id,
                    order.executions_completed,
                )

        except Exception as e:
            logger.error(f"DCA execution failed for order {order.id}: {e}")
            # If it fails, we might want to retry later or pause it
            # For now, just log and wait for next interval

    async def _notify_order_executed(self, order: LimitOrder, swap_tx=None):
        """Notify user of executed limit order via Telegram and, if linked, WhatsApp."""
        try:
            from bot.models.user import User

            telegram_id = None
            whatsapp_id = None
            with get_session() as session:
                user = session.query(User).filter(User.id == order.user_id).first()
                if user:
                    telegram_id = user.telegram_id
                    whatsapp_id = user.whatsapp_id
                    user_settings = (
                        session.query(UserSettings).filter(UserSettings.user_id == user.id).first()
                    )
                    if user_settings and not getattr(user_settings, "notify_order_triggered", True):
                        return

            if telegram_id:
                tx_info = ""
                if swap_tx and swap_tx.tx_hash:
                    from bot.utils.formatters import format_tx_link

                    tx_info = f"\n🔗 {format_tx_link(swap_tx.tx_hash, order.from_chain)}"

                if order.order_type == OrderType.TRAILING_STOP.value:
                    peak = order.highest_price_seen or order.execution_price or 0
                    pct = order.trailing_percent or 0
                    trigger_line = f"Trailing stop: {pct}% below peak (${peak:.4f})"
                else:
                    trigger_line = f"Trigger price: ${order.trigger_price:.4f}"
                text = (
                    f"✅ *Limit Order Executed!*\n\n"
                    f"Type: {order.order_type.upper()}\n"
                    f"Swap: {order.from_token} → {order.to_token}\n"
                    f"{trigger_line}"
                    f"{tx_info}"
                )
                await self._bot.send_message(
                    chat_id=telegram_id,
                    text=text,
                    parse_mode="Markdown",
                    disable_web_page_preview=True,
                )

            if whatsapp_id:
                try:
                    from bot.services.whatsapp_service import whatsapp_service
                    from bot.services.whatsapp_templates import template_service

                    if whatsapp_service.is_configured():
                        exec_price = (
                            f"{order.execution_price:.4f}"
                            if order.execution_price
                            else f"{order.trigger_price:.4f}"
                        )
                        await template_service.send_order_executed(
                            to=whatsapp_id,
                            order_type=order.order_type.upper(),
                            token=order.from_token,
                            amount=order.amount,
                            price=exec_price,
                        )
                except Exception as wa_exc:
                    logger.warning(
                        f"WhatsApp order notification failed for user {order.user_id}: {wa_exc}"
                    )
        except Exception as e:
            logger.error(f"Order notification failed: {e}")

    async def _notify_dca_executed(self, order: DCAOrder, swap_tx=None):
        """Notify user of executed DCA via Telegram and, if linked, WhatsApp."""
        try:
            from bot.models.user import User

            telegram_id = None
            whatsapp_id = None
            with get_session() as session:
                user = session.query(User).filter(User.id == order.user_id).first()
                if user:
                    telegram_id = user.telegram_id
                    whatsapp_id = user.whatsapp_id

            if telegram_id:
                tx_info = ""
                if swap_tx and swap_tx.tx_hash:
                    from bot.utils.formatters import format_tx_link

                    tx_info = f"\n🔗 {format_tx_link(swap_tx.tx_hash, order.from_chain)}"

                text = (
                    f"📊 *DCA Trade Executed!*\n\n"
                    f"Order: {order.from_token} → {order.to_token}\n"
                    f"Progress: {order.executions_completed}/{order.max_executions or '∞'}\n"
                    f"Next execution: {order.next_execution_at.strftime('%Y-%m-%d %H:%M')}UTC"
                    f"{tx_info}"
                )
                await self._bot.send_message(
                    chat_id=telegram_id,
                    text=text,
                    parse_mode="Markdown",
                    disable_web_page_preview=True,
                )

            if whatsapp_id:
                try:
                    from bot.services.whatsapp_service import whatsapp_service
                    from bot.services.whatsapp_templates import template_service

                    if whatsapp_service.is_configured():
                        exec_price = (
                            f"{swap_tx.exchange_rate:.4f}"
                            if swap_tx
                            and hasattr(swap_tx, "exchange_rate")
                            and swap_tx.exchange_rate
                            else "market"
                        )
                        await template_service.send_order_executed(
                            to=whatsapp_id,
                            order_type="DCA",
                            token=order.from_token,
                            amount=order.amount_per_execution,
                            price=exec_price,
                        )
                except Exception as wa_exc:
                    logger.warning(
                        f"WhatsApp DCA notification failed for user {order.user_id}: {wa_exc}"
                    )
        except Exception as e:
            logger.error(f"DCA notification failed: {e}")


# Global instance
order_service = OrderService()
