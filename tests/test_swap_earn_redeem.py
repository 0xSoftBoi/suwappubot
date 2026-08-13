"""Unit tests for the spend-while-earning branch in bot/handlers/swap.py
(commit cf6ca00 — [MONEY-PATH]).

Drives the real handler functions (`confirm_swap`, `swap_confirm_earn_redeem_callback`,
`swap_requote`) with only the external boundaries mocked: Telegram I/O,
`savings_service.get_position` / `savings_service.withdraw`, balance/quote
lookups, and the shared spending-limit/2FA gate (`_finish_confirm`). No real
network, no real money.

Mirrors the fixtures/conventions in tests/test_anticipatory_ux.py.
"""

import os
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# mock Update / Context builders (mirrors tests/test_anticipatory_ux.py)
# ---------------------------------------------------------------------------
def _cb_update(data, user_id=777001):
    u = MagicMock()
    u.callback_query = MagicMock()
    u.callback_query.data = data
    u.callback_query.answer = AsyncMock()
    u.callback_query.edit_message_text = AsyncMock()
    u.callback_query.message = MagicMock()
    u.message = None
    u.effective_user = MagicMock(id=user_id)
    return u


def _ctx():
    c = MagicMock()
    c.user_data = {}
    c.args = []
    return c


def _all_buttons(markup):
    return [b for row in markup.inline_keyboard for b in row]


def _seed_user_and_wallet(telegram_id, address="0x00000000000000000000000000000000000e01"):
    from database.db import SessionLocal
    from bot.models.user import User, Wallet

    with SessionLocal() as session:
        user = User(telegram_id=telegram_id, tos_accepted=True)
        session.add(user)
        session.flush()
        wallet = Wallet(
            user_id=user.id,
            name="Primary",
            address=address,
            chain_type="evm",
            is_default=True,
        )
        session.add(wallet)
        session.commit()
        return user.id, wallet.id


def _short_quote(from_amount_human=100.0):
    """A quote object with just enough surface for the code under test."""
    return SimpleNamespace(from_amount_human=from_amount_human, timestamp=None)


# ---------------------------------------------------------------------------
# 1. Eligible: single wallet, USDC-on-Base sell, idle short, Earn covers it
#    → stash set + redeem-confirm offered.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_confirm_swap_offers_earn_redeem_when_eligible(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.utils.exceptions import SwapError

    user_id, wallet_id = _seed_user_and_wallet(777501)

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.quote_validator,
        "validate_balance",
        AsyncMock(side_effect=SwapError("Insufficient USDC balance")),
    )
    monkeypatch.setattr(swap.quote_validator, "validate_gas", AsyncMock(return_value=True))
    monkeypatch.setattr(swap.wallet_service, "get_evm_token_balance", AsyncMock(return_value=40.0))
    get_position = MagicMock(return_value=Decimal("100"))
    monkeypatch.setattr(swap.savings_service, "get_position", get_position)
    finish_confirm = AsyncMock()
    monkeypatch.setattr(swap, "_finish_confirm", finish_confirm)

    update, context = _cb_update("swap_confirm", user_id=777501), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "quote": _short_quote(100.0),
                "wallet_id": wallet_id,
                "selected_wallets": [wallet_id],
            },
        }
    )

    result = await swap.confirm_swap(update, context)

    assert result == swap.CONFIRM_SWAP
    get_position.assert_called_once_with("0x00000000000000000000000000000000000e01")
    swap_data = context.user_data["swap"]
    assert swap_data["earn_redeem_wallet_id"] == wallet_id
    assert swap_data["earn_redeem_amount"] == Decimal("60")
    assert swap_data["earn_redeem_amount_fmt"] == "60.00"
    finish_confirm.assert_not_awaited()

    call = update.callback_query.edit_message_text.call_args
    assert "redeemed from Earn" in call.args[0]
    markup = call.kwargs["reply_markup"]
    cbs = {b.callback_data for b in _all_buttons(markup)}
    assert "swap_confirm_earn_redeem" in cbs


# ---------------------------------------------------------------------------
# 2. Ineligible: position doesn't cover shortfall → unchanged insufficient
#    funds error.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_confirm_swap_insufficient_funds_when_position_too_small(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.utils.exceptions import SwapError

    user_id, wallet_id = _seed_user_and_wallet(777502)

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.quote_validator,
        "validate_balance",
        AsyncMock(side_effect=SwapError("Insufficient USDC balance")),
    )
    monkeypatch.setattr(swap.quote_validator, "validate_gas", AsyncMock(return_value=True))
    monkeypatch.setattr(swap.wallet_service, "get_evm_token_balance", AsyncMock(return_value=40.0))
    # Position (50) is smaller than the 60 shortfall — not covered.
    get_position = MagicMock(return_value=Decimal("50"))
    monkeypatch.setattr(swap.savings_service, "get_position", get_position)

    update, context = _cb_update("swap_confirm", user_id=777502), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "quote": _short_quote(100.0),
                "wallet_id": wallet_id,
                "selected_wallets": [wallet_id],
            },
        }
    )

    result = await swap.confirm_swap(update, context)

    assert result == swap.ConversationHandler.END
    swap_data = context.user_data["swap"]
    assert "earn_redeem_wallet_id" not in swap_data
    assert "earn_redeem_amount" not in swap_data
    call = update.callback_query.edit_message_text.call_args
    assert "Insufficient funds" in call.args[0]
    assert "redeemed from Earn" not in call.args[0]


