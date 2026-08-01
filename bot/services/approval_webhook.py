"""Fire-and-forget decision webhook for agent-owned callback URLs (SUW-204).

When an ``agent_approvals`` row is decided (approved/denied by a human via
the Telegram buttons in ``bot/handlers/approvals.py``) or expires (the sweep
in ``bot/services/approval_notifier.py``), and the owning agent
(``agents`` joined on ``agent_approvals.agent_id = agents.uuid`` — this join
uses the uuid string, unlike ``agent_link_codes.agent_id`` which is an
integer FK to ``agents.id``) has a ``callback_url`` set, POST a signed JSON
notification to it so the agent can react without polling.

Signing contract (documented here since this is the only place either side
can read it): the agent already possesses its own API key, and
``agents.api_key_hash`` is ``sha256(api_key)`` — a value the agent can
recompute locally without the bot ever exposing it. So:

    hmac_key = sha256(api_key).digest()          # == api_key_hash, as raw bytes
    signature = hmac_sha256(hmac_key, f"{timestamp}.{raw_body}").hexdigest()

Headers sent:
    X-Suwappu-Timestamp: unix seconds (string)
    X-Suwappu-Signature: hex hmac-sha256 of "{timestamp}.{raw_body}"

The timestamp is folded into the signed material so a captured request can't
be replayed indefinitely. This call never raises — every failure is caught
and logged so a webhook outage can never block or crash the approval
decide/expire path.
"""

import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
import uuid
from urllib.parse import urlsplit

import httpx
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from bot.config.settings import settings
from database.db import get_session

logger = logging.getLogger(__name__)

WEBHOOK_TIMEOUT_SECONDS = 5.0

_METADATA_IP = "169.254.169.254"


def sign_payload(raw_body: bytes, api_key_hash: str, timestamp: str) -> str:
    """Pure signing helper — HMAC-SHA256("{timestamp}.{raw_body}", key=sha256(api_key)).

    ``api_key_hash`` is expected to already be the hex sha256 digest of the
    agent's API key (i.e. ``agents.api_key_hash``), matching what the agent
    itself can compute from the key it was issued. Kept as a standalone pure
    function (no I/O) so it's unit-testable without a DB or network.

    Raises ``ValueError`` if ``api_key_hash`` isn't valid hex — silently
    falling back to signing with the raw utf-8 bytes would produce a
    signature the agent (which always hashes with hex) could never
    reproduce, defeating the point of signing without anyone noticing.
    """
    if not _is_hex(api_key_hash):
        raise ValueError("api_key_hash must be a valid hex string (sha256 hex digest)")
    key_bytes = bytes.fromhex(api_key_hash)
    message = f"{timestamp}.".encode("utf-8") + raw_body
    return hmac.new(key_bytes, message, hashlib.sha256).hexdigest()


def _is_local_environment() -> bool:
    return settings.sentry_environment.lower() not in ("production", "prod")


def _is_disallowed_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparsable → reject closed
    if ip_str == _METADATA_IP:
        return True
    return bool(
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
    )


def is_callback_url_safe(callback_url: str) -> bool:
    """SSRF guard for outbound webhook callback_urls.

    Requires https, except http is allowed for localhost-ish hosts when
    running outside production (local dev). Resolves the hostname and
    rejects if ANY resolved address is private/loopback/link-local/reserved
    or the cloud metadata IP (169.254.169.254) — defends against DNS
    rebinding to internal infra.
    """
    try:
        parsed = urlsplit(callback_url)
    except ValueError:
        return False

    hostname = parsed.hostname
    if not hostname:
        return False

    scheme = (parsed.scheme or "").lower()
    if scheme == "https":
        pass
    elif (
        scheme == "http"
        and _is_local_environment()
        and hostname
        in (
            "localhost",
            "127.0.0.1",
            "::1",
        )
    ):
        pass
    else:
        logger.warning("Rejecting callback_url with disallowed scheme: %s", callback_url)
        return False

    try:
        addrinfo = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        logger.warning("Could not resolve callback_url host %s: %s", hostname, e)
        return False

    resolved_ips = {info[4][0] for info in addrinfo}
    for ip_str in resolved_ips:
        if _is_disallowed_ip(ip_str):
            logger.warning(
                "Rejecting callback_url %s — resolved to disallowed IP %s",
                callback_url,
                ip_str,
            )
            return False

    return True


