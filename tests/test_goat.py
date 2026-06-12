"""Tests for GOAT Network (Bitcoin L2) + GOATSwap direct routing.

Covers:
- bot/config/chains.py    — "goat" ChainConfig presence + EVM type
- bot/config/tokens.py    — GOAT token addresses + decimals (18dp native BTC)
- bot/services/rpc_manager.py — CHAINLIST_IDS entry
- bot/services/goatswap_api.py — quoter calldata construction, fee tier
  selection (best quote wins), min-out slippage math, native BTC handling
- bot/services/swap_engine.py  — routing guards (goat pair → goatswap;
  goat ↔ other chain cross-chain raises SwapError)

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


class TestGoatChainConfig:
    def test_goat_chain_present(self):
        assert "goat" in CHAINS

    def test_goat_is_evm(self):
        assert CHAINS["goat"].chain_type == ChainType.EVM

    def test_goat_chain_id(self):
        assert CHAINS["goat"].chain_id == 2345
        assert get_chain_by_id(2345).name == "goat"

    def test_goat_native_token_btc_18_decimals(self):
        # GOAT's native gas token is BTC with ETH-style 18 decimals
        assert CHAINS["goat"].native_token == "BTC"
        assert CHAINS["goat"].native_decimals == 18

    def test_goat_no_lifi_id(self):
        # Li.Fi does not support GOAT — must never route through aggregators
        assert CHAINS["goat"].lifi_chain_id is None

    def test_goat_rpc_env_and_explorer(self):
        assert CHAINS["goat"].rpc_url_env == "GOAT_RPC_URL"
        assert "explorer.goat.network" in CHAINS["goat"].explorer_url

    def test_get_chain_by_name(self):
        assert get_chain_by_name("GOAT").chain_id == 2345


class TestGoatSettingsAndRpc:
    def test_settings_default_rpc(self):
        from bot.config.settings import settings

        assert settings.goat_rpc_url == "https://rpc.goat.network"

    def test_chainlist_id(self):
        from bot.services.rpc_manager import CHAINLIST_IDS

        assert CHAINLIST_IDS["goat"] == 2345


# ---------------------------------------------------------------------------
# tokens
# ---------------------------------------------------------------------------

from bot.config.tokens import get_token_address, get_token_decimals


class TestGoatTokens:
    def test_wgbtc_address_and_decimals(self):
        assert get_token_address("WGBTC", "goat") == "0xbC10000000000000000000000000000000000000"
        # WGBTC wraps native BTC which has 18 decimals on GOAT (not 8 like WBTC)
        assert get_token_decimals("WGBTC", "goat") == 18

    def test_native_btc_placeholder(self):
        assert get_token_address("BTC", "goat") == "0x0000000000000000000000000000000000000000"
        assert get_token_decimals("BTC", "goat") == 18

    def test_usdt(self):
        assert get_token_address("USDT", "goat") == "0xE1AD845D93853fff44990aE0DcecD8575293681e"
        assert get_token_decimals("USDT", "goat") == 6

    def test_usdc_e(self):
        assert get_token_address("USDC", "goat") == "0x3022b87ac063DE95b1570F46f5e470F8B53112D8"
        assert get_token_decimals("USDC", "goat") == 6

    def test_weth(self):
        assert get_token_address("WETH", "goat") == "0x3a1293Bdb83bBbDd5Ebf4fAc96605aD2021BbC0f"
        assert get_token_decimals("WETH", "goat") == 18


# ---------------------------------------------------------------------------
# goatswap_api
# ---------------------------------------------------------------------------

from bot.services.goatswap_api import (
    FEE_TIERS,
    GOATSWAP_QUOTER_V2,
    GOATSWAP_SWAP_ROUTER02,
    WGBTC_ADDRESS,
    GoatSwapAPI,
    GoatSwapError,
    GoatSwapQuote,
    compute_min_out,
)

USDT_GOAT = "0xE1AD845D93853fff44990aE0DcecD8575293681e"
WETH_GOAT = "0x3a1293Bdb83bBbDd5Ebf4fAc96605aD2021BbC0f"


def make_mock_web3(fee_outputs):
    """Mock Web3 whose QuoterV2 returns per-fee-tier amounts.

    fee_outputs: dict fee_tier -> amount_out int, or Exception to simulate a
    missing pool. Records the params tuples passed to quoteExactInputSingle.
    """
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


class TestQuoterCalldataConstruction:
    def test_params_tuple_passed_to_quoter(self):
        w3 = make_mock_web3({3000: 1_000})
        api = GoatSwapAPI()
        asyncio.get_event_loop().run_until_complete(
            api.get_quote(USDT_GOAT, WETH_GOAT, 5_000_000, web3=w3)
        )
        # one call per fee tier
        assert len(w3._quoter_calls) == len(FEE_TIERS)
        tried_fees = sorted(c[3] for c in w3._quoter_calls)
        assert tried_fees == sorted(FEE_TIERS)
        for params in w3._quoter_calls:
            token_in, token_out, amount_in, fee, sqrt_limit = params
            assert token_in.lower() == USDT_GOAT.lower()
            assert token_out.lower() == WETH_GOAT.lower()
            assert amount_in == 5_000_000
            assert sqrt_limit == 0

    def test_quoter_contract_address(self):
        w3 = make_mock_web3({3000: 1_000})
        api = GoatSwapAPI()
        asyncio.get_event_loop().run_until_complete(
            api.get_quote(USDT_GOAT, WETH_GOAT, 1_000, web3=w3)
        )
        _, kwargs = w3.eth.contract.call_args
        assert kwargs["address"].lower() == GOATSWAP_QUOTER_V2.lower()


class TestFeeTierSelection:
    def _quote(self, fee_outputs, token_in=USDT_GOAT, token_out=WETH_GOAT, amount=10**6):
        w3 = make_mock_web3(fee_outputs)
        api = GoatSwapAPI()
        return asyncio.get_event_loop().run_until_complete(
            api.get_quote(token_in, token_out, amount, web3=w3)
        )

    def test_picks_best_output_across_tiers(self):
        q = self._quote({500: 900, 3000: 1_200, 10000: 1_000})
        assert q.fee_tier == 3000
        assert q.amount_out == 1_200

    def test_500_tier_wins_when_best(self):
        q = self._quote({500: 5_000, 3000: 4_000, 10000: 1})
        assert q.fee_tier == 500
        assert q.amount_out == 5_000

    def test_skips_missing_pools(self):
        q = self._quote({500: Exception("no pool"), 3000: Exception("no pool"), 10000: 777})
        assert q.fee_tier == 10000
        assert q.amount_out == 777

    def test_all_pools_missing_raises(self):
        with pytest.raises(GoatSwapError):
            self._quote({})

    def test_zero_amount_in_raises(self):
        with pytest.raises(GoatSwapError):
            self._quote({3000: 1_000}, amount=0)

    def test_native_btc_in_normalized_to_wgbtc(self):
        q = self._quote({3000: 1_000}, token_in="0x0000000000000000000000000000000000000000")
        assert q.token_in.lower() == WGBTC_ADDRESS.lower()
        assert q.native_in is True

    def test_native_btc_out_rejected(self):
        with pytest.raises(GoatSwapError):
            self._quote({3000: 1_000}, token_out="0x0000000000000000000000000000000000000000")


class TestMinOutSlippageMath:
    def test_one_percent(self):
        # 100 bps = 1% → 1_000_000 * 0.99
        assert compute_min_out(1_000_000, 100) == 990_000

    def test_half_percent(self):
        assert compute_min_out(1_000_000, 50) == 995_000

    def test_zero_slippage(self):
        assert compute_min_out(12_345, 0) == 12_345

    def test_floors_not_rounds(self):
        # 999 * 9950 / 10000 = 994.005 → 994
        assert compute_min_out(999, 50) == 994

    def test_zero_quote_raises(self):
        with pytest.raises(GoatSwapError):
            compute_min_out(0, 100)


class TestSwapTxConstruction:
    def _quote(self, native_in=False):
        return GoatSwapQuote(
            token_in=WGBTC_ADDRESS if native_in else USDT_GOAT,
            token_out=WETH_GOAT,
            amount_in=10**18 if native_in else 10**6,
            amount_out=10**6,
            fee_tier=3000,
            native_in=native_in,
        )

    def test_erc20_swap_tx(self):
        api = GoatSwapAPI()
        tx = api.build_swap_tx(
            self._quote(), recipient=USDT_GOAT, amount_out_min=990_000, deadline=1_700_000_000
        )
        assert tx["to"].lower() == GOATSWAP_SWAP_ROUTER02.lower()
        assert tx["value"] == 0
        # multicall(uint256,bytes[]) selector
        assert tx["data"].startswith("0x5ae401dc")
        # exactInputSingle selector embedded in the inner call
        assert "04e45aaf" in tx["data"]

    def test_native_in_sends_value(self):
        api = GoatSwapAPI()
        tx = api.build_swap_tx(self._quote(native_in=True), recipient=USDT_GOAT, amount_out_min=1)
        assert tx["value"] == 10**18

    def test_approve_tx_exact_amount(self):
        api = GoatSwapAPI()
        tx = api.build_approve_tx(USDT_GOAT, 123_456)
        assert tx["to"].lower() == USDT_GOAT.lower()
        assert tx["value"] == 0
        # approve(address,uint256) selector + router as spender + exact amount
        assert tx["data"].startswith("0x095ea7b3")
        assert GOATSWAP_SWAP_ROUTER02.lower()[2:] in tx["data"].lower()
        assert hex(123_456)[2:] in tx["data"]


# ---------------------------------------------------------------------------
# swap_engine routing guards
# ---------------------------------------------------------------------------


class TestGoatRouting:
    @pytest.fixture
    def engine(self):
        from bot.services.swap_engine import SwapEngine

        return SwapEngine.__new__(SwapEngine)

    def test_goat_pair_is_goat_swap(self, engine):
        assert engine._is_goat_swap("goat", "goat") is True
        assert engine._is_goat_swap("GOAT", "Goat") is True

    def test_goat_to_evm_is_not_goat_swap(self, engine):
        assert engine._is_goat_swap("goat", "ethereum") is False
        assert engine._is_goat_swap("ethereum", "goat") is False
        assert engine._is_goat_swap("ethereum", "ethereum") is False

    def test_goat_cross_chain_detection(self, engine):
        assert engine._is_goat_cross_chain("goat", "ethereum") is True
        assert engine._is_goat_cross_chain("base", "goat") is True
        assert engine._is_goat_cross_chain("goat", "goat") is False
        assert engine._is_goat_cross_chain("base", "base") is False

    def test_goat_quote_routes_to_goatswap(self, engine):
        """_get_goatswap_quote builds a provider='goatswap' SwapQuote from a
        mocked GOATSwap quote (no network)."""
        gs_quote = GoatSwapQuote(
            token_in=USDT_GOAT,
            token_out=WETH_GOAT,
            amount_in=10_000_000,
            amount_out=3 * 10**15,
            fee_tier=500,
            native_in=False,
        )
        with patch(
            "bot.services.goatswap_api.goatswap_api.get_quote",
            new=AsyncMock(return_value=gs_quote),
        ):
            quote = asyncio.get_event_loop().run_until_complete(
                engine._get_goatswap_quote("USDT", "WETH", 10.0, "10000000", 100)
            )
        assert quote.provider == "goatswap"
        assert quote.from_chain == "goat"
        assert quote.to_chain == "goat"
        # min-out applies 100 bps slippage to the quoted output
        assert int(quote.to_amount_min) == 3 * 10**15 * 9_900 // 10_000
        assert quote.raw_quote["fee_tier"] == 500
        assert quote.raw_quote["suwappu_slippage_bps"] == 100

    def test_goat_quote_unknown_token_raises(self, engine):
        from bot.services.swap_engine import SwapError

        with pytest.raises(SwapError):
            asyncio.get_event_loop().run_until_complete(
                engine._get_goatswap_quote("DOGE", "WETH", 1.0, "1000000", 100)
            )

    def test_goat_cross_chain_get_quote_raises(self, engine):
        from bot.services.swap_engine import SwapError

        with pytest.raises(SwapError, match="GOAT"):
            asyncio.get_event_loop().run_until_complete(
                engine.get_quote(
                    from_chain="goat",
                    to_chain="ethereum",
                    from_token="USDT",
                    to_token="USDT",
                    amount=10.0,
                    from_address="0x0000000000000000000000000000000000000001",
                )
            )


class TestGoatDecimalsOverride:
    """Chain-specific decimals pins for GOAT (defensive — mirror of BSC override)."""

    def test_usdt_usdc_6_on_goat(self):
        assert get_token_decimals("USDT", "goat") == 6
        assert get_token_decimals("usdc", "GOAT") == 6

    def test_wgbtc_weth_18_on_goat(self):
        assert get_token_decimals("WGBTC", "goat") == 18
        assert get_token_decimals("WETH", "goat") == 18


class TestGoatExecuteSwapGuard:
    """The hard guard at the START of execute_swap must reject any goat quote
    whose provider is not goatswap — before locks, DB work, or fund movement."""

    def test_forged_lifi_goat_quote_rejected(self):
        from bot.services.swap_engine import SwapEngine, SwapError, SwapQuote

        engine = SwapEngine.__new__(SwapEngine)
        forged = SwapQuote(
            provider="lifi",  # forged: aggregators do not support GOAT
            from_chain="goat",
            to_chain="goat",
            from_token="USDT",
            to_token="WETH",
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
        with pytest.raises(SwapError, match="GOAT swaps must route via GOATSwap"):
            asyncio.get_event_loop().run_until_complete(
                engine.execute_swap(quote=forged, wallet_id=1, user_id=1)
            )

    def test_goat_to_chain_also_guarded(self):
        from bot.services.swap_engine import SwapEngine, SwapError, SwapQuote

        engine = SwapEngine.__new__(SwapEngine)
        forged = SwapQuote(
            provider="0x",
            from_chain="ethereum",
            to_chain="goat",
            from_token="USDT",
            to_token="WETH",
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
        with pytest.raises(SwapError, match="GOAT swaps must route via GOATSwap"):
            asyncio.get_event_loop().run_until_complete(
                engine.execute_swap(quote=forged, wallet_id=1, user_id=1)
            )
