"""Websocket-based Solana transaction confirmation helper.

Uses the `signatureSubscribe` RPC subscription over a chain's websocket
endpoint (via aiohttp's websocket client) to get near-instant confirmation
feedback instead of waiting for the next polling interval. All errors are
swallowed (returned as "timeout") so callers can always fall back to HTTP
polling.
"""

import asyncio
import json
import logging
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

# Result constants
CONFIRMED = "confirmed"
FAILED = "failed"
TIMEOUT = "timeout"


def derive_ws_url(rpc_url: Optional[str]) -> Optional[str]:
    """Derive a websocket URL from an HTTP(S) RPC URL.

    Most Solana RPC providers expose the websocket endpoint at the same
    host/path with the scheme swapped (https:// -> wss://).
    """
    if not rpc_url:
        return None
    if rpc_url.startswith("wss://") or rpc_url.startswith("ws://"):
        return rpc_url
    if rpc_url.startswith("https://"):
        return "wss://" + rpc_url[len("https://") :]
    if rpc_url.startswith("http://"):
        return "ws://" + rpc_url[len("http://") :]
    return None


async def ws_wait_for_signature(ws_url: str, signature: str, timeout: float = 90.0) -> str:
    """Wait for a Solana signature confirmation via signatureSubscribe.

    Returns one of: "confirmed", "failed", "timeout".
    Never raises — any websocket/protocol error results in "timeout" so the
    caller's HTTP polling backstop handles the transaction as before.
    """
    try:
        return await asyncio.wait_for(_subscribe_and_wait(ws_url, signature), timeout=timeout)
    except asyncio.TimeoutError:
        logger.debug(f"ws_wait_for_signature timed out for {signature}")
        return TIMEOUT
    except Exception as e:
        logger.warning(f"ws_wait_for_signature error for {signature}: {e}")
        return TIMEOUT


def _parse_message(raw, signature: str) -> Optional[str]:
    """Parse one ws message; return CONFIRMED/FAILED/TIMEOUT or None to keep waiting."""
    try:
        msg = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(msg, dict):
        return None

    # Subscription ack / rejection (response to our request id)
    if msg.get("id") == 1:
        if "error" in msg:
            logger.warning(f"signatureSubscribe rejected for {signature}: {msg['error']}")
            return TIMEOUT
        return None

    if msg.get("method") != "signatureNotification":
        return None

    try:
        value = msg["params"]["result"]["value"]
    except (KeyError, TypeError):
        return None
    if not isinstance(value, dict):
        return None

    return CONFIRMED if value.get("err") is None else FAILED


async def _subscribe_and_wait(ws_url: str, signature: str) -> str:
    # Note: the outer ws_wait_for_signature() already wraps this whole call in
    # asyncio.wait_for(timeout=90), which bounds the handshake + read loop as a
    # whole. This session-level timeout is a belt-and-suspenders guard on the
    # initial connect (DNS/TCP/TLS/WS-handshake) specifically.
    #
    # Deliberately NOT bot.utils.http_client.get_session(): this is a
    # persistent, long-lived bidirectional WS stream, not a short REST call.
    # ws_connect()'s own `timeout=` only accepts a ClientWSTimeout
    # (ws_receive/ws_close) — there is no way to override the shared
    # session's `sock_read=15s`/`total=20s` ClientTimeout for this call, and
    # those bounds are tuned for bursty JSON fetches. Reusing them here could
    # silently kill a healthy-but-idle WS connection between heartbeats
    # (heartbeat=20s > sock_read=15s), so this keeps its own short-lived
    # session dedicated to the WS handshake instead.
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
        async with session.ws_connect(ws_url, heartbeat=20) as ws:
            sub_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "signatureSubscribe",
                "params": [signature, {"commitment": "confirmed"}],
            }
            await ws.send_str(json.dumps(sub_request))

            async for ws_msg in ws:
                if ws_msg.type == aiohttp.WSMsgType.TEXT:
                    result = _parse_message(ws_msg.data, signature)
                    if result is not None:
                        return result
                elif ws_msg.type in (
                    aiohttp.WSMsgType.CLOSED,
                    aiohttp.WSMsgType.CLOSE,
                    aiohttp.WSMsgType.ERROR,
                ):
                    break

    # Connection closed without a notification
    return TIMEOUT
