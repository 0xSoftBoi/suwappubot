"""Optional Prometheus metrics for observability.

Provides counters, histograms, and gauges for swap operations,
provider performance, and system health. Only active when
`prometheus_client` is installed.

Usage:
    from bot.utils.prometheus_metrics import metrics

    # In swap engine
    metrics.swap_quote_latency.labels(provider="lifi").observe(duration)
    metrics.swap_executed_total.labels(provider="lifi", status="success").inc()
"""

import logging

logger = logging.getLogger(__name__)

try:
    from prometheus_client import Counter, Histogram, Gauge, Info, generate_latest, CONTENT_TYPE_LATEST

    PROMETHEUS_AVAILABLE = True

    class PrometheusMetrics:
        """Prometheus metrics for the Suwappu bot."""

        def __init__(self):
            # Swap metrics
            self.swap_quote_latency = Histogram(
                "suwappu_swap_quote_seconds",
                "Time to fetch a swap quote",
                ["provider"],
                buckets=[0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
            )
            self.swap_executed_total = Counter(
                "suwappu_swap_executed_total",
                "Total swaps executed",
                ["provider", "status", "from_chain", "to_chain"],
            )
            self.swap_volume_usd = Counter(
                "suwappu_swap_volume_usd_total",
                "Total swap volume in USD",
                ["from_chain", "to_chain"],
            )

            # Provider health
            self.provider_errors_total = Counter(
                "suwappu_provider_errors_total",
                "Total errors per provider",
                ["provider", "error_type"],
            )
            self.circuit_breaker_state = Gauge(
                "suwappu_circuit_breaker_state",
                "Circuit breaker state (0=closed, 1=open, 2=half-open)",
                ["provider"],
            )

            # User metrics
            self.active_users = Gauge(
                "suwappu_active_users",
                "Number of active users in the last hour",
            )
            self.rate_limit_hits = Counter(
                "suwappu_rate_limit_hits_total",
                "Number of rate limit hits",
                ["limiter"],
            )

            # System
            self.info = Info(
                "suwappu",
                "Suwappu bot information",
            )
            self.info.info({"version": "1.0.0"})

        def get_metrics(self) -> bytes:
            """Generate Prometheus metrics output."""
            return generate_latest()

        def get_content_type(self) -> str:
            return CONTENT_TYPE_LATEST

except ImportError:
    PROMETHEUS_AVAILABLE = False
    logger.debug("prometheus_client not installed, metrics disabled")

    class PrometheusMetrics:
        """No-op metrics when prometheus_client is not installed."""

        def __init__(self):
            pass

        def __getattr__(self, name):
            return _NoOpMetric()

        def get_metrics(self) -> bytes:
            return b""

        def get_content_type(self) -> str:
            return "text/plain"


class _NoOpMetric:
    """No-op metric that silently ignores all operations."""
    def labels(self, **kwargs):
        return self
    def inc(self, amount=1):
        pass
    def dec(self, amount=1):
        pass
    def set(self, value):
        pass
    def observe(self, value):
        pass
    def info(self, val):
        pass


# Global singleton
metrics = PrometheusMetrics()
