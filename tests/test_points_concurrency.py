"""Tests for the H6 points double-spend fix, plus its follow-up MONEY-PATH
review (BLOCKER / NEW-8).

bot/services/points_service.py::spend_points / redeem_subscription_reward /
redeem_marketplace_reward each do a read-modify-write on UserPoints.current_points.
Before this fix, none of them locked the row, so N concurrent calls could all
read the same balance, all pass the "enough points" check, and all debit —
letting a user with 2000 points redeem a 2000-point subscription reward 5x in
parallel (5 grants for 1 spend).

The fix adds `.with_for_update()` to the UserPoints read in all three methods.

BLOCKER (this round): `award_points` did the SAME read-modify-write on
current_points/total_points_earned/xp but with a PLAIN (unlocked) SELECT. On
Postgres READ COMMITTED this is a lost-update: a concurrent spend_points call
holds the row lock and commits a debit, while an unlocked award_points reads
the pre-debit balance, computes its new total off that stale value, and
overwrites the debit once its own UPDATE lands — the user keeps the reward
AND gets the spent points back. Fixed by adding the same `.with_for_update()`
to award_points (and, per the reviewer's "audit the whole file" instruction,
to every other UserPoints read-modify-write site: award_swap_points,
daily_checkin (NEW-8), and _check_milestones).

SQLite/Postgres note: SQLAlchemy's sqlite dialect compiles `FOR UPDATE` away
entirely (verified: `Query.with_for_update()` against a sqlite engine emits no
FOR UPDATE clause and raises nothing) — so a *real* concurrent-lock test isn't
demonstrable on this backend, only on Postgres (which is what runs in prod).
Per the review's own fallback guidance, this suite instead verifies:
  1. the lock helper (`Query.with_for_update`) is actually invoked by every
     read-modify-write method (a spy on the SQLAlchemy method itself, not a
     mock of our code), and
  2. the plain business invariant — current_points can never go negative, and
     a fixed balance can only fund ONE redemption of its own size, even across
     repeated back-to-back calls that simulate a duplicate/retry burst; and,
     for the award-vs-spend gap, that an award applied after a spend builds on
     top of the POST-spend balance rather than clobbering it back.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import pytest
from sqlalchemy.orm import Query

from database.db import get_session, init_db
from bot.models.points import UserPoints, Reward
from bot.models.user import User
from bot.services.points_service import points_service


@pytest.fixture()
def sqlite_db(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'points-concurrency.db'}"
    assert init_db(database_url)
    with get_session() as session:
        session.add(User(id=1, username="spender"))
        session.flush()
    yield


def _make_points_account(user_id: int, current_points: int):
    with get_session() as session:
        session.add(
            UserPoints(
                user_id=user_id,
                total_points_earned=current_points,
                current_points=current_points,
                xp=current_points,
                level="bronze",
            )
        )
        session.flush()


def _make_reward(
    reward_id, reward_type, reward_value, cost, category="own_product", duration_days=None
):
    with get_session() as session:
        session.add(
            Reward(
                id=reward_id,
                name="Test Reward",
                description="desc",
                points_cost=cost,
                reward_type=reward_type,
                reward_value=reward_value,
                reward_category=category,
                is_active=True,
                duration_days=duration_days,
            )
        )
        session.flush()


def _with_for_update_spy(monkeypatch):
    """Wrap SQLAlchemy's real Query.with_for_update so we can assert it was
    actually called, while still exercising the real (no-op-on-sqlite)
    implementation underneath."""
    calls = {"n": 0}
    original = Query.with_for_update

    def spy(self, *args, **kwargs):
        calls["n"] += 1
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Query, "with_for_update", spy)
    return calls


class TestSpendPointsRowLock:
    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        _make_points_account(1, 2000)
        calls = _with_for_update_spy(monkeypatch)

        ok, msg = points_service.spend_points(
            user_id=1, amount=500, reward_type="fee_discount", reward_value="0.5"
        )

        assert ok is True
        assert calls["n"] >= 1

    def test_cannot_overspend_across_duplicate_calls(self, sqlite_db):
        """H6 core invariant: a user with 2000 points cannot have two 2000-point
        redemptions both succeed — the second read must see the already-debited
        balance and fail the check, and current_points must never go negative."""
        _make_points_account(1, 2000)

        ok1, msg1 = points_service.spend_points(
            user_id=1, amount=2000, reward_type="raffle", reward_value="1"
        )
        ok2, msg2 = points_service.spend_points(
            user_id=1, amount=2000, reward_type="raffle", reward_value="1"
        )

        assert ok1 is True
        assert ok2 is False
        assert "Not enough points" in msg2

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 0

    def test_five_duplicate_redeem_attempts_only_one_succeeds(self, sqlite_db):
        """Mirrors the H6 report's shape (5 redeem attempts against a single
        2000-point balance priced at 2000 each) without relying on real thread
        concurrency, which SQLite's FOR-UPDATE no-op can't demonstrate."""
        _make_points_account(1, 2000)

        results = [
            points_service.spend_points(
                user_id=1, amount=2000, reward_type="raffle", reward_value="1"
            )
            for _ in range(5)
        ]

        successes = [r for r in results if r[0] is True]
        assert len(successes) == 1

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 0
            assert account.points_spent == 2000


class TestRedeemSubscriptionRewardRowLock:
    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        _make_points_account(1, 5000)
        _make_reward(
            70, reward_type="subscription", reward_value="pro", cost=2000, duration_days=30
        )
        calls = _with_for_update_spy(monkeypatch)

        ok, msg, expiry = points_service.redeem_subscription_reward(user_id=1, reward_id=70)

        assert ok is True
        assert calls["n"] >= 1

    def test_cannot_double_grant_subscription_from_duplicate_redemptions(self, sqlite_db):
        """H6's exact reported scenario: redeeming a 2000-point subscription
        reward twice against a 2000-point balance must NOT grant/extend the
        subscription twice (the compounding-expiry bug the review flagged) —
        the second call must fail the balance check entirely."""
        _make_reward(
            71, reward_type="subscription", reward_value="pro", cost=2000, duration_days=30
        )
        _make_points_account(1, 2000)

        ok1, msg1, exp1 = points_service.redeem_subscription_reward(user_id=1, reward_id=71)
        ok2, msg2, exp2 = points_service.redeem_subscription_reward(user_id=1, reward_id=71)

        assert ok1 is True
        assert exp1 is not None
        assert ok2 is False
        assert exp2 is None
        assert "Not enough points" in msg2

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 0

        from bot.models.subscription import Subscription

        with get_session() as session:
            subs = session.query(Subscription).filter(Subscription.user_id == 1).all()
            # Exactly one subscription row, extended exactly once (not compounded
            # into a second +30-day grant the user never paid for).
            assert len(subs) == 1
            assert subs[0].expires_at.date().isoformat() == exp1


class TestRedeemMarketplaceRewardRowLock:
    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        _make_points_account(1, 1000)
        _make_reward(80, reward_type="merch", reward_value="hoodie", cost=500, category="merch")
        calls = _with_for_update_spy(monkeypatch)

        # Sandbox provider is disabled by default -> refunded, but the debit
        # (and its row lock) still happens inside the same transaction first.
        success, message, order_id = points_service.redeem_marketplace_reward(
            user_id=1, reward_id=80
        )

        assert calls["n"] >= 1
        assert order_id is not None

    def test_insufficient_points_never_locks_a_phantom_debit(self, sqlite_db):
        _make_points_account(1, 100)
        _make_reward(81, reward_type="merch", reward_value="hoodie", cost=500, category="merch")

        success, message, order_id = points_service.redeem_marketplace_reward(
            user_id=1, reward_id=81
        )

        assert success is False
        assert order_id is None
        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 100  # untouched


class TestAwardPointsRowLock:
    """BLOCKER fix: award_points was a plain (unlocked) read-modify-write on
    current_points/total_points_earned/xp. This is the primary regression
    tripwire for that finding — if `.with_for_update()` is ever removed from
    award_points, this test fails immediately, independent of the sqlite
    FOR-UPDATE-is-a-no-op limitation described in the module docstring."""

    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        _make_points_account(1, 100)
        calls = _with_for_update_spy(monkeypatch)

        points, new_level = points_service.award_points(user_id=1, action="checkin", amount=10)

        assert points == 10
        assert calls["n"] >= 1

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 110
            assert account.total_points_earned == 110


class TestAwardSwapPointsRowLock:
    """Audit fix: award_swap_points reads-then-writes total_swaps/
    total_volume_usd/last_swap_date on the same UserPoints row."""

    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        _make_points_account(1, 0)
        calls = _with_for_update_spy(monkeypatch)

        points_service.award_swap_points(user_id=1, swap_amount_usd=50.0, swap_id=1)

        assert calls["n"] >= 1
        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.total_swaps == 1


class TestDailyCheckinRowLock:
    """NEW-8 fix: daily_checkin reads-then-writes daily_streak/longest_streak/
    last_checkin. POST /v1/mobile/points/checkin only recently became reachable
    (a prior bug awaited this sync method and 400'd every call), so this path
    was never exercised concurrently before now."""

    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        _make_points_account(1, 0)
        calls = _with_for_update_spy(monkeypatch)

        points_earned, streak, continued, new_level = points_service.daily_checkin(user_id=1)

        assert points_earned > 0
        assert calls["n"] >= 1

    def test_double_tap_same_day_only_awards_once(self, sqlite_db):
        """Two back-to-back check-in calls on the same calendar day must not
        double-award or inflate the streak — the second call is a no-op. This
        exercises the "already checked in today" guard's business behavior;
        the row lock's job (see the with_for_update test above) is making this
        guard race-safe under REAL concurrency, which sqlite's FOR-UPDATE
        no-op can't demonstrate (see module docstring)."""
        _make_points_account(1, 0)

        points1, streak1, continued1, level1 = points_service.daily_checkin(user_id=1)
        points2, streak2, continued2, level2 = points_service.daily_checkin(user_id=1)

        assert points1 > 0
        assert points2 == 0
        assert streak1 == 1
        assert streak2 == 1  # unchanged, not double-incremented
        assert continued2 is False

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.daily_streak == 1
            assert account.current_points == points1  # only the first check-in's award landed


class TestCheckMilestonesRowLock:
    """Audit fix: _check_milestones reads-then-writes total_points_earned/
    current_points/xp when a milestone is newly achieved."""

    def test_with_for_update_is_invoked(self, sqlite_db, monkeypatch):
        from bot.models.points import Milestone

        _make_points_account(1, 0)
        with get_session() as session:
            session.add(
                Milestone(
                    name="First Swap",
                    description="Complete your first swap",
                    requirement_type="swaps",
                    requirement_value=1,
                    points_reward=100,
                    is_active=True,
                )
            )
            session.flush()
        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            account.total_swaps = 1

        calls = _with_for_update_spy(monkeypatch)

        achieved = points_service._check_milestones(1)

        assert "First Swap" in achieved
        assert calls["n"] >= 1
        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 100


class TestAwardVsSpendInterleaving:
    """The BLOCKER's exact reported scenario, in sequential (DB-serialized)
    form: a spend that lands first must not get silently restored by a
    subsequent award computing off a stale pre-spend balance.

    NOTE on what this test can/can't prove: SQLAlchemy's sqlite dialect
    compiles `.with_for_update()` away entirely (see module docstring), so a
    *real* overlapping-transaction race between spend_points and award_points
    isn't reproducible on this backend — it would behave identically whether
    or not the row lock is present, since sqlite has no FOR-UPDATE blocking to
    demonstrate. The authoritative regression guard for the actual concurrency
    fix is `TestAwardPointsRowLock.test_with_for_update_is_invoked` above (a
    spy on the SQLAlchemy method itself). What THIS test guards is the
    arithmetic/business invariant that must hold regardless of ordering: an
    award must always increment on top of whatever `current_points` currently
    is, never re-derive it from a cached/stale snapshot.
    """

    def test_award_after_spend_builds_on_post_spend_balance(self, sqlite_db):
        _make_points_account(1, 1000)

        ok, msg = points_service.spend_points(
            user_id=1, amount=600, reward_type="raffle", reward_value="1"
        )
        assert ok is True

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 400  # spend landed

        points, new_level = points_service.award_points(user_id=1, action="checkin", amount=50)
        assert points == 50

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            # Must be 400 + 50 = 450 — NOT 1000 + 50 = 1050, which is what the
            # BLOCKER's stale unlocked read would have produced (the spend
            # silently restored, user keeps the reward AND the points back).
            assert account.current_points == 450
            assert account.points_spent == 600
            assert account.total_points_earned == 1050  # 1000 initial + 50 awarded

    def test_spend_after_award_also_reflects_prior_award(self, sqlite_db):
        _make_points_account(1, 1000)

        points, new_level = points_service.award_points(user_id=1, action="checkin", amount=50)
        assert points == 50

        ok, msg = points_service.spend_points(
            user_id=1, amount=1000, reward_type="raffle", reward_value="1"
        )
        assert ok is True  # 1050 available, 1000 requested

        with get_session() as session:
            account = session.query(UserPoints).filter(UserPoints.user_id == 1).first()
            assert account.current_points == 50  # 1000 + 50 - 1000
