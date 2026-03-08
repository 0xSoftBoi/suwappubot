"""Tests for caching utilities."""

import pytest
import asyncio
from datetime import datetime

from bot.utils.cache import AsyncCache, price_cache


class TestCache:
    """Tests for in-memory cache."""
    
    @pytest.mark.asyncio
    async def test_set_and_get(self):
        """Test setting and getting cache values."""
        cache = AsyncCache(default_ttl=60)
        
        await cache.set("key1", "value1")
        result = await cache.get("key1")
        
        assert result == "value1"
    
    @pytest.mark.asyncio
    async def test_get_nonexistent_key(self):
        """Test getting nonexistent key returns None."""
        cache = AsyncCache(default_ttl=60)
        
        result = await cache.get("nonexistent")
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_cache_expiry(self):
        """Test cache entries expire."""
        cache = AsyncCache(default_ttl=0.1)  # 100ms TTL
        
        await cache.set("key1", "value1")
        
        # Should exist immediately
        assert await cache.get("key1") == "value1"
        
        # Wait for expiry
        await asyncio.sleep(0.15)
        
        # Should be expired
        assert await cache.get("key1") is None
    
    @pytest.mark.asyncio
    async def test_custom_ttl(self):
        """Test custom TTL per key."""
        cache = AsyncCache(default_ttl=60)
        
        await cache.set("key1", "value1", ttl=0.1)
        
        # Wait for expiry
        await asyncio.sleep(0.15)
        
        # Should be expired
        assert await cache.get("key1") is None
    
    @pytest.mark.asyncio
    async def test_delete(self):
        """Test deleting cache entries."""
        cache = AsyncCache(default_ttl=60)
        
        await cache.set("key1", "value1")
        await cache.delete("key1")
        
        assert await cache.get("key1") is None
    
    @pytest.mark.asyncio
    async def test_clear(self):
        """Test clearing all cache entries."""
        cache = AsyncCache(default_ttl=60)
        
        await cache.set("key1", "value1")
        await cache.set("key2", "value2")
        await cache.clear()
        
        assert await cache.get("key1") is None
        assert await cache.get("key2") is None
    
    @pytest.mark.asyncio
    async def test_get_with_default(self):
        """Test get with default value."""
        cache = AsyncCache(default_ttl=60)
        
        # AsyncCache doesn't support default parameter, so we use Python's or operator
        result = await cache.get("nonexistent") or "default_value"
        
        assert result == "default_value"
    
    @pytest.mark.asyncio
    async def test_complex_values(self):
        """Test caching complex values."""
        cache = AsyncCache(default_ttl=60)
        
        data = {
            "price": 100.5,
            "timestamp": datetime.utcnow().isoformat(),
            "tokens": ["ETH", "USDC"],
        }
        
        await cache.set("complex", data)
        result = await cache.get("complex")
        
        assert result == data
        assert result["price"] == 100.5

