"""Tests for natural-language trade intent parsing + handler wiring.

MONEY-PATH boundary under test: bot/services/nl_intent_service.py must never
quote/execute a swap (pure text -> TradeIntent), and
bot/handlers/nl_trade.py must hand off "swap" intents to the EXISTING
quickswap_command entry point (bot/handlers/quickswap.py) rather than
reimplementing quoting/execution.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services import nl_intent_service
from bot.services.nl_intent_service import TradeIntent, parse_trade_intent
from bot.handlers import nl_trade


@pytest.fixture(autouse=True)
def _reset_nl_client_cache():
    """The Anthropic client is now a lazily-cached module-level singleton;
    reset it between tests so each test's patched client is actually used."""
    nl_intent_service._client = None
    nl_intent_service._openai_client = None
    nl_intent_service._openai_client_key = None
    yield
    nl_intent_service._client = None
    nl_intent_service._openai_client = None
    nl_intent_service._openai_client_key = None


# handle_nl_text is wrapped in @enforce_tos, which hits the DB to check
# tos_accepted. Bypass that DB round-trip for these unit tests — TOS
# enforcement itself is covered elsewhere.
@pytest.fixture(autouse=True)
def _accept_tos():
    with patch("bot.utils.tos_utils.tos_service.is_accepted_telegram", return_value=True):
        yield


def _make_tool_use_response(data: dict):
    block = SimpleNamespace(type="tool_use", input=data)
    return SimpleNamespace(content=[block])


def _make_update(text: str):
    update = MagicMock()
    update.message = MagicMock()
    update.message.text = text
    update.message.reply_text = AsyncMock()
    update.effective_user = MagicMock(id=123)
    return update


def _make_context():
    context = MagicMock()
    context.args = None
    return context


# --- parse_trade_intent (LLM parsing layer) --------------------------------


@pytest.mark.asyncio
async def test_parse_trade_intent_no_api_key_returns_fallback():
    # Ambiguous text so the deterministic parser misses and the missing-key
    # LLM fallback path is actually exercised.
    with patch.object(nl_trade.settings, "ANTHROPIC_API_KEY", ""):
        intent = await parse_trade_intent("please swap some of my crypto around")
    assert intent.action == "unknown"
    assert intent.clarification is not None
    assert intent.confidence == 0.0


@pytest.mark.asyncio
async def test_parse_trade_intent_extracts_clear_swap():
    fake_response = _make_tool_use_response(
        {
            "action": "swap",
            "token_in": "USDC",
            "token_out": "ETH",
            "amount": 50,
            "amount_unit": "native",
            "chain": "base",
            "confidence": 0.95,
            "clarification": None,
        }
    )
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        intent = await parse_trade_intent("swap 50 usdc for eth on base")

    assert intent.action == "swap"
    assert intent.token_in == "USDC"
    assert intent.token_out == "ETH"
    assert intent.amount == 50
    assert intent.chain == "base"
    assert intent.confidence >= 0.6
    assert intent.clarification is None


@pytest.mark.asyncio
async def test_parse_trade_intent_ambiguous_swap_gets_clarification_not_executed():
    """Missing token_out -> low confidence + clarification, never a 'ready' swap intent."""
    fake_response = _make_tool_use_response(
        {
            "action": "swap",
            "token_in": "USDC",
            "token_out": None,
            "amount": 50,
            "amount_unit": "native",
            "chain": None,
            "confidence": 0.9,  # model over-claims confidence
            "clarification": None,
        }
    )
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        intent = await parse_trade_intent("swap 50 usdc")

    # Server-side gate must override the model's optimistic confidence.
    assert intent.clarification is not None
    assert intent.confidence < 0.6


@pytest.mark.asyncio
async def test_parse_trade_intent_no_tool_use_block_returns_fallback():
    fake_response = SimpleNamespace(content=[SimpleNamespace(type="text", text="huh?")])
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        intent = await parse_trade_intent("gibberish")

    assert intent.action == "unknown"


