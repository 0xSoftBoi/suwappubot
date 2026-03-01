"""Circuit breaker for RPC endpoints and external API calls."""

import asyncio
import logging
import time
from enum import Enum
from typing import Callable, Any, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"       # Normal operation
    OPEN = "open"           # Failing, fast-fail all requests
    HALF_OPEN = "half_open" # Testing with single request


@dataclass
class CircuitBreaker:
    """
    Circuit breaker for external service calls.

    States:
        CLOSED → OPEN: After `failure_threshold` failures within `failure_window`
        OPEN → HALF_OPEN: After `recovery_timeout` seconds
        HALF_OPEN → CLOSED: On first successful call
        HALF_OPEN → OPEN: On first failed call
    """
    name: str
    failure_threshold: int = 5
    failure_window: float = 30.0     # seconds
    recovery_timeout: float = 30.0   # seconds

    # Internal state
    _state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    _failures: list = field(default_factory=list, init=False)
    _last_failure_time: float = field(default=0.0, init=False)
    _opened_at: float = field(default=0.0, init=False)
    _success_count: int = field(default=0, init=False)
    _failure_count: int = field(default=0, init=False)

    @property
    def state(self) -> CircuitState:
        """Get current circuit state, potentially transitioning from OPEN to HALF_OPEN."""
        if self._state == CircuitState.OPEN:
            if time.time() - self._opened_at >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                logger.info(f"Circuit breaker '{self.name}' → HALF_OPEN (testing)")
        return self._state

    @property
    def is_open(self) -> bool:
        return self.state == CircuitState.OPEN

    def _record_failure(self):
        """Record a failure and potentially open the circuit."""
        now = time.time()
        self._failures.append(now)
        self._failure_count += 1
        self._last_failure_time = now

        # Clean old failures outside the window
        cutoff = now - self.failure_window
        self._failures = [t for t in self._failures if t > cutoff]

        if self._state == CircuitState.HALF_OPEN:
            # Any failure in half-open → back to open
            self._state = CircuitState.OPEN
            self._opened_at = now
            logger.warning(f"Circuit breaker '{self.name}' → OPEN (half-open test failed)")
        elif len(self._failures) >= self.failure_threshold:
            self._state = CircuitState.OPEN
            self._opened_at = now
            logger.warning(
                f"Circuit breaker '{self.name}' → OPEN "
                f"({len(self._failures)} failures in {self.failure_window}s)"
            )

    def _record_success(self):
        """Record a success and potentially close the circuit."""
        self._success_count += 1

        if self._state == CircuitState.HALF_OPEN:
            self._state = CircuitState.CLOSED
            self._failures.clear()
            logger.info(f"Circuit breaker '{self.name}' → CLOSED (recovered)")

    async def call(self, fn: Callable, *args, **kwargs) -> Any:
        """
        Execute function through circuit breaker.

        Raises CircuitBreakerOpen if circuit is open.
        """
        current_state = self.state

        if current_state == CircuitState.OPEN:
            raise CircuitBreakerOpen(
                f"Circuit breaker '{self.name}' is OPEN. "
                f"Will retry in {self.recovery_timeout - (time.time() - self._opened_at):.0f}s"
            )

        try:
            if asyncio.iscoroutinefunction(fn):
                result = await fn(*args, **kwargs)
            else:
                result = fn(*args, **kwargs)

            self._record_success()
            return result

        except CircuitBreakerOpen:
            raise
        except Exception as e:
            self._record_failure()
            raise

    def reset(self):
        """Manually reset the circuit breaker to closed state."""
        self._state = CircuitState.CLOSED
        self._failures.clear()
        self._opened_at = 0.0
        logger.info(f"Circuit breaker '{self.name}' manually reset → CLOSED")

    def get_stats(self) -> dict:
        """Get circuit breaker statistics."""
        return {
            "name": self.name,
            "state": self.state.value,
            "total_successes": self._success_count,
            "total_failures": self._failure_count,
            "recent_failures": len(self._failures),
            "last_failure": self._last_failure_time,
        }


class CircuitBreakerOpen(Exception):
    """Raised when circuit breaker is open."""
    pass


class RPCCircuitBreakers:
    """Manages circuit breakers for RPC endpoints per chain."""

    def __init__(self):
        self._breakers: dict[str, CircuitBreaker] = {}

    def get_breaker(self, chain_name: str) -> CircuitBreaker:
        """Get or create a circuit breaker for a chain."""
        if chain_name not in self._breakers:
            self._breakers[chain_name] = CircuitBreaker(
                name=f"rpc_{chain_name}",
                failure_threshold=5,
                failure_window=30.0,
                recovery_timeout=30.0,
            )
        return self._breakers[chain_name]

    async def call_with_failover(
        self,
        chain_name: str,
        rpc_urls: list[str],
        fn: Callable,
        *args,
        **kwargs,
    ) -> Any:
        """
        Call function with circuit breaker and RPC failover.

        Tries each RPC URL in order. If a circuit is open for one URL,
        skips to the next.
        """
        last_error = None

        for i, rpc_url in enumerate(rpc_urls):
            breaker_name = f"{chain_name}_{i}"
            if breaker_name not in self._breakers:
                self._breakers[breaker_name] = CircuitBreaker(
                    name=breaker_name,
                    failure_threshold=5,
                    failure_window=30.0,
                    recovery_timeout=30.0,
                )

            breaker = self._breakers[breaker_name]

            try:
                return await breaker.call(fn, rpc_url, *args, **kwargs)
            except CircuitBreakerOpen:
                logger.debug(f"Skipping {rpc_url} (circuit open)")
                continue
            except Exception as e:
                last_error = e
                logger.warning(f"RPC call to {rpc_url} failed: {e}")
                continue

        raise last_error or Exception(f"All RPC endpoints failed for {chain_name}")

    def get_all_stats(self) -> dict[str, dict]:
        """Get stats for all circuit breakers."""
        return {name: cb.get_stats() for name, cb in self._breakers.items()}


# Global instance
rpc_circuit_breakers = RPCCircuitBreakers()
