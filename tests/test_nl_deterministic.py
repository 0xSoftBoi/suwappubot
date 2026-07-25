"""Tests for the deterministic-first NL trade-intent parsing layer.

MONEY-PATH boundary under test: bot/services/nl_deterministic_parser.py must
never quote/execute a swap (pure regex, zero network calls), and
parse_trade_intent must only fall through to the paid LLM path when the
deterministic parser misses, respecting the daily LLM-fallback caps.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services import nl_intent_service
from bot.services.nl_intent_service import parse_trade_intent
from bot.services.nl_deterministic_parser import parse_deterministic


@pytest.fixture(autouse=True)
def _reset_nl_state():
    nl_intent_service._client = None
    nl_intent_service._openai_client = None
    nl_intent_service._openai_client_key = None
    nl_intent_service._fallback_counts_by_user.clear()
    nl_intent_service._fallback_counts_global.clear()
    yield
    nl_intent_service._client = None
    nl_intent_service._openai_client = None
    nl_intent_service._openai_client_key = None
    nl_intent_service._fallback_counts_by_user.clear()
    nl_intent_service._fallback_counts_global.clear()


# --- parse_deterministic: direct unit coverage ------------------------------


def test_deterministic_swap_en():
    intent = parse_deterministic("swap 50 usdc for eth on base", context={})
    assert intent is not None
    assert intent.action == "swap"
    assert intent.token_in == "USDC"
    assert intent.token_out == "ETH"
    assert intent.amount == 50
    assert intent.amount_unit == "native"
    assert intent.chain == "base"
    assert intent.confidence >= 0.9
    assert intent.clarification is None


def test_deterministic_buy_en():
    intent = parse_deterministic("buy 100 usdc worth of eth", context={})
    # "worth" isn't a recognized connector token for buy; token_out should
    # resolve directly off the first remaining token instead.
    assert intent is None or intent.action == "swap"


def test_deterministic_buy_native_defers_to_llm():
    # "buy 50 eth" is ambiguous in our input-amount model (50 ETH out vs 50 USDC
    # in), so a native-unit buy must defer to the LLM rather than guess a size.
    assert parse_deterministic("buy 50 eth with usdc on base", context={}) is None
    assert parse_deterministic("buy 0.5 eth", context={}) is None


def test_deterministic_buy_usd_parses():
    # USD-denominated buy is unambiguous (spend $50) and safe to parse
    # deterministically; the usd unit is blocked from execution downstream and
    # routes the user to an explicit confirmation.
    intent = parse_deterministic("buy $50 eth on base", context={})
    assert intent is not None
    assert intent.action == "swap"
    assert intent.token_out == "ETH"
    assert intent.token_in == "USDC"
    assert intent.amount == 50
    assert intent.amount_unit == "usd"
    assert intent.chain == "base"


def test_deterministic_sell_en():
    intent = parse_deterministic("sell 25 usdc for eth", context={})
    assert intent is not None
    assert intent.token_in == "USDC"
    assert intent.token_out == "ETH"
    assert intent.amount == 25


def test_deterministic_sell_percent_half():
    intent = parse_deterministic("sell half of usdc for eth", context={})
    assert intent is not None
    assert intent.amount == 50.0
    assert intent.amount_unit == "percent"
    assert intent.token_in == "USDC"
    assert intent.token_out == "ETH"


def test_deterministic_spanish_swap():
    intent = parse_deterministic("cambia 50 usdc por eth", context={})
    assert intent is not None
    assert intent.action == "swap"
    assert intent.token_in == "USDC"
    assert intent.token_out == "ETH"
    assert intent.amount == 50


def test_deterministic_ambiguous_returns_none():
    assert parse_deterministic("please swap some of my crypto around", context={}) is None
    assert parse_deterministic("what do you think about eth", context={}) is None
    assert parse_deterministic("", context={}) is None


def test_deterministic_unknown_token_returns_none():
    assert parse_deterministic("swap 50 fakecoin for eth", context={}) is None


def test_deterministic_unknown_chain_returns_none():
    assert parse_deterministic("swap 50 usdc for eth on marscoinchain", context={}) is None


def test_deterministic_chain_mid_sentence_not_dropped():
    # Regression: the chain-clause regex used to be end-anchored, so trailing
    # filler after the chain clause ("right now") meant no match at all —
    # the chain was silently dropped and confidence stayed 1.0. It must now
    # be found anywhere in the message.
    intent = parse_deterministic("swap 1 eth for usdc on base right now", context={})
    assert intent is not None
    assert intent.chain == "base"
    assert intent.token_in == "ETH"
    assert intent.token_out == "USDC"
    assert intent.confidence == 1.0


def test_deterministic_chain_mid_sentence_with_trailing_filler():
    intent = parse_deterministic("swap 1 eth for usdc on arbitrum please", context={})
    assert intent is not None
    assert intent.chain == "arbitrum"


def test_deterministic_unresolvable_mid_sentence_chain_defers_to_llm():
    # "on" followed by a word that isn't a real chain must still defer to
    # the LLM rather than silently emitting chain=None at confidence=1.0.
    assert parse_deterministic("swap 1 eth for usdc on marscoinchain right now", context={}) is None


# --- parse_trade_intent: deterministic-first wiring -------------------------


@pytest.mark.asyncio
async def test_parse_trade_intent_uses_deterministic_path_without_llm_call():
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock()

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        intent = await parse_trade_intent("swap 50 usdc for eth on base", user_id=1)

    assert intent.action == "swap"
    assert intent.confidence >= 0.9
    fake_client.messages.create.assert_not_called()


@pytest.mark.asyncio
async def test_parse_trade_intent_falls_back_to_llm_on_ambiguous_input():
    fake_response = SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                input={
                    "action": "unknown",
                    "confidence": 0.1,
                    "amount_unit": "native",
                    "clarification": "Which token?",
                },
            )
        ]
    )
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        intent = await parse_trade_intent("please swap some of my crypto around", user_id=1)

    fake_client.messages.create.assert_awaited_once()
    assert intent.action == "unknown"


# --- Groq provider resolution -----------------------------------------------


def test_resolve_provider_config_groq_default_model():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "groq"),
        patch.object(nl_intent_service.settings, "GROQ_API_KEY", "gk"),
        patch.object(nl_intent_service.settings, "NL_TRADING_MODEL", "claude-haiku-4-5-20251001"),
        patch.object(nl_intent_service.settings, "NL_TRADING_BASE_URL", ""),
    ):
        provider, api_key, base_url, model = nl_intent_service._resolve_provider_config()
    assert provider == "groq"
    assert api_key == "gk"
    assert base_url == "https://api.groq.com/openai/v1"
    assert model == "llama-3.1-8b-instant"


def test_resolve_provider_config_groq_explicit_model_and_base_url():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "groq"),
        patch.object(nl_intent_service.settings, "GROQ_API_KEY", "gk"),
        patch.object(nl_intent_service.settings, "NL_TRADING_MODEL", "llama-3.3-70b-versatile"),
        patch.object(nl_intent_service.settings, "NL_TRADING_BASE_URL", "https://custom.groq/v1"),
    ):
        provider, api_key, base_url, model = nl_intent_service._resolve_provider_config()
    assert model == "llama-3.3-70b-versatile"
    assert base_url == "https://custom.groq/v1"


# --- LLM fallback daily caps -------------------------------------------------


@pytest.mark.asyncio
async def test_llm_fallback_per_user_daily_cap_blocks_llm_call():
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(
        return_value=SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    input={"action": "unknown", "confidence": 0.1, "amount_unit": "native"},
                )
            ]
        )
    )

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch.object(nl_intent_service.settings, "NL_LLM_FALLBACK_PER_USER_DAILY", 1),
        patch.object(nl_intent_service.settings, "NL_LLM_FALLBACK_GLOBAL_DAILY", 5000),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        first = await parse_trade_intent("please swap some of my crypto around", user_id=42)
        assert fake_client.messages.create.await_count == 1

        second = await parse_trade_intent("please swap some of my crypto around", user_id=42)

    # Cap of 1 already consumed by the first ambiguous call — the second
    # must degrade WITHOUT invoking the LLM again.
    assert fake_client.messages.create.await_count == 1
    assert second.action == "unknown"
    assert second.clarification is not None


@pytest.mark.asyncio
async def test_llm_fallback_global_daily_cap_blocks_llm_call():
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(
        return_value=SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    input={"action": "unknown", "confidence": 0.1, "amount_unit": "native"},
                )
            ]
        )
    )

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch.object(nl_intent_service.settings, "NL_LLM_FALLBACK_PER_USER_DAILY", 5000),
        patch.object(nl_intent_service.settings, "NL_LLM_FALLBACK_GLOBAL_DAILY", 1),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        await parse_trade_intent("please swap some of my crypto around", user_id=1)
        assert fake_client.messages.create.await_count == 1

        result = await parse_trade_intent("please swap some of my crypto around", user_id=2)

    assert fake_client.messages.create.await_count == 1
    assert result.action == "unknown"