@pytest.mark.asyncio
async def test_parse_trade_intent_never_raises_on_api_error():
    # Deliberately ambiguous (no amount, no resolvable token pair) so the
    # deterministic parser misses and this exercises the LLM error path.
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(side_effect=RuntimeError("network down"))

    with (
        patch("bot.services.nl_intent_service.settings.ANTHROPIC_API_KEY", "fake-key"),
        patch("anthropic.AsyncAnthropic", return_value=fake_client),
    ):
        intent = await parse_trade_intent("please swap some of my crypto around")

    assert intent.action == "unknown"
    assert intent.clarification is not None


@pytest.mark.asyncio
async def test_parse_trade_intent_empty_text_returns_fallback():
    intent = await parse_trade_intent("   ")
    assert intent.action == "unknown"


# --- multi-provider support -------------------------------------------------


@pytest.mark.asyncio
async def test_parse_trade_intent_openai_provider_extracts_swap():
    import json as _json

    fake_args = _json.dumps(
        {
            "action": "swap",
            "token_in": "USDC",
            "token_out": "ETH",
            "amount": 50,
            "amount_unit": "native",
            "chain": "base",
            "confidence": 0.95,
            "clarification": None,
        }
    )
    fake_response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    tool_calls=[SimpleNamespace(function=SimpleNamespace(arguments=fake_args))]
                )
            )
        ]
    )
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_response)

    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "openai"),
        patch.object(nl_intent_service.settings, "OPENAI_API_KEY", "fake-key"),
        patch("openai.AsyncOpenAI", return_value=fake_client),
    ):
        intent = await parse_trade_intent("swap 50 usdc for eth on base")

    assert intent.action == "swap"
    assert intent.token_in == "USDC"
    assert intent.token_out == "ETH"
    assert intent.amount == 50
    assert intent.chain == "base"
    assert intent.confidence >= 0.6
    assert intent.clarification is None


def test_resolve_provider_config_anthropic():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "anthropic"),
        patch.object(nl_intent_service.settings, "ANTHROPIC_API_KEY", "ak"),
        patch.object(nl_intent_service.settings, "NL_TRADING_MODEL", "claude-haiku-4-5-20251001"),
    ):
        provider, api_key, base_url, model = nl_intent_service._resolve_provider_config()
    assert provider == "anthropic"
    assert api_key == "ak"
    assert base_url is None
    assert model == "claude-haiku-4-5-20251001"


def test_resolve_provider_config_openai_default_model_fallback():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "openai"),
        patch.object(nl_intent_service.settings, "OPENAI_API_KEY", "ok"),
        patch.object(nl_intent_service.settings, "NL_TRADING_MODEL", "claude-haiku-4-5-20251001"),
        patch.object(nl_intent_service.settings, "NL_TRADING_BASE_URL", ""),
    ):
        provider, api_key, base_url, model = nl_intent_service._resolve_provider_config()
    assert provider == "openai"
    assert api_key == "ok"
    assert base_url is None
    assert model == "gpt-4o-mini"


def test_resolve_provider_config_openai_explicit_model_override():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "openai"),
        patch.object(nl_intent_service.settings, "OPENAI_API_KEY", "ok"),
        patch.object(nl_intent_service.settings, "NL_TRADING_MODEL", "gpt-4-turbo"),
        patch.object(nl_intent_service.settings, "NL_TRADING_BASE_URL", ""),
    ):
        provider, api_key, base_url, model = nl_intent_service._resolve_provider_config()
    assert model == "gpt-4-turbo"


def test_resolve_provider_config_deepseek():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "deepseek"),
        patch.object(nl_intent_service.settings, "DEEPSEEK_API_KEY", "dk"),
        patch.object(nl_intent_service.settings, "NL_TRADING_MODEL", "claude-haiku-4-5-20251001"),
        patch.object(nl_intent_service.settings, "NL_TRADING_BASE_URL", ""),
    ):
        provider, api_key, base_url, model = nl_intent_service._resolve_provider_config()
    assert provider == "deepseek"
    assert api_key == "dk"
    assert base_url == "https://api.deepseek.com"
    assert model == "deepseek-chat"


