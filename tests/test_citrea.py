"""Tests for Citrea (Bitcoin ZK rollup) + JuiceSwap direct routing.

Covers:
- bot/config/chains.py    — "citrea" ChainConfig (4114, native cBTC 18dp)
- bot/config/tokens.py    — Citrea token addresses + decimals (WcBTC 18dp)
- bot/services/rpc_manager.py — CHAINLIST_IDS entry
- bot/services/univ3_fork_api.py — JuiceSwap venue config (V1-style SwapRouter,
  deadline INSIDE ExactInputSingleParams, no multicall), gas headroom +15%
- bot/services/swap_engine.py  — routing guards (citrea pair → juiceswap;
  citrea ↔ other chain cross-chain raises SwapError)

All web3 interaction is mocked — no network.
"""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

# ---------------------------------------------------------------------------
# chain config
# ---------------------------------------------------------------------------

from bot.config.chains import CHAINS, ChainType, get_chain_by_id, get_chain_by_name


class TestCitreaChainConfig:
    def test_citrea_chain_present(self):
        assert "citrea" in CHAINS

    def test_citrea_is_evm(self):
        assert CHAINS["citrea"].chain_type == ChainType.EVM

    def test_citrea_chain_id(self):
        assert CHAINS["citrea"].chain_id == 4114
        assert get_chain_by_id(4114).name == "citrea"

    def test_citrea_native_token_cbtc_18_decimals(self):
        # Citrea's native gas token is cBTC with ETH-style 18 decimals (NOT 8)
        assert CHAINS["citrea"].native_token == "cBTC"
        assert CHAINS["citrea"].native_decimals == 18

    def test_citrea_no_lifi_id(self):
        # No aggregator supports Citrea — must never route through aggregators
        assert CHAINS["citrea"].lifi_chain_id is None

    def test_citrea_rpc_env_and_explorer(self):
        assert CHAINS["citrea"].rpc_url_env == "CITREA_RPC_URL"
        assert "citrea.xyz" in CHAINS["citrea"].explorer_url

    def test_get_chain_by_name(self):
        assert get_chain_by_name("Citrea").chain_id == 4114


class TestCitreaSettingsAndRpc:
    def test_settings_default_rpc(self):
        from bot.config.settings import settings

        assert settings.citrea_rpc_url == "https://rpc.mainnet.citrea.xyz"

    def test_chainlist_id(self):
        from bot.services.rpc_manager import CHAINLIST_IDS

        assert CHAINLIST_IDS["citrea"] == 4114


# ---------------------------------------------------------------------------
# tokens
# ---------------------------------------------------------------------------

from bot.config.tokens import get_token_address, get_token_decimals


class TestCitreaTokens:
    def test_wcbtc_address_and_decimals(self):
        assert get_token_address("WCBTC", "citrea") == "0x3100000000000000000000000000000000000006"
        # WcBTC wraps native cBTC which is 18 decimals on Citrea (not 8 like WBTC)
        assert get_token_decimals("WCBTC", "citrea") == 18

    def test_native_cbtc_placeholder(self):
        assert get_token_address("BTC", "citrea") == "0x0000000000000000000000000000000000000000"
        assert get_token_decimals("BTC", "citrea") == 18

    def test_wbtc_bridged_8_decimals(self):
        assert get_token_address("WBTC", "citrea") == "0xDF240DC08B0FdaD1d93b74d5048871232f6BEA3d"
        assert get_token_decimals("WBTC", "citrea") == 8

    def test_stables_6_decimals(self):
        assert get_token_decimals("USDT", "citrea") == 6
        assert get_token_decimals("usdc", "CITREA") == 6
        assert get_token_decimals("CTUSD", "citrea") == 6


# ---------------------------------------------------------------------------
# univ3_fork_api — JuiceSwap venue
# ---------------------------------------------------------------------------

from bot.services.univ3_fork_api import (
    CITREA_VENUE,
    FEE_TIERS,
    ROUTER_V1_DEADLINE_IN_PARAMS,
    UniV3ForkAPI,
    UniV3ForkError,
    UniV3ForkQuote,
    compute_min_out,
    juiceswap_api,
)

USDC_CITREA = "0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839"
WCBTC_CITREA = "0x3100000000000000000000000000000000000006"


class TestJuiceSwapVenueConfig:
    def test_venue_identity(self):
        assert CITREA_VENUE.name == "juiceswap"
        assert CITREA_VENUE.chain_name == "citrea"
        assert CITREA_VENUE.chain_id == 4114

    def test_router_and_quoter_addresses(self):
        assert CITREA_VENUE.router_address == "0x565eD3D57fe40f78A46f348C220121AE093c3cF8"
        assert CITREA_VENUE.quoter_address == "0x428f20dd8926Eabe19653815Ed0BE7D6c36f8425"

    def test_router_style_is_v1_deadline_in_struct(self):
        assert CITREA_VENUE.router_style == ROUTER_V1_DEADLINE_IN_PARAMS

    def test_wrapped_native_is_wcbtc(self):
        assert CITREA_VENUE.wrapped_native_address == WCBTC_CITREA
        assert CITREA_VENUE.wrapped_native_symbol == "WCBTC"

    def test_module_singleton_uses_citrea_venue(self):
        assert juiceswap_api.venue is CITREA_VENUE


