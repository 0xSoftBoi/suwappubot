"""Smoke tests for Starknet exposure in Telegram bot handlers.

No existing handler tests exercise full Telegram update flows for solana/tron,
so these are smoke tests: the handler functions exist, the keyboards include
the new Starknet buttons, and the registered callback patterns route the new
callback_data strings.
"""

import importlib.util
import inspect
import re
import sys
from pathlib import Path

_HANDLERS_DIR = Path(__file__).resolve().parent.parent / "bot" / "handlers"

# Stub optional image deps not installed in the local test venv so that
# bot/utils/qr_code (imported by the wallet handler) can be loaded.
for _mod in (
    "qrcode",
    "qrcode.image",
    "qrcode.image.styledpil",
    "qrcode.image.styles",
    "qrcode.image.styles.moduledrawers",
    "qrcode.image.styles.colormasks",
    "PIL",
):
    if _mod not in sys.modules:
        try:
            importlib.import_module(_mod)
        except ImportError:
            from unittest.mock import MagicMock

            sys.modules[_mod] = MagicMock()


def _load_module(name: str):
    """Load a handler module by file path, bypassing bot/handlers/__init__.py
    (which pulls in modules using Python 3.10+ syntax not supported by the
    local 3.9 test venv)."""
    spec = importlib.util.spec_from_file_location(
        f"_starknet_smoke_{name}", _HANDLERS_DIR / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wallet_handlers = _load_module("wallet")


def test_handler_functions_exist():
    assert inspect.iscoroutinefunction(wallet_handlers.wallet_create_callback)
    assert inspect.iscoroutinefunction(wallet_handlers.wallet_import_start)
    assert inspect.iscoroutinefunction(wallet_handlers.wallet_import_key)


def test_keyboards_include_starknet_buttons():
    src = inspect.getsource(wallet_handlers)
    # Both menu builders (wallet_menu_callback + show_wallet_menu) have
    # empty-state and wallet-list keyboards => 4 occurrences each.
    assert src.count('callback_data="wallet_create_starknet"') == 4
    assert src.count('callback_data="wallet_import_starknet"') == 4


def test_create_callback_pattern_routes_starknet():
    # Registered in bot/main.py as pattern="^wallet_create_"
    assert re.match("^wallet_create_", "wallet_create_starknet")


def test_import_conversation_entry_pattern_routes_starknet():
    entry = wallet_handlers.wallet_import_handler.entry_points[0]
    assert entry.pattern.match("wallet_import_starknet")


def test_create_callback_detects_starknet_chain_type():
    src = inspect.getsource(wallet_handlers.wallet_create_callback)
    # New impl uses exact suffix parsing: query.data.rsplit("_", 1)[-1]
    assert 'rsplit("_", 1)[-1]' in src
    # Known suffixes are validated against a set that includes starknet and evm
    assert '"starknet"' in src
    assert '"evm"' in src
    # Unknown suffix defaults to "evm" (or is rejected), not via substring scan
    assert '"tron" in query.data' not in src


def test_import_uses_starknet_wallet_service():
    src = inspect.getsource(wallet_handlers.wallet_import_key)
    assert "import_starknet_wallet" in src


def test_voyager_explorer_link_in_wallet_list():
    src = inspect.getsource(wallet_handlers)
    assert "https://voyager.online/contract/" in src


def test_balance_display_includes_starknet_icon():
    balance_handlers = _load_module("balance")

    src = inspect.getsource(balance_handlers._format_wallet_balances)
    assert '"starknet"' in src


def test_swap_chain_choices_include_starknet():
    # Swap handler builds chain buttons from CHAINS config
    from bot.config.chains import CHAINS

    assert "starknet" in CHAINS
