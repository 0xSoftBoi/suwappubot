"""Tests for the free on-chain Chainalysis sanctions oracle client.

No network: every test stubs ``httpx.AsyncClient`` and the RPC-URL lookup.
The behaviours that matter here are all fail-open ones — on a money path,
"I could not reach the oracle" must never decode as "this address is
clean".
"""

from __future__ import annotations

import pytest

from bot.services.compliance.chainalysis_oracle import (
    IS_SANCTIONED_SELECTOR,
    ORACLE_ADDRESS,
    ChainalysisSanctionsOracle,
)

SANCTIONED = "0x0330070FD38Ec3bB94F58FA55D40368271E9e54A"  # live SDN sample
CLEAN = "0xd8dA6BF26964aF9D7eEd9e03E43415D37aA96045"

WORD_TRUE = "0x" + "0" * 63 + "1"
WORD_FALSE = "0x" + "0" * 64


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _FakeClient:
    """Stand-in for httpx.AsyncClient recording the JSON-RPC body."""

    def __init__(self, payload=None, status_code=200, raises=None, sink=None):
        self._payload = payload
        self._status = status_code
        self._raises = raises
        self._sink = sink if sink is not None else []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        self._sink.append((url, json))
        if self._raises is not None:
            raise self._raises
        return _FakeResponse(self._payload, self._status)


@pytest.fixture
def oracle(monkeypatch):
    """Fresh oracle with a stubbed RPC URL (no rpc_manager import)."""
    inst = ChainalysisSanctionsOracle()
    monkeypatch.setattr(inst, "_rpc_url", lambda chain: "https://rpc.test")
    return inst


def _patch_client(monkeypatch, **kwargs):
    sink = []

    def factory(*a, **kw):
        return _FakeClient(sink=sink, **kwargs)

    monkeypatch.setattr("httpx.AsyncClient", factory)
    return sink


# --- happy paths -----------------------------------------------------------


async def test_sanctioned_true(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"result": WORD_TRUE})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is True


async def test_sanctioned_false(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"result": WORD_FALSE})
    assert await oracle.is_sanctioned(CLEAN, "ethereum") is False


async def test_calldata_is_selector_plus_padded_address(oracle, monkeypatch):
    sink = _patch_client(monkeypatch, payload={"result": WORD_FALSE})
    await oracle.is_sanctioned(CLEAN, "ethereum")
    _url, body = sink[0]
    call = body["params"][0]
    assert call["to"] == ORACLE_ADDRESS
    assert call["data"].startswith(IS_SANCTIONED_SELECTOR)
    # selector (10 chars incl. 0x) + exactly one 32-byte word
    assert len(call["data"]) == 10 + 64
    assert call["data"].endswith(CLEAN[2:].lower())
    assert body["method"] == "eth_call"


# --- fail-open behaviour ---------------------------------------------------


async def test_timeout_returns_none_not_clean(oracle, monkeypatch):
    _patch_client(monkeypatch, raises=TimeoutError("timed out"))
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is None


async def test_http_error_returns_none(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={}, status_code=503)
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is None


async def test_rpc_error_payload_returns_none(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"error": {"message": "boom"}})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is None


async def test_empty_result_is_unknown_not_clean(oracle, monkeypatch):
    """``0x`` means the call hit no contract — the critical false-negative.

    Decoding a bare ``0x`` as False would silently pass a sanctioned
    recipient on any chain where the oracle is not deployed.
    """
    _patch_client(monkeypatch, payload={"result": "0x"})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is None


async def test_no_rpc_url_returns_none(monkeypatch):
    inst = ChainalysisSanctionsOracle()
    monkeypatch.setattr(inst, "_rpc_url", lambda chain: None)
    called = []
    monkeypatch.setattr("httpx.AsyncClient", lambda *a, **kw: called.append(1) or _FakeClient())
    assert await inst.is_sanctioned(SANCTIONED, "ethereum") is None
    assert not called, "must not attempt a request without an endpoint"


# --- guards: never call where it would be wrong ----------------------------


async def test_unsupported_chain_never_calls(oracle, monkeypatch):
    sink = _patch_client(monkeypatch, payload={"result": WORD_TRUE})
    # base has no deployment — verified by eth_getCode on 2026-11-20
    assert await oracle.is_sanctioned(SANCTIONED, "base") is None
    assert await oracle.is_sanctioned(SANCTIONED, "solana") is None
    assert sink == []


async def test_non_evm_address_never_calls(oracle, monkeypatch):
    sink = _patch_client(monkeypatch, payload={"result": WORD_TRUE})
    assert await oracle.is_sanctioned("TX3JMx2vPcbnuhxFjZBqwx6Y8bFJvQ8gr7", "ethereum") is None
    assert await oracle.is_sanctioned("", "ethereum") is None
    assert await oracle.is_sanctioned(None, "ethereum") is None
    assert await oracle.is_sanctioned("0xdeadbeef", "ethereum") is None
    assert sink == []


def test_supports_matches_verified_chains():
    for chain in ("ethereum", "polygon", "bsc", "avalanche", "optimism", "arbitrum"):
        assert ChainalysisSanctionsOracle.supports(chain)
    for chain in ("base", "solana", "tron", "", None):
        assert not ChainalysisSanctionsOracle.supports(chain)


# --- caching ---------------------------------------------------------------


async def test_cache_avoids_second_rpc_call(oracle, monkeypatch):
    sink = _patch_client(monkeypatch, payload={"result": WORD_TRUE})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is True
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is True
    assert len(sink) == 1


async def test_cache_is_per_chain(oracle, monkeypatch):
    sink = _patch_client(monkeypatch, payload={"result": WORD_TRUE})
    await oracle.is_sanctioned(SANCTIONED, "ethereum")
    await oracle.is_sanctioned(SANCTIONED, "polygon")
    assert len(sink) == 2


async def test_stats_reports_hits(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"result": WORD_TRUE})
    await oracle.is_sanctioned(SANCTIONED, "ethereum")
    stats = oracle.stats()
    assert stats["sanctioned_hits"] == 1
    assert stats["oracle_address"] == ORACLE_ADDRESS
    assert "base" not in stats["chains"]


async def test_multiword_result_does_not_read_clean(oracle, monkeypatch):
    # Old int(result,16)==1 decoded this to False (clean) -- must not.
    _patch_client(monkeypatch, payload={"result": "0x" + "0" * 63 + "1" + "0" * 64})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is not False


async def test_multiword_all_zero_is_unknown(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"result": "0x" + "0" * 128})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is None


async def test_misaligned_result_is_unknown(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"result": "0x" + "0" * 65})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is None


async def test_noncanonical_bool_is_sanctioned(oracle, monkeypatch):
    _patch_client(monkeypatch, payload={"result": "0x" + "0" * 62 + "02"})
    assert await oracle.is_sanctioned(SANCTIONED, "ethereum") is True
