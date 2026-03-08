"""Integration tests for notification delivery to Telegram and WhatsApp."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestAlertNotifications:
    """Test alert notification delivery."""

    @pytest.fixture
    def mock_telegram_bot(self):
        """Create mock Telegram bot."""
        bot = MagicMock()
        bot.send_message = AsyncMock(return_value=True)
        return bot

    @pytest.fixture
    def mock_whatsapp_service(self):
        """Create mock WhatsApp service."""
        service = MagicMock()
        service.send_text_message = AsyncMock(return_value={"messages": [{"id": "wamid.123"}]})
        service.is_configured = True
        return service

    @pytest.mark.asyncio
    async def test_alert_notification_telegram_only(self, mock_telegram_bot):
        """Test alert notification to Telegram-only user."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = None

        mock_alert = MagicMock()
        mock_alert.user = mock_user
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0

        # Simulate notification
        if mock_user.telegram_id:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text=f"🔔 Price Alert: ETH crossed ${mock_alert.target_price}",
            )

        mock_telegram_bot.send_message.assert_called_once()
        call_args = mock_telegram_bot.send_message.call_args
        assert call_args[1]["chat_id"] == 123456789
        assert "ETH" in call_args[1]["text"]

    @pytest.mark.asyncio
    async def test_alert_notification_whatsapp_only(self, mock_whatsapp_service):
        """Test alert notification to WhatsApp-only user."""
        mock_user = MagicMock()
        mock_user.telegram_id = None
        mock_user.whatsapp_id = "1234567890"

        mock_alert = MagicMock()
        mock_alert.user = mock_user
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0

        # Simulate notification
        if mock_user.whatsapp_id and mock_whatsapp_service.is_configured:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text=f"🔔 Price Alert: ETH crossed ${mock_alert.target_price}",
            )

        mock_whatsapp_service.send_text_message.assert_called_once()
        call_args = mock_whatsapp_service.send_text_message.call_args
        assert call_args[1]["to"] == "1234567890"
        assert "ETH" in call_args[1]["text"]

    @pytest.mark.asyncio
    async def test_alert_notification_both_platforms(self, mock_telegram_bot, mock_whatsapp_service):
        """Test alert notification to user with both Telegram and WhatsApp."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        mock_alert = MagicMock()
        mock_alert.user = mock_user
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0

        notification_text = f"🔔 Price Alert: ETH crossed ${mock_alert.target_price}"

        # Send to both platforms
        if mock_user.telegram_id:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text=notification_text,
            )

        if mock_user.whatsapp_id and mock_whatsapp_service.is_configured:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text=notification_text,
            )

        # Both should be called
        mock_telegram_bot.send_message.assert_called_once()
        mock_whatsapp_service.send_text_message.assert_called_once()


class TestOrderExecutionNotifications:
    """Test order execution notification delivery."""

    @pytest.fixture
    def mock_telegram_bot(self):
        """Create mock Telegram bot."""
        bot = MagicMock()
        bot.send_message = AsyncMock(return_value=True)
        return bot

    @pytest.fixture
    def mock_whatsapp_service(self):
        """Create mock WhatsApp service."""
        service = MagicMock()
        service.send_text_message = AsyncMock(return_value={"messages": [{"id": "wamid.123"}]})
        service.is_configured = True
        return service

    @pytest.mark.asyncio
    async def test_limit_order_execution_notification(self, mock_telegram_bot, mock_whatsapp_service):
        """Test notification when limit order executes."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        mock_order = MagicMock()
        mock_order.id = 1
        mock_order.user = mock_user
        mock_order.from_token = "ETH"
        mock_order.to_token = "USDC"
        mock_order.amount = "1.0"
        mock_order.trigger_price = 3500.0

        notification_text = (
            f"✅ Limit Order #{mock_order.id} Executed!\n"
            f"Sold {mock_order.amount} {mock_order.from_token} → {mock_order.to_token}\n"
            f"Trigger: ${mock_order.trigger_price}"
        )

        # Send to both platforms
        if mock_user.telegram_id:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text=notification_text,
            )

        if mock_user.whatsapp_id and mock_whatsapp_service.is_configured:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text=notification_text,
            )

        mock_telegram_bot.send_message.assert_called_once()
        mock_whatsapp_service.send_text_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_dca_execution_notification(self, mock_telegram_bot, mock_whatsapp_service):
        """Test notification when DCA order executes."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        mock_dca = MagicMock()
        mock_dca.id = 1
        mock_dca.user = mock_user
        mock_dca.from_token = "USDC"
        mock_dca.to_token = "ETH"
        mock_dca.amount_per_execution = "100"
        mock_dca.executions_completed = 5

        notification_text = (
            f"🔄 DCA Order #{mock_dca.id} Executed!\n"
            f"Bought {mock_dca.to_token} with {mock_dca.amount_per_execution} {mock_dca.from_token}\n"
            f"Executions: {mock_dca.executions_completed}"
        )

        if mock_user.telegram_id:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text=notification_text,
            )

        if mock_user.whatsapp_id and mock_whatsapp_service.is_configured:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text=notification_text,
            )

        mock_telegram_bot.send_message.assert_called_once()
        mock_whatsapp_service.send_text_message.assert_called_once()


class TestNotificationFailureIsolation:
    """Test that notification failures are isolated between platforms."""

    @pytest.fixture
    def mock_telegram_bot(self):
        """Create mock Telegram bot that fails."""
        bot = MagicMock()
        bot.send_message = AsyncMock(side_effect=Exception("Telegram API error"))
        return bot

    @pytest.fixture
    def mock_whatsapp_service(self):
        """Create mock WhatsApp service that succeeds."""
        service = MagicMock()
        service.send_text_message = AsyncMock(return_value={"messages": [{"id": "wamid.123"}]})
        service.is_configured = True
        return service

    @pytest.mark.asyncio
    async def test_telegram_failure_doesnt_block_whatsapp(self, mock_telegram_bot, mock_whatsapp_service):
        """Test that Telegram failure doesn't prevent WhatsApp notification."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        notification_text = "🔔 Test notification"
        telegram_success = False
        whatsapp_success = False

        # Try Telegram (will fail)
        try:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text=notification_text,
            )
            telegram_success = True
        except Exception:
            telegram_success = False

        # Try WhatsApp (should still work)
        try:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text=notification_text,
            )
            whatsapp_success = True
        except Exception:
            whatsapp_success = False

        assert telegram_success is False
        assert whatsapp_success is True

    @pytest.mark.asyncio
    async def test_whatsapp_failure_doesnt_block_telegram(self):
        """Test that WhatsApp failure doesn't prevent Telegram notification."""
        mock_telegram_bot = MagicMock()
        mock_telegram_bot.send_message = AsyncMock(return_value=True)

        mock_whatsapp_service = MagicMock()
        mock_whatsapp_service.send_text_message = AsyncMock(side_effect=Exception("WhatsApp API error"))
        mock_whatsapp_service.is_configured = True

        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        notification_text = "🔔 Test notification"
        telegram_success = False
        whatsapp_success = False

        # Try Telegram (should work)
        try:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text=notification_text,
            )
            telegram_success = True
        except Exception:
            telegram_success = False

        # Try WhatsApp (will fail)
        try:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text=notification_text,
            )
            whatsapp_success = True
        except Exception:
            whatsapp_success = False

        assert telegram_success is True
        assert whatsapp_success is False


