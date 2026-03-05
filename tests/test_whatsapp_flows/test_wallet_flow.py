"""Tests for WhatsApp wallet management flow."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestWalletFlowStart:
    """Tests for wallet flow initialization."""

    @pytest.fixture
    def flow(self):
        """Create WalletFlow instance."""
        from bot.services.whatsapp_flows.wallet_flow import WalletFlow

        return WalletFlow()

    @pytest.mark.asyncio
    async def test_start_shows_action_buttons(self, flow):
        """Test start() shows create/import buttons."""
        with patch.object(flow, "_set_state", AsyncMock()):
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="wallets",
            )

        assert result is not None
        assert result.buttons is not None
        assert len(result.buttons) == 2
        button_ids = [b["id"] for b in result.buttons]
        assert "wallet_create" in button_ids
        assert "wallet_import" in button_ids

    @pytest.mark.asyncio
    async def test_start_with_wallet_create_skips_to_chain_type(self, flow):
        """Test direct entry with wallet_create skips to chain selection."""
        with patch.object(flow, "_set_state", AsyncMock()) as mock_set:
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="wallet_create",
            )

        # Should set state to choose_chain_type directly
        mock_set.assert_called_once()
        call_args = mock_set.call_args
        assert call_args[0][1] == "choose_chain_type"
        assert call_args[0][2]["action"] == "create"
        assert result.buttons is not None  # EVM/Solana buttons

    @pytest.mark.asyncio
    async def test_start_with_wallet_import_skips_to_chain_type(self, flow):
        """Test direct entry with wallet_import skips to chain selection."""
        with patch.object(flow, "_set_state", AsyncMock()) as mock_set:
            result = await flow.start(
                user_id="1234567890",
                user_db_id=1,
                text="wallet_import",
            )

        mock_set.assert_called_once()
        call_args = mock_set.call_args
        assert call_args[0][2]["action"] == "import"


class TestWalletFlowStepChooseAction:
    """Tests for choose_action step."""

    @pytest.fixture
    def flow(self):
        """Create WalletFlow instance."""
        from bot.services.whatsapp_flows.wallet_flow import WalletFlow

        return WalletFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "wallet"
        state.step = "choose_action"
        state.data = {"user_db_id": 1}
        return state

    @pytest.mark.asyncio
    async def test_choose_create_action(self, flow, mock_state):
        """Test choosing create action advances flow."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_choose_action(
                user_id="1234567890",
                user_db_id=1,
                text="wallet_create",
                state=mock_state,
            )

        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "chain_evm" in button_ids
        assert "chain_solana" in button_ids

    @pytest.mark.asyncio
    async def test_choose_import_action(self, flow, mock_state):
        """Test choosing import action advances flow."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_choose_action(
                user_id="1234567890",
                user_db_id=1,
                text="wallet_import",
                state=mock_state,
            )

        assert result.buttons is not None

    @pytest.mark.asyncio
    async def test_invalid_action_reprompts(self, flow, mock_state):
        """Test invalid action shows buttons again."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_choose_action(
                user_id="1234567890",
                user_db_id=1,
                text="invalid_action",
                state=mock_state,
            )

        assert result.buttons is not None
        assert "choose" in result.text.lower()


