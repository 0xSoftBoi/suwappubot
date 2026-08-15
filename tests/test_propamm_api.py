"""Tests for the PropAMM (Titan Builder) client — session-mocked, no network."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.propamm_api import (
    PROPAMM_NATIVE_TOKEN,
    PROPAMM_WETH_ETHEREUM,
    PropAMMAPI,
    PropAMMError,
)

WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"


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
        self.post_calls = []

    def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        return self._resp


def _patch(resp):
    session = _FakeSession(resp)
    return (
        patch("bot.services.propamm_api.get_session", AsyncMock(return_value=session)),
        patch(
            "bot.services.propamm_api.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
        session,
    )


def _quote_result(amount_out_hex="0x3e8", pamm="0x" + "1" * 40, router="0x" + "2" * 40):
    return {
        "tokenIn": WETH,
        "tokenOut": USDC,
        "amountIn": "0x2386f26fc10000",
        "amountOut": amount_out_hex,
        "pamm": pamm,
        "router": router,
        "blockNumber": "0x64",
        "slot": 1,
        "timestamp": 1700000000,
    }


# --------------------------- is_configured gating ---------------------------- #
def test_is_configured_gated_on_flag():
    from types import SimpleNamespace
    import bot.services.propamm_api as propamm_mod

    with patch.object(
        propamm_mod,
        "settings",
        SimpleNamespace(propamm_enabled=False, titan_rpc_url="https://rpc.titanbuilder.xyz"),
    ):
        assert PropAMMAPI().is_configured is False

    with patch.object(
        propamm_mod,
        "settings",
        SimpleNamespace(propamm_enabled=True, titan_rpc_url="https://rpc.titanbuilder.xyz"),
    ):
        assert PropAMMAPI().is_configured is True


# --------------------------- native sentinel mapping ------------------------- #
def test_quote_token_remaps_native_sentinel_to_weth():
    assert PropAMMAPI._quote_token(PROPAMM_NATIVE_TOKEN) == PROPAMM_WETH_ETHEREUM
    # Case-insensitive match
    assert PropAMMAPI._quote_token(PROPAMM_NATIVE_TOKEN.lower()) == PROPAMM_WETH_ETHEREUM


def test_quote_token_passes_through_erc20_addresses():
    assert PropAMMAPI._quote_token(USDC) == USDC


# --------------------------- get_quote happy path ----------------------------- #
async def test_get_quote_parses_hex_amounts():
    resp = _FakeResp(
        200, {"jsonrpc": "2.0", "id": 1, "result": _quote_result(amount_out_hex="0x3e8")}
    )
    p_sess, p_lim, session = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        quote = await api.get_quote(token_in=WETH, token_out=USDC, amount_in="10000000000000000")

    assert quote is not None
    assert quote.to_amount == "1000"  # 0x3e8 == 1000
    assert quote.from_amount == "10000000000000000"
    assert quote.block_number == 100  # 0x64
    assert quote.pamm == "0x" + "1" * 40
    assert quote.router == "0x" + "2" * 40

    # amountIn was hex-encoded in the RPC request
    url, kwargs = session.post_calls[0]
    body = kwargs["json"]
    assert body["method"] == "titan_getPammQuote"
    assert body["params"][2] == hex(10000000000000000)


async def test_get_quote_remaps_native_token_for_rpc_call():
    resp = _FakeResp(200, {"jsonrpc": "2.0", "id": 1, "result": _quote_result()})
    p_sess, p_lim, session = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        await api.get_quote(
            token_in=PROPAMM_NATIVE_TOKEN, token_out=USDC, amount_in="1000000000000000000"
        )

    _, kwargs = session.post_calls[0]
    params = kwargs["json"]["params"]
    assert params[0] == PROPAMM_WETH_ETHEREUM  # remapped, not the raw sentinel
    assert params[1] == USDC


# --------------------------- error handling ----------------------------------- #
async def test_get_quote_returns_none_on_unknown_pair_error():
    resp = _FakeResp(
        200,
        {"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "unknown pair"}},
    )
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        quote = await api.get_quote(token_in=WETH, token_out=USDC, amount_in="1000")
    assert quote is None


async def test_get_quote_raises_propamm_error_on_real_rpc_error():
    resp = _FakeResp(
        200,
        {"jsonrpc": "2.0", "id": 1, "error": {"code": -32602, "message": "invalid params"}},
    )
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        with pytest.raises(PropAMMError):
            await api.get_quote(token_in=WETH, token_out=USDC, amount_in="1000")


async def test_get_quote_raises_on_http_error_status():
    resp = _FakeResp(500, None)
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        with pytest.raises(PropAMMError):
            await api.get_quote(token_in=WETH, token_out=USDC, amount_in="1000")


async def test_get_quote_returns_none_on_empty_result():
    resp = _FakeResp(200, {"jsonrpc": "2.0", "id": 1, "result": None})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        quote = await api.get_quote(token_in=WETH, token_out=USDC, amount_in="1000")
    assert quote is None


async def test_get_quote_returns_none_on_zero_amount_out():
    resp = _FakeResp(
        200, {"jsonrpc": "2.0", "id": 1, "result": _quote_result(amount_out_hex="0x0")}
    )
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = PropAMMAPI()
        quote = await api.get_quote(token_in=WETH, token_out=USDC, amount_in="1000")
    assert quote is None


async def test_get_quote_rejects_unparseable_amount_in():
    api = PropAMMAPI()
    with pytest.raises(PropAMMError):
        await api.get_quote(token_in=WETH, token_out=USDC, amount_in="not-a-number")
