"""Circuit breaker pattern for external API calls.

Tracks failures per provider and skips known-down providers for a cooldown
period to avoid wasting time on retries.
"""

import time
import logging
from enum import Enum
from typing import Dict

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Provider is down, skip calls
    HALF_OPEN = "half_open"  # Testing if provider recovered


class CircuitBreaker:
    """Per-provider circuit breaker.

    After `failure_threshold` consecutive failures, the circuit opens
    for `cooldown_seconds`. After cooldown, one probe request is allowed
    (half-open). If it succeeds, the circuit closes. If it fails, the
    circuit reopens.
    """

    def __init__(
        self,
        failure_threshold: int = 3,
        cooldown_seconds: float = 60,
    ):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._providers: Dict[str, dict] = {}

    def _get_state(self, provider: str) -> dict:
        if provider not in self._providers:
            self._providers[provider] = {
                "state": CircuitState.CLOSED,
                "failure_count": 0,
                "last_failure_time": 0.0,
                "last_success_time": 0.0,
            }
        return self._providers[provider]

    def is_available(self, provider: str) -> bool:
        """Check if a provider is available (circuit not open)."""
        state = self._get_state(provider)

        if state["state"] == CircuitState.CLOSED:
            return True

        if state["state"] == CircuitState.OPEN:
            # Check if cooldown has elapsed
            elapsed = time.monotonic() - state["last_failure_time"]
            if elapsed >= self.cooldown_seconds:
                state["state"] = CircuitState.HALF_OPEN
                logger.info(f"Circuit breaker half-open for {provider}")
                return True
            return False

        # HALF_OPEN: allow one probe request
        return True

    def record_success(self, provider: str) -> None:
        """Record a successful call to a provider."""
        state = self._get_state(provider)
        state["failure_count"] = 0
        state["last_success_time"] = time.monotonic()
        if state["state"] != CircuitState.CLOSED:
            logger.info(f"Circuit breaker closed for {provider}")
            state["state"] = CircuitState.CLOSED

    def record_failure(self, provider: str) -> None:
        """Record a failed call to a provider."""
        state = self._get_state(provider)
        state["failure_count"] += 1
        state["last_failure_time"] = time.monotonic()

        if state["state"] == CircuitState.HALF_OPEN:
            state["state"] = CircuitState.OPEN
            logger.warning(f"Circuit breaker re-opened for {provider}")
        elif state["failure_count"] >= self.failure_threshold:
            state["state"] = CircuitState.OPEN
            logger.warning(
                f"Circuit breaker opened for {provider} after "
                f"{state['failure_count']} failures (cooldown: {self.cooldown_seconds}s)"
            )

    def get_status(self) -> Dict[str, str]:
        """Get status of all tracked providers."""
        return {
            provider: info["state"].value
            for provider, info in self._providers.items()
        }


# Global instance for swap providers
provider_circuit_breaker = CircuitBreaker(failure_threshold=3, cooldown_seconds=60)
