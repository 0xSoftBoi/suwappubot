"""
Tests for RPC fallback logic in wallet balance checking.

Tests _get_web3() fallback, _invalidate_web3(), and balance retry patterns.
"""

import pytest
from unittest.mock import patch, MagicMock, PropertyMock, AsyncMock

from bot.services.wallet import WalletService
from bot.config.chains import ChainType


@pytest.fixture
def wallet_service():
    return WalletService()


def _make_web3_mock(connected=True, balance=1_000_000_000_000_000_000):
    """Create a mock Web3 instance."""
    mock = MagicMock()
    if connected:
        mock.eth.block_number = 12345
    else:
        type(mock.eth).block_number = PropertyMock(side_effect=ConnectionError("RPC down"))
    mock.eth.get_balance.return_value = balance
    mock.to_checksum_address = MagicMock(side_effect=lambda x: x)
    return mock


class TestFirstRpcWorks:
    """First URL responds -> cached and returned."""

    def test_first_rpc_cached(self, wallet_service):
        mock_chain = MagicMock()
        mock_chain.chain_type = ChainType.EVM

        with patch("bot.services.wallet.get_chain_by_name", return_value=mock_chain):
            with patch("bot.services.wallet.settings") as mock_settings:
                mock_settings.ethereum_rpc_url = "http://rpc1.example.com"

                mock_web3 = _make_web3_mock()
                with patch("bot.services.wallet.Web3", return_value=mock_web3):
                    result = wallet_service._get_web3("ethereum")
                    assert result is mock_web3

                    # Second call returns cached instance
                    result2 = wallet_service._get_web3("ethereum")
                    assert result2 is result


class TestFirstFailsSecondWorks:
    """First URL raises -> second URL used."""

    def test_fallback_to_second(self, wallet_service):
        mock_chain = MagicMock()
        mock_chain.chain_type = ChainType.EVM

        good_web3 = _make_web3_mock(connected=True)
        bad_web3 = _make_web3_mock(connected=False)

        call_count = [0]

        def web3_factory(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return bad_web3
            return good_web3

        with patch("bot.services.wallet.get_chain_by_name", return_value=mock_chain):
            with patch("bot.services.wallet.settings") as mock_settings:
                mock_settings.ethereum_rpc_url = "http://bad.rpc,http://good.rpc"

                with patch("bot.services.wallet.Web3", side_effect=web3_factory):
                    with patch("random.shuffle"):  # Don't shuffle, keep order
                        result = wallet_service._get_web3("ethereum")
                        assert result is good_web3


class TestInvalidateClearsCache:
    """_invalidate_web3('ethereum') -> next call creates fresh instance."""

    def test_invalidate(self, wallet_service):
        # Pre-populate cache
        mock_web3 = _make_web3_mock()
        wallet_service._web3_instances["ethereum"] = mock_web3

        wallet_service._invalidate_web3("ethereum")
        assert "ethereum" not in wallet_service._web3_instances


class TestTokenBalanceRetryOnFailure:
    """First balanceOf fails -> invalidate -> retry succeeds."""

    @pytest.mark.asyncio
    async def test_retry_on_failure(self, wallet_service):
        calls = [0]

        def balance_of_call():
            calls[0] += 1
            if calls[0] == 1:
                raise ConnectionError("RPC timeout")
            return 5_000_000  # 5 USDC (6 decimals)

        mock_contract = MagicMock()
        mock_contract.functions.balanceOf.return_value.call = balance_of_call

        mock_web3 = _make_web3_mock()
        mock_web3.eth.contract.return_value = mock_contract

        with patch.object(wallet_service, "_get_web3", return_value=mock_web3):
            with patch.object(wallet_service, "_invalidate_web3"):
                with patch("bot.services.wallet.get_token_address", return_value="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"):
                    with patch("bot.services.wallet.get_token_decimals", return_value=6):
                        with patch("bot.services.wallet.Web3") as mock_Web3:
                            mock_Web3.to_checksum_address = lambda x: x

                            result = await wallet_service.get_evm_token_balance(
                                "ethereum", "USDC", "0xuser"
                            )
                            assert result == 5.0


class TestTokenBalanceBothFailReturnsZero:
    """Both attempts fail -> returns 0.0."""

    @pytest.mark.asyncio
    async def test_both_fail(self, wallet_service):
        mock_contract = MagicMock()
        mock_contract.functions.balanceOf.return_value.call = MagicMock(
            side_effect=ConnectionError("RPC down")
        )

        mock_web3 = _make_web3_mock()
        mock_web3.eth.contract.return_value = mock_contract

        with patch.object(wallet_service, "_get_web3", return_value=mock_web3):
            with patch.object(wallet_service, "_invalidate_web3"):
                with patch("bot.services.wallet.get_token_address", return_value="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"):
                    with patch("bot.services.wallet.get_token_decimals", return_value=6):
                        with patch("bot.services.wallet.Web3") as mock_Web3:
                            mock_Web3.to_checksum_address = lambda x: x

                            result = await wallet_service.get_evm_token_balance(
                                "ethereum", "USDC", "0xuser"
                            )
                            assert result == 0.0


class TestNativeBalanceRetry:
    """Same retry pattern for get_evm_native_balance."""

    @pytest.mark.asyncio
    async def test_native_retry(self, wallet_service):
        calls = [0]

        def get_balance_side_effect(addr):
            calls[0] += 1
            if calls[0] == 1:
                raise ConnectionError("timeout")
            return 2_000_000_000_000_000_000  # 2 ETH

        mock_web3 = MagicMock()
        mock_web3.eth.get_balance = get_balance_side_effect

        mock_chain = MagicMock()
        mock_chain.native_decimals = 18

        with patch.object(wallet_service, "_get_web3", return_value=mock_web3):
            with patch.object(wallet_service, "_invalidate_web3"):
                with patch("bot.services.wallet.get_chain_by_name", return_value=mock_chain):
                    with patch("bot.services.wallet.Web3") as mock_Web3:
                        mock_Web3.to_checksum_address = lambda x: x

                        result = await wallet_service.get_evm_native_balance(
                            "ethereum", "0xuser"
                        )
                        assert result == 2.0


class TestZeroAddressRoutesToNative:
    """BNB 0x000...000 -> calls get_evm_native_balance."""

    @pytest.mark.asyncio
    async def test_zero_address(self, wallet_service):
        with patch("bot.services.wallet.get_token_address", return_value="0x0000000000000000000000000000000000000000"):
            with patch.object(wallet_service, "get_evm_native_balance", new_callable=AsyncMock, return_value=1.5):
                result = await wallet_service.get_evm_token_balance(
                    "bsc", "BNB", "0xuser"
                )
                assert result == 1.5
                wallet_service.get_evm_native_balance.assert_called_once_with("bsc", "0xuser")
