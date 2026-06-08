"""Redis-backed caching service with in-memory fallback."""

import logging
import time
import asyncio
import fnmatch
import functools
import json
from typing import Any, Optional

logger = logging.getLogger(__name__)


class RedisCache:
    """
    Redis-backed cache with automatic in-memory fallback.
    Connects to REDIS_URL if available; degrades gracefully to in-memory otherwise.
    """

    MAX_MEMORY_KEYS = 10_000

    def __init__(self):
        self._redis = None
        self._connected = False
        self._memory_cache: dict = {}
        self._memory_ttl: dict = {}
        self._last_cleanup = 0.0

    async def connect(self) -> bool:
        """Connect to Redis if REDIS_URL is set, otherwise use in-memory."""
        import os
        redis_url = os.environ.get("REDIS_URL")
        if not redis_url:
            logger.info("REDIS_URL not set — using in-memory cache")
            return False

        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=3,
                retry_on_timeout=True,
            )
            await self._redis.ping()
            self._connected = True
            logger.info("Connected to Redis at %s", redis_url.split("@")[-1] if "@" in redis_url else redis_url)
            return True
        except Exception as e:
            logger.warning(f"Redis connection failed, falling back to in-memory: {e}")
            self._redis = None
            self._connected = False
            return False

    async def close(self):
        """Close Redis connection."""
        if self._redis:
            try:
                await self._redis.aclose()
            except Exception:
                pass
            self._redis = None
            self._connected = False

    async def get(self, key: str) -> Optional[Any]:
        """Get value from Redis (or memory fallback)."""
        # Try Redis first
        if self._redis and self._connected:
            try:
                raw = await self._redis.get(key)
                if raw is not None:
                    try:
                        return json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        return raw
                return None
            except Exception as e:
                logger.debug(f"Redis GET failed for {key}: {e}")
                # Fall through to memory

        # Memory fallback
        if key not in self._memory_cache:
            return None
        ttl = self._memory_ttl.get(key, 0)
        if ttl and time.time() > ttl:
            self._memory_cache.pop(key, None)
            self._memory_ttl.pop(key, None)
            return None
        return self._memory_cache[key]

    async def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: int = 300,
    ) -> bool:
        """Set value in Redis (or memory fallback) with TTL."""
        # Try Redis first
        if self._redis and self._connected:
            try:
                raw = json.dumps(value, default=str)
                await self._redis.setex(key, ttl_seconds, raw)
                return True
            except Exception as e:
                logger.debug(f"Redis SET failed for {key}: {e}")
                # Fall through to memory

        # Memory fallback
        self._memory_cache[key] = value
        self._memory_ttl[key] = time.time() + ttl_seconds
        self._maybe_cleanup_memory()
        return True

    def _maybe_cleanup_memory(self):
        """Evict expired entries from in-memory cache periodically."""
        now = time.time()
        if now - self._last_cleanup < 60:  # at most once per minute
            return
        self._last_cleanup = now
        expired = [k for k, ttl in self._memory_ttl.items() if ttl < now]
        for k in expired:
            self._memory_cache.pop(k, None)
            self._memory_ttl.pop(k, None)
        # Hard cap: evict oldest entries if over limit
        if len(self._memory_cache) > self.MAX_MEMORY_KEYS:
            sorted_keys = sorted(self._memory_ttl, key=self._memory_ttl.get)
            for k in sorted_keys[:len(self._memory_cache) - self.MAX_MEMORY_KEYS]:
                self._memory_cache.pop(k, None)
                self._memory_ttl.pop(k, None)

    async def ping(self) -> bool:
        """Return True if Redis is reachable, False if using memory fallback."""
        if self._redis and self._connected:
            try:
                await self._redis.ping()
                return True
            except Exception:
                return False
        return False

    async def delete(self, key: str) -> bool:
        """Delete key from Redis (or memory fallback)."""
        if self._redis and self._connected:
            try:
                await self._redis.delete(key)
            except Exception as e:
                logger.debug(f"Redis DELETE failed for {key}: {e}")

        self._memory_cache.pop(key, None)
        self._memory_ttl.pop(key, None)
        return True

    async def get_del(self, key: str) -> Optional[Any]:
        """Atomically fetch and delete a key (single-use token pattern).

        Returns the value to at most one caller, so concurrent requests can't
        both consume the same single-use token (e.g. a WebAuthn passkey
        challenge). A plain ``get`` then ``delete`` has a TOCTOU window where
        two requests both read the value before either deletes it — a replay.

        When connected to Redis this uses ``GETDEL`` (atomic, cross-replica),
        falling back to a Lua ``GET``+``DEL`` for older servers. A Redis error
        is raised rather than silently degraded, so single-use semantics are
        never quietly lost. In memory mode it does an atomic in-process
        get-then-pop (no ``await`` between read and remove, so coroutines can't
        interleave); cross-replica single-use genuinely requires Redis, which
        is why these tokens are routed through it.
        """
        if self._redis and self._connected:
            try:
                raw = await self._redis.getdel(key)
            except AttributeError:
                # Client predates GETDEL: emulate atomically with a Lua script.
                raw = await self._redis.eval(
                    "local v = redis.call('GET', KEYS[1]); "
                    "if v then redis.call('DEL', KEYS[1]) end; return v",
                    1,
                    key,
                )
            except Exception as e:
                logger.error(f"Redis GETDEL failed for {key}: {e}")
                raise
            if raw is None:
                return None
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw

        # Memory mode: atomic get-then-pop (no await between → no interleave).
        if key not in self._memory_cache:
            return None
        ttl = self._memory_ttl.get(key, 0)
        value = self._memory_cache.pop(key, None)
        self._memory_ttl.pop(key, None)
        if ttl and time.time() > ttl:
            return None
        return value

    async def clear_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern."""
        count = 0

        # Redis pattern delete
        if self._redis and self._connected:
            try:
                async for key in self._redis.scan_iter(match=pattern, count=100):
                    await self._redis.delete(key)
                    count += 1
            except Exception as e:
                logger.debug(f"Redis SCAN/DELETE failed for {pattern}: {e}")

        # Also clear from memory fallback
        keys_to_delete = [k for k in self._memory_cache if fnmatch.fnmatch(k, pattern)]
        for k in keys_to_delete:
            self._memory_cache.pop(k, None)
            self._memory_ttl.pop(k, None)
            count += 1

        return count

    async def get_or_set(
        self,
        key: str,
        factory,  # async callable
        ttl_seconds: int = 300,
    ) -> Any:
        """Get from cache or call factory and cache result."""
        value = await self.get(key)
        if value is not None:
            return value

        if asyncio.iscoroutinefunction(factory):
            value = await factory()
        else:
            value = factory()

        if value is not None:
            await self.set(key, value, ttl_seconds)

        return value

    async def get_stats(self) -> dict:
        """Get cache statistics."""
        stats = {
            "backend": "redis" if self._connected else "memory",
            "connected": self._connected,
            "memory_keys": len(self._memory_cache),
        }
        if self._redis and self._connected:
            try:
                info = await self._redis.info("keyspace")
                stats["redis_keys"] = info
            except Exception:
                pass
        return stats


# Global instance
redis_cache = RedisCache()


# === Convenience decorators ===

def cached(ttl_seconds: int = 300, key_prefix: str = ""):
    """Decorator to cache async function results."""
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key
            key_parts = [key_prefix or func.__name__]
            key_parts.extend(str(a) for a in args)
            key_parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
            cache_key = ":".join(key_parts)

            # Try cache
            cached_value = await redis_cache.get(cache_key)
            if cached_value is not None:
                return cached_value

            # Call function
            result = await func(*args, **kwargs)

            # Cache result
            if result is not None:
                await redis_cache.set(cache_key, result, ttl_seconds)

            return result

        return wrapper
    return decorator
