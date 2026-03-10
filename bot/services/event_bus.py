"""Cross-service event bus using Redis pub/sub.

Enables real-time communication between Python bot and TypeScript API.
Both services publish events to the same Redis channel and subscribe
to events they care about.

Events are JSON envelopes:
{
    "event": { "type": "swap.completed", "data": { ... } },
    "source": "bot",
    "timestamp": "2026-03-09T12:00:00Z",
    "id": "bot-1710000000000-1"
}
"""

import asyncio
import json
import logging
import os
import time
from typing import Any, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)

CHANNEL = "suwappu:events"

# Type alias for event handlers
EventHandler = Callable[[dict], Coroutine[Any, Any, None]]


class EventBus:
    """Redis pub/sub event bus for cross-service communication."""

    def __init__(self):
        self._publisher = None
        self._subscriber = None
        self._handlers: dict[str, list[EventHandler]] = {}
        self._connected = False
        self._counter = 0
        self._listen_task: Optional[asyncio.Task] = None

    async def connect(self) -> bool:
        """Connect to Redis for pub/sub."""
        redis_url = os.getenv("REDIS_URL")
        if not redis_url:
            logger.info("[EventBus] REDIS_URL not configured, events disabled")
            return False

        try:
            import redis.asyncio as aioredis

            # Publisher connection
            self._publisher = aioredis.from_url(
                redis_url,
                decode_responses=True,
                retry_on_timeout=True,
            )
            await self._publisher.ping()

            # Subscriber connection (separate for pub/sub)
            self._subscriber = aioredis.from_url(
                redis_url,
                decode_responses=True,
                retry_on_timeout=True,
            )

            self._connected = True
            logger.info("[EventBus] Connected to Redis pub/sub")

            # Start listener
            self._listen_task = asyncio.create_task(self._listen())

            return True

        except ImportError:
            logger.warning(
                "[EventBus] redis package not installed. "
                "Install with: pip install redis[hiredis]"
            )
            return False
        except Exception as e:
            logger.warning(f"[EventBus] Failed to connect: {e}")
            return False

    async def close(self):
        """Disconnect from Redis."""
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass

        if self._publisher:
            await self._publisher.aclose()
        if self._subscriber:
            await self._subscriber.aclose()

        self._connected = False
        logger.info("[EventBus] Disconnected")

    async def publish(self, event_type: str, data: dict) -> bool:
        """Publish an event to all listeners.

        Args:
            event_type: Event type (e.g., 'swap.completed', 'wallet.created')
            data: Event payload dict

        Returns:
            True if published, False if not connected
        """
        if not self._connected or not self._publisher:
            return False

        try:
            self._counter += 1
            envelope = {
                "event": {"type": event_type, "data": data},
                "source": "bot",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "id": f"bot-{int(time.time() * 1000)}-{self._counter}",
            }
            await self._publisher.publish(CHANNEL, json.dumps(envelope))
            return True

        except Exception as e:
            logger.error(f"[EventBus] Publish failed: {e}")
            return False

    def subscribe(self, event_type: str, handler: EventHandler):
        """Register a handler for an event type.

        Args:
            event_type: Event type to listen for, or '*' for all events
            handler: Async function that receives the event envelope dict
        """
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)

    async def _listen(self):
        """Background task that listens for events on the Redis channel."""
        if not self._subscriber:
            return

        try:
            pubsub = self._subscriber.pubsub()
            await pubsub.subscribe(CHANNEL)

            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue

                try:
                    envelope = json.loads(message["data"])
                    event_type = envelope["event"]["type"]

                    # Call type-specific handlers
                    for handler in self._handlers.get(event_type, []):
                        try:
                            await handler(envelope)
                        except Exception as e:
                            logger.error(
                                f"[EventBus] Handler error for {event_type}: {e}"
                            )

                    # Call wildcard handlers
                    for handler in self._handlers.get("*", []):
                        try:
                            await handler(envelope)
                        except Exception as e:
                            logger.error(f"[EventBus] Wildcard handler error: {e}")

                except (json.JSONDecodeError, KeyError) as e:
                    logger.error(f"[EventBus] Failed to parse event: {e}")

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[EventBus] Listener error: {e}")

    @property
    def connected(self) -> bool:
        return self._connected


# Global instance
event_bus = EventBus()
