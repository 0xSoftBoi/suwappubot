"""Tests for the Across HyperCore USDC deposit quote — session-mocked, no network."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.across_api import (
    HYPERCORE_CHAIN_ID,
    HYPERCORE_USDC_SPOT_TOKEN,
    AcrossAPI,
    AcrossError,
)

HL_ADDR = "0x2222222222222222222222222222222222222222"
ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"


class _FakeResp:
    def __init__(self, status, json_data=None, text_data=""):
        self.status = status
        self._json = json_data
        self._text = text_data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._json

    async def text(self):
        return self._text


class _FakeSession:
    def __init__(self, resp):
        self._resp = resp
        self.params = None
        self.headers = None

    def get(self, url, params=None, headers=None):
        self.params = params
        self.headers = headers
        return self._resp


def _patch(resp):
    session = _FakeSession(resp)
    return (
        patch("bot.services.across_api.get_session", AsyncMock(return_value=session)),
        patch(
            "bot.services.across_api.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
        session,
    )


def _ok_response():
    return {
        "approvalTxns": [{"to": ARB_USDC, "data": "0x095ea7b3deadbeef", "chainId": 42161}],
        "swapTx": {
            "to": "0xSpokePool00000000000000000000000000000000",
            "data": "0xabcdef",
            "value": "0",
            "chainId": 42161,
        },
        "expectedOutputAmount": "49950000",
        "minOutputAmount": "49900000",
        "expectedFillTime": 15,
    }


@pytest.mark.asyncio
async def test_hypercore_deposit_builds_params_and_txs():
    p_sess, p_lim, session = _patch(_FakeResp(200, _ok_response()))
    with p_sess, p_lim:
        api = AcrossAPI()
        quote = await api.get_hypercore_usdc_deposit(
            from_chain="arbitrum",
            input_token_address=ARB_USDC,
            amount="50000000",
            recipient=HL_ADDR,
            depositor="0x3333333333333333333333333333333333333333",
            slippage_pct=0.5,
        )

    # Request was shaped for HyperCore (chain 1337) USDC-SPOT.
    assert session.params["destinationChainId"] == HYPERCORE_CHAIN_ID
    assert session.params["outputToken"] == HYPERCORE_USDC_SPOT_TOKEN
    assert session.params["originChainId"] == 42161
    assert session.params["recipient"] == HL_ADDR
    assert session.params["tradeType"] == "minOutput"

    # Parsed tx bundle.
    assert len(quote.approval_txns) == 1
    assert quote.approval_txns[0]["to"] == ARB_USDC
    assert quote.approval_txns[0]["value"] == 0
    assert quote.swap_tx["data"] == "0xabcdef"
    assert quote.expected_output == "49950000"
    assert quote.min_output == "49900000"
    assert quote.estimated_fill_time == 15
    # Human amounts (6-decimal USDC).
    assert quote.input_amount_human == pytest.approx(50.0)
    assert quote.expected_output_human == pytest.approx(49.95)


@pytest.mark.asyncio
async def test_hypercore_deposit_steps_shape():
    """Some responses return the swap tx as the last entry of a steps[] array."""
    resp = {
        "steps": [
            {"tx": {"to": "0xSpoke", "data": "0xfeed", "chainId": 42161}, "outputAmount": "1000000"}
        ],
        "minOutputAmount": "990000",
    }
    p_sess, p_lim, _ = _patch(_FakeResp(200, resp))
    with p_sess, p_lim:
        api = AcrossAPI()
        quote = await api.get_hypercore_usdc_deposit(
            from_chain="base",
            input_token_address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount="1000000",
            recipient=HL_ADDR,
        )
    assert quote.swap_tx["data"] == "0xfeed"
    assert quote.expected_output == "1000000"
    assert quote.approval_txns == []


@pytest.mark.asyncio
async def test_hypercore_deposit_rejects_bad_recipient():
    p_sess, p_lim, _ = _patch(_FakeResp(200, _ok_response()))
    with p_sess, p_lim:
        api = AcrossAPI()
        with pytest.raises(AcrossError):
            await api.get_hypercore_usdc_deposit(
                from_chain="arbitrum",
                input_token_address=ARB_USDC,
                amount="50000000",
                recipient="garbage",
            )


@pytest.mark.asyncio
async def test_hypercore_deposit_raises_on_malformed_swap_tx():
    bad = {"swapTx": {"value": "0"}}  # missing to/data
    p_sess, p_lim, _ = _patch(_FakeResp(200, bad))
    with p_sess, p_lim:
        api = AcrossAPI()
        with pytest.raises(AcrossError):
            await api.get_hypercore_usdc_deposit(
                from_chain="arbitrum",
                input_token_address=ARB_USDC,
                amount="50000000",
                recipient=HL_ADDR,
            )


@pytest.mark.asyncio
async def test_hypercore_deposit_raises_on_http_error():
    p_sess, p_lim, _ = _patch(_FakeResp(429, None, "rate limited"))
    with p_sess, p_lim:
        api = AcrossAPI()
        with pytest.raises(AcrossError):
            await api.get_hypercore_usdc_deposit(
                from_chain="arbitrum",
                input_token_address=ARB_USDC,
                amount="50000000",
                recipient=HL_ADDR,
            )
