"""Regression tests for perps money-path fixes."""

import pytest
from decimal import Decimal
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from bot.services.perps_service import PerpsService
from bot.models.perps import PerpPosition, HyperLiquidAccount


@pytest.fixture
def perps_service():
    return PerpsService()


@pytest.fixture
def mock_account():
    return HyperLiquidAccount(
        id=1,
        user_id=123,
        hl_address="0x123abc",
        api_key_encrypted="key",
        api_secret_encrypted="secret",
        is_active=True,
    )


@pytest.fixture
def mock_position():
    return PerpPosition(
        id=1,
        user_id=123,
        exchange="hyperliquid",
        market="ETH-USD",
        side="long",
        size=Decimal("1.5"),
        entry_price=Decimal("2000"),
        mark_price=Decimal("2000"),
        leverage=2,
        status="open",
    )


@pytest.mark.asyncio
async def test_modify_tp_sl_places_orders_on_exchange(perps_service, mock_account, mock_position):
    """Test that modify_tp_sl actually places orders on HyperLiquid (was stubbed before)."""
    with patch.object(perps_service, "get_account", return_value=mock_account):
        with patch.object(perps_service, "_decrypt_credentials", return_value=("key", "secret")):
            with patch.object(perps_service._client, "place_order") as mock_place:
                mock_place.return_value = MagicMock(order_id="order123", status="pending")
                with patch("bot.services.perps_service.get_session"):
                    # This would have failed before the fix (no order placed)
                    await perps_service.modify_tp_sl(
                        user_id=123, position_id=1, tp_price=2500.0, sl_price=1500.0
                    )
                    # Verify orders were actually placed (2 calls: TP + SL)
                    assert mock_place.call_count == 2


@pytest.mark.asyncio
async def test_place_tp_sl_propagates_errors(perps_service, mock_account):
    """Test that _place_tp_sl propagates errors (was silently logged before)."""
    with patch.object(perps_service, "_decrypt_credentials", return_value=("key", "secret")):
        with patch.object(perps_service._client, "place_order") as mock_place:
            # Simulate HyperLiquid rejection
            mock_place.return_value = None
            # Before fix: would log and return silently
            # After fix: raises Exception
            with pytest.raises(Exception, match="Failed to place"):
                await perps_service._place_tp_sl(
                    user_id=123,
                    account=mock_account,
                    market="ETH-USD",
                    side="long",
                    size=1.5,
                    order_type="take_profit",
                    price=2500.0,
                    position_id=1,
                )


@pytest.mark.asyncio
async def test_get_positions_syncs_with_exchange(perps_service):
    """Test that get_positions syncs with HyperLiquid before returning (detects liquidations)."""
    with patch.object(perps_service, "sync_positions") as mock_sync:
        with patch("bot.services.perps_service.get_session"):
            await perps_service.get_positions(user_id=123)
            # Verify sync was called before returning
            mock_sync.assert_called_once_with(123)


@pytest.mark.asyncio
async def test_modify_tp_sl_validates_price_ranges(perps_service):
    """Test that modify_tp_sl validates price ranges before any action."""
    # Negative TP price should raise before any DB/HyperLiquid action
    with pytest.raises(ValueError, match="TP price must be positive"):
        await perps_service.modify_tp_sl(user_id=123, position_id=1, tp_price=-100.0)

    # Zero SL price should raise
    with pytest.raises(ValueError, match="SL price must be positive"):
        await perps_service.modify_tp_sl(user_id=123, position_id=1, sl_price=0.0)


@pytest.mark.asyncio
async def test_get_position_syncs_before_returning(perps_service):
    """Test that get_position (singular) also syncs with HyperLiquid before returning."""
    with patch.object(perps_service, "sync_positions") as mock_sync:
        with patch("bot.services.perps_service.get_session"):
            await perps_service.get_position(user_id=123, position_id=1)
            # Verify sync was called
            mock_sync.assert_called_once_with(123)
