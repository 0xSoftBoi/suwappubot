import os
import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from database.db import get_session, init_db  # noqa: E402
from bot.models.copy_trading import CopyFollow, CopyTrade, TraderProfile, TraderTrade  # noqa: E402
from bot.models.subscription import Subscription, SubscriptionTier  # noqa: E402
from bot.models.swap import SwapStatus, SwapTransaction  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from bot.services.copy_service import CopyService  # noqa: E402


@pytest.fixture()
def sqlite_db(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'copy-service.db'}"
    assert init_db(database_url)

    async def unit_usd_value(_token_symbol, amount):
        return float(amount)

    monkeypatch.setattr(
        "bot.services.copy_service.points_service.award_points", lambda *_, **__: None
    )
    monkeypatch.setattr(
        "bot.services.copy_service.points_service.award_swap_points",
        lambda *_, **__: (0, None, None),
    )
    monkeypatch.setattr(
        "bot.services.copy_service.spending_limit_service.usd_value", unit_usd_value
    )
    yield


def test_auto_copy_uses_real_swap_engine_quote_path(sqlite_db, monkeypatch):
    service = CopyService()
    captured = {}

    async def pro_tier(_user_id):
        return SubscriptionTier.PRO

    async def usd_value(token_symbol, amount):
        return amount * (3000.0 if token_symbol == "ETH" else 1.0)

    monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", pro_tier)
    monkeypatch.setattr("bot.services.copy_service.spending_limit_service.usd_value", usd_value)

    class FakeSwapEngine:
        async def get_quote(self, **kwargs):
            captured["quote_kwargs"] = kwargs
            return SimpleNamespace(**kwargs, from_amount_human=kwargs["amount"])

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
                    # Match production SwapEngine persistence: raw token atoms,
                    # not the human-readable get_quote() input.
                    from_amount=str(int(quote.from_amount_human * 10**18)),
                    from_amount_usd=quote.from_amount_human * 3000.0,
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
            max_trade_usd=5000,
            daily_limit_usd=10000,
            max_slippage_percent=0.5,
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            # SwapEngine stores the 2 ETH source in wei. The old copy path
            # multiplied this raw integer and then passed it to get_quote() as
            # human ETH, oversizing the copy by 1e18.
            from_amount=str(2 * 10**18),
            from_amount_usd=6000,
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
    assert captured["quote_kwargs"]["amount"] == pytest.approx(1.0)
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
        assert copy_trade.copy_amount_usd == pytest.approx(3000.0)
        assert follow.total_copied_volume == pytest.approx(3000.0)
        assert session.query(TraderTrade).count() == 1

    second_pass = asyncio.run(service.handle_swap_submitted(original_swap_id))
    assert second_pass == []
    with get_session() as session:
        assert session.query(CopyTrade).count() == 1
        assert session.query(TraderTrade).count() == 1