# ---------------------------------------------------------------------------
# 3. Ineligible: multi-wallet selection → no redeem offer, no position lookup.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_confirm_swap_no_earn_redeem_offer_for_multi_wallet(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.utils.exceptions import SwapError

    user_id, wallet_id_1 = _seed_user_and_wallet(
        777503, address="0x00000000000000000000000000000000000e02"
    )
    from database.db import SessionLocal
    from bot.models.user import Wallet

    with SessionLocal() as session:
        wallet2 = Wallet(
            user_id=user_id,
            name="Second",
            address="0x00000000000000000000000000000000000e03",
            chain_type="evm",
            is_default=False,
        )
        session.add(wallet2)
        session.commit()
        wallet_id_2 = wallet2.id

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.quote_validator,
        "validate_balance",
        AsyncMock(side_effect=SwapError("Insufficient USDC balance")),
    )
    monkeypatch.setattr(swap.quote_validator, "validate_gas", AsyncMock(return_value=True))
    get_position = MagicMock(return_value=Decimal("1000"))
    monkeypatch.setattr(swap.savings_service, "get_position", get_position)

    update, context = _cb_update("swap_confirm", user_id=777503), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "quote": _short_quote(100.0),
                "wallet_id": wallet_id_1,
                "selected_wallets": [wallet_id_1, wallet_id_2],
            },
        }
    )

    result = await swap.confirm_swap(update, context)

    assert result == swap.ConversationHandler.END
    get_position.assert_not_called()
    swap_data = context.user_data["swap"]
    assert "earn_redeem_wallet_id" not in swap_data
    call = update.callback_query.edit_message_text.call_args
    assert "Insufficient funds" in call.args[0]
    assert "redeemed from Earn" not in call.args[0]


# ---------------------------------------------------------------------------
# 4. Ineligible: non-USDC / non-Base sell → no redeem offer, get_position
#    never called.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_confirm_swap_no_earn_redeem_for_non_usdc_base_sell(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.utils.exceptions import SwapError

    user_id, wallet_id = _seed_user_and_wallet(777504)

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.quote_validator,
        "validate_balance",
        AsyncMock(side_effect=SwapError("Insufficient ETH balance")),
    )
    monkeypatch.setattr(swap.quote_validator, "validate_gas", AsyncMock(return_value=True))
    get_position = MagicMock(return_value=Decimal("1000"))
    monkeypatch.setattr(swap.savings_service, "get_position", get_position)
    get_balance = AsyncMock(return_value=0.01)
    monkeypatch.setattr(swap.wallet_service, "get_evm_token_balance", get_balance)

    update, context = _cb_update("swap_confirm", user_id=777504), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "ethereum",  # not Base
                "from_token": "ETH",  # not USDC
                "quote": _short_quote(1.0),
                "wallet_id": wallet_id,
                "selected_wallets": [wallet_id],
            },
        }
    )

    result = await swap.confirm_swap(update, context)

    assert result == swap.ConversationHandler.END
    get_position.assert_not_called()
    get_balance.assert_not_called()
    call = update.callback_query.edit_message_text.call_args
    assert "Insufficient funds" in call.args[0]
    assert "redeemed from Earn" not in call.args[0]


# ---------------------------------------------------------------------------
# 5. Redeem fails (SavingsError) → swap aborted, user-safe message, stash
#    cleared, swap NOT executed.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_earn_redeem_callback_aborts_swap_on_savings_error(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.services.savings_service import SavingsError

    user_id, wallet_id = _seed_user_and_wallet(777505)

    monkeypatch.setattr(
        swap.savings_service, "withdraw", MagicMock(side_effect=SavingsError("Aave RPC error"))
    )
    finish_confirm = AsyncMock()
    monkeypatch.setattr(swap, "_finish_confirm", finish_confirm)
    run_confirmed = AsyncMock()
    monkeypatch.setattr(swap, "_run_confirmed_swap", run_confirmed)

    update, context = _cb_update("swap_confirm_earn_redeem", user_id=777505), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "earn_redeem_wallet_id": wallet_id,
                "earn_redeem_amount": Decimal("60"),
                "earn_redeem_amount_fmt": "60.00",
            },
        }
    )

    result = await swap.swap_confirm_earn_redeem_callback(update, context)

    assert result == swap.ConversationHandler.END
    finish_confirm.assert_not_awaited()
    run_confirmed.assert_not_awaited()

    swap_data = context.user_data["swap"]
    assert "earn_redeem_amount" not in swap_data
    assert "earn_redeem_wallet_id" not in swap_data
    assert "earn_redeem_amount_fmt" not in swap_data
    assert "earn_redeem_done" not in swap_data

    last_call = update.callback_query.edit_message_text.call_args
    text = last_call.args[0]
    assert "Could not redeem from Earn" in text
    assert "not submitted" in text
    assert "no funds" in text.lower() or "no funds" in text