class TestWalletFlowStepChainType:
    """Tests for choose_chain_type step."""

    @pytest.fixture
    def flow(self):
        """Create WalletFlow instance."""
        from bot.services.whatsapp_flows.wallet_flow import WalletFlow

        return WalletFlow()

    @pytest.fixture
    def mock_state_create(self):
        """Create mock state for wallet creation."""
        state = MagicMock()
        state.flow = "wallet"
        state.step = "choose_chain_type"
        state.data = {"user_db_id": 1, "action": "create"}
        return state

    @pytest.fixture
    def mock_state_import(self):
        """Create mock state for wallet import."""
        state = MagicMock()
        state.flow = "wallet"
        state.step = "choose_chain_type"
        state.data = {"user_db_id": 1, "action": "import"}
        return state

    @pytest.mark.asyncio
    async def test_create_evm_wallet(self, flow, mock_state_create):
        """Test creating EVM wallet."""
        mock_wallet = MagicMock()
        mock_wallet.address = "0x1234567890abcdef1234567890abcdef12345678"

        with patch.object(flow, "_create_wallet", AsyncMock(return_value=MagicMock(
            text="Wallet Created! Address: 0x1234...5678"
        ))):
            result = await flow._step_chain_type(
                user_id="1234567890",
                user_db_id=1,
                text="chain_evm",
                state=mock_state_create,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_create_solana_wallet(self, flow, mock_state_create):
        """Test creating Solana wallet."""
        with patch.object(flow, "_create_wallet", AsyncMock(return_value=MagicMock(
            text="Wallet Created! Type: SOLANA"
        ))):
            result = await flow._step_chain_type(
                user_id="1234567890",
                user_db_id=1,
                text="chain_solana",
                state=mock_state_create,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_import_prompts_for_key(self, flow, mock_state_import):
        """Test import action prompts for private key."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_chain_type(
                user_id="1234567890",
                user_db_id=1,
                text="chain_evm",
                state=mock_state_import,
            )

        assert "private key" in result.text.lower()
        assert "Security" in result.text  # Security warning

    @pytest.mark.asyncio
    async def test_invalid_chain_type_reprompts(self, flow, mock_state_create):
        """Test invalid chain type shows buttons again."""
        with patch.object(flow, "_update", AsyncMock()):
            result = await flow._step_chain_type(
                user_id="1234567890",
                user_db_id=1,
                text="chain_invalid",
                state=mock_state_create,
            )

        assert result.buttons is not None
        button_ids = [b["id"] for b in result.buttons]
        assert "chain_evm" in button_ids


class TestWalletFlowStepImportKey:
    """Tests for import_key step."""

    @pytest.fixture
    def flow(self):
        """Create WalletFlow instance."""
        from bot.services.whatsapp_flows.wallet_flow import WalletFlow

        return WalletFlow()

    @pytest.fixture
    def mock_state_evm(self):
        """Create mock state for EVM import."""
        state = MagicMock()
        state.flow = "wallet"
        state.step = "import_key"
        state.data = {"user_db_id": 1, "chain_type": "evm"}
        return state

    @pytest.fixture
    def mock_state_solana(self):
        """Create mock state for Solana import."""
        state = MagicMock()
        state.flow = "wallet"
        state.step = "import_key"
        state.data = {"user_db_id": 1, "chain_type": "solana"}
        return state

    @pytest.mark.asyncio
    async def test_import_valid_evm_key(self, flow, mock_state_evm):
        """Test importing valid EVM private key."""
        mock_wallet = MagicMock()
        mock_wallet.address = "0xabcdef1234567890abcdef1234567890abcdef12"

        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.wallet.WalletService") as MockWS:
            MockWS.return_value.import_wallet.return_value = mock_wallet

            result = await flow._step_import_key(
                user_id="1234567890",
                user_db_id=1,
                text="0x" + "a" * 64,  # Valid hex private key
                state=mock_state_evm,
            )

        assert "Imported" in result.text or "imported" in result.text.lower()

    @pytest.mark.asyncio
    async def test_import_evm_key_without_0x_prefix(self, flow, mock_state_evm):
        """Test importing EVM key without 0x prefix adds it."""
        mock_wallet = MagicMock()
        mock_wallet.address = "0xabcdef1234567890abcdef1234567890abcdef12"

        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.wallet.WalletService") as MockWS, \
             patch("web3.Account") as MockAccount:
            MockWS.return_value.import_wallet.return_value = mock_wallet
            MockAccount.from_key.return_value.address = mock_wallet.address

            result = await flow._step_import_key(
                user_id="1234567890",
                user_db_id=1,
                text="a" * 64,  # Without 0x prefix
                state=mock_state_evm,
            )

        # Should still work
        assert result is not None

    @pytest.mark.asyncio
    async def test_import_invalid_solana_key(self, flow, mock_state_solana):
        """Test importing invalid Solana key shows error."""
        with patch.object(flow, "_clear", AsyncMock()):
            result = await flow._step_import_key(
                user_id="1234567890",
                user_db_id=1,
                text="short",  # Too short to be valid
                state=mock_state_solana,
            )

        assert "Invalid" in result.text or "invalid" in result.text.lower()


class TestWalletFlowCreateWallet:
    """Tests for _create_wallet helper."""

    @pytest.fixture
    def flow(self):
        """Create WalletFlow instance."""
        from bot.services.whatsapp_flows.wallet_flow import WalletFlow

        return WalletFlow()

    @pytest.mark.asyncio
    async def test_create_evm_wallet_success(self, flow):
        """Test successful EVM wallet creation."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.wallet.WalletService") as MockWS, \
             patch("database.db.get_session") as mock_gs, \
             patch("bot.utils.encryption.encrypt_private_key", return_value="encrypted"):
            MockWS.return_value.create_evm_wallet.return_value = (
                "0x1234567890abcdef1234567890abcdef12345678",
                "0xprivatekey",
            )
            mock_session = MagicMock()
            mock_gs.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_gs.return_value.__exit__ = MagicMock(return_value=None)

            result = await flow._create_wallet(
                user_id="1234567890",
                user_db_id=1,
                chain_type="evm",
            )

        assert "Created" in result.text
        assert "EVM" in result.text
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_solana_wallet_success(self, flow):
        """Test successful Solana wallet creation."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.wallet.WalletService") as MockWS, \
             patch("database.db.get_session") as mock_gs, \
             patch("bot.utils.encryption.encrypt_private_key", return_value="encrypted"):
            MockWS.return_value.create_solana_wallet.return_value = (
                "SoL1234567890abcdef1234567890abcdef12345678",
                "base58privatekey",
            )
            mock_session = MagicMock()
            mock_gs.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_gs.return_value.__exit__ = MagicMock(return_value=None)

            result = await flow._create_wallet(
                user_id="1234567890",
                user_db_id=1,
                chain_type="solana",
            )

        assert "Created" in result.text
        assert "SOLANA" in result.text

    @pytest.mark.asyncio
    async def test_create_wallet_failure(self, flow):
        """Test wallet creation failure handling."""
        with patch.object(flow, "_clear", AsyncMock()), \
             patch("bot.services.wallet.WalletService") as MockWS:
            MockWS.return_value.create_evm_wallet.side_effect = Exception("Creation failed")

            result = await flow._create_wallet(
                user_id="1234567890",
                user_db_id=1,
                chain_type="evm",
            )

        assert "failed" in result.text.lower()


class TestWalletFlowCancel:
    """Tests for cancel handling."""

    @pytest.fixture
    def flow(self):
        """Create WalletFlow instance."""
        from bot.services.whatsapp_flows.wallet_flow import WalletFlow

        return WalletFlow()

    @pytest.fixture
    def mock_state(self):
        """Create mock conversation state."""
        state = MagicMock()
        state.flow = "wallet"
        state.step = "choose_action"
        state.data = {}
        return state

    @pytest.mark.asyncio
    async def test_cancel_at_any_step(self, flow, mock_state):
        """Test cancel works at any step."""
        with patch("bot.services.whatsapp_conversation.conversation_manager.clear_state", AsyncMock()):
            result = await flow.handle(
                user_id="1234567890",
                user_db_id=1,
                text="cancel",
                state=mock_state,
            )

        assert "Cancelled" in result.text


class TestWalletFlowRegistration:
    """Tests for flow registration."""

    def test_wallet_flow_registered(self):
        """Test wallet flow is registered."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("wallet")
        assert flow is not None
        assert flow.flow_name == "wallet"

    def test_wallet_flow_trigger_commands(self):
        """Test wallet flow trigger commands."""
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("wallet")
        assert "wallet" in flow.trigger_commands
        assert "wallets" in flow.trigger_commands
        assert "wallet_create" in flow.trigger_commands
        assert "wallet_import" in flow.trigger_commands
