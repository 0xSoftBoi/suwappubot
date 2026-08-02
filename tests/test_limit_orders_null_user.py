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
    """Register a lightweight stub module under `name` in sys.modules."""
    if name in sys.modules:
        return sys.modules[name]

    class _StubModule(types.ModuleType):
        def __getattr__(self, item):
            stub = type(item, (), {})
            setattr(self, item, stub)
            return stub

    mod = _StubModule(name)
    mod.__path__ = []
    sys.modules[name] = mod
    return mod


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

# Load bot/handlers/limit_orders.py directly by path to avoid executing
# bot/handlers/__init__.py (which imports sibling modules with annotations not
# valid on the Python 3.9 interpreter used here).
_LIMIT_ORDERS_PATH = (
    pathlib.Path(__file__).resolve().parents[1] / "bot" / "handlers" / "limit_orders.py"
)
_spec = importlib.util.spec_from_file_location(
    "bot_handlers_limit_orders_under_test", _LIMIT_ORDERS_PATH
)
limit_orders = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(limit_orders)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@contextmanager
def _session_returning_none():
    """get_session() whose query(...).filter(...).first() returns None."""
    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = None
    yield session


def test_lo_confirm_handles_missing_user(monkeypatch):
    monkeypatch.setattr(limit_orders, "get_session", _session_returning_none)

    query = SimpleNamespace(
        answer=AsyncMock(),
        edit_message_text=AsyncMock(),
    )
    update = SimpleNamespace(
        callback_query=query,
        effective_user=SimpleNamespace(id=12345),
    )
    context = SimpleNamespace(
        user_data={
            "lo": {
                "type": "buy",
                "from_chain": "base",
                "from_token": "USDC",
                "to_chain": "base",
                "to_token": "WETH",
                "amount_human": 1.0,
                "price": 1.0,
            }
        }
    )

    # Without the fix this raises AttributeError on db_user.id.
    result = _run(limit_orders.lo_confirm(update, context))

    assert result == limit_orders.ConversationHandler.END
    query.edit_message_text.assert_awaited_once()
    assert "/start" in query.edit_message_text.await_args.args[0]
