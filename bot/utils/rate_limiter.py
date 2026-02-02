"""Rate limiting utilities for API calls and user requests.

Supports Redis-backed distributed rate limiting (for multi-instance deployments)
with automatic fallback to in-memory limiting when Redis is unavailable.
"""

import asyncio
import time
import logging
from typing import Dict, Optional, Hashable
from functools import wraps
from collections import defaultdict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Redis client (lazy-initialized)
_redis_client = None
_redis_available = False


async def _get_redis():
    """Get or initialize Redis client for rate limiting."""
    global _redis_client, _redis_available
    if _redis_client is not None:
        return _redis_client if _redis_available else None

    try:
        from bot.config.settings import settings
        if not settings.redis_url:
            _redis_available = False
            _redis_client = False  # sentinel: tried but no URL
            return None

        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
        )
        # Test connection
        await _redis_client.ping()
        _redis_available = True
        logger.info("Rate limiter using Redis backend")
        return _redis_client
    except Exception as e:
        logger.info(f"Rate limiter falling back to in-memory (Redis unavailable: {e})")
        _redis_available = False
        _redis_client = False  # sentinel
        return None


class RateLimitExceeded(Exception):
    """Raised when rate limit is exceeded."""
    def __init__(self, message: str, retry_after: float = 0):
        super().__init__(message)
        self.retry_after = retry_after


class TokenBucket:
    """Token bucket rate limiter."""

    def __init__(self, rate: float, capacity: float):
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self, tokens: float = 1.0) -> bool:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            self.last_update = now
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)

            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False

    async def wait_and_acquire(self, tokens: float = 1.0) -> float:
        start = time.monotonic()
        while True:
            if await self.acquire(tokens):
                return time.monotonic() - start
            async with self._lock:
                tokens_needed = tokens - self.tokens
                wait_time = tokens_needed / self.rate
            await asyncio.sleep(min(wait_time, 1.0))


class APIRateLimiter:
    """Rate limiter for external API calls."""

    def __init__(self):
        self._limiters: Dict[str, TokenBucket] = {}
        self._default_limits = {
            "lifi": (5, 10),
            "jupiter": (10, 20),
            "coingecko": (1, 5),
            "rpc": (20, 50),
            "goplus": (5, 10),
            "dexscreener": (5, 10),
        }

    def get_limiter(self, api_name: str) -> TokenBucket:
        if api_name not in self._limiters:
            rate, capacity = self._default_limits.get(api_name, (10, 20))
            self._limiters[api_name] = TokenBucket(rate, capacity)
        return self._limiters[api_name]

    async def acquire(self, api_name: str) -> bool:
        limiter = self.get_limiter(api_name)
        return await limiter.acquire()

    async def wait_and_acquire(self, api_name: str) -> float:
        limiter = self.get_limiter(api_name)
        return await limiter.wait_and_acquire()


