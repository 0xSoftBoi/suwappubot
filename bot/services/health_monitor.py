"""Health monitoring and alerting service."""

import asyncio
import logging
from typing import Optional, List, Dict, Callable
from datetime import datetime, timezone, timedelta
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

        # Dead-man's switch (uptime-probe heartbeats) state
        self._started_at: Optional[datetime] = None
        self._last_deadman_check: Optional[datetime] = None
        self._deadman_check_interval = timedelta(minutes=5)
        self._deadman_boot_grace = timedelta(minutes=15)
        self._deadman_alert_cooldown_hours = 6

        logger.info("Health monitor initialized")

    async def start(self, bot=None, admin_ids: List[int] = None):
        """Start the health monitoring service."""
        if self._running:
            return

        self._running = True
        self._bot = bot
        self._admin_ids = admin_ids or []
        self._started_at = datetime.now(timezone.utc)
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
                await self._check_heartbeat_deadman()
            except Exception as e:
                logger.error(f"Health check error: {e}")

            await asyncio.sleep(self._check_interval)

    async def _check_heartbeat_deadman(self):
        """Dead-man's switch: alert if uptime-probe heartbeats have gone quiet.

        The uptime probe (scripts/uptime_probe.py) POSTs to
        /internal/monitor-heartbeat on every run from independent schedulers
        (GitHub Actions + a Railway cron, see `settings.monitor_expected_sources`).
        This is the only thing watching *that* watcher: if a scheduler stops
        reporting (e.g. GH Actions billing failure, like 2026-07-25), this
        notices the silence and alerts admins instead of silence reading as
        health.

        Staleness and failure ("ok": false) are tracked PER expected source —
        one fresh/healthy source must never mask another source going dark,
        and cooldown/recovery state is independent per source.
        """
        now = datetime.now(timezone.utc)

        # Gate to ~every 5 min regardless of the outer loop's check_interval.
        if (
            self._last_deadman_check is not None
            and (now - self._last_deadman_check) < self._deadman_check_interval
        ):
            return
        self._last_deadman_check = now

        try:
            from bot.utils.redis_cache import redis_cache
        except Exception as e:
            logger.debug(f"Dead-man's switch: redis_cache unavailable: {e}")
            return

        from bot.config.settings import settings

        sources = settings.monitor_expected_sources_list()
        if not sources:
            return

        past_boot_grace = (
            self._started_at is None or (now - self._started_at) >= self._deadman_boot_grace
        )
        max_age = settings.monitor_heartbeat_max_age_minutes

        for source in sources:
            await self._check_source_staleness(redis_cache, source, now, max_age, past_boot_grace)
            await self._check_source_failing(redis_cache, source, now, max_age)

    async def _check_source_staleness(self, redis_cache, source, now, max_age, past_boot_grace):
        """Staleness (or never-reported) check for a single expected source."""
        stale_marker = f"monitor:deadman:stale-alerted:{source}"

        try:
            data = await redis_cache.get(f"monitor:heartbeat:{source}")
        except Exception as e:
            logger.debug(f"Dead-man's switch: failed to read heartbeat for {source}: {e}")
            return

        ts: Optional[datetime] = None
        if isinstance(data, dict):
            raw_ts = data.get("ts")
            if raw_ts:
                try:
                    ts = datetime.fromisoformat(raw_ts)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except (TypeError, ValueError):
                    ts = None

        if ts is None:
            # Never reported at all. Only alert once we're past the boot
            # grace period — a fresh deploy hasn't had time to receive a
            # probe yet, so absence-of-data on startup isn't a real signal.
            if not past_boot_grace:
                return
            await self._send_stale_alert(
                redis_cache,
                source,
                stale_marker,
                text=(
                    f"⚠️ Uptime probe `{source}` has never reported a heartbeat — "
                    f"check GitHub Actions billing and the Railway `monitor` cron service."
                ),
                log_msg=f"Dead-man's switch: {source} has never reported",
            )
            return

        age_minutes = (now - ts).total_seconds() / 60

        if age_minutes > max_age:
            if not past_boot_grace:
                return
            await self._send_stale_alert(
                redis_cache,
                source,
                stale_marker,
                text=(f"⚠️ Uptime probe `{source}` has not reported in {age_minutes:.0f} minutes."),
                log_msg=(
                    f"Dead-man's switch: {source} heartbeat stale for {age_minutes:.0f} min "
                    f"(threshold {max_age})"
                ),
            )
        else:
            # Healthy — if we'd previously alerted for this source, send recovery.
            try:
                already_alerted = await redis_cache.get(stale_marker)
            except Exception:
                already_alerted = None

            if already_alerted:
                try:
                    await redis_cache.delete(stale_marker)
                except Exception as e:
                    logger.debug(f"Dead-man's switch: failed to clear marker for {source}: {e}")

                text = f"✅ Uptime probe `{source}` has recovered — heartbeats are reporting again."
                try:
                    from bot.services.support_notifier import post_admin_update

                    await post_admin_update(self._bot, text)
                except Exception as e:  # noqa: BLE001
                    logger.error(f"Dead-man's switch: failed to send recovery alert: {e}")

    async def _send_stale_alert(self, redis_cache, source, marker, text, log_msg):
        try:
            already_alerted = await redis_cache.get(marker)
        except Exception:
            already_alerted = None

        if already_alerted:
            return  # cooldown active — already alerted recently for this source

        try:
            await redis_cache.set(
                marker,
                {"alerted_at": datetime.now(timezone.utc).isoformat()},
                ttl_seconds=self._deadman_alert_cooldown_hours * 3600,
            )
        except Exception as e:
            logger.debug(f"Dead-man's switch: failed to write cooldown marker for {source}: {e}")

        logger.warning(log_msg)
        try:
            from bot.services.support_notifier import post_admin_update

            await post_admin_update(self._bot, text)
        except Exception as e:  # noqa: BLE001 — alert failure must not crash the loop
            logger.error(f"Dead-man's switch: failed to send alert for {source}: {e}")

    async def _check_source_failing(self, redis_cache, source, now, max_age):
        """Sustained-failure ("ok": false) check for a single expected source.

        The heartbeat endpoint stores a `fail_since` timestamp (set when a
        source's `ok` flag transitions true->false, cleared when it recovers
        to true). If a source has been continuously failing for longer than
        `max_age` minutes, that's a separate, distinct alert from staleness —
        the probe is running and reporting, but reporting sustained failure.
        """
        failing_marker = f"monitor:deadman:failing-alerted:{source}"

        try:
            data = await redis_cache.get(f"monitor:heartbeat:{source}")
        except Exception as e:
            logger.debug(f"Dead-man's switch: failed to read heartbeat for {source}: {e}")
            return

        if not isinstance(data, dict):
            return

        fail_since_raw = data.get("fail_since")
        if not fail_since_raw:
            # Not currently failing (or failure tracking unavailable) — clear
            # any previous failing-alert cooldown so recovery is clean.
            try:
                if await redis_cache.get(failing_marker):
                    await redis_cache.delete(failing_marker)
            except Exception:
                pass
            return

        try:
            fail_since = datetime.fromisoformat(fail_since_raw)
            if fail_since.tzinfo is None:
                fail_since = fail_since.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return

        failing_minutes = (now - fail_since).total_seconds() / 60
        if failing_minutes <= max_age:
            return

        try:
            already_alerted = await redis_cache.get(failing_marker)
        except Exception:
            already_alerted = None

        if already_alerted:
            return  # cooldown active

        try:
            await redis_cache.set(
                failing_marker,
                {"alerted_at": now.isoformat()},
                ttl_seconds=self._deadman_alert_cooldown_hours * 3600,
            )
        except Exception as e:
            logger.debug(f"Dead-man's switch: failed to write failing marker for {source}: {e}")

        text = (
            f"⚠️ Uptime probe `{source}` has been reporting failures for "
            f"{failing_minutes:.0f} minutes."
        )
        logger.warning(
            "Dead-man's switch: %s reporting sustained failure for %.0f min (threshold %d)",
            source,
            failing_minutes,
            max_age,
        )
        try:
            from bot.services.support_notifier import post_admin_update

            await post_admin_update(self._bot, text)
        except Exception as e:  # noqa: BLE001
            logger.error(f"Dead-man's switch: failed to send failing alert for {source}: {e}")

    async def _check_swap_health(self):
        """Check swap failure rate."""
        with get_session() as session:
            # Get swaps from last hour
            cutoff = datetime.now(timezone.utc) - timedelta(hours=1)

            recent_swaps = (
                session.query(SwapTransaction).filter(SwapTransaction.created_at >= cutoff).all()
            )

            if not recent_swaps:
                return

            # Calculate failure rate
            total = len(recent_swaps)
            failed = sum(1 for s in recent_swaps if s.status == SwapStatus.FAILED.value)
            failure_rate = failed / total

            if failure_rate >= self._failure_threshold and total >= 5:
                await self._send_alert(
                    Alert(
                        severity="critical",
                        title="High Swap Failure Rate",
                        message=(
                            f"Swap failure rate is {failure_rate:.1%}\n"
                            f"Failed: {failed}/{total} in last hour\n\n"
                            f"Please investigate immediately."
                        ),
                        timestamp=datetime.now(timezone.utc),
                        data={"failure_rate": failure_rate, "total": total, "failed": failed},
                    )
                )

    async def _check_api_health(self):
        """Check external API health."""
        from bot.utils.performance import perf_tracker

        # Check API error rates
        for api in ["api_lifi", "api_jupiter", "api_coingecko"]:
            stats = perf_tracker.get_stats(f"{api}_ms")
            if stats and stats.count >= 10:
                error_rate = stats.errors / stats.count
                if error_rate >= 0.3:  # 30% error rate
                    await self._send_alert(
                        Alert(
                            severity="warning",
                            title=f"API Degradation: {api}",
                            message=(
                                f"High error rate: {error_rate:.1%}\n"
                                f"Requests: {stats.count}, Errors: {stats.errors}\n"
                                f"Avg latency: {stats.avg:.0f}ms"
                            ),
                            timestamp=datetime.now(timezone.utc),
                        )
                    )

    async def _check_database_health(self):
        """Check database health."""
        from bot.utils.db_monitor import query_monitor

        stats = query_monitor.get_stats()
        avg_query_ms = stats.get("avg_query_ms", 0)

        if avg_query_ms > 500:  # Avg query > 500ms
            await self._send_alert(
                Alert(
                    severity="warning",
                    title="Database Slow",
                    message=(
                        f"Average query time: {avg_query_ms:.0f}ms\n"
                        f"Slow queries: {stats['slow_query_count']}\n"
                        f"Consider optimizing queries."
                    ),
                    timestamp=datetime.now(timezone.utc),
                )
            )

    async def _send_alert(self, alert: Alert):
        """Send an alert to admins."""
        # Check cooldown
        alert_key = f"{alert.severity}:{alert.title}"
        if alert_key in self._recent_alerts:
            last_sent = self._recent_alerts[alert_key]
            if (datetime.now(timezone.utc) - last_sent).seconds < self._alert_cooldown:
                return  # Skip, recently sent

        self._recent_alerts[alert_key] = datetime.now(timezone.utc)

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
