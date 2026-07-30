"""Tests for the new bridge provider package — session-mocked, no network."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.bridge.allbridge_api import AllbridgeBridge
from bot.services.bridge.arbitrum_native import ArbitrumNativeBridge
from bot.services.bridge.base import normalize_amount, validate_address_for_chain
from bot.services.bridge.near_intents import NearIntentsBridge
from bot.services.bridge.registry import bridge_quote, get_bridge_quotes
from bot.services.bridge.symbiosis_api import SymbiosisBridge

ADDR = "0x1111111111111111111111111111111111111111"
ADDR2 = "0x2222222222222222222222222222222222222222"
SOL_ADDR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
TRON_ADDR = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"


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
    """Routes GET/POST to different canned responses keyed by URL substring."""

    def __init__(self, resp=None, get_map=None, post_map=None):
        self._resp = resp
        self._get_map = get_map or {}
        self._post_map = post_map or {}

    def get(self, url, params=None, headers=None):
        for key, resp in self._get_map.items():
            if key in url:
                return resp
        return self._resp

    def post(self, url, json=None, headers=None):
        for key, resp in self._post_map.items():
            if key in url:
                return resp
        return self._resp


def _patch(module_path, resp=None, get_map=None, post_map=None, limiter_name="wait_and_acquire"):
    session = _FakeSession(resp, get_map=get_map, post_map=post_map)
    return (
        patch(f"{module_path}.get_session", AsyncMock(return_value=session)),
        patch(f"{module_path}.api_limiter.{limiter_name}", AsyncMock(return_value=None)),
        session,
    )


# ---------------------------------------------------------------------------
# base.py helpers
# ---------------------------------------------------------------------------


def test_validate_address_for_chain_evm():
    assert validate_address_for_chain(ADDR, "ethereum") is True
    assert validate_address_for_chain(ADDR, "arbitrum") is True
    assert validate_address_for_chain("not-an-address", "ethereum") is False
    assert validate_address_for_chain("0x" + "0" * 40, "ethereum") is False  # zero address


def test_validate_address_for_chain_cross_format_rejected():
    # An EVM address is not a valid Tron/Solana/Stellar/Sui address.
    assert validate_address_for_chain(ADDR, "tron") is False
    assert validate_address_for_chain(ADDR, "solana") is False
    assert validate_address_for_chain(ADDR, "stellar") is False
    assert validate_address_for_chain(ADDR, "sui") is False


def test_validate_address_for_chain_non_evm_formats():
    assert validate_address_for_chain(SOL_ADDR, "solana") is True
    assert validate_address_for_chain(TRON_ADDR, "tron") is True
    assert validate_address_for_chain(None, "ethereum") is False
    assert validate_address_for_chain("", "ethereum") is False


def test_normalize_amount_accepts_int_and_clean_str():
    assert normalize_amount(1000000) == "1000000"
    assert normalize_amount("1000000") == "1000000"


def test_normalize_amount_rejects_float():
    with pytest.raises(ValueError):
        normalize_amount(990000.0)
    with pytest.raises(ValueError):
        normalize_amount("990000.0")


def test_normalize_amount_rejects_negative():
    with pytest.raises(ValueError):
        normalize_amount(-5)


# ---------------------------------------------------------------------------
# NEAR Intents
# ---------------------------------------------------------------------------

_TOKENS_RESPONSE = [
    {"blockchain": "ethereum", "symbol": "USDC", "assetId": "nep141:eth-usdc.omft.near"},
    {"blockchain": "arbitrum", "symbol": "USDC", "assetId": "nep141:arb-usdc.omft.near"},
]


@pytest.mark.asyncio
async def test_near_intents_quote_parsing():
    provider = NearIntentsBridge()
    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = "test-key"
        mock_settings.near_intents_fee_recipient = None
        mock_settings.near_intents_fee_bps = 0

        quote_resp = _FakeResp(
            200,
            {
                "quote": {
                    "depositAddress": ADDR,
                    "amountOut": "990000",
                    "minAmountOut": "985000",
                    "timeEstimate": 45,
                    "feeUsd": 0.5,
                }
            },
        )
        tokens_resp = _FakeResp(200, _TOKENS_RESPONSE)
        p_sess, p_lim, _ = _patch(
            "bot.services.bridge.near_intents",
            get_map={"/v0/tokens": tokens_resp},
            post_map={"/v0/quote": quote_resp},
        )
        with p_sess, p_lim:
            quote = await provider.get_quote(
                from_chain="ethereum",
                to_chain="arbitrum",
                from_token="USDC",
                from_amount="1000000",
                from_address=ADDR,
            )

    assert quote is not None
    assert quote.settlement == "deposit_address"
    assert quote.deposit_address == ADDR
    assert quote.to_amount == "990000"
    assert quote.to_amount_min == "985000"  # provider min (985000) < floor (985050) -> min wins
    assert quote.transaction_request == {}
    assert quote.trust_model == "solver"


def test_near_intents_enabled_false_without_key():
    provider = NearIntentsBridge()
    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = None
        assert provider.enabled is False

        mock_settings.near_intents_api_key = "key"
        assert provider.enabled is True


@pytest.mark.asyncio
async def test_near_intents_get_quote_returns_none_when_disabled():
    provider = NearIntentsBridge()
    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = None
        result = await provider.get_quote(
            from_chain="ethereum",
            to_chain="arbitrum",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert result is None


@pytest.mark.asyncio
async def test_near_intents_get_quote_fails_closed_on_unresolved_asset():
    """No exact match in the /v0/tokens registry => None, never a guessed asset id."""
    provider = NearIntentsBridge()
    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = "test-key"
        mock_settings.near_intents_fee_recipient = None
        mock_settings.near_intents_fee_bps = 0

        tokens_resp = _FakeResp(200, [])  # empty registry, no match possible
        p_sess, p_lim, _ = _patch(
            "bot.services.bridge.near_intents", get_map={"/v0/tokens": tokens_resp}
        )
        with p_sess, p_lim:
            result = await provider.get_quote(
                from_chain="ethereum",
                to_chain="arbitrum",
                from_token="USDC",
                from_amount="1000000",
                from_address=ADDR,
            )
    assert result is None


@pytest.mark.asyncio
async def test_near_intents_uses_dry_true_for_quoting():
    """get_quote must send dry=True — never mint a live deposit intent while quoting."""
    provider = NearIntentsBridge()
    captured_bodies = []

    class _CapturingSession(_FakeSession):
        def post(self, url, json=None, headers=None):
            captured_bodies.append(json)
            return super().post(url, json=json, headers=headers)

    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = "test-key"
        mock_settings.near_intents_fee_recipient = None
        mock_settings.near_intents_fee_bps = 0

        quote_resp = _FakeResp(
            200,
            {"quote": {"depositAddress": ADDR, "amountOut": "990000", "minAmountOut": "985000"}},
        )
        tokens_resp = _FakeResp(200, _TOKENS_RESPONSE)
        session = _CapturingSession(
            get_map={"/v0/tokens": tokens_resp}, post_map={"/v0/quote": quote_resp}
        )
        with (
            patch("bot.services.bridge.near_intents.get_session", AsyncMock(return_value=session)),
            patch(
                "bot.services.bridge.near_intents.api_limiter.wait_and_acquire",
                AsyncMock(return_value=None),
            ),
        ):
            await provider.get_quote(
                from_chain="ethereum",
                to_chain="arbitrum",
                from_token="USDC",
                from_amount="1000000",
                from_address=ADDR,
            )

    assert len(captured_bodies) == 1
    assert captured_bodies[0]["dry"] is True


@pytest.mark.asyncio
async def test_near_intents_cross_format_to_address_rejected():
    provider = NearIntentsBridge()
    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = "test-key"
        mock_settings.near_intents_fee_recipient = None
        mock_settings.near_intents_fee_bps = 0

        result = await provider.get_quote(
            from_chain="ethereum",
            to_chain="arbitrum",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
            to_address=SOL_ADDR,  # Solana address for an EVM (arbitrum) destination
        )
    assert result is None


@pytest.mark.asyncio
async def test_near_intents_sanity_band_rejects_haircut_quote():
    provider = NearIntentsBridge()
    with patch("bot.services.bridge.near_intents.settings") as mock_settings:
        mock_settings.near_intents_api_key = "test-key"
        mock_settings.near_intents_fee_recipient = None
        mock_settings.near_intents_fee_bps = 0

        # amountOut is < 50% of from_amount -> must be rejected.
        quote_resp = _FakeResp(200, {"quote": {"depositAddress": ADDR, "amountOut": "400000"}})
        tokens_resp = _FakeResp(200, _TOKENS_RESPONSE)
        p_sess, p_lim, _ = _patch(
            "bot.services.bridge.near_intents",
            get_map={"/v0/tokens": tokens_resp},
            post_map={"/v0/quote": quote_resp},
        )
        with p_sess, p_lim:
            result = await provider.get_quote(
                from_chain="ethereum",
                to_chain="arbitrum",
                from_token="USDC",
                from_amount="1000000",
                from_address=ADDR,
            )
    assert result is None


# ---------------------------------------------------------------------------
# Allbridge
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_allbridge_quote_parsing():
    with patch("bot.services.bridge.allbridge_api.settings") as mock_settings:
        mock_settings.allbridge_bridge_enabled = True
        mock_settings.allbridge_api_url = "https://core.api.allbridgecoreapi.net"
        provider = AllbridgeBridge()
        resp_data = {
            "amountOut": "995000",
            "minAmountOut": "990000",
            "fee": {"usd": 1.2},
            "gasFeeUsd": 0.3,
            "estimatedTimeSeconds": 180,
            "tx": {"to": "0xBridgeContract", "data": "0xdeadbeef", "value": "0"},
        }
        p_sess, p_lim, _ = _patch("bot.services.bridge.allbridge_api", _FakeResp(200, resp_data))
        with p_sess, p_lim:
            quote = await provider.get_quote(
                from_chain="solana",
                to_chain="tron",
                from_token="USDC",
                from_amount="1000000",
                from_address=SOL_ADDR,
                to_address=TRON_ADDR,
            )

    assert quote is not None
    assert quote.to_amount == "995000"
    # provider min (990000) vs floor (995000 * 9950 // 10000 = 990025) -> min(990000, 990025)
    assert quote.to_amount_min == "990000"
    assert quote.fee_cost_usd == 1.2
    assert quote.gas_cost_usd == 0.3
    assert quote.settlement == "tx"
    assert quote.transaction_request["data"] == "0xdeadbeef"


def test_allbridge_disabled_by_default():
    assert AllbridgeBridge().enabled is False


def test_allbridge_enabled_when_flag_set():
    with patch("bot.services.bridge.allbridge_api.settings") as mock_settings:
        mock_settings.allbridge_bridge_enabled = True
        mock_settings.allbridge_api_url = "https://core.api.allbridgecoreapi.net"
        assert AllbridgeBridge().enabled is True


def test_allbridge_rejects_unsupported_chain():
    provider = AllbridgeBridge()
    assert provider.is_supported_route("madeupchain", "solana", "USDC") is False
    assert provider.is_supported_route("solana", "solana", "USDC") is False
    assert provider.is_supported_route("solana", "tron", "USDC") is True


@pytest.mark.asyncio
async def test_allbridge_cross_format_to_address_required():
    """No to_address and from_address doesn't match destination format => None."""
    with patch("bot.services.bridge.allbridge_api.settings") as mock_settings:
        mock_settings.allbridge_bridge_enabled = True
        mock_settings.allbridge_api_url = "https://core.api.allbridgecoreapi.net"
        provider = AllbridgeBridge()
        result = await provider.get_quote(
            from_chain="solana",
            to_chain="tron",
            from_token="USDC",
            from_amount="1000000",
            from_address=SOL_ADDR,  # not a valid Tron address, and no to_address given
        )
    assert result is None