def test_auto_copy_rechecks_fresh_usd_notional_against_copy_cap(sqlite_db, monkeypatch):
    service = CopyService()
    price_calls = 0
    execute_calls = 0

    async def pro_tier(_user_id):
        return SubscriptionTier.PRO

    async def rising_usd_value(_token_symbol, amount):
        nonlocal price_calls
        price_calls += 1
        # Size the intended $100 copy at $100/token, then simulate a fast move
        # to $200/token by the time the exact quoted input is checked.
        unit_price = 100.0 if price_calls == 1 else 200.0
        return amount * unit_price

    monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", pro_tier)
    monkeypatch.setattr(
        "bot.services.copy_service.spending_limit_service.usd_value", rising_usd_value
    )

    class FastMarketSwapEngine:
        async def get_quote(self, **kwargs):
            return SimpleNamespace(**kwargs, from_amount_human=kwargs["amount"])

        async def execute_swap(self, **_kwargs):
            nonlocal execute_calls
            execute_calls += 1
            raise AssertionError("execution must not start above the copy USD cap")

    monkeypatch.setattr("bot.services.swap_engine.SwapEngine", FastMarketSwapEngine)

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
        session.add(
            CopyFollow(
                follower_id=2,
                trader_id=1,
                copy_mode="auto",
                copy_type="fixed",
                copy_amount_usd=100,
                max_trade_usd=100,
                daily_limit_usd=1000,
            )
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount=str(10**18),
            from_amount_usd=100,
            to_chain="ethereum",
            to_token="USDC",
            to_amount="100000000",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(swap)
        session.flush()
        swap_id = swap.id

    processed = asyncio.run(service.handle_swap_submitted(swap_id))

    assert processed[0]["status"] == "failed"
    assert execute_calls == 0
    with get_session() as session:
        copy_trade = session.query(CopyTrade).one()
        assert copy_trade.status == "failed"
        assert "per-trade limit" in (copy_trade.failure_reason or "")


def test_auto_copy_fails_closed_when_subscription_is_no_longer_pro(sqlite_db, monkeypatch):
    service = CopyService()

    async def free_tier(_user_id):
        return SubscriptionTier.FREE

    monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", free_tier)

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
        session.add(
            CopyFollow(
                follower_id=2,
                trader_id=1,
                copy_mode="auto",
                copy_amount_usd=25,
                max_trade_usd=25,
                daily_limit_usd=100,
            )
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=100,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(swap)
        session.flush()
        swap_id = swap.id

    processed = asyncio.run(service.handle_swap_submitted(swap_id))

    assert processed[0]["status"] == "failed"
    assert "active Pro subscription" in processed[0]["message"]
    with get_session() as session:
        copy_trade = session.query(CopyTrade).one()
        assert copy_trade.status == "failed"
        assert copy_trade.copy_swap_id is None


def test_auto_copy_rechecks_follow_mode_after_quote_before_execution(sqlite_db, monkeypatch):
    service = CopyService()
    executed = False

    async def pro_tier(_user_id):
        return SubscriptionTier.PRO

    monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", pro_tier)

    class MutatingSwapEngine:
        async def get_quote(self, **kwargs):
            with get_session() as session:
                follow = session.query(CopyFollow).one()
                follow.copy_mode = "notify"
            return SimpleNamespace(**kwargs, from_amount_human=kwargs["amount"])

        async def execute_swap(self, **_kwargs):
            nonlocal executed
            executed = True
            raise AssertionError("execution must not run after auto-copy is disabled")

    monkeypatch.setattr("bot.services.swap_engine.SwapEngine", MutatingSwapEngine)

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
        session.add(
            CopyFollow(
                follower_id=2,
                trader_id=1,
                copy_mode="auto",
                copy_amount_usd=25,
                max_trade_usd=25,
                daily_limit_usd=100,
            )
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=100,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(swap)
        session.flush()
        swap_id = swap.id

    processed = asyncio.run(service.handle_swap_submitted(swap_id))

    assert executed is False
    assert processed[0]["status"] == "failed"
    assert "disabled" in processed[0]["message"].lower()
    with get_session() as session:
        assert session.query(CopyTrade).one().status == "failed"


def test_auto_copy_rechecks_destination_chain_filter_after_quote(sqlite_db, monkeypatch):
    service = CopyService()
    executed = False

    async def pro_tier(_user_id):
        return SubscriptionTier.PRO

    monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", pro_tier)

    class MutatingSwapEngine:
        async def get_quote(self, **kwargs):
            with get_session() as session:
                follow = session.query(CopyFollow).one()
                follow.chains_filter = "ethereum"
            return SimpleNamespace(**kwargs, from_amount_human=kwargs["amount"])

        async def execute_swap(self, **_kwargs):
            nonlocal executed
            executed = True
            raise AssertionError("execution must not run after destination chain is removed")

    monkeypatch.setattr("bot.services.swap_engine.SwapEngine", MutatingSwapEngine)

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
        session.add(
            CopyFollow(
                follower_id=2,
                trader_id=1,
                copy_mode="auto",
                copy_amount_usd=25,
                max_trade_usd=25,
                daily_limit_usd=100,
                chains_filter="ethereum,base",
            )
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="USDC",
            from_amount="100",
            from_amount_usd=100,
            to_chain="base",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(swap)
        session.flush()
        swap_id = swap.id

    processed = asyncio.run(service.handle_swap_submitted(swap_id))

    assert executed is False
    assert processed[0]["status"] == "failed"
    assert "chain" in processed[0]["message"].lower()
    with get_session() as session:
        assert session.query(CopyTrade).one().status == "failed"


def test_copy_execution_blocks_cross_wallet_family_destination(sqlite_db):
    service = CopyService()

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
            copy_mode="notify",
            copy_amount_usd=25,
            max_trade_usd=25,
            daily_limit_usd=100,
        )
        original = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="USDC",
            from_amount="25",
            from_amount_usd=25,
            to_chain="solana",
            to_token="SOL",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add_all([follow, original])
        session.flush()
        copy_trade = CopyTrade(
            original_swap_id=original.id,
            trader_id=1,
            copier_id=2,
            follow_id=follow.id,
            from_token="USDC",
            to_token="SOL",
            from_chain="ethereum",
            to_chain="solana",
            trader_amount_usd=25,
            copy_amount_usd=25,
            status="notified",
        )
        session.add(copy_trade)
        session.flush()
        copy_trade_id = copy_trade.id

    success, message, swap_id = asyncio.run(service.execute_copy(2, copy_trade_id))

    assert success is False
    assert swap_id is None
    assert "destination wallet" in message.lower()
    with get_session() as session:
        assert session.query(CopyTrade).one().status == "failed"


def test_pending_auto_copy_reserves_daily_budget(sqlite_db):
    service = CopyService()

    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="leader"),
                User(id=2, username="copier"),
                TraderProfile(user_id=1, is_public=True, display_name="Leader"),
            ]
        )
        session.flush()
        follow = CopyFollow(
            follower_id=2,
            trader_id=1,
            copy_mode="auto",
            copy_type="fixed",
            copy_amount_usd=60,
            max_trade_usd=60,
            daily_limit_usd=100,
        )
        prior_swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        current_swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add_all([follow, prior_swap, current_swap])
        session.flush()
        session.add(
            CopyTrade(
                original_swap_id=prior_swap.id,
                trader_id=1,
                copier_id=2,
                follow_id=follow.id,
                from_token="ETH",
                to_token="USDC",
                from_chain="ethereum",
                to_chain="ethereum",
                trader_amount_usd=100,
                copy_amount_usd=60,
                status="pending",
            )
        )
        current_swap_id = current_swap.id

    with get_session() as session:
        current_swap = (
            session.query(SwapTransaction).filter(SwapTransaction.id == current_swap_id).one()
        )

    queued = asyncio.run(service.record_trade(1, current_swap, amount_usd=100))

    assert queued == []
    with get_session() as session:
        assert session.query(CopyTrade).count() == 1