def _is_hex(value: str) -> bool:
    try:
        bytes.fromhex(value)
        return True
    except (ValueError, TypeError):
        return False


def _table_missing(e: Exception) -> bool:
    msg = str(e).lower()
    return "does not exist" in msg or "no such table" in msg or "no such column" in msg


def build_signed_request(callback_url: str, api_key_hash: str, body_dict: dict):
    """Build (raw_body, headers) for a signed webhook POST. Pure, no I/O.

    Raises ``ValueError`` if ``api_key_hash`` isn't valid hex (see
    ``sign_payload``).
    """
    raw_body = json.dumps(body_dict, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = sign_payload(raw_body, api_key_hash, timestamp)
    headers = {
        "Content-Type": "application/json",
        "X-Suwappu-Timestamp": timestamp,
        "X-Suwappu-Signature": signature,
    }
    return raw_body, headers, timestamp


async def notify_approval_decided(approval_id: str, status: str, intent_hash) -> None:
    """Enqueue a durable delivery row, then best-effort attempt immediate delivery.

    Looks up the agent via ``agent_approvals.agent_id = agents.uuid`` (the
    same string agent_id already stored on the approval row — no extra
    lookup needed elsewhere). Never raises — a delivery row is enqueued
    first so ``webhook_dispatcher``'s background poller can retry even if
    the immediate attempt below fails or this whole function errors before
    reaching the POST.
    """
    try:
        with get_session() as session:
            # Postgres has no uuid = text operator, so agents.uuid (native
            # uuid column there) must be cast to text before comparing
            # against agent_approvals.agent_id (a text column). CAST(...AS
            # TEXT) is portable — it works identically on sqlite (where
            # uuid is already stored as TEXT) — so we always use it rather
            # than dialect-branching on ``::text`` vs CAST.
            row = session.execute(
                text(
                    "SELECT a.callback_url, a.api_key_hash, ap.agent_id "
                    "FROM agent_approvals ap "
                    "JOIN agents a ON CAST(a.uuid AS TEXT) = ap.agent_id "
                    "WHERE ap.id = :approval_id"
                ),
                {"approval_id": approval_id},
            ).fetchone()
    except SQLAlchemyError as e:
        if _table_missing(e):
            return
        logger.warning("approval webhook lookup failed for %s: %s", approval_id, e)
        return
    except Exception as e:  # noqa: BLE001 — this path must never bubble up
        logger.warning("approval webhook lookup errored for %s: %s", approval_id, e)
        return

    if not row:
        return
    callback_url, api_key_hash, agent_id = row
    if not callback_url or not api_key_hash:
        return

    if not is_callback_url_safe(callback_url):
        logger.warning(
            "approval webhook for %s skipped — callback_url failed SSRF check: %s",
            approval_id,
            callback_url,
        )
        return

    body_dict = {
        "event": "approval.decided",
        "approval_id": approval_id,
        "status": status,
        "decided_at": _now_iso(),
        "intent_hash": intent_hash,
    }

    try:
        raw_body, headers, timestamp = build_signed_request(callback_url, api_key_hash, body_dict)
    except ValueError as e:
        logger.warning("approval webhook for %s has invalid api_key_hash: %s", approval_id, e)
        return

    delivery_id = enqueue_delivery(
        approval_id=approval_id,
        agent_id=agent_id,
        url=callback_url,
        payload_json=body_dict,
        signature_ts=timestamp,
    )
    if delivery_id is None:
        # Enqueue itself failed (e.g. table missing on a partial deploy) —
        # nothing further we can durably retry, so fall back to the old
        # single-shot behavior rather than silently dropping the decision.
        await _post_once(callback_url, raw_body, headers, approval_id)
        return

    delivered = await _post_once(callback_url, raw_body, headers, approval_id)
    _mark_delivery_result(delivery_id, delivered)


async def _post_once(callback_url: str, raw_body: bytes, headers: dict, approval_id: str) -> bool:
    """Single best-effort POST attempt. Returns True on 2xx/3xx, never raises."""
    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT_SECONDS) as client:
            resp = await client.post(callback_url, content=raw_body, headers=headers)
            if resp.status_code >= 400:
                logger.warning(
                    "approval webhook to %s for %s returned %s",
                    callback_url,
                    approval_id,
                    resp.status_code,
                )
                return False
            logger.info(
                "approval webhook delivered for %s -> %s (%s)",
                approval_id,
                callback_url,
                resp.status_code,
            )
            return True
    except Exception as e:  # noqa: BLE001 — caller (dispatcher/notifier) handles retry
        logger.warning("approval webhook delivery failed for %s: %s", approval_id, e)
        return False


