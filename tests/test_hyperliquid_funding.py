"""Tests for the HyperLiquid funding orchestrator — fully mocked, no network/db."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.services.hyperliquid_funding import (
    MIN_USDC_DEPOSIT,
    FundingError,
    HyperLiquidFundingService,
)
from bot.services.hyperunit_api import HyperUnitDepositAddress

HL_ADDR = "0x4444444444444444444444444444444444444444"
EVM_WALLET = "0x5555555555555555555555555555555555555555"


def _account(hl_address=HL_ADDR):
    return SimpleNamespace(hl_address=hl_address)


@pytest.mark.asyncio
async def test_quote_below_minimum_raises():
    svc = HyperLiquidFundingService()
    with pytest.raises(FundingError, match="Minimum deposit"):
        await svc.quote_usdc_deposit(
            user_id=1,
            from_chain="arbitrum",
            amount_human=MIN_USDC_DEPOSIT - 1,
            depositor_address=EVM_WALLET,
        )


@pytest.mark.asyncio
async def test_quote_without_account_raises():
    svc = HyperLiquidFundingService()
    with patch(
        "bot.services.hyperliquid_funding.perps_service.get_account",
        MagicMock(return_value=None),
    ):
        with pytest.raises(FundingError, match="No HyperLiquid account"):
            await svc.quote_usdc_deposit(
                user_id=1,
                from_chain="arbitrum",
                amount_human=50.0,
                depositor_address=EVM_WALLET,
            )


@pytest.mark.asyncio
async def test_quote_unsupported_chain_raises():
    svc = HyperLiquidFundingService()
    with patch(
        "bot.services.hyperliquid_funding.perps_service.get_account",
        MagicMock(return_value=_account()),
    ):
        with pytest.raises(FundingError, match="aren't supported"):
            await svc.quote_usdc_deposit(
                user_id=1,
                from_chain="dogechain",
                amount_human=50.0,
                depositor_address=EVM_WALLET,
            )


@pytest.mark.asyncio
async def test_quote_happy_path_credits_hl_address():
    svc = HyperLiquidFundingService()
    sentinel = object()
    mock_deposit = AsyncMock(return_value=sentinel)
    with (
        patch(
            "bot.services.hyperliquid_funding.perps_service.get_account",
            MagicMock(return_value=_account()),
        ),
        patch(
            "bot.services.hyperliquid_funding.across_api.get_hypercore_usdc_deposit",
            mock_deposit,
        ),
    ):
        out = await svc.quote_usdc_deposit(
            user_id=1,
            from_chain="arbitrum",
            amount_human=50.0,
            depositor_address=EVM_WALLET,
        )

    assert out is sentinel
    kwargs = mock_deposit.call_args.kwargs
    # Credits the user's HL account, signs from their EVM wallet, 50 USDC -> 6dp.
    assert kwargs["recipient"] == HL_ADDR
    assert kwargs["depositor"] == EVM_WALLET
    assert kwargs["amount"] == "50000000"
    assert kwargs["from_chain"] == "arbitrum"


@pytest.mark.asyncio
async def test_native_deposit_instructions():
    svc = HyperLiquidFundingService()
    gen = AsyncMock(
        return_value=HyperUnitDepositAddress(
            asset="btc",
            src_chain="bitcoin",
            hl_address=HL_ADDR,
            address="bc1qdeposit",
            signatures={"hl-node": "x"},
            min_amount=0.002,
            eta_seconds=1800,
        )
    )
    with (
        patch(
            "bot.services.hyperliquid_funding.perps_service.get_account",
            MagicMock(return_value=_account()),
        ),
        patch(
            "bot.services.hyperliquid_funding.hyperunit_api.generate_deposit_address",
            gen,
        ),
    ):
        out = await svc.get_native_deposit_instructions(user_id=1, asset="BTC")

    assert out.deposit_address == "bc1qdeposit"
    assert out.asset == "btc"
    assert out.min_amount == 0.002
    assert out.hl_address == HL_ADDR
    gen.assert_awaited_once_with("btc", HL_ADDR)


def test_native_minimum():
    svc = HyperLiquidFundingService()
    assert svc.native_minimum("eth") == 0.05
    assert svc.native_minimum("sol") == 0.1


@pytest.mark.asyncio
async def test_move_spot_to_perp_delegates():
    svc = HyperLiquidFundingService()
    transfer = AsyncMock(return_value=True)
    with patch("bot.services.hyperliquid_funding.perps_service.transfer_usd", transfer):
        ok = await svc.move_spot_to_perp(user_id=7, amount=25.0)
    assert ok is True
    transfer.assert_awaited_once_with(7, 25.0, to_perp=True)


@pytest.mark.asyncio
async def test_check_native_status_delegates():
    svc = HyperLiquidFundingService()
    sentinel = object()
    get_op = AsyncMock(return_value=sentinel)
    with patch("bot.services.hyperliquid_funding.hyperunit_api.get_operation", get_op):
        out = await svc.check_native_status("bc1qaddr")
    assert out is sentinel
    get_op.assert_awaited_once_with("bc1qaddr")
