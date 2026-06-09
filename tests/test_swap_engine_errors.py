"""Tests for bot/services/swap_engine.py — error paths and edge cases.

Covers: all-providers-fail, best-quote selection when some fail, TRON
cross-chain rejection, token-not-found, _is_retryable_rpc_error classification,
and stale-quote detection.  The full provider integration is monkeypatched.
"""

# Must be set before any bot module imports to satisfy pydantic_settings validation.
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")  # noqa: E402
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")  # noqa: E402
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")  # noqa: E402
os.environ.setdefault("KMS_PROVIDER", "dev")  # noqa: E402

import asyncio  # noqa: E402
from datetime import datetime, timezone, timedelta  # noqa: E402

import pytest  # noqa: E402

from bot.services.swap_engine import SwapEngine, SwapQuote  # noqa: E402
from bot.utils.exceptions import SwapError  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_quote(provider="lifi", to_amount_human=1.0, seconds_old=0):
    return SwapQuote(
        provider=provider,
        from_chain="ethereum",
        to_chain="base",
        from_token="USDC",
        to_token="WETH",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="500000000000000",
        to_amount_human=to_amount_human,
        to_amount_min="490000000000000",
        gas_cost_usd=0.5,
        fee_cost_usd=0.0,
        total_cost_usd=0.5,
        estimated_time=60,
        price_impact=0.1,
        exchange_rate=0.0005,
        raw_quote={"test": True},
        timestamp=datetime.now(timezone.utc) - timedelta(seconds=seconds_old),
        expires_in=30,
    )


# ---------------------------------------------------------------------------
# get_quote — all providers fail
# ---------------------------------------------------------------------------


def test_get_quote_raises_when_all_providers_fail(monkeypatch):
    """If every provider raises, get_quote must raise SwapError (not return None)."""
    engine = SwapEngine()

    async def _fail(*args, **kwargs):
        raise SwapError("provider down")

    for method in [
        "_get_lifi_quote",
        "_get_cctp_quote",
        "_get_across_quote",
        "_get_wormhole_quote",
        "_get_socket_quote",
        "_get_cow_quote",
        "_get_ccip_quote",
    ]:
        monkeypatch.setattr(engine, method, _fail)

    with pytest.raises((SwapError, Exception), match="(?i)no.*quote|provider"):
        asyncio.run(
            engine.get_quote(
                from_chain="ethereum",
                to_chain="base",
                from_token="USDC",
                to_token="WETH",
                amount=1.0,
                from_address="0x" + "a" * 40,
            )
        )


def test_get_quote_returns_best_when_some_providers_fail(monkeypatch):
    """When some providers fail, the best valid quote must be returned."""
    engine = SwapEngine()

    async def _fail(*args, **kwargs):
        raise SwapError("provider down")

    async def _low(*args, **kwargs):
        return _make_quote("socket", to_amount_human=0.95)

    async def _high(*args, **kwargs):
        return _make_quote("lifi", to_amount_human=1.02)

    # socket and lifi both genuinely race for an ethereum->base USDC->WETH swap
    # (across/cctp/ccip require same-token routes, so they aren't in this race).
    # The higher-priced quote must win.
    for method in ["_get_cctp_quote", "_get_ccip_quote", "_get_cow_quote",
                   "_get_across_quote", "_get_wormhole_quote"]:
        monkeypatch.setattr(engine, method, _fail)
    monkeypatch.setattr(engine, "_get_socket_quote", _low)
    monkeypatch.setattr(engine, "_get_lifi_quote", _high)

    result = asyncio.run(
        engine.get_quote(
            from_chain="ethereum",
            to_chain="base",
            from_token="USDC",
            to_token="WETH",
            amount=1.0,
            from_address="0x" + "a" * 40,
        )
    )
    # Best price wins
    assert result.to_amount_human == 1.02
    assert result.provider == "lifi"


# ---------------------------------------------------------------------------
# get_quote — chain / token validation
# ---------------------------------------------------------------------------


def test_get_quote_raises_for_tron_cross_chain():
    """TRON cross-chain swaps are not supported — must raise before any API call."""
    engine = SwapEngine()
    with pytest.raises((SwapError, Exception), match="(?i)tron"):
        asyncio.run(
            engine.get_quote(
                from_chain="tron",
                to_chain="ethereum",
                from_token="USDT",
                to_token="USDC",
                amount=1.0,
                from_address="T" + "x" * 33,
            )
        )


def test_get_lifi_quote_raises_when_token_not_found(monkeypatch):
    """_get_lifi_quote must raise if get_token_address returns None."""
    monkeypatch.setattr("bot.services.swap_engine.get_token_address", lambda sym, chain: None)
    engine = SwapEngine()

    with pytest.raises((SwapError, Exception)):
        asyncio.run(
            engine._get_lifi_quote(
                from_chain="ethereum",
                to_chain="base",
                from_token="FAKECOIN",
                to_token="WETH",
                amount=1.0,
                amount_raw="1000000",
                from_address="0x" + "a" * 40,
            )
        )


# ---------------------------------------------------------------------------
# _is_retryable_rpc_error — pure function
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message,expected",
    [
        ("429 Too Many Requests", True),
        ("too many requests from this IP", True),
        ("rate limit exceeded", True),
        ("request timeout", True),
        ("invalid signature", False),
        ("nonce too low", False),
        ("out of gas", False),
        ("execution reverted", False),
        ("insufficient funds", False),
    ],
)
def test_is_retryable_rpc_error_classifies_correctly(message, expected):
    engine = SwapEngine()
    exc = Exception(message)
    assert engine._is_retryable_rpc_error(exc) is expected


# ---------------------------------------------------------------------------
# Quote freshness (stale quote detection)
# ---------------------------------------------------------------------------


def test_execute_swap_raises_for_stale_quote(monkeypatch):
    """A quote older than expires_in must be rejected before any signing."""
    stale = _make_quote(seconds_old=60)  # expires_in=30 by default

    engine = SwapEngine()
    # We don't need to mock anything past the freshness check
    with pytest.raises((SwapError, Exception), match="(?i)expir|stale|fresh"):
        asyncio.run(
            engine.execute_swap(
                quote=stale,
                wallet_id=1,
                user_id=1,
            )
        )
