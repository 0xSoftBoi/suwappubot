"""Tests for WhatsApp limit orders and DCA flow."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestOrdersFlowStart:
    """Tests for orders flow initialization."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.mark.asyncio
    async def test_start_shows_orders_menu_empty(self, flow):
        """Test start() shows menu when user has no orders."""
        with patch.object(flow, "_set_state", AsyncMock()), \
             patch("bot.services.orders.order_service.get_user_orders", return_value=[]), \
             patch("bot.services.orders.order_service.get_user_dca_orders", return_value=[]):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="orders",
            )

        assert "No active orders" in result.text or "Orders" in result.text
        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "order_create" in button_ids
        assert "order_cancel" in button_ids

    @pytest.mark.asyncio
    async def test_start_shows_existing_orders(self, flow):
        """Test start() lists existing orders."""
        mock_order = MagicMock()
        mock_order.id = 1
        mock_order.from_token = "ETH"
        mock_order.to_token = "USDC"
        mock_order.trigger_price = 3500.0
        mock_order.order_type = "limit_sell"
        mock_order.status = "pending"

        with patch.object(flow, "_set_state", AsyncMock()), \
             patch("bot.services.orders.order_service.get_user_orders", return_value=[mock_order]), \
             patch("bot.services.orders.order_service.get_user_dca_orders", return_value=[]):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="orders",
            )

        assert "ETH" in result.text
        assert "USDC" in result.text


class TestOrdersFlowMainMenu:
    """Tests for main_menu step."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "orders"
        state.step = "main_menu"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_create_order_shows_pair_list(self, flow, mock_state):
        """Test selecting create shows pair list."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_main_menu(
                user_id="1234567890",
                user_db_id=1,
                text="order_create",
                state=mock_state,
            )

        assert result.list_sections is not None
        assert result.header == "📋 New Limit Order"

    @pytest.mark.asyncio
    async def test_cancel_order_shows_order_list(self, flow, mock_state):
        """Test selecting cancel shows order list."""
        mock_order = MagicMock()
        mock_order.id = 1
        mock_order.from_token = "ETH"
        mock_order.to_token = "USDC"
        mock_order.trigger_price = 3500.0
        mock_order.order_type = "limit_sell"

        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.orders.order_service.get_user_orders", return_value=[mock_order]):
            result = await flow._step_main_menu(
                user_id="1234567890",
                user_db_id=1,
                text="order_cancel",
                state=mock_state,
            )

        assert result.list_sections is not None

    @pytest.mark.asyncio
    async def test_cancel_no_orders_returns_message(self, flow, mock_state):
        """Test cancel with no orders shows message."""
        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.orders.order_service.get_user_orders", return_value=[]):
            result = await flow._step_main_menu(
                user_id="1234567890",
                user_db_id=1,
                text="order_cancel",
                state=mock_state,
            )

        assert "No active orders" in result.text


class TestOrdersFlowStepLoPair:
    """Tests for lo_pair (limit order pair) step."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "orders"
        state.step = "lo_pair"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_select_pair_prompts_price(self, flow, mock_state):
        """Test selecting pair prompts for trigger price."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_lo_pair(
                user_id="1234567890",
                user_db_id=1,
                text="pair_eth_usdc",
                state=mock_state,
            )

        assert "ETH/USDC" in result.text
        assert "price" in result.text.lower()

    @pytest.mark.asyncio
    async def test_invalid_pair_returns_error(self, flow, mock_state):
        """Test invalid pair returns error."""
        result = await flow._step_lo_pair(
            user_id="1234567890",
            user_db_id=1,
            text="pair_invalid",
            state=mock_state,
        )

        assert "Invalid" in result.text or "try again" in result.text.lower()


class TestOrdersFlowStepLoTrigger:
    """Tests for lo_trigger step."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "orders"
        state.step = "lo_trigger"
        state.data = {"user_db_id": 1, "from_token": "ETH", "to_token": "USDC"}
        return state

    @pytest.mark.asyncio
    async def test_valid_price_prompts_amount(self, flow, mock_state):
        """Test valid trigger price prompts for amount."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_lo_trigger(
                user_id="1234567890",
                user_db_id=1,
                text="3500",
                state=mock_state,
            )

        assert "$3500" in result.text or "3500" in result.text
        assert "amount" in result.text.lower()

    @pytest.mark.asyncio
    async def test_invalid_price_reprompts(self, flow, mock_state):
        """Test invalid price shows error."""
        result = await flow._step_lo_trigger(
            user_id="1234567890",
            user_db_id=1,
            text="not_a_number",
            state=mock_state,
        )

        assert "valid" in result.text.lower()


