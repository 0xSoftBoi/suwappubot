"""Tests for push notifications on support-ticket replies/resolutions.

Covers bot/handlers/support.py's treply_command / tclose_command integration
with bot/services/push_service.send_push_notification:

1. /treply pushes a notification to the ticket author when they have a token.
2. /tclose (resolve) pushes a notification to the ticket author.
3. No push token on the user -> push service is never called, no crash.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import asyncio  # noqa: E402

import pytest  # noqa: E402

from bot.handlers import support  # noqa: E402
from bot.models.support import TicketKind, TicketStatus  # noqa: E402


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class _FakeSession:
    """Minimal session stand-in returning canned rows per model type."""

    def __init__(self, ticket=None, user=None):
        self._ticket = ticket
        self._user = user

    def query(self, model):
        name = getattr(model, "__name__", "")
        if name == "SupportTicket":
            return _FakeQuery(self._ticket)
        if name == "User":
            return _FakeQuery(self._user)
        return _FakeQuery(None)

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _make_ticket(ticket_id=1, user_id=42, kind=TicketKind.SUPPORT, status=TicketStatus.OPEN):
    return SimpleNamespace(
        id=ticket_id,
        user_id=user_id,
        telegram_id=999,
        username="alice",
        kind=kind,
        message="help please",
        status=status,
        admin_reply=None,
        handled_by=None,
        linear_issue_id=None,
        resolved_at=None,
    )


def _make_user(push_token="ExponentPushToken[abc123]"):
    return SimpleNamespace(id=42, push_token=push_token)


def _make_update(args):
    update = MagicMock()
    update.effective_user = SimpleNamespace(id=1)
    update.message = AsyncMock()
    context = MagicMock()
    context.args = args
    context.bot = AsyncMock()
    return update, context


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _admin(monkeypatch):
    monkeypatch.setattr(support, "is_admin", lambda uid: True)


@patch("bot.handlers.support.add_linear_comment", new_callable=AsyncMock)
@patch("bot.handlers.support.send_push_notification", new_callable=AsyncMock)
@patch("bot.handlers.support.get_session")
def test_treply_pushes_to_ticket_author(mock_get_session, mock_push, mock_linear):
    ticket = _make_ticket()
    user = _make_user()
    mock_get_session.return_value = _FakeSession(ticket=ticket, user=user)
    mock_push.return_value = True

    update, context = _make_update(["1", "here", "is", "your", "reply"])
    _run(support.treply_command(update, context))

    mock_push.assert_awaited_once()
    _, kwargs = mock_push.call_args
    assert kwargs["push_token"] == "ExponentPushToken[abc123]"
    assert "1" in kwargs["title"]
    assert kwargs["data"]["ticket_id"] == 1


@patch("bot.handlers.support.add_linear_comment", new_callable=AsyncMock)
@patch("bot.handlers.support.send_push_notification", new_callable=AsyncMock)
@patch("bot.handlers.support.get_session")
def test_tclose_pushes_resolution_to_ticket_author(mock_get_session, mock_push, mock_linear):
    ticket = _make_ticket(ticket_id=7, status=TicketStatus.IN_PROGRESS)
    user = _make_user()
    mock_get_session.return_value = _FakeSession(ticket=ticket, user=user)
    mock_push.return_value = True

    update, context = _make_update(["7"])
    _run(support.tclose_command(update, context))

    mock_push.assert_awaited_once()
    _, kwargs = mock_push.call_args
    assert kwargs["push_token"] == "ExponentPushToken[abc123]"
    assert "7" in kwargs["title"] or "7" in kwargs["body"]
    assert kwargs["data"]["ticket_id"] == 7


@patch("bot.handlers.support.add_linear_comment", new_callable=AsyncMock)
@patch("bot.handlers.support.send_push_notification", new_callable=AsyncMock)
@patch("bot.handlers.support.get_session")
def test_no_push_token_skips_gracefully(mock_get_session, mock_push, mock_linear):
    ticket = _make_ticket(ticket_id=3)
    user = _make_user(push_token=None)
    mock_get_session.return_value = _FakeSession(ticket=ticket, user=user)

    update, context = _make_update(["3", "hello", "there"])
    # Must not raise even though there's no push token.
    _run(support.treply_command(update, context))

    mock_push.assert_not_awaited()


@patch("bot.handlers.support.add_linear_comment", new_callable=AsyncMock)
@patch("bot.handlers.support.send_push_notification", new_callable=AsyncMock)
@patch("bot.handlers.support.get_session")
def test_no_user_row_skips_gracefully(mock_get_session, mock_push, mock_linear):
    ticket = _make_ticket(ticket_id=4, user_id=None)
    mock_get_session.return_value = _FakeSession(ticket=ticket, user=None)

    update, context = _make_update(["4"])
    _run(support.tclose_command(update, context))

    mock_push.assert_not_awaited()