@pytest.mark.asyncio
async def test_allbridge_zero_address_rejected():
    with patch("bot.services.bridge.allbridge_api.settings") as mock_settings:
        mock_settings.allbridge_bridge_enabled = True
        mock_settings.allbridge_api_url = "https://core.api.allbridgecoreapi.net"
        provider = AllbridgeBridge()
        result = await provider.get_quote(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
            to_address="0x" + "0" * 40,
        )
    assert result is None


@pytest.mark.asyncio
async def test_allbridge_float_amount_rejected():
    with patch("bot.services.bridge.allbridge_api.settings") as mock_settings:
        mock_settings.allbridge_bridge_enabled = True
        mock_settings.allbridge_api_url = "https://core.api.allbridgecoreapi.net"
        provider = AllbridgeBridge()
        result = await provider.get_quote(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            from_amount="1000000.0",  # float-shaped string must be rejected
            from_address=ADDR,
            to_address=ADDR2,
        )
    assert result is None


@pytest.mark.asyncio
async def test_allbridge_slippage_floor_never_exceeds_provider_min():
    """Even when the provider's own minAmountOut is generous, our local
    slippage floor must win if it's more conservative."""
    with patch("bot.services.bridge.allbridge_api.settings") as mock_settings:
        mock_settings.allbridge_bridge_enabled = True
        mock_settings.allbridge_api_url = "https://core.api.allbridgecoreapi.net"
        provider = AllbridgeBridge()
        resp_data = {
            "amountOut": "1000000",
            "minAmountOut": "999999",  # provider claims almost no slippage
            "fee": {"usd": 0},
            "gasFeeUsd": 0,
        }
        p_sess, p_lim, _ = _patch("bot.services.bridge.allbridge_api", _FakeResp(200, resp_data))
        with p_sess, p_lim:
            quote = await provider.get_quote(
                from_chain="ethereum",
                to_chain="polygon",
                from_token="USDC",
                from_amount="1000000",
                from_address=ADDR,
                to_address=ADDR2,
                slippage_bps=500,  # 5% — our floor should be 950000
            )
    assert quote is not None
    assert int(quote.to_amount_min) <= 999999
    assert int(quote.to_amount_min) == 950000


