"""Limit orders and DCA service."""

import asyncio
import logging
from typing import Optional, List, Tuple
from datetime import datetime, timedelta
from decimal import Decimal

from bot.models.advanced import (
    LimitOrder, OrderStatus, OrderType,
    DCAOrder, DCAExecution, DCAStatus,
    SwapTemplate,
)
from bot.services.price_service import price_service
from bot.services.swap_engine import SwapEngine
from database.db import get_session

logger = logging.getLogger(__name__)


class OrderService:
    """Service for managing limit orders and DCA."""
    
    def __init__(self):
        self._running = False
        self._task = None
        self._check_interval = 30  # Check every 30 seconds
        self._swap_engine = None
    
    # === Limit Orders ===
    
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
                query = query.filter(LimitOrder.status.in_([
                    OrderStatus.PENDING.value,
                    OrderStatus.TRIGGERED.value,
                ]))
            
            return query.order_by(LimitOrder.created_at.desc()).all()
    
    def cancel_order(self, order_id: int, user_id: int) -> bool:
        """Cancel a limit order."""
        with get_session() as session:
            order = session.query(LimitOrder).filter(
                LimitOrder.id == order_id,
                LimitOrder.user_id == user_id,
                LimitOrder.status == OrderStatus.PENDING.value,
            ).first()
            
            if order:
                order.status = OrderStatus.CANCELLED.value
                return True
            return False
    
    async def check_limit_orders(self) -> List[LimitOrder]:
        """Check all pending limit orders and return triggered ones."""
        triggered = []
        
        with get_session() as session:
            # Get pending orders
            orders = session.query(LimitOrder).filter(
                LimitOrder.status == OrderStatus.PENDING.value,
            ).all()
            
            if not orders:
                return []
            
            # Check expiration
            now = datetime.utcnow()
            for order in orders:
                if order.expires_at and order.expires_at < now:
                    order.status = OrderStatus.EXPIRED.value
                    continue
            
            # Get unique tokens to check
            tokens = set()
            for order in orders:
                if order.order_type in [OrderType.LIMIT_BUY.value, OrderType.STOP_LOSS.value]:
                    tokens.add(order.to_token)  # Buying to_token
                else:
                    tokens.add(order.from_token)  # Selling from_token
            
            # Fetch prices
            prices = await price_service.get_prices(list(tokens))
            
            for order in orders:
                if order.status != OrderStatus.PENDING.value:
                    continue
                
                # Determine which token price to check
                if order.order_type == OrderType.LIMIT_BUY.value:
                    # Buy when price drops to target
                    check_token = order.to_token
                    current_price = prices.get(check_token, 0)
                    should_trigger = current_price <= order.trigger_price
                    
                elif order.order_type == OrderType.LIMIT_SELL.value:
                    # Sell when price rises to target
                    check_token = order.from_token
                    current_price = prices.get(check_token, 0)
                    should_trigger = current_price >= order.trigger_price
                    
                elif order.order_type == OrderType.STOP_LOSS.value:
                    # Sell when price drops to stop
                    check_token = order.from_token
                    current_price = prices.get(check_token, 0)
                    should_trigger = current_price <= order.trigger_price
                    
                elif order.order_type == OrderType.TAKE_PROFIT.value:
                    # Sell when price rises to target
                    check_token = order.from_token
                    current_price = prices.get(check_token, 0)
                    should_trigger = current_price >= order.trigger_price
                else:
                    continue
                
                if should_trigger and current_price > 0:
                    order.status = OrderStatus.TRIGGERED.value
                    order.execution_price = current_price
                    triggered.append(order)
        
        return triggered
    
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
            order = session.query(DCAOrder).filter(
                DCAOrder.id == order_id,
                DCAOrder.user_id == user_id,
                DCAOrder.status == DCAStatus.ACTIVE.value,
            ).first()
            
            if order:
                order.status = DCAStatus.PAUSED.value
                return True
            return False
    
    def resume_dca(self, order_id: int, user_id: int) -> bool:
        """Resume a paused DCA order."""
        with get_session() as session:
            order = session.query(DCAOrder).filter(
                DCAOrder.id == order_id,
                DCAOrder.user_id == user_id,
                DCAOrder.status == DCAStatus.PAUSED.value,
            ).first()
            
            if order:
                order.status = DCAStatus.ACTIVE.value
                order.next_execution_at = datetime.utcnow()
                return True
            return False
    
    def cancel_dca(self, order_id: int, user_id: int) -> bool:
        """Cancel a DCA order."""
        with get_session() as session:
            order = session.query(DCAOrder).filter(
                DCAOrder.id == order_id,
                DCAOrder.user_id == user_id,
                DCAOrder.status.in_([DCAStatus.ACTIVE.value, DCAStatus.PAUSED.value]),
            ).first()
            
            if order:
                order.status = DCAStatus.CANCELLED.value
                return True
            return False
    
    async def check_dca_orders(self) -> List[DCAOrder]:
        """Check DCA orders due for execution."""
        due_orders = []
        now = datetime.utcnow()
        
        with get_session() as session:
            orders = session.query(DCAOrder).filter(
                DCAOrder.status == DCAStatus.ACTIVE.value,
                DCAOrder.next_execution_at <= now,
            ).all()
            
            for order in orders:
                # Check if ended
                if order.ends_at and order.ends_at < now:
                    order.status = DCAStatus.COMPLETED.value
                    continue
                
                # Check if max executions reached
                if order.max_executions and order.executions_completed >= order.max_executions:
                    order.status = DCAStatus.COMPLETED.value
                    continue
                
                due_orders.append(order)
        
        return due_orders
    
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
            return session.query(SwapTemplate).filter(
                SwapTemplate.user_id == user_id
            ).order_by(SwapTemplate.use_count.desc()).all()
    
    def use_template(self, template_id: int, user_id: int) -> Optional[SwapTemplate]:
        """Mark template as used and return it."""
        with get_session() as session:
            template = session.query(SwapTemplate).filter(
                SwapTemplate.id == template_id,
                SwapTemplate.user_id == user_id,
            ).first()
            
            if template:
                template.use_count += 1
                template.last_used_at = datetime.utcnow()
                return template
            return None
    
    def delete_template(self, template_id: int, user_id: int) -> bool:
        """Delete a swap template."""
        with get_session() as session:
            template = session.query(SwapTemplate).filter(
                SwapTemplate.id == template_id,
                SwapTemplate.user_id == user_id,
            ).first()
            
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
        self._swap_engine = swap_engine
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
                pass
        logger.info("Order service stopped")
    
    async def _order_loop(self):
        """Main order checking loop."""
        while self._running:
            try:
                # Check limit orders
                triggered_limits = await self.check_limit_orders()
                for order in triggered_limits:
                    await self._execute_limit_order(order)
                
                # Check DCA orders
                due_dca = await self.check_dca_orders()
                for order in due_dca:
                    await self._execute_dca_order(order)
                    
            except Exception as e:
                logger.error(f"Order check error: {e}")
            
            await asyncio.sleep(self._check_interval)
    
    async def _execute_limit_order(self, order: LimitOrder):
        """Execute a triggered limit order using SwapEngine."""
        if not self._swap_engine:
            logger.error("No swap engine configured for Limit Order execution")
            return
        
        logger.info(f"Executing Limit Order {order.id} ({order.order_type}) for user {order.user_id}")
        
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
            amount_human = float(order.amount) / (10 ** decimals)
            
            quote = await self._swap_engine.get_quote(
                from_chain=order.from_chain,
                to_chain=order.to_chain,
                from_token=order.from_token,
                to_token=order.to_token,
                amount=amount_human,
                from_address=wallet.address,
                slippage=order.slippage
            )
            
            # 3. Execute Swap
            idempotency_key = f"lo:{order.id}:{datetime.utcnow().strftime('%Y%m%d%H')}"
            
            swap_tx = await self._swap_engine.execute_swap(
                quote=quote,
                wallet_id=order.wallet_id,
                user_id=order.user_id,
                idempotency_key=idempotency_key,
            )
            
            # 4. Update status on submission
            if swap_tx and swap_tx.status in ["submitted", "completed"]:
                with get_session() as session:
                    db_order = session.query(LimitOrder).filter(LimitOrder.id == order.id).first()
                    if db_order:
                        db_order.status = OrderStatus.EXECUTED.value
                        db_order.executed_at = datetime.utcnow()
                        db_order.tx_hash = swap_tx.tx_hash
                
                # Notify user
                if self._bot:
                    await self._notify_order_executed(order, swap_tx)
            
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
            # Note: order.amount_per_execution is stored as string raw amount
            amount_human = float(order.amount_per_execution) / (10**18) # Simplified, should use token decimals
            
            quote = await self._swap_engine.get_quote(
                from_chain=order.from_chain,
                to_chain=order.to_chain,
                from_token=order.from_token,
                to_token=order.to_token,
                amount=amount_human,
                from_address=wallet.address,
            )
            
            # 2. Execute Swap
            idempotency_key = f"dca:{order.id}:{order.executions_completed}:{datetime.utcnow().strftime('%Y%m%d%H')}"
            
            swap_tx = await self._swap_engine.execute_swap(
                quote=quote,
                wallet_id=order.wallet_id,
                user_id=order.user_id,
                idempotency_key=idempotency_key,
            )
            
            # 3. Update DCA Stats on success
            if swap_tx and swap_tx.status in ["submitted", "completed"]:
                with get_session() as session:
                    db_order = session.query(DCAOrder).filter(DCAOrder.id == order.id).first()
                    if db_order:
                        db_order.executions_completed += 1
                        db_order.total_spent = str(int(db_order.total_spent) + int(order.amount_per_execution))
                        # Update next execution time
                        db_order.next_execution_at = datetime.utcnow() + timedelta(hours=db_order.interval_hours)
                        
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
            
        except Exception as e:
            logger.error(f"DCA execution failed for order {order.id}: {e}")
            # If it fails, we might want to retry later or pause it
            # For now, just log and wait for next interval
    
    async def _notify_order_executed(self, order: LimitOrder, swap_tx=None):
        """Notify user of executed limit order."""
        try:
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == order.user_id).first()
                if user:
                    tx_info = ""
                    if swap_tx and swap_tx.tx_hash:
                        from bot.utils.formatters import format_tx_link
                        tx_info = f"\n🔗 [View Transaction]({format_tx_link(swap_tx.tx_hash, order.from_chain)})"

                    text = (
                        f"✅ *Limit Order Executed!*\n\n"
                        f"Type: {order.order_type.upper()}\n"
                        f"Swap: {order.from_token} → {order.to_token}\n"
                        f"Trigger price: ${order.trigger_price:.4f}"
                        f"{tx_info}"
                    )
                    await self._bot.send_message(
                        chat_id=user.telegram_id,
                        text=text,
                        parse_mode="Markdown",
                        disable_web_page_preview=True
                    )
        except Exception as e:
            logger.error(f"Order notification failed: {e}")
    
    async def _notify_dca_executed(self, order: DCAOrder, swap_tx=None):
        """Notify user of executed DCA."""
        try:
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == order.user_id).first()
                if user:
                    tx_info = ""
                    if swap_tx and swap_tx.tx_hash:
                        from bot.utils.formatters import format_tx_link
                        tx_info = f"\n🔗 [View Transaction]({format_tx_link(swap_tx.tx_hash, order.from_chain)})"
                        
                    text = (
                        f"📊 *DCA Trade Executed!*\n\n"
                        f"Order: {order.from_token} → {order.to_token}\n"
                        f"Progress: {order.executions_completed}/{order.max_executions or '∞'}\n"
                        f"Next execution: {order.next_execution_at.strftime('%Y-%m-%d %H:%M')}UTC"
                        f"{tx_info}"
                    )
                    await self._bot.send_message(
                        chat_id=user.telegram_id,
                        text=text,
                        parse_mode="Markdown",
                        disable_web_page_preview=True
                    )
        except Exception as e:
            logger.error(f"DCA notification failed: {e}")


# Global instance
order_service = OrderService()

