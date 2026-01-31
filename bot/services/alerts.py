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
        while self._running:
            try:
                triggered = await self.check_alerts()
                
                # Send notifications
                for alert in triggered:
                    await self._send_notification(alert)
                    
            except Exception as e:
                logger.error(f"Alert check error: {e}")
            
            await asyncio.sleep(self._check_interval)
    
    async def _send_notification(self, alert: dict):
        """Send alert notification to user."""
        if not self._bot:
            return
        
        try:
            if alert["alert_type"] == AlertType.PRICE_ABOVE.value:
                text = (
                    f"🔔 *Price Alert Triggered!*\n\n"
                    f"📈 {alert['token']} is above ${alert['target_price']:.4f}\n"
                    f"Current: ${alert['current_price']:.4f}"
                )
            elif alert["alert_type"] == AlertType.PRICE_BELOW.value:
                text = (
                    f"🔔 *Price Alert Triggered!*\n\n"
                    f"📉 {alert['token']} is below ${alert['target_price']:.4f}\n"
                    f"Current: ${alert['current_price']:.4f}"
                )
            else:
                text = (
                    f"🔔 *Price Alert Triggered!*\n\n"
                    f"📊 {alert['token']} moved {alert['percent_threshold']:.1f}%\n"
                    f"Current: ${alert['current_price']:.4f}"
                )
            
            # Get user's telegram_id
            from bot.models.user import User
            with get_session() as session:
                user = session.query(User).filter(User.id == alert["user_id"]).first()
                if user:
                    await self._bot.send_message(
                        chat_id=user.telegram_id,
                        text=text,
                        parse_mode="Markdown",
                    )
        except Exception as e:
            logger.error(f"Failed to send alert notification: {e}")


# Global instance
alert_service = AlertService()

