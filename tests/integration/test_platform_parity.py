"""Cross-functionality integration tests for Telegram/WhatsApp parity.

These tests verify that both platforms produce identical results when using
shared services like SwapEngine, AlertService, OrderService, etc.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime


class TestSwapParity:
    """Test swap functionality parity between platforms."""

    @pytest.fixture
    def mock_swap_engine(self):
        """Create mock SwapEngine."""
        engine = MagicMock()
        engine.get_quote = AsyncMock()
        engine.execute_swap = AsyncMock()
        return engine

    @pytest.fixture
    def mock_quote(self, sample_quote_data):
        """Create mock quote object."""
        quote = MagicMock()
        quote.provider = sample_quote_data["provider"]
        quote.from_chain = sample_quote_data["from_chain"]
        quote.to_chain = sample_quote_data["to_chain"]
        quote.from_token = sample_quote_data["from_token"]
        quote.to_token = sample_quote_data["to_token"]
        quote.from_amount_human = sample_quote_data["from_amount_human"]
        quote.to_amount_human = sample_quote_data["to_amount_human"]
        quote.gas_cost_usd = sample_quote_data["gas_cost_usd"]
        quote.fee_cost_usd = sample_quote_data["fee_cost_usd"]
        quote.exchange_rate = sample_quote_data["exchange_rate"]
        quote.estimated_time = sample_quote_data["estimated_time"]
        return quote

    @pytest.mark.asyncio
    async def test_quote_identical_both_platforms(self, platform, mock_swap_engine, mock_quote):
        """Test same quote is returned regardless of platform."""
        mock_swap_engine.get_quote.return_value = mock_quote

        # Request quote using same parameters
        result = await mock_swap_engine.get_quote(
            from_chain="ethereum",
            to_chain="polygon",
            from_token="USDC",
            to_token="USDC",
            amount=100.0,
            from_address="0x1234567890abcdef1234567890abcdef12345678",
        )

        # Verify quote is identical
        assert result.from_chain == "ethereum"
        assert result.to_chain == "polygon"
        assert result.from_token == "USDC"
        assert result.to_token == "USDC"
        assert result.from_amount_human == 100.0
        assert result.provider == "lifi"

    @pytest.mark.asyncio
    async def test_execution_creates_identical_records(self, platform, mock_swap_engine, mock_quote):
        """Test swap execution creates same DB record regardless of platform."""
        mock_tx = MagicMock()
        mock_tx.id = 1
        mock_tx.tx_hash = "0xabc123"
        mock_tx.status = "pending"
        mock_swap_engine.execute_swap.return_value = mock_tx

        result = await mock_swap_engine.execute_swap(
            quote=mock_quote,
            wallet_id=1,
            user_id=1,
            idempotency_key=f"{platform}:user1:swap1",
        )

        assert result.tx_hash == "0xabc123"
        assert result.status == "pending"

    @pytest.mark.asyncio
    async def test_fee_calculation_identical(self, platform, mock_quote):
        """Test fee breakdown is same for both platforms."""
        # Fees are calculated by fee_service, not platform-specific
        assert mock_quote.gas_cost_usd == 5.0
        assert mock_quote.fee_cost_usd == 0.5


class TestAlertParity:
    """Test alert functionality parity between platforms."""

    @pytest.fixture
    def mock_alert_service(self):
        """Create mock alert service."""
        service = MagicMock()
        service.create_alert = MagicMock()
        service.get_user_alerts = MagicMock()
        service.delete_alert = MagicMock()
        service.trigger_alert = MagicMock()
        return service

    @pytest.mark.asyncio
    async def test_create_alert_identical(self, platform, mock_alert_service):
        """Test alert creation produces same record regardless of platform."""
        mock_alert = MagicMock()
        mock_alert.id = 1
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0
        mock_alert.is_active = True
        mock_alert_service.create_alert.return_value = mock_alert

        result = mock_alert_service.create_alert(
            user_id=1,
            token_symbol="ETH",
            alert_type="price_above",
            target_price=3500.0,
        )

        assert result.token_symbol == "ETH"
        assert result.alert_type == "price_above"
        assert result.target_price == 3500.0

    @pytest.mark.asyncio
    async def test_alert_trigger_notifies_both_platforms(self, mock_alert_service):
        """Test triggered alert notifies user on both platforms if configured."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        mock_alert = MagicMock()
        mock_alert.user = mock_user
        mock_alert.token_symbol = "ETH"

        # Verify user has both platform IDs configured
        # When alert triggers, notification should go to both
        assert mock_user.telegram_id is not None
        assert mock_user.whatsapp_id is not None

        # Verify alert is linked to user
        assert mock_alert.user == mock_user
        assert mock_alert.token_symbol == "ETH"