def test_missing_usd_notional_never_creates_copy_signal(sqlite_db):
    service = CopyService()

    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="leader"),
                User(id=2, username="copier"),
                TraderProfile(user_id=1, is_public=True, display_name="Leader"),
            ]
        )
        session.flush()
        session.add(
            CopyFollow(
                follower_id=2,
                trader_id=1,
                copy_mode="auto",
                copy_amount_usd=100,
                max_trade_usd=100,
                daily_limit_usd=500,
            )
        )
        swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=None,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(swap)
        session.flush()
        swap_id = swap.id

    assert asyncio.run(service.handle_swap_submitted(swap_id)) == []
    with get_session() as session:
        assert session.query(CopyTrade).count() == 0
        activity = session.query(TraderTrade).one()
        assert activity.amount_usd == 0
        profile = session.query(TraderProfile).one()
        assert profile.total_trades == 0
        assert profile.total_volume_usd == 0


def test_ambiguous_execution_keeps_daily_budget_reserved(sqlite_db, monkeypatch):
    service = CopyService()
    execute_calls = 0

    async def pro_tier(_user_id):
        return SubscriptionTier.PRO

    monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", pro_tier)

    class AmbiguousSwapEngine:
        async def get_quote(self, **kwargs):
            return SimpleNamespace(**kwargs, from_amount_human=kwargs["amount"])

        async def execute_swap(self, **_kwargs):
            nonlocal execute_calls
            execute_calls += 1
            raise RuntimeError("rpc connection lost after submit")

    monkeypatch.setattr("bot.services.swap_engine.SwapEngine", AmbiguousSwapEngine)

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
        session.add(
            CopyFollow(
                follower_id=2,
                trader_id=1,
                copy_mode="auto",
                copy_type="fixed",
                copy_amount_usd=60,
                max_trade_usd=60,
                daily_limit_usd=100,
            )
        )
        first_swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=100,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(first_swap)
        session.flush()
        first_swap_id = first_swap.id

    first = asyncio.run(service.handle_swap_submitted(first_swap_id))
    assert first[0]["status"] == "outcome_unknown"
    assert "do not retry" in first[0]["message"].lower()
    assert execute_calls == 1
    with get_session() as session:
        copy_trade = session.query(CopyTrade).one()
        assert copy_trade.status == "outcome_unknown"
        assert copy_trade.copied_at is not None

        second_swap = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=100,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add(second_swap)
        session.flush()
        second_swap_id = second_swap.id

    assert asyncio.run(service.handle_swap_submitted(second_swap_id)) == []
    assert execute_calls == 1
    with get_session() as session:
        assert session.query(CopyTrade).count() == 1


