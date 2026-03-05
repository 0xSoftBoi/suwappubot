"""Tests for WhatsApp conversation state manager."""

import pytest
import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch


class TestConversationState:
    """Tests for ConversationState dataclass."""

    def test_init_with_defaults(self):
        """Test ConversationState initialization with default updated_at."""
        from bot.services.whatsapp_conversation import ConversationState

        before = time.time()
        state = ConversationState(flow="swap", step="select_chain", data={"key": "value"})
        after = time.time()

        assert state.flow == "swap"
        assert state.step == "select_chain"
        assert state.data == {"key": "value"}
        assert before <= state.updated_at <= after

    def test_init_with_explicit_timestamp(self):
        """Test ConversationState initialization with explicit updated_at."""
        from bot.services.whatsapp_conversation import ConversationState

        timestamp = 1700000000.0
        state = ConversationState(
            flow="wallet", step="choose_action", data={}, updated_at=timestamp
        )

        assert state.updated_at == timestamp

    def test_to_dict(self):
        """Test ConversationState serialization to dict."""
        from bot.services.whatsapp_conversation import ConversationState

        timestamp = 1700000000.0
        state = ConversationState(
            flow="alerts", step="enter_price", data={"token": "ETH"}, updated_at=timestamp
        )

        result = state.to_dict()

        assert result == {
            "flow": "alerts",
            "step": "enter_price",
            "data": {"token": "ETH"},
            "updated_at": 1700000000.0,
        }

    def test_from_dict(self):
        """Test ConversationState deserialization from dict."""
        from bot.services.whatsapp_conversation import ConversationState

        data = {
            "flow": "orders",
            "step": "lo_confirm",
            "data": {"amount": "100", "price": "3500"},
            "updated_at": 1700000000.0,
        }

        state = ConversationState.from_dict(data)

        assert state.flow == "orders"
        assert state.step == "lo_confirm"
        assert state.data == {"amount": "100", "price": "3500"}
        assert state.updated_at == 1700000000.0

    def test_from_dict_missing_optional_fields(self):
        """Test from_dict handles missing optional fields gracefully."""
        from bot.services.whatsapp_conversation import ConversationState

        data = {"flow": "swap", "step": "start"}

        before = time.time()
        state = ConversationState.from_dict(data)
        after = time.time()

        assert state.flow == "swap"
        assert state.step == "start"
        assert state.data == {}
        # updated_at gets set to current time when not in dict (via __init__ default)
        assert before <= state.updated_at <= after


class TestConversationManager:
    """Tests for ConversationManager Redis-backed state manager."""

    @pytest.fixture
    def manager(self):
        """Create a ConversationManager instance."""
        from bot.services.whatsapp_conversation import ConversationManager

        return ConversationManager()

    @pytest.fixture
    def mock_cache(self):
        """Create a mock redis_cache."""
        cache = MagicMock()
        cache.get = AsyncMock(return_value=None)
        cache.set = AsyncMock(return_value=True)
        cache.delete = AsyncMock(return_value=True)
        return cache

    def test_key_generation(self, manager):
        """Test Redis key generation."""
        key = manager._key("1234567890")
        assert key == "wa_conv:1234567890"

    @pytest.mark.asyncio
    async def test_set_and_get_state(self, manager, mock_cache):
        """Test setting and retrieving conversation state."""
        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            # Set state
            state = await manager.set_state(
                user_id="1234567890",
                flow="swap",
                step="select_chain",
                data={"from_chain": "ethereum"},
                ttl=600,
            )

            assert state.flow == "swap"
            assert state.step == "select_chain"
            assert state.data == {"from_chain": "ethereum"}
            mock_cache.set.assert_called_once()

            # Verify the call args
            call_args = mock_cache.set.call_args
            assert call_args[0][0] == "wa_conv:1234567890"
            stored_data = call_args[0][1]
            assert stored_data["flow"] == "swap"
            assert stored_data["step"] == "select_chain"
            assert call_args[1]["ttl_seconds"] == 600

    @pytest.mark.asyncio
    async def test_get_state_returns_none_when_absent(self, manager, mock_cache):
        """Test get_state returns None when no state exists."""
        mock_cache.get = AsyncMock(return_value=None)

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.get_state("unknown_user")

        assert result is None

    @pytest.mark.asyncio
    async def test_get_state_deserializes_json_string(self, manager, mock_cache):
        """Test get_state handles JSON string from Redis."""
        stored_state = json.dumps({
            "flow": "wallet",
            "step": "import_key",
            "data": {"chain_type": "evm"},
            "updated_at": 1700000000.0,
        })
        mock_cache.get = AsyncMock(return_value=stored_state)

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.get_state("1234567890")

        assert result is not None
        assert result.flow == "wallet"
        assert result.step == "import_key"
        assert result.data == {"chain_type": "evm"}

    @pytest.mark.asyncio
    async def test_get_state_handles_dict_directly(self, manager, mock_cache):
        """Test get_state handles dict returned directly from cache."""
        stored_state = {
            "flow": "alerts",
            "step": "confirm",
            "data": {"token": "BTC"},
            "updated_at": 1700000000.0,
        }
        mock_cache.get = AsyncMock(return_value=stored_state)

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.get_state("1234567890")

        assert result is not None
        assert result.flow == "alerts"

    @pytest.mark.asyncio
    async def test_update_step(self, manager, mock_cache):
        """Test updating step and merging data."""
        existing_state = {
            "flow": "swap",
            "step": "select_from_chain",
            "data": {"user_db_id": 1},
            "updated_at": 1700000000.0,
        }
        mock_cache.get = AsyncMock(return_value=existing_state)

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.update_step(
                user_id="1234567890",
                step="select_from_token",
                data_update={"from_chain": "ethereum"},
                ttl=600,
            )

        assert result is not None
        assert result.step == "select_from_token"
        # Verify set was called with merged data
        mock_cache.set.assert_called_once()
        stored_data = mock_cache.set.call_args[0][1]
        assert stored_data["step"] == "select_from_token"
        assert stored_data["data"]["user_db_id"] == 1
        assert stored_data["data"]["from_chain"] == "ethereum"

    @pytest.mark.asyncio
    async def test_update_step_returns_none_when_no_state(self, manager, mock_cache):
        """Test update_step returns None when no existing state."""
        mock_cache.get = AsyncMock(return_value=None)

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.update_step(
                user_id="unknown_user", step="next_step", data_update={}
            )

        assert result is None
        mock_cache.set.assert_not_called()

    @pytest.mark.asyncio
    async def test_clear_state(self, manager, mock_cache):
        """Test clearing conversation state."""
        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            await manager.clear_state("1234567890")

        mock_cache.delete.assert_called_once_with("wa_conv:1234567890")

    @pytest.mark.asyncio
    async def test_corrupted_state_graceful_fallback(self, manager, mock_cache):
        """Test handling of corrupted JSON in Redis."""
        mock_cache.get = AsyncMock(return_value="not valid json {{{")

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.get_state("1234567890")

        assert result is None
        # Should have cleared the corrupted state
        mock_cache.delete.assert_called_once_with("wa_conv:1234567890")

    @pytest.mark.asyncio
    async def test_corrupted_state_missing_required_fields(self, manager, mock_cache):
        """Test handling of state missing required fields."""
        mock_cache.get = AsyncMock(return_value={"flow": "swap"})  # missing 'step'

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            result = await manager.get_state("1234567890")

        assert result is None
        mock_cache.delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_ttl_default_value(self, manager, mock_cache):
        """Test that default TTL is 1800 seconds (30 minutes)."""
        from bot.services.whatsapp_conversation import DEFAULT_TTL

        assert DEFAULT_TTL == 1800

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_cache):
            await manager.set_state(
                user_id="1234567890", flow="swap", step="start", data={}
            )

        # Should use default TTL
        call_args = mock_cache.set.call_args
        assert call_args[1]["ttl_seconds"] == 1800

    @pytest.mark.asyncio
    async def test_concurrent_updates_last_write_wins(self, mock_redis_cache):
        """Test that concurrent updates result in last write winning."""
        from bot.services.whatsapp_conversation import ConversationManager

        manager = ConversationManager()

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_redis_cache):
            # First write
            await manager.set_state("user1", "swap", "step1", {"value": 1})

            # Second write (should overwrite)
            await manager.set_state("user1", "swap", "step2", {"value": 2})

            # Get state should return second write
            result = await manager.get_state("user1")

        assert result.step == "step2"
        assert result.data["value"] == 2


