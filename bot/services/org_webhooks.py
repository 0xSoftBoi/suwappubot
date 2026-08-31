"""Read-only SQLAlchemy mirror of api-ts's ``org_webhooks`` table plus the
Python-side dispatch of ``screening.*`` events (``screening-webhook-dispatch``
node of the enterprise parity plan, ``docs/plans/enterprise-parity-graph.json``).

DDL OWNERSHIP: ``org_webhooks`` is defined and migrated by api-ts
(``api-ts/src/db/schema/webhooks.ts``), per ADR 0003 (shared Postgres
database, each side owns a subset of tables). ``_OrgWebhook`` below follows
``bot/models/org_policy.py``'s conventions EXACTLY:

  * uuid primary/foreign keys as ``String(36)``, jsonb columns as
    ``JSON().with_variant(JSONB(), "postgresql")``.
  * NO ``ForeignKey(...)`` wrappers on columns that reference api-ts-owned
    tables (``organizations.id``, ``users.id``) — plain, indexed columns
    instead. A bare ``Base.metadata.create_all()`` (every sqlite test
    fixture) would otherwise raise ``NoReferencedTableError`` the moment this
    module's class is registered on ``Base``, since no python model defines
    ``organizations``.
  * Defined and mapped LAZILY, inside ``_org_webhook_model()``, and cached in
    a module-level global rather than at import time — this module must
    never be imported eagerly from ``bot/models/__init__.py`` or anywhere
    reachable at ``init_db()`` time, so ``Base.metadata.create_all()`` never
    has this class registered when it runs.
  * NOT added to ``database/db.py::_ensure_schema()`` — python never
    creates or alters ``org_webhooks``. The three delivery-bookkeeping
    columns (``last_delivery_at``/``last_delivery_status``/``failure_count``)
    ARE written here, same as api-ts's own dispatcher writes them for its own
    deliveries (``api-ts/src/services/webhookDispatcher.ts``) — that's
    shared, best-effort bookkeeping, not DDL.

WIRE CONTRACT — must match ``webhookDispatcher.ts`` byte-for-byte where it
matters, since a recipient endpoint verifies one signature scheme regardless
of which side (api-ts's ``policy.*``/``allowlist.*`` events or this module's
``screening.*`` events) dispatched the delivery:

  * Body: ``{"id": <uuid4>, "eventType": ..., "orgId": ..., "timestamp":
    <ISO8601>, "payload": {...}}``, JSON-encoded with no inserted whitespace
    (``json.dumps(..., separators=(",", ":"))``) so the exact bytes sent are
    the exact bytes HMAC'd.
  * ``X-Suwappu-Signature``: hex HMAC-SHA256 of the raw body bytes, keyed by
    the webhook row's own ``secret``.
  * ``X-Suwappu-Event``: the event type string.
  * 5s timeout, https-only (enforced by ``is_safe_webhook_url`` immediately
    before every send — defense in depth, same rationale as the TS
    send-time re-check), no redirects followed.
  * ``last_delivery_status`` is the HTTP status on a completed request, or
    ``0`` when no HTTP response was ever received (DNS/connect/timeout/
    SSRF-blocked) — mirrors the TS dispatcher's ``0`` sentinel exactly, so a
    dashboard reading this column doesn't need to know which side delivered.

FIRE-AND-FORGET: ``dispatch_org_event`` is an ``async def`` that performs the
full lookup + fan-out delivery; a caller that awaits it pays the full
delivery latency. Use ``dispatch_org_event_nowait`` (running-loop context,
schedules via ``asyncio.create_task``) or ``dispatch_org_event_from_sync``
(safe to call from a context that may or may not have a running loop in the
current thread — the case for ``bot.services.compliance.screening_events.
record_screening_event``, which is callable from sync contexts via
``asyncio.to_thread``). Neither ever raises into the caller.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

DELIVERY_TIMEOUT_SECONDS = 5.0

# Bounds how many deliveries run concurrently across the whole process — an
# org with many webhooks subscribed to the same event (or several events
# firing in a burst) must not open unbounded outbound connections at once.
_DELIVERY_SEMAPHORE = asyncio.Semaphore(4)

# ─── read-only SQLAlchemy mirror (lazy, cached — see module docstring) ─────

_OrgWebhookModel = None
# Guards the check-then-act read+define+cache of `_OrgWebhookModel` below —
# two concurrent first-callers (e.g. two coroutines racing through
# `run_in_db`'s executor threads) could otherwise both observe `None`, both
# proceed to define the `OrgWebhook` class, and both attempt to map the same
# `__tablename__` onto `Base`, which SQLAlchemy raises on. A plain
# `threading.Lock` (not an asyncio lock) is correct here — this function
# always executes off the event loop, inside `run_in_db`'s thread-pool
# executor.
_org_webhook_model_lock = threading.Lock()


def _org_webhook_model():
    """Lazily define + cache the ``OrgWebhook`` mirror class.

    Must only ever define the class once per process — SQLAlchemy raises if
    the same ``__tablename__`` is mapped onto ``Base`` twice. Double-checked
    locking: the fast path (already cached) never pays the lock, and only
    one thread ever wins the race to actually define the class.
    """
    global _OrgWebhookModel
    if _OrgWebhookModel is not None:
        return _OrgWebhookModel

    with _org_webhook_model_lock:
        if _OrgWebhookModel is not None:
            return _OrgWebhookModel

        from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String
        from sqlalchemy.dialects.postgresql import JSONB

        from database.db import Base

        class OrgWebhook(Base):
            """Mirrors api-ts's ``org_webhooks`` (``api-ts/src/db/schema/webhooks.ts``)."""

            __tablename__ = "org_webhooks"

            id = Column(String(36), primary_key=True)
            org_id = Column(String(36), nullable=False, index=True)
            url = Column(String(2048), nullable=False)
            # HMAC-SHA256 signing key, 32 random bytes hex (64 chars) — generated
            # and owned by api-ts; python only ever reads it to sign a delivery.
            secret = Column(String(64), nullable=False)
            event_types = Column(
                JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list
            )
            enabled = Column(Boolean, nullable=False, default=True)
            description = Column(String(255), nullable=True)
            created_by = Column(Integer, nullable=True)
            created_at = Column(DateTime, nullable=False)
            last_delivery_at = Column(DateTime, nullable=True)
            last_delivery_status = Column(Integer, nullable=True)
            failure_count = Column(Integer, nullable=False, default=0)

        _OrgWebhookModel = OrgWebhook
        return _OrgWebhookModel


