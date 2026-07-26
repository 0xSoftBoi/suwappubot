"""Performance tracking and metrics."""

import time
import asyncio
import logging
from typing import Dict, Optional, Callable, Any
from functools import wraps
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Metric:
    """A single metric measurement."""

    name: str
    value: float
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tags: Dict[str, str] = field(default_factory=dict)


@dataclass
class MetricStats:
    """Statistics for a metric."""

    count: int = 0
    total: float = 0
    min_value: float = float("inf")
    max_value: float = float("-inf")
    last_value: float = 0
    errors: int = 0

    @property
    def avg(self) -> float:
        return self.total / self.count if self.count > 0 else 0

    def record(self, value: float, is_error: bool = False):
        self.count += 1
        self.total += value
        self.min_value = min(self.min_value, value)
        self.max_value = max(self.max_value, value)
        self.last_value = value
        if is_error:
            self.errors += 1


class PerformanceTracker:
    """Track performance metrics across the application."""

    # Bound on the raw-sample ring buffer. Aggregate stats reported by
    # get_stats()/get_summary() come from the running MetricStats totals in
    # self._metrics (O(1) per record), NOT from self._history — nothing in
    # the repo reads self._history for time-windowed reporting. It previously
    # held every sample for a rolling 24h retention window and was rebuilt
    # (O(n) list-copy) on EVERY record() call while holding the global lock,
    # which serialized every quote/execute path under load. A fixed-size
    # deque gives O(1) append/evict with no lock-held rebuild, and bounds
    # memory regardless of throughput.
    _HISTORY_MAXLEN = 10_000

    def __init__(self, retention_hours: int = 24):
        self._metrics: Dict[str, MetricStats] = defaultdict(MetricStats)
        self._history: deque = deque(maxlen=self._HISTORY_MAXLEN)
        self._retention = timedelta(hours=retention_hours)
        self._lock = asyncio.Lock()

    async def record(
        self,
        name: str,
        value: float,
        tags: Dict[str, str] = None,
        is_error: bool = False,
    ):
        """Record a metric value."""
        async with self._lock:
            self._metrics[name].record(value, is_error)

            # deque(maxlen=...) evicts the oldest sample in O(1) once full —
            # no per-call rebuild needed.
            self._history.append(
                Metric(
                    name=name,
                    value=value,
                    tags=tags or {},
                )
            )

    def record_sync(
        self,
        name: str,
        value: float,
        tags: Dict[str, str] = None,
        is_error: bool = False,
    ):
        """Record a metric value (sync version)."""
        self._metrics[name].record(value, is_error)
        # Same bounded deque as record() above — bounded here too.
        self._history.append(Metric(name=name, value=value, tags=tags or {}))

    def get_stats(self, name: str) -> Optional[MetricStats]:
        """Get statistics for a metric."""
        return self._metrics.get(name)

    def get_all_stats(self) -> Dict[str, MetricStats]:
        """Get all metric statistics."""
        return dict(self._metrics)

    def get_summary(self) -> Dict[str, Any]:
        """Get a summary of all metrics."""
        summary = {}
        for name, stats in self._metrics.items():
            summary[name] = {
                "count": stats.count,
                "avg": round(stats.avg, 3),
                "min": round(stats.min_value, 3) if stats.min_value != float("inf") else 0,
                "max": round(stats.max_value, 3) if stats.max_value != float("-inf") else 0,
                "errors": stats.errors,
                "error_rate": round(stats.errors / stats.count * 100, 1) if stats.count > 0 else 0,
            }
        return summary

    def reset(self):
        """Reset all metrics."""
        self._metrics.clear()
        self._history.clear()


# Global tracker
perf_tracker = PerformanceTracker()


def track_time(metric_name: str, tags: Dict[str, str] = None):
    """Decorator to track execution time of async functions."""

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start = time.perf_counter()
            is_error = False
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                is_error = True
                raise
            finally:
                duration = (time.perf_counter() - start) * 1000  # ms
                await perf_tracker.record(
                    f"{metric_name}_ms",
                    duration,
                    tags=tags,
                    is_error=is_error,
                )

                if duration > 1000:  # Log slow operations (>1s)
                    logger.warning(f"Slow operation: {metric_name} took {duration:.0f}ms")

        return wrapper

    return decorator


def track_time_sync(metric_name: str, tags: Dict[str, str] = None):
    """Decorator to track execution time of sync functions."""

    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            is_error = False
            try:
                return func(*args, **kwargs)
            except Exception as e:
                is_error = True
                raise
            finally:
                duration = (time.perf_counter() - start) * 1000  # ms
                perf_tracker.record_sync(
                    f"{metric_name}_ms",
                    duration,
                    tags=tags,
                    is_error=is_error,
                )

        return wrapper

    return decorator


class Timer:
    """Context manager for timing code blocks."""

    def __init__(self, metric_name: str, tags: Dict[str, str] = None):
        self.metric_name = metric_name
        self.tags = tags or {}
        self.start = None
        self.duration = None

    async def __aenter__(self):
        self.start = time.perf_counter()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        self.duration = (time.perf_counter() - self.start) * 1000
        await perf_tracker.record(
            f"{self.metric_name}_ms",
            self.duration,
            tags=self.tags,
            is_error=exc_type is not None,
        )
        return False

    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.duration = (time.perf_counter() - self.start) * 1000
        perf_tracker.record_sync(
            f"{self.metric_name}_ms",
            self.duration,
            tags=self.tags,
            is_error=exc_type is not None,
        )
        return False


# Pre-defined metric names
class MetricNames:
    """Standard metric names."""

    SWAP_QUOTE = "swap_quote"
    SWAP_EXECUTE = "swap_execute"
    BALANCE_FETCH = "balance_fetch"
    PRICE_FETCH = "price_fetch"
    DB_QUERY = "db_query"
    RPC_CALL = "rpc_call"
    API_LIFI = "api_lifi"
    API_JUPITER = "api_jupiter"
    API_COINGECKO = "api_coingecko"
    API_SUNSWAP = "api_sunswap"
    API_OKX_DEX = "api_okx_dex"
    API_1INCH = "api_1inch"
    API_0X = "api_0x"
    API_KYBERSWAP = "api_kyberswap"
    HANDLER_COMMAND = "handler_command"
    HANDLER_CALLBACK = "handler_callback"
