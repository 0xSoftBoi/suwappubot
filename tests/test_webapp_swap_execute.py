"""MONEY-PATH: Terminal server execution stays bound to the quoted wallet."""

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import api.webapp as webapp
from bot.models.user import Wallet
from bot.services.swap_engine import SwapEngine, SwapQuote


def _quote() -> SwapQuote:
    return SwapQuote(
        provider="lifi",
        from_chain="base",
        to_chain="base",
        from_token="USDC",
        to_token="ETH",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1",
        to_amount_human=0.0003,
        to_amount_min="1",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=30,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote={},
        timestamp=datetime.now(timezone.utc),
    )


@pytest.fixture(autouse=True)
def clear_quote_cache():
    webapp._terminal_quote_cache.clear()
    yield
    webapp._terminal_quote_cache.clear()


async def test_execute_uses_exact_wallet_bound_at_quote_time(monkeypatch):
    wallet_a = Wallet(
        id=11,
        user_id=7,
        address="0x1111111111111111111111111111111111111111",
        chain_type="evm",
        wallet_provider="turnkey",
        turnkey_sub_org_id="sub-org-a",
        encrypted_private_key="turnkey_managed",
        is_active=True,
    )
    webapp._terminal_quote_cache["quote-a"] = {
        "created_at": webapp.time.time(),
        "quote": _quote(),
        "user_id": 7,
        "wallet_id": wallet_a.id,
        "wallet_address": wallet_a.address,
    }

    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = wallet_a
    executed = SimpleNamespace(
        id=99,
        status="submitted",
        tx_hash="0xabc",
        from_chain="base",
        to_chain="base",
        from_token="USDC",
        to_token="ETH",
        from_amount="1000000",
        to_amount="1",
    )
    execute = AsyncMock(return_value=executed)
    monkeypatch.setattr(SwapEngine, "execute_swap", execute)

    await webapp.execute_terminal_swap(
        webapp.WebAppSwapExecuteRequest(quoteId="quote-a"),
        auth_payload={"user_id": 7, "src": "passkey"},
        db=db,
    )

    assert execute.await_args.kwargs["wallet_id"] == 11
    assert execute.await_args.kwargs["user_id"] == 7


async def test_execute_rejects_weak_oauth_session_before_signing(monkeypatch):
    execute = AsyncMock()
    monkeypatch.setattr(SwapEngine, "execute_swap", execute)

    with pytest.raises(HTTPException) as exc_info:
        await webapp.execute_terminal_swap(
            webapp.WebAppSwapExecuteRequest(quoteId="anything"),
            auth_payload={"user_id": 7, "src": "weak"},
            db=MagicMock(),
        )

    assert exc_info.value.status_code == 403
    execute.assert_not_awaited()


async def test_execute_rejects_unbound_legacy_quote(monkeypatch):
    webapp._terminal_quote_cache["legacy"] = {
        "created_at": webapp.time.time(),
        "quote": _quote(),
        "user_id": 7,
    }
    execute = AsyncMock()
    monkeypatch.setattr(SwapEngine, "execute_swap", execute)

    with pytest.raises(HTTPException) as exc_info:
        await webapp.execute_terminal_swap(
            webapp.WebAppSwapExecuteRequest(quoteId="legacy"),
            auth_payload={"user_id": 7, "src": "siwe"},
            db=MagicMock(),
        )

    assert exc_info.value.status_code == 409
    execute.assert_not_awaited()


@pytest.mark.parametrize(
    ("from_chain", "to_chain"),
    [("base", "solana"), ("solana", "arbitrum")],
)
def test_terminal_swap_rejects_cross_wallet_families(from_chain, to_chain):
    with pytest.raises(HTTPException) as exc_info:
        webapp._reject_cross_family_terminal_swap(from_chain, to_chain)

    assert exc_info.value.status_code == 409
    assert "destination wallet" in exc_info.value.detail


def test_terminal_swap_keeps_same_wallet_family_cross_chain_open():
    webapp._reject_cross_family_terminal_swap("base", "arbitrum")
    webapp._reject_cross_family_terminal_swap("solana", "solana")