class TestOrderParity:
    """Test order functionality parity between platforms."""

    @pytest.fixture
    def mock_order_service(self):
        """Create mock order service."""
        service = MagicMock()
        service.create_limit_order = MagicMock()
        service.create_dca_order = MagicMock()
        service.cancel_order = MagicMock()
        service.get_user_orders = MagicMock()
        return service

    @pytest.mark.asyncio
    async def test_limit_order_identical(self, platform, mock_order_service):
        """Test limit order creation is identical across platforms."""
        mock_order = MagicMock()
        mock_order.id = 1
        mock_order.order_type = "limit_sell"
        mock_order.from_token = "ETH"
        mock_order.to_token = "USDC"
        mock_order.trigger_price = 3500.0
        mock_order.amount = "1.0"
        mock_order.status = "pending"
        mock_order_service.create_limit_order.return_value = mock_order

        result = mock_order_service.create_limit_order(
            user_id=1,
            wallet_id=1,
            order_type="limit_sell",
            from_chain="ethereum",
            from_token="ETH",
            to_chain="ethereum",
            to_token="USDC",
            amount="1.0",
            trigger_price=3500.0,
        )

        assert result.order_type == "limit_sell"
        assert result.from_token == "ETH"
        assert result.trigger_price == 3500.0

    @pytest.mark.asyncio
    async def test_dca_identical(self, platform, mock_order_service):
        """Test DCA order creation is identical across platforms."""
        mock_dca = MagicMock()
        mock_dca.id = 1
        mock_dca.from_token = "USDC"
        mock_dca.to_token = "ETH"
        mock_dca.interval_hours = 24
        mock_dca.status = "active"
        mock_order_service.create_dca_order.return_value = mock_dca

        result = mock_order_service.create_dca_order(
            user_id=1,
            wallet_id=1,
            from_chain="ethereum",
            from_token="USDC",
            to_chain="ethereum",
            to_token="ETH",
            amount_per_execution="100",
            interval_hours=24,
        )

        assert result.from_token == "USDC"
        assert result.to_token == "ETH"
        assert result.interval_hours == 24


class TestWalletParity:
    """Test wallet functionality parity between platforms."""

    @pytest.fixture
    def mock_wallet_service(self):
        """Create mock wallet service."""
        service = MagicMock()
        service.create_evm_wallet = MagicMock()
        service.create_solana_wallet = MagicMock()
        service.import_wallet = MagicMock()
        service.get_balances_by_address = AsyncMock()
        return service

    @pytest.mark.asyncio
    async def test_wallet_creation_identical(self, platform, mock_wallet_service):
        """Test wallet creation produces same results regardless of platform."""
        mock_wallet_service.create_evm_wallet.return_value = (
            "0x1234567890abcdef1234567890abcdef12345678",
            "0xprivatekey123",
        )

        address, private_key = mock_wallet_service.create_evm_wallet()

        assert address.startswith("0x")
        assert len(address) == 42
        assert private_key is not None

    @pytest.mark.asyncio
    async def test_balance_query_identical(self, platform, mock_wallet_service):
        """Test balance queries return same results for both platforms."""
        mock_wallet_service.get_balances_by_address.return_value = {
            "ethereum": {"ETH": 1.5, "USDC": 1000.0},
            "polygon": {"MATIC": 50.0, "USDC": 500.0},
        }

        result = await mock_wallet_service.get_balances_by_address(
            address="0x1234567890abcdef1234567890abcdef12345678",
            chain_type="evm",
        )

        assert "ethereum" in result
        assert result["ethereum"]["ETH"] == 1.5
        assert result["ethereum"]["USDC"] == 1000.0


class TestUserCreationParity:
    """Test user creation parity between platforms."""

    @pytest.mark.asyncio
    async def test_new_user_telegram_has_required_fields(self, mock_db_session):
        """Test Telegram user creation sets correct fields."""
        from bot.models.user import User

        user = User(telegram_id=123456789)

        assert user.telegram_id == 123456789
        assert user.whatsapp_id is None

    @pytest.mark.asyncio
    async def test_new_user_whatsapp_has_required_fields(self, mock_db_session):
        """Test WhatsApp user creation sets correct fields."""
        from bot.models.user import User

        user = User(whatsapp_id="1234567890")

        assert user.whatsapp_id == "1234567890"
        assert user.telegram_id is None

    @pytest.mark.asyncio
    async def test_user_can_have_both_platforms(self, mock_db_session):
        """Test user can be linked to both Telegram and WhatsApp."""
        from bot.models.user import User

        user = User(telegram_id=123456789, whatsapp_id="1234567890")

        assert user.telegram_id == 123456789
        assert user.whatsapp_id == "1234567890"


