"""Unit tests for SavingsService (Aave V3 USDC savings on Base) with mocked web3."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from bot.services.savings_service import (
    MAX_UINT256,
    SavingsError,
    SavingsPending,
    SavingsService,
    USDC_DECIMALS,
    _SentTx,
)


@pytest.fixture
def service():
    return SavingsService()


@pytest.fixture
def mock_web3():
    return MagicMock()


def _wallet(address="0x" + "11" * 20):
    wallet = MagicMock()
    wallet.address = address
    wallet.is_turnkey_wallet = False
    return wallet


class TestApy:
    def test_apy_parses_ray_liquidity_rate(self, service, mock_web3):
        # 5% APR in ray (1e27)
        reserve = [0] * 15
        reserve[2] = int(Decimal("0.05") * Decimal(10**27))
        pool = MagicMock()
        pool.functions.getReserveData.return_value.call.return_value = reserve
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_pool", return_value=pool),
        ):
            apy = service.get_apy()
        # 5% APR compounded per second ≈ 5.127% APY
        assert 5.0 < apy < 5.3

    def test_apy_read_failure_raises_user_safe_error(self, service):
        # `_failover` only routes through `_get_web3` when rpc_manager has no
        # warmed Base URLs; otherwise it builds real HTTP providers and makes a
        # LIVE call, bypassing the mock (order-dependent + real network). Force
        # the empty-url branch so this test is deterministic regardless of what
        # warmed rpc_manager earlier in the suite.
        with (
            patch("bot.services.rpc_manager.rpc_manager.get_all_urls", return_value=[]),
            patch.object(service, "_get_web3", side_effect=ConnectionError("rpc down")),
        ):
            with pytest.raises(SavingsError):
                service.get_apy()


class TestPosition:
    def test_position_converts_atoken_balance(self, service, mock_web3):
        erc20 = MagicMock()
        erc20.functions.balanceOf.return_value.call.return_value = 123_456_789  # 123.456789
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_erc20", return_value=erc20),
        ):
            position = service.get_position("0x" + "22" * 20)
        assert position == Decimal("123.456789")


class TestDeposit:
    def _erc20_mock(self, balance_wei, allowance_wei):
        erc20 = MagicMock()
        erc20.functions.balanceOf.return_value.call.return_value = balance_wei
        erc20.functions.allowance.return_value.call.return_value = allowance_wei
        return erc20

    def test_deposit_skips_approve_when_allowance_sufficient(self, service, mock_web3):
        amount = Decimal("100")
        amount_wei = int(amount * 10**USDC_DECIMALS)
        erc20 = self._erc20_mock(balance_wei=amount_wei * 2, allowance_wei=amount_wei * 2)
        pool = MagicMock()
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_erc20", return_value=erc20),
            patch.object(service, "_pool", return_value=pool),
            patch.object(service, "_build_and_send", return_value="0xsupplyhash") as send,
        ):
            tx_hashes = service.deposit(_wallet(), amount)
        assert tx_hashes == ["0xsupplyhash"]
        assert send.call_count == 1  # supply only, no approve
        erc20.functions.approve.assert_not_called()

    def test_deposit_approves_first_when_allowance_insufficient(self, service, mock_web3):
        amount = Decimal("100")
        amount_wei = int(amount * 10**USDC_DECIMALS)
        erc20 = self._erc20_mock(balance_wei=amount_wei * 2, allowance_wei=0)
        pool = MagicMock()
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_erc20", return_value=erc20),
            patch.object(service, "_pool", return_value=pool),
            patch.object(service, "_build_and_send", side_effect=["0xapprove", "0xsupply"]) as send,
        ):
            tx_hashes = service.deposit(_wallet(), amount)
        assert tx_hashes == ["0xapprove", "0xsupply"]
        assert send.call_count == 2

    def test_deposit_insufficient_balance(self, service, mock_web3):
        erc20 = self._erc20_mock(balance_wei=1_000_000, allowance_wei=0)  # 1 USDC
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_erc20", return_value=erc20),
        ):
            with pytest.raises(SavingsError, match="Insufficient USDC"):
                service.deposit(_wallet(), Decimal("100"))

    def test_deposit_rejects_non_positive_amount(self, service):
        with pytest.raises(SavingsError, match="greater than zero"):
            service.deposit(_wallet(), Decimal("0"))


class TestWithdraw:
    def test_withdraw_all_uses_max_uint_sentinel(self, service, mock_web3):
        pool = MagicMock()
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_pool", return_value=pool),
            patch.object(service, "_build_and_send", return_value="0xwithdraw"),
        ):
            tx_hash = service.withdraw(_wallet(), None)
        assert tx_hash == "0xwithdraw"
        args = pool.functions.withdraw.call_args[0]
        assert args[1] == MAX_UINT256

    def test_withdraw_partial_checks_position(self, service, mock_web3):
        erc20 = MagicMock()
        erc20.functions.balanceOf.return_value.call.return_value = 1_000_000  # 1 USDC saved
        with (
            patch.object(service, "_get_web3", return_value=mock_web3),
            patch.object(service, "_erc20", return_value=erc20),
        ):
            with pytest.raises(SavingsError, match="Insufficient savings"):
                service.withdraw(_wallet(), Decimal("100"))
