"""Per-user serializing update processor for python-telegram-bot.

Allows high overall concurrency while guaranteeing that updates from the
same user (or chat) are processed strictly in order.
"""

import asyncio
from collections import defaultdict
from typing import Awaitable

from telegram import Update
from telegram.ext import BaseUpdateProcessor

# Safety bound on the lock map size to keep memory in check.
_MAX_LOCKS = 50_000


class PerUserSerializingProcessor(BaseUpdateProcessor):
    """Process updates concurrently, but serialize per user/chat."""

    def __init__(self, max_concurrent_updates: int):
        super().__init__(max_concurrent_updates)
        self._locks: defaultdict = defaultdict(asyncio.Lock)

    async def do_process_update(self, update: object, coroutine: Awaitable[None]) -> None:
        key = None
        if isinstance(update, Update):
            if update.effective_user is not None:
                key = ("user", update.effective_user.id)
            elif update.effective_chat is not None:
                key = ("chat", update.effective_chat.id)

        if key is None:
            await coroutine
            return

        if len(self._locks) > _MAX_LOCKS:
            # Drop locks that nobody currently holds to bound memory usage.
            for k in [k for k, lock in self._locks.items() if not lock.locked()]:
                del self._locks[k]

        async with self._locks[key]:
            await coroutine

    async def initialize(self) -> None:  # pragma: no cover - trivial
        pass

    async def shutdown(self) -> None:  # pragma: no cover - trivial
        self._locks.clear()
