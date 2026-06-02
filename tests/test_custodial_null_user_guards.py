"""Reconciliation regression test on top of PR #311's withdrawal refactor.

#311 refactored custodial withdrawals (EIP-55 validation) but left 3
`user_id = db_user.id` accesses unguarded — an AttributeError crash when the
user row is missing. These guards now end the conversation cleanly instead.

Loads custodial.py in isolation: importing via `bot.handlers` runs __init__,
which imports siblings using 3.10 `str | None` syntax invalid on the local 3.9.
"""

import asyncio
import importlib.util
import os
import pathlib
import sys
import types
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")


def _install_stub(name):
    if name in sys.modules:
        return
    class _Stub(types.ModuleType):
        def __getattr__(self, item):
            s = type(item, (), {}); setattr(self, item, s); return s
    m = _Stub(name); m.__path__ = []; sys.modules[name] = m


for _n in ("qrcode", "qrcode.constants", "qrcode.image", "qrcode.image.styledpil",
           "qrcode.image.styles", "qrcode.image.styles.moduledrawers",
           "qrcode.image.styles.colormasks", "PIL", "PIL.Image"):
    _install_stub(_n)

_PATH = pathlib.Path(__file__).resolve().parents[1] / "bot" / "handlers" / "custodial.py"
_spec = importlib.util.spec_from_file_location("custodial_under_test", _PATH)
custodial = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(custodial)

END = custodial.ConversationHandler.END
VALID_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # valid EIP-55 checksum


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@contextmanager
def _session_none():
    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = None
    yield session


def _patch(monkeypatch):
    monkeypatch.setattr(custodial, "get_session", _session_none)


def test_withdraw_select_token_guards_missing_user(monkeypatch):
    _patch(monkeypatch)
    query = SimpleNamespace(data="withdraw_token_USDC", answer=AsyncMock(), edit_message_text=AsyncMock())
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=12345))
    ctx = SimpleNamespace(user_data={"withdraw_chain": "base"})
    assert _run(custodial.withdraw_select_token(update, ctx)) == END
    query.edit_message_text.assert_awaited_once()
    assert "/start" in query.edit_message_text.await_args.args[0]


def test_withdraw_confirm_guards_missing_user(monkeypatch):
    _patch(monkeypatch)
    msg = SimpleNamespace(text=VALID_ADDR, reply_text=AsyncMock())
    update = SimpleNamespace(message=msg, effective_user=SimpleNamespace(id=12345))
    ctx = SimpleNamespace(user_data={"withdraw_token": "USDC", "withdraw_chain": "base", "withdraw_amount": 1.0})
    assert _run(custodial.withdraw_confirm(update, ctx)) == END
    msg.reply_text.assert_awaited_once()
    assert "/start" in msg.reply_text.await_args.args[0]


def test_withdraw_confirm_2fa_guards_missing_user(monkeypatch):
    _patch(monkeypatch)
    msg = SimpleNamespace(text="123456", reply_text=AsyncMock())
    update = SimpleNamespace(message=msg, effective_user=SimpleNamespace(id=12345))
    ctx = SimpleNamespace(user_data={})
    assert _run(custodial.withdraw_confirm_2fa(update, ctx)) == END
    msg.reply_text.assert_awaited_once()
    assert "/start" in msg.reply_text.await_args.args[0]
