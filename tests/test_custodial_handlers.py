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

# Load bot/handlers/custodial.py directly by path (see the sibling
# test_custodial_withdraw_null_user.py for the rationale: importing via the
# package would execute bot/handlers/__init__.py which uses 3.10+ annotations).
_CUSTODIAL_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "bot"
    / "handlers"
    / "custodial.py"
)
_spec = importlib.util.spec_from_file_location(
    "bot_handlers_custodial_validation_under_test", _CUSTODIAL_PATH
)
custodial = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(custodial)


# A real, valid Solana address (44-char base58, decodes to 32 bytes).
VALID_SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
# A valid 42-char EVM address.
VALID_EVM_ADDRESS = "0x" + "a" * 40


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@contextmanager
def _session_returning_none():
    """get_session() whose user lookup returns None, so the handler short
    circuits right after address validation passes (no DB / network needed)."""
    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = None
    yield session


def _invoke_withdraw_confirm(monkeypatch, *, address, chain):
    """Drive withdraw_confirm() with the given address text and selected chain.

    Returns (result_state, reply_text_arg) where reply_text_arg is the message
    sent to the user (the first positional arg of message.reply_text), or None
    if reply_text was not called.
    """
    monkeypatch.setattr(custodial, "get_session", _session_returning_none)

    # If validation passes, the handler proceeds to the DB lookup (which returns
    # None via the stubbed session) and replies with a /start message. It must
    # never reach the actual balance update / on-chain path in these tests.
    def _should_not_be_called(*_args, **_kwargs):
        raise AssertionError("withdrawal execution reached unexpectedly")

    monkeypatch.setattr(
        custodial.hot_wallet_service,
        "update_custodial_balance",
        _should_not_be_called,
    )

    message = SimpleNamespace(text=address, reply_text=AsyncMock())
    update = SimpleNamespace(
        message=message,
        effective_user=SimpleNamespace(id=12345),
    )
    context = SimpleNamespace(
        user_data={
            "withdraw_token": "USDC",
            "withdraw_chain": chain,
            "withdraw_amount": 1.0,
        }
    )

    result = _run(custodial.withdraw_confirm(update, context))
    reply_arg = None
    if message.reply_text.await_args is not None:
        reply_arg = message.reply_text.await_args.args[0]
    return result, reply_arg


def test_valid_evm_address_accepted(monkeypatch):
    result, reply = _invoke_withdraw_confirm(
        monkeypatch, address=VALID_EVM_ADDRESS, chain="base"
    )
    # Validation passed: handler proceeded past it and hit the missing-user
    # short circuit ("/start"), not the "Invalid ... address" rejection.
    assert "Invalid" not in (reply or "")
    assert "/start" in (reply or "")


def test_valid_solana_address_accepted(monkeypatch):
    result, reply = _invoke_withdraw_confirm(
        monkeypatch, address=VALID_SOLANA_ADDRESS, chain="solana"
    )
    # This is the core regression: a valid Solana address must NOT be rejected.
    assert "Invalid" not in (reply or "")
    assert "/start" in (reply or "")


def test_invalid_evm_address_rejected(monkeypatch):
    result, reply = _invoke_withdraw_confirm(
        monkeypatch, address="0xnot-a-real-address", chain="base"
    )
    assert result == custodial.CONFIRM_WITHDRAWAL
    assert "Invalid" in (reply or "")


def test_invalid_solana_address_rejected(monkeypatch):
    result, reply = _invoke_withdraw_confirm(
        monkeypatch, address="not-base58-0OIl!!", chain="solana"
    )
    assert result == custodial.CONFIRM_WITHDRAWAL
    assert "Invalid" in (reply or "")


def test_evm_address_rejected_when_chain_is_solana(monkeypatch):
    # An EVM-style address is not valid base58/32-byte Solana pubkey, so it must
    # be rejected when the selected chain is Solana.
    result, reply = _invoke_withdraw_confirm(
        monkeypatch, address=VALID_EVM_ADDRESS, chain="solana"
    )
    assert result == custodial.CONFIRM_WITHDRAWAL
    assert "Invalid" in (reply or "")
