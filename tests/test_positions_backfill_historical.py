"""Regression guard: the positions backfill must value swaps at execution time.

The backfill replays a user's swap history to seed their average-cost basis. It ran
once per user, DELETEd the live rows first, and stamped `positions_backfilled_at` so it
never re-ran — so any error it made was permanent and silent.

It valued every historical swap at the *current* price, on the stated assumption that
historical prices were not stored. They are, on the same rows the replay already reads:
`realized_to_amount_usd` (what settled), `to_amount_usd` / `from_amount_usd` (quoted at
execution).

Scope matters and is easy to get wrong: a swap with a stablecoin leg was already valued
correctly, because the stablecoin quantity *is* the historical USD amount. The defect
only bites **volatile-to-volatile** swaps — ETH to SOL, not USDC to ETH — which is why
the first test below trades one volatile token for another. A stablecoin-routed test
passes against the broken code and guards nothing.

Second guard: the replay was capped at the OLDEST 1000 swaps. Average-cost is
path-dependent from the first swap forward, so truncation does not give a partial answer,
it gives a wrong one — and the accurate rows were already deleted.
"""

import pytest


@pytest.mark.asyncio
async def test_backfill_uses_execution_time_usd_not_current_price(tmp_db, monkeypatch):
    """Cost basis comes from the stored USD columns, not from today's price."""
    from datetime import datetime, timedelta

    from database.db import get_session
    from bot.models.positions import UserPosition
    from bot.models.swap import SwapStatus, SwapTransaction
    from bot.models.user import User

    # Today's prices — the wrong-answer source the old code reached for.
    class _Prices:
        async def get_prices(self, symbols):
            return {"ETH": 4000.0, "SOL": 250.0}

    monkeypatch.setattr("bot.services.price_service.price_service", _Prices())

    # ETH -> SOL, both volatile, executed when the trade was worth $2,000:
    # 1 ETH (then $2,000) for 20 SOL, so SOL basis is $100 each.
    with get_session() as s:
        s.add(User(id=1, telegram_id=1))
        s.add(
            SwapTransaction(
                id=1,
                user_id=1,
                from_chain="base",
                from_token="ETH",
                from_amount="1",
                from_amount_usd=2000.0,
                to_chain="solana",
                to_token="SOL",
                to_amount="20",
                to_amount_usd=2000.0,
                status=SwapStatus.COMPLETED.value,
                created_at=datetime(2025, 1, 1),
            )
        )
        s.commit()

    from bot.services.positions_service import backfill_user_positions

    assert await backfill_user_positions(1) is True

    with get_session() as s:
        pos = s.query(UserPosition).filter_by(user_id=1, token="SOL").one()
        assert pos.qty == pytest.approx(20.0)
        # $2,000 — what the trade was worth at execution. Pricing 20 SOL at today's
        # $250 gives a $5,000 basis and erases $3,000 of real gain.
        assert pos.cost_usd == pytest.approx(2000.0, abs=0.01)
        assert pos.qty * 250.0 - pos.cost_usd == pytest.approx(3000.0, abs=0.01)


@pytest.mark.asyncio
async def test_backfill_refuses_rather_than_truncating_history(tmp_db, monkeypatch):
    """Over the replay cap, the backfill declines and leaves live positions intact."""
    from datetime import datetime, timedelta

    from database.db import get_session
    from bot.models.positions import UserPosition
    from bot.models.swap import SwapStatus, SwapTransaction
    from bot.models.user import User
    from bot.services import positions_service

    class _Prices:
        async def get_prices(self, symbols):
            return {}

    monkeypatch.setattr("bot.services.price_service.price_service", _Prices())
    monkeypatch.setattr(positions_service, "_MAX_REPLAY", 5)

    start = datetime(2025, 1, 1)
    with get_session() as s:
        s.add(User(id=2, telegram_id=2))
        for i in range(6):  # one over the patched cap
            s.add(
                SwapTransaction(
                    id=100 + i,
                    user_id=2,
                    from_chain="base",
                    from_token="USDC",
                    from_amount="10",
                    from_amount_usd=10.0,
                    to_chain="base",
                    to_token="ETH",
                    to_amount="0.01",
                    to_amount_usd=10.0,
                    status=SwapStatus.COMPLETED.value,
                    created_at=start + timedelta(minutes=i),
                )
            )
        # An accurate, incrementally-maintained position that must survive.
        s.add(
            UserPosition(
                user_id=2, token="ETH", chain="base", qty=0.06, cost_usd=60.0, realized_pnl_usd=0.0
            )
        )
        s.commit()

    assert await positions_service.backfill_user_positions(2) is False

    with get_session() as s:
        pos = s.query(UserPosition).filter_by(user_id=2, token="ETH").one()
        assert pos.cost_usd == pytest.approx(60.0)
