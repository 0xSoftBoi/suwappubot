"""Tests for performance tracking."""

import pytest
import asyncio
import time

from bot.utils.performance import (
    PerformanceTracker,
    MetricStats,
    track_time,
    Timer,
    MetricNames,
)


class TestMetricStats:
    """Tests for metric statistics."""
    
    def test_record_single_value(self):
        """Test recording a single value."""
        stats = MetricStats()
        stats.record(100.0)
        
        assert stats.count == 1
        assert stats.total == 100.0
        assert stats.min_value == 100.0
        assert stats.max_value == 100.0
        assert stats.last_value == 100.0
    
    def test_record_multiple_values(self):
        """Test recording multiple values."""
        stats = MetricStats()
        stats.record(50.0)
        stats.record(100.0)
        stats.record(150.0)
        
        assert stats.count == 3
        assert stats.total == 300.0
        assert stats.min_value == 50.0
        assert stats.max_value == 150.0
        assert stats.avg == 100.0
    
    def test_record_error(self):
        """Test recording error."""
        stats = MetricStats()
        stats.record(100.0, is_error=True)
        
        assert stats.errors == 1
        assert stats.count == 1
    
    def test_avg_empty(self):
        """Test avg on empty stats."""
        stats = MetricStats()
        assert stats.avg == 0


class TestPerformanceTracker:
    """Tests for performance tracker."""
    
    @pytest.mark.asyncio
    async def test_record_metric(self):
        """Test recording a metric."""
        tracker = PerformanceTracker()
        
        await tracker.record("test_metric", 100.0)
        
        stats = tracker.get_stats("test_metric")
        assert stats is not None
        assert stats.count == 1
    
    @pytest.mark.asyncio
    async def test_get_all_stats(self):
        """Test getting all stats."""
        tracker = PerformanceTracker()
        
        await tracker.record("metric1", 100.0)
        await tracker.record("metric2", 200.0)
        
        all_stats = tracker.get_all_stats()
        assert "metric1" in all_stats
        assert "metric2" in all_stats
    
    @pytest.mark.asyncio
    async def test_get_summary(self):
        """Test getting summary."""
        tracker = PerformanceTracker()
        
        await tracker.record("test_metric", 100.0)
        await tracker.record("test_metric", 200.0)
        
        summary = tracker.get_summary()
        assert "test_metric" in summary
        assert summary["test_metric"]["count"] == 2
        assert summary["test_metric"]["avg"] == 150.0
    
    def test_reset(self):
        """Test resetting tracker."""
        tracker = PerformanceTracker()
        tracker.record_sync("test_metric", 100.0)
        
        tracker.reset()
        
        assert tracker.get_stats("test_metric") is None


class TestTimer:
    """Tests for Timer context manager."""
    
    @pytest.mark.asyncio
    async def test_async_timer(self):
        """Test async timer context manager."""
        from bot.utils.performance import perf_tracker
        perf_tracker.reset()
        
        async with Timer("test_timer"):
            await asyncio.sleep(0.05)
        
        stats = perf_tracker.get_stats("test_timer_ms")
        assert stats is not None
        assert stats.count == 1
        assert stats.last_value >= 50  # At least 50ms
    
    def test_sync_timer(self):
        """Test sync timer context manager."""
        from bot.utils.performance import perf_tracker
        perf_tracker.reset()
        
        with Timer("test_sync_timer"):
            time.sleep(0.05)
        
        stats = perf_tracker.get_stats("test_sync_timer_ms")
        assert stats is not None
        assert stats.count == 1
        assert stats.last_value >= 50


class TestTrackTimeDecorator:
    """Tests for track_time decorator."""
    
    @pytest.mark.asyncio
    async def test_decorator_tracks_time(self):
        """Test decorator tracks execution time."""
        from bot.utils.performance import perf_tracker
        perf_tracker.reset()
        
        @track_time("decorated_func")
        async def slow_function():
            await asyncio.sleep(0.05)
            return "result"
        
        result = await slow_function()
        
        assert result == "result"
        stats = perf_tracker.get_stats("decorated_func_ms")
        assert stats is not None
        assert stats.count == 1
    
    @pytest.mark.asyncio
    async def test_decorator_tracks_errors(self):
        """Test decorator tracks errors."""
        from bot.utils.performance import perf_tracker
        perf_tracker.reset()
        
        @track_time("error_func")
        async def error_function():
            raise ValueError("test error")
        
        with pytest.raises(ValueError):
            await error_function()
        
        stats = perf_tracker.get_stats("error_func_ms")
        assert stats is not None
        assert stats.errors == 1

