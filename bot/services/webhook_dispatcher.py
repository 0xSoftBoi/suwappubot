"""Webhook delivery service with retry logic.

Dispatches HTTP POST notifications to agents' callback_url when swap
status changes occur. Persists every attempt in the webhook_events table
and retries with exponential back-off (1 s, 5 s, 30 s).
"""

import asyncio
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

import aiohttp

from bot.models.webhook_event import WebhookEvent
from database.db import get_session

logger = logging.getLogger(__name__)

# Retry delays in seconds (indexed by attempt number 0, 1, 2)
RETRY_DELAYS = [1, 5, 30]
MAX_ATTEMPTS = 3
RETRY_POLL_INTERVAL = 10  # seconds between retry sweeps


class WebhookDispatcher:
    """Background service that delivers and retries webhook events."""

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._http_session: Optional[aiohttp.ClientSession] = None

    async def start(self):
        """Start the retry loop."""
        if self._running:
            return
        self._running = True
        self._http_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10),
        )
        self._task = asyncio.create_task(self._retry_loop())
        logger.info("Webhook dispatcher started")

    async def stop(self):
        """Stop the retry loop and close HTTP session."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._http_session:
            await self._http_session.close()
            self._http_session = None
        logger.info("Webhook dispatcher stopped")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def dispatch(
        self,
        agent_id: int,
        event_type: str,
        payload: str,
        callback_url: str,
        agent_api_key: Optional[str] = None,
    ) -> Optional[WebhookEvent]:
        """Create a webhook event and attempt immediate delivery.

        Args:
            agent_id: The agent's DB id.
            event_type: e.g. "swap.submitted", "swap.completed", "swap.failed".
            payload: Pre-serialised JSON string.
            callback_url: The agent's registered callback URL.
            agent_api_key: If provided, used to compute HMAC signature.

        Returns:
            The WebhookEvent row (may already be delivered).
        """
        with get_session() as session:
            event = WebhookEvent(
                agent_id=agent_id,
                event_type=event_type,
                payload=payload,
                callback_url=callback_url,
                status="pending",
                attempts=0,
                created_at=datetime.utcnow(),
            )
            session.add(event)
            session.flush()
            event_id = event.id

        # Attempt immediate delivery (fire-and-forget style, but we await)
        await self._attempt_delivery(event_id, agent_api_key)

        with get_session() as session:
            return session.query(WebhookEvent).filter(WebhookEvent.id == event_id).first()

    # ------------------------------------------------------------------
    # Internal delivery
    # ------------------------------------------------------------------

    async def _attempt_delivery(
        self,
        event_id: int,
        agent_api_key: Optional[str] = None,
    ):
        """Try to POST the webhook payload to the callback URL."""
        with get_session() as session:
            event = session.query(WebhookEvent).filter(WebhookEvent.id == event_id).first()
            if not event or event.status == "delivered":
                return
            callback_url = event.callback_url
            payload = event.payload
            event_type = event.event_type
            attempts = event.attempts

        headers = {
            "Content-Type": "application/json",
            "X-Suwappu-Event": event_type,
            "X-Suwappu-Delivery": str(event_id),
            "X-Suwappu-Timestamp": str(int(time.time())),
        }

        # HMAC signature: sha256(agent_api_key) is the signing key
        if agent_api_key:
            signing_key = hashlib.sha256(agent_api_key.encode()).digest()
            sig = hmac.new(signing_key, payload.encode(), hashlib.sha256).hexdigest()
            headers["X-Suwappu-Signature"] = f"sha256={sig}"

        http = self._http_session or aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10),
        )
        close_after = self._http_session is None  # close if we created a one-off

        try:
            async with http.post(callback_url, data=payload, headers=headers) as resp:
                status_code = resp.status
        except Exception as exc:
            status_code = None
            error_msg = str(exc)
        else:
            error_msg = None if 200 <= status_code < 300 else f"HTTP {status_code}"
        finally:
            if close_after:
                await http.close()

        # Update event record
        with get_session() as session:
            event = session.query(WebhookEvent).filter(WebhookEvent.id == event_id).first()
            if not event:
                return
            event.attempts = attempts + 1
            event.response_status = status_code

            if error_msg is None:
                event.status = "delivered"
                event.delivered_at = datetime.utcnow()
                logger.info(f"Webhook {event_id} delivered to {callback_url}")
            else:
                event.last_error = error_msg
                if event.attempts >= MAX_ATTEMPTS:
                    event.status = "failed"
                    logger.warning(
                        f"Webhook {event_id} permanently failed after {MAX_ATTEMPTS} attempts: {error_msg}"
                    )
                else:
                    delay = RETRY_DELAYS[min(event.attempts, len(RETRY_DELAYS) - 1)]
                    event.next_retry_at = datetime.utcnow() + timedelta(seconds=delay)
                    logger.info(
                        f"Webhook {event_id} attempt {event.attempts} failed, retry in {delay}s: {error_msg}"
                    )

    # ------------------------------------------------------------------
    # Retry loop
    # ------------------------------------------------------------------

    async def _retry_loop(self):
        """Periodically sweep for pending events that need retrying."""
        while self._running:
            try:
                await self._retry_pending()
            except Exception as exc:
                logger.error(f"Webhook retry loop error: {exc}")
            await asyncio.sleep(RETRY_POLL_INTERVAL)

    async def _retry_pending(self):
        """Query events eligible for retry and attempt delivery."""
        now = datetime.utcnow()
        with get_session() as session:
            events = (
                session.query(WebhookEvent)
                .filter(
                    WebhookEvent.status == "pending",
                    WebhookEvent.attempts < MAX_ATTEMPTS,
                    WebhookEvent.next_retry_at <= now,
                )
                .limit(50)
                .all()
            )
            event_ids = [e.id for e in events]

        for eid in event_ids:
            await self._attempt_delivery(eid)


# Global singleton
webhook_dispatcher = WebhookDispatcher()
