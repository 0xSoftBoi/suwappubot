"""Per-user asyncio message queue for ordered WhatsApp message processing.

WhatsApp can deliver multiple messages in rapid bursts.  Processing them
concurrently leads to race conditions on conversation state.  This module
gives each user their own ``asyncio.Queue`` with a dedicated background
consumer task that processes messages strictly in order.
"""

import asyncio
import logging
import time
from typing import Awaitable, Callable, Dict, Optional

from bot.services.whatsapp_service import WhatsAppMessage

logger = logging.getLogger(__name__)

# Limits
MAX_QUEUE_DEPTH = 20
IDLE_CLEANUP_SECONDS = 300  # 5 minutes


class _UserQueue:
    """Wrapper around an asyncio.Queue plus its consumer task."""

    __slots__ = ("queue", "task", "last_activity")

    def __init__(self) -> None:
        self.queue: asyncio.Queue[WhatsAppMessage] = asyncio.Queue(maxsize=MAX_QUEUE_DEPTH)
        self.task: Optional[asyncio.Task] = None
        self.last_activity: float = time.monotonic()


class WhatsAppMessageQueue:
    """Per-user asyncio.Queue for ordered message processing.

    Usage::

        queue = WhatsAppMessageQueue(handler=whatsapp_router.route)
        await queue.start()

        # In webhook handler:
        await queue.enqueue(message)   # returns immediately

        # On shutdown:
        await queue.stop()
    """

    def __init__(
        self,
        handler: Callable[[WhatsAppMessage], Awaitable[None]],
    ) -> None:
        self._handler = handler
        self._queues: Dict[str, _UserQueue] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        self._running = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the background cleanup task."""
        if self._running:
            return
        self._running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("WhatsApp message queue started")

    async def stop(self) -> None:
        """Drain all queues and cancel background tasks."""
        self._running = False

        # Cancel cleanup
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

        # Cancel all consumer tasks
        async with self._lock:
            for user_id, uq in list(self._queues.items()):
                if uq.task and not uq.task.done():
                    uq.task.cancel()
                    try:
                        await uq.task
                    except asyncio.CancelledError:
                        pass
            self._queues.clear()

        logger.info("WhatsApp message queue stopped")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def enqueue(self, message: WhatsAppMessage) -> bool:
        """Add a message to the user's queue. Returns immediately.

        Returns ``True`` if enqueued, ``False`` if the queue is full.
        """
        user_id = message.from_number
        uq = await self._get_or_create(user_id)

        try:
            uq.queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning(
                f"Queue full for {user_id} (depth={MAX_QUEUE_DEPTH}), dropping message"
            )
            return False

        uq.last_activity = time.monotonic()
        return True

    @property
    def active_users(self) -> int:
        """Number of users with an active queue."""
        return len(self._queues)

    def queue_depth(self, user_id: str) -> int:
        """Current pending messages for a user (0 if no queue)."""
        uq = self._queues.get(user_id)
        return uq.queue.qsize() if uq else 0

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _get_or_create(self, user_id: str) -> _UserQueue:
        """Return the existing queue or create a new one with a consumer."""
        uq = self._queues.get(user_id)
        if uq is not None:
            # Re-start consumer if it crashed
            if uq.task is None or uq.task.done():
                uq.task = asyncio.create_task(self._consumer(user_id))
            return uq

        async with self._lock:
            # Double-check under lock
            uq = self._queues.get(user_id)
            if uq is not None:
                return uq

            uq = _UserQueue()
            uq.task = asyncio.create_task(self._consumer(user_id))
            self._queues[user_id] = uq
            logger.debug(f"Created queue for {user_id}")
            return uq

    async def _consumer(self, user_id: str) -> None:
        """Process messages from a user's queue sequentially."""
        uq = self._queues.get(user_id)
        if uq is None:
            return

        while self._running:
            try:
                message = await asyncio.wait_for(uq.queue.get(), timeout=IDLE_CLEANUP_SECONDS)
            except asyncio.TimeoutError:
                # No messages for IDLE_CLEANUP_SECONDS — exit and let cleanup remove us
                break
            except asyncio.CancelledError:
                break

            try:
                await self._handler(message)
            except Exception:
                logger.exception(f"Error processing message for {user_id}")
            finally:
                uq.queue.task_done()
                uq.last_activity = time.monotonic()

    async def _cleanup_loop(self) -> None:
        """Periodically remove idle user queues."""
        while self._running:
            try:
                await asyncio.sleep(IDLE_CLEANUP_SECONDS)
            except asyncio.CancelledError:
                break

            now = time.monotonic()
            to_remove: list[str] = []

            async with self._lock:
                for user_id, uq in self._queues.items():
                    idle = now - uq.last_activity
                    if idle >= IDLE_CLEANUP_SECONDS and uq.queue.empty():
                        to_remove.append(user_id)

                for user_id in to_remove:
                    uq = self._queues.pop(user_id, None)
                    if uq and uq.task and not uq.task.done():
                        uq.task.cancel()

            if to_remove:
                logger.debug(f"Cleaned up {len(to_remove)} idle queue(s): {to_remove}")