def _is_missing_table_error(e: Exception) -> bool:
    """True only for a genuine "org_webhooks doesn't exist here yet" signal
    (feature not rolled out to this environment) — mirrors the same narrow
    detection ``bot.services.webhook_dispatcher._table_missing`` and
    ``bot.services.org_policy.service`` use, so a real outage on an
    environment where the table DOES exist is never quiet-swallowed as
    "not rolled out".
    """
    msg = str(e).lower()
    if "no such table" in msg:
        return True
    if "relation" in msg and "does not exist" in msg:
        return True
    pgcode = getattr(getattr(e, "orig", None), "pgcode", None)
    return pgcode == "42P01"  # undefined_table


# ─── SSRF blocklist (send-time) — mirrors webhookDispatcher.ts::isSafeWebhookUrl ──

_PRIVATE_IPV4_PREFIXES = (
    lambda a, b: a == 0,  # 0.0.0.0/8
    lambda a, b: a == 127,  # loopback
    lambda a, b: a == 10,  # 10.0.0.0/8
    lambda a, b: a == 172 and 16 <= b <= 31,  # 172.16.0.0/12
    lambda a, b: a == 192 and b == 168,  # 192.168.0.0/16
    lambda a, b: a == 169 and b == 254,  # 169.254.0.0/16 link-local (incl. cloud metadata)
)

_HEX_HOST_RE = re.compile(r"^0x[0-9a-f]+$")
_DEC_HOST_RE = re.compile(r"^\d+$")
_OCT_HOST_RE = re.compile(r"^0[0-7]+$")

