"""Caching utilities for prices, quotes, and other data."""

import asyncio
import time
from typing import Any, Optional, Callable
from dataclasses import dataclass, field
from functools import wraps


@dataclass
class CacheEntry:
    """A single cache entry with expiration."""
    value: Any
    expires_at: float

    @property
    def is_expired(self) -> bool:
        return time.time() > self.expires_at


class AsyncCache:
    """Async-compatible cache backed by Redis (shared across instances) with local L1."""

    def __init__(self, default_ttl: int = 60, prefix: str = "cache"):
        self._cache: dict[str, CacheEntry] = {}
        self._default_ttl = default_ttl
        self._lock = asyncio.Lock()
        self._prefix = prefix

    def _redis_key(self, key: str) -> str:
        return f"{self._prefix}:{key}"

    async def get(self, key: str) -> Optional[Any]:
        """Get a value — tries Redis first, then local memory."""
        # Try Redis (shared across instances)
        from bot.utils.redis_cache import redis_cache
        if redis_cache._connected:
            try:
                val = await redis_cache.get(self._redis_key(key))
                if val is not None:
                    return val
            except Exception:
                pass

        # Fall back to local memory
        entry = self._cache.get(key)
        if entry is None or entry.is_expired:
            return None
        return entry.value

    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Set a value in both Redis and local memory."""
        ttl = ttl or self._default_ttl

        # Write to Redis
        from bot.utils.redis_cache import redis_cache
        if redis_cache._connected:
            try:
                await redis_cache.set(self._redis_key(key), value, ttl)
            except Exception:
                pass

        # Always write to local memory as L1
        async with self._lock:
            self._cache[key] = CacheEntry(
                value=value,
                expires_at=time.time() + ttl
            )

    async def delete(self, key: str) -> None:
        """Delete a key from cache."""
        from bot.utils.redis_cache import redis_cache
        if redis_cache._connected:
            try:
                await redis_cache.delete(self._redis_key(key))
            except Exception:
                pass

        async with self._lock:
            self._cache.pop(key, None)

    async def clear(self) -> None:
        """Clear all cache entries."""
        from bot.utils.redis_cache import redis_cache
        if redis_cache._connected:
            try:
                await redis_cache.clear_pattern(f"{self._prefix}:*")
            except Exception:
                pass

        async with self._lock:
            self._cache.clear()

    async def cleanup_expired(self) -> int:
        """Remove expired entries and return count removed."""
        async with self._lock:
            expired_keys = [
                key for key, entry in self._cache.items()
                if entry.is_expired
            ]
            for key in expired_keys:
                del self._cache[key]
            return len(expired_keys)

    def stats(self) -> dict:
        """Get cache statistics."""
        total = len(self._cache)
        expired = sum(1 for e in self._cache.values() if e.is_expired)
        return {
            "total_entries": total,
            "active_entries": total - expired,
            "expired_entries": expired,
        }


# Global cache instances
price_cache = AsyncCache(default_ttl=30, prefix="price")  # 30 second TTL for prices
quote_cache = AsyncCache(default_ttl=15, prefix="quote")  # 15 second TTL for quotes
balance_cache = AsyncCache(default_ttl=60, prefix="balance")  # 60 second TTL for balances
gas_cache = AsyncCache(default_ttl=15, prefix="gas")  # 15 second TTL for gas prices


def cached(cache: AsyncCache, key_func: Callable[..., str], ttl: Optional[int] = None):
    """Decorator for caching async function results."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            cache_key = key_func(*args, **kwargs)

            # Try to get from cache
            cached_value = await cache.get(cache_key)
            if cached_value is not None:
                return cached_value

            # Call function and cache result
            result = await func(*args, **kwargs)
            await cache.set(cache_key, result, ttl)
            return result

        return wrapper
    return decorator


class RateLimiter:
    """Simple rate limiter for API calls."""

    def __init__(self, calls_per_second: float = 10):
        self._min_interval = 1.0 / calls_per_second
        self._last_call = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Wait if necessary to respect rate limit."""
        async with self._lock:
            now = time.time()
            time_since_last = now - self._last_call

            if time_since_last < self._min_interval:
                await asyncio.sleep(self._min_interval - time_since_last)

            self._last_call = time.time()


# Rate limiters for different APIs
lifi_rate_limiter = RateLimiter(calls_per_second=5)
jupiter_rate_limiter = RateLimiter(calls_per_second=10)
rpc_rate_limiter = RateLimiter(calls_per_second=20)