class TestCitreaGasHeadroom:
    def test_headroom_is_15_percent(self):
        # Citrea L1 (Bitcoin DA) fee surcharge is NOT in eth_estimateGas
        assert CITREA_VENUE.gas_headroom_pct == 15

    def test_apply_gas_headroom_multiplies(self):
        assert juiceswap_api.apply_gas_headroom(200_000) == 230_000
        assert juiceswap_api.apply_gas_headroom(100) == 115

    def test_goat_has_no_headroom(self):
        from bot.services.univ3_fork_api import GOAT_VENUE

        api = UniV3ForkAPI(GOAT_VENUE)
        assert api.apply_gas_headroom(200_000) == 200_000


def _quote(native_in=False, amount_in=None):
    return UniV3ForkQuote(
        token_in=WCBTC_CITREA if native_in else USDC_CITREA,
        token_out=USDC_CITREA if native_in else WCBTC_CITREA,
        amount_in=amount_in or (10**18 if native_in else 10**6),
        amount_out=10**6,
        fee_tier=3000,
        native_in=native_in,
    )


class TestJuiceSwapTxConstruction:
    """JuiceSwap uses the ORIGINAL V1 SwapRouter: the deadline lives INSIDE
    ExactInputSingleParams and there is NO multicall wrapper."""

    def test_swap_tx_calls_exact_input_single_directly(self):
        tx = juiceswap_api.build_swap_tx(
            _quote(), recipient=USDC_CITREA, amount_out_min=990_000, deadline=1_700_000_000
        )
        assert tx["to"].lower() == CITREA_VENUE.router_address.lower()
        # V1 exactInputSingle (8-field struct incl. deadline) selector
        assert tx["data"].startswith("0x414bf389")
        # No multicall(uint256,bytes[]) wrapper
        assert not tx["data"].startswith("0x5ae401dc")
        assert tx["value"] == 0

    def test_deadline_encoded_in_struct(self):
        deadline = 1_700_000_000
        tx = juiceswap_api.build_swap_tx(
            _quote(), recipient=USDC_CITREA, amount_out_min=1, deadline=deadline
        )
        # The deadline is ABI-encoded as a 32-byte word inside the calldata
        word = hex(deadline)[2:].rjust(64, "0")
        assert word in tx["data"].lower()

    def test_struct_param_shape_matches_v1_abi(self):
        # The V1 ABI struct must carry the deadline between recipient and amountIn
        from bot.services.univ3_fork_api import SWAP_ROUTER_V1_ABI

        components = SWAP_ROUTER_V1_ABI[0]["inputs"][0]["components"]
        names = [c["name"] for c in components]
        assert names == [
            "tokenIn",
            "tokenOut",
            "fee",
            "recipient",
            "deadline",
            "amountIn",
            "amountOutMinimum",
            "sqrtPriceLimitX96",
        ]

    def test_native_cbtc_in_sends_value(self):
        tx = juiceswap_api.build_swap_tx(
            _quote(native_in=True), recipient=USDC_CITREA, amount_out_min=1
        )
        assert tx["value"] == 10**18

    def test_approve_tx_targets_juiceswap_router(self):
        tx = juiceswap_api.build_approve_tx(USDC_CITREA, 123_456)
        assert tx["to"].lower() == USDC_CITREA.lower()
        assert tx["data"].startswith("0x095ea7b3")
        assert CITREA_VENUE.router_address.lower()[2:] in tx["data"].lower()


class TestJuiceSwapQuote:
    def _make_mock_web3(self, fee_outputs):
        quoter = MagicMock()
        calls = []

        def qeis(params):
            calls.append(params)
            fee = params[3]
            fn = MagicMock()
            out = fee_outputs.get(fee)
            if out is None or isinstance(out, Exception):
                fn.call.side_effect = out or Exception("no pool")
            else:
                fn.call.return_value = (out, 0, 1, 123_456)
            return fn

        quoter.functions.quoteExactInputSingle.side_effect = qeis
        w3 = MagicMock()
        w3.eth.contract.return_value = quoter
        w3._quoter_calls = calls
        return w3

    def test_tries_all_fee_tiers_and_picks_best(self):
        w3 = self._make_mock_web3({500: 900, 3000: 1_200, 10000: 1_000})
        q = asyncio.run(juiceswap_api.get_quote(USDC_CITREA, WCBTC_CITREA, 10**6, web3=w3))
        assert len(w3._quoter_calls) == len(FEE_TIERS)
        assert q.fee_tier == 3000
        assert q.amount_out == 1_200

    def test_native_in_normalized_to_wcbtc(self):
        w3 = self._make_mock_web3({3000: 1_000})
        q = asyncio.run(
            juiceswap_api.get_quote(
                "0x0000000000000000000000000000000000000000", USDC_CITREA, 10**18, web3=w3
            )
        )
        assert q.token_in.lower() == WCBTC_CITREA.lower()
        assert q.native_in is True

    def test_native_out_rejected(self):
        w3 = self._make_mock_web3({3000: 1_000})
        with pytest.raises(UniV3ForkError):
            asyncio.run(
                juiceswap_api.get_quote(
                    USDC_CITREA,
                    "0x0000000000000000000000000000000000000000",
                    10**6,
                    web3=w3,
                )
            )

    def test_no_pool_raises(self):
        w3 = self._make_mock_web3({})
        with pytest.raises(UniV3ForkError):
            asyncio.run(juiceswap_api.get_quote(USDC_CITREA, WCBTC_CITREA, 10**6, web3=w3))