class UserRateLimiter:
    """Per-user rate limiter with Redis support for distributed deployments.

    Uses Redis sliding window when available, falls back to in-memory.
    """

    def __init__(
        self,
        max_requests: int = 30,
        window_seconds: int = 60,
        key_prefix: str = "rl",
    ):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.key_prefix = key_prefix
        # In-memory fallback
        self._user_requests: Dict[Hashable, list] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def check(self, user_id: Hashable) -> bool:
        """Check if user is within rate limit. Raises RateLimitExceeded if not."""
        redis = await _get_redis()
        if redis:
            return await self._check_redis(redis, user_id)
        return await self._check_memory(user_id)

    async def _check_redis(self, redis, user_id: Hashable) -> bool:
        """Sliding window rate limit check using Redis sorted set."""
        key = f"{self.key_prefix}:{user_id}"
        now = time.time()
        cutoff = now - self.window_seconds

        pipe = redis.pipeline()
        # Remove expired entries
        pipe.zremrangebyscore(key, 0, cutoff)
        # Count current entries
        pipe.zcard(key)
        # Add current request
        pipe.zadd(key, {str(now): now})
        # Set expiry on the key
        pipe.expire(key, self.window_seconds + 1)
        results = await pipe.execute()

        current_count = results[1]
        if current_count >= self.max_requests:
            # Get oldest entry to calculate retry_after
            oldest = await redis.zrange(key, 0, 0, withscores=True)
            retry_after = (oldest[0][1] + self.window_seconds - now) if oldest else self.window_seconds
            # Remove the entry we just added since we're rejecting
            await redis.zrem(key, str(now))
            raise RateLimitExceeded(
                f"Too many requests. Please wait {retry_after:.0f} seconds.",
                retry_after=retry_after,
            )
        return True

    async def _check_memory(self, user_id: Hashable) -> bool:
        """In-memory sliding window fallback."""
        async with self._lock:
            now = datetime.utcnow()
            cutoff = now - timedelta(seconds=self.window_seconds)

            self._user_requests[user_id] = [
                ts for ts in self._user_requests[user_id]
                if ts > cutoff
            ]

            if len(self._user_requests[user_id]) >= self.max_requests:
                oldest = min(self._user_requests[user_id])
                retry_after = (oldest + timedelta(seconds=self.window_seconds) - now).total_seconds()
                raise RateLimitExceeded(
                    f"Too many requests. Please wait {retry_after:.0f} seconds.",
                    retry_after=retry_after,
                )

            self._user_requests[user_id].append(now)
            return True

    def get_remaining(self, user_id: Hashable) -> int:
        """Get remaining requests for user (in-memory only, best-effort)."""
        now = datetime.utcnow()
        cutoff = now - timedelta(seconds=self.window_seconds)
        recent = [
            ts for ts in self._user_requests.get(user_id, [])
            if ts > cutoff
        ]
        return max(0, self.max_requests - len(recent))

    async def cleanup_stale(self) -> int:
        """Remove entries for users with no recent requests (in-memory only)."""
        async with self._lock:
            now = datetime.utcnow()
            cutoff = now - timedelta(seconds=self.window_seconds)
            stale_keys = [
                uid for uid, timestamps in self._user_requests.items()
                if not any(ts > cutoff for ts in timestamps)
            ]
            for uid in stale_keys:
                del self._user_requests[uid]
            return len(stale_keys)

    async def start_cleanup_loop(self, interval_seconds: int = 300) -> None:
        """Start a background task that periodically purges stale entries."""
        self._cleanup_task = asyncio.ensure_future(self._cleanup_loop(interval_seconds))

    async def _cleanup_loop(self, interval: int) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                removed = await self.cleanup_stale()
                if removed > 0:
                    logger.debug(f"Rate limiter cleanup: removed {removed} stale user entries")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Rate limiter cleanup error: {e}")

    async def stop_cleanup_loop(self) -> None:
        """Cancel the background cleanup task."""
        task = getattr(self, "_cleanup_task", None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


# Global instances
api_limiter = APIRateLimiter()
user_limiter = UserRateLimiter()


# Decorators
def rate_limit_api(api_name: str):
    """Decorator to rate limit API calls."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            waited = await api_limiter.wait_and_acquire(api_name)
            if waited > 0.1:
                logger.debug(f"Rate limited {api_name}: waited {waited:.2f}s")
            return await func(*args, **kwargs)
        return wrapper
    return decorator


def rate_limit_user(max_requests: int = 30, window_seconds: int = 60):
    """Decorator to rate limit user commands."""
    limiter = UserRateLimiter(max_requests, window_seconds)

    def decorator(func):
        @wraps(func)
        async def wrapper(update, context, *args, **kwargs):
            user_id = update.effective_user.id
            try:
                await limiter.check(user_id)
                return await func(update, context, *args, **kwargs)
            except RateLimitExceeded as e:
                await update.message.reply_text(
                    f"⏳ {e}\n\nRemaining: {limiter.get_remaining(user_id)} requests"
                )
                return None
        return wrapper
    return decorator


# Specific limiters for commands
swap_limiter = UserRateLimiter(max_requests=10, window_seconds=60, key_prefix="rl:swap")
wallet_limiter = UserRateLimiter(max_requests=20, window_seconds=60, key_prefix="rl:wallet")
alert_limiter = UserRateLimiter(max_requests=30, window_seconds=60, key_prefix="rl:alert")
admin_limiter = UserRateLimiter(max_requests=5, window_seconds=60, key_prefix="rl:admin")


async def enforce_rate_limit_for_update(
    update,
    limiter: UserRateLimiter,
    key: Optional[Hashable] = None,
) -> bool:
    """
    Enforce rate limiting for a Telegram `Update`.
    Returns True if allowed, False if blocked (and user was notified).
    """
    user = getattr(update, "effective_user", None)
    if key is None:
        key = user.id if user else None
    if key is None:
        return True

    try:
        await limiter.check(key)
        return True
    except RateLimitExceeded as e:
        msg = getattr(update, "message", None) or getattr(getattr(update, "callback_query", None), "message", None)
        if msg:
            await msg.reply_text(f"⏳ {e}")
        return False
