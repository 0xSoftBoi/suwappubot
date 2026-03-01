"""Price alerts service."""

import asyncio
import logging
from typing import List, Optional
from datetime import datetime

from bot.models.advanced import AdvancedPriceAlert as PriceAlert, AlertType
from bot.services.price_service import price_service
from database.db import get_session

logger = logging.getLogger(__name__)


class AlertService:
    """Service for managing price alerts."""
    
    def __init__(self):
        self._running = False
        self._task = None
        self._check_interval = 60  # Check every 60 seconds
    
    # === Alert Management ===
    
    def create_alert(
        self,
        user_id: int,
        token_symbol: str,
        alert_type: str,
        target_price: float = None,
        percent_threshold: float = None,
        chain: str = "ethereum",
    ) -> PriceAlert:
        """Create a new price alert."""
        with get_session() as session:
            alert = PriceAlert(
                user_id=user_id,
                token_symbol=token_symbol.upper(),
                chain=chain,
                alert_type=alert_type,
                target_price=target_price,
                percent_threshold=percent_threshold,
            )
            
            # For percent change alerts, get current price as base
            if alert_type == AlertType.PERCENT_CHANGE.value:
                # Will be set on first check
                alert.base_price = None
            
            session.add(alert)
            session.flush()
            alert_id = alert.id
        
        with get_session() as session:
            return session.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
    
    def get_user_alerts(self, user_id: int, active_only: bool = True) -> List[PriceAlert]:
        """Get all alerts for a user."""
        with get_session() as session:
            query = session.query(PriceAlert).filter(PriceAlert.user_id == user_id)
            if active_only:
                query = query.filter(PriceAlert.is_active == True)
            return query.order_by(PriceAlert.created_at.desc()).all()
    
    def delete_alert(self, alert_id: int, user_id: int) -> bool:
        """Delete an alert."""
        with get_session() as session:
            alert = session.query(PriceAlert).filter(
                PriceAlert.id == alert_id,
                PriceAlert.user_id == user_id,
            ).first()
            
            if alert:
                session.delete(alert)
                return True
            return False
    
    def toggle_alert(self, alert_id: int, user_id: int) -> Optional[bool]:
        """Toggle alert active status. Returns new status."""
        with get_session() as session:
            alert = session.query(PriceAlert).filter(
                PriceAlert.id == alert_id,
                PriceAlert.user_id == user_id,
            ).first()
            
            if alert:
                alert.is_active = not alert.is_active
                return alert.is_active
            return None
    
    # === Alert Checking ===
    
    async def check_alerts(self) -> List[dict]:
        """Check all active alerts and return triggered ones."""
        from bot.utils.distributed_lock import RedisLock
        from bot.utils.redis_cache import redis_cache

        lock = RedisLock(redis_cache.client, "alert_check", ttl=30)
        if not await lock.acquire():
            return []
        try:
            return await self._check_alerts_inner()
        finally:
            await lock.release()

    async def _check_alerts_inner(self) -> List[dict]:
        """Inner alert check logic (runs under distributed lock)."""
        triggered = []

        with get_session() as session:
            alerts = session.query(PriceAlert).filter(
                PriceAlert.is_active == True,
                PriceAlert.is_triggered == False,
            ).all()
            
            if not alerts:
                return []
            
            # Get unique tokens
            tokens = list(set(a.token_symbol for a in alerts))
            
            # Fetch prices
            prices = await price_service.get_prices(tokens)
            
            for alert in alerts:
                current_price = prices.get(alert.token_symbol)
                if current_price is None:
                    continue
                
                should_trigger = False
                
                if alert.alert_type == AlertType.PRICE_ABOVE.value:
                    should_trigger = current_price >= alert.target_price
                    
                elif alert.alert_type == AlertType.PRICE_BELOW.value:
                    should_trigger = current_price <= alert.target_price
                    
                elif alert.alert_type == AlertType.PERCENT_CHANGE.value:
                    if alert.base_price is None or alert.base_price == 0:
                        alert.base_price = current_price
                    else:
                        change_pct = ((current_price - alert.base_price) / alert.base_price) * 100
                        should_trigger = abs(change_pct) >= alert.percent_threshold

                elif alert.alert_type == AlertType.PNL_CHANGE.value:
                    if alert.pnl_threshold_percent is not None:
                        try:
                            from bot.services.pnl import pnl_service
                            pnl_data = await pnl_service.get_unrealized_pnl(alert.user_id)
                            for position in pnl_data:
                                if position.get("token_symbol") == alert.token_symbol:
                                    current_pnl_pct = position.get("pnl_percent", 0)
                                    if alert.pnl_threshold_percent > 0:
                                        should_trigger = current_pnl_pct >= alert.pnl_threshold_percent
                                    else:
                                        should_trigger = current_pnl_pct <= alert.pnl_threshold_percent
                                    if should_trigger:
                                        current_price = position.get("current_price", 0)
                                    break
                        except Exception as e:
                            logger.error(f"PnL alert check error: {e}")

                if should_trigger:
                    alert.is_triggered = True
                    alert.triggered_at = datetime.utcnow()
                    alert.triggered_price = current_price
                    
                    if alert.notify_once:
                        alert.is_active = False
                    
                    triggered.append({
                        "alert_id": alert.id,
                        "user_id": alert.user_id,
                        "token": alert.token_symbol,
                        "alert_type": alert.alert_type,
                        "target_price": alert.target_price,
                        "current_price": current_price,
                        "percent_threshold": alert.percent_threshold,
                        "pnl_percent": getattr(alert, 'pnl_threshold_percent', None),
                    })
        
        return triggered
    
    # === Background Task ===
    
    async def start(self, bot=None):
        """Start the alert checking background task."""
        if self._running:
            return
        
        self._running = True
        self._bot = bot
        self._task = asyncio.create_task(self._alert_loop())
        logger.info("Price alert service started")
    
    async def stop(self):
        """Stop the alert checking task."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Price alert service stopped")
    
    async def _alert_loop(self):
        """Main alert checking loop."""
        batch_counter = 0
        while self._running:
            try:
                triggered = await self.check_alerts()

                # Send notifications
                for alert in triggered:
                    await self._send_notification(alert)

                # Flush batched notifications every 5 minutes (5 iterations of 60s)
                batch_counter += 1
                if batch_counter >= 5:
                    await self._flush_batched_notifications()
                    batch_counter = 0

            except Exception as e:
                logger.error(f"Alert check error: {e}")

            await asyncio.sleep(self._check_interval)
    
    async def _send_notification(self, alert: dict):
        """Send alert notification with actionable buttons."""
        from telegram import InlineKeyboardButton

        # Check quiet hours
        if self._is_quiet_hours(alert["user_id"]):
            logger.info(f"Alert for user {alert['user_id']} queued - quiet hours")
            return

        # Build message and buttons based on alert type
        buttons = []

        if alert["alert_type"] == AlertType.PRICE_ABOVE.value:
            text = (
                f"🔔 *Price Alert Triggered!*\n\n"
                f"📈 {alert['token']} is above ${alert['target_price']:.4f}\n"
                f"Current: ${alert['current_price']:.4f}"
            )
            token = alert["token"]
            buttons = [
                [
                    InlineKeyboardButton("🔄 Buy Now", callback_data=f"alert_act_buy_{token}"),
                    InlineKeyboardButton("🔔 New Alert", callback_data="alert_create"),
                ]
            ]
        elif alert["alert_type"] == AlertType.PRICE_BELOW.value:
            text = (
                f"🔔 *Price Alert Triggered!*\n\n"
                f"📉 {alert['token']} is below ${alert['target_price']:.4f}\n"
                f"Current: ${alert['current_price']:.4f}"
            )
            token = alert["token"]
            buttons = [
                [
                    InlineKeyboardButton("🔄 Buy Now", callback_data=f"alert_act_buy_{token}"),
                    InlineKeyboardButton("🔔 New Alert", callback_data="alert_create"),
                ]
            ]
        elif alert["alert_type"] == AlertType.PNL_CHANGE.value:
            text = (
                f"📊 *PnL Alert!*\n\n"
                f"{alert['token']} PnL hit {alert.get('pnl_percent', 0):.1f}%\n"
                f"Current: ${alert['current_price']:.4f}"
            )
            token = alert["token"]
            buttons = [
                [
                    InlineKeyboardButton("Sell 25%", callback_data=f"alert_act_sell_25_{token}"),
                    InlineKeyboardButton("Sell 50%", callback_data=f"alert_act_sell_50_{token}"),
                    InlineKeyboardButton("Sell 100%", callback_data=f"alert_act_sell_100_{token}"),
                ],
                [
                    InlineKeyboardButton("🛑 Set Stop-Loss", callback_data="lo_stop"),
                ]
            ]
        else:
            text = (
                f"🔔 *Price Alert Triggered!*\n\n"
                f"📊 {alert['token']} moved {alert['percent_threshold']:.1f}%\n"
                f"Current: ${alert['current_price']:.4f}"
            )

        # Send via batching or direct
        await self._queue_notification(alert["user_id"], text, buttons)

    def _is_quiet_hours(self, user_id: int) -> bool:
        """Check if current time is within user's quiet hours."""
        from bot.models.favorites import UserSettings

        with get_session() as session:
            settings = session.query(UserSettings).filter(UserSettings.user_id == user_id).first()
            if not settings or settings.quiet_hours_start is None or settings.quiet_hours_end is None:
                return False

            import pytz
            try:
                tz = pytz.timezone(settings.quiet_hours_timezone or "UTC")
            except Exception:
                tz = pytz.UTC

            now = datetime.now(tz)
            current_hour = now.hour

            start = settings.quiet_hours_start
            end = settings.quiet_hours_end

            if start < end:
                return start <= current_hour < end
            else:
                # Wraps midnight (e.g., 22:00 - 08:00)
                return current_hour >= start or current_hour < end

    async def _queue_notification(self, user_id: int, message: str, buttons=None):
        """Queue notification for batching."""
        from bot.utils.redis_cache import redis_cache
        from bot.models.favorites import UserSettings

        with get_session() as session:
            settings = session.query(UserSettings).filter(UserSettings.user_id == user_id).first()
            batching_enabled = settings.notification_batching if settings else True

        if not batching_enabled:
            await self._send_direct_notification(user_id, message, buttons)
            return

        # Add to batch queue
        import json
        batch_key = f"notif_batch:{user_id}"
        entry = json.dumps({"message": message, "buttons": buttons, "time": datetime.utcnow().isoformat()})

        if redis_cache.client:
            await redis_cache.client.rpush(batch_key, entry)
            await redis_cache.client.expire(batch_key, 600)  # 10 min TTL
        else:
            # Fallback: send immediately
            await self._send_direct_notification(user_id, message, buttons)

    async def _flush_batched_notifications(self):
        """Flush all batched notifications (called every 5 minutes)."""
        from bot.utils.redis_cache import redis_cache
        import json

        if not redis_cache.client:
            return

        # Find all batch keys
        keys = await redis_cache.client.keys("notif_batch:*")

        for key in keys:
            user_id = int(key.decode().split(":")[1])
            entries = await redis_cache.client.lrange(key, 0, -1)

            if not entries:
                continue

            await redis_cache.client.delete(key)

            if len(entries) == 1:
                data = json.loads(entries[0])
                await self._send_direct_notification(user_id, data["message"])
            else:
                # Group messages
                messages = [json.loads(e)["message"] for e in entries]
                grouped = f"🔔 *{len(messages)} alerts triggered:*\n\n"
                for msg in messages:
                    # Extract key info from each message
                    grouped += f"• {msg.split(chr(10))[0]}\n"

                await self._send_direct_notification(user_id, grouped)

    async def _send_direct_notification(self, user_id: int, text: str, buttons=None):
        """Send notification directly to user."""
        from bot.models.user import User
        from telegram import InlineKeyboardMarkup

        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if not user:
                return

            if self._bot and user.telegram_id:
                try:
                    reply_markup = InlineKeyboardMarkup(buttons) if buttons else None
                    await self._bot.send_message(
                        chat_id=user.telegram_id,
                        text=text,
                        parse_mode="Markdown",
                        reply_markup=reply_markup,
                    )
                except Exception as e:
                    logger.error(f"Notification send failed: {e}")

    def auto_create_pnl_alerts(self, user_id: int, token_symbol: str, chain: str = "ethereum", thresholds: list = None):
        """Auto-create PnL alerts after a swap."""
        if thresholds is None:
            thresholds = [50, 100, -25]

        with get_session() as session:
            for threshold in thresholds:
                # Check if similar alert already exists
                existing = session.query(PriceAlert).filter(
                    PriceAlert.user_id == user_id,
                    PriceAlert.token_symbol == token_symbol,
                    PriceAlert.alert_type == AlertType.PNL_CHANGE.value,
                    PriceAlert.pnl_threshold_percent == float(threshold),
                    PriceAlert.is_active == True,
                ).first()

                if existing:
                    continue

                alert = PriceAlert(
                    user_id=user_id,
                    token_symbol=token_symbol.upper(),
                    chain=chain,
                    alert_type=AlertType.PNL_CHANGE.value,
                    pnl_threshold_percent=float(threshold),
                    is_active=True,
                )
                session.add(alert)

        logger.info(f"Auto-created PnL alerts for user {user_id}, token {token_symbol}")


# Global instance
alert_service = AlertService()