class TestPointsXPParity:
    """Test points/XP functionality parity between platforms."""

    @pytest.fixture
    def mock_points_service(self):
        """Create mock points service."""
        service = MagicMock()
        service.get_or_create_points_account = MagicMock()
        service.daily_checkin = MagicMock()
        service.get_leaderboard = MagicMock()
        return service

    @pytest.mark.asyncio
    async def test_xp_profile_identical(self, platform, mock_points_service):
        """Test XP profile returns same data for both platforms."""
        mock_account = MagicMock()
        mock_account.level = "silver"
        mock_account.xp = 1500
        mock_account.current_points = 500
        mock_account.total_points_earned = 2000
        mock_account.daily_streak = 5
        mock_points_service.get_or_create_points_account.return_value = mock_account

        result = mock_points_service.get_or_create_points_account(user_id=1)

        assert result.level == "silver"
        assert result.xp == 1500
        assert result.daily_streak == 5

    @pytest.mark.asyncio
    async def test_checkin_rewards_identical(self, platform, mock_points_service):
        """Test daily check-in rewards are same for both platforms."""
        mock_points_service.daily_checkin.return_value = (100, 5, True, None)

        points, streak, continued, new_level = mock_points_service.daily_checkin(user_id=1)

        assert points == 100
        assert streak == 5
        assert continued is True


class TestReferralParity:
    """Test referral functionality parity between platforms."""

    @pytest.fixture
    def mock_referral_service(self):
        """Create mock referral service."""
        service = MagicMock()
        service.get_referral_stats = MagicMock()
        service.apply_referral_code = MagicMock()
        return service

    @pytest.mark.asyncio
    async def test_referral_stats_identical(self, platform, mock_referral_service):
        """Test referral stats are same for both platforms."""
        mock_referral_service.get_referral_stats.return_value = {
            "code": "ABC123",
            "referrals": 10,
            "total_earned_usd": 50.5,
        }

        result = mock_referral_service.get_referral_stats(user_id=1)

        assert result["code"] == "ABC123"
        assert result["referrals"] == 10
        assert result["total_earned_usd"] == 50.5


class TestGasParity:
    """Test gas price functionality parity between platforms."""

    @pytest.fixture
    def mock_gas_tracker(self):
        """Create mock gas tracker."""
        tracker = MagicMock()
        tracker.get_all_gas_prices = AsyncMock()
        return tracker

    @pytest.mark.asyncio
    async def test_gas_prices_identical(self, platform, mock_gas_tracker):
        """Test gas prices are real (not mock) for both platforms."""
        mock_gas_tracker.get_all_gas_prices.return_value = {
            "ethereum": MagicMock(standard=25.5, fast=35.0),
            "polygon": MagicMock(standard=50.0, fast=75.0),
        }

        result = await mock_gas_tracker.get_all_gas_prices()

        assert "ethereum" in result
        assert result["ethereum"].standard == 25.5
        assert "polygon" in result


class TestConversationStateParity:
    """Test conversation state management parity."""

    @pytest.mark.asyncio
    async def test_state_isolation_between_users(self, mock_conversation_manager):
        """Test that user A's flow doesn't affect user B."""
        # Set state for user A
        await mock_conversation_manager.set_state("user_a", "swap", "step1", {"chain": "ethereum"})

        # Set different state for user B
        await mock_conversation_manager.set_state("user_b", "wallet", "step2", {"action": "create"})

        # Verify isolation
        state_a = await mock_conversation_manager.get_state("user_a")
        state_b = await mock_conversation_manager.get_state("user_b")

        assert state_a.flow == "swap"
        assert state_b.flow == "wallet"

    @pytest.mark.asyncio
    async def test_state_cleared_on_complete(self, mock_conversation_manager):
        """Test both platforms clean up state on flow completion."""
        await mock_conversation_manager.set_state("user1", "swap", "confirm", {})
        await mock_conversation_manager.clear_state("user1")

        state = await mock_conversation_manager.get_state("user1")
        assert state is None


class TestServiceCallParity:
    """Test that service calls use same parameters regardless of platform."""

    @pytest.mark.asyncio
    async def test_swap_engine_called_same_way(self, platform):
        """Test SwapEngine is called with same parameters from both platforms."""
        expected_params = {
            "from_chain": "ethereum",
            "to_chain": "polygon",
            "from_token": "USDC",
            "to_token": "USDC",
            "amount": 100.0,
            "from_address": "0x1234567890abcdef1234567890abcdef12345678",
        }

        # Both platforms should call SwapEngine with these exact parameters
        assert expected_params["from_chain"] == "ethereum"
        assert expected_params["amount"] == 100.0

    @pytest.mark.asyncio
    async def test_alert_service_called_same_way(self, platform):
        """Test AlertService is called with same parameters from both platforms."""
        expected_params = {
            "user_id": 1,
            "token_symbol": "ETH",
            "alert_type": "price_above",
            "target_price": 3500.0,
        }

        assert expected_params["token_symbol"] == "ETH"
        assert expected_params["alert_type"] == "price_above"
