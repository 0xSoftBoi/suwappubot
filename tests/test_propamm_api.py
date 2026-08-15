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


# ---------------------------------------------------------------------------
# Engine-side helpers guarding the money path (review findings regression).
# ---------------------------------------------------------------------------


def test_engine_maps_native_sentinel_case_insensitively():
    from bot.services.swap_engine import NATIVE_TOKEN_ADDRESS, SwapEngine

    assert SwapEngine._to_propamm_token(NATIVE_TOKEN_ADDRESS) == PROPAMM_NATIVE_TOKEN
    assert SwapEngine._to_propamm_token(NATIVE_TOKEN_ADDRESS.upper().replace("0X", "0x")) == (
        PROPAMM_NATIVE_TOKEN
    )
    assert SwapEngine._to_propamm_token(USDC) == USDC


def test_effective_fee_bps_clamped_to_router_cap():
    from bot.services.swap_engine import SwapEngine

    collector = "0x00000000000000000000000000000000000000A1"
    with patch("bot.services.swap_engine.settings") as mock_settings:
        mock_settings.fee_collector_address = collector
        # In-range fee passes through; above the router's 100 bps FrontendFee
        # cap it clamps (still charged) instead of silently dropping the fee.
        assert SwapEngine._propamm_effective_fee_bps(30) == 30
        assert SwapEngine._propamm_effective_fee_bps(100) == 100
        assert SwapEngine._propamm_effective_fee_bps(250) == 100
        assert SwapEngine._propamm_effective_fee_bps(0) == 0
        assert SwapEngine._propamm_effective_fee_bps(None) == 0

        # Zero-address collector would revert ZeroAddress() on-chain — no fee.
        mock_settings.fee_collector_address = "0x" + "0" * 40
        assert SwapEngine._propamm_effective_fee_bps(100) == 0

        mock_settings.fee_collector_address = None
        assert SwapEngine._propamm_effective_fee_bps(100) == 0


def test_net_min_out_applies_fee_before_slippage_with_floor_division():
    # swapWithFeeV1 treats amountOutMin as NET after fee (the contract
    # grosses it back up), so the engine must haircut fee first, then
    # slippage, with integer floor division at every step.
    gross = 1_880_775_773  # ~1880.78 USDC, the live-verified 1 WETH quote
    fee_bps, slippage_bps = 100, 50
    net = gross * (10_000 - fee_bps) // 10_000
    min_out = net * (10_000 - slippage_bps) // 10_000
    assert net == 1_861_968_015
    assert min_out == 1_852_658_174
    # min_out is strictly below net (slippage) and the contract's gross-up of
    # min_out stays at-or-below the quoted gross, so an unmoved market fills.
    assert min_out < net
    assert -(-min_out * 10_000 // (10_000 - fee_bps)) <= gross  # ceilDiv grossUp
    # The old (buggy) gross-based minimum would exceed the contract's
    # grossed-up requirement and revert every fee-charging swap:
    gross_based_min = gross * (10_000 - slippage_bps) // 10_000
    assert gross_based_min * 10_000 > (10_000 - fee_bps) * gross  # grossUp(min) > bestQuote


def test_router_abi_has_no_venue_pinning_entrypoints():
    """Regression guard: never route through a venue-taking entrypoint.

    Titan's `pamm` identifiers (from titan_getPammQuote / the price-level
    stream) are a DIFFERENT address space than the router's whitelist —
    verified on-chain 2026-08-15: isWhitelistedVenue() is False for the pAMM
    Titan reports for WETH->USDC. Passing it to swapViaVenueV1 reverts
    UnknownVenue and burns the user's gas. Narrowing is only ever valid
    against getWhitelistedVenues() addresses; keeping those entrypoints out
    of the ABI makes the mistake unrepresentable.
    """
    from bot.services.swap_engine import PROPAMM_ROUTER_ABI

    names = {fn["name"] for fn in PROPAMM_ROUTER_ABI}
    assert names == {"swapV1", "swapWithFeeV1"}
    for fn in PROPAMM_ROUTER_ABI:
        inputs = {i["name"] for i in fn["inputs"]}
        assert "venue" not in inputs and "venues" not in inputs


def test_swap_gas_limit_covers_observed_all_venues_usage():
    """The reserved limit must sit above the real swapV1 distribution.

    swapV1 re-quotes every whitelisted pAMM in-tx; measured mainnet usage is
    p50 441k / p90 619k / max 690k (Titan documents 400-800k), and the spread
    is driven by which pAMM fills. The quoted gas figure is expected usage,
    not the reservation, so it must be lower than the limit.
    """
    from bot.services.swap_engine import PROPAMM_SWAP_GAS_LIMIT, PROPAMM_EXPECTED_SWAP_GAS

    assert PROPAMM_SWAP_GAS_LIMIT >= 800_000
    assert 400_000 <= PROPAMM_EXPECTED_SWAP_GAS <= 800_000
    assert PROPAMM_EXPECTED_SWAP_GAS < PROPAMM_SWAP_GAS_LIMIT
