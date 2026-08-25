"""Compliant transaction routing (UBS × Nethermind PoC, stage 2).

Covers the Flashbots private-transaction relay client: routing gate
(enabled/chain), auth-header shape, local tx-hash computation, and the
submit success / error / disabled paths with a mocked HTTP session.

Async paths are driven via ``asyncio.run`` so the suite does not depend on
pytest-asyncio.
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import sys  # noqa: E402

from bot.config.settings import settings  # noqa: E402
from bot.services.compliance.flashbots_relay import FlashbotsRelay, _parse_chain_ids  # noqa: E402

# The package re-exports a singleton named ``flashbots_relay`` which shadows the
# submodule attribute, so resolve the real module object via sys.modules to
# monkeypatch its ``get_session``.
relay_mod = sys.modules[FlashbotsRelay.__module__]

# Deterministic identity key for header tests (not a funded account).
TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"


@pytest.fixture()
def relay(monkeypatch):
    monkeypatch.setattr(settings, "compliance_routing_enabled", False, raising=False)
    monkeypatch.setattr(settings, "flashbots_relay_url", "https://relay.example", raising=False)
    monkeypatch.setattr(settings, "flashbots_signer_key", TEST_KEY, raising=False)
    monkeypatch.setattr(settings, "compliance_routing_chain_ids", "1", raising=False)
    monkeypatch.setattr(settings, "flashbots_max_block_offset", 25, raising=False)
    r = FlashbotsRelay()

    def _set(**kwargs):
        for key, value in kwargs.items():
            monkeypatch.setattr(settings, key, value, raising=False)
        return r

    r.configure = _set  # type: ignore[attr-defined]
    return r


class _FakeResp:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    async def text(self):
        return self._body


def _fake_session(captured, status=200, body=None, raise_exc=None):
    """Build a fake aiohttp-style session whose .post records the call."""

    class _Session:
        def post(self, url, data=None, headers=None):
            captured["url"] = url
            captured["data"] = data
            captured["headers"] = headers

            @asynccontextmanager
            async def _cm():
                if raise_exc:
                    raise raise_exc
                yield _FakeResp(status, body if body is not None else "{}")

            return _cm()

    return _Session()


# --- routing gate -----------------------------------------------------------


def test_should_route_disabled_by_default(relay):
    assert relay.enabled is False
    assert relay.should_route(1) is False


def test_should_route_enabled_for_listed_chain(relay):
    relay.configure(compliance_routing_enabled=True)
    assert relay.should_route(1) is True
    assert relay.should_route(137) is False  # not in chain id list
    assert relay.should_route(None) is False


def test_chain_id_parsing():
    assert _parse_chain_ids("1, 137 ,8453", {1}) == {1, 137, 8453}
    assert _parse_chain_ids("", {1}) == {1}  # falls back to default
    assert _parse_chain_ids("bogus", {5}) == {5}  # invalid → default


# --- identity / hashing -----------------------------------------------------


def test_auth_header_shape(relay):
    header = relay._auth_header(json.dumps({"hello": "world"}))
    addr, sig = header.split(":")
    assert addr.startswith("0x") and len(addr) == 42
    assert sig.startswith("0x") and len(sig) == 132  # 65-byte sig
    # Stable signer address for the fixed key.
    assert addr.lower() == relay._get_signer().address.lower()


def test_ephemeral_signer_when_no_key(monkeypatch):
    monkeypatch.setattr(settings, "flashbots_signer_key", "", raising=False)
    r = FlashbotsRelay()
    signer = r._get_signer()
    assert signer.address.startswith("0x")


def test_tx_hash_of_is_keccak():
    # keccak256 of a known short payload.
    h = FlashbotsRelay.tx_hash_of("0x1234")
    assert h.startswith("0x") and len(h) == 66


# --- submission -------------------------------------------------------------


def test_submit_skipped_when_disabled(relay):
    result = asyncio.run(relay.send_private_transaction("0x1234", 1, 100))
    assert result.submitted is False
    assert "not enabled" in result.error


def test_submit_success(relay, monkeypatch):
    relay.configure(compliance_routing_enabled=True)
    captured = {}
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": "0xabc123"})

    async def _get_session():
        return _fake_session(captured, status=200, body=body)

    monkeypatch.setattr(relay_mod, "get_session", _get_session)

    result = asyncio.run(relay.send_private_transaction("0xdeadbeef", 1, 1000))
    assert result.submitted is True
    assert result.tx_hash == "0xabc123"
    # Request used the configured relay + signed auth header + private method.
    assert captured["url"] == "https://relay.example"
    assert "X-Flashbots-Signature" in captured["headers"]
    sent = json.loads(captured["data"])
    assert sent["method"] == "eth_sendPrivateTransaction"
    assert sent["params"][0]["tx"] == "0xdeadbeef"
    # maxBlockNumber = current(1000) + offset(25) = 1025 = 0x401
    assert sent["params"][0]["maxBlockNumber"] == hex(1025)


def test_submit_relay_returns_error(relay, monkeypatch):
    relay.configure(compliance_routing_enabled=True)
    captured = {}
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "nope"}})

    async def _get_session():
        return _fake_session(captured, status=200, body=body)

    monkeypatch.setattr(relay_mod, "get_session", _get_session)

    result = asyncio.run(relay.send_private_transaction("0xdeadbeef", 1, 1000))
    assert result.submitted is False
    assert "nope" in result.error


def test_submit_http_error(relay, monkeypatch):
    relay.configure(compliance_routing_enabled=True)
    captured = {}

    async def _get_session():
        return _fake_session(captured, status=429, body="rate limited")

    monkeypatch.setattr(relay_mod, "get_session", _get_session)

    result = asyncio.run(relay.send_private_transaction("0xdeadbeef", 1, 1000))
    assert result.submitted is False
    assert "429" in result.error


def test_submit_network_exception_falls_back(relay, monkeypatch):
    relay.configure(compliance_routing_enabled=True)
    captured = {}

    async def _get_session():
        return _fake_session(captured, raise_exc=RuntimeError("connection reset"))

    monkeypatch.setattr(relay_mod, "get_session", _get_session)

    result = asyncio.run(relay.send_private_transaction("0xdeadbeef", 1, 1000))
    assert result.submitted is False
    assert "connection reset" in result.error
