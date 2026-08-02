"""Regression test for Phase 4.1 (docs/plans/aegis-fork-extend.md) — external
market text rendered with parse_mode="Markdown" must be escaped.

Polymarket controls a market's `question`; a crafted title with unbalanced
Markdown control chars would otherwise crash the render (Telegram BadRequest)
or inject formatting. `_build_market_card` must run it through safe_md.
"""

from bot.handlers.predict import _build_market_card
from bot.services.polymarket_api import MarketInfo


def test_market_card_strips_markdown_from_external_question():
    market = MarketInfo(
        condition_id="0xabc",
        question="Will *_[BREAK]_* `inject` this?",
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