@pytest.mark.asyncio
async def test_parse_trade_intent_openai_provider_missing_key_returns_fallback():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "openai"),
        patch.object(nl_intent_service.settings, "OPENAI_API_KEY", ""),
        patch("openai.AsyncOpenAI") as mock_openai_ctor,
    ):
        # Ambiguous text so the deterministic parser misses and this
        # actually exercises the (missing-key) LLM fallback path.
        intent = await parse_trade_intent("please swap some of my crypto around")
    assert intent.action == "unknown"
    mock_openai_ctor.assert_not_called()


@pytest.mark.asyncio
async def test_parse_trade_intent_deepseek_provider_missing_key_returns_fallback():
    with (
        patch.object(nl_intent_service.settings, "NL_TRADING_PROVIDER", "deepseek"),
        patch.object(nl_intent_service.settings, "DEEPSEEK_API_KEY", ""),
        patch("openai.AsyncOpenAI") as mock_openai_ctor,
    ):
        intent = await parse_trade_intent("please swap some of my crypto around")
    assert intent.action == "unknown"
    mock_openai_ctor.assert_not_called()


# --- handle_nl_text (handler wiring / money-path reuse) --------------------


@pytest.mark.asyncio
async def test_handle_nl_text_noop_when_flag_disabled_delegates_to_freeform():
    update = _make_update("hello there")
    context = _make_context()

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", False),
        patch.object(nl_trade, "on_freeform_text", new=AsyncMock()) as mock_freeform,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_freeform.assert_awaited_once_with(update, context)


@pytest.mark.asyncio
async def test_handle_nl_text_confident_swap_calls_quickswap_not_execute_directly():
    """A confident swap intent must be routed through quickswap_command —
    the SAME entry point /s uses — not any bypass of quote/confirm/execute."""
    update = _make_update("swap 50 usdc for eth on base")
    context = _make_context()

    intent = TradeIntent(
        action="swap",
        token_in="USDC",
        token_out="ETH",
        amount=50,
        amount_unit="native",
        chain="base",
        confidence=0.95,
        clarification=None,
    )

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
        patch(
            "bot.handlers.nl_trade.enforce_rate_limit_for_update", new=AsyncMock(return_value=True)
        ),
        patch("bot.handlers.nl_trade.parse_trade_intent", new=AsyncMock(return_value=intent)),
        patch(
            "bot.handlers.nl_trade.get_token_by_symbol", return_value=SimpleNamespace(symbol="X")
        ),
        patch("bot.handlers.nl_trade.get_chain_by_name", return_value=SimpleNamespace(name="base")),
        patch("bot.handlers.nl_trade.quickswap_command", new=AsyncMock()) as mock_quickswap,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_quickswap.assert_awaited_once_with(update, context)
    # Args handed to quickswap must be the plain positional shape /s expects.
    assert context.args == ["50", "USDC", "base", "ETH", "base"]


@pytest.mark.asyncio
async def test_handle_nl_text_ambiguous_intent_does_not_trigger_swap():
    """Ambiguous/low-confidence intent must never fall into the swap branch."""
    update = _make_update("swap some of my usdc")
    context = _make_context()

    intent = TradeIntent(
        action="swap",
        token_in="USDC",
        token_out=None,
        amount=None,
        amount_unit="native",
        chain=None,
        confidence=0.2,
        clarification="Which token would you like to receive, and how much?",
    )

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
        patch(
            "bot.handlers.nl_trade.enforce_rate_limit_for_update", new=AsyncMock(return_value=True)
        ),
        patch("bot.handlers.nl_trade.parse_trade_intent", new=AsyncMock(return_value=intent)),
        patch("bot.handlers.nl_trade.quickswap_command", new=AsyncMock()) as mock_quickswap,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_quickswap.assert_not_awaited()
    update.message.reply_text.assert_awaited_once()
    assert "which token" in update.message.reply_text.call_args[0][0].lower()


