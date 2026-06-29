"""Tests for bot/i18n.py — get_text() and get_user_lang()."""

from types import SimpleNamespace

import pytest

from bot.i18n import get_text, get_user_lang

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user(language_code):
    """Return a minimal user-like object with a language_code attribute."""
    return SimpleNamespace(language_code=language_code)


# ---------------------------------------------------------------------------
# get_text — happy paths
# ---------------------------------------------------------------------------


def test_get_text_english():
    text = get_text("balance_header", "en")
    assert "Balance" in text


def test_get_text_spanish():
    text = get_text("balance_header", "es")
    assert "saldo" in text


def test_get_text_french():
    text = get_text("balance_header", "fr")
    assert "solde" in text


def test_get_text_chinese():
    text = get_text("balance_header", "zh")
    assert "余额" in text


# ---------------------------------------------------------------------------
# get_text — fallback behaviour
# ---------------------------------------------------------------------------


def test_get_text_unknown_lang_falls_back_to_english():
    text = get_text("balance_header", "de")
    # Should return the English string
    assert "Balance" in text


def test_get_text_unknown_key_returns_nonempty_string():
    text = get_text("totally_nonexistent_key_xyz", "en")
    assert isinstance(text, str)
    assert len(text) > 0


def test_get_text_missing_kwarg_does_not_crash():
    # wallet_created expects chain_name, chain_emoji, address, provider_note
    # Passing nothing — must not raise
    text = get_text("wallet_created", "en")
    assert isinstance(text, str)
    assert len(text) > 0


# ---------------------------------------------------------------------------
# get_text — string interpolation
# ---------------------------------------------------------------------------


def test_get_text_interpolation_chain_name():
    text = get_text(
        "wallet_created",
        "en",
        chain_name="Solana",
        chain_emoji="◎",
        address="So1ana1111111",
        provider_note="Custodied by Suwappu",
    )
    assert "Solana" in text
    assert "So1ana1111111" in text


# ---------------------------------------------------------------------------
# get_user_lang — detection
# ---------------------------------------------------------------------------


def test_get_user_lang_spanish():
    assert get_user_lang(_user("es")) == "es"


def test_get_user_lang_spanish_regional():
    assert get_user_lang(_user("es-MX")) == "es"


def test_get_user_lang_chinese_simplified():
    assert get_user_lang(_user("zh-CN")) == "zh"


def test_get_user_lang_french():
    assert get_user_lang(_user("fr")) == "fr"


def test_get_user_lang_unsupported_falls_back_to_english():
    assert get_user_lang(_user("de")) == "en"


def test_get_user_lang_none_language_code():
    assert get_user_lang(_user(None)) == "en"


def test_get_user_lang_none_user():
    assert get_user_lang(None) == "en"