def enqueue_delivery(
    *, approval_id: str, agent_id, url: str, payload_json: dict, signature_ts: str
) -> str | None:
    """Insert a pending ``agent_webhook_deliveries`` row. Returns the new id, or None on failure.

    Called both from the immediate-attempt path above and can be called
    standalone by any other decision path (e.g. future channels) that wants
    durable delivery without an inline POST attempt.
    """
    delivery_id = str(uuid.uuid4())
    try:
        with get_session() as session:
            is_sqlite = session.get_bind().dialect.name == "sqlite"
            next_attempt_at_expr = (
                "datetime(CURRENT_TIMESTAMP, '+60 seconds')"
                if is_sqlite
                else "CURRENT_TIMESTAMP + interval '60 seconds'"
            )
            # next_attempt_at is set 60s out (not NULL) so the caller's own
            # inline _post_once attempt below owns the first delivery
            # window uncontested — otherwise a dispatcher poll landing in
            # that same window would treat the still-'pending' row as due
            # and fire a second, concurrent POST to the agent's callback_url.
            session.execute(
                text(
                    "INSERT INTO agent_webhook_deliveries "
                    "(id, approval_id, agent_id, url, payload_json, signature_ts, status, "
                    "attempts, next_attempt_at) "
                    "VALUES (:id, :approval_id, :agent_id, :url, :payload_json, :signature_ts, "
                    f"'pending', 0, {next_attempt_at_expr})"
                ),
                {
                    "id": delivery_id,
                    "approval_id": approval_id,
                    "agent_id": agent_id,
                    "url": url,
                    "payload_json": json.dumps(payload_json, separators=(",", ":")),
                    "signature_ts": signature_ts,
                },
            )
            session.commit()
        return delivery_id
    except SQLAlchemyError as e:
        if _table_missing(e):
            logger.info(
                "agent_webhook_deliveries table not present yet; skipping durable enqueue for %s",
                approval_id,
            )
            return None
        logger.warning("Failed to enqueue webhook delivery for %s: %s", approval_id, e)
        return None
    except Exception as e:  # noqa: BLE001 — never raise out of a notify path
        logger.warning("Failed to enqueue webhook delivery for %s: %s", approval_id, e)
        return None


def _mark_delivery_result(delivery_id: str, delivered: bool) -> None:
    """Mark the immediate-attempt outcome.

    This immediate attempt is deliberately NOT counted against
    ``attempts`` — attempt/backoff accounting belongs solely to
    ``webhook_dispatcher`` so its schedule (30s, 2m, 8m, 30m, 2h; 5-attempt
    cap) starts cleanly at the first *dispatcher* attempt regardless of
    whether this inline try happened. On failure the row is simply left
    'pending' with no next_attempt_at, so the dispatcher's very next poll
    picks it up immediately as attempt #1.
    """
    try:
        with get_session() as session:
            if delivered:
                session.execute(
                    text(
                        "UPDATE agent_webhook_deliveries SET status = 'delivered', "
                        "delivered_at = CURRENT_TIMESTAMP "
                        "WHERE id = :id"
                    ),
                    {"id": delivery_id},
                )
                session.commit()
            # On failure: intentionally no-op. Row stays pending/attempts=0
            # with next_attempt_at ~60s out (set at enqueue time), which the
            # dispatcher's WHERE clause will pick up as due shortly after
            # this inline attempt's own window has passed.
    except Exception as e:  # noqa: BLE001 — dispatcher will still pick this row up eventually
        logger.warning("Failed to record immediate-attempt result for %s: %s", delivery_id, e)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
