"""Regression test: execute_swap must reject a wallet that isn't the caller's.

The internal /agent/execute-swap endpoint passes wallet_id and user_id from the
request body. Without an ownership check, a caller could supply a wallet_id from
one user and a user_id from another to swap on someone else's wallet (C2). The
binding check raises SwapError before any funds move.
"""

import os
from datetime import datetime, timezone

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest  # noqa: E402

import bot.services.swap_engine as se  # noqa: E402
from bot.services.swap_engine import SwapEngine, SwapQuote  # noqa: E402


def _minimal_quote() -> SwapQuote:
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
        estimated_time=60,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote={},
        timestamp=datetime.now(timezone.utc),
    )


async def test_execute_swap_rejects_cross_user_wallet(monkeypatch):
    engine = SwapEngine()

    # With no idempotency key, the first run_in_db call in execute_swap is the
    # wallet lookup. Return a wallet owned by user 999.
    async def fake_run_in_db(fn):
        return {
            "id": 5,
            "wallet_id": 5,
            "user_id": 999,
            "address": "0xabc0000000000000000000000000000000000abc",
            "chain_type": "evm",
            "encrypted_private_key": "enc",
        }

    monkeypatch.setattr(se, "run_in_db", fake_run_in_db)

    # Caller claims to be user 2 but points at user 999's wallet → must be rejected.
    with pytest.raises(se.SwapError, match="does not belong"):
        await engine.execute_swap(
            quote=_minimal_quote(), wallet_id=5, user_id=2, idempotency_key=None
        )