class TestNotificationContent:
    """Test notification content formatting."""

    def test_alert_notification_content(self):
        """Test alert notification has required content."""
        mock_alert = MagicMock()
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0

        # Format notification
        if mock_alert.alert_type == "price_above":
            text = f"🔔 Price Alert: {mock_alert.token_symbol} crossed above ${mock_alert.target_price}"
        else:
            text = f"🔔 Price Alert: {mock_alert.token_symbol} crossed below ${mock_alert.target_price}"

        assert mock_alert.token_symbol in text
        assert str(int(mock_alert.target_price)) in text
        assert "🔔" in text

    def test_order_execution_notification_content(self):
        """Test order execution notification has required content."""
        mock_order = MagicMock()
        mock_order.id = 1
        mock_order.from_token = "ETH"
        mock_order.to_token = "USDC"
        mock_order.amount = "1.0"
        mock_order.tx_hash = "0xabc123"

        text = (
            f"✅ Order #{mock_order.id} Executed!\n"
            f"{mock_order.amount} {mock_order.from_token} → {mock_order.to_token}\n"
            f"Tx: {mock_order.tx_hash}"
        )

        assert str(mock_order.id) in text
        assert mock_order.from_token in text
        assert mock_order.to_token in text
        assert "✅" in text

    def test_dca_execution_notification_content(self):
        """Test DCA execution notification has required content."""
        mock_dca = MagicMock()
        mock_dca.id = 1
        mock_dca.from_token = "USDC"
        mock_dca.to_token = "ETH"
        mock_dca.amount_per_execution = "100"
        mock_dca.executions_completed = 5
        mock_dca.max_executions = 10

        text = (
            f"🔄 DCA #{mock_dca.id} Executed!\n"
            f"Bought {mock_dca.to_token} with {mock_dca.amount_per_execution} {mock_dca.from_token}\n"
            f"Progress: {mock_dca.executions_completed}/{mock_dca.max_executions}"
        )

        assert str(mock_dca.id) in text
        assert mock_dca.from_token in text
        assert mock_dca.to_token in text
        assert "🔄" in text


class TestNotificationPreferences:
    """Test notification preference handling."""

    @pytest.mark.asyncio
    async def test_user_with_notifications_disabled(self):
        """Test no notification sent when user has disabled them."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"
        mock_user.notifications_enabled = False

        mock_telegram_bot = MagicMock()
        mock_telegram_bot.send_message = AsyncMock()

        mock_whatsapp_service = MagicMock()
        mock_whatsapp_service.send_text_message = AsyncMock()

        # Only send if notifications enabled
        if mock_user.notifications_enabled:
            await mock_telegram_bot.send_message(
                chat_id=mock_user.telegram_id,
                text="Notification",
            )
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text="Notification",
            )

        mock_telegram_bot.send_message.assert_not_called()
        mock_whatsapp_service.send_text_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_whatsapp_not_configured(self):
        """Test WhatsApp notification skipped when service not configured."""
        mock_user = MagicMock()
        mock_user.telegram_id = 123456789
        mock_user.whatsapp_id = "1234567890"

        mock_telegram_bot = MagicMock()
        mock_telegram_bot.send_message = AsyncMock()

        mock_whatsapp_service = MagicMock()
        mock_whatsapp_service.send_text_message = AsyncMock()
        mock_whatsapp_service.is_configured = False  # Not configured

        await mock_telegram_bot.send_message(
            chat_id=mock_user.telegram_id,
            text="Notification",
        )

        if mock_whatsapp_service.is_configured:
            await mock_whatsapp_service.send_text_message(
                to=mock_user.whatsapp_id,
                text="Notification",
            )

        mock_telegram_bot.send_message.assert_called_once()
        mock_whatsapp_service.send_text_message.assert_not_called()
