"""Tests for bot.utils.telegram_safe — the Markdown crash-prevention helper.

Rendering dynamic content with parse_mode="Markdown" crashes Telegram on
unbalanced control chars; safe_md strips them. This guards that behavior since
the helper is now used across many handlers.
"""

from bot.utils.telegram_safe import safe_md


def test_strips_markdown_control_chars():
    assert safe_md("*HACK_me`[x]") == "HACKmex"


def test_keeps_safe_chars():
    # Dashes, dots, slashes, parens-free content must survive unchanged.
    assert safe_md("ETH-USD") == "ETH-USD"
    assert safe_md("Trump 2024?") == "Trump 2024?"


def test_handles_none_and_non_str():
    assert safe_md(None) == ""
    assert safe_md(123) == "123"


def test_truncation_safe_after_strip():
    # A control char that would be orphaned by truncation is already gone.
    assert "_" not in safe_md("long_market_question_with_unders")[:10]