def test_generic_pending_never_inherits_automatic_authority(sqlite_db):
    """An orphaned notify row stays user-confirmed after the follow switches to auto."""
    service = CopyService()

    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="leader"),
                User(id=2, username="copier"),
                TraderProfile(user_id=1, is_public=True, display_name="Leader"),
            ]
        )
        session.flush()
        follow = CopyFollow(
            follower_id=2,
            trader_id=1,
            copy_mode="auto",
            copy_type="fixed",
            copy_amount_usd=25,
            max_trade_usd=25,
            daily_limit_usd=1000,
        )
        original = SwapTransaction(
            user_id=1,
            from_chain="ethereum",
            from_token="ETH",
            from_amount="1",
            from_amount_usd=100,
            to_chain="ethereum",
            to_token="USDC",
            status=SwapStatus.SUBMITTED.value,
        )
        session.add_all([follow, original])
        session.flush()
        session.add(
            CopyTrade(
                original_swap_id=original.id,
                trader_id=1,
                copier_id=2,
                follow_id=follow.id,
                from_token="ETH",
                to_token="USDC",
                from_chain="ethereum",
                to_chain="ethereum",
                trader_amount_usd=100,
                copy_amount_usd=25,
                # Simulates a notify signal orphaned before mark_notified,
                # after the mutable follow has since been switched to auto.
                status="pending",
            )
        )
        original_id = original.id

    processed = asyncio.run(service.handle_swap_submitted(original_id))

    assert processed[0]["status"] == "notified"
    with get_session() as session:
        assert session.query(CopyTrade).one().status == "notified"


def test_x402_tier_accepts_naive_active_expiry(sqlite_db):
    from bot.services.x402_service import x402_service

    with get_session() as session:
        session.add(User(id=2, username="pro-copier"))
        session.flush()
        session.add(
            Subscription(
                user_id=2,
                tier=SubscriptionTier.PRO,
                expires_at=datetime.utcnow() + timedelta(days=30),
            )
        )

    assert asyncio.run(x402_service.get_tier(2)) == SubscriptionTier.PRO


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
