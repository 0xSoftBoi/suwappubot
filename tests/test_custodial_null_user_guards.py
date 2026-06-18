"""Regression test: custodial withdrawal handlers must guard a missing user row.

`withdraw_select_token` and `withdraw_confirm` read `user_id = db_user.id` right after
`session.query(...).first()`. If the user row is missing (`.first()` -> None) the deref
crashes with AttributeError. The guards end the conversation cleanly instead.

Loads custodial.py in isolation: importing via `bot.handlers` runs __init__, which imports
siblings using 3.10 `str | None` syntax invalid on the local 3.9. CI (3.11) is unaffected.
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
            s = type(item, (), {})
            setattr(self, item, s)
            return s

    m = _Stub(name)
    m.__path__ = []
    sys.modules[name] = m


for _n in (
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
    _install_stub(_n)

_PATH = pathlib.Path(__file__).resolve().parents[1] / "bot" / "handlers" / "custodial.py"
_spec = importlib.util.spec_from_file_location("custodial_under_test", _PATH)
custodial = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(custodial)

END = custodial.ConversationHandler.END
VALID_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # valid EIP-55 checksum, len 42


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
    query = SimpleNamespace(
        data="withdraw_token_USDC", answer=AsyncMock(), edit_message_text=AsyncMock()
    )
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=12345))
    ctx = SimpleNamespace(user_data={"withdraw_chain": "base"})
    assert _run(custodial.withdraw_select_token(update, ctx)) == END
    query.edit_message_text.assert_awaited_once()
    assert "/start" in query.edit_message_text.await_args.args[0]


def test_withdraw_confirm_shows_card_without_touching_db(monkeypatch):
    # The confirm step now only validates the address and shows a confirmation
    # card (no DB lookup, no send) — the user guard and the irreversible send
    # both moved to withdraw_execute, which runs on the "Confirm Send" tap.
    _patch(monkeypatch)
    msg = SimpleNamespace(text=VALID_ADDR, reply_text=AsyncMock())
    update = SimpleNamespace(message=msg, effective_user=SimpleNamespace(id=12345))
    ctx = SimpleNamespace(
        user_data={"withdraw_token": "USDC", "withdraw_chain": "base", "withdraw_amount": 1.0}
    )
    assert _run(custodial.withdraw_confirm(update, ctx)) == custodial.CONFIRM_WITHDRAWAL
    msg.reply_text.assert_awaited_once()
    assert "Confirm Withdrawal" in msg.reply_text.await_args.args[0]
    assert ctx.user_data["withdraw_address"] == VALID_ADDR


def test_withdraw_execute_guards_missing_user(monkeypatch):
    _patch(monkeypatch)
    query = SimpleNamespace(answer=AsyncMock(), edit_message_text=AsyncMock())
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=12345))
    ctx = SimpleNamespace(
        user_data={
            "withdraw_token": "USDC",
            "withdraw_chain": "base",
            "withdraw_amount": 1.0,
            "withdraw_address": VALID_ADDR,
        }
    )
    assert _run(custodial.withdraw_execute(update, ctx)) == END
    query.edit_message_text.assert_awaited_once()
    assert "/start" in query.edit_message_text.await_args.args[0]
