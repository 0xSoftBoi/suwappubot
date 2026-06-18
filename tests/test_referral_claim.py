"""Tests for ReferralService.claim_rewards — the referral payout money path.

The audit added a real claim flow: eligible (unpaid) rewards are atomically
marked paid and the USD amount is credited to the user's custodial ledger as
USDC. This locks in: the minimum-claim floor, the ledger credit, that a
second tap claims $0 (no double-credit), and that a failed credit un-marks
the rewards so they aren't burned.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from decimal import Decimal

import pytest

import bot.services.referral_service as rs_mod
from bot.services.referral_service import ReferralService, MIN_CLAIM_USD


def _seed(referrer_id=1, referee_id=2, reward_usd=5.0, swap_id=1):
    """Create a referrer, a referee, an active referral, and one unpaid reward."""
    from database.db import get_session
    from bot.models.user import User
    from bot.models.referral import Referral, ReferralReward

    with get_session() as session:
        session.add(User(id=referrer_id, telegram_id=1000 + referrer_id))
        session.add(User(id=referee_id, telegram_id=1000 + referee_id))
        session.flush()
        ref = Referral(
            referrer_id=referrer_id,
            referee_id=referee_id,
            referral_code="CODE123",
            is_active=True,
        )
        session.add(ref)
        session.flush()
        session.add(
            ReferralReward(
                referral_id=ref.id,
                swap_id=swap_id,  # nullable=False, unique
                fee_amount_usd=reward_usd / 0.30,  # reward is 30% of the fee
                reward_amount_usd=reward_usd,
                is_paid=False,
            )
        )


@pytest.fixture()
def credited(monkeypatch):
    """Capture custodial-ledger credits instead of touching real wallets."""
    calls = []

    class _HW:
        def update_custodial_balance(self, **kw):
            calls.append(kw)
            return Decimal(str(kw.get("amount", 0)))

    monkeypatch.setitem(
        __import__("sys").modules,
        "bot.services.hot_wallet",
        type("M", (), {"hot_wallet_service": _HW()}),
    )
    return calls


def test_no_referrals_returns_friendly_message(tmp_db, credited):
    ok, msg, amt = ReferralService().claim_rewards(user_id=999)
    assert ok is False
    assert amt == 0.0
    assert "referral" in msg.lower()
    assert not credited  # nothing credited


def test_below_minimum_is_blocked(tmp_db, credited):
    _seed(reward_usd=MIN_CLAIM_USD - 0.50)
    ok, msg, amt = ReferralService().claim_rewards(user_id=1)
    assert ok is False
    assert f"${MIN_CLAIM_USD:.2f}" in msg
    assert not credited  # nothing credited below the floor


def test_successful_claim_credits_ledger_and_marks_paid(tmp_db, credited):
    _seed(reward_usd=5.0)
    ok, msg, amt = ReferralService().claim_rewards(user_id=1)
    assert ok is True
    assert amt == pytest.approx(5.0)
    # Credited exactly once, to the right user, in USDC on Base.
    assert len(credited) == 1
    c = credited[0]
    assert c["user_id"] == 1
    assert c["token_symbol"] == "USDC"
    assert c["chain"] == "base"
    assert c["operation"] == "add"
    assert Decimal(str(c["amount"])) == Decimal("5.0")
    # Reward row is now paid.
    from database.db import get_session
    from bot.models.referral import ReferralReward

    with get_session() as session:
        unpaid = session.query(ReferralReward).filter(ReferralReward.is_paid == False).count()
        assert unpaid == 0


def test_double_claim_credits_nothing_second_time(tmp_db, credited):
    _seed(reward_usd=5.0)
    svc = ReferralService()
    ok1, _, amt1 = svc.claim_rewards(user_id=1)
    ok2, _, amt2 = svc.claim_rewards(user_id=1)
    assert ok1 is True and amt1 == pytest.approx(5.0)
    assert ok2 is False and amt2 == 0.0
    # Exactly one credit total — no double-spend on a rapid second tap.
    assert len(credited) == 1


def test_failed_credit_unmarks_rewards_for_retry(tmp_db, monkeypatch):
    _seed(reward_usd=5.0)

    class _BrokenHW:
        def update_custodial_balance(self, **kw):
            raise RuntimeError("ledger down")

    monkeypatch.setitem(
        __import__("sys").modules,
        "bot.services.hot_wallet",
        type("M", (), {"hot_wallet_service": _BrokenHW()}),
    )
    ok, msg, amt = ReferralService().claim_rewards(user_id=1)
    assert ok is False
    assert amt == 0.0
    # Rewards must be un-marked so the user can retry — not silently burned.
    from database.db import get_session
    from bot.models.referral import ReferralReward

    with get_session() as session:
        unpaid = session.query(ReferralReward).filter(ReferralReward.is_paid == False).count()
        assert unpaid == 1
