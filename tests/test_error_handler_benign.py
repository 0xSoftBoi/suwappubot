"""The Telegram error handler must not tell users "an error occurred" for no-op edits."""

import os
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from telegram.error import BadRequest  # noqa: E402

from bot.main import _is_benign_telegram_error, error_handler  # noqa: E402


@pytest.mark.parametrize(
    "message",
    [
        "Message is not modified: specified new message content and reply markup are exactly the same",
        "Message to edit not found",
        "Query is too old and response timeout expired or query id is invalid",
    ],
)
def test_benign_markers(message):
    assert _is_benign_telegram_error(BadRequest(message))


def test_real_errors_are_not_benign():
    assert not _is_benign_telegram_error(RuntimeError("database is on fire"))
    assert not _is_benign_telegram_error(BadRequest("Chat not found"))


async def test_handler_swallows_not_modified_without_replying():
    update = MagicMock()
    update.effective_message.reply_text = AsyncMock()
    context = MagicMock()
    context.error = BadRequest("Message is not modified: identical content")

    await error_handler(update, context)

    update.effective_message.reply_text.assert_not_awaited()


async def test_handler_still_replies_for_real_errors():
    update = MagicMock()
    update.effective_message.reply_text = AsyncMock()
    context = MagicMock()
    context.error = RuntimeError("boom")

    await error_handler(update, context)

    update.effective_message.reply_text.assert_awaited_once()
