"""Redis caching service with fallback to memory cache."""

import logging
import json
import asyncio
from typing import Any, Optional
from datetime import timedelta

try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

from bot.config.settings import settings

logger = logging.getLogger(__name__)


class RedisCache:
    """
    Redis cache with automatic fallback to in-memory cache.
    
    Features:
    - Async Redis operations
    - Automatic fallback to memory if Redis unavailable
    - TTL support
    - JSON serialization
    """
    
    def __init__(self):
        self._redis: Optional[redis.Redis] = None
        self._memory_cache: dict = {}
        self._memory_ttl: dict = {}
        self._connected = False
    
    async def connect(self) -> bool:
        """Connect to Redis server."""
        if not REDIS_AVAILABLE:
            logger.warning("Redis package not installed, using memory cache")
            return False
        
        redis_url = getattr(settings, 'redis_url', None)
        if not redis_url:
            logger.info("No REDIS_URL configured, using memory cache")
            return False
        
        try:
            self._redis = redis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await self._redis.ping()
            self._connected = True
            logger.info("Connected to Redis")
            return True
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}, using memory cache")
            self._connected = False
            return False
    
    async def close(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._connected = False
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        if self._connected and self._redis:
            try:
                value = await self._redis.get(key)
                if value:
                    return json.loads(value)
            except Exception as e:
                logger.error(f"Redis GET error: {e}")
        
        # Fallback to memory
        return self._memory_get(key)
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: int = 300,
    ) -> bool:
        """Set value in cache with TTL."""
        if self._connected and self._redis:
            try:
                await self._redis.set(
                    key,
                    json.dumps(value),
                    ex=ttl_seconds,
                )
                return True
            except Exception as e:
                logger.error(f"Redis SET error: {e}")
        
        # Fallback to memory
        return self._memory_set(key, value, ttl_seconds)
    
    async def delete(self, key: str) -> bool:
        """Delete key from cache."""
        if self._connected and self._redis:
            try:
                await self._redis.delete(key)
            except Exception as e:
                logger.error(f"Redis DELETE error: {e}")
        
        # Also delete from memory
        self._memory_cache.pop(key, None)
        self._memory_ttl.pop(key, None)
        return True
    
    async def clear_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern."""
        count = 0
        
        if self._connected and self._redis:
            try:
                cursor = 0
                while True:
                    cursor, keys = await self._redis.scan(cursor, match=pattern)
                    if keys:
                        await self._redis.delete(*keys)
                        count += len(keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.error(f"Redis SCAN error: {e}")
        
        # Also clear from memory
        keys_to_delete = [k for k in self._memory_cache if self._match_pattern(k, pattern)]
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
        
        # Call factory
        if asyncio.iscoroutinefunction(factory):
            value = await factory()
        else:
            value = factory()
        
        if value is not None:
            await self.set(key, value, ttl_seconds)
        
        return value
    
    # === Memory Cache Helpers ===
    
    def _memory_get(self, key: str) -> Optional[Any]:
        """Get from memory cache with TTL check."""
        import time
        
        if key not in self._memory_cache:
            return None
        
        ttl = self._memory_ttl.get(key, 0)
        if ttl and time.time() > ttl:
            # Expired
            self._memory_cache.pop(key, None)
            self._memory_ttl.pop(key, None)
            return None
        
        return self._memory_cache[key]
    
    def _memory_set(self, key: str, value: Any, ttl_seconds: int) -> bool:
        """Set in memory cache with TTL."""
        import time
        
        self._memory_cache[key] = value
        self._memory_ttl[key] = time.time() + ttl_seconds
        return True
    
    def _match_pattern(self, key: str, pattern: str) -> bool:
        """Simple glob pattern matching for memory cache."""
        import fnmatch
        return fnmatch.fnmatch(key, pattern)
    
    # === Stats ===
    
    async def get_stats(self) -> dict:
        """Get cache statistics."""
        stats = {
            "backend": "redis" if self._connected else "memory",
            "connected": self._connected,
        }
        
        if self._connected and self._redis:
            try:
                info = await self._redis.info()
                stats.update({
                    "used_memory": info.get("used_memory_human"),
                    "keys": info.get("db0", {}).get("keys", 0),
                    "hits": info.get("keyspace_hits", 0),
                    "misses": info.get("keyspace_misses", 0),
                })
            except:
                pass
        else:
            stats["memory_keys"] = len(self._memory_cache)
        
        return stats


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

