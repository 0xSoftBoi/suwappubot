"""Spending-limit enforcement: per-swap/daily checks, durable spend window,
effective 2FA threshold resolution, and best-effort USD valuation."""

import asyncio
import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from database.db import get_session, init_db  # noqa: E402
from bot.models.favorites import UserSettings  # noqa: E402
from bot.models.security import SpendEvent  # noqa: E402
from bot.models.user import User  # noqa: E402
from bot.services.spending_limits import (  # noqa: E402
    DEFAULT_2FA_THRESHOLD_USD,
    DEFAULT_DAILY_LIMIT_USD,
    DEFAULT_PER_SWAP_LIMIT_USD,
    spending_limit_service,
)


@pytest.fixture()
def sqlite_db(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'limits.db'}")
    with get_session() as session:
        session.add(User(id=1, telegram_id=111, username="alice"))
        session.add(User(id=2, telegram_id=222, username="bob"))
    yield


# --- Limit resolution -------------------------------------------------------


def test_limits_default_without_settings_row(sqlite_db):
    limits = spending_limit_service.get_limits(1)
    assert limits.per_swap_usd == DEFAULT_PER_SWAP_LIMIT_USD
    assert limits.daily_usd == DEFAULT_DAILY_LIMIT_USD
    assert limits.twofa_above_usd == DEFAULT_2FA_THRESHOLD_USD


def test_limits_read_from_user_settings(sqlite_db):
    with get_session() as session:
        session.add(
            UserSettings(
                user_id=1,
                per_swap_limit_usd=100.0,
                daily_limit_usd=250.0,
                require_2fa_above_usd=50.0,
            )
        )
    limits = spending_limit_service.get_limits(1)
    assert limits.per_swap_usd == 100.0
    assert limits.daily_usd == 250.0
    assert limits.twofa_above_usd == 50.0


# --- Spend window ------------------------------------------------------------


def test_spent_usd_counts_only_trailing_window(sqlite_db):
    with get_session() as session:
        session.add(SpendEvent(user_id=1, amount_usd=40.0))
        session.add(SpendEvent(user_id=1, amount_usd=60.0))
        # Outside the 24h window — must not count.
        session.add(
            SpendEvent(
                user_id=1, amount_usd=999.0, created_at=datetime.utcnow() - timedelta(hours=25)
            )
        )
        # Another user's spend — must not count.
        session.add(SpendEvent(user_id=2, amount_usd=500.0))
    assert spending_limit_service.get_spent_usd(1, hours=24.0) == pytest.approx(100.0)


def test_record_creates_event(sqlite_db):
    spending_limit_service.record(1, 123.45, swap_id=7)
    with get_session() as session:
        ev = session.query(SpendEvent).filter(SpendEvent.user_id == 1).one()
        assert ev.amount_usd == pytest.approx(123.45)
        assert ev.swap_id == 7
        assert ev.kind == "swap"


# --- Enforcement -------------------------------------------------------------


def test_check_blocks_above_per_swap_limit(sqlite_db):
    with get_session() as session:
        session.add(UserSettings(user_id=1, per_swap_limit_usd=100.0, daily_limit_usd=1000.0))
    allowed, reason = spending_limit_service.check(1, 150.0)
    assert allowed is False
    assert "per-swap limit" in reason


def test_check_blocks_when_daily_window_exhausted(sqlite_db):
    with get_session() as session:
        session.add(UserSettings(user_id=1, per_swap_limit_usd=500.0, daily_limit_usd=1000.0))
        session.add(SpendEvent(user_id=1, amount_usd=900.0))
    allowed, reason = spending_limit_service.check(1, 200.0)
    assert allowed is False
    assert "24h limit" in reason
    assert "$100" in reason  # remaining headroom surfaced to the user


def test_check_allows_within_limits(sqlite_db):
    with get_session() as session:
        session.add(UserSettings(user_id=1, per_swap_limit_usd=500.0, daily_limit_usd=1000.0))
        session.add(SpendEvent(user_id=1, amount_usd=100.0))
    allowed, reason = spending_limit_service.check(1, 200.0)
    assert allowed is True
    assert reason is None


# --- Effective 2FA threshold --------------------------------------------------


def test_effective_2fa_threshold_takes_the_lower_source(sqlite_db):
    # users.two_fa_threshold and user_settings.require_2fa_above_usd disagree;
    # the most protective (lower) value must win.
    with get_session() as session:
        session.add(UserSettings(user_id=1, require_2fa_above_usd=2000.0))
        session.query(User).filter(User.id == 1).first().two_fa_threshold = 500
    assert spending_limit_service.effective_2fa_threshold(1) == 500.0

    with get_session() as session:
        session.query(User).filter(User.id == 1).first().two_fa_threshold = 5000
    assert spending_limit_service.effective_2fa_threshold(1) == 2000.0


# --- USD valuation -------------------------------------------------------------


def test_usd_value_uses_price_and_fails_open(sqlite_db, monkeypatch):
    from bot.services import price_service as ps_module

    async def fake_price(token):
        return {"ETH": 2000.0, "MYSTERY": None}.get(token)

    monkeypatch.setattr(ps_module.price_service, "get_price", fake_price)

    assert asyncio.run(spending_limit_service.usd_value("ETH", 0.5)) == pytest.approx(1000.0)
    # Unknown price → None (caller skips the check rather than blocking all swaps)
    assert asyncio.run(spending_limit_service.usd_value("MYSTERY", 10)) is None
