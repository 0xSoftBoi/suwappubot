"""Tests for the circuit breaker pattern."""

import time
import pytest
from bot.utils.circuit_breaker import CircuitBreaker, CircuitState


class TestCircuitBreaker:
    """Tests for CircuitBreaker."""

    def test_initially_closed(self):
        cb = CircuitBreaker(failure_threshold=3)
        assert cb.is_available("test") is True

    def test_opens_after_threshold_failures(self):
        cb = CircuitBreaker(failure_threshold=3, cooldown_seconds=60)

        cb.record_failure("test")
        assert cb.is_available("test") is True

        cb.record_failure("test")
        assert cb.is_available("test") is True

        cb.record_failure("test")
        # Now at threshold - circuit should be open
        assert cb.is_available("test") is False

    def test_success_resets_failure_count(self):
        cb = CircuitBreaker(failure_threshold=3)

        cb.record_failure("test")
        cb.record_failure("test")
        cb.record_success("test")

        # After success, failure count resets
        cb.record_failure("test")
        cb.record_failure("test")
        assert cb.is_available("test") is True

    def test_half_open_after_cooldown(self):
        cb = CircuitBreaker(failure_threshold=2, cooldown_seconds=0.01)

        cb.record_failure("test")
        cb.record_failure("test")
        assert cb.is_available("test") is False

        # Wait for cooldown
        time.sleep(0.02)
        assert cb.is_available("test") is True  # half-open

    def test_half_open_failure_reopens(self):
        cb = CircuitBreaker(failure_threshold=2, cooldown_seconds=0.01)

        cb.record_failure("test")
        cb.record_failure("test")

        time.sleep(0.02)
        assert cb.is_available("test") is True  # half-open

        cb.record_failure("test")
        assert cb.is_available("test") is False  # reopened

    def test_half_open_success_closes(self):
        cb = CircuitBreaker(failure_threshold=2, cooldown_seconds=0.01)

        cb.record_failure("test")
        cb.record_failure("test")

        time.sleep(0.02)
        cb.record_success("test")
        assert cb.is_available("test") is True

    def test_independent_providers(self):
        cb = CircuitBreaker(failure_threshold=2)

        cb.record_failure("provider_a")
        cb.record_failure("provider_a")
        assert cb.is_available("provider_a") is False
        assert cb.is_available("provider_b") is True

    def test_get_status(self):
        cb = CircuitBreaker(failure_threshold=2)

        cb.record_failure("down")
        cb.record_failure("down")
        cb.record_success("up")

        status = cb.get_status()
        assert status["down"] == "open"
        assert status["up"] == "closed"
