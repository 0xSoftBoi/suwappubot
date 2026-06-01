import os
import asyncio
import importlib.util
import pathlib
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import sys
import types

import pytest


def _install_stub(name):
    """Register a lightweight stub module (whose every attribute is itself a
    stub) under `name` in sys.modules, if not already importable."""
    if name in sys.modules:
        return sys.modules[name]

    class _StubModule(types.ModuleType):
        def __getattr__(self, item):
            stub = type(item, (), {})
            setattr(self, item, stub)
            return stub

    mod = _StubModule(name)
    mod.__path__ = []  # mark as a package so submodules can be registered
    sys.modules[name] = mod
    return mod


# bot/handlers/custodial.py transitively imports bot.utils.qr_code, which needs
# `qrcode` and `PIL` — heavy image deps not installed in this test environment
# and unrelated to the withdrawal logic under test. Stub them out.
for _stub_name in (
    "qrcode",
    "qrcode.constants",
    "qrcode.image",
    "qrcode.image.styledpil",
    "qrcode.image.styles",
    "qrcode.image.styles.moduledrawers",
    "qrcode.image.styles.colormasks",
    "PIL",
    "PIL.Image",
):
    _install_stub(_stub_name)

# Load bot/handlers/custodial.py directly by path. Importing it via
# `from bot.handlers import custodial` would execute bot/handlers/__init__.py,
# which imports sibling modules that use `str | None` annotations not valid on
# the Python 3.9 interpreter used here. The custodial module itself only relies
# on unrelated `bot.*` packages, so loading it in isolation is sufficient.
_CUSTODIAL_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "bot"
    / "handlers"
    / "custodial.py"
)
_spec = importlib.util.spec_from_file_location(
    "bot_handlers_custodial_under_test", _CUSTODIAL_PATH
)
custodial = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(custodial)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@contextmanager
def _session_returning_none():
    """A get_session() context manager whose query(...).filter(...).first()
    returns None (user not found / db lookup miss)."""
    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = None
    yield session


def _patch_session(monkeypatch):
    monkeypatch.setattr(custodial, "get_session", _session_returning_none)


def test_withdraw_select_token_handles_missing_user(monkeypatch):
    _patch_session(monkeypatch)

    # Guard: if the null check is missing, this service call would be reached
    # with user_id=None (or the handler crashes before getting here).
    def _should_not_be_called(*_args, **_kwargs):
        raise AssertionError("balance lookup reached despite missing user")

    monkeypatch.setattr(
        custodial.hot_wallet_service,
        "get_custodial_balance",
        _should_not_be_called,
    )

    query = SimpleNamespace(
        data="withdraw_token_USDC",
        answer=AsyncMock(),
        edit_message_text=AsyncMock(),
    )
    update = SimpleNamespace(
        callback_query=query,
        effective_user=SimpleNamespace(id=12345),
    )
    context = SimpleNamespace(user_data={"withdraw_chain": "base"})

    # Without the fix this raises AttributeError on db_user.id.
    result = _run(custodial.withdraw_select_token(update, context))

    assert result == custodial.SELECT_TOKEN
    query.edit_message_text.assert_awaited_once()
    assert "/start" in query.edit_message_text.await_args.args[0]


def test_withdraw_confirm_handles_missing_user(monkeypatch):
    _patch_session(monkeypatch)

    def _should_not_be_called(*_args, **_kwargs):
        raise AssertionError("balance update reached despite missing user")

    monkeypatch.setattr(
        custodial.hot_wallet_service,
        "update_custodial_balance",
        _should_not_be_called,
    )

    message = SimpleNamespace(
        text="0x" + "a" * 40,  # valid-looking 42-char EVM address
        reply_text=AsyncMock(),
    )
    update = SimpleNamespace(
        message=message,
        effective_user=SimpleNamespace(id=12345),
    )
    context = SimpleNamespace(
        user_data={
            "withdraw_token": "USDC",
            "withdraw_chain": "base",
            "withdraw_amount": 1.0,
        }
    )

    # Without the fix this raises AttributeError on db_user.id.
    result = _run(custodial.withdraw_confirm(update, context))

    assert result == custodial.CONFIRM_WITHDRAWAL
    message.reply_text.assert_awaited_once()
    assert "/start" in message.reply_text.await_args.args[0]
