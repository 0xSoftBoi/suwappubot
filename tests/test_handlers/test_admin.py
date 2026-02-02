"""Unit tests for admin command handlers."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from bot.handlers.admin import (
    is_admin,
    status_command,
    broadcast_command,
    clear_cache_command,
)


class TestIsAdmin:
    """Tests for the is_admin function."""

    @patch("bot.handlers.admin.ADMIN_IDS", [12345, 67890])
    def test_admin_user(self):
        assert is_admin(12345) is True
        assert is_admin(67890) is True

    @patch("bot.handlers.admin.ADMIN_IDS", [12345])
    def test_non_admin_user(self):
        assert is_admin(99999) is False

    @patch("bot.handlers.admin.ADMIN_IDS", [])
    def test_no_admins_configured_denies_all(self):
        """Fail-closed: if no admin IDs configured, deny everyone."""
        assert is_admin(12345) is False


class TestStatusCommand:
    """Tests for the /st (status) command."""

    @pytest.mark.asyncio
    @patch("bot.handlers.admin.ADMIN_IDS", [])
    async def test_rejects_non_admin(self):
        update = MagicMock()
        update.effective_user.id = 99999
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await status_command(update, context)

        update.message.reply_text.assert_called_once_with(
            "❌ This command is for admins only."
        )

    @pytest.mark.asyncio
    @patch("bot.handlers.admin.ADMIN_IDS", [12345])
    @patch("bot.handlers.admin.enforce_rate_limit_for_update", new_callable=AsyncMock)
    async def test_rate_limited(self, mock_rate_limit):
        mock_rate_limit.return_value = False  # blocked
        update = MagicMock()
        update.effective_user.id = 12345
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await status_command(update, context)

        # Should not proceed to send loading message
        # (rate limit handler sends its own message)
        mock_rate_limit.assert_called_once()


class TestBroadcastCommand:
    """Tests for the /broadcast command."""

    @pytest.mark.asyncio
    @patch("bot.handlers.admin.ADMIN_IDS", [12345])
    @patch("bot.handlers.admin.enforce_rate_limit_for_update", new_callable=AsyncMock)
    async def test_broadcast_no_args_shows_usage(self, mock_rate_limit):
        mock_rate_limit.return_value = True
        update = MagicMock()
        update.effective_user.id = 12345
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = []

        await broadcast_command(update, context)

        call_args = update.message.reply_text.call_args[0][0]
        assert "Usage:" in call_args

    @pytest.mark.asyncio
    @patch("bot.handlers.admin.ADMIN_IDS", [12345])
    @patch("bot.handlers.admin.enforce_rate_limit_for_update", new_callable=AsyncMock)
    @patch("bot.handlers.admin.get_session")
    async def test_broadcast_sends_to_users(self, mock_session, mock_rate_limit):
        mock_rate_limit.return_value = True

        # Mock DB session with users
        mock_user1 = MagicMock()
        mock_user1.telegram_id = 111
        mock_user2 = MagicMock()
        mock_user2.telegram_id = 222

        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_ctx)
        session_ctx.__exit__ = MagicMock(return_value=False)
        session_ctx.query.return_value.all.return_value = [mock_user1, mock_user2]
        mock_session.return_value = session_ctx

        update = MagicMock()
        update.effective_user.id = 12345
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["Hello", "world"]
        context.bot.send_message = AsyncMock()

        await broadcast_command(update, context)

        assert context.bot.send_message.call_count == 2


class TestClearCacheCommand:
    """Tests for the /cc (clear cache) command."""

    @pytest.mark.asyncio
    @patch("bot.handlers.admin.ADMIN_IDS", [12345])
    @patch("bot.handlers.admin.enforce_rate_limit_for_update", new_callable=AsyncMock)
    @patch("bot.handlers.admin.price_cache")
    @patch("bot.handlers.admin.quote_cache")
    @patch("bot.handlers.admin.balance_cache")
    @patch("bot.handlers.admin.gas_cache")
    async def test_clears_all_caches(
        self, mock_gas, mock_balance, mock_quote, mock_price, mock_rate_limit
    ):
        mock_rate_limit.return_value = True
        for cache in [mock_price, mock_quote, mock_balance, mock_gas]:
            cache.clear = AsyncMock()

        update = MagicMock()
        update.effective_user.id = 12345
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await clear_cache_command(update, context)

        mock_price.clear.assert_called_once()
        mock_quote.clear.assert_called_once()
        mock_balance.clear.assert_called_once()
        mock_gas.clear.assert_called_once()
        assert "cleared" in update.message.reply_text.call_args[0][0].lower()
