"""Smoke tests for /borrow (bot/handlers/borrow.py) + the Morpho /save venue.

All mocked, no network:
- LTV option math (25% / 50% / 64.5%) against the oracle price scale
- HF emoji tiers
- open-borrow confirm text ALWAYS contains the liquidation price
- withdraw-block message when post-withdraw HF < MIN_WITHDRAW_HF
- max-safe-withdraw math agrees with the service health-floor check
- keyboards/states registered; dead-button audit: every borrow_* / save_morpho*
  callback emitted by the handler modules matches a registered pattern
  (extraction pattern reused from tests/test_starknet_yield.py)
"""

import asyncio
import math
import os
import re

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.config.morpho_config import (
    DEFAULT_LTV,
    LLTV,
    MAX_LTV,
    MIN_WITHDRAW_HF,
    WAD,
)
from bot.services.morpho_api import compute_health_factor

# 1 BTC = $100,000 → oracle price() is 1e34-scaled USD/BTC
PRICE = 100_000 * 10**34
ONE_BTC = 10**8  # cbBTC raw


def _load_module(filename, alias):
    """Load a handler module directly, bypassing bot/handlers/__init__.py
    (same pattern as tests/test_starknet_yield.py)."""
    import importlib.util
    import pathlib
    import sys

    if alias in sys.modules:
        return sys.modules[alias]
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())
    path = pathlib.Path(__file__).resolve().parents[1] / "bot" / "handlers" / filename
    spec = importlib.util.spec_from_file_location(alias, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[alias] = module
    spec.loader.exec_module(module)
    return module


def _borrow_module():
    return _load_module("borrow.py", "borrow_handler_under_test")


def _savings_module():
    return _load_module("savings.py", "savings_handler_under_test_morpho")


def _conv_patterns(conv):
    from telegram.ext import CallbackQueryHandler

    patterns = []
    for handler_list in list(conv.states.values()) + [conv.entry_points, conv.fallbacks]:
        for h in handler_list:
            if isinstance(h, CallbackQueryHandler) and h.pattern is not None:
                patterns.append(h.pattern)
    return patterns


# ---------------------------------------------------------------------------
# LTV math
# ---------------------------------------------------------------------------


class TestLtvMath:
    def test_ltv_options_keys_and_values(self):
        mod = _borrow_module()
        assert set(mod.LTV_OPTIONS) == {"25", "50", "645"}
        assert mod.LTV_OPTIONS["25"][1] == 0.25
        assert mod.LTV_OPTIONS["50"][1] == DEFAULT_LTV == 0.50
        assert mod.LTV_OPTIONS["645"][1] == MAX_LTV == 0.645

    @pytest.mark.parametrize("ltv,expected_usdc", [(0.25, 25_000), (0.50, 50_000), (0.645, 64_500)])
    def test_borrow_for_ltv_one_btc_at_100k(self, ltv, expected_usdc):
        mod = _borrow_module()
        raw = mod._borrow_for_ltv(ONE_BTC, PRICE, ltv)
        assert raw == expected_usdc * 10**6

    def test_borrow_for_ltv_never_exceeds_max_cap(self):
        mod = _borrow_module()
        # Max-LTV borrow against full collateral stays under the protocol LLTV.
        raw = mod._borrow_for_ltv(ONE_BTC, PRICE, MAX_LTV)
        lltv_max = mod._borrow_for_ltv(ONE_BTC, PRICE, LLTV / WAD)
        assert raw < lltv_max

    def test_50pct_ltv_health_factor_is_lltv_over_half(self):
        mod = _borrow_module()
        debt = mod._borrow_for_ltv(ONE_BTC, PRICE, 0.50)
        hf = compute_health_factor(ONE_BTC, PRICE, debt)
        assert hf == pytest.approx((LLTV / WAD) / 0.50, rel=1e-6)  # 1.72


# ---------------------------------------------------------------------------
# HF emoji tiers
# ---------------------------------------------------------------------------


class TestHfEmoji:
    def test_tiers(self):
        mod = _borrow_module()
        assert mod._hf_emoji(math.inf) == "🟢"
        assert mod._hf_emoji(1.72) == "🟢"
        assert mod._hf_emoji(1.3) == "🟡"
        assert mod._hf_emoji(1.1) == "🟠"
        assert mod._hf_emoji(1.0) == "🔴"

    def test_fmt_hf_infinity(self):
        mod = _borrow_module()
        assert mod._fmt_hf(math.inf) == "∞"
        assert mod._fmt_hf(1.234) == "1.23"


# ---------------------------------------------------------------------------
# confirm screen: liquidation price is load-bearing
# ---------------------------------------------------------------------------


class TestConfirmText:
    def test_open_confirm_contains_liquidation_price_ltv_hf_apy(self):
        mod = _borrow_module()
        debt = mod._borrow_for_ltv(ONE_BTC, PRICE, 0.50)
        preview = {
            "ltv": 0.50,
            "health_factor": 1.72,
            "liquidation_price": 58_139.5,
            "btc_price_usd": 100_000.0,
            "max_ltv": MAX_LTV,
        }
        text = mod._format_open_confirm(ONE_BTC, debt, preview, "5.60%")
        assert "Liquidation Price" in text
        assert "$58,140" in text or "$58,139" in text
        assert "50.0%" in text  # LTV
        assert "1.72" in text  # HF
        assert "5.60%" in text  # borrow APY
        assert "64.5%" in text  # max LTV cap shown


# ---------------------------------------------------------------------------
# withdraw block + max-safe math
# ---------------------------------------------------------------------------


class TestWithdrawGuard:
    def test_block_text_mentions_floor_and_hf(self):
        mod = _borrow_module()
        text = mod._withdraw_block_text(1.04)
        assert "blocked" in text.lower()
        assert "1.04" in text
        assert str(MIN_WITHDRAW_HF) in text

    def test_max_safe_withdraw_keeps_hf_at_floor(self):
        mod = _borrow_module()
        debt = 50_000 * 10**6  # $50k against 1 BTC at $100k
        max_safe = mod._max_safe_withdraw_raw(ONE_BTC, PRICE, debt)
        assert 0 < max_safe < ONE_BTC
        hf_at_limit = compute_health_factor(ONE_BTC - max_safe, PRICE, debt)
        assert hf_at_limit >= MIN_WITHDRAW_HF
        # One more sat withdrawn breaks the floor — the bound is tight.
        hf_past = compute_health_factor(ONE_BTC - max_safe - 1, PRICE, debt)
        assert hf_past < MIN_WITHDRAW_HF or hf_at_limit == pytest.approx(MIN_WITHDRAW_HF, 1e-4)

    def test_max_safe_withdraw_no_debt_returns_all(self):
        mod = _borrow_module()
        assert mod._max_safe_withdraw_raw(ONE_BTC, PRICE, 0) == ONE_BTC


# ---------------------------------------------------------------------------
# BTC amount validation (8dp)
# ---------------------------------------------------------------------------


class TestBtcAmountValidation:
    def test_valid(self):
        mod = _borrow_module()
        assert mod._parse_btc_amount("0.0005") == 50_000
        assert mod._parse_btc_amount("1") == 100_000_000
        assert mod._parse_btc_amount("0.00000001") == 1

    def test_invalid(self):
        mod = _borrow_module()
        assert mod._parse_btc_amount("0.000000001") is None  # 9 dp
        assert mod._parse_btc_amount("0") is None
        assert mod._parse_btc_amount("-1") is None
        assert mod._parse_btc_amount("abc") is None
        assert mod._parse_btc_amount("") is None


# ---------------------------------------------------------------------------
# keyboards / states / dead-button audit
# ---------------------------------------------------------------------------


class TestDeadButtonAudit:
    def test_every_emitted_borrow_callback_is_handled(self):
        """Every borrow_* callback_data emitted in bot/handlers/borrow.py must
        match a registered CallbackQueryHandler pattern in the conversation."""
        import inspect

        mod = _borrow_module()
        conv = mod.borrow_conversation_handler
        source = inspect.getsource(mod)

        emitted = set(re.findall(r'callback_data="(borrow_[^"]*)"', source))
        # f-string buttons: borrow_w_{w.id} and borrow_ltv_{key}
        for fstring in re.findall(r'callback_data=f"(borrow_[^"]*)"', source):
            emitted.discard(fstring)
            if "borrow_w_" in fstring:
                emitted.add("borrow_w_123")
            elif "borrow_ltv_" in fstring:
                for key in mod.LTV_OPTIONS:
                    emitted.add(f"borrow_ltv_{key}")
        assert emitted, "expected borrow buttons in the handler"

        patterns = _conv_patterns(conv)
        for data in sorted(emitted):
            assert any(
                p.search(data) for p in patterns
            ), f"dead button: callback_data {data!r} matches no registered pattern"

    def test_ltv_pattern_rejects_unknown_keys(self):
        mod = _borrow_module()
        patterns = _conv_patterns(mod.borrow_conversation_handler)
        for bogus in ("borrow_ltv_86", "borrow_ltv_", "borrow_ltv_50x", "borrow_w_abc"):
            assert not any(p.search(bogus) for p in patterns), f"{bogus!r} matched"

    def test_all_states_registered(self):
        mod = _borrow_module()
        conv = mod.borrow_conversation_handler
        for state in (
            mod.BORROW_MENU,
            mod.BORROW_SELECT_WALLET,
            mod.BORROW_ENTER_COLLATERAL,
            mod.BORROW_SELECT_LTV,
            mod.BORROW_CONFIRM,
            mod.BORROW_MANAGE_AMOUNT,
            mod.BORROW_MANAGE_CONFIRM,
        ):
            assert state in conv.states

    def test_borrow_command_is_entry_point(self):
        from telegram.ext import CommandHandler

        mod = _borrow_module()
        commands = set()
        for h in mod.borrow_conversation_handler.entry_points:
            if isinstance(h, CommandHandler):
                commands |= set(h.commands)
        assert "borrow" in commands

    def test_every_emitted_save_morpho_callback_is_handled(self):
        """The new Morpho venue buttons in /save must all be registered."""
        import inspect

        mod = _savings_module()
        conv = mod.savings_conversation_handler
        source = inspect.getsource(mod)

        emitted = set(re.findall(r'callback_data="(save_morpho[^"]*)"', source))
        assert emitted, "expected save_morpho buttons in savings.py"
        patterns = _conv_patterns(conv)
        for data in sorted(emitted):
            assert any(
                p.search(data) for p in patterns
            ), f"dead button: callback_data {data!r} matches no registered pattern"

    def test_morpho_states_registered_in_savings(self):
        mod = _savings_module()
        conv = mod.savings_conversation_handler
        for state in (mod.SAVE_MORPHO_MENU, mod.SAVE_MORPHO_AMOUNT, mod.SAVE_MORPHO_CONFIRM):
            assert state in conv.states
