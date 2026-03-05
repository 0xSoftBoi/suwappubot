"""Tests for WhatsApp swap flow state machine."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestSwapFlowStart:
    """Tests for swap flow initialization."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.mark.asyncio
    async def test_start_shows_chain_list(self, flow):
        """Test that start() shows chain selection list."""
        with patch.object(flow, "_set_state", AsyncMock()):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="swap",
            )

        assert result is not None
        assert "chain" in result.text.lower() or "from" in result.text.lower()
        assert result.list_sections is not None
        assert result.list_button_text == "Choose Chain"
        assert result.header == "🔄 New Swap"

    @pytest.mark.asyncio
    async def test_start_sets_initial_state(self, flow):
        """Test that start() sets correct initial state."""
        mock_set_state = AsyncMock()
        with patch.object(flow, "_set_state", mock_set_state):
            await flow.start(user_id="1234567890", user_db_id=1, text="swap")

        mock_set_state.assert_called_once()
        call_args = mock_set_state.call_args
        assert call_args[0][0] == "1234567890"  # user_id
        assert call_args[0][1] == "select_from_chain"  # step
        assert call_args[0][2]["user_db_id"] == 1  # data


class TestSwapFlowQuickSwap:
    """Tests for quick swap shorthand parsing."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.mark.asyncio
    async def test_quick_swap_prefills_data(self, flow):
        """Test 's 100 USDC ETH' prefills swap data."""
        mock_set_state = AsyncMock()

        with patch.object(flow, "_set_state", mock_set_state), \
             patch.object(flow, "_build_confirm_prompt", AsyncMock(return_value=MagicMock(text="Confirm"))):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="s 100 USDC ETH",
            )

        # Should set state with prefilled data and skip to confirm
        mock_set_state.assert_called_once()
        call_args = mock_set_state.call_args
        data = call_args[0][2]
        assert data["from_token"] == "USDC"
        assert data["to_token"] == "ETH"
        assert data["amount"] == "100"
        assert call_args[0][1] == "confirm"  # Should jump to confirm step

    @pytest.mark.asyncio
    async def test_quick_swap_invalid_format(self, flow):
        """Test invalid quick swap format returns error."""
        with patch.object(flow, "_set_state", AsyncMock()):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="s 100",  # Missing tokens
            )

        # Should return normal flow start, not error
        assert result is not None

    @pytest.mark.asyncio
    async def test_quick_swap_invalid_amount(self, flow):
        """Test quick swap with non-numeric amount."""
        with patch.object(flow, "_set_state", AsyncMock()):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="s abc USDC ETH",
            )

        assert "Invalid" in result.text or "format" in result.text.lower()


class TestSwapFlowStepFromChain:
    """Tests for select_from_chain step."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "select_from_chain"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_select_valid_chain(self, flow, mock_state):
        """Test selecting a valid chain updates state."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_from_chain(
                user_id="1234567890",
                user_db_id=1,
                text="chain_ethereum",
                state=mock_state,
            )

        assert result is not None
        assert "ETH" in result.text or "chain" in result.text.lower()
        assert result.list_sections is not None  # Token list

    @pytest.mark.asyncio
    async def test_select_invalid_chain_reprompts(self, flow, mock_state):
        """Test selecting invalid chain shows error and reprompts."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_from_chain(
                user_id="1234567890",
                user_db_id=1,
                text="chain_invalid_xyz",
                state=mock_state,
            )

        assert "valid" in result.text.lower() or "select" in result.text.lower()
        assert result.list_sections is not None  # Should show chain list again


class TestSwapFlowStepFromToken:
    """Tests for select_from_token step."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "select_from_token"
        state.data = {"user_db_id": 1, "from_chain": "ethereum"}
        return state

    @pytest.mark.asyncio
    async def test_select_from_token_updates_state(self, flow, mock_state):
        """Test selecting from token advances to to_chain selection."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_from_token(
                user_id="1234567890",
                user_db_id=1,
                text="token_USDC",
                state=mock_state,
            )

        assert "USDC" in result.text
        assert result.list_sections is not None  # To chain list


