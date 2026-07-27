"""Caching utilities for prices, quotes, and other data."""

import asyncio
import time
from collections import OrderedDict
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
    """Simple async-compatible in-memory cache with TTL and LRU eviction.

    Self-bounding by entry count: `cleanup_expired()` has no scheduled
    caller anywhere in the repo, so expired entries were previously skipped
    on read but never actually removed — one permanent dict entry per
    distinct key (address, quote params, etc.) forever. Bounding the cache
    by size here is more robust than depending on a periodic sweep task
    that may never get wired up.
    """

    def __init__(self, default_ttl: int = 60, maxsize: int = 2000):
        self._cache: "OrderedDict[str, CacheEntry]" = OrderedDict()
        self._default_ttl = default_ttl
        self._maxsize = maxsize
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        """Get a value from cache if not expired."""
        entry = self._cache.get(key)
        if entry is None or entry.is_expired:
            return None
        # Mark as most-recently-used. No lock needed: asyncio coroutines
        # only yield at `await` points, and this is a plain sync dict op.
        self._cache.move_to_end(key)
        return entry.value

    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Set a value in cache with optional TTL override."""
        ttl = ttl or self._default_ttl
        async with self._lock:
            self._cache[key] = CacheEntry(value=value, expires_at=time.time() + ttl)
            self._cache.move_to_end(key)
            # Evict least-recently-used entries once over the size bound.
            while len(self._cache) > self._maxsize:
                self._cache.popitem(last=False)

    async def delete(self, key: str) -> None:
        """Delete a key from cache."""
        async with self._lock:
            self._cache.pop(key, None)

    async def clear(self) -> None:
        """Clear all cache entries."""
        async with self._lock:
            self._cache.clear()

    async def cleanup_expired(self) -> int:
        """Remove expired entries and return count removed."""
        async with self._lock:
            expired_keys = [key for key, entry in self._cache.items() if entry.is_expired]
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


# Global cache instances. maxsize bounds distinct-key growth (see AsyncCache
# docstring) — sized generously above realistic steady-state cardinality for
# each cache's key space so eviction only kicks in under genuine growth.
price_cache = AsyncCache(default_ttl=30, maxsize=2000)  # 30 second TTL for prices
quote_cache = AsyncCache(default_ttl=15, maxsize=5000)  # 15 second TTL for quotes
balance_cache = AsyncCache(default_ttl=60, maxsize=5000)  # 60 second TTL for balances
gas_cache = AsyncCache(default_ttl=15, maxsize=500)  # 15 second TTL for gas prices


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
