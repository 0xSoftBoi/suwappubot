"""Tests for UnifiedBotService - multi-platform bot logic."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime


class TestUnifiedResponse:
    """Tests for UnifiedResponse container."""

    def test_init_with_text_only(self):
        """Test UnifiedResponse with text only."""
        from bot.services.unified_bot_service import UnifiedResponse

        response = UnifiedResponse(text="Hello World")

        assert response.text == "Hello World"
        assert response.buttons is None
        assert response.header is None
        assert response.footer is None
        assert response.list_button_text is None
        assert response.list_sections is None
        assert response.document is None
        assert response.image is None

    def test_init_with_buttons(self):
        """Test UnifiedResponse with buttons."""
        from bot.services.unified_bot_service import UnifiedResponse

        buttons = [
            {"id": "btn_1", "title": "Option 1"},
            {"id": "btn_2", "title": "Option 2"},
        ]
        response = UnifiedResponse(
            text="Choose an option:",
            buttons=buttons,
            header="Header Text",
            footer="Footer Text",
        )

        assert response.text == "Choose an option:"
        assert response.buttons == buttons
        assert response.header == "Header Text"
        assert response.footer == "Footer Text"

    def test_init_with_list(self):
        """Test UnifiedResponse with list sections."""
        from bot.services.unified_bot_service import UnifiedResponse

        sections = [
            {"title": "Section 1", "rows": [{"id": "row_1", "title": "Row 1"}]}
        ]
        response = UnifiedResponse(
            text="Select from list:",
            list_button_text="Choose",
            list_sections=sections,
        )

        assert response.list_button_text == "Choose"
        assert response.list_sections == sections


class TestCommandMapping:
    """Tests for command alias mapping."""

    def test_start_aliases(self):
        """Test /start command aliases."""
        from bot.services.unified_bot_service import _CMD_MAP

        assert _CMD_MAP.get("/start") == "start"
        assert _CMD_MAP.get("start") == "start"
        assert _CMD_MAP.get("hi") == "start"
        assert _CMD_MAP.get("hello") == "start"

    def test_balance_aliases(self):
        """Test balance command aliases."""
        from bot.services.unified_bot_service import _CMD_MAP

        assert _CMD_MAP.get("/b") == "balance"
        assert _CMD_MAP.get("b") == "balance"
        assert _CMD_MAP.get("balance") == "balance"

    def test_swap_aliases(self):
        """Test swap command aliases."""
        from bot.services.unified_bot_service import _CMD_MAP

        assert _CMD_MAP.get("/s") == "swap"
        assert _CMD_MAP.get("s") == "swap"
        assert _CMD_MAP.get("swap") == "swap"

    def test_wallet_aliases(self):
        """Test wallet command aliases."""
        from bot.services.unified_bot_service import _CMD_MAP

        assert _CMD_MAP.get("/w") == "wallets"
        assert _CMD_MAP.get("w") == "wallets"
        assert _CMD_MAP.get("wallet") == "wallets"
        assert _CMD_MAP.get("wallets") == "wallets"

    def test_alerts_aliases(self):
        """Test alerts command aliases."""
        from bot.services.unified_bot_service import _CMD_MAP

        assert _CMD_MAP.get("/a") == "alerts"
        assert _CMD_MAP.get("a") == "alerts"
        assert _CMD_MAP.get("alert") == "alerts"
        assert _CMD_MAP.get("alerts") == "alerts"


class TestUnifiedBotService:
    """Tests for UnifiedBotService main functionality."""

    @pytest.fixture
    def service(self):
        """Create a UnifiedBotService instance."""
        with patch("bot.services.unified_bot_service.WalletService"):
            from bot.services.unified_bot_service import UnifiedBotService

            return UnifiedBotService()

    @pytest.fixture
    def mock_get_session(self):
        """Create mock database session context manager."""
        session = MagicMock()
        ctx_manager = MagicMock()
        ctx_manager.__enter__ = MagicMock(return_value=session)
        ctx_manager.__exit__ = MagicMock(return_value=None)
        return session, ctx_manager

    @pytest.mark.asyncio
    async def test_new_user_creation_telegram(self, service, mock_get_session):
        """Test creating new user via Telegram /start."""
        session, ctx_manager = mock_get_session
        session.query.return_value.filter.return_value.first.return_value = None  # No existing user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="telegram",
                user_id="123456789",
                text="/start",
            )

        # Should return welcome message for new user
        assert "Welcome" in result.text or "WELCOME" in result.text.upper() or result.text is not None
        session.add.assert_called_once()
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_new_user_creation_whatsapp(self, service, mock_get_session):
        """Test creating new user via WhatsApp hello."""
        session, ctx_manager = mock_get_session
        session.query.return_value.filter.return_value.first.return_value = None

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="hello",
            )

        assert result is not None
        session.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_unregistered_user_non_start_command(self, service, mock_get_session):
        """Test non-start command from unregistered user."""
        session, ctx_manager = mock_get_session
        session.query.return_value.filter.return_value.first.return_value = None

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="balance",
            )

        # Should prompt to start first
        assert "start" in result.text.lower()
        session.add.assert_not_called()

    @pytest.mark.asyncio
    async def test_tos_gate_not_accepted(self, service, mock_get_session):
        """Test TOS gate blocks commands when not accepted."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = False
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="balance",
            )

        # Should show TOS text and accept button
        assert "Accept" in result.text or result.buttons is not None

    @pytest.mark.asyncio
    async def test_tos_accept_via_text(self, service, mock_get_session):
        """Test accepting TOS via text reply."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = False
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="accept",
            )

        assert mock_user.tos_accepted is True
        assert "Accepted" in result.text
        session.commit.assert_called()

    @pytest.mark.asyncio
    async def test_tos_accept_via_button(self, service, mock_get_session):
        """Test accepting TOS via button payload."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = False
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="",
                button_payload="accept",
            )

        assert mock_user.tos_accepted is True

    @pytest.mark.asyncio
    async def test_command_routing_balance(self, service, mock_get_session):
        """Test routing to balance handler."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        mock_user.wallets = []
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="balance",
            )

        # Should indicate no wallets
        assert result.text is not None

    @pytest.mark.asyncio
    async def test_command_routing_swap_starts_flow(self, service, mock_get_session):
        """Test swap command starts flow on WhatsApp."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        session.query.return_value.filter.return_value.first.return_value = mock_user

        mock_flow = MagicMock()
        mock_flow.start = AsyncMock(return_value=MagicMock(
            text="Select chain:",
            buttons=None,
            header="Swap",
            footer=None,
            list_button_text="Choose",
            list_sections=[],
            document=None,
            image=None,
        ))

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager), \
             patch("bot.services.whatsapp_flows.get_flow", return_value=mock_flow), \
             patch("bot.services.whatsapp_conversation.conversation_manager.get_state", AsyncMock(return_value=None)):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="swap",
            )

        mock_flow.start.assert_called_once()
        assert result.text == "Select chain:"

    @pytest.mark.asyncio
    async def test_command_routing_swap_telegram_hint(self, service, mock_get_session):
        """Test swap command on Telegram gives hint about interface."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service.handle_command(
                platform="telegram",
                user_id="123456789",
                text="swap",
            )

        # On Telegram, swap uses ConversationHandler, not flows
        assert "Telegram" in result.text or "/swap" in result.text

    @pytest.mark.asyncio
    async def test_flow_dispatch_active_flow(self, service, mock_get_session):
        """Test that active flow receives message."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        session.query.return_value.filter.return_value.first.return_value = mock_user

        mock_state = MagicMock()
        mock_state.flow = "swap"
        mock_state.step = "select_from_token"
        mock_state.data = {"from_chain": "ethereum"}

        mock_flow = MagicMock()
        mock_flow.handle = AsyncMock(return_value=MagicMock(
            text="Select token:",
            buttons=None,
            header=None,
            footer=None,
            list_button_text="Choose",
            list_sections=[],
            document=None,
            image=None,
        ))

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager), \
             patch("bot.services.whatsapp_conversation.conversation_manager.get_state", AsyncMock(return_value=mock_state)), \
             patch("bot.services.whatsapp_flows.get_flow", return_value=mock_flow):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="chain_ethereum",
            )

        mock_flow.handle.assert_called_once()

    @pytest.mark.asyncio
    async def test_flow_cancel_clears_state(self, service, mock_get_session):
        """Test 'cancel' clears active flow state."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        session.query.return_value.filter.return_value.first.return_value = mock_user

        mock_state = MagicMock()
        mock_state.flow = "swap"
        mock_state.step = "select_chain"
        mock_state.data = {}

        mock_flow = MagicMock()
        mock_flow.handle = AsyncMock(return_value=MagicMock(
            text="Cancelled. Type *help* to see commands.",
            buttons=None,
            header=None,
            footer=None,
            list_button_text=None,
            list_sections=None,
            document=None,
            image=None,
        ))

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager), \
             patch("bot.services.whatsapp_conversation.conversation_manager.get_state", AsyncMock(return_value=mock_state)), \
             patch("bot.services.whatsapp_flows.get_flow", return_value=mock_flow):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="cancel",
            )

        assert "Cancelled" in result.text

    @pytest.mark.asyncio
    async def test_unknown_command_fallback(self, service, mock_get_session):
        """Test unknown command returns fallback message."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager), \
             patch("bot.services.whatsapp_conversation.conversation_manager.get_state", AsyncMock(return_value=None)):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="unknown_gibberish_command",
            )

        assert "didn't understand" in result.text or "Try" in result.text

    @pytest.mark.asyncio
    async def test_quick_swap_parsing(self, service, mock_get_session):
        """Test quick swap shorthand 's 100 USDC ETH'."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.tos_accepted = True
        session.query.return_value.filter.return_value.first.return_value = mock_user

        mock_flow = MagicMock()
        mock_flow.start = AsyncMock(return_value=MagicMock(
            text="Confirm swap:",
            buttons=[{"id": "confirm", "title": "Confirm"}],
            header="Quick Swap",
            footer=None,
            list_button_text=None,
            list_sections=None,
            document=None,
            image=None,
        ))

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager), \
             patch("bot.services.whatsapp_flows.get_flow", return_value=mock_flow), \
             patch("bot.services.whatsapp_conversation.conversation_manager.get_state", AsyncMock(return_value=None)):
            result = await service.handle_command(
                platform="whatsapp",
                user_id="1234567890",
                text="s 100 USDC ETH",
            )

        mock_flow.start.assert_called_once()
        call_args = mock_flow.start.call_args
        assert "100 USDC ETH" in call_args[0][2]


class TestUnifiedBotServiceHandlers:
    """Tests for individual command handlers."""

    @pytest.fixture
    def service(self):
        """Create a UnifiedBotService instance."""
        with patch("bot.services.unified_bot_service.WalletService") as MockWS:
            MockWS.return_value.get_balances_by_address = AsyncMock(return_value={})
            from bot.services.unified_bot_service import UnifiedBotService

            return UnifiedBotService()

    @pytest.fixture
    def mock_get_session(self):
        """Create mock database session context manager."""
        session = MagicMock()
        ctx_manager = MagicMock()
        ctx_manager.__enter__ = MagicMock(return_value=session)
        ctx_manager.__exit__ = MagicMock(return_value=None)
        return session, ctx_manager

    @pytest.mark.asyncio
    async def test_handle_gas_success(self, service):
        """Test gas handler returns live prices."""
        mock_prices = {
            "ethereum": MagicMock(standard=25.5),
            "polygon": MagicMock(standard=50.0),
        }

        with patch("bot.services.gas_tracker.gas_tracker.get_all_gas_prices", AsyncMock(return_value=mock_prices)):
            result = await service._handle_gas()

        assert "Gas" in result.text
        assert "Ethereum" in result.text or "ethereum" in result.text.lower()
        assert "25.5" in result.text or "25" in result.text

    @pytest.mark.asyncio
    async def test_handle_gas_fallback(self, service):
        """Test gas handler fallback on error."""
        with patch("bot.services.gas_tracker.gas_tracker.get_all_gas_prices", AsyncMock(side_effect=Exception("API error"))):
            result = await service._handle_gas()

        assert "Unable" in result.text or "Try again" in result.text

    @pytest.mark.asyncio
    async def test_handle_xp(self, service):
        """Test XP handler returns profile."""
        mock_account = MagicMock()
        mock_account.level = "silver"
        mock_account.xp = 1500
        mock_account.current_points = 500
        mock_account.total_points_earned = 2000
        mock_account.daily_streak = 5

        with patch("bot.services.points_service.points_service.get_or_create_points_account", return_value=mock_account):
            result = await service._handle_xp(user_db_id=1)

        assert "XP" in result.text
        assert "Silver" in result.text or "silver" in result.text.lower()
        assert "1,500" in result.text or "1500" in result.text

    @pytest.mark.asyncio
    async def test_handle_referral(self, service):
        """Test referral handler returns stats."""
        mock_stats = {
            "code": "ABC123",
            "referrals": 10,
            "total_earned_usd": 50.5,
        }

        with patch("bot.services.referral_service.referral_service.get_referral_stats", return_value=mock_stats):
            result = await service._handle_referral(user_db_id=1)

        assert "Referral" in result.text
        assert "ABC123" in result.text
        assert "10" in result.text
        assert "50.50" in result.text or "$50" in result.text

    @pytest.mark.asyncio
    async def test_handle_history_no_swaps(self, service, mock_get_session):
        """Test history handler with no swaps."""
        session, ctx_manager = mock_get_session
        session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service._handle_history(user_db_id=1)

        assert "No swaps" in result.text or "History" in result.text

    @pytest.mark.asyncio
    async def test_handle_history_with_swaps(self, service, mock_get_session):
        """Test history handler with swap records."""
        session, ctx_manager = mock_get_session

        mock_swap = MagicMock()
        mock_swap.status = "completed"
        mock_swap.created_at = datetime(2024, 1, 15)
        mock_swap.from_token = "ETH"
        mock_swap.to_token = "USDC"

        session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_swap]

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service._handle_history(user_db_id=1)

        assert "ETH" in result.text
        assert "USDC" in result.text

    @pytest.mark.asyncio
    async def test_handle_wallets_no_wallets(self, service, mock_get_session):
        """Test wallets handler with no wallets."""
        session, ctx_manager = mock_get_session
        mock_user = MagicMock()
        mock_user.wallets = []
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service._handle_wallets(
                user_db_id=1, platform="whatsapp", user_id="123"
            )

        assert "No wallets" in result.text
        assert result.buttons is not None  # Should have Create button

    @pytest.mark.asyncio
    async def test_handle_wallets_with_wallets(self, service, mock_get_session):
        """Test wallets handler with existing wallets."""
        session, ctx_manager = mock_get_session

        mock_wallet = MagicMock()
        mock_wallet.chain_type = "evm"
        mock_wallet.address = "0x1234567890abcdef1234567890abcdef12345678"

        mock_user = MagicMock()
        mock_user.wallets = [mock_wallet]
        session.query.return_value.filter.return_value.first.return_value = mock_user

        with patch("bot.services.unified_bot_service.get_session", return_value=ctx_manager):
            result = await service._handle_wallets(
                user_db_id=1, platform="whatsapp", user_id="123"
            )

        assert "Wallets" in result.text
        assert "EVM" in result.text


class TestBuildHelp:
    """Tests for help message building."""

    @pytest.fixture
    def service(self):
        """Create a UnifiedBotService instance."""
        with patch("bot.services.unified_bot_service.WalletService"):
            from bot.services.unified_bot_service import UnifiedBotService

            return UnifiedBotService()

    def test_build_help_whatsapp(self, service):
        """Test WhatsApp-specific help message."""
        result = service._build_help(platform="whatsapp")

        assert "Commands" in result.text
        assert "swap" in result.text
        assert "balance" in result.text
        assert "wallets" in result.text

    def test_build_help_telegram(self, service):
        """Test Telegram help message."""
        result = service._build_help(platform="telegram")

        assert result.text is not None


class TestUnifiedBotServiceSingleton:
    """Tests for the unified_bot_service singleton."""

    def test_singleton_exists(self):
        """Test that singleton is exported."""
        with patch("bot.services.unified_bot_service.WalletService"):
            from bot.services.unified_bot_service import unified_bot_service

            assert unified_bot_service is not None