# ---------------------------------------------------------------------------
# Symbiosis
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_symbiosis_quote_parsing():
    with patch("bot.services.bridge.symbiosis_api.settings") as mock_settings:
        mock_settings.symbiosis_bridge_enabled = True
        provider = SymbiosisBridge()
        resp_data = {
            "tokenAmountOut": {"amount": "998000"},
            "tokenAmountOutMin": {"amount": "993000"},
            "tx": {"to": "0xSymbiosisRouter", "data": "0xfeedbeef", "value": "0"},
            "fee": {"usd": 0.8},
            "estimatedGasUsd": 0.4,
            "estimatedTime": 120,
        }
        p_sess, p_lim, _ = _patch("bot.services.bridge.symbiosis_api", _FakeResp(200, resp_data))
        with p_sess, p_lim:
            quote = await provider.get_quote(
                from_chain="ethereum",
                to_chain="polygon",
                from_token="USDC",
                from_amount="1000000",
                from_address=ADDR,
                to_address=ADDR2,
            )

    assert quote is not None
    assert quote.to_amount == "998000"
    assert quote.to_amount_min == "993000"
    assert quote.fee_cost_usd == 0.8
    assert quote.gas_cost_usd == 0.4
    assert quote.trust_model == "solver"


def test_symbiosis_disabled_by_default():
    assert SymbiosisBridge().enabled is False


