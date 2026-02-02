"""Unit tests for swap handler functions."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from telegram.ext import ConversationHandler

from bot.handlers.swap import (
    start_swap,
    enter_amount,
    swap_cancel,
    SELECT_PAIR,
    ENTER_AMOUNT,
    CONFIRM_SWAP,
)


def _make_update(user_id=12345, text=None, is_callback=False):
    """Create a mock Telegram Update object."""
    update = MagicMock()
    update.effective_user.id = user_id
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    if text:
        update.message.text = text
    if is_callback:
        update.callback_query = MagicMock()
        update.callback_query.answer = AsyncMock()
        update.callback_query.edit_message_text = AsyncMock()
    else:
        update.callback_query = None
    return update


def _make_context(user_data=None):
    """Create a mock context object."""
    context = MagicMock()
    context.user_data = user_data or {}
    return context


class TestStartSwap:
    """Tests for the start_swap function."""

    @pytest.mark.asyncio
    @patch("bot.handlers.swap.enforce_rate_limit_for_update", new_callable=AsyncMock)
    async def test_rate_limited_ends_conversation(self, mock_rate_limit):
        mock_rate_limit.return_value = False
        update = _make_update()
        context = _make_context()

        result = await start_swap(update, context, is_callback=False)

        assert result == ConversationHandler.END

    @pytest.mark.asyncio
    @patch("bot.handlers.swap.enforce_rate_limit_for_update", new_callable=AsyncMock)
    @patch("bot.handlers.swap.get_session")
    async def test_no_user_shows_setup_message(self, mock_session, mock_rate_limit):
        mock_rate_limit.return_value = True

        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_ctx)
        session_ctx.__exit__ = MagicMock(return_value=False)
        session_ctx.query.return_value.options.return_value.filter.return_value.first.return_value = None
        mock_session.return_value = session_ctx

        update = _make_update()
        context = _make_context()

        result = await start_swap(update, context, is_callback=False)

        assert result == ConversationHandler.END
        call_text = update.message.reply_text.call_args[0][0]
        assert "/start" in call_text


class TestEnterAmount:
    """Tests for the enter_amount function."""

    @pytest.mark.asyncio
    @patch("bot.handlers.swap.enforce_rate_limit_for_update", new_callable=AsyncMock)
    async def test_invalid_amount_prompts_retry(self, mock_rate_limit):
        mock_rate_limit.return_value = True

        update = _make_update(text="not_a_number")
        context = _make_context(user_data={
            "swap": {"from_chain": "ethereum", "from_token": "ETH", "to_chain": "ethereum", "to_token": "USDC"},
            "user_id": 1,
        })

        result = await enter_amount(update, context)

        assert result == ENTER_AMOUNT
        call_text = update.message.reply_text.call_args[0][0]
        assert "Invalid amount" in call_text

    @pytest.mark.asyncio
    @patch("bot.handlers.swap.enforce_rate_limit_for_update", new_callable=AsyncMock)
    async def test_rate_limited_ends(self, mock_rate_limit):
        mock_rate_limit.return_value = False
        update = _make_update(text="100")
        context = _make_context()

        result = await enter_amount(update, context)

        assert result == ConversationHandler.END


class TestSwapCancel:
    """Tests for the swap_cancel function."""

    @pytest.mark.asyncio
    async def test_cancel_clears_swap_data(self):
        update = _make_update(is_callback=True)
        context = _make_context(user_data={"swap": {"some": "data"}})

        result = await swap_cancel(update, context)

        assert result == ConversationHandler.END
        assert "swap" not in context.user_data
        call_text = update.callback_query.edit_message_text.call_args[0][0]
        assert "cancelled" in call_text.lower()