# A plausible DNS name: >=2 dot-separated labels, each a valid LDH label.
# Mirrors webhookDispatcher.ts's equivalent check byte-for-byte (same
# pattern, same "at least one label has a letter" second condition).
_DNS_NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")
_HAS_LETTER_RE = re.compile(r"[a-z]")


def _is_private_ipv4(host: str) -> bool:
    parts = host.split(".")
    if len(parts) != 4:
        return True
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return True
    if any(n < 0 or n > 255 for n in nums):
        return True
    a, b = nums[0], nums[1]
    return any(fn(a, b) for fn in _PRIVATE_IPV4_PREFIXES)


def _is_loopback_ipv6(host: str) -> bool:
    h = host.lower()
    return (
        h in ("::1", "::")
        or h.startswith("::ffff:127.")
        or h.startswith("fe80:")
        or h.startswith("fc")
        or h.startswith("fd")
    )


def is_safe_webhook_url(url: str) -> tuple[bool, Optional[str]]:
    """Send-time SSRF guard for a webhook URL. Rejects non-https schemes,
    obvious private/loopback/link-local/internal hostnames, private-range IP
    literals, and numeric-host encodings that dodge the dotted-quad check.
    Equivalent to (not a byte-for-byte port of) ``webhookDispatcher.ts``'s
    ``isSafeWebhookUrl`` — same coverage, python stdlib primitives.
    """
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False, "Invalid URL"

    if parsed.scheme != "https":
        return False, "Webhook url must use https"

    host = (parsed.hostname or "").lower()
    if not host:
        return False, "Invalid URL"

    if (
        host == "localhost"
        or host.endswith(".localhost")
        or host.endswith(".internal")
        or host == "0.0.0.0"
    ):
        return False, "Webhook url must not point to a local or internal host"

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None

    if isinstance(ip, ipaddress.IPv4Address):
        if _is_private_ipv4(host):
            return False, "Webhook url must not point to a private or loopback IP"
    elif isinstance(ip, ipaddress.IPv6Address):
        if _is_loopback_ipv6(host):
            return False, "Webhook url must not point to a private or loopback IP"
    else:
        # Not a literal IP — numeric-host bypasses (decimal/hex/octal
        # encodings of an IP) that dodge the dotted-quad checks above.
        if _HEX_HOST_RE.match(host) or _DEC_HOST_RE.match(host) or _OCT_HOST_RE.match(host):
            return False, "Webhook url host is not a valid hostname"
        # Dotted-numeric hosts like "127.1" or "0177.0.0.1" ("shortened"
        # dotted-quad / octal-per-label IP encodings) are rejected by BOTH
        # `ipaddress.ip_address` (raises above, so `ip is None` here) AND the
        # single-token numeric-host regexes just above (they don't match
        # because the host contains dots) — without this check, both of
        # those dotted-numeric IP forms sail straight through as an
        # apparently-fine "hostname" and a browser/resolver on the receiving
        # end may still interpret them as the loopback IP. Require the host
        # to actually look like a DNS name (>=2 LDH labels) AND have at
        # least one label containing a letter — a host where every label is
        # pure digits is never a real DNS name.
        if not _DNS_NAME_RE.match(host) or not _HAS_LETTER_RE.search(host):
            return False, "Webhook url host is not a valid hostname"

    return True, None


# ─── dispatch ────────────────────────────────────────────────────────────────


def _iso8601_ms(dt: datetime) -> str:
    """Millisecond-precision, ``Z``-suffixed ISO8601 — matches the shape of
    JS ``Date.prototype.toISOString()`` used by ``buildSignedBody`` in
    ``webhookDispatcher.ts``. Not required for signature correctness (each
    side only ever verifies bytes it itself produced), kept for payload
    parity across the two dispatchers.
    """
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _build_signed_body(event_type: str, org_id: str, payload: dict[str, Any]) -> bytes:
    body = {
        "id": str(uuid.uuid4()),
        "eventType": event_type,
        "orgId": org_id,
        "timestamp": _iso8601_ms(datetime.now(timezone.utc)),
        "payload": payload,
    }
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def _fetch_matching_webhooks(org_id: str, event_type: str) -> list[dict[str, Any]]:
    from database.db import get_session

    OrgWebhook = _org_webhook_model()
    with get_session() as session:
        rows = (
            session.query(OrgWebhook)
            .filter(OrgWebhook.org_id == org_id, OrgWebhook.enabled.is_(True))
            .all()
        )
        matching = []
        for row in rows:
            event_types = row.event_types or []
            if isinstance(event_types, list) and event_type in event_types:
                matching.append({"id": row.id, "url": row.url, "secret": row.secret})
        return matching


