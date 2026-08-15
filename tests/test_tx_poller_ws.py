"""Tests for websocket-based Solana confirmation (bot/utils/ws_confirm.py)."""

import asyncio
import json

import aiohttp
import pytest

from bot.utils import ws_confirm

SIG = "5VERYfakeSignature111111111111111111111111111111"


class FakeWSMessage:
    def __init__(self, data, msg_type=aiohttp.WSMsgType.TEXT):
        self.data = data
        self.type = msg_type


class FakeWebSocket:
    """Minimal stand-in for aiohttp's ClientWebSocketResponse."""

    def __init__(self, messages):
        self._messages = list(messages)
        self.sent = []

    async def send_str(self, data):
        self.sent.append(data)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._messages:
            raise StopAsyncIteration
        msg = self._messages.pop(0)
        if isinstance(msg, Exception):
            raise msg
        return msg

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class FakeSession:
    def __init__(self, ws):
        self._ws = ws

    def ws_connect(self, *args, **kwargs):
        return self._ws

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _patch_session(monkeypatch, messages):
    ws = FakeWebSocket(messages)
    monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **kw: FakeSession(ws))
    return ws


def _ack():
    return FakeWSMessage(json.dumps({"jsonrpc": "2.0", "id": 1, "result": 42}))


def _notification(err=None):
    return FakeWSMessage(
        json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "signatureNotification",
                "params": {"result": {"context": {"slot": 1}, "value": {"err": err}}},
            }
        )
    )


@pytest.mark.asyncio
async def test_confirmation_resolves_confirmed(monkeypatch):
    ws = _patch_session(monkeypatch, [_ack(), _notification(err=None)])

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=5)

    assert result == ws_confirm.CONFIRMED
    # signatureSubscribe request was sent with our signature
    sent = json.loads(ws.sent[0])
    assert sent["method"] == "signatureSubscribe"
    assert sent["params"][0] == SIG


@pytest.mark.asyncio
async def test_failed_transaction_resolves_failed(monkeypatch):
    _patch_session(monkeypatch, [_ack(), _notification(err={"InstructionError": [0, "Custom"]})])

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=5)

    assert result == ws_confirm.FAILED


@pytest.mark.asyncio
async def test_timeout_returns_timeout(monkeypatch):
    class HangingWS(FakeWebSocket):
        async def __anext__(self):
            await asyncio.sleep(60)
            raise StopAsyncIteration

    ws = HangingWS([])
    monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **kw: FakeSession(ws))

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=0.1)

    assert result == ws_confirm.TIMEOUT


@pytest.mark.asyncio
async def test_malformed_messages_do_not_crash(monkeypatch):
    messages = [
        FakeWSMessage("not json at all {{{"),
        FakeWSMessage(json.dumps(["a", "list"])),
        FakeWSMessage(json.dumps({"method": "signatureNotification"})),  # missing params
        FakeWSMessage(json.dumps({"method": "signatureNotification", "params": {"result": {}}})),
        _notification(err=None),
    ]
    _patch_session(monkeypatch, messages)

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=5)

    assert result == ws_confirm.CONFIRMED


@pytest.mark.asyncio
async def test_connection_closed_without_notification_returns_timeout(monkeypatch):
    _patch_session(monkeypatch, [_ack()])  # stream ends after ack

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=5)

    assert result == ws_confirm.TIMEOUT


@pytest.mark.asyncio
async def test_subscribe_rejection_returns_timeout(monkeypatch):
    rejection = FakeWSMessage(
        json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32602, "message": "bad sig"}})
    )
    _patch_session(monkeypatch, [rejection])

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=5)

    assert result == ws_confirm.TIMEOUT


@pytest.mark.asyncio
async def test_ws_exception_is_swallowed(monkeypatch):
    class ExplodingSession:
        async def __aenter__(self):
            raise aiohttp.ClientError("connection refused")

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **kw: ExplodingSession())

    result = await ws_confirm.ws_wait_for_signature("wss://example.com", SIG, timeout=5)

    assert result == ws_confirm.TIMEOUT


def test_derive_ws_url():
    assert ws_confirm.derive_ws_url("https://api.mainnet-beta.solana.com") == (
        "wss://api.mainnet-beta.solana.com"
    )
    assert ws_confirm.derive_ws_url("http://localhost:8899") == "ws://localhost:8899"
    assert ws_confirm.derive_ws_url("wss://already.ws") == "wss://already.ws"
    assert ws_confirm.derive_ws_url("") is None
    assert ws_confirm.derive_ws_url("ftp://nope") is None
