import os
import asyncio
from types import SimpleNamespace

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from database.db import get_session, init_db
from bot.models.copy_trading import CopyFollow, CopyTrade, TraderProfile, TraderTrade
from bot.models.swap import SwapStatus, SwapTransaction
from bot.models.user import User, Wallet
from bot.services.copy_service import CopyService


@pytest.fixture()
def sqlite_db(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'copy-service.db'}"
    assert init_db(database_url)
    monkeypatch.setattr(
        "bot.services.copy_service.points_service.award_points", lambda *_, **__: None
    )
    monkeypatch.setattr(
        "bot.services.copy_service.points_service.award_swap_points",
        lambda *_, **__: (0, None, None),
    )
    yield


def test_auto_copy_uses_real_swap_engine_quote_path(sqlite_db, monkeypatch):
    service = CopyService()
    captured = {}

    class FakeSwapEngine:
        async def get_quote(self, **kwargs):
            captured["quote_kwargs"] = kwargs
            return SimpleNamespace(**kwargs)

        async def execute_swap(
            self, *, quote, wallet_id, user_id, idempotency_key, automated=False
        ):
            captured["execute_kwargs"] = {
                "quote": quote,
                "wallet_id": wallet_id,
                "user_id": user_id,
                "idempotency_key": idempotency_key,
                "automated": automated,
            }
            with get_session() as session:
                swap = SwapTransaction(
                    user_id=user_id,
                    from_chain=quote.from_chain,
                    from_token=quote.from_token,
                    from_amount=str(quote.amount),
                    from_amount_usd=quote.amount,
                    to_chain=quote.to_chain,
                    to_token=quote.to_token,
                    to_amount="0",
                    status=SwapStatus.SUBMITTED.value,
                    idempotency_key=idempotency_key,
                )
                session.add(swap)
                session.flush()
                return swap

    monkeypatch.setattr("bot.services.swap_engine.SwapEngine", FakeSwapEngine)
    # copy_service holds a module-level shared SwapEngine so concurrent
    # execute_copy() calls contend on the SAME per-wallet asyncio.Lock (a fresh
    # instance per call gave each its own empty lock registry, serializing
    # nothing). That instance is built at import, so patching the class alone
    # would leave the already-constructed real engine in place.
    monkeypatch.setattr("bot.services.copy_service._copy_swap_engine", FakeSwapEngine())

    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="leader"),
                User(id=2, username="copier"),
                TraderProfile(user_id=1, is_public=True, display_name="Leader"),
                Wallet(
                    user_id=2,
                    address="0xcopy",
                    chain_type="evm",
                    encrypted_private_key="encrypted",
                    is_active=True,
                    is_default=True,
                ),
            ]
        )
        session.flush()
        follow = CopyFollow(
            follower_id=2,
            trader_id=1,
            copy_mode="auto",
            copy_type="percentage",
            copy_percentage=50,
            max_trade_usd=500,
            daily_limit_usd=1000,
            max_slippage_percent=0.5,
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="2",
            from_amount_usd=2,
            to_chain="ethereum",
            to_token="USDC",
            to_amount="7000",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add_all([follow, swap])
        session.flush()
        original_swap_id = swap.id

    processed = asyncio.run(service.handle_swap_submitted(original_swap_id))

    assert processed[0]["status"] == "copied"
    assert captured["quote_kwargs"]["amount"] == 1
    assert captured["quote_kwargs"]["from_address"] == "0xcopy"
    assert captured["quote_kwargs"]["slippage"] == 0.5
    assert captured["execute_kwargs"]["wallet_id"] == 1
    assert captured["execute_kwargs"]["user_id"] == 2
    assert captured["execute_kwargs"]["idempotency_key"].startswith("copy_")
    # Autonomous copy-mirror executions must use the gasless/session-key path.
    assert captured["execute_kwargs"]["automated"] is True

    with get_session() as session:
        copy_trade = session.query(CopyTrade).one()
        follow = session.query(CopyFollow).one()
        assert copy_trade.status == "copied"
        assert copy_trade.copy_swap_id is not None
        assert follow.total_copied_trades == 1
        assert follow.total_copied_volume == 1
        assert session.query(TraderTrade).count() == 1

    second_pass = asyncio.run(service.handle_swap_submitted(original_swap_id))
    assert second_pass == []
    with get_session() as session:
        assert session.query(CopyTrade).count() == 1
        assert session.query(TraderTrade).count() == 1


def test_copy_hook_ignores_copy_swaps(sqlite_db):
    service = CopyService()
    with get_session() as session:
        session.add(User(id=1, username="copier"))
        session.flush()
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=1,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
            idempotency_key="copy_10_1",
        )
        session.add(swap)
        session.flush()
        swap_id = swap.id

    assert asyncio.run(service.handle_swap_submitted(swap_id)) == []