def _record_delivery(webhook_id: str, at: datetime, status: int, *, success: bool) -> None:
    """Atomic, race-free bookkeeping update. Uses a bulk
    ``query(...).update(...)`` (not a read-modify-write on a loaded ORM
    instance) so two concurrent deliveries for the same webhook row can never
    lose an increment to a lost-update race — each UPDATE computes
    ``failure_count + 1`` (or resets to ``0``) server-side, atomically,
    mirroring ``webhookDispatcher.ts``'s ``sql`${orgWebhooks.failureCount} + 1```
    pattern.
    """
    from database.db import get_session

    OrgWebhook = _org_webhook_model()
    at_naive = at.replace(tzinfo=None)
    with get_session() as session:
        session.query(OrgWebhook).filter(OrgWebhook.id == webhook_id).update(
            {
                OrgWebhook.last_delivery_at: at_naive,
                OrgWebhook.last_delivery_status: status,
                OrgWebhook.failure_count: (0 if success else OrgWebhook.failure_count + 1),
            },
            synchronize_session=False,
        )


async def _deliver_one(
    webhook: dict[str, Any], event_type: str, org_id: str, payload: dict[str, Any]
) -> None:
    """Deliver one signed POST and persist the outcome. Never raises — every
    failure mode (unsafe URL, malformed payload, network error, timeout,
    non-2xx) is caught and recorded on the row, mirroring
    ``webhookDispatcher.ts``'s ``deliverOne``. Bounded by
    ``_DELIVERY_SEMAPHORE`` so a burst of matching webhooks can't open
    unbounded concurrent outbound connections.
    """
    from database.db import run_in_db

    webhook_id = webhook["id"]
    url = webhook["url"]
    secret = webhook["secret"]
    now = datetime.now(timezone.utc)

    async with _DELIVERY_SEMAPHORE:
        # The SSRF re-check and body-signing both live INSIDE this try —
        # previously a ValueError/TypeError from either (e.g. an
        # unexpected `url`/`secret` type slipping past the DB layer, or a
        # non-JSON-serializable value buried in `payload`) would propagate
        # straight out of `_deliver_one` uninstrumented: no warning log, no
        # `failure_count` bump, no `last_delivery_status` update — the
        # delivery attempt would simply vanish (swallowed only by
        # `dispatch_org_event`'s outer `asyncio.gather(..., return_exceptions
        # =True)`, which discards the exception object entirely). Folding
        # both into this same try means every failure mode for this webhook
        # ends up on the SAME bookkeeping path below.
        status: Optional[int] = None
        blocked_reason: Optional[str] = None
        try:
            safe, err = is_safe_webhook_url(url)
            if not safe:
                blocked_reason = err
            else:
                raw_body = _build_signed_body(event_type, org_id, payload)
                signature = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
                headers = {
                    "Content-Type": "application/json",
                    "X-Suwappu-Signature": signature,
                    "X-Suwappu-Event": event_type,
                }

                import httpx

                async with httpx.AsyncClient(
                    timeout=DELIVERY_TIMEOUT_SECONDS, follow_redirects=False
                ) as client:
                    resp = await client.post(url, content=raw_body, headers=headers)
                    status = resp.status_code
        except (ValueError, TypeError) as e:
            logger.warning(
                "org_webhooks delivery %s rejected (bad url/payload, event=%s): %s",
                webhook_id,
                event_type,
                e,
            )
            status = None
        except Exception as e:  # noqa: BLE001 — delivery failures must never propagate
            logger.warning(
                "org_webhooks delivery %s failed (event=%s): %s", webhook_id, event_type, e
            )
            status = None

        if blocked_reason is not None:
            logger.warning(
                "org_webhooks delivery %s blocked by SSRF guard: %s", webhook_id, blocked_reason
            )

        ok = status is not None and 200 <= status < 300
        try:
            await run_in_db(_record_delivery, webhook_id, now, status or 0, success=ok)
        except Exception as e:  # noqa: BLE001 — bookkeeping is best-effort
            logger.warning(
                "org_webhooks failed to record delivery outcome for %s: %s", webhook_id, e
            )


