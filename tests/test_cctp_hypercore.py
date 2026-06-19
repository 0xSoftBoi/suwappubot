"""Tests for the CCTP V2 -> HyperCore native-USDC rail — session-mocked."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.cctp_hypercore import (
    FINALITY_FAST,
    HYPEREVM_CCTP_DOMAIN,
    HYPERCORE_USDC_SYSTEM_ADDRESS,
    TOKEN_MESSENGER_V2,
    CctpAttestation,
    CctpHyperCoreAPI,
    CctpHyperCoreError,
)

HL_ADDR = "0x1111111111111111111111111111111111111111"


class _FakeResp:
    def __init__(self, status, json_data=None):
        self.status = status
        self._json = json_data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._json


class _FakeSession:
    def __init__(self, resp):
        self._resp = resp

    def get(self, url, params=None, headers=None):
        return self._resp


def _patch(resp):
    session = _FakeSession(resp)
    return (
        patch("bot.services.cctp_hypercore.get_session", AsyncMock(return_value=session)),
        patch(
            "bot.services.cctp_hypercore.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
    )


# --------------------------- constants / resolution ------------------------ #
def test_system_address_is_usdc_token_zero():
    # 0x20 + 38 zero-nibbles -> token index 0 system address.
    assert HYPERCORE_USDC_SYSTEM_ADDRESS == "0x2000000000000000000000000000000000000000"


def test_domain_resolution():
    api = CctpHyperCoreAPI()
    assert api.get_source_domain("arbitrum") == 3
    assert api.is_supported_source("base") is True
    assert api.is_supported_source("hyperliquid") is False


def test_unsupported_source_raises():
    api = CctpHyperCoreAPI()
    with pytest.raises(CctpHyperCoreError):
        api.get_source_domain("dogechain")


# --------------------------- fee fetch ------------------------------------- #
@pytest.mark.asyncio
async def test_get_fast_fee_applies_bps():
    # 1 bp on 100 USDC (100_000_000 raw) -> 10_000 raw (0.01 USDC).
    resp = _FakeResp(200, [{"finalityThreshold": FINALITY_FAST, "minimumFee": 1}])
    p_sess, p_lim = _patch(resp)
    with p_sess, p_lim:
        api = CctpHyperCoreAPI()
        fee = await api.get_fast_fee("arbitrum", 100_000_000)
    assert fee == 10_000


@pytest.mark.asyncio
async def test_get_fast_fee_zero_on_error():
    resp = _FakeResp(500, None)
    p_sess, p_lim = _patch(resp)
    with p_sess, p_lim:
        api = CctpHyperCoreAPI()
        fee = await api.get_fast_fee("arbitrum", 100_000_000)
    assert fee == 0


# --------------------------- burn quote ------------------------------------ #
@pytest.mark.asyncio
async def test_quote_burn_builds_txs():
    resp = _FakeResp(200, [{"finalityThreshold": FINALITY_FAST, "minimumFee": 1}])
    p_sess, p_lim = _patch(resp)
    with p_sess, p_lim:
        api = CctpHyperCoreAPI()
        q = await api.quote_burn("arbitrum", 100.0, HL_ADDR, fast=True)

    assert q.input_amount == "100000000"
    assert q.max_fee == 10_000
    assert q.expected_output_human == pytest.approx(99.99)
    assert q.min_finality_threshold == FINALITY_FAST
    # approve targets USDC, burn targets the V2 TokenMessenger.
    assert q.approve_tx["to"].lower() == "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
    assert q.burn_tx["to"].lower() == TOKEN_MESSENGER_V2.lower()
    assert q.burn_tx["value"] == 0


@pytest.mark.asyncio
async def test_quote_burn_rejects_bad_recipient():
    resp = _FakeResp(200, [])
    p_sess, p_lim = _patch(resp)
    with p_sess, p_lim:
        api = CctpHyperCoreAPI()
        with pytest.raises(CctpHyperCoreError):
            await api.quote_burn("arbitrum", 100.0, "garbage", fast=True)


@pytest.mark.asyncio
async def test_quote_burn_unsupported_chain_raises():
    api = CctpHyperCoreAPI()
    with pytest.raises(CctpHyperCoreError):
        await api.quote_burn("dogechain", 100.0, HL_ADDR)


# --------------------------- attestation ----------------------------------- #
@pytest.mark.asyncio
async def test_get_attestation_complete():
    resp = _FakeResp(
        200,
        {"messages": [{"status": "complete", "message": "0xabcd", "attestation": "0x1234"}]},
    )
    p_sess, p_lim = _patch(resp)
    with p_sess, p_lim:
        api = CctpHyperCoreAPI()
        att = await api.get_attestation("arbitrum", "0xburn", max_attempts=1, poll_interval=0)
    assert att.is_complete
    assert att.message == "0xabcd"
    assert att.attestation == "0x1234"


@pytest.mark.asyncio
async def test_get_attestation_pending_times_out():
    resp = _FakeResp(404, None)
    p_sess, p_lim = _patch(resp)
    with p_sess, p_lim:
        api = CctpHyperCoreAPI()
        att = await api.get_attestation("arbitrum", "0xburn", max_attempts=2, poll_interval=0)
    assert not att.is_complete
    assert att.status == "pending"


# --------------------------- destination builders -------------------------- #
def test_build_receive_requires_complete_attestation():
    api = CctpHyperCoreAPI()
    with pytest.raises(CctpHyperCoreError):
        api.build_receive_tx(CctpAttestation(status="pending", message=None, attestation=None))


def test_build_core_credit_targets_system_address():
    api = CctpHyperCoreAPI()
    tx = api.build_core_credit_tx(50_000_000)
    # transfer() to the USDC HyperEVM token, crediting HyperCore spot.
    assert tx["value"] == 0
    # calldata encodes the system address as the transfer recipient.
    assert HYPERCORE_USDC_SYSTEM_ADDRESS[2:].lower() in tx["data"].lower()
