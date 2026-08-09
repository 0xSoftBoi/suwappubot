"""Tests for the Telegram inline-mode handler (bot/handlers/inline_query.py).

Covers: a known-token price card, the empty-query trending list, an
unknown-token fallback, contract-address detection, referral-link resolution
(known vs unknown bot user), and the never-raises-into-PTB guarantee.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from unittest.mock import AsyncMock, MagicMock

import pytest

from bot.handlers.inline_query import DEFAULT_SYMBOLS, inline_query_handler

SOLANA_ADDRESS = "So11111111111111111111111111111111111111112"


def _make_update(query_text: str, telegram_id: int = 555):
    inline_query = MagicMock()
    inline_query.query = query_text
    inline_query.from_user = MagicMock(id=telegram_id)
    inline_query.answer = AsyncMock()

    update = MagicMock()
    update.inline_query = inline_query
    return update, inline_query


def _make_context(bot_username: str = "suwappubot"):
    context = MagicMock()
    context.bot = MagicMock()
    context.bot.username = bot_username
    return context


@pytest.fixture()
def priced(monkeypatch):
    """Stub out price_service network calls with fixed values."""
    from bot.services.price_service import price_service

    monkeypatch.setattr(price_service, "get_price", AsyncMock(return_value=150.0))
    monkeypatch.setattr(price_service, "get_token_change_24h", AsyncMock(return_value=5.25))
    monkeypatch.setattr(
        price_service,
        "get_prices",
        AsyncMock(return_value={s: 100.0 for s in DEFAULT_SYMBOLS}),
    )
    return price_service


def _seed_user(user_id: int, telegram_id: int):
    from database.db import get_session
    from bot.models.user import User

    with get_session() as session:
        session.add(User(id=user_id, telegram_id=telegram_id))


async def test_known_token_returns_price_card(tmp_db, priced):
    update, inline_query = _make_update("SOL", telegram_id=999)  # unknown user -> plain link
    await inline_query_handler(update, _make_context())

    inline_query.answer.assert_awaited_once()
    args, kwargs = inline_query.answer.call_args
    results = args[0]
    assert kwargs.get("is_personal") is True
    assert kwargs.get("cache_time") == 30

    assert len(results) == 1
    article = results[0]
    assert "SOL" in article.title
    assert "150" in article.title
    button = article.reply_markup.inline_keyboard[0][0]
    assert button.text == "💱 Trade on Suwappu"
    assert button.url.endswith("?start=inline")  # no bot record -> plain link


async def test_known_user_gets_referral_code_in_link(tmp_db, priced):
    _seed_user(user_id=1, telegram_id=555)
    update, inline_query = _make_update("SOL", telegram_id=555)
    await inline_query_handler(update, _make_context())

    results = inline_query.answer.call_args[0][0]
    button = results[0].reply_markup.inline_keyboard[0][0]
    assert "?start=" in button.url
    assert not button.url.endswith("?start=inline")  # a real code was resolved


async def test_empty_query_returns_default_trending_list(tmp_db, priced):
    update, inline_query = _make_update("", telegram_id=555)
    await inline_query_handler(update, _make_context())

    priced.get_prices.assert_awaited_once_with(DEFAULT_SYMBOLS)
    results = inline_query.answer.call_args[0][0]
    assert len(results) == len(DEFAULT_SYMBOLS)
    titles = [r.title for r in results]
    for symbol in DEFAULT_SYMBOLS:
        assert any(symbol in t for t in titles)


async def test_unknown_token_returns_single_no_results_article(tmp_db, priced):
    update, inline_query = _make_update("NOTATOKEN123", telegram_id=555)
    await inline_query_handler(update, _make_context())

    results = inline_query.answer.call_args[0][0]
    assert len(results) == 1
    assert results[0].id == "no_results"


async def test_contract_address_returns_address_card_without_price_fetch(tmp_db, priced):
    update, inline_query = _make_update(SOLANA_ADDRESS, telegram_id=555)
    await inline_query_handler(update, _make_context())

    results = inline_query.answer.call_args[0][0]
    assert len(results) == 1
    assert results[0].id == f"addr_{SOLANA_ADDRESS[:6]}...{SOLANA_ADDRESS[-4:]}"
    assert "Solana" in results[0].title
    # No price lookups for a raw address (metadata fetch is deliberately
    # skipped inline — see module docstring).
    priced.get_price.assert_not_awaited()
    priced.get_token_change_24h.assert_not_awaited()


async def test_never_raises_into_ptb_on_price_service_failure(tmp_db, monkeypatch):
    from bot.services.price_service import price_service

    monkeypatch.setattr(
        price_service, "get_price", AsyncMock(side_effect=RuntimeError("coingecko down"))
    )
    monkeypatch.setattr(price_service, "get_token_change_24h", AsyncMock(return_value=None))

    update, inline_query = _make_update("SOL", telegram_id=555)

    # Must not raise.
    await inline_query_handler(update, _make_context())

    inline_query.answer.assert_awaited_once()
    args, kwargs = inline_query.answer.call_args
    assert args[0] == []
    assert kwargs.get("is_personal") is True


async def test_referral_lookup_failure_falls_back_without_breaking_the_query(
    tmp_db, priced, monkeypatch
):
    """A DB-layer failure while resolving the referral link is swallowed
    internally (plain link fallback) — it must not blank out an otherwise
    healthy price result."""
    monkeypatch.setattr(
        "bot.handlers.inline_query.get_session", MagicMock(side_effect=RuntimeError("db down"))
    )

    update, inline_query = _make_update("SOL", telegram_id=555)
    await inline_query_handler(update, _make_context())

    inline_query.answer.assert_awaited_once()
    results = inline_query.answer.call_args[0][0]
    assert len(results) == 1
    button = results[0].reply_markup.inline_keyboard[0][0]
    assert button.url.endswith("?start=inline")