class TestOrdersFlowStepLoAmount:
    """Tests for lo_amount step."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "orders"
        state.step = "lo_amount"
        state.data = {
            "user_db_id": 1,
            "from_token": "ETH",
            "to_token": "USDC",
            "trigger_price": 3500.0,
        }
        return state

    @pytest.mark.asyncio
    async def test_valid_amount_shows_confirm(self, flow, mock_state):
        """Test valid amount shows confirmation prompt."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_lo_amount(
                user_id="1234567890",
                user_db_id=1,
                text="1.5",
                state=mock_state,
            )

        assert "Confirm" in result.text
        assert "ETH" in result.text
        assert result.buttons is not None

    @pytest.mark.asyncio
    async def test_invalid_amount_reprompts(self, flow, mock_state):
        """Test invalid amount shows error."""
        result = await flow._step_lo_amount(
            user_id="1234567890",
            user_db_id=1,
            text="invalid",
            state=mock_state,
        )

        assert "valid" in result.text.lower()


class TestOrdersFlowStepLoConfirm:
    """Tests for lo_confirm step."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "orders"
        state.step = "lo_confirm"
        state.data = {
            "user_db_id": 1,
            "from_token": "ETH",
            "to_token": "USDC",
            "trigger_price": 3500.0,
            "amount": "1.5",
        }
        return state

    @pytest.mark.asyncio
    async def test_confirm_creates_order(self, flow, mock_state):
        """Test confirming creates the order."""
        mock_order = MagicMock()
        mock_order.id = 1
        mock_order.from_token = "ETH"
        mock_order.to_token = "USDC"
        mock_order.trigger_price = 3500.0
        mock_order.order_type = "limit_sell"

        mock_wallet = MagicMock()
        mock_wallet.id = 1
        mock_wallet.is_active = True

        mock_user = MagicMock()
        mock_user.wallets = [mock_wallet]

        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.orders.order_service.create_limit_order", return_value=mock_order), \
             patch("database.db.get_session") as mock_gs:
            mock_session = MagicMock()
            mock_session.query.return_value.filter.return_value.first.return_value = mock_user
            mock_gs.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_gs.return_value.__exit__ = MagicMock(return_value=None)

            result = await flow._step_lo_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="lo_confirm_yes",
                state=mock_state,
            )

        assert "Created" in result.text
        assert "#1" in result.text

    @pytest.mark.asyncio
    async def test_confirm_no_wallet_error(self, flow, mock_state):
        """Test error when no active wallet."""
        mock_user = MagicMock()
        mock_user.wallets = []

        with patch.object(flow, "_clear", AsyncMock()), \
             patch("database.db.get_session") as mock_gs:
            mock_session = MagicMock()
            mock_session.query.return_value.filter.return_value.first.return_value = mock_user
            mock_gs.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_gs.return_value.__exit__ = MagicMock(return_value=None)

            result = await flow._step_lo_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="lo_confirm_yes",
                state=mock_state,
            )

        assert "wallet" in result.text.lower()

    @pytest.mark.asyncio
    async def test_cancel_returns_message(self, flow, mock_state):
        """Test cancelling returns confirmation message."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow._step_lo_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="lo_confirm_no",
                state=mock_state,
            )

        assert "cancelled" in result.text.lower()


class TestOrdersFlowCancelSelect:
    """Tests for cancel_select step."""

    @pytest.fixture
    def flow(self):
        """Create OrdersFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import OrdersFlow

        return OrdersFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "orders"
        state.step = "cancel_select"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_cancel_order_success(self, flow, mock_state):
        """Test cancelling order successfully."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.orders.order_service.cancel_order", return_value=True):
            result = await flow._step_cancel_select(
                user_id="1234567890",
                user_db_id=1,
                text="orderdel_1",
                state=mock_state,
            )

        assert "cancelled" in result.text.lower()
        assert "#1" in result.text

    @pytest.mark.asyncio
    async def test_cancel_order_not_found(self, flow, mock_state):
        """Test cancelling non-existent order."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.orders.order_service.cancel_order", return_value=False):
            result = await flow._step_cancel_select(
                user_id="1234567890",
                user_db_id=1,
                text="orderdel_999",
                state=mock_state,
            )

        assert "not found" in result.text.lower() or "cancelled" in result.text.lower()


class TestDCAFlowStart:
    """Tests for DCA flow initialization."""

    @pytest.fixture
    def flow(self):
        """Create DCAFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import DCAFlow

        return DCAFlow()

    @pytest.mark.asyncio
    async def test_start_shows_dca_menu(self, flow):
        """Test start() shows DCA menu."""
        with patch.object(flow, "_set_state", AsyncMock()), \
             patch("bot.services.orders.order_service.get_user_dca_orders", return_value=[]):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="dca",
            )

        assert "DCA" in result.text
        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "dca_create" in button_ids
        assert "dca_manage" in button_ids


class TestDCAFlowStepDcaPair:
    """Tests for dca_pair step."""

    @pytest.fixture
    def flow(self):
        """Create DCAFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import DCAFlow

        return DCAFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "dca"
        state.step = "dca_pair"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_select_pair_prompts_amount(self, flow, mock_state):
        """Test selecting DCA pair prompts for amount."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_dca_pair(
                user_id="1234567890",
                user_db_id=1,
                text="dcapair_usdc_eth",
                state=mock_state,
            )

        assert "USDC → ETH" in result.text
        assert "amount" in result.text.lower()