class TestMinOut:
    def test_one_percent(self):
        assert compute_min_out(1_000_000, 100) == 990_000


# ---------------------------------------------------------------------------
# swap_engine routing guards
# ---------------------------------------------------------------------------


class TestCitreaRouting:
    @pytest.fixture
    def engine(self):
        from bot.services.swap_engine import SwapEngine

        return SwapEngine.__new__(SwapEngine)

    def test_citrea_pair_is_citrea_swap(self, engine):
        assert engine._is_citrea_swap("citrea", "citrea") is True
        assert engine._is_citrea_swap("CITREA", "Citrea") is True

    def test_citrea_to_evm_is_not_citrea_swap(self, engine):
        assert engine._is_citrea_swap("citrea", "ethereum") is False
        assert engine._is_citrea_swap("ethereum", "citrea") is False
        assert engine._is_citrea_swap("ethereum", "ethereum") is False

    def test_citrea_cross_chain_detection(self, engine):
        assert engine._is_citrea_cross_chain("citrea", "ethereum") is True
        assert engine._is_citrea_cross_chain("base", "citrea") is True
        assert engine._is_citrea_cross_chain("citrea", "citrea") is False
        assert engine._is_citrea_cross_chain("base", "base") is False

    def test_citrea_quote_routes_to_juiceswap(self, engine):
        """_get_juiceswap_quote builds a provider='juiceswap' SwapQuote from a
        mocked JuiceSwap quote (no network)."""
        js_quote = UniV3ForkQuote(
            token_in=USDC_CITREA,
            token_out=WCBTC_CITREA,
            amount_in=10_000_000,
            amount_out=3 * 10**15,
            fee_tier=500,
            native_in=False,
        )
        with patch(
            "bot.services.univ3_fork_api.juiceswap_api.get_quote",
            new=AsyncMock(return_value=js_quote),
        ):
            quote = asyncio.run(engine._get_juiceswap_quote("USDC", "WCBTC", 10.0, "10000000", 100))
        assert quote.provider == "juiceswap"
        assert quote.from_chain == "citrea"
        assert quote.to_chain == "citrea"
        assert int(quote.to_amount_min) == 3 * 10**15 * 9_900 // 10_000
        assert quote.raw_quote["fee_tier"] == 500

    def test_citrea_cross_chain_get_quote_raises(self, engine):
        from bot.services.swap_engine import SwapError

        with pytest.raises(SwapError, match="Citrea"):
            asyncio.run(
                engine.get_quote(
                    from_chain="citrea",
                    to_chain="ethereum",
                    from_token="USDT",
                    to_token="USDT",
                    amount=10.0,
                    from_address="0x0000000000000000000000000000000000000001",
                )
            )

    def test_evm_to_citrea_cross_chain_also_raises(self, engine):
        from bot.services.swap_engine import SwapError

        with pytest.raises(SwapError, match="Citrea"):
            asyncio.run(
                engine.get_quote(
                    from_chain="base",
                    to_chain="citrea",
                    from_token="USDC",
                    to_token="USDC",
                    amount=10.0,
                    from_address="0x0000000000000000000000000000000000000001",
                )
            )


class TestCitreaExecuteSwapGuard:
    """The hard guard at the START of execute_swap must reject any citrea quote
    whose provider is not juiceswap — before locks, DB work, or fund movement."""

    def _forged(self, provider, from_chain, to_chain):
        from bot.services.swap_engine import SwapQuote

        return SwapQuote(
            provider=provider,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token="USDC",
            to_token="WCBTC",
            from_amount="10000000",
            from_amount_human=10.0,
            to_amount="1",
            to_amount_human=0.001,
            to_amount_min="1",
            gas_cost_usd=0.0,
            fee_cost_usd=0.0,
            total_cost_usd=0.0,
            estimated_time=5,
            price_impact=0.0,
            exchange_rate=0.0001,
            raw_quote={},
        )

    def test_forged_lifi_citrea_quote_rejected(self):
        from bot.services.swap_engine import SwapEngine, SwapError

        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="Citrea swaps must route via JuiceSwap"):
            asyncio.run(
                engine.execute_swap(
                    quote=self._forged("lifi", "citrea", "citrea"), wallet_id=1, user_id=1
                )
            )

    def test_citrea_to_chain_also_guarded(self):
        from bot.services.swap_engine import SwapEngine, SwapError

        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="Citrea swaps must route via JuiceSwap"):
            asyncio.run(
                engine.execute_swap(
                    quote=self._forged("0x", "ethereum", "citrea"), wallet_id=1, user_id=1
                )
            )
