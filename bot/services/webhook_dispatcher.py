"""Durable delivery dispatcher for approval-decision webhooks (SUW-204 follow-up).

``bot/services/approval_webhook.py`` enqueues a row in
``agent_webhook_deliveries`` for every decided/expired approval and makes one
best-effort inline delivery attempt. That inline attempt is NOT retried by
approval_webhook itself — this background loop is what turns a single
fire-and-forget POST into durable delivery: it polls for rows still
``status='pending'`` whose ``next_attempt_at`` has passed (or is NULL, i.e.
never attempted by the dispatcher yet), retries with exponential backoff, and
dead-letters (``status='failed'``) after the attempt cap so a permanently
broken callback_url can't spin forever.

Backoff schedule (indexed by attempt number, 1-based, after increment):
    attempt 1 fails -> wait 30s
    attempt 2 fails -> wait 2m
    attempt 3 fails -> wait 8m
    attempt 4 fails -> wait 30m
    attempt 5 fails -> wait 2h
    attempt 6 fails -> dead-letter (no further retry)

Mirrors the poll-loop shape of ``bot/services/approval_notifier.py``: must
tolerate the table not existing yet, must never raise out of the loop, and
reuses the existing SSRF guard (``is_callback_url_safe``) and signing helper
(``build_signed_request`` / ``sign_payload``) from ``approval_webhook`` rather
than duplicating either.
"""

import asyncio
import json
import logging

import httpx
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from bot.config.settings import settings
from bot.services.approval_webhook import (
    WEBHOOK_TIMEOUT_SECONDS,
    build_signed_request,
    is_callback_url_safe,
)
from database.db import get_session

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 15

# Backoff in seconds, indexed by (attempts_after_increment - 1). 5 entries =
# 5 retry delays; the 6th attempt's failure dead-letters instead of
# scheduling another retry (MAX_ATTEMPTS is the count of *retryable*
# failures — total attempts made is MAX_ATTEMPTS + 1).
BACKOFF_SCHEDULE_SECONDS = [30, 120, 480, 1800, 7200]
MAX_ATTEMPTS = len(BACKOFF_SCHEDULE_SECONDS)


def _table_missing(e: Exception) -> bool:
    msg = str(e).lower()
    return "does not exist" in msg or "no such table" in msg


