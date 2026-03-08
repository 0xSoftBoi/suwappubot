"""
Tests for Stargate V2 / LayerZero integration in the swap engine.

Tests is_layerzero_route, quote generation, fallback, and execution.
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from dataclasses import dataclass

from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.services.layerzero_api import LayerZeroAPI, LayerZeroQuote


@pytest.fixture
def swap_engine():
    """SwapEngine with mocked sub-providers."""
    with patch("bot.services.swap_engine.cow_api"), \
         patch("bot.services.swap_engine.socket_api"), \
         patch("bot.services.swap_engine.jito_api"):
        engine = SwapEngine()
    return engine


@pytest.fixture
def sample_lz_quote():
    return LayerZeroQuote(
        src_chain="base",
        dst_chain="ethereum",
        token_symbol="USDC",
        amount_in="100000000",
        amount_out="99500000",
        amount_out_min="99000000",
        native_fee="1000000000000000",
        native_fee_usd=2.50,
        estimated_time=120,
        pool_address="0xpool",
        dst_eid=30101,
        raw_data={"native_fee": "1000000000000000"},
    )


class TestIsLayerZeroRouteSameTokenCrossChain:
    """USDC Base->Ethereum -> True."""

    def test_same_token_cross_chain(self, swap_engine):
        with patch.object(swap_engine.layerzero, "is_supported_route", return_value=True):
            result = swap_engine._is_layerzero_route("base", "ethereum", "USDC", "USDC")
            assert result is True


class TestIsLayerZeroRouteDifferentTokens:
    """USDC->ETH -> False."""

    def test_different_tokens(self, swap_engine):
        result = swap_engine._is_layerzero_route("base", "ethereum", "USDC", "ETH")
        assert result is False


class TestGetLayerZeroQuoteReturnsValidQuote:
    """Mocked quoteSend -> valid SwapQuote with provider='layerzero'."""

    @pytest.mark.asyncio
    async def test_valid_quote(self, swap_engine, sample_lz_quote):
        with patch.object(swap_engine.layerzero, "get_quote", new_callable=AsyncMock, return_value=sample_lz_quote):
            with patch.object(swap_engine, "_get_token_amount_raw", return_value="100000000"):
                with patch.object(swap_engine, "_get_token_amount_human", return_value=99.5):
                    quote = await swap_engine._get_layerzero_quote(
                        from_chain="base",
                        to_chain="ethereum",
                        token="USDC",
                        amount=100.0,
                        amount_raw="100000000",
                        from_address="0xsender",
                        slippage=0.5,
                    )

                    assert quote.provider == "layerzero"
                    assert quote.from_chain == "base"
                    assert quote.to_chain == "ethereum"
                    assert quote.gas_cost_usd == 2.50


class TestLayerZeroQuoteFailsFallsBackToLifi:
    """Stargate raises -> get_quote falls back to LiFi."""

    @pytest.mark.asyncio
    async def test_fallback_to_lifi(self, swap_engine):
        lifi_quote = SwapQuote(
            provider="lifi",
            from_chain="base",
            to_chain="ethereum",
            from_token="USDC",
            to_token="USDC",
            from_amount="100000000",
            from_amount_human=100.0,
            to_amount="99000000",
            to_amount_human=99.0,
            to_amount_min="98500000",
            gas_cost_usd=5.0,
            fee_cost_usd=0.5,
            total_cost_usd=5.5,
            estimated_time=300,
            price_impact=0.1,
            exchange_rate=0.99,
            raw_quote={},
        )

        with patch.object(swap_engine, "_is_layerzero_route", return_value=True):
            with patch.object(swap_engine, "_is_solana_only_swap", return_value=False):
                with patch.object(swap_engine, "_get_layerzero_quote", new_callable=AsyncMock, side_effect=Exception("quoteSend reverted")):
                    with patch.object(swap_engine, "_get_lifi_quote", new_callable=AsyncMock, return_value=lifi_quote):
                        with patch.object(swap_engine, "_get_token_amount_raw", return_value="100000000"):
                            # Bypass cache
                            from bot.services.swap_engine import quote_cache
                            with patch.object(quote_cache, "get", new_callable=AsyncMock, return_value=None):
                                with patch.object(quote_cache, "set", new_callable=AsyncMock):
                                    result = await swap_engine.get_quote(
                                        from_chain="base",
                                        to_chain="ethereum",
                                        from_token="USDC",
                                        to_token="USDC",
                                        amount=100.0,
                                        from_address="0xsender",
                                    )

                                    assert result.provider == "lifi"
                                    swap_engine._get_lifi_quote.assert_called_once()


class TestExecuteLayerZeroSwapBuildsCorrectTx:
    """Builds sendToken tx with correct params, sends via web3."""

    @pytest.mark.asyncio
    async def test_execute_builds_tx(self, swap_engine):
        from bot.models.user import Wallet

        wallet = Wallet(
            id=1, user_id=1, address="0xsender",
            wallet_provider="local", chain_type="evm",
        )

        quote = SwapQuote(
            provider="layerzero",
            from_chain="base",
            to_chain="ethereum",
            from_token="USDC",
            to_token="USDC",
            from_amount="100000000",
            from_amount_human=100.0,
            to_amount="99500000",
            to_amount_human=99.5,
            to_amount_min="99000000",
            gas_cost_usd=2.5,
            fee_cost_usd=0,
            total_cost_usd=2.5,
            estimated_time=120,
            price_impact=0,
            exchange_rate=1.0,
            raw_quote={"native_fee": "1000000000000000"},
        )

        mock_web3 = MagicMock()
        mock_web3.eth.gas_price = 1_000_000_000
        mock_web3.eth.get_transaction_count.return_value = 5
        mock_web3.eth.send_raw_transaction.return_value = b"\xab" * 32
        mock_web3.eth.estimate_gas.return_value = 300_000
        mock_web3.eth.wait_for_transaction_receipt.return_value = {"status": 1, "blockNumber": 12345}

        tx_bundle = {
            "approval_tx": {
                "to": "0xtoken",
                "data": "0xapprovedata",
            },
            "send_tx": {
                "to": "0xpool",
                "data": "0xsenddata",
                "value": 1_000_000_000_000_000,
            },
        }

        mock_chain = MagicMock()
        mock_chain.chain_id = 8453

        with patch.object(swap_engine, "_get_wallet_for_signing", return_value=wallet):
            with patch.object(swap_engine, "_get_web3_with_fallback", return_value=mock_web3):
                with patch("bot.services.swap_engine.get_chain_by_name", return_value=mock_chain):
                    with patch.object(swap_engine.layerzero, "get_pool_address", return_value="0xpool"):
                        with patch.object(swap_engine.layerzero, "get_dst_eid", return_value=30101):
                            with patch.object(swap_engine.layerzero, "build_send_transaction", return_value=tx_bundle):
                                with patch.object(swap_engine.wallet_service, "sign_evm_transaction", new_callable=AsyncMock, return_value="0x" + "ab" * 32):
                                    with patch("bot.services.swap_engine.Web3") as mock_Web3:
                                        mock_Web3.to_checksum_address = lambda x: x

                                        result = await swap_engine._execute_layerzero_swap(
                                            quote, {"id": 1, "address": "0xsender"}
                                        )

                                        # Should have signed 2 transactions (approve + send)
                                        assert swap_engine.wallet_service.sign_evm_transaction.call_count == 2
                                        assert isinstance(result, str)


class TestExecuteSwapWithTurnkeyWalletSigning:
    """Full execute with Turnkey wallet -> sign_evm_transaction called correctly."""

    @pytest.mark.asyncio
    async def test_turnkey_execution(self, swap_engine, mock_wallet_turnkey):
        quote = SwapQuote(
            provider="layerzero",
            from_chain="ethereum",
            to_chain="base",
            from_token="USDC",
            to_token="USDC",
            from_amount="50000000",
            from_amount_human=50.0,
            to_amount="49500000",
            to_amount_human=49.5,
            to_amount_min="49000000",
            gas_cost_usd=3.0,
            fee_cost_usd=0,
            total_cost_usd=3.0,
            estimated_time=120,
            price_impact=0,
            exchange_rate=1.0,
            raw_quote={"native_fee": "2000000000000000"},
        )

        mock_web3 = MagicMock()
        mock_web3.eth.gas_price = 1_000_000_000
        mock_web3.eth.get_transaction_count.return_value = 0
        mock_web3.eth.send_raw_transaction.return_value = b"\xcd" * 32
        mock_web3.eth.estimate_gas.return_value = 250_000

        tx_bundle = {
            "send_tx": {
                "to": "0xpool",
                "data": "0xsenddata",
                "value": 2_000_000_000_000_000,
            },
        }

        mock_chain = MagicMock()
        mock_chain.chain_id = 1

        with patch.object(swap_engine, "_get_wallet_for_signing", return_value=mock_wallet_turnkey):
            with patch.object(swap_engine, "_get_web3_with_fallback", return_value=mock_web3):
                with patch("bot.services.swap_engine.get_chain_by_name", return_value=mock_chain):
                    with patch.object(swap_engine.layerzero, "get_pool_address", return_value="0xpool"):
                        with patch.object(swap_engine.layerzero, "get_dst_eid", return_value=30184):
                            with patch.object(swap_engine.layerzero, "build_send_transaction", return_value=tx_bundle):
                                with patch.object(swap_engine.wallet_service, "sign_evm_transaction", new_callable=AsyncMock, return_value="0x" + "cd" * 32):
                                    with patch("bot.services.swap_engine.Web3") as mock_Web3:
                                        mock_Web3.to_checksum_address = lambda x: x

                                        result = await swap_engine._execute_layerzero_swap(
                                            quote, {"id": 2, "address": "0xabcdef"}
                                        )

                                        # sign_evm_transaction should receive the turnkey wallet
                                        sign_call = swap_engine.wallet_service.sign_evm_transaction.call_args_list[0]
                                        assert sign_call[0][0] is mock_wallet_turnkey
