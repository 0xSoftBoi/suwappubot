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


# A swap that has not reached a terminal outcome yet.
#
# Deliberately an ALLOWLIST, not "everything that is not terminal". A status
# added to SwapStatus later is then NOT silently treated as in flight; it falls
# through to the conservative branch that stops the order instead of leaving it
# to be re-selected forever. This mirrors the denylist/allowlist reasoning in
# SwapEngine's retry guard: the safe default for an unrecognised status is to
# stop, never to try again.
_IN_FLIGHT_STATUSES = (
    SwapStatus.PENDING.value,
    SwapStatus.QUOTE_RECEIVED.value,
    SwapStatus.AWAITING_APPROVAL.value,
    SwapStatus.APPROVED.value,
    SwapStatus.SIGNED.value,
    SwapStatus.EXECUTING.value,
    SwapStatus.CONFIRMING.value,
)

# A swap that reached a confirmed submit or better.
_SUBMITTED_STATUSES = (
    SwapStatus.SUBMITTED.value,
    SwapStatus.COMPLETED.value,
)

# How long to leave an order alone while its swap is still in flight.
#
# The scanner ticks every 30s. Before this backoff existed a DCA plan whose
# tranche sat in CONFIRMING kept its next_execution_at in the past, so every
# tick re-selected it and fetched a fresh provider quote before the idempotency
# guard handed back the same row — one wasted quote every 30 seconds for as
# long as a cross-chain leg took to settle, which for a bridge is minutes to
# hours. A cross-chain settle is the long case, so the backoff is sized for it
# rather than for a same-chain confirm.
_IN_FLIGHT_BACKOFF = timedelta(minutes=10)

# How long to wait before re-attempting a DCA tranche whose swap genuinely
# failed. Such a swap IS retryable (nothing moved), but retrying on the 30s
# scanner tick means a plan whose quotes keep failing re-quotes 120 times an
# hour. Back off instead; the plan keeps its place in the schedule.
_FAILED_RETRY_BACKOFF = timedelta(minutes=15)

# How long a TRIGGERED order with NO swap row at all is left alone before
# reconciliation calls it failed.
#
# Without this the reconciler races the executor. _mark_triggered writes
# TRIGGERED *before* execution, so between that write and execute_swap's insert
# there is a window where the order legitimately has no swap row — and
# USE_WEBHOOK=true runs multiple replicas, so another replica can be inside
# that window (or mid-broadcast, since the row is inserted before the send)
# while this one reconciles. Failing the order there would both lie to the user
# ("no funds were sent") and mark an order failed that is about to execute.
# Nothing is retried on the strength of this, so the grace window only delays a
# notification; it never risks a second send.
_TRIGGERED_GRACE = timedelta(minutes=30)

# Deliberately generous, because the window it covers is NOT bounded by the
# write-then-insert gap alone: _mark_triggered → get_quote → balance checks →
# execute_swap's insert spans provider calls and RPC retries, so there is no
# tight upper bound on how long an order legitimately has no swap row. The
# grace window alone therefore cannot make this safe, and it is not relied on
# to: _fail_limit_order only writes from TRIGGERED, and a resolved swap
# re-opens a prematurely failed order (see _reconcile_triggered_orders), so a
# wrong verdict here self-heals instead of sticking.

# LimitOrder.error_message is VARCHAR(500) in the SQLAlchemy model, but the
# Drizzle schema for the same table declares it as TEXT, so the live column
# may be either depending on which ORM created the table first (see
# database/db.py:_reconcile_cross_orm_tables). Truncate rather than trust the
# wider of the two: a provider error string with an embedded payload can run
# to several KB, and on the VARCHAR shape Postgres rejects the whole UPDATE —
# which would turn "record why the order failed" into "lose the order's
# terminal status as well as the reason".
_ERROR_MESSAGE_MAX = 500


def _truncate_reason(reason: str) -> str:
    reason = " ".join(str(reason).split())
    if len(reason) <= _ERROR_MESSAGE_MAX:
        return reason
    return reason[: _ERROR_MESSAGE_MAX - 1] + "…"


