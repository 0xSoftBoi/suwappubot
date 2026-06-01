"""Regression tests for UserRateLimiter TTL-based cleanup.

Covers the confirmed vulnerability:
  - _user_requests entries were never evicted, so a reused user_id inherited
    stale rate-limit history across sessions, and the dict grew unbounded
    (memory leak).

The fix evicts users with no activity within cleanup_ttl_seconds, while
preserving the rate-limit decision for any active user (TTL >> window).
"""

import asyncio
import os
from datetime import datetime, timezone, timedelta

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.utils.rate_limiter import UserRateLimiter, RateLimitExceeded


def test_stale_user_is_evicted():
    async def scenario():
        # Tiny TTL + interval so the sweep is eligible immediately.
        limiter = UserRateLimiter(
            max_requests=5,
            window_seconds=1,
            cleanup_ttl_seconds=1,
            cleanup_interval_seconds=0,
        )
        # Inject an old request for a "previous session" user, past the TTL.
        old_ts = datetime.now(timezone.utc) - timedelta(seconds=3600)
        limiter._user_requests[111] = [old_ts]

        # A fresh request from any user triggers the sweep.
        await limiter.check(222)
        return limiter

    limiter = asyncio.run(scenario())
    assert 111 not in limiter._user_requests, "stale user_id should be evicted"
    assert 222 in limiter._user_requests


def test_active_user_still_rate_limited():
    async def scenario():
        # TTL far larger than window: cleanup must not affect active decisions.
        limiter = UserRateLimiter(
            max_requests=3,
            window_seconds=60,
            cleanup_ttl_seconds=86400,
            cleanup_interval_seconds=0,
        )
        for _ in range(3):
            await limiter.check(42)
        # 4th request within the window must be blocked.
        with pytest.raises(RateLimitExceeded):
            await limiter.check(42)
        return limiter

    limiter = asyncio.run(scenario())
    # The active user's history is preserved (not swept).
    assert 42 in limiter._user_requests
    assert len(limiter._user_requests[42]) == 3


def test_ttl_floored_to_window():
    async def scenario():
        # A misconfigured TTL below the window is clamped up to the window so a
        # sweep can never evict history that still matters.
        return UserRateLimiter(window_seconds=60, cleanup_ttl_seconds=5)

    limiter = asyncio.run(scenario())
    assert limiter.cleanup_ttl_seconds == 60


def test_calling_user_within_window_unaffected_by_sweep():
    async def scenario():
        # Even if the caller's entry is momentarily empty and the sweep runs,
        # the defaultdict re-creates it and the request is counted.
        limiter = UserRateLimiter(
            max_requests=2,
            window_seconds=60,
            cleanup_ttl_seconds=60,
            cleanup_interval_seconds=0,
        )
        await limiter.check(7)
        return limiter

    limiter = asyncio.run(scenario())
    assert limiter.get_remaining(7) == 1
