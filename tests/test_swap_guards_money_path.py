"""MONEY-PATH regression tests for two HIGH-severity swap-engine audit fixes.

H2 — `/s` (quickswap) bypassed the 2FA-required + spending-limit gate that the
full swap wizard (bot/handlers/swap.py) already enforces before calling
swap_engine.execute_swap. quickswap_confirm_callback now runs the same
spending_limit_service.check_with_2fa gate and fails CLOSED (blocks execution)
when a 2FA challenge would be required, instead of silently executing.

H3 — `_execute_1inch_swap` / `_execute_0x_swap` / `_execute_kyberswap_swap` /
`_execute_okx_dex_swap` re-quote at execution time and must not sign/broadcast
against a fresh min-out that is worse than the min-out the user actually
approved on the displayed quote. `_assert_fresh_min_out_acceptable` is the
shared guard that enforces this.
"""

import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.handlers import quickswap as qs_module  # noqa: E402
from bot.services.swap_engine import SwapEngine, SwapQuote  # noqa: E402
from bot.utils.exceptions import SwapError  # noqa: E402


def _quote(from_amount_human: float, to_amount_min: str = "1") -> SwapQuote:
    return SwapQuote(
        provider="lifi",
        from_chain="base",
        to_chain="base",
        from_token="USDC",
        to_token="ETH",
        from_amount=str(int(from_amount_human * 1_000_000)),
        from_amount_human=from_amount_human,
        to_amount="1500000",
        to_amount_human=1.5,
        to_amount_min=to_amount_min,
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=15,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote={},
        timestamp=datetime.now(timezone.utc),
    )


def _make_update_and_context(quote: SwapQuote):
    query = MagicMock()
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()
    update = MagicMock()
    update.callback_query = query
    update.effective_user = MagicMock(id=111)

    context = MagicMock()
    context.user_data = {
        "quickswap": {
            "from_chain": "base",
            "from_token": "USDC",
            "to_chain": "base",
            "to_token": "ETH",
            "amount": quote.from_amount_human,
            "wallet_id": 7,
            "user_id": 42,
            "attempt_id": "test-attempt",
            "quote": quote,
        }
    }
    return update, context


def _edit_message_text_arg(update) -> str:
    call = update.callback_query.edit_message_text.call_args
    if call.args:
        return call.args[0]
    return call.kwargs.get("text", "")


# --- H2: /s must not bypass the 2FA-required + spending-limit gate ---------


@pytest.mark.asyncio
async def test_quickswap_confirm_blocks_execution_when_2fa_required():
    """An above-threshold /s swap on a 2FA-enabled account must NOT reach
    execute_swap -- this is the exact bypass the audit finding described."""
    update, context = _make_update_and_context(_quote(5000.0))
    # Bypass @enforce_tos (DB-backed) to unit-test the guard directly.
    confirm = qs_module.quickswap_confirm_callback.__wrapped__

    with (
        patch.object(qs_module, "enforce_rate_limit_for_update", new=AsyncMock(return_value=True)),
        patch.object(
            qs_module.spending_limit_service, "usd_value", new=AsyncMock(return_value=5000.0)
        ),
        patch.object(qs_module.spending_limit_service, "check", return_value=(True, None)),
        patch.object(
            qs_module.spending_limit_service, "effective_2fa_threshold", return_value=1000.0
        ),
        patch("bot.services.twofa.twofa_service.is_2fa_enabled", return_value=True),
        patch.object(qs_module.swap_engine, "execute_swap", new=AsyncMock()) as mock_execute,
    ):
        await confirm(update, context)

    mock_execute.assert_not_awaited()
    assert "2FA Required" in _edit_message_text_arg(update)
    # Session is cleared on the blocked path -- no dangling stale quote to retry.
    assert "quickswap" not in context.user_data


@pytest.mark.asyncio
async def test_quickswap_confirm_executes_when_below_2fa_threshold():
    """A below-threshold swap (or 2FA disabled) must still execute normally --
    the new guard must not over-block legitimate quick swaps."""
    update, context = _make_update_and_context(_quote(10.0))
    confirm = qs_module.quickswap_confirm_callback.__wrapped__

    fake_tx = MagicMock(tx_hash="0xdeadbeef" + "0" * 56)

    with (
        patch.object(qs_module, "enforce_rate_limit_for_update", new=AsyncMock(return_value=True)),
        patch.object(
            qs_module.spending_limit_service, "usd_value", new=AsyncMock(return_value=10.0)
        ),
        patch.object(qs_module.spending_limit_service, "check", return_value=(True, None)),
        patch.object(
            qs_module.spending_limit_service, "effective_2fa_threshold", return_value=1000.0
        ),
        patch("bot.services.twofa.twofa_service.is_2fa_enabled", return_value=False),
        patch.object(
            qs_module.swap_engine, "execute_swap", new=AsyncMock(return_value=fake_tx)
        ) as mock_execute,
    ):
        await confirm(update, context)

    mock_execute.assert_awaited_once()
    assert "Swap Submitted" in _edit_message_text_arg(update)


# --- H3: execution-time re-quote must not accept a worse min-out -----------


def test_assert_fresh_min_out_rejects_worse_requote():
    approved = _quote(from_amount_human=1.0, to_amount_min="1000000")
    with pytest.raises(SwapError, match="min-out"):
        SwapEngine._assert_fresh_min_out_acceptable(approved, "990000", "1inch")


def test_assert_fresh_min_out_accepts_equal_or_better_requote():
    approved = _quote(from_amount_human=1.0, to_amount_min="1000000")
    # Equal is acceptable.
    SwapEngine._assert_fresh_min_out_acceptable(approved, "1000000", "1inch")
    # Better (higher) is acceptable.
    SwapEngine._assert_fresh_min_out_acceptable(approved, "1050000", "1inch")


def test_assert_fresh_min_out_fails_closed_on_unparseable_values():
    approved = _quote(from_amount_human=1.0, to_amount_min="1000000")
    with pytest.raises(SwapError):
        SwapEngine._assert_fresh_min_out_acceptable(approved, "not-a-number", "0x")
