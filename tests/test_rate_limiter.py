"""Tests for rate limiter."""

import pytest
import asyncio
from datetime import datetime

from bot.utils.rate_limiter import (
    TokenBucket,
    APIRateLimiter,
    UserRateLimiter,
    RateLimitExceeded,
)


class TestTokenBucket:
    """Tests for token bucket rate limiter."""
    
    @pytest.mark.asyncio
    async def test_acquire_available_tokens(self):
        """Test acquiring tokens when available."""
        bucket = TokenBucket(rate=10, capacity=10)
        assert await bucket.acquire(1) is True
    
    @pytest.mark.asyncio
    async def test_acquire_depleted_bucket(self):
        """Test acquiring from depleted bucket."""
        bucket = TokenBucket(rate=1, capacity=2)
        
        # Deplete bucket
        assert await bucket.acquire(2) is True
        # Should fail immediately
        assert await bucket.acquire(1) is False
    
    @pytest.mark.asyncio
    async def test_token_refill(self):
        """Test token refill over time."""
        bucket = TokenBucket(rate=10, capacity=10)
        
        # Deplete bucket
        await bucket.acquire(10)
        
        # Wait for partial refill
        await asyncio.sleep(0.2)  # Should add ~2 tokens
        
        # Should be able to acquire some tokens
        assert await bucket.acquire(1) is True
    
    @pytest.mark.asyncio
    async def test_wait_and_acquire(self):
        """Test wait_and_acquire waits for tokens."""
        bucket = TokenBucket(rate=10, capacity=5)
        
        # Deplete bucket
        await bucket.acquire(5)
        
        # This should wait and then succeed
        start = asyncio.get_event_loop().time()
        wait_time = await bucket.wait_and_acquire(1)
        
        assert wait_time > 0
        assert wait_time < 1  # Should be quick with high refill rate


class TestAPIRateLimiter:
    """Tests for API rate limiter."""
    
    @pytest.mark.asyncio
    async def test_get_limiter_creates_new(self):
        """Test get_limiter creates new limiter for unknown API."""
        limiter = APIRateLimiter()
        
        # Should create limiter with default settings
        bucket = limiter.get_limiter("unknown_api")
        assert bucket is not None
    
    @pytest.mark.asyncio
    async def test_get_limiter_reuses_existing(self):
        """Test get_limiter reuses existing limiter."""
        limiter = APIRateLimiter()
        
        bucket1 = limiter.get_limiter("lifi")
        bucket2 = limiter.get_limiter("lifi")
        
        assert bucket1 is bucket2
    
    @pytest.mark.asyncio
    async def test_acquire_known_api(self):
        """Test acquiring for known API."""
        limiter = APIRateLimiter()
        
        # Li.Fi has 5 req/sec limit
        result = await limiter.acquire("lifi")
        assert result is True


class TestUserRateLimiter:
    """Tests for per-user rate limiter."""
    
    @pytest.mark.asyncio
    async def test_within_limit(self):
        """Test requests within limit pass."""
        limiter = UserRateLimiter(max_requests=10, window_seconds=60)
        
        for _ in range(10):
            result = await limiter.check(user_id=123)
            assert result is True
    
    @pytest.mark.asyncio
    async def test_exceeds_limit(self):
        """Test exceeding limit raises error."""
        limiter = UserRateLimiter(max_requests=5, window_seconds=60)
        
        # Use up the limit
        for _ in range(5):
            await limiter.check(user_id=123)
        
        # Next request should fail
        with pytest.raises(RateLimitExceeded):
            await limiter.check(user_id=123)
    
    @pytest.mark.asyncio
    async def test_different_users(self):
        """Test different users have separate limits."""
        limiter = UserRateLimiter(max_requests=5, window_seconds=60)
        
        # User 1 uses all their requests
        for _ in range(5):
            await limiter.check(user_id=1)
        
        # User 2 should still be able to make requests
        result = await limiter.check(user_id=2)
        assert result is True
    
    def test_get_remaining(self):
        """Test getting remaining requests."""
        limiter = UserRateLimiter(max_requests=10, window_seconds=60)
        
        # Initial
        assert limiter.get_remaining(user_id=123) == 10