def _find_swap_for_key(session, idempotency_key: str):
    """The swap row a previous attempt under this key created, if any.

    Read-only and cheap: the column carries a UNIQUE index, so this is an
    index lookup. It exists so an order can ask "is my own attempt still in
    flight?" WITHOUT paying for a provider quote first, which is the whole
    point of the in-flight branches below.
    """
    return (
        session.query(SwapTransaction)
        .filter(SwapTransaction.idempotency_key == idempotency_key)
        .first()
    )


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

                # Finalise orders left at TRIGGERED by an unconfirmed swap.
                # Cheap (one indexed lookup per stuck order, no quotes, no
                # sends) and it is the only thing that picks such an order up
                # again, since check_limit_orders only selects PENDING.
                try:
                    await self._reconcile_triggered_orders()
                except Exception as e:
                    logger.error(f"Triggered-order reconciliation failed: {e}")

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
            if swap_tx and swap_tx.status in _SUBMITTED_STATUSES:
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
                reason = (
                    f"Execution outcome could not be verified. The swap may have been "
                    f"broadcast on-chain but its result is unconfirmed, so it was not "
                    f"retried — retrying could have sent your funds twice. Check the "
                    f"wallet on-chain before placing a replacement order. (swap "
                    f"#{swap_tx.id})"
                )
                changed = await run_in_db(
                    lambda: self._fail_limit_order(
                        order.id, reason, getattr(swap_tx, "tx_hash", None)
                    )
                )
                logger.error(
                    "Limit order %d held: swap %s is UNKNOWN (may have broadcast, outcome "
                    "unverified). Not retried to avoid a duplicate send; needs on-chain "
                    "verification.",
                    order.id,
                    swap_tx.id,
                )
                # The order is dead and the user's funds may have moved. This
                # is the single most important case to TELL them about, and it
                # was the one case that said nothing at all.
                if self._bot and changed:
                    await self._notify_order_failed(order, reason, needs_verification=True)

            elif swap_tx and swap_tx.status in _IN_FLIGHT_STATUSES:
                # Submitted but not yet confirmed. Leave the order at TRIGGERED
                # and leave the swap alone — the tx poller owns it from here.
                #
                # This is NOT a terminal state for the order, so it must not be
                # failed or notified as a failure. It is instead picked up by
                # _reconcile_triggered_orders on a later tick, which finalises
                # the order from the swap's resolved status without quoting or
                # sending anything. Before that pass existed, this branch did
                # not exist either: a non-terminal swap fell off the end of the
                # if/elif chain and the order sat at TRIGGERED forever, with
                # nothing to pick it up, because check_limit_orders only ever
                # selects PENDING.
                logger.info(
                    "Limit order %d awaiting confirmation: swap %s is %s. Order stays "
                    "TRIGGERED; it will be finalised once the swap settles.",
                    order.id,
                    swap_tx.id,
                    swap_tx.status,
                )

            else:
                # FAILED, CANCELLED, an unrecognised status, or no swap row at
                # all. A limit order is one-shot — check_limit_orders only
                # selects PENDING and _mark_triggered already moved this one to
                # TRIGGERED — so there is no retry to wait for and no second
                # pass to explain itself. Record the reason and tell the user,
                # instead of leaving the order stalled at TRIGGERED in silence.
                status_text = getattr(swap_tx, "status", None) or "no swap was created"
                failed_hash = getattr(swap_tx, "tx_hash", None)
                if failed_hash:
                    # Broadcast, then failed — tx_poller's mined-origin /
                    # unsettled-bridge case. Funds are gone from the wallet, so
                    # this must never read "no funds were sent" or suggest
                    # re-ordering. See the matching branch in
                    # _reconcile_triggered_orders.
                    reason = (
                        f"The swap was broadcast on-chain but did not complete (status: "
                        f"{status_text}). Funds have left your wallet, so do NOT assume "
                        f"nothing was sent — a cross-chain leg can still settle later. "
                        f"Check the transaction before placing another order."
                    )
                    needs_verification = True
                else:
                    reason = (
                        f"The swap did not go through (status: {status_text}). No funds were "
                        f"sent. Place a new order to try again."
                    )
                    needs_verification = False
                changed = await run_in_db(
                    lambda: self._fail_limit_order(order.id, reason, failed_hash)
                )
                logger.warning(
                    "Limit order %d failed: swap %s status %s (tx_hash %s).",
                    order.id,
                    getattr(swap_tx, "id", None),
                    getattr(swap_tx, "status", None),
                    failed_hash,
                )
                if self._bot and changed:
                    await self._notify_order_failed(
                        order, reason, needs_verification=needs_verification
                    )

        except Exception as e:
            logger.error(f"Limit order execution failed for order {order.id}: {e}")
            # Record WHY and tell the user. This path used to write a bare
            # FAILED with the cause only in the process log, so from the user's
            # side a triggered order simply vanished.
            #
            # The reason is deliberately generic: `e` can carry provider
            # payloads, URLs with query strings, and internal addresses, none
            # of which belong in a Telegram message. The full exception is in
            # the log line above, keyed by order id.
            # Do NOT assert "no funds were sent" without checking. The try
            # block spans execute_swap, and although #1122 made that method
            # swallow its own post-broadcast errors into an UNKNOWN row rather
            # than raising, an exception arriving here is not proof that
            # nothing went out. Ask the row: if a swap exists under this
            # order's key and it either carries a hash or is UNKNOWN, the honest
            # answer is "unverified", not "nothing happened".
            try:
                existing = await run_in_db(lambda: self._peek_swap_for_key(_limit_order_key(order)))
            except Exception:
                existing = None
            sent_maybe = existing is not None and (
                existing[2] is not None or existing[1] == SwapStatus.UNKNOWN.value
            )
            if sent_maybe:
                reason = (
                    "The swap could not be completed and its outcome could not be "
                    "verified. Funds may have left your wallet, so do NOT assume nothing "
                    "was sent — check on-chain before placing another order."
                )
            else:
                # The reason is deliberately generic: `e` can carry provider
                # payloads, URLs with query strings, and internal addresses,
                # none of which belong in a Telegram message. The full
                # exception is in the log line above, keyed by order id.
                reason = (
                    "The swap could not be executed because of an internal error. No funds "
                    "were sent. Please place a new order."
                )
            try:
                changed = await run_in_db(
                    lambda: self._fail_limit_order(
                        order.id, reason, None if existing is None else existing[2]
                    )
                )
                if self._bot and changed:
                    await self._notify_order_failed(order, reason, needs_verification=sent_maybe)
            except Exception as notify_exc:
                # Never let the failure bookkeeping mask the original failure.
                logger.error(
                    "Limit order %d: could not record or notify the failure: %s",
                    order.id,
                    notify_exc,
                )

    @staticmethod
    def _load_limit_order(order_id: int):
        """Read one limit order for the notification helpers.

        The notifiers only read scalar attributes, and get_session's rows stay
        readable after the block in this codebase's session setup (the same
        pattern create_order and get_user_orders already rely on).
        """
        with get_session() as session:
            return session.query(LimitOrder).filter(LimitOrder.id == order_id).first()

    @staticmethod
    def _fail_limit_order(order_id: int, reason: str, tx_hash: Optional[str] = None) -> bool:
        """Mark a TRIGGERED limit order FAILED and record why. True if it changed.

        The status filter is load-bearing, not defensive. Two writers can reach
        this row: the executor and the reconciliation pass, on different
        replicas. An unconditional write let the reconciler stamp FAILED over
        an order the executor was about to complete, and the caller notified
        regardless — so the user got "no funds were sent" for a swap that then
        landed. Conditioning on TRIGGERED means the second writer loses, and
        returning whether anything changed lets the caller stay quiet when it
        did.
        """
        with get_session() as session:
            db_order = (
                session.query(LimitOrder)
                .filter(
                    LimitOrder.id == order_id,
                    LimitOrder.status == OrderStatus.TRIGGERED.value,
                )
                .first()
            )
            if db_order is None:
                return False
            db_order.status = OrderStatus.FAILED.value
            db_order.error_message = _truncate_reason(reason)
            # Persist the hash when there is one: these are the rows where
            # funds demonstrably left the wallet, so the user needs the
            # explorer link more than for any other outcome.
            if tx_hash:
                db_order.tx_hash = tx_hash
            return True

    @staticmethod
    def _triggered_order_snapshot():
        """Plain snapshots of every limit order stuck at TRIGGERED.

        Returns tuples, not ORM rows, because the caller awaits between
        reading and acting and must not touch a detached instance.
        """
        with get_session() as session:
            orders = (
                session.query(LimitOrder)
                .filter(LimitOrder.status == OrderStatus.TRIGGERED.value)
                .all()
            )
            out = []
            for o in orders:
                swap = _find_swap_for_key(session, _limit_order_key(o))
                out.append(
                    (
                        o.id,
                        None if swap is None else swap.id,
                        None if swap is None else swap.status,
                        None if swap is None else swap.tx_hash,
                        # When the order last changed — _mark_triggered's write.
                        # Used to hold off on the "no swap row" verdict while the
                        # executor may still be between TRIGGERED and its insert.
                        o.updated_at or o.created_at,
                    )
                )
            return out

    async def _reconcile_triggered_orders(self) -> None:
        """Finalise limit orders whose swap has since resolved.

        A limit order is one-shot: _mark_triggered moves it to TRIGGERED
        *before* execution and check_limit_orders only ever selects PENDING, so
        the order is picked up exactly once. If execution returned a swap that
        was not yet terminal, nothing came back for it and the order sat at
        TRIGGERED forever — no notification, no retry, no record of why.

        This pass closes that. It reads the swap each TRIGGERED order already
        created, by that order's own stable idempotency key, and projects the
        swap's resolved status onto the order. It NEVER quotes and NEVER calls
        execute_swap, so it cannot send anything and costs one indexed lookup
        per stuck order — safe to run on every scanner tick.
        """
        try:
            snapshots = await run_in_db(self._triggered_order_snapshot)
        except Exception as e:
            logger.error(f"Could not read triggered limit orders for reconciliation: {e}")
            return

        for order_id, swap_id, swap_status, tx_hash, touched_at in snapshots:
            if swap_status is None and (
                touched_at is None or datetime.utcnow() - touched_at < _TRIGGERED_GRACE
            ):
                # The executor may still be between _mark_triggered and its
                # insert — possibly on another replica, possibly already
                # broadcasting. Say nothing yet; check again next tick.
                continue

            if swap_status in _IN_FLIGHT_STATUSES:
                # Still settling. The poller owns it; check again next tick.
                continue

            if swap_status in _SUBMITTED_STATUSES:
                # It landed after all. Complete the order the same way the
                # execution path would have, so the user gets the confirmation
                # they were owed and the order stops showing as open.
                def _execute(oid=order_id, h=tx_hash):
                    with get_session() as session:
                        # FAILED is accepted as well as TRIGGERED, on purpose:
                        # a confirmed submit is the strongest evidence there
                        # is, so it overrides an earlier FAILED verdict — which
                        # is how a premature failure (this pass racing a slow
                        # executor on another replica) corrects itself instead
                        # of leaving the order permanently wrong. Any other
                        # status means someone else already settled it.
                        db_order = (
                            session.query(LimitOrder)
                            .filter(
                                LimitOrder.id == oid,
                                LimitOrder.status.in_(
                                    [
                                        OrderStatus.TRIGGERED.value,
                                        OrderStatus.FAILED.value,
                                    ]
                                ),
                            )
                            .first()
                        )
                        if not db_order:
                            return None
                        db_order.status = OrderStatus.EXECUTED.value
                        db_order.executed_at = datetime.utcnow()
                        db_order.tx_hash = h
                        db_order.error_message = None
                        session.flush()
                        return db_order

                try:
                    finalised = await run_in_db(_execute)
                except Exception as e:
                    logger.error(f"Limit order {order_id}: could not finalise as executed: {e}")
                    continue
                logger.info(
                    "Limit order %d finalised as EXECUTED from swap %s (resolved after the "
                    "execution pass returned it unconfirmed).",
                    order_id,
                    swap_id,
                )
                if self._bot and finalised is not None:
                    await self._notify_order_executed(finalised)
                continue

            if swap_status == SwapStatus.UNKNOWN.value:
                reason = (
                    f"Execution outcome could not be verified. The swap may have been "
                    f"broadcast on-chain but its result is unconfirmed, so it was not "
                    f"retried — retrying could have sent your funds twice. Check the "
                    f"wallet on-chain before placing a replacement order. (swap #{swap_id})"
                )
                needs_verification = True
            elif swap_status is None:
                # TRIGGERED but no swap row under this order's key at all: the
                # process died between _mark_triggered and execute_swap's
                # insert. Nothing was ever sent, so this is safe to call
                # failed — and it must be called something, or the order stays
                # open forever in the user's order list.
                reason = (
                    "The order was triggered but execution never started, so no funds were "
                    "sent. Place a new order to try again."
                )
                needs_verification = False
            elif tx_hash:
                # FAILED or CANCELLED *with* a transaction hash. Funds left the
                # wallet. tx_poller writes exactly this for a mined origin leg
                # whose bridge never settled (its BRIDGE_UNSETTLED_TIMEOUT_REASON
                # path), which is a stuck bridge, not a revert.
                #
                # Saying "no funds were sent" here and inviting a replacement
                # order would be worse than silence: it is the one message that
                # could talk the user into spending the amount a second time.
                # SwapEngine's own guard refuses to retry this case for the
                # same reason, so the advice must match.
                reason = (
                    f"The swap was broadcast on-chain but did not complete (status: "
                    f"{swap_status}). Funds have left your wallet, so do NOT assume "
                    f"nothing was sent — a cross-chain leg can still settle later. "
                    f"Check the transaction before placing another order. (swap #{swap_id})"
                )
                needs_verification = True
            else:
                reason = (
                    f"The swap did not go through (status: {swap_status}). No funds were "
                    f"sent. Place a new order to try again."
                )
                needs_verification = False

            try:
                changed = await run_in_db(
                    lambda oid=order_id, r=reason, h=tx_hash: self._fail_limit_order(oid, r, h)
                )
            except Exception as e:
                logger.error(f"Limit order {order_id}: could not record failure: {e}")
                continue
            if not changed:
                # Someone else settled this order between the snapshot and now
                # — most likely the executor completing it. Say nothing.
                logger.info(
                    "Limit order %d was already settled by another writer; skipping the "
                    "failure verdict from swap %s.",
                    order_id,
                    swap_id,
                )
                continue
            logger.warning(
                "Limit order %d finalised as FAILED from swap %s (status %s).",
                order_id,
                swap_id,
                swap_status,
            )
            if self._bot:
                order_obj = await run_in_db(lambda oid=order_id: self._load_limit_order(oid))
                if order_obj is not None:
                    await self._notify_order_failed(
                        order_obj, reason, needs_verification=needs_verification
                    )

    @staticmethod
    def _peek_swap_for_key(idempotency_key: str):
        """``(id, status, tx_hash, from_amount, to_amount)`` for this key, or None.

        Runs in the DB thread pool and returns plain values, not an ORM
        instance, so nothing is read off a detached object after the session
        closes. Callers get the whole shape rather than a yes/no, because the
        decisions that depend on it differ: "is this still in flight?",
        "did it already land, so book it without quoting?" and "did funds
        leave the wallet?" are three different questions about one row.
        """
        with get_session() as session:
            swap = _find_swap_for_key(session, idempotency_key)
            if swap is None:
                return None
            return (
                swap.id,
                swap.status,
                swap.tx_hash,
                swap.from_amount,
                swap.to_amount,
            )

    @staticmethod
    def _pause_dca(order_id: int) -> bool:
        """Pause an ACTIVE DCA plan. True if it changed.

        Conditioned on ACTIVE so two replicas reaching the same verdict do not
        both report it, and so a plan a user cancelled in the meantime is not
        quietly revived into PAUSED.
        """
        with get_session() as session:
            db_order = (
                session.query(DCAOrder)
                .filter(
                    DCAOrder.id == order_id,
                    DCAOrder.status == DCAStatus.ACTIVE.value,
                )
                .first()
            )
            if db_order is None:
                return False
            db_order.status = DCAStatus.PAUSED.value
            return True

    @staticmethod
    def _derive_execution_price(order, from_amount, to_amount) -> float:
        """Executed rate (to-per-from, human units) from the swap's own amounts.

        Used when a tranche is booked from a resolved swap row rather than from
        a live quote, so the recorded price is the one actually achieved
        instead of a quote fetched minutes later. Returns 0.0 when it cannot be
        computed, which is what the column already holds for a missing rate —
        better than inventing a plausible-looking number on a money record.
        """
        try:
            from bot.config.tokens import get_token_decimals

            raw_from = int(from_amount or order.amount_per_execution or 0)
            raw_to = int(to_amount or 0)
            if raw_from <= 0 or raw_to <= 0:
                return 0.0
            from_dec = get_token_decimals(order.from_token, order.from_chain)
            to_dec = get_token_decimals(order.to_token, order.to_chain)
            human_from = raw_from / (10**from_dec)
            human_to = raw_to / (10**to_dec)
            if human_from <= 0:
                return 0.0
            return human_to / human_from
        except Exception as e:
            logger.warning(
                "DCA order %s: could not derive an execution price from the swap row: %s",
                getattr(order, "id", None),
                e,
            )
            return 0.0

    async def _book_dca_execution(
        self, order: DCAOrder, swap_id, tx_hash, from_amount, to_amount
    ) -> None:
        """Count a tranche that resolved out-of-band, without quoting.

        Mirrors the success branch's bookkeeping, but takes its numbers from
        the swap row instead of a fresh quote. Conditioned on the plan still
        sitting at the same executions_completed, so that if the normal path
        (or another replica) already booked this tranche, this does not book it
        twice — double-booking would overstate total_spent and, worse, advance
        the idempotency key as if a further tranche had run.
        """
        expected = order.executions_completed
        price = self._derive_execution_price(order, from_amount, to_amount)

        def _book():
            with get_session() as session:
                db_order = (
                    session.query(DCAOrder)
                    .filter(
                        DCAOrder.id == order.id,
                        DCAOrder.executions_completed == expected,
                    )
                    .first()
                )
                if db_order is None:
                    return False
                db_order.executions_completed += 1
                db_order.total_spent = str(
                    int(db_order.total_spent) + int(order.amount_per_execution)
                )
                db_order.next_execution_at = datetime.utcnow() + timedelta(
                    hours=db_order.interval_hours
                )
                session.add(
                    DCAExecution(
                        dca_order_id=order.id,
                        amount_spent=order.amount_per_execution,
                        amount_received=to_amount or "0",
                        price=price,
                        tx_hash=tx_hash,
                    )
                )
                return True

        try:
            booked = await run_in_db(_book)
        except Exception as e:
            logger.error(
                "DCA order %d: swap %s resolved but the tranche could not be booked: %s. "
                "Leaving the plan due so a later pass retries the bookkeeping.",
                order.id,
                swap_id,
                e,
            )
            return

        if not booked:
            logger.info(
                "DCA order %d: tranche for swap %s was already booked by another writer.",
                order.id,
                swap_id,
            )
            return

        logger.info(
            "DCA order %d: booked execution %d from resolved swap %s without re-quoting "
            "(price derived from the executed amounts).",
            order.id,
            expected + 1,
            swap_id,
        )
        if self._bot:
            # Re-read so the notification shows the advanced counter and the
            # new next_execution_at rather than the pre-booking values.
            fresh = await run_in_db(lambda: self._load_dca_order(order.id))
            if fresh is not None:
                await self._notify_dca_executed(fresh)

    @staticmethod
    def _load_dca_order(order_id: int):
        with get_session() as session:
            return session.query(DCAOrder).filter(DCAOrder.id == order_id).first()

    @staticmethod
    def _delay_dca(order_id: int, delay: timedelta) -> None:
        """Push a DCA plan's next due time out by ``delay``.

        Measured from NOW, not from the stored next_execution_at, which is
        already in the past by the time we get here — adding to a past value
        could still leave the plan due and re-select it on the very next tick,
        which is the loop this is here to break. The plan keeps its status and
        its execution count; only its due time moves.
        """
        with get_session() as session:
            db_order = session.query(DCAOrder).filter(DCAOrder.id == order_id).first()
            if db_order:
                db_order.next_execution_at = datetime.utcnow() + delay

    async def _execute_dca_order(self, order: DCAOrder):
        """Execute a due DCA order using SwapEngine."""
        if not self._swap_engine:
            logger.error("No swap engine configured for DCA execution")
            return

        logger.info(f"Executing DCA order {order.id} for user {order.user_id}")

        try:
            # 0. Is this tranche's own previous attempt still in flight?
            #
            # Ask BEFORE quoting. The idempotency key is keyed on
            # executions_completed, which only advances on a confirmed submit,
            # so while a tranche is unresolved every pass computes the same key
            # and SwapEngine's guard hands back the same row. Quoting first and
            # discovering that afterwards is what burned a provider quote every
            # 30 seconds for the whole life of a cross-chain leg: the plan
            # stays ACTIVE with next_execution_at in the past, so the scanner
            # re-selects it on every tick. One indexed lookup replaces that.
            #
            # Deliberately only a FAST-FORWARD of next_execution_at, never a
            # status change: the tranche has not failed, it is simply not
            # finished, and the poller is still working on it. When it does
            # resolve, the next due pass picks the outcome up through the
            # guard and the normal branches below handle it.
            dca_key = _dca_order_key(order)
            prior = await run_in_db(lambda: self._peek_swap_for_key(dca_key))
            if prior is not None:
                swap_id, swap_status, swap_hash, swap_from, swap_to = prior

                if swap_status in _IN_FLIGHT_STATUSES:
                    await run_in_db(lambda: self._delay_dca(order.id, _IN_FLIGHT_BACKOFF))
                    logger.info(
                        "DCA order %d left alone: swap %s is still %s. Not re-quoting; next "
                        "check in %s. Execution %d is not counted until it settles.",
                        order.id,
                        swap_id,
                        swap_status,
                        _IN_FLIGHT_BACKOFF,
                        order.executions_completed,
                    )
                    return

                if swap_status in _SUBMITTED_STATUSES:
                    # The tranche landed while we were backed off, and it is
                    # not booked yet — the key carries executions_completed,
                    # which only advances on booking, so this key resolving to
                    # a submitted swap means exactly "ran, not yet counted".
                    #
                    # Book it from the swap row and do NOT quote. Falling
                    # through to the normal path would work, but it would pay
                    # for a provider quote purely to re-discover a finished
                    # trade, and it would record that quote's rate as the
                    # execution price — a rate from minutes after the trade.
                    # The executed amounts are on the row; use those.
                    await self._book_dca_execution(
                        order,
                        swap_id=swap_id,
                        tx_hash=swap_hash,
                        from_amount=swap_from,
                        to_amount=swap_to,
                    )
                    return

                # Terminal, not submitted. Decide here rather than quoting to
                # rediscover it: SwapEngine's guard permits a retry only for
                # FAILED/CANCELLED with a NULL hash, so for every other
                # terminal shape the normal path would pay for a quote, be
                # handed this same row back, and land on the backoff branch —
                # forever, every 15 minutes, with the tranche never counted.
                if swap_status == SwapStatus.UNKNOWN.value or swap_hash:
                    # Either the outcome is unverifiable, or it failed *after*
                    # broadcasting (tx_poller writes FAILED with a hash for a
                    # mined origin leg whose bridge never settled). Both mean
                    # funds may have left the wallet for this tranche and the
                    # guard will never retry it, so the plan cannot make
                    # progress on its own. Pause it and say so.
                    if swap_status == SwapStatus.UNKNOWN.value:
                        detail = (
                            "its outcome could not be verified (the swap may have been "
                            "broadcast on-chain)"
                        )
                    else:
                        detail = (
                            f"it was broadcast on-chain but did not complete (status: "
                            f"{swap_status})"
                        )
                    reason = (
                        f"DCA paused after execution {order.executions_completed + 1}: "
                        f"{detail}. Funds may have left your wallet, so this tranche was "
                        f"NOT retried — retrying could have sent it twice. Check on-chain, "
                        f"then resume the plan. (swap #{swap_id})"
                    )
                    await run_in_db(lambda: self._pause_dca(order.id))
                    logger.error(
                        "DCA order %d paused before quoting: swap %s is %s (tx_hash %s). "
                        "Not retried; needs on-chain verification.",
                        order.id,
                        swap_id,
                        swap_status,
                        swap_hash,
                    )
                    if self._bot:
                        await self._notify_dca_failed(order, reason, needs_verification=True)
                    return

                # FAILED or CANCELLED with no hash: nothing moved, the guard
                # will allow a real retry. Fall through to the normal path.

            # 1. Get Quote
            from bot.services.wallet import WalletService

            ws = WalletService()
            wallet = ws.get_wallet_by_id(order.wallet_id)

            if not wallet:
                logger.error(f"Wallet {order.wallet_id} not found for DCA {order.id}")
                # Nothing to execute and nothing in flight, but the plan is
                # still ACTIVE and still due, so without a backoff the scanner
                # would re-select it every 30s forever. A missing wallet is not
                # self-healing, yet pausing the plan on a transient lookup
                # failure would be worse, so back off rather than decide.
                await run_in_db(lambda: self._delay_dca(order.id, _FAILED_RETRY_BACKOFF))
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
            if swap_tx and swap_tx.status in _SUBMITTED_STATUSES:
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
                paused = await run_in_db(lambda: self._pause_dca(order.id))
                logger.error(
                    "DCA order %d paused: swap %s is UNKNOWN (may have broadcast, outcome "
                    "unverified). Execution %d not counted and not retried, to avoid a "
                    "duplicate send; needs on-chain verification before resuming.",
                    order.id,
                    swap_tx.id,
                    order.executions_completed,
                )
                # This branch used to say nothing to the user at all, which was
                # the worst silence in the file: the plan stops, resume_dca then
                # refuses to restart it, and the funds for this tranche may
                # already be gone. Fund safety, so it is sent regardless of the
                # order-notification preference, matching the limit-order path.
                if self._bot and paused:
                    await self._notify_dca_failed(
                        order,
                        (
                            f"DCA paused after execution {order.executions_completed + 1}: "
                            f"the swap may have been broadcast on-chain but its outcome "
                            f"could not be verified. This tranche was NOT retried — "
                            f"retrying could have sent it twice. Check on-chain, then "
                            f"resume the plan. (swap #{swap_tx.id})"
                        ),
                        needs_verification=True,
                    )

            elif swap_tx and swap_tx.status in _IN_FLIGHT_STATUSES:
                # The swap is on its way but has not reached a confirmed submit
                # yet — typically a cross-chain leg sitting in CONFIRMING while
                # the bridge settles, which can take minutes to hours.
                #
                # Nothing to decide here: the tranche has NOT failed, so the
                # plan must not be paused, and it has NOT landed, so
                # executions_completed must not advance (advancing it would
                # rotate the idempotency key and let a second broadcast of the
                # same tranche through — the double-spend path #1122 closed).
                # The only thing that was wrong before was the schedule: with
                # next_execution_at left in the past, every 30s tick re-selected
                # the plan and paid for a fresh provider quote just to be handed
                # this same row back. Push the due time out and leave the row
                # exactly as it is. The step-0 check above now catches the
                # subsequent passes before they can quote at all.
                await run_in_db(lambda: self._delay_dca(order.id, _IN_FLIGHT_BACKOFF))
                logger.info(
                    "DCA order %d held: swap %s is %s (in flight). Execution %d not counted "
                    "yet; next check in %s, no re-quote until then.",
                    order.id,
                    swap_tx.id,
                    swap_tx.status,
                    order.executions_completed,
                    _IN_FLIGHT_BACKOFF,
                )

            elif getattr(swap_tx, "tx_hash", None):
                # Terminal, not submitted, but it HAS a hash — it went out and
                # then failed to complete (tx_poller's mined-origin /
                # unsettled-bridge case). Funds left the wallet and the guard
                # will never retry a row with a hash, so backing off would mean
                # quoting every 15 minutes forever and never making progress.
                # Pause and tell the user instead. Step 0 would catch this on
                # the next pass, but there is no reason to burn a cycle and a
                # quote to reach the same verdict.
                paused = await run_in_db(lambda: self._pause_dca(order.id))
                logger.error(
                    "DCA order %d paused: swap %s is %s WITH tx_hash %s — broadcast but "
                    "not completed. Execution %d not counted and not retried.",
                    order.id,
                    swap_tx.id,
                    swap_tx.status,
                    swap_tx.tx_hash,
                    order.executions_completed,
                )
                if self._bot and paused:
                    await self._notify_dca_failed(
                        order,
                        (
                            f"DCA paused after execution {order.executions_completed + 1}: "
                            f"the swap was broadcast on-chain but did not complete "
                            f"(status: {swap_tx.status}). Funds have left your wallet, so "
                            f"this tranche was NOT retried. A cross-chain leg can still "
                            f"settle later — check the transaction, then resume the plan. "
                            f"(swap #{swap_tx.id})"
                        ),
                        needs_verification=True,
                    )

            else:
                # FAILED or CANCELLED with no hash (genuinely nothing moved, so
                # the guard will allow a real retry), or a status this code does
                # not recognise. Either way the plan stays ACTIVE and is retried
                # — but on a backoff, not on the 30s tick. Without this branch a
                # plan whose quotes or sends kept failing re-quoted 120 times an
                # hour, which is the same wasted-spend bug as the in-flight case
                # wearing a different status.
                await run_in_db(lambda: self._delay_dca(order.id, _FAILED_RETRY_BACKOFF))
                logger.warning(
                    "DCA order %d execution did not submit (swap %s status %s). Retrying in "
                    "%s; execution %d not counted.",
                    order.id,
                    getattr(swap_tx, "id", None),
                    getattr(swap_tx, "status", None),
                    _FAILED_RETRY_BACKOFF,
                    order.executions_completed,
                )

        except Exception as e:
            logger.error(f"DCA execution failed for order {order.id}: {e}")
            # Back off before the next attempt. The plan is still ACTIVE and
            # still due, so returning here without touching next_execution_at
            # left the scanner re-selecting it every 30 seconds and re-quoting
            # each time — the same burn as the in-flight case, just reached by
            # the error path. This does NOT pause the plan: a transient quote
            # or RPC failure should resolve itself, and a genuine send failure
            # is safe to retry because the guard re-checks the swap's status.
            try:
                await run_in_db(lambda: self._delay_dca(order.id, _FAILED_RETRY_BACKOFF))
            except Exception as backoff_exc:
                logger.error(
                    "DCA order %d: could not apply retry backoff after a failed execution: "
                    "%s. The plan stays due and will be retried on the next tick.",
                    order.id,
                    backoff_exc,
                )

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

    async def _notify_order_failed(
        self, order: LimitOrder, reason: str, needs_verification: bool = False
    ):
        """Tell the user a triggered limit order did not execute.

        Previously there was no such path: a limit order that failed, or whose
        swap outcome could not be verified, went terminal in the database with
        nothing sent to the user. Because the order had already left PENDING it
        also stopped appearing in their open orders, so the only visible effect
        was an order that quietly disappeared.

        ``needs_verification`` marks the UNKNOWN case, where the swap may
        actually have moved funds. That one is a fund-safety message, so it is
        sent even when the user has turned order notifications off; an ordinary
        failure respects that preference.
        """
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
                    opted_out = user_settings is not None and not getattr(
                        user_settings, "notify_order_triggered", True
                    )
                    if opted_out and not needs_verification:
                        return

            if telegram_id:
                if needs_verification:
                    header = "⚠️ *Limit Order — Needs Verification*"
                else:
                    header = "❌ *Limit Order Failed*"
                text = (
                    f"{header}\n\n"
                    f"Type: {order.order_type.upper()}\n"
                    f"Swap: {order.from_token} → {order.to_token}\n"
                    f"Trigger price: ${order.trigger_price:.4f}\n\n"
                    f"{reason}"
                )
                await self._bot.send_message(
                    chat_id=telegram_id,
                    text=text,
                    parse_mode="Markdown",
                    disable_web_page_preview=True,
                )

            if whatsapp_id:
                # Deliberately plain text, not a template: the WhatsApp
                # template catalogue has no order-failed template, and
                # send_order_executed would report the opposite of what
                # happened. If a template is added later, swap it in here.
                try:
                    from bot.services.whatsapp_service import whatsapp_service

                    if whatsapp_service.is_configured():
                        await whatsapp_service.send_text_message(
                            to=whatsapp_id,
                            text=(
                                f"{'Needs verification' if needs_verification else 'Failed'}: "
                                f"limit order {order.from_token} → {order.to_token}. {reason}"
                            ),
                        )
                except Exception as wa_exc:
                    logger.warning(
                        f"WhatsApp order-failure notification failed for user "
                        f"{order.user_id}: {wa_exc}"
                    )
        except Exception as e:
            logger.error(f"Order failure notification failed for order {order.id}: {e}")

    async def _notify_dca_failed(
        self, order: DCAOrder, reason: str, needs_verification: bool = False
    ):
        """Tell the user a DCA tranche did not execute and the plan is paused.

        The limit-order path got this and the DCA path did not, which left the
        worse of the two silent: a paused plan whose tranche may have moved
        funds, with resume_dca refusing to restart it. From the user's side
        that is a dead plan and no explanation.
        """
        try:
            from bot.models.user import User

            telegram_id = None
            with get_session() as session:
                user = session.query(User).filter(User.id == order.user_id).first()
                if user:
                    telegram_id = user.telegram_id

            if not telegram_id:
                return

            header = (
                "⚠️ *DCA Paused — Needs Verification*" if needs_verification else "⏸️ *DCA Paused*"
            )
            text = (
                f"{header}\n\n"
                f"Plan: {order.from_token} → {order.to_token}\n"
                f"Completed: {order.executions_completed}/{order.max_executions or '∞'}\n\n"
                f"{reason}"
            )
            await self._bot.send_message(
                chat_id=telegram_id,
                text=text,
                parse_mode="Markdown",
                disable_web_page_preview=True,
            )
        except Exception as e:
            logger.error(f"DCA failure notification failed for order {order.id}: {e}")

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
