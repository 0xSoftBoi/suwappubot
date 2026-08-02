"""Regression test for Phase 4.1 (docs/plans/aegis-fork-extend.md) — external
market text rendered with parse_mode="Markdown" must be escaped.

Polymarket controls a market's `question`; a crafted title with unbalanced
Markdown control chars would otherwise crash the render (Telegram BadRequest)
or inject formatting. Every render site that interpolates a market question /
market_question / external error string into Markdown-rendered text must run
it through `safe_md` first. This covers `_build_market_card` (browse list) as
well as the other render-boundary builders in predict.py.
"""

from bot.handlers.predict import _build_confirmation, _build_market_card, _redeem_error_message
from bot.services.polymarket_api import MarketInfo

MALICIOUS_QUESTION = "Will *_[BREAK]_* `inject` this?"


def test_market_card_strips_markdown_from_external_question():
    market = MarketInfo(
        condition_id="0xabc",
        question=MALICIOUS_QUESTION,
        outcome_yes_price=0.5,
        outcome_no_price=0.5,
    )

    card = _build_market_card(market, index=1)

    # The rendered card carries the (stripped) question but none of its raw
    # Markdown control chars from the untrusted portion.
    assert "BREAK" in card
    assert "inject" in card
    assert "*_[BREAK]_*" not in card
    assert "`inject`" not in card


def test_build_confirmation_strips_markdown_from_external_question():
    """The Buy confirmation card (`_build_confirmation`, used by both the
    callback and message confirmation render paths) must escape the market
    question the same way the browse card does."""
    market = MarketInfo(
        condition_id="0xabc",
        question=MALICIOUS_QUESTION,
        outcome_yes_price=0.5,
        outcome_no_price=0.5,
    )
    pred_data = {
        "selected_market": market,
        "order_outcome": "Yes",
        "order_amount": 10,
    }

    text, _keyboard = _build_confirmation(pred_data)

    assert "BREAK" in text
    assert "inject" in text
    assert "*_[BREAK]_*" not in text
    assert "`inject`" not in text


class _FakeRedeemResult:
    def __init__(self, error: str, error_category: str = ""):
        self.error = error
        self.error_category = error_category


def test_redeem_error_message_strips_markdown_from_external_error():
    """A failed on-chain redeem's `error` string may come from an RPC/exchange
    exception message — treat it as untrusted external text at the Markdown
    render boundary, same as a market question."""
    result = _FakeRedeemResult(MALICIOUS_QUESTION, error_category="")

    msg = _redeem_error_message(result)

    assert "BREAK" in msg
    assert "inject" in msg
    assert "*_[BREAK]_*" not in msg
    assert "`inject`" not in msg