class WebhookDispatcher:
    """Background task that retries agent_webhook_deliveries with backoff + dead-letter."""

    def __init__(self):
        self._running = False
        self._task = None
        self._table_missing_logged = False

    async def start(self) -> None:
        if not settings.agent_approvals_enabled:
            logger.info("Webhook dispatcher disabled (AGENT_APPROVALS_ENABLED=false)")
            return
        if self._running:
            logger.warning("Webhook dispatcher already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Webhook dispatcher started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Webhook dispatcher stopped")

    async def _loop(self) -> None:
        await asyncio.sleep(10)  # let the app finish booting
        while self._running:
            try:
                await self._process_due()
            except Exception as e:  # noqa: BLE001 — one bad cycle must not kill the loop
                logger.error("Webhook dispatcher loop error: %s", e, exc_info=True)
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def _process_due(self) -> None:
        try:
            with get_session() as session:
                candidate_ids = session.execute(
                    text(
                        "SELECT id FROM agent_webhook_deliveries "
                        "WHERE status = 'pending' "
                        "AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP) "
                        "ORDER BY created_at ASC LIMIT 20"
                    )
                ).fetchall()
        except SQLAlchemyError as e:
            if _table_missing(e):
                if not self._table_missing_logged:
                    logger.info("agent_webhook_deliveries table not present yet; dispatcher idling")
                    self._table_missing_logged = True
                return
            logger.error("Failed to poll agent_webhook_deliveries: %s", e)
            return

        for (candidate_id,) in candidate_ids:
            claimed = self._claim(candidate_id)
            if claimed is None:
                # Lost the race (another replica/the inline post already
                # claimed or finished it) — skip, don't double-deliver.
                continue
            await self._attempt_one(
                delivery_id=claimed["id"],
                approval_id=claimed["approval_id"],
                agent_id=claimed["agent_id"],
                url=claimed["url"],
                payload_json=claimed["payload_json"],
                signature_ts=claimed["signature_ts"],
                attempts=claimed["attempts"] or 0,
            )

    def _claim(self, delivery_id: str) -> dict | None:
        """Atomically flip a still-pending row to 'sending' before attempting it.

        Prevents two racing pollers (multi-replica, or this loop racing the
        inline attempt in ``approval_webhook.notify_approval_decided``) from
        both POSTing the same delivery. Returns the claimed row's fields, or
        None if another actor claimed/finished it first.
        """
        try:
            with get_session() as session:
                row = session.execute(
                    text(
                        "UPDATE agent_webhook_deliveries SET status = 'sending' "
                        "WHERE id = :id AND status = 'pending' "
                        "RETURNING id, approval_id, agent_id, url, payload_json, "
                        "signature_ts, attempts"
                    ),
                    {"id": delivery_id},
                ).fetchone()
                session.commit()
        except Exception as e:  # noqa: BLE001 — treat as lost race, retried next poll
            logger.warning("Failed to claim webhook delivery %s: %s", delivery_id, e)
            return None
        if row is None:
            return None
        return {
            "id": row[0],
            "approval_id": row[1],
            "agent_id": row[2],
            "url": row[3],
            "payload_json": row[4],
            "signature_ts": row[5],
            "attempts": row[6],
        }

    async def _attempt_one(
        self,
        *,
        delivery_id: str,
        approval_id: str,
        agent_id,
        url: str,
        payload_json,
        signature_ts: str,
        attempts: int,
    ) -> None:
        if not is_callback_url_safe(url):
            logger.warning(
                "webhook delivery %s (approval %s) dead-lettered — callback_url no longer "
                "passes SSRF check: %s",
                delivery_id,
                approval_id,
                url,
            )
            self._mark(delivery_id, status="failed", attempts=attempts, last_error="unsafe url")
            return

        try:
            body_dict = payload_json if isinstance(payload_json, dict) else json.loads(payload_json)
        except Exception as e:  # noqa: BLE001 — a poison row must back off, not wedge the queue
            self._record_failure(delivery_id, attempts, f"bad payload: {e}")
            return

        try:
            # Re-sign per attempt: signatures are timestamp-bound, so a stale
            # signature from an earlier attempt would be rejected by the
            # agent even though the payload itself hasn't changed.
            with get_session() as session:
                row = session.execute(
                    text("SELECT api_key_hash FROM agents WHERE CAST(uuid AS TEXT) = :agent_id"),
                    {"agent_id": agent_id},
                ).fetchone()
            api_key_hash = row[0] if row else None
            if not api_key_hash:
                raise ValueError("agent api_key_hash not found for re-signing")
            raw_body, headers, _ts = build_signed_request(url, api_key_hash, body_dict)
        except Exception as e:  # noqa: BLE001 — treat as a failed attempt, not a crash
            self._record_failure(delivery_id, attempts, f"sign error: {e}")
            return

        delivered = False
        error_str = None
        try:
            async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT_SECONDS) as client:
                resp = await client.post(url, content=raw_body, headers=headers)
                if resp.status_code >= 400:
                    error_str = f"http {resp.status_code}"
                else:
                    delivered = True
        except Exception as e:  # noqa: BLE001 — never raise out of the dispatcher loop
            error_str = str(e)

        if delivered:
            self._mark(delivery_id, status="delivered", attempts=attempts + 1, last_error=None)
            logger.info(
                "webhook delivery %s (approval %s) delivered on attempt %d",
                delivery_id,
                approval_id,
                attempts + 1,
            )
        else:
            self._record_failure(delivery_id, attempts, error_str)

    def _record_failure(self, delivery_id: str, attempts: int, error_str) -> None:
        new_attempts = attempts + 1
        if new_attempts > MAX_ATTEMPTS:
            logger.error(
                "webhook delivery %s dead-lettered after %d attempts: %s",
                delivery_id,
                new_attempts,
                error_str,
            )
            self._mark(delivery_id, status="failed", attempts=new_attempts, last_error=error_str)
            return

        delay_seconds = BACKOFF_SCHEDULE_SECONDS[new_attempts - 1]
        logger.warning(
            "webhook delivery %s attempt %d failed (%s); retrying in %ds",
            delivery_id,
            new_attempts,
            error_str,
            delay_seconds,
        )
        try:
            with get_session() as session:
                session.execute(
                    (
                        text(
                            "UPDATE agent_webhook_deliveries SET status = 'pending', "
                            "attempts = :attempts, "
                            "last_error = :last_error, "
                            "next_attempt_at = CURRENT_TIMESTAMP + (:delay || ' seconds')::interval "
                            "WHERE id = :id"
                        )
                        if _is_postgres()
                        else text(
                            "UPDATE agent_webhook_deliveries SET status = 'pending', "
                            "attempts = :attempts, "
                            "last_error = :last_error, "
                            "next_attempt_at = datetime(CURRENT_TIMESTAMP, :delay_sqlite) "
                            "WHERE id = :id"
                        )
                    ),
                    {
                        "attempts": new_attempts,
                        "last_error": error_str,
                        "delay": delay_seconds,
                        "delay_sqlite": f"+{delay_seconds} seconds",
                        "id": delivery_id,
                    },
                )
                session.commit()
        except Exception as e:  # noqa: BLE001 — this row will simply be retried next poll
            logger.warning("Failed to update webhook delivery %s after failure: %s", delivery_id, e)

    def _mark(self, delivery_id: str, *, status: str, attempts: int, last_error) -> None:
        try:
            with get_session() as session:
                if status == "delivered":
                    session.execute(
                        text(
                            "UPDATE agent_webhook_deliveries SET status = :status, "
                            "attempts = :attempts, delivered_at = CURRENT_TIMESTAMP, "
                            "last_error = :last_error WHERE id = :id"
                        ),
                        {
                            "status": status,
                            "attempts": attempts,
                            "last_error": last_error,
                            "id": delivery_id,
                        },
                    )
                else:
                    session.execute(
                        text(
                            "UPDATE agent_webhook_deliveries SET status = :status, "
                            "attempts = :attempts, last_error = :last_error WHERE id = :id"
                        ),
                        {
                            "status": status,
                            "attempts": attempts,
                            "last_error": last_error,
                            "id": delivery_id,
                        },
                    )
                session.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to mark webhook delivery %s as %s: %s", delivery_id, status, e)


def _is_postgres() -> bool:
    try:
        from database.db import engine

        return engine.dialect.name != "sqlite"
    except Exception:
        return False


# Module-level singleton (mirrors approval_notifier).
webhook_dispatcher = WebhookDispatcher()
