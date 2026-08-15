"""Smoke tests for the /btc BTC bridge handlers (Starknet Phase 3).

Per the handler-test conventions (tests/test_starknet_handlers.py): load the
handler module directly by path, assert keyboards contain the expected
buttons, validate sats/destination input paths, and check every callback_data
string the handlers emit is routed by a registered pattern (dead-button
audit).
"""

import importlib
import importlib.util
import inspect
import re
import sys
from pathlib import Path

import pytest

_HANDLERS_DIR = Path(__file__).resolve().parent.parent / "bot" / "handlers"

# Stub optional image deps not installed in the local test venv (qr_code util).
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
    """Load a handler module by file path, bypassing bot/handlers/__init__.py."""
    spec = importlib.util.spec_from_file_location(
        f"_btc_smoke_{name}", _HANDLERS_DIR / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


btc_handlers = _load_module("btc")


def test_handler_functions_exist():
    for fn in (
        btc_handlers.btc_command,
        btc_handlers.btc_menu_callback,
        btc_handlers.btc_deposit_callback,
        btc_handlers.btc_dep_dest_callback,
        btc_handlers.btc_withdraw_callback,
        btc_handlers.btc_wallet_callback,
        btc_handlers.btc_new_wallet_callback,
        btc_handlers.btc_dep_amount,
        btc_handlers.btc_wd_dest,
        btc_handlers.btc_wd_amount,
        btc_handlers.btc_exec_callback,
        btc_handlers.btc_swaps_callback,
        btc_handlers.btc_close_callback,
        btc_handlers.btc_cancel,
    ):
        assert inspect.iscoroutinefunction(fn)


def test_menu_keyboard_has_all_buttons():
    src = inspect.getsource(btc_handlers._render_menu)
    assert 'callback_data="btc_deposit"' in src
    assert 'callback_data="btc_withdraw"' in src
    assert 'callback_data="btc_swaps"' in src
    assert 'callback_data="btc_close"' in src
    assert "Deposit via Lightning" in src
    assert "Withdraw to BTC/Lightning" in src
    assert "My BTC swaps" in src


def test_wallet_pick_offers_inline_create():
    src = inspect.getsource(btc_handlers._render_wallet_pick)
    assert 'callback_data="btc_new_wallet"' in src
    assert 'callback_data="btc_menu"' in src
    assert "btc_w_" in src


def _conversation_patterns():
    """All regex patterns registered on the conversation handler."""
    conv = btc_handlers.btc_conversation_handler
    handlers = list(conv.entry_points) + list(conv.fallbacks)
    for state_handlers in conv.states.values():
        handlers.extend(state_handlers)
    return [h.pattern for h in handlers if getattr(h, "pattern", None)]


# Every callback_data string emitted by bot/handlers/btc.py
_EMITTED_CALLBACKS = [
    "btc_deposit",
    "btc_withdraw",
    "btc_swaps",
    "btc_close",
    "btc_menu",
    "btc_new_wallet",
    "btc_w_42",
    "btc_exec",
    "btc_dst_starknet",
    "btc_dst_citrea",
]


@pytest.mark.parametrize("callback_data", _EMITTED_CALLBACKS)
def test_no_dead_buttons(callback_data):
    """Every btc_* callback_data routes to a registered conversation pattern."""
    patterns = _conversation_patterns()
    assert any(p.match(callback_data) for p in patterns), f"dead button: {callback_data}"


def test_globally_routed_callbacks_used():
    """main_menu is registered globally in bot/main.py — just confirm usage shape."""
    src = inspect.getsource(btc_handlers)
    emitted = set(re.findall(r'callback_data=f?"([^"]+)"', src))
    # Everything emitted is either btc_* (conversation) or main_menu (global).
    for cb in emitted:
        assert cb.startswith("btc_") or cb == "main_menu", cb


def test_registered_in_bot_main():
    main_src = (Path(__file__).resolve().parent.parent / "bot" / "main.py").read_text()
    assert "from bot.handlers.btc import btc_conversation_handler" in main_src
    assert "application.add_handler(btc_conversation_handler)" in main_src
    assert 'BotCommand("btc"' in main_src


# ── Deposit destination step ─────────────────────────────────────────────────


def test_deposit_offers_destination_choice():
    src = inspect.getsource(btc_handlers.btc_deposit_callback)
    assert 'callback_data="btc_dst_starknet"' in src
    assert 'callback_data="btc_dst_citrea"' in src
    assert 'callback_data="btc_menu"' in src
    # Starknet is listed first (the default), Citrea is flagged as early
    assert src.index("btc_dst_starknet") < src.index("btc_dst_citrea")


def test_deposit_destinations_botanix_never_offered():
    assert set(btc_handlers.DEPOSIT_DESTINATIONS) == {"starknet", "citrea"}
    assert "botanix" not in btc_handlers.DEPOSIT_DESTINATIONS
    src = inspect.getsource(btc_handlers).lower()
    assert 'callback_data="btc_dst_botanix"' not in src
    # the bridge-level denylist constant exists and covers botanix
    from bot.services.btc_bridge import BOTANIX_DENYLIST, DEPOSIT_DST_CHAINS

    assert "botanix" in BOTANIX_DENYLIST
    assert "botanix" not in DEPOSIT_DST_CHAINS


def test_destination_wallet_chain_types():
    dests = btc_handlers.DEPOSIT_DESTINATIONS
    assert dests["starknet"]["wallet_chain_type"] == "starknet"
    assert dests["starknet"]["asset"] == "WBTC"
    assert dests["citrea"]["wallet_chain_type"] == "evm"
    assert dests["citrea"]["asset"] == "cBTC"


def test_dep_dest_state_registered():
    conv = btc_handlers.btc_conversation_handler
    patterns = [
        h.pattern.pattern
        for h in conv.states[btc_handlers.BTC_DEP_DEST]
        if getattr(h, "pattern", None)
    ]
    assert "^btc_dst_" in patterns
    assert "^btc_menu$" in patterns


def test_dep_amount_plumbs_dst_chain_to_bridge():
    src = inspect.getsource(btc_handlers.btc_dep_amount)
    assert "dst_chain=dst_chain" in src


# ── Sats validation ──────────────────────────────────────────────────────────


def test_parse_sats_accepts_plain_and_separated_ints():
    assert btc_handlers._parse_sats("5000") == 5000
    assert btc_handlers._parse_sats("1,000,000") == 1_000_000
    assert btc_handlers._parse_sats(" 250_000 ") == 250_000


def test_parse_sats_rejects_garbage():
    assert btc_handlers._parse_sats("0") is None
    assert btc_handlers._parse_sats("-5") is None
    assert btc_handlers._parse_sats("0.5 btc") is None
    assert btc_handlers._parse_sats("") is None
    assert btc_handlers._parse_sats(None) is None


def test_default_lightning_limits():
    assert btc_handlers.DEFAULT_LN_MIN_SATS == 100
    assert btc_handlers.DEFAULT_LN_MAX_SATS == 2_000_000


def test_onchain_minimum_enforced_in_withdraw_amount():
    src = inspect.getsource(btc_handlers.btc_wd_amount)
    assert "MIN_BTC_OUT_SATS" in src
    from bot.services.btc_bridge import MIN_BTC_OUT_SATS

    assert MIN_BTC_OUT_SATS == 11_548


# ── Destination validation paths ─────────────────────────────────────────────


def test_destination_routing_paths():
    src = inspect.getsource(btc_handlers.btc_wd_dest)
    # Validates via the bridge's parseAddress
    assert "parse_address" in src
    # BITCOIN → ask sats; LIGHTNING → straight to confirm (invoice carries amount)
    assert '"BITCOIN"' in src
    assert '"LIGHTNING"' in src
    assert "BTC_WD_AMOUNT" in src
    assert "_show_wd_confirm" in src


def test_confirm_screen_is_money_path_gated():
    src = inspect.getsource(btc_handlers._show_wd_confirm)
    assert 'callback_data="btc_exec"' in src  # confirm
    assert 'callback_data="btc_menu"' in src  # cancel


# ── Explorer links ───────────────────────────────────────────────────────────


def test_tx_links_route_by_hash_shape():
    stark = btc_handlers._tx_link("0x" + "ab" * 32)
    btc = btc_handlers._tx_link("f" * 64)
    assert "voyager.online/tx/0x" in stark
    assert "mempool.space/tx/" in btc


def test_invoice_reply_contains_code_block_and_lightning_link():
    src = inspect.getsource(btc_handlers.btc_dep_amount)
    assert "`{invoice}`" in src
    assert "lightning:{invoice}" in src