def test_symbiosis_enabled_when_flag_set():
    with patch("bot.services.bridge.symbiosis_api.settings") as mock_settings:
        mock_settings.symbiosis_bridge_enabled = True
        assert SymbiosisBridge().enabled is True


def test_symbiosis_rejects_non_evm_chain():
    provider = SymbiosisBridge()
    # Solana chain_id is a string in bot.config.chains, not a numeric EVM id.
    assert provider.is_supported_route("solana", "ethereum", "USDC") is False
    assert provider.is_supported_route("ethereum", "polygon", "USDC") is True


@pytest.mark.asyncio
async def test_symbiosis_rejects_zero_slippage():
    with patch("bot.services.bridge.symbiosis_api.settings") as mock_settings:
        mock_settings.symbiosis_bridge_enabled = True
        provider = SymbiosisBridge()
        result = await provider.get_quote(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
            to_address=ADDR2,
            slippage_bps=0,
        )
    assert result is None


# ---------------------------------------------------------------------------
# Arbitrum native (canonical bridge)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_arbitrum_native_returns_none_when_disabled_by_default():
    provider = ArbitrumNativeBridge()
    assert provider.enabled is False
    quote = await provider.get_quote(
        from_chain="ethereum",
        to_chain="arbitrum",
        from_token="USDC",
        from_amount="1000000",
        from_address=ADDR,
    )
    assert quote is None


