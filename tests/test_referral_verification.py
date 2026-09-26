"""Regression tests for referral verification and the milestone stream.

The bug: `verify_referral()` existed and `get_verified_referral_count()` gated the
whole milestone bonus stream on `referrals.verified_at`, but NOTHING in the codebase
ever called `verify_referral()`. Every referral stayed unverified forever, so
verified_referrals was always 0 and the 5/10/20/50/100 milestone bonuses were
permanently unreachable — while the bot's /ref screen advertised them.

These tests pin the wiring: recording a swap commission verifies the referral, and
crossing a threshold credits exactly one milestone bonus (and never a second one).
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from bot.services.referral_service import (  # noqa: E402
    ReferralService,
    MILESTONE_BONUSES,
    MIN_VOLUME_BEFORE_PAYOUT_USD,
)


def _swap(swap_id, user_id, volume_usd):
    """A minimal completed swap that satisfies the model's NOT NULL columns."""
    from bot.models.swap import SwapTransaction

    return SwapTransaction(
        id=swap_id,
        user_id=user_id,
        status="completed",
        from_chain="base",
        from_token="USDC",
        from_amount="1000000",
        to_chain="base",
        to_token="ETH",
        from_amount_usd=volume_usd,
    )


def _seed_pair(referrer_id, referee_id, swap_id, volume_usd=100.0):
    """Create referrer+referee, an active referral, a code, and a qualifying swap."""
    from database.db import get_session
    from bot.models.user import User
    from bot.models.referral import Referral, ReferralCode

    with get_session() as session:
        for uid in (referrer_id, referee_id):
            if not session.query(User).filter(User.id == uid).first():
                session.add(User(id=uid, telegram_id=1000 + uid))
        session.flush()
        if not session.query(ReferralCode).filter(ReferralCode.user_id == referrer_id).first():
            session.add(ReferralCode(user_id=referrer_id, code=f"CODE{referrer_id}"))
        session.add(
            Referral(
                referrer_id=referrer_id,
                referee_id=referee_id,
                referral_code=f"CODE{referrer_id}",
                is_active=True,
            )
        )
        session.add(_swap(swap_id, referee_id, volume_usd))


def _verified_at(referee_id):
    from database.db import get_session
    from bot.models.referral import Referral

    with get_session() as session:
        row = session.query(Referral).filter(Referral.referee_id == referee_id).first()
        return row.verified_at if row else None


def test_record_reward_verifies_the_referral(tmp_db):
    """A recorded swap commission must stamp verified_at — this is the wiring that was missing."""
    _seed_pair(referrer_id=1, referee_id=2, swap_id=1)
    svc = ReferralService()

    assert _verified_at(2) is None, "precondition: unverified before any activity"
    assert svc.get_verified_referral_count(1) == 0

    reward = svc.record_reward(referee_id=2, swap_id=1, fee_amount_usd=1.0)

    assert reward is not None
    assert _verified_at(2) is not None, "record_reward must verify the referral"
    assert svc.get_verified_referral_count(1) == 1


def test_verification_does_not_fire_below_min_volume(tmp_db):
    """No reward means no verification — the min-volume guard still gates everything."""
    _seed_pair(referrer_id=1, referee_id=2, swap_id=1, volume_usd=MIN_VOLUME_BEFORE_PAYOUT_USD - 1)
    svc = ReferralService()

    assert svc.record_reward(referee_id=2, swap_id=1, fee_amount_usd=1.0) is None
    assert _verified_at(2) is None
    assert svc.get_verified_referral_count(1) == 0


def test_verify_referral_is_idempotent(tmp_db):
    """Re-verifying must not re-stamp the timestamp or re-credit milestones."""
    _seed_pair(referrer_id=1, referee_id=2, swap_id=1)
    svc = ReferralService()
    svc.record_reward(referee_id=2, swap_id=1, fee_amount_usd=1.0)

    first = _verified_at(2)
    assert first is not None
    assert svc.verify_referral(2) is True
    assert _verified_at(2) == first


def test_crossing_threshold_credits_exactly_one_milestone_bonus(tmp_db):
    """The first milestone must actually pay out once the threshold is crossed."""
    from database.db import get_session
    from bot.models.referral import ReferralMilestone, ReferralEarning

    threshold = min(MILESTONE_BONUSES.keys())
    svc = ReferralService()

    for i in range(threshold):
        referee_id = 100 + i
        _seed_pair(referrer_id=1, referee_id=referee_id, swap_id=200 + i)
        svc.record_reward(referee_id=referee_id, swap_id=200 + i, fee_amount_usd=1.0)

    assert svc.get_verified_referral_count(1) == threshold

    with get_session() as session:
        milestones = (
            session.query(ReferralMilestone).filter(ReferralMilestone.referrer_id == 1).all()
        )
        assert len(milestones) == 1
        assert milestones[0].milestone_count == threshold
        assert milestones[0].bonus_usd == pytest.approx(MILESTONE_BONUSES[threshold])

        credits = (
            session.query(ReferralEarning)
            .filter(
                ReferralEarning.referrer_id == 1,
                ReferralEarning.stream_type == "milestone",
            )
            .all()
        )
        assert len(credits) == 1, "milestone bonus must be credited exactly once"
        assert credits[0].amount_usd == pytest.approx(MILESTONE_BONUSES[threshold])

    # Breakdown surfaces it to the user.
    assert svc.get_earnings_breakdown(1)["milestone"] == pytest.approx(MILESTONE_BONUSES[threshold])


def test_extra_activity_does_not_double_credit_a_milestone(tmp_db):
    """More swaps from already-verified referees must not re-award a cleared milestone."""
    from database.db import get_session
    from bot.models.referral import ReferralEarning

    threshold = min(MILESTONE_BONUSES.keys())
    svc = ReferralService()
    for i in range(threshold):
        referee_id = 100 + i
        _seed_pair(referrer_id=1, referee_id=referee_id, swap_id=200 + i)
        svc.record_reward(referee_id=referee_id, swap_id=200 + i, fee_amount_usd=1.0)

    # Second swap from each referee — all already verified.
    for i in range(threshold):
        referee_id = 100 + i
        with get_session() as session:
            session.add(_swap(300 + i, referee_id, 100.0))
        svc.record_reward(referee_id=referee_id, swap_id=300 + i, fee_amount_usd=1.0)

    assert svc.get_verified_referral_count(1) == threshold
    with get_session() as session:
        credits = (
            session.query(ReferralEarning)
            .filter(
                ReferralEarning.referrer_id == 1,
                ReferralEarning.stream_type == "milestone",
            )
            .count()
        )
    assert credits == 1, "milestone must not be re-credited on further activity"