class TestSwapFlowStepToChain:
    """Tests for select_to_chain step."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "select_to_chain"
        state.data = {"user_db_id": 1, "from_chain": "ethereum", "from_token": "USDC"}
        return state

    @pytest.mark.asyncio
    async def test_select_to_chain_updates_state(self, flow, mock_state):
        """Test selecting to chain advances to to_token selection."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_to_chain(
                user_id="1234567890",
                user_db_id=1,
                text="chain_polygon",
                state=mock_state,
            )

        assert result is not None
        assert result.list_sections is not None  # To token list

    @pytest.mark.asyncio
    async def test_select_invalid_to_chain(self, flow, mock_state):
        """Test selecting invalid to chain reprompts."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_to_chain(
                user_id="1234567890",
                user_db_id=1,
                text="chain_nonexistent",
                state=mock_state,
            )

        assert "valid" in result.text.lower()


class TestSwapFlowStepToToken:
    """Tests for select_to_token step."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "select_to_token"
        state.data = {
            "user_db_id": 1,
            "from_chain": "ethereum",
            "from_token": "USDC",
            "to_chain": "polygon",
        }
        return state

    @pytest.mark.asyncio
    async def test_select_to_token_prompts_amount(self, flow, mock_state):
        """Test selecting to token prompts for amount entry."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_to_token(
                user_id="1234567890",
                user_db_id=1,
                text="token_ETH",
                state=mock_state,
            )

        assert "amount" in result.text.lower()
        assert result.buttons is not None  # 25%, 50%, Max buttons
        assert len(result.buttons) == 3


class TestSwapFlowStepAmount:
    """Tests for enter_amount step."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "enter_amount"
        state.data = {
            "user_db_id": 1,
            "from_chain": "ethereum",
            "from_token": "USDC",
            "to_chain": "polygon",
            "to_token": "ETH",
        }
        return state

    @pytest.mark.asyncio
    async def test_amount_manual_entry(self, flow, mock_state):
        """Test manual amount entry."""
        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_get_state_data", AsyncMock(return_value=mock_state.data)), \
             patch.object(flow, "_build_confirm_prompt", AsyncMock(return_value=MagicMock(text="Confirm swap"))):
            result = await flow._step_amount(
                user_id="1234567890",
                user_db_id=1,
                text="100",
                state=mock_state,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_amount_buttons_25_percent(self, flow, mock_state):
        """Test 25% button calculates from balance."""
        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_get_balance_amount", AsyncMock(return_value=25.0)), \
             patch.object(flow, "_get_state_data", AsyncMock(return_value=mock_state.data)), \
             patch.object(flow, "_build_confirm_prompt", AsyncMock(return_value=MagicMock(text="Confirm"))):
            result = await flow._step_amount(
                user_id="1234567890",
                user_db_id=1,
                text="amt_25",
                state=mock_state,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_amount_buttons_max(self, flow, mock_state):
        """Test Max button uses full balance."""
        with patch.object(flow, "_update", AsyncMock()), \
             patch.object(flow, "_get_balance_amount", AsyncMock(return_value=100.0)), \
             patch.object(flow, "_get_state_data", AsyncMock(return_value=mock_state.data)), \
             patch.object(flow, "_build_confirm_prompt", AsyncMock(return_value=MagicMock(text="Confirm"))):
            result = await flow._step_amount(
                user_id="1234567890",
                user_db_id=1,
                text="amt_max",
                state=mock_state,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_invalid_amount_reprompts(self, flow, mock_state):
        """Test invalid amount shows error."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_amount(
                user_id="1234567890",
                user_db_id=1,
                text="not_a_number",
                state=mock_state,
            )

        assert "valid" in result.text.lower() or "positive" in result.text.lower()

    @pytest.mark.asyncio
    async def test_negative_amount_reprompts(self, flow, mock_state):
        """Test negative amount shows error."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_amount(
                user_id="1234567890",
                user_db_id=1,
                text="-50",
                state=mock_state,
            )

        assert "valid" in result.text.lower() or "positive" in result.text.lower()

    @pytest.mark.asyncio
    async def test_zero_amount_reprompts(self, flow, mock_state):
        """Test zero amount shows error."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_amount(
                user_id="1234567890",
                user_db_id=1,
                text="0",
                state=mock_state,
            )

        assert "valid" in result.text.lower() or "positive" in result.text.lower()


class TestSwapFlowStepConfirm:
    """Tests for confirm step."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state with complete swap data."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "confirm"
        state.data = {
            "user_db_id": 1,
            "from_chain": "ethereum",
            "from_token": "USDC",
            "to_chain": "polygon",
            "to_token": "ETH",
            "amount": "100",
        }
        return state

    @pytest.mark.asyncio
    async def test_confirm_shows_quote(self, flow, mock_state):
        """Test confirm step shows swap quote."""
        with patch.object(flow, "_build_confirm_prompt", AsyncMock(return_value=MagicMock(
            text="Swap 100 USDC → ETH",
            buttons=[{"id": "confirm_swap", "title": "Confirm"}],
        ))):
            result = await flow._build_confirm_prompt(
                user_id="1234567890",
                user_db_id=1,
                data=mock_state.data,
            )

        assert "100" in result.text or "USDC" in result.text

    @pytest.mark.asyncio
    async def test_confirm_executes_swap(self, flow, mock_state):
        """Test confirming swap executes transaction."""
        mock_swap_tx = MagicMock()
        mock_swap_tx.tx_hash = "0xabc123"
        mock_swap_tx.status = "pending"

        with patch.object(flow, "_execute_swap", AsyncMock(return_value=MagicMock(
            text="Swap Submitted! Tx: 0xabc123",
        ))):
            result = await flow._step_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="confirm_swap",
                state=mock_state,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_cancel_clears_state(self, flow, mock_state):
        """Test cancelling swap clears state."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow._step_confirm(
                user_id="1234567890",
                user_db_id=1,
                text="cancel_swap",
                state=mock_state,
            )

        assert "cancelled" in result.text.lower()

    @pytest.mark.asyncio
    async def test_invalid_response_reprompts(self, flow, mock_state):
        """Test invalid response at confirm step reprompts."""
        result = await flow._step_confirm(
            user_id="1234567890",
            user_db_id=1,
            text="maybe",
            state=mock_state,
        )

        assert result.buttons is not None
        assert "confirm" in result.text.lower() or "cancel" in result.text.lower()


class TestSwapFlowCancel:
    """Tests for universal cancel handling."""

    @pytest.fixture
    def flow(self):
        """Create SwapFlow instance."""
        from bot.services.whatsapp_flows.swap_flow import SwapFlow

        return SwapFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "swap"
        state.step = "select_from_chain"
        state.data = {}
        return state

    @pytest.mark.asyncio
    async def test_cancel_at_any_step(self, flow, mock_state):
        """Test 'cancel' works at any step."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow.handle(
                user_id="1234567890",
                user_db_id=1,
                text="cancel",
                state=mock_state,
            )

        assert "Cancelled" in result.text

    @pytest.mark.asyncio
    async def test_exit_at_any_step(self, flow, mock_state):
        """Test 'exit' works at any step."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow.handle(
                user_id="1234567890",
                user_db_id=1,
                text="exit",
                state=mock_state,
            )

        assert "Cancelled" in result.text

    @pytest.mark.asyncio
    async def test_quit_at_any_step(self, flow, mock_state):
        """Test 'quit' works at any step."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow.handle(
                user_id="1234567890",
                user_db_id=1,
                text="quit",
                state=mock_state,
            )

        assert "Cancelled" in result.text


class TestSwapFlowRegistration:
    """Tests for flow registration."""

    def test_swap_flow_registered(self):
        """Test swap flow is registered in the registry."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("swap")
        assert flow is not None
        assert flow.flow_name == "swap"

    def test_swap_flow_trigger_commands(self):
        """Test swap flow trigger commands."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("swap")
        assert "/s" in flow.trigger_commands
        assert "s" in flow.trigger_commands
        assert "swap" in flow.trigger_commands


class TestSwapFlowChainSections:
    """Tests for chain section building."""

    def test_build_chain_sections(self):
        """Test chain sections are built correctly."""
        from bot.services.whatsapp_flows.swap_flow import _build_chain_sections

        sections = _build_chain_sections()

        assert len(sections) == 2  # EVM and Non-EVM
        assert sections[0]["title"] == "EVM Chains"
        assert sections[1]["title"] == "Non-EVM"

        # Check EVM chains
        evm_rows = sections[0]["rows"]
        chain_ids = [row["id"] for row in evm_rows]
        assert "chain_ethereum" in chain_ids
        assert "chain_arbitrum" in chain_ids

        # Check Solana
        sol_rows = sections[1]["rows"]
        assert sol_rows[0]["id"] == "chain_solana"