async def dispatch_org_event(org_id: str, event_type: str, payload: dict[str, Any]) -> None:
    """Look up enabled webhooks subscribed to ``event_type`` for ``org_id``
    and fan out a signed delivery to each, concurrently. Mirrors
    ``webhookDispatcher.ts``'s ``dispatchOrgEventEffect``: every failure mode
    (lookup failure, individual delivery failure) is swallowed here — this
    coroutine itself never raises, so callers can safely await it directly or
    fire it via ``dispatch_org_event_nowait``/``dispatch_org_event_from_sync``.
    """
    from database.db import run_in_db

    try:
        webhooks = await run_in_db(_fetch_matching_webhooks, org_id, event_type)
    except Exception as e:  # noqa: BLE001 — lookup failure must never propagate
        if _is_missing_table_error(e):
            logger.debug(
                "org_webhooks table not present; skipping dispatch (feature not rolled out) "
                "org=%s event=%s",
                org_id,
                event_type,
            )
        else:
            logger.warning("org_webhooks lookup failed org=%s event=%s: %s", org_id, event_type, e)
        return

    if not webhooks:
        return

    await asyncio.gather(
        *(_deliver_one(w, event_type, org_id, payload) for w in webhooks),
        return_exceptions=True,
    )


# Holds in-flight dispatch tasks so they can't be garbage-collected mid-flight
# — asyncio only holds a weak reference to tasks created via
# ``create_task``/``ensure_future`` (mirrors ``webhook_dispatcher.py``'s
# ``_inflight_tasks`` pattern).
_inflight_tasks: set[asyncio.Task] = set()


def dispatch_org_event_nowait(org_id: str, event_type: str, payload: dict[str, Any]) -> None:
    """Fire-and-forget dispatch for callers already inside a running event
    loop. Schedules ``dispatch_org_event`` via ``asyncio.create_task``; the
    done-callback only logs (``dispatch_org_event`` already swallows every
    failure internally, so this is a defensive backstop, not the primary
    error path). Never awaited, never raises into the caller.
    """
    task = asyncio.create_task(dispatch_org_event(org_id, event_type, payload))
    _inflight_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _inflight_tasks.discard(t)
        if not t.cancelled() and t.exception() is not None:
            logger.warning(
                "org_webhooks dispatch task raised unexpectedly org=%s event=%s: %s",
                org_id,
                event_type,
                t.exception(),
            )

    task.add_done_callback(_on_done)


def dispatch_org_event_from_sync(org_id: str, event_type: str, payload: dict[str, Any]) -> None:
    """Safe entry point for a caller that may or may not be running on a
    thread with an active event loop — the case for
    ``bot.services.compliance.screening_events.record_screening_event``,
    which is itself sync and reachable from a worker thread via
    ``asyncio.to_thread``. No running loop in the current thread means there
    is nothing to schedule delivery onto (a worker thread's loop-less
    context can't create a task) — no-ops with a debug log rather than
    raising or blocking. The screening_events row itself is already durably
    written regardless, so this is a delivery gap, not a data-loss gap. Falls
    through to ``dispatch_org_event_nowait`` when a loop IS running in this
    thread.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        logger.debug(
            "org_webhooks dispatch skipped (no running event loop in this thread): "
            "org=%s event=%s",
            org_id,
            event_type,
        )
        return
    dispatch_org_event_nowait(org_id, event_type, payload)
