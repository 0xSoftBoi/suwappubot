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
import json
import logging
import time

import httpx
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from database.db import get_session

logger = logging.getLogger(__name__)

WEBHOOK_TIMEOUT_SECONDS = 5.0


def sign_payload(raw_body: bytes, api_key_hash: str, timestamp: str) -> str:
    """Pure signing helper — HMAC-SHA256("{timestamp}.{raw_body}", key=sha256(api_key)).

    ``api_key_hash`` is expected to already be the hex sha256 digest of the
    agent's API key (i.e. ``agents.api_key_hash``), matching what the agent
    itself can compute from the key it was issued. Kept as a standalone pure
    function (no I/O) so it's unit-testable without a DB or network.
    """
    key_bytes = (
        bytes.fromhex(api_key_hash) if _is_hex(api_key_hash) else api_key_hash.encode("utf-8")
    )
    message = f"{timestamp}.".encode("utf-8") + raw_body
    return hmac.new(key_bytes, message, hashlib.sha256).hexdigest()


def _is_hex(value: str) -> bool:
    try:
        bytes.fromhex(value)
        return True
    except (ValueError, TypeError):
        return False


def _table_missing(e: Exception) -> bool:
    msg = str(e).lower()
    return "does not exist" in msg or "no such table" in msg or "no such column" in msg


async def notify_approval_decided(approval_id: str, status: str, intent_hash) -> None:
    """Best-effort POST to the owning agent's callback_url, if any is set.

    Looks up the agent via ``agent_approvals.agent_id = agents.uuid`` (the
    same string agent_id already stored on the approval row — no extra
    lookup needed elsewhere). Never raises.
    """
    try:
        with get_session() as session:
            row = session.execute(
                text(
                    "SELECT a.callback_url, a.api_key_hash "
                    "FROM agent_approvals ap "
                    "JOIN agents a ON a.uuid = ap.agent_id "
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
    callback_url, api_key_hash = row
    if not callback_url or not api_key_hash:
        return

    body_dict = {
        "event": "approval.decided",
        "approval_id": approval_id,
        "status": status,
        "decided_at": _now_iso(),
        "intent_hash": intent_hash,
    }
    raw_body = json.dumps(body_dict, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = sign_payload(raw_body, api_key_hash, timestamp)

    headers = {
        "Content-Type": "application/json",
        "X-Suwappu-Timestamp": timestamp,
        "X-Suwappu-Signature": signature,
    }

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
            else:
                logger.info(
                    "approval webhook delivered for %s -> %s (%s)",
                    approval_id,
                    callback_url,
                    resp.status_code,
                )
    except Exception as e:  # noqa: BLE001 — fire-and-forget, one attempt only
        logger.warning("approval webhook delivery failed for %s: %s", approval_id, e)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
