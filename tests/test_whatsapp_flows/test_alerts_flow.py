"""Tests for WhatsApp price alerts flow."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestAlertsFlowStart:
    """Tests for alerts flow initialization."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.mark.asyncio
    async def test_start_shows_alerts_menu_no_alerts(self, flow):
        """Test start() shows menu when user has no alerts."""
        with patch.object(flow, "_set_state", AsyncMock()), \
             patch("bot.services.alerts.alert_service.get_user_alerts", return_value=[]):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="alerts",
            )

        assert "No active alerts" in result.text or "Alerts" in result.text
        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "alert_create" in button_ids
        assert "alert_delete" in button_ids

    @pytest.mark.asyncio
    async def test_start_shows_existing_alerts(self, flow):
        """Test start() lists user's existing alerts."""
        mock_alert = MagicMock()
        mock_alert.id = 1
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0
        mock_alert.is_active = True

        with patch.object(flow, "_set_state", AsyncMock()), \
             patch("bot.services.alerts.alert_service.get_user_alerts", return_value=[mock_alert]):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="alerts",
            )

        assert "ETH" in result.text
        assert "3500" in result.text or "above" in result.text


class TestAlertsFlowMainMenu:
    """Tests for main_menu step."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "alerts"
        state.step = "main_menu"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_create_alert_shows_token_list(self, flow, mock_state):
        """Test selecting create alert shows token list."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_main_menu(
                user_id="1234567890",
                user_db_id=1,
                text="alert_create",
                state=mock_state,
            )

        assert result.list_sections is not None
        assert result.list_button_text == "Choose Token"
        assert result.header == "🔔 New Alert"

    @pytest.mark.asyncio
    async def test_delete_alert_shows_alert_list(self, flow, mock_state):
        """Test selecting delete shows list of alerts."""
        mock_alert = MagicMock()
        mock_alert.id = 1
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0

        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.alerts.alert_service.get_user_alerts", return_value=[mock_alert]):
            result = await flow._step_main_menu(
                user_id="1234567890",
                user_db_id=1,
                text="alert_delete",
                state=mock_state,
            )

        assert result.list_sections is not None
        rows = result.list_sections[0]["rows"]
        assert any("alertdel_1" in row["id"] for row in rows)

    @pytest.mark.asyncio
    async def test_delete_no_alerts_returns_message(self, flow, mock_state):
        """Test delete with no alerts shows message."""
        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.alerts.alert_service.get_user_alerts", return_value=[]):
            result = await flow._step_main_menu(
                user_id="1234567890",
                user_db_id=1,
                text="alert_delete",
                state=mock_state,
            )

        assert "No active alerts" in result.text


class TestAlertsFlowStepChooseToken:
    """Tests for choose_token step."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "alerts"
        state.step = "choose_token"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_select_token_prompts_for_price(self, flow, mock_state):
        """Test selecting token prompts for target price."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_choose_token(
                user_id="1234567890",
                user_db_id=1,
                text="alerttk_ETH",
                state=mock_state,
            )

        assert "ETH" in result.text
        assert "price" in result.text.lower()

    @pytest.mark.asyncio
    async def test_select_token_uppercase_conversion(self, flow, mock_state):
        """Test token is converted to uppercase."""
        with patch.object(flow, "_update", AsyncMock()) as mock_update:
            await flow._step_choose_token(
                user_id="1234567890",
                user_db_id=1,
                text="alerttk_eth",  # lowercase
                state=mock_state,
            )

        # Verify update was called with uppercase token
        mock_update.assert_called_once()
        call_args = mock_update.call_args
        assert call_args[0][2]["token"] == "ETH"


class TestAlertsFlowStepEnterPrice:
    """Tests for enter_price step."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "alerts"
        state.step = "enter_price"
        state.data = {"user_db_id": 1, "token": "ETH"}
        return state

    @pytest.mark.asyncio
    async def test_valid_price_prompts_direction(self, flow, mock_state):
        """Test valid price prompts for above/below direction."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_enter_price(
                user_id="1234567890",
                user_db_id=1,
                text="3500",
                state=mock_state,
            )

        assert "above" in result.text.lower() or "below" in result.text.lower()
        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "dir_above" in button_ids
        assert "dir_below" in button_ids

    @pytest.mark.asyncio
    async def test_price_with_dollar_sign(self, flow, mock_state):
        """Test price with $ sign is parsed correctly."""
        with patch.object(flow, "_update", AsyncMock()) as mock_update:
            await flow._step_enter_price(
                user_id="1234567890",
                user_db_id=1,
                text="$3,500",
                state=mock_state,
            )

        mock_update.assert_called_once()
        call_args = mock_update.call_args
        assert call_args[0][2]["target_price"] == 3500.0

    @pytest.mark.asyncio
    async def test_invalid_price_reprompts(self, flow, mock_state):
        """Test invalid price shows error."""
        result = await flow._step_enter_price(
            user_id="1234567890",
            user_db_id=1,
            text="not_a_number",
            state=mock_state,
        )

        assert "valid" in result.text.lower()

    @pytest.mark.asyncio
    async def test_negative_price_reprompts(self, flow, mock_state):
        """Test negative price shows error."""
        result = await flow._step_enter_price(
            user_id="1234567890",
            user_db_id=1,
            text="-100",
            state=mock_state,
        )

        assert "valid" in result.text.lower() or "positive" in result.text.lower()


