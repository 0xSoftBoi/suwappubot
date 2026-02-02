"""Distributed lock using Redis SET NX EX."""

import logging
from contextlib import asynccontextmanager
from typing import Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

# Lua script: release only if we still own the lock (compare token)
_RELEASE_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""

# Lua script: extend TTL only if we still own the lock
_EXTEND_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
else
    return 0
end
"""


class RedisLock:
    """Distributed lock backed by Redis SET NX EX.

    Usage::

        lock = RedisLock(redis_client, "fee_sweeper", ttl=300)
        if await lock.acquire():
            try:
                ...
            finally:
                await lock.release()

    Or as an async context manager::

        async with RedisLock(redis_client, "fee_sweeper", ttl=300)() as acquired:
            if acquired:
                ...
    """

    def __init__(self, redis_client, name: str, ttl: int = 60):
        self._redis = redis_client
        self._name = f"lock:{name}"
        self._ttl = ttl
        self._token: Optional[str] = None

    async def acquire(self) -> bool:
        """Try to acquire the lock. Returns True if acquired."""
        if self._redis is None:
            # No Redis — always succeed (single-instance mode)
            return True

        self._token = str(uuid4())
        try:
            result = await self._redis.set(
                self._name, self._token, nx=True, ex=self._ttl
            )
            return result is not None and result is not False
        except Exception as e:
            logger.debug(f"Lock acquire error for {self._name}: {e}")
            # If Redis is down, allow the operation (single-instance safety)
            return True

    async def release(self):
        """Release the lock (only if we still own it)."""
        if self._redis is None or self._token is None:
            return

        try:
            await self._redis.eval(_RELEASE_SCRIPT, 1, self._name, self._token)
        except Exception as e:
            logger.debug(f"Lock release error for {self._name}: {e}")

    async def extend(self, ttl: int = None):
        """Extend the lock TTL if we still own it."""
        if self._redis is None or self._token is None:
            return

        ttl_ms = (ttl or self._ttl) * 1000
        try:
            await self._redis.eval(
                _EXTEND_SCRIPT, 1, self._name, self._token, str(ttl_ms)
            )
        except Exception as e:
            logger.debug(f"Lock extend error for {self._name}: {e}")

    @asynccontextmanager
    async def __call__(self):
        """Async context manager that yields whether the lock was acquired."""
        acquired = await self.acquire()
        try:
            yield acquired
        finally:
            if acquired:
                await self.release()
