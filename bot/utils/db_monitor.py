"""Database monitoring and slow query logging."""

import time
import logging
from typing import Callable
from contextlib import contextmanager

from sqlalchemy import event
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Configuration
SLOW_QUERY_THRESHOLD_MS = 100  # Log queries slower than this


class QueryMonitor:
    """Monitor database queries for performance issues."""

    def __init__(self):
        self._enabled = True
        self._slow_queries = []
        self._total_queries = 0
        self._total_time_ms = 0

    def enable(self, engine: Engine):
        """Enable query monitoring on an engine."""

        @event.listens_for(engine, "before_cursor_execute")
        def before_execute(conn, cursor, statement, parameters, context, executemany):
            conn.info.setdefault("query_start_time", []).append(time.perf_counter())

        @event.listens_for(engine, "after_cursor_execute")
        def after_execute(conn, cursor, statement, parameters, context, executemany):
            start_times = conn.info.get("query_start_time", [])
            if not start_times:
                return

            total = (time.perf_counter() - start_times.pop()) * 1000  # ms

            self._total_queries += 1
            self._total_time_ms += total

            if total > SLOW_QUERY_THRESHOLD_MS:
                self._log_slow_query(statement, parameters, total)

    def _log_slow_query(self, statement: str, parameters, duration_ms: float):
        """Log a slow query."""
        # Truncate statement for logging
        stmt_preview = statement[:200] + "..." if len(statement) > 200 else statement

        logger.warning(f"Slow query ({duration_ms:.0f}ms): {stmt_preview}")

        self._slow_queries.append(
            {
                "statement": statement[:500],
                "duration_ms": duration_ms,
                "timestamp": time.time(),
            }
        )

        # Keep only last 100 slow queries
        if len(self._slow_queries) > 100:
            self._slow_queries = self._slow_queries[-100:]

    def get_stats(self) -> dict:
        """Get query statistics."""
        return {
            "total_queries": self._total_queries,
            "total_time_ms": round(self._total_time_ms, 2),
            "avg_query_ms": (
                round(self._total_time_ms / self._total_queries, 2)
                if self._total_queries > 0
                else 0
            ),
            "slow_query_count": len(self._slow_queries),
        }

    def get_slow_queries(self, limit: int = 10) -> list:
        """Get recent slow queries."""
        return self._slow_queries[-limit:]

    def reset(self):
        """Reset statistics."""
        self._slow_queries = []
        self._total_queries = 0
        self._total_time_ms = 0


# Global instance
query_monitor = QueryMonitor()


def setup_db_monitoring(engine: Engine):
    """Set up database monitoring for an engine."""
    query_monitor.enable(engine)
    logger.info(f"Database monitoring enabled (slow query threshold: {SLOW_QUERY_THRESHOLD_MS}ms)")


@contextmanager
def log_query_time(description: str):
    """Context manager to log database operation time."""
    start = time.perf_counter()
    try:
        yield
    finally:
        duration = (time.perf_counter() - start) * 1000
        if duration > SLOW_QUERY_THRESHOLD_MS:
            logger.warning(f"Slow DB operation ({duration:.0f}ms): {description}")