class TestDCAFlowStepDcaAmount:
    """Tests for dca_amount step."""

    @pytest.fixture
    def flow(self):
        """Create DCAFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import DCAFlow

        return DCAFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "dca"
        state.step = "dca_amount"
        state.data = {"user_db_id": 1, "from_token": "USDC", "to_token": "ETH"}
        return state

    @pytest.mark.asyncio
    async def test_valid_amount_shows_interval_buttons(self, flow, mock_state):
        """Test valid amount shows interval selection."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_dca_amount(
                user_id="1234567890",
                user_db_id=1,
                text="100",
                state=mock_state,
            )

        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "dca_daily" in button_ids
        assert "dca_weekly" in button_ids
        assert "dca_monthly" in button_ids


class TestDCAFlowStepDcaInterval:
    """Tests for dca_interval step."""

    @pytest.fixture
    def flow(self):
        """Create DCAFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import DCAFlow

        return DCAFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "dca"
        state.step = "dca_interval"
        state.data = {
            "user_db_id": 1,
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "100",
        }
        return state

    @pytest.mark.asyncio
    async def test_select_daily_shows_confirm(self, flow, mock_state):
        """Test selecting daily interval shows confirmation."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_dca_interval(
                user_id="1234567890",
                user_db_id=1,
                text="dca_daily",
                state=mock_state,
            )

        assert "Confirm" in result.text
        assert "Daily" in result.text

    @pytest.mark.asyncio
    async def test_select_weekly_shows_confirm(self, flow, mock_state):
        """Test selecting weekly interval shows confirmation."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_dca_interval(
                user_id="1234567890",
                user_db_id=1,
                text="dca_weekly",
                state=mock_state,
            )

        assert "Confirm" in result.text
        assert "Weekly" in result.text

    @pytest.mark.asyncio
    async def test_invalid_interval_reprompts(self, flow, mock_state):
        """Test invalid interval shows buttons again."""
        result = await flow._step_dca_interval(
            user_id="1234567890",
            user_db_id=1,
            text="invalid",
            state=mock_state,
        )

        assert result.buttons is not None


class TestDCAFlowStepDcaConfirm:
    """Tests for dca_confirm step."""

    @pytest.fixture
    def flow(self):
        """Create DCAFlow instance."""
        from bot.services.whatsapp_flows.orders_flow import DCAFlow

        return DCAFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "dca"
        state.step = "dca_confirm"
        state.data = {
            "user_db_id": 1,
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "100",
            "interval_hours": 24,
            "interval_label": "Daily",
        }
        return state

    @pytest.mark.asyncio
    async def test_confirm_creates_dca(self, flow, mock_state):
        """Test confirming creates the DCA order."""
        mock_dca = MagicMock()
        mock_dca.id = 1
        mock_dca.from_token = "USDC"
        mock_dca.to_token = "ETH"
        mock_dca.interval_hours = 24
        mock_dca.executions_completed = 0
        mock_dca.max_executions = None

        mock_wallet = MagicMock()
        mock_wallet.id = 1
        mock_wallet.is_active = True

        mock_user = MagicMock()
        mock_user.wallets = [mock_wallet]

        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.orders.order_service.create_dca_order", return_value=mock_dca), \
             patch("database.db.get_session") as mock_gs:
            mock_session = MagicMock()
            mock_session.query.return_value.filter.return_value.first.return_value = mock_user
            mock_gs.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_gs.return_value.__exit__ = MagicMock(return_value=None)

            result = await flow._step_dca_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="dca_yes",
                state=mock_state,
            )

        assert "Created" in result.text
        assert "#1" in result.text


class TestOrdersFlowFormatHelpers:
    """Tests for format helper functions."""

    def test_format_order(self):
        """Test order formatting."""
        from bot.services.whatsapp_flows.orders_flow import _format_order

        order = MagicMock()
        order.from_token = "ETH"
        order.to_token = "USDC"
        order.trigger_price = 3500.0
        order.order_type = "limit_sell"

        result = _format_order(order)

        assert "ETH" in result
        assert "USDC" in result
        assert "3500" in result

    def test_format_dca(self):
        """Test DCA formatting."""
        from bot.services.whatsapp_flows.orders_flow import _format_dca

        dca = MagicMock()
        dca.from_token = "USDC"
        dca.to_token = "ETH"
        dca.interval_hours = 24
        dca.executions_completed = 5
        dca.max_executions = None

        result = _format_dca(dca)

        assert "USDC" in result
        assert "ETH" in result
        assert "24h" in result


class TestOrdersFlowRegistration:
    """Tests for flow registration."""

    def test_orders_flow_registered(self):
        """Test orders flow is registered."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("orders")
        assert flow is not None
        assert flow.flow_name == "orders"

    def test_dca_flow_registered(self):
        """Test DCA flow is registered."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("dca")
        assert flow is not None
        assert flow.flow_name == "dca"

    def test_orders_flow_trigger_commands(self):
        """Test orders flow trigger commands."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("orders")
        assert "orders" in flow.trigger_commands
        assert "order" in flow.trigger_commands
        assert "/o" in flow.trigger_commands
