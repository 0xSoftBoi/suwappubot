"""Redis-backed caching service with in-memory fallback."""

import asyncio
import fnmatch
import json
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class RedisCache:
    """
    Redis-backed cache with automatic fallback to in-memory dict.
    When Redis is unavailable, all operations degrade gracefully to local memory.
    """

    def __init__(self):
        self._client = None  # redis.asyncio.Redis instance
        self._connected = False
        self._memory_cache: dict = {}
        self._memory_ttl: dict = {}
        self._url: Optional[str] = None

    async def connect(self, url: str = None) -> bool:
        """Connect to Redis. Falls back to in-memory if connection fails."""
        if not url:
            logger.info("No REDIS_URL provided — using in-memory cache")
            return False

        self._url = url
        try:
            import redis.asyncio as aioredis

            self._client = aioredis.from_url(
                url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
            )
            await self._client.ping()
            self._connected = True
            logger.info("Redis connected")
            return True
        except Exception as e:
            logger.warning(f"Redis connection failed ({e}) — using in-memory fallback")
            self._client = None
            self._connected = False
            return False

    async def close(self):
        """Close Redis connection."""
        if self._client:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None
            self._connected = False

    @property
    def client(self):
        """Expose the underlying redis client for distributed locks etc."""
        return self._client

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    async def get(self, key: str) -> Optional[Any]:
        """Get value from Redis, falling back to memory."""
        if self._connected and self._client:
            try:
                raw = await self._client.get(key)
                if raw is not None:
                    return self._deserialize(raw)
                return None
            except Exception as e:
                logger.debug(f"Redis GET error ({e}), trying memory fallback")
                await self._handle_disconnect()

        # Memory fallback
        return self._memory_get(key)

    async def set(self, key: str, value: Any, ttl_seconds: int = 300) -> bool:
        """Set value in Redis (and memory fallback)."""
        # Always write to memory as local L1 cache
        self._memory_set(key, value, ttl_seconds)

        if self._connected and self._client:
            try:
                raw = self._serialize(value)
                await self._client.set(key, raw, ex=ttl_seconds)
                return True
            except Exception as e:
                logger.debug(f"Redis SET error ({e})")
                await self._handle_disconnect()

        return True

    async def delete(self, key: str) -> bool:
        """Delete key from both Redis and memory."""
        self._memory_cache.pop(key, None)
        self._memory_ttl.pop(key, None)

        if self._connected and self._client:
            try:
                await self._client.delete(key)
                return True
            except Exception:
                pass
        return True

    async def clear_pattern(self, pattern: str) -> int:
        """Delete all keys matching a glob pattern."""
        count = 0

        if self._connected and self._client:
            try:
                cursor = 0
                while True:
                    cursor, keys = await self._client.scan(
                        cursor=cursor, match=pattern, count=100
                    )
                    if keys:
                        await self._client.delete(*keys)
                        count += len(keys)
                    if cursor == 0:
                        break
            except Exception:
                pass

        # Also clear from memory
        keys_to_delete = [
            k for k in self._memory_cache if fnmatch.fnmatch(k, pattern)
        ]
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
        if self._connected and self._client:
            try:
                info = await self._client.info("keyspace")
                stats["redis_info"] = info
            except Exception:
                pass
        return stats

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    @staticmethod
    def _serialize(value: Any) -> str:
        """Serialize a value to JSON string."""
        return json.dumps(value, default=str)

    @staticmethod
    def _deserialize(raw: str) -> Any:
        """Deserialize a JSON string."""
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw

    # ------------------------------------------------------------------
    # In-memory fallback helpers
    # ------------------------------------------------------------------

    def _memory_get(self, key: str) -> Optional[Any]:
        if key not in self._memory_cache:
            return None
        ttl = self._memory_ttl.get(key, 0)
        if ttl and time.time() > ttl:
            self._memory_cache.pop(key, None)
            self._memory_ttl.pop(key, None)
            return None
        return self._memory_cache[key]

    def _memory_set(self, key: str, value: Any, ttl_seconds: int) -> None:
        self._memory_cache[key] = value
        self._memory_ttl[key] = time.time() + ttl_seconds

    # ------------------------------------------------------------------
    # Reconnection
    # ------------------------------------------------------------------

    async def _handle_disconnect(self):
        """Mark as disconnected and schedule a background reconnect."""
        if not self._connected:
            return
        self._connected = False
        logger.warning("Redis disconnected — falling back to in-memory cache")
        asyncio.create_task(self._reconnect_loop())

    async def _reconnect_loop(self):
        """Try to reconnect to Redis with exponential backoff."""
        delay = 5
        for _ in range(10):
            await asyncio.sleep(delay)
            try:
                if self._client:
                    await self._client.ping()
                    self._connected = True
                    logger.info("Redis reconnected")
                    return
            except Exception:
                pass
            delay = min(delay * 2, 60)
        logger.error("Redis reconnection failed after multiple attempts")


# Global instance
redis_cache = RedisCache()


# === Convenience decorators ===

def cached(ttl_seconds: int = 300, key_prefix: str = ""):
    """Decorator to cache async function results."""
    def decorator(func):
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
