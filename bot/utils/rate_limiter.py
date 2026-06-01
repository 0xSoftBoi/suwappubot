"""Rate limiting utilities for API calls and user requests."""

import asyncio
import time
import logging
from typing import Dict, Optional, Hashable
from functools import wraps
from collections import defaultdict
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


class RateLimitExceeded(Exception):
    """Raised when rate limit is exceeded."""
    def __init__(self, message: str, retry_after: float = 0):
        super().__init__(message)
        self.retry_after = retry_after


class TokenBucket:
    """Token bucket rate limiter."""
    
    def __init__(self, rate: float, capacity: float):
        """
        Initialize token bucket.
        
        Args:
            rate: Tokens per second to add
            capacity: Maximum tokens in bucket
        """
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self, tokens: float = 1.0) -> bool:
        """
        Try to acquire tokens.
        
        Args:
            tokens: Number of tokens to acquire
            
        Returns:
            True if tokens acquired, False if rate limited
        """
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            self.last_update = now
            
            # Add tokens based on time elapsed
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            
            return False
    
    async def wait_and_acquire(self, tokens: float = 1.0) -> float:
        """
        Wait until tokens are available and acquire them.
        
        Returns:
            Time waited in seconds
        """
        start = time.monotonic()
        
        while True:
            if await self.acquire(tokens):
                return time.monotonic() - start
            
            # Wait for tokens to refill
            async with self._lock:
                tokens_needed = tokens - self.tokens
                wait_time = tokens_needed / self.rate
            
            await asyncio.sleep(min(wait_time, 1.0))


class APIRateLimiter:
    """Rate limiter for external API calls."""
    
    def __init__(self):
        self._limiters: Dict[str, TokenBucket] = {}
        
        # Default limits for known APIs
        self._default_limits = {
            "lifi": (5, 10),      # 5 req/sec, burst 10
            "jupiter": (10, 20),  # 10 req/sec, burst 20
            "coingecko": (1, 5),  # 1 req/sec, burst 5 (free tier)
            "sunswap": (10, 20),  # 10 req/sec, burst 20 (shares TronGrid)
            "okx_dex": (5, 10),   # 5 req/sec, burst 10
            "rpc": (20, 50),      # 20 req/sec per RPC
        }
    
    def get_limiter(self, api_name: str) -> TokenBucket:
        """Get or create limiter for an API."""
        if api_name not in self._limiters:
            rate, capacity = self._default_limits.get(api_name, (10, 20))
            self._limiters[api_name] = TokenBucket(rate, capacity)
        return self._limiters[api_name]
    
    async def acquire(self, api_name: str) -> bool:
        """Try to acquire a slot for API call."""
        limiter = self.get_limiter(api_name)
        return await limiter.acquire()
    
    async def wait_and_acquire(self, api_name: str) -> float:
        """Wait and acquire a slot for API call."""
        limiter = self.get_limiter(api_name)
        return await limiter.wait_and_acquire()


class UserRateLimiter:
    """Per-user rate limiter for bot commands."""
    
    def __init__(
        self,
        max_requests: int = 30,
        window_seconds: int = 60,
        cleanup_ttl_seconds: int = 86400,
        cleanup_interval_seconds: int = 3600,
    ):
        """
        Initialize user rate limiter.

        Args:
            max_requests: Maximum requests per window
            window_seconds: Window duration in seconds
            cleanup_ttl_seconds: Drop a user's history after this many seconds
                of inactivity. Defaults to 24h. Must be >= window_seconds so
                cleanup never affects an active rate-limit decision.
            cleanup_interval_seconds: Minimum seconds between full sweeps of
                the request map (cheap throttle so we don't scan every call).
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # TTL must always exceed the active window; otherwise a sweep could
        # evict history that still matters for an in-progress decision.
        self.cleanup_ttl_seconds = max(cleanup_ttl_seconds, window_seconds)
        self.cleanup_interval_seconds = cleanup_interval_seconds
        # Key can be Telegram ID (int), WhatsApp number (str), etc.
        self._user_requests: Dict[Hashable, list] = defaultdict(list)
        self._lock = asyncio.Lock()
        # Monotonic timestamp of the last full sweep (separate clock from the
        # tz-aware datetimes stored per request).
        self._last_cleanup = time.monotonic()

    def _cleanup_locked(self, now: datetime) -> None:
        """
        Evict users with no activity within cleanup_ttl_seconds.

        Must be called while holding self._lock. Throttled by
        cleanup_interval_seconds so it does not run on every request. Because
        cleanup_ttl_seconds >= window_seconds, evicting a stale user never
        changes the rate-limit decision for any active user; the defaultdict
        re-creates an entry on the next access for the calling user.
        """
        monotonic_now = time.monotonic()
        if monotonic_now - self._last_cleanup < self.cleanup_interval_seconds:
            return
        self._last_cleanup = monotonic_now

        ttl_cutoff = now - timedelta(seconds=self.cleanup_ttl_seconds)
        stale = [
            uid for uid, ts_list in self._user_requests.items()
            if not ts_list or max(ts_list) <= ttl_cutoff
        ]
        for uid in stale:
            del self._user_requests[uid]

    async def check(self, user_id: Hashable) -> bool:
        """
        Check if user is within rate limit.
        
        Args:
            user_id: Telegram user ID
            
        Returns:
            True if within limit, raises RateLimitExceeded otherwise
        """
        async with self._lock:
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(seconds=self.window_seconds)

            # Evict inactive users (TTL >> window, so this can never alter an
            # active decision). Runs before the per-user logic; the defaultdict
            # re-creates this user's entry below if it was swept.
            self._cleanup_locked(now)

            # Clean old requests
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
        """Get remaining requests for user."""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=self.window_seconds)
        
        recent = [
            ts for ts in self._user_requests.get(user_id, [])
            if ts > cutoff
        ]
        
        return max(0, self.max_requests - len(recent))


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
swap_limiter = UserRateLimiter(max_requests=10, window_seconds=60)  # 10 swaps/min
wallet_limiter = UserRateLimiter(max_requests=20, window_seconds=60)  # 20 wallet ops/min
alert_limiter = UserRateLimiter(max_requests=30, window_seconds=60)  # 30 alert ops/min


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