class TestAlertsFlowStepChooseDirection:
    """Tests for choose_direction step."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "alerts"
        state.step = "choose_direction"
        state.data = {"user_db_id": 1, "token": "ETH", "target_price": 3500.0}
        return state

    @pytest.mark.asyncio
    async def test_select_above_direction(self, flow, mock_state):
        """Test selecting 'above' direction."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_choose_direction(
                user_id="1234567890",
                user_db_id=1,
                text="dir_above",
                state=mock_state,
            )

        assert "Confirm" in result.text
        assert "ETH" in result.text
        assert "above" in result.text.lower()

    @pytest.mark.asyncio
    async def test_select_below_direction(self, flow, mock_state):
        """Test selecting 'below' direction."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_choose_direction(
                user_id="1234567890",
                user_db_id=1,
                text="dir_below",
                state=mock_state,
            )

        assert "Confirm" in result.text
        assert "below" in result.text.lower()

    @pytest.mark.asyncio
    async def test_invalid_direction_reprompts(self, flow, mock_state):
        """Test invalid direction shows buttons again."""
        result = await flow._step_choose_direction(
            user_id="1234567890",
            user_db_id=1,
            text="invalid",
            state=mock_state,
        )

        assert result.buttons is not None


class TestAlertsFlowStepConfirm:
    """Tests for confirm step."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "alerts"
        state.step = "confirm"
        state.data = {
            "user_db_id": 1,
            "token": "ETH",
            "target_price": 3500.0,
            "direction": "price_above",
        }
        return state

    @pytest.mark.asyncio
    async def test_confirm_creates_alert(self, flow, mock_state):
        """Test confirming creates the alert."""
        mock_alert = MagicMock()
        mock_alert.id = 1
        mock_alert.token_symbol = "ETH"
        mock_alert.alert_type = "price_above"
        mock_alert.target_price = 3500.0

        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.alerts.alert_service.create_alert", return_value=mock_alert):
            result = await flow._step_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="alert_confirm",
                state=mock_state,
            )

        assert "Created" in result.text
        assert "#1" in result.text

    @pytest.mark.asyncio
    async def test_cancel_returns_message(self, flow, mock_state):
        """Test cancelling returns confirmation message."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow._step_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="alert_cancel",
                state=mock_state,
            )

        assert "cancelled" in result.text.lower()

    @pytest.mark.asyncio
    async def test_invalid_response_reprompts(self, flow, mock_state):
        """Test invalid response shows buttons again."""
        result = await flow._step_confirm(
            user_id="1234567890",
            user_db_id=1,
            text="maybe",
            state=mock_state,
        )

        assert result.buttons is not None


class TestAlertsFlowStepDeleteSelect:
    """Tests for delete_select step."""

    @pytest.fixture
    def flow(self):
        """Create AlertsFlow instance."""
        from bot.services.whatsapp_flows.alerts_flow import AlertsFlow

        return AlertsFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "alerts"
        state.step = "delete_select"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_delete_alert_success(self, flow, mock_state):
        """Test deleting alert successfully."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.alerts.alert_service.delete_alert", return_value=True):
            result = await flow._step_delete_select(
                user_id="1234567890",
                user_db_id=1,
                text="alertdel_1",
                state=mock_state,
            )

        assert "deleted" in result.text.lower()
        assert "#1" in result.text

    @pytest.mark.asyncio
    async def test_delete_alert_not_found(self, flow, mock_state):
        """Test deleting non-existent alert."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.alerts.alert_service.delete_alert", return_value=False):
            result = await flow._step_delete_select(
                user_id="1234567890",
                user_db_id=1,
                text="alertdel_999",
                state=mock_state,
            )

        assert "not found" in result.text.lower() or "deleted" in result.text.lower()

    @pytest.mark.asyncio
    async def test_delete_invalid_selection(self, flow, mock_state):
        """Test invalid delete selection."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow._step_delete_select(
                user_id="1234567890",
                user_db_id=1,
                text="invalid_selection",
                state=mock_state,
            )

        assert "Invalid" in result.text or "try again" in result.text.lower()


class TestAlertsFlowFormatAlert:
    """Tests for alert formatting helper."""

    def test_format_price_above(self):
        """Test formatting price_above alert."""
        from bot.services.whatsapp_flows.alerts_flow import _format_alert

        alert = MagicMock()
        alert.token_symbol = "ETH"
        alert.alert_type = "price_above"
        alert.target_price = 3500.0

        result = _format_alert(alert)

        assert "ETH" in result
        assert "above" in result
        assert "3500" in result

    def test_format_price_below(self):
        """Test formatting price_below alert."""
        from bot.services.whatsapp_flows.alerts_flow import _format_alert

        alert = MagicMock()
        alert.token_symbol = "BTC"
        alert.alert_type = "price_below"
        alert.target_price = 40000.0

        result = _format_alert(alert)

        assert "BTC" in result
        assert "below" in result

    def test_format_percent_change(self):
        """Test formatting percent change alert."""
        from bot.services.whatsapp_flows.alerts_flow import _format_alert

        alert = MagicMock()
        alert.token_symbol = "SOL"
        alert.alert_type = "percent_change"
        alert.percent_threshold = 5.0

        result = _format_alert(alert)

        assert "SOL" in result
        assert "5" in result


class TestAlertsFlowRegistration:
    """Tests for flow registration."""

    def test_alerts_flow_registered(self):
        """Test alerts flow is registered."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("alerts")
        assert flow is not None
        assert flow.flow_name == "alerts"

    def test_alerts_flow_trigger_commands(self):
        """Test alerts flow trigger commands."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("alerts")
        assert "alerts" in flow.trigger_commands
        assert "alert" in flow.trigger_commands
        assert "/a" in flow.trigger_commands