# ---------------------------------------------------------------------------
# 6. Redeem succeeds → SavingsEvent logged (action="withdraw"), flow
#    proceeds to _finish_confirm.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_earn_redeem_callback_success_logs_event_and_continues(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from database.db import SessionLocal
    from bot.models.savings import SavingsEvent

    user_id, wallet_id = _seed_user_and_wallet(777506)

    withdraw = MagicMock(return_value="deadbeef")  # no 0x prefix on purpose
    monkeypatch.setattr(swap.savings_service, "withdraw", withdraw)
    sentinel = object()
    finish_confirm = AsyncMock(return_value=sentinel)
    monkeypatch.setattr(swap, "_finish_confirm", finish_confirm)

    update, context = _cb_update("swap_confirm_earn_redeem", user_id=777506), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "earn_redeem_wallet_id": wallet_id,
                "earn_redeem_amount": Decimal("60"),
                "earn_redeem_amount_fmt": "60.00",
            },
        }
    )

    result = await swap.swap_confirm_earn_redeem_callback(update, context)

    assert result is sentinel
    withdraw.assert_called_once()
    finish_confirm.assert_awaited_once_with(
        update.callback_query.edit_message_text, context, user_id, [wallet_id]
    )
    assert context.user_data["swap"]["earn_redeem_done"] is True

    with SessionLocal() as session:
        events = session.query(SavingsEvent).filter(SavingsEvent.user_id == user_id).all()
    assert len(events) == 1
    event = events[0]
    assert event.action == "withdraw"
    assert event.chain == "base"
    assert event.token == "USDC"
    assert event.wallet_id == wallet_id
    assert event.amount == Decimal("60")
    assert event.tx_hash == "0xdeadbeef"


# ---------------------------------------------------------------------------
# 7. Requote clears the earn_redeem_* stash.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_swap_requote_clears_earn_redeem_stash(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.models.subscription import SubscriptionTier
    from bot.services.swap_engine import SwapQuote
    from bot.services.x402_service import x402_service

    user_id, wallet_id = _seed_user_and_wallet(777507)

    quote = SwapQuote(
        provider="lifi",
        from_chain="base",
        to_chain="ethereum",
        from_token="USDC",
        to_token="USDC",
        from_amount="100000000",
        from_amount_human=100.0,
        to_amount="99000000",
        to_amount_human=99.0,
        to_amount_min="98000000",
        gas_cost_usd=0.5,
        fee_cost_usd=0.1,
        total_cost_usd=0.6,
        estimated_time=30,
        price_impact=0.1,
        exchange_rate=0.99,
        raw_quote={"provider": "lifi"},
    )

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.wallet_service,
        "get_default_wallet",
        MagicMock(return_value=SimpleNamespace(address="0xdefault", id=wallet_id)),
    )
    monkeypatch.setattr(swap.swap_engine, "get_quote", AsyncMock(return_value=quote))
    monkeypatch.setattr(x402_service, "get_tier", AsyncMock(return_value=SubscriptionTier.FREE))
    monkeypatch.setattr(swap.fee_service, "get_fee_bps", MagicMock(return_value=50))
    monkeypatch.setattr(
        swap.fee_service, "calculate_fee_with_price", AsyncMock(return_value=(0.5, 0.5, 0.5))
    )
    monkeypatch.setattr(swap.spending_limit_service, "usd_value", AsyncMock(return_value=100.0))

    update, context = _cb_update("swap_requote", user_id=777507), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "to_chain": "ethereum",
                "to_token": "USDC",
                "amount": 100.0,
                "wallet_id": wallet_id,
                # Stale spend-while-earning stash from a prior confirm attempt.
                "earn_redeem_wallet_id": wallet_id,
                "earn_redeem_amount": Decimal("60"),
                "earn_redeem_amount_fmt": "60.00",
                "earn_redeem_done": True,
            },
        }
    )

    result = await swap.swap_requote(update, context)

    assert result == swap.CONFIRM_SWAP
    swap_data = context.user_data["swap"]
    assert "earn_redeem_wallet_id" not in swap_data
    assert "earn_redeem_amount" not in swap_data
    assert "earn_redeem_amount_fmt" not in swap_data
    assert "earn_redeem_done" not in swap_data
