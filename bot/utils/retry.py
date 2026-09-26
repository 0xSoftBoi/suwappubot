"""Retry utilities with exponential backoff."""

import asyncio
import logging
from typing import Type, Tuple, Callable
from functools import wraps

logger = logging.getLogger(__name__)


class RetryError(Exception):
    """Raised when all retry attempts fail."""

    def __init__(self, message: str, last_exception: Exception):
        self.message = message
        self.last_exception = last_exception
        super().__init__(message)


def async_retry(
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    max_delay: float = 30.0,
    exceptions: Tuple[Type[Exception], ...] = (Exception,),
    on_retry: Callable[[Exception, int], None] = None,
):
    """
    Decorator for retrying async functions with exponential backoff.

    Args:
        max_attempts: Maximum number of attempts
        delay: Initial delay between retries in seconds
        backoff: Multiplier for delay after each retry
        max_delay: Maximum delay between retries
        exceptions: Tuple of exceptions to catch and retry
        on_retry: Optional callback called on each retry with (exception, attempt)
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            current_delay = delay
            last_exception = None

            for attempt in range(1, max_attempts + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e

                    if attempt == max_attempts:
                        logger.error(f"{func.__name__} failed after {max_attempts} attempts: {e}")
                        raise RetryError(f"Failed after {max_attempts} attempts", last_exception)

                    if on_retry:
                        on_retry(e, attempt)

                    logger.warning(
                        f"{func.__name__} attempt {attempt} failed: {e}. "
                        f"Retrying in {current_delay:.1f}s..."
                    )

                    await asyncio.sleep(current_delay)
                    current_delay = min(current_delay * backoff, max_delay)

            raise RetryError(f"Failed after {max_attempts} attempts", last_exception)

        return wrapper

    return decorator


def sync_retry(
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    max_delay: float = 30.0,
    exceptions: Tuple[Type[Exception], ...] = (Exception,),
):
    """Decorator for retrying sync functions with exponential backoff."""
    import time

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            current_delay = delay
            last_exception = None

            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e

                    if attempt == max_attempts:
                        raise RetryError(f"Failed after {max_attempts} attempts", last_exception)

                    logger.warning(
                        f"{func.__name__} attempt {attempt} failed: {e}. "
                        f"Retrying in {current_delay:.1f}s..."
                    )

                    time.sleep(current_delay)
                    current_delay = min(current_delay * backoff, max_delay)

            raise RetryError(f"Failed after {max_attempts} attempts", last_exception)

        return wrapper

    return decorator
