"""Simplified in-memory caching service."""

import logging
import time
import asyncio
import fnmatch
from typing import Any, Optional

logger = logging.getLogger(__name__)

class RedisCache:
    """
    In-memory cache service.
    Replaced Redis version to support free-tier deployments.
    """
    
    def __init__(self):
        self._memory_cache: dict = {}
        self._memory_ttl: dict = {}
        self._connected = False  # Always False for in-memory only
    
    async def connect(self) -> bool:
        """Simulate connection to memory cache."""
        logger.info("Using in-memory cache (Redis disabled)")
        return False
    
    async def close(self):
        """No-op for memory cache."""
        pass
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from memory cache."""
        if key not in self._memory_cache:
            return None
        
        ttl = self._memory_ttl.get(key, 0)
        if ttl and time.time() > ttl:
            # Expired
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
        """Set value in memory cache with TTL."""
        self._memory_cache[key] = value
        self._memory_ttl[key] = time.time() + ttl_seconds
        return True
    
    async def delete(self, key: str) -> bool:
        """Delete key from memory cache."""
        self._memory_cache.pop(key, None)
        self._memory_ttl.pop(key, None)
        return True
    
    async def clear_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern."""
        count = 0
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
        
        # Call factory
        if asyncio.iscoroutinefunction(factory):
            value = await factory()
        else:
            value = factory()
        
        if value is not None:
            await self.set(key, value, ttl_seconds)
        
        return value
    
    async def get_stats(self) -> dict:
        """Get cache statistics."""
        return {
            "backend": "memory",
            "connected": False,
            "memory_keys": len(self._memory_cache)
        }


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
