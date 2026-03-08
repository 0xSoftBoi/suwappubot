"""Health monitoring and alerting service."""

import asyncio
import logging
from typing import Optional, List, Dict, Callable
from datetime import datetime, timedelta
from collections import defaultdict
from dataclasses import dataclass

from bot.models.swap import SwapTransaction, SwapStatus
from database.db import get_session

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    """An alert event."""
    severity: str  # "info", "warning", "critical"
    title: str
    message: str
    timestamp: datetime
    data: Dict = None
    
    def format(self) -> str:
        icons = {
            "info": "ℹ️",
            "warning": "⚠️",
            "critical": "🚨",
        }
        return f"{icons.get(self.severity, '📢')} *{self.title}*\n\n{self.message}"


class HealthMonitor:
    """Monitor system health and send alerts."""
    
    def __init__(
        self,
        check_interval: int = 60,
        failure_threshold: float = 0.1,  # 10% failure rate
        alert_cooldown: int = 300,  # 5 minutes between same alerts
    ):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._check_interval = check_interval
        self._failure_threshold = failure_threshold
        self._alert_cooldown = alert_cooldown
        self._bot = None
        self._admin_ids: List[int] = []
        
        # Track recent alerts to avoid spam
        self._recent_alerts: Dict[str, datetime] = {}
        
        # Metrics
        self._swap_stats = defaultdict(lambda: {"success": 0, "failed": 0})
        
        logger.info("Health monitor initialized")
    
    async def start(self, bot=None, admin_ids: List[int] = None):
        """Start the health monitoring service."""
        if self._running:
            return
        
        self._running = True
        self._bot = bot
        self._admin_ids = admin_ids or []
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Health monitor started")
    
    async def stop(self):
        """Stop the health monitoring service."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Health monitor stopped")
    
    async def _monitor_loop(self):
        """Main monitoring loop."""
        while self._running:
            try:
                await self._check_swap_health()
                await self._check_api_health()
                await self._check_database_health()
            except Exception as e:
                logger.error(f"Health check error: {e}")
            
            await asyncio.sleep(self._check_interval)
    
    async def _check_swap_health(self):
        """Check swap failure rate."""
        with get_session() as session:
            # Get swaps from last hour
            cutoff = datetime.utcnow() - timedelta(hours=1)
            
            recent_swaps = session.query(SwapTransaction).filter(
                SwapTransaction.created_at >= cutoff
            ).all()
            
            if not recent_swaps:
                return
            
            # Calculate failure rate
            total = len(recent_swaps)
            failed = sum(1 for s in recent_swaps if s.status == SwapStatus.FAILED.value)
            failure_rate = failed / total
            
            if failure_rate >= self._failure_threshold and total >= 5:
                await self._send_alert(Alert(
                    severity="critical",
                    title="High Swap Failure Rate",
                    message=(
                        f"Swap failure rate is {failure_rate:.1%}\n"
                        f"Failed: {failed}/{total} in last hour\n\n"
                        f"Please investigate immediately."
                    ),
                    timestamp=datetime.utcnow(),
                    data={"failure_rate": failure_rate, "total": total, "failed": failed},
                ))
    
    async def _check_api_health(self):
        """Check external API health."""
        from bot.utils.performance import perf_tracker
        
        # Check API error rates
        for api in ["api_lifi", "api_jupiter", "api_coingecko"]:
            stats = perf_tracker.get_stats(f"{api}_ms")
            if stats and stats.count >= 10:
                error_rate = stats.errors / stats.count
                if error_rate >= 0.3:  # 30% error rate
                    await self._send_alert(Alert(
                        severity="warning",
                        title=f"API Degradation: {api}",
                        message=(
                            f"High error rate: {error_rate:.1%}\n"
                            f"Requests: {stats.count}, Errors: {stats.errors}\n"
                            f"Avg latency: {stats.avg:.0f}ms"
                        ),
                        timestamp=datetime.utcnow(),
                    ))
    
    async def _check_database_health(self):
        """Check database health."""
        from bot.utils.db_monitor import query_monitor
        
        stats = query_monitor.get_stats()
        avg_query_ms = stats.get("avg_query_ms", 0)
        
        if avg_query_ms > 500:  # Avg query > 500ms
            await self._send_alert(Alert(
                severity="warning",
                title="Database Slow",
                message=(
                    f"Average query time: {avg_query_ms:.0f}ms\n"
                    f"Slow queries: {stats['slow_query_count']}\n"
                    f"Consider optimizing queries."
                ),
                timestamp=datetime.utcnow(),
            ))
    
    async def _send_alert(self, alert: Alert):
        """Send an alert to admins."""
        # Check cooldown
        alert_key = f"{alert.severity}:{alert.title}"
        if alert_key in self._recent_alerts:
            last_sent = self._recent_alerts[alert_key]
            if (datetime.utcnow() - last_sent).seconds < self._alert_cooldown:
                return  # Skip, recently sent
        
        self._recent_alerts[alert_key] = datetime.utcnow()
        
        logger.warning(f"Alert: {alert.title} - {alert.message}")
        
        if self._bot and self._admin_ids:
            for admin_id in self._admin_ids:
                try:
                    await self._bot.send_message(
                        chat_id=admin_id,
                        text=alert.format(),
                        parse_mode="Markdown",
                    )
                except Exception as e:
                    logger.error(f"Failed to send alert to {admin_id}: {e}")
    
    async def record_swap_result(self, success: bool, chain: str = "all"):
        """Record a swap result for tracking."""
        if success:
            self._swap_stats[chain]["success"] += 1
        else:
            self._swap_stats[chain]["failed"] += 1
    
    def get_swap_stats(self) -> Dict:
        """Get swap statistics."""
        return dict(self._swap_stats)


# Global instance
health_monitor = HealthMonitor()