@pytest.mark.asyncio
async def test_handle_nl_text_unknown_action_delegates_to_freeform_router():
    """Unrecognized/unclassified free text must not silently vanish — it
    should fall through to the existing paste-to-trade/keyword router."""
    update = _make_update("swap some crypto please")
    context = _make_context()

    intent = TradeIntent(action="unknown", confidence=0.1, clarification=None)

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
        patch(
            "bot.handlers.nl_trade.enforce_rate_limit_for_update", new=AsyncMock(return_value=True)
        ),
        patch("bot.handlers.nl_trade.parse_trade_intent", new=AsyncMock(return_value=intent)),
        patch("bot.handlers.nl_trade.on_freeform_text", new=AsyncMock()) as mock_freeform,
        patch("bot.handlers.nl_trade.quickswap_command", new=AsyncMock()) as mock_quickswap,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_quickswap.assert_not_awaited()
    mock_freeform.assert_awaited_once_with(update, context)


@pytest.mark.asyncio
async def test_handle_nl_text_unknown_token_symbol_does_not_swap():
    update = _make_update("swap 50 fakecoin for eth")
    context = _make_context()

    intent = TradeIntent(
        action="swap",
        token_in="FAKECOIN",
        token_out="ETH",
        amount=50,
        amount_unit="native",
        chain=None,
        confidence=0.9,
        clarification=None,
    )

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
        patch(
            "bot.handlers.nl_trade.enforce_rate_limit_for_update", new=AsyncMock(return_value=True)
        ),
        patch("bot.handlers.nl_trade.parse_trade_intent", new=AsyncMock(return_value=intent)),
        patch("bot.handlers.nl_trade.get_token_by_symbol", return_value=None),
        patch("bot.handlers.nl_trade.quickswap_command", new=AsyncMock()) as mock_quickswap,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_quickswap.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_nl_text_rate_limited_does_not_swap():
    update = _make_update("swap 50 usdc for eth")
    context = _make_context()

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
        patch(
            "bot.handlers.nl_trade.enforce_rate_limit_for_update", new=AsyncMock(return_value=False)
        ),
        patch("bot.handlers.nl_trade.quickswap_command", new=AsyncMock()) as mock_quickswap,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_quickswap.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_nl_text_casual_chatter_does_not_call_parse_trade_intent():
    """Casual non-trade chatter must never trigger the paid LLM parse call."""
    for text in ("hi", "thanks", "gm"):
        update = _make_update(text)
        context = _make_context()

        with (
            patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
            patch(
                "bot.handlers.nl_trade.enforce_rate_limit_for_update",
                new=AsyncMock(return_value=True),
            ),
            patch("bot.handlers.nl_trade.parse_trade_intent", new=AsyncMock()) as mock_parse,
        ):
            await nl_trade.handle_nl_text(update, context)

        mock_parse.assert_not_awaited()


def test_looks_like_trade_text_true_for_trade_like_text():
    assert nl_trade._looks_like_trade_text("swap 50 usdc for eth on base") is True


def test_looks_like_trade_text_false_for_casual_chatter():
    for text in ("hi", "thanks", "gm", "hello there"):
        assert nl_trade._looks_like_trade_text(text) is False


@pytest.mark.asyncio
async def test_handle_nl_text_balance_intent_calls_balance_command():
    update = _make_update("what's my balance")
    context = _make_context()

    intent = TradeIntent(action="balance", confidence=0.9)

    with (
        patch.object(nl_trade.settings, "NL_TRADING_ENABLED", True),
        patch(
            "bot.handlers.nl_trade.enforce_rate_limit_for_update", new=AsyncMock(return_value=True)
        ),
        patch("bot.handlers.nl_trade.parse_trade_intent", new=AsyncMock(return_value=intent)),
        patch("bot.handlers.nl_trade.balance_command", new=AsyncMock()) as mock_balance,
    ):
        await nl_trade.handle_nl_text(update, context)

    mock_balance.assert_awaited_once_with(update, context)