@pytest.mark.asyncio
async def test_arbitrum_native_returns_none_even_when_enabled_without_live_gas_params():
    """Enabling the flag alone must not be enough — get_quote still refuses
    to fabricate a quote until live L2 gas estimation is wired in."""
    with patch("bot.services.bridge.arbitrum_native.settings") as mock_settings:
        mock_settings.arbitrum_native_bridge_enabled = True
        provider = ArbitrumNativeBridge()
        assert provider.enabled is True
        quote = await provider.get_quote(
            from_chain="ethereum",
            to_chain="arbitrum",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is None


@pytest.mark.asyncio
async def test_arbitrum_native_withdrawal_direction_rejected():
    provider = ArbitrumNativeBridge()
    # Withdrawal (arbitrum -> ethereum) must never be offered as a route:
    # canonical L2->L1 withdrawals have a ~7-day challenge period.
    assert provider.is_supported_route("arbitrum", "ethereum", "USDC") is False

    quote = await provider.get_quote(
        from_chain="arbitrum",
        to_chain="ethereum",
        from_token="USDC",
        from_amount="1000000",
        from_address=ADDR,
    )
    assert quote is None


def test_arbitrum_native_build_deposit_transaction_requires_live_params():
    """build_deposit_transaction has no defaults for gas params and rejects
    non-positive values — a stale/zero value would revert on submission."""
    provider = ArbitrumNativeBridge()
    with pytest.raises(TypeError):
        provider.build_deposit_transaction(
            token_address=ADDR, recipient=ADDR2, amount="1000000"
        )  # missing required max_gas/gas_price_bid/max_submission_cost

    with pytest.raises(Exception):
        provider.build_deposit_transaction(
            token_address=ADDR,
            recipient=ADDR2,
            amount="1000000",
            max_gas=0,
            gas_price_bid=0,
            max_submission_cost=0,
        )


def test_arbitrum_native_build_deposit_transaction_correct_encoding():
    provider = ArbitrumNativeBridge()
    tx = provider.build_deposit_transaction(
        token_address=ADDR,
        recipient=ADDR2,
        amount="1000000",
        max_gas=300000,
        gas_price_bid=100000000,
        max_submission_cost=1000000000000,
    )
    assert tx["to"] == provider.gateway_router
    assert tx["data"].startswith("0x")
    # value must cover maxSubmissionCost + maxGas * gasPriceBid, not 0.
    assert tx["value"] == 1000000000000 + 300000 * 100000000
    assert tx["value"] > 0


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registry_races_and_survives_one_provider_raising():
    with patch(
        "bot.services.bridge.registry.BRIDGE_PROVIDERS",
        _build_fake_providers(),
    ):
        quotes = await get_bridge_quotes(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
        )

    # Only the two successful providers should survive; the raising one is
    # swallowed and logged, not propagated.
    assert len(quotes) == 2
    providers_seen = {q.provider for q in quotes}
    assert providers_seen == {"fake_high", "fake_low"}


@pytest.mark.asyncio
async def test_registry_sorts_best_output_first():
    with patch(
        "bot.services.bridge.registry.BRIDGE_PROVIDERS",
        _build_fake_providers(),
    ):
        best = await bridge_quote(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
        )

    assert best is not None
    assert best.provider == "fake_high"
    assert best.to_amount_min == "998000"


@pytest.mark.asyncio
async def test_registry_malformed_quote_does_not_kill_the_sort():
    """A quote with a garbage to_amount_min must not raise inside sort() and
    wipe out every other provider's legitimate route."""
    from bot.services.bridge.base import BridgeProvider, BridgeQuote

    class _FakeProviderMalformed(BridgeProvider):
        name = "fake_malformed"
        enabled = True

        def is_supported_route(self, from_chain, to_chain, token=None):
            return True

        async def get_quote(self, **kwargs):
            return BridgeQuote(
                provider="fake_malformed",
                from_chain=kwargs["from_chain"],
                to_chain=kwargs["to_chain"],
                from_token=kwargs["from_token"],
                to_token=kwargs["from_token"],
                from_amount=kwargs["from_amount"],
                to_amount="not-a-number",
                to_amount_min="also-not-a-number",
                gas_cost_usd=0.1,
                fee_cost_usd=0.1,
                estimated_time=60,
            )

        async def get_status(self, tracking_id):
            return {"status": "UNKNOWN"}

    providers = _build_fake_providers() + [_FakeProviderMalformed()]
    with patch("bot.services.bridge.registry.BRIDGE_PROVIDERS", providers):
        quotes = await get_bridge_quotes(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            from_amount="1000000",
            from_address=ADDR,
        )

    # All three quotes still come back (malformed one just sorts last), and
    # the legitimate best quote is still ranked first.
    assert len(quotes) == 3
    assert quotes[0].provider == "fake_high"


def _build_fake_providers():
    from bot.services.bridge.base import BridgeProvider, BridgeQuote

    class _FakeProviderHigh(BridgeProvider):
        name = "fake_high"
        enabled = True

        def is_supported_route(self, from_chain, to_chain, token=None):
            return True

        async def get_quote(self, **kwargs):
            return BridgeQuote(
                provider="fake_high",
                from_chain=kwargs["from_chain"],
                to_chain=kwargs["to_chain"],
                from_token=kwargs["from_token"],
                to_token=kwargs["from_token"],
                from_amount=kwargs["from_amount"],
                to_amount="999000",
                to_amount_min="998000",
                gas_cost_usd=0.1,
                fee_cost_usd=0.1,
                estimated_time=60,
            )

        async def get_status(self, tracking_id):
            return {"status": "UNKNOWN"}

    class _FakeProviderLow(BridgeProvider):
        name = "fake_low"
        enabled = True

        def is_supported_route(self, from_chain, to_chain, token=None):
            return True

        async def get_quote(self, **kwargs):
            return BridgeQuote(
                provider="fake_low",
                from_chain=kwargs["from_chain"],
                to_chain=kwargs["to_chain"],
                from_token=kwargs["from_token"],
                to_token=kwargs["from_token"],
                from_amount=kwargs["from_amount"],
                to_amount="900000",
                to_amount_min="890000",
                gas_cost_usd=0.1,
                fee_cost_usd=0.1,
                estimated_time=60,
            )

        async def get_status(self, tracking_id):
            return {"status": "UNKNOWN"}

    class _FakeProviderRaises(BridgeProvider):
        name = "fake_raises"
        enabled = True

        def is_supported_route(self, from_chain, to_chain, token=None):
            return True

        async def get_quote(self, **kwargs):
            raise RuntimeError("simulated provider failure")

        async def get_status(self, tracking_id):
            return {"status": "UNKNOWN"}

    return [_FakeProviderHigh(), _FakeProviderLow(), _FakeProviderRaises()]