class TestConversationManagerSingleton:
    """Tests for the conversation_manager singleton."""

    def test_singleton_exists(self):
        """Test that conversation_manager singleton is exported."""
        from bot.services.whatsapp_conversation import conversation_manager

        assert conversation_manager is not None

    def test_singleton_is_conversation_manager(self):
        """Test singleton is ConversationManager instance."""
        from bot.services.whatsapp_conversation import (
            conversation_manager,
            ConversationManager,
        )

        assert isinstance(conversation_manager, ConversationManager)


class TestConversationStateIntegration:
    """Integration tests using mock redis cache fixture."""

    @pytest.mark.asyncio
    async def test_full_flow_lifecycle(self, mock_redis_cache):
        """Test complete conversation flow lifecycle."""
        from bot.services.whatsapp_conversation import ConversationManager

        manager = ConversationManager()
        user_id = "test_user_123"

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_redis_cache):
            # Start: no state
            state = await manager.get_state(user_id)
            assert state is None

            # Set initial state
            await manager.set_state(user_id, "swap", "select_from_chain", {"user_db_id": 1})

            # Verify state exists
            state = await manager.get_state(user_id)
            assert state is not None
            assert state.flow == "swap"
            assert state.step == "select_from_chain"

            # Update step
            await manager.update_step(user_id, "select_from_token", {"from_chain": "ethereum"})

            # Verify update
            state = await manager.get_state(user_id)
            assert state.step == "select_from_token"
            assert state.data["from_chain"] == "ethereum"
            assert state.data["user_db_id"] == 1

            # Clear state (end of flow)
            await manager.clear_state(user_id)

            # Verify cleared
            state = await manager.get_state(user_id)
            assert state is None

    @pytest.mark.asyncio
    async def test_state_isolation_between_users(self, mock_redis_cache):
        """Test that state is isolated between different users."""
        from bot.services.whatsapp_conversation import ConversationManager

        manager = ConversationManager()

        with patch("bot.services.whatsapp_conversation.redis_cache", mock_redis_cache):
            # Set state for user A
            await manager.set_state("user_a", "swap", "step1", {"chain": "ethereum"})

            # Set different state for user B
            await manager.set_state("user_b", "wallet", "step2", {"action": "create"})

            # Verify user A state
            state_a = await manager.get_state("user_a")
            assert state_a.flow == "swap"
            assert state_a.data["chain"] == "ethereum"

            # Verify user B state is independent
            state_b = await manager.get_state("user_b")
            assert state_b.flow == "wallet"
            assert state_b.data["action"] == "create"

            # Clear user A doesn't affect user B
            await manager.clear_state("user_a")

            state_a = await manager.get_state("user_a")
            state_b = await manager.get_state("user_b")

            assert state_a is None
            assert state_b is not None
