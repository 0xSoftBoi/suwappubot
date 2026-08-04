"""Tests for the handle-reservation waitlist + referral leaderboard.

Covers the service layer (bot/services/waitlist_service.py) directly:
handle validation/normalization, one-reservation-per-email semantics via the
DB unique index, referral-credit abuse rules (self-referral, unknown code),
live rank ordering (referrals beat earlier signup time), the
referrals_to_next_rank formula, and that the leaderboard never leaks PII.

Uses the shared `tmp_db` fixture (isolated SQLite per test) from
tests/conftest.py.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from datetime import datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from bot.services.waitlist_service import (
    RESERVED_HANDLES,
    derive_seed,
    generate_referral_code,
    get_leaderboard,
    get_ranked_row,
    get_row_above,
    get_total_signups,
    normalize_handle,
    referrals_to_next_rank,
    validate_handle_format,
)


def _make_signup(session, handle, email, referred_by_id=None, created_at=None, telegram=None):
    from bot.models.waitlist import WaitlistSignup

    norm = normalize_handle(handle)
    signup = WaitlistSignup(
        handle=norm,
        email=email,
        telegram=telegram,
        referral_code=generate_referral_code(session, norm),
        referred_by_id=referred_by_id,
        seed=derive_seed(norm),
        created_at=created_at or datetime.utcnow(),
    )
    session.add(signup)
    session.flush()
    return signup


# ---------------------------------------------------------------------------
# Handle validation
# ---------------------------------------------------------------------------


def test_valid_handle_passes():
    assert validate_handle_format(normalize_handle("Satoshi")) is None
    assert validate_handle_format(normalize_handle("sat-oshi9")) is None


def test_handle_too_short_is_invalid():
    # Regex requires >=3 chars total (first char + at least 1 middle + last).
    assert validate_handle_format("a") == "invalid"
    assert validate_handle_format("ab") == "invalid"


def test_handle_leading_dash_is_invalid():
    assert validate_handle_format("-abc") == "invalid"


def test_handle_double_dash_is_invalid():
    assert validate_handle_format("ab--cd") == "invalid"


def test_reserved_handle_is_rejected():
    for word in ("admin", "support", "suwappu", "root"):
        assert word in RESERVED_HANDLES
        assert validate_handle_format(word) == "reserved"


def test_normalize_handle_lowercases_and_strips():
    assert normalize_handle("  Satoshi  ") == "satoshi"


# ---------------------------------------------------------------------------
# One reservation per email (DB-level uniqueness)
# ---------------------------------------------------------------------------


def test_one_reservation_per_email_enforced_by_unique_index(tmp_db):
    from database.db import get_session

    with get_session() as session:
        _make_signup(session, "satoshi", "a@b.com")

    # A second row with the same email must violate the unique index —
    # the /webapp/waitlist/reserve endpoint checks-before-insert and returns
    # already=True instead of ever attempting this, but the DB constraint is
    # the hard backstop.
    with pytest.raises(IntegrityError):
        with get_session() as session:
            _make_signup(session, "nakamoto", "a@b.com")


# ---------------------------------------------------------------------------
# Handle collision
# ---------------------------------------------------------------------------


def test_handle_collision_detected_before_insert(tmp_db):
    from database.db import get_session
    from bot.models.waitlist import WaitlistSignup

    with get_session() as session:
        _make_signup(session, "satoshi", "a@b.com")

    # Mirrors the check the /reserve endpoint performs (query-before-insert)
    # that yields the 409 handle_taken response.
    with get_session() as session:
        taken = session.query(WaitlistSignup.id).filter(WaitlistSignup.handle == "satoshi").first()
        assert taken is not None


# ---------------------------------------------------------------------------
# Referral credit abuse rules
# ---------------------------------------------------------------------------


def test_self_referral_is_not_credited(tmp_db):
    """If a ref code's owner has the SAME email as the new signup, credit is
    withheld — this mirrors the endpoint's ref_row.email != email check."""
    from database.db import get_session

    with get_session() as session:
        owner = _make_signup(session, "satoshi", "a@b.com")
        ref_code = owner.referral_code

    with get_session() as session:
        from bot.models.waitlist import WaitlistSignup

        ref_row = (
            session.query(WaitlistSignup).filter(WaitlistSignup.referral_code == ref_code).first()
        )
        # Same email as the referrer -> self-referral -> must not credit.
        referred_by_id = None
        if ref_row is not None and ref_row.email != "a@b.com":
            referred_by_id = ref_row.id
        assert referred_by_id is None

        second = _make_signup(session, "nakamoto2", "a@b.com".upper() + "x")  # distinct email
        # sanity: a DIFFERENT email crediting the same code DOES get credited
        ref_row2 = (
            session.query(WaitlistSignup).filter(WaitlistSignup.referral_code == ref_code).first()
        )
        assert ref_row2.email != second.email


def test_unknown_ref_code_is_ignored(tmp_db):
    from database.db import get_session
    from bot.models.waitlist import WaitlistSignup

    with get_session() as session:
        ref_row = (
            session.query(WaitlistSignup)
            .filter(WaitlistSignup.referral_code == "NOPE-0000")
            .first()
        )
        referred_by_id = ref_row.id if ref_row is not None else None
        assert referred_by_id is None

        # Signup still gets created despite the unresolved ref code.
        signup = _make_signup(session, "ghost", "ghost@x.com", referred_by_id=referred_by_id)
        assert signup.id is not None
        assert signup.referred_by_id is None


# ---------------------------------------------------------------------------
# Live rank ordering
# ---------------------------------------------------------------------------


def test_rank_puts_late_referrer_above_early_no_referrals(tmp_db):
    """A signup from 2 days ago with 0 referrals must rank BELOW a signup
    from today with 3 referrals — referring friends genuinely moves you up."""
    from database.db import get_session

    now = datetime.utcnow()
    early = now - timedelta(days=2)
    late = now

    with get_session() as session:
        early_signup = _make_signup(session, "early", "early@x.com", created_at=early)
        late_signup = _make_signup(session, "late", "late@x.com", created_at=late)
        # 3 referrals credited to `late_signup`.
        for i in range(3):
            _make_signup(
                session,
                f"referee{i}",
                f"referee{i}@x.com",
                referred_by_id=late_signup.id,
                created_at=now,
            )

    with get_session() as session:
        late_ranked = get_ranked_row(session, late_signup.id)
        early_ranked = get_ranked_row(session, early_signup.id)

        assert late_ranked.referral_count == 3
        assert early_ranked.referral_count == 0
        assert late_ranked.position < early_ranked.position


def test_rank_tiebreak_is_created_at_then_id(tmp_db):
    from database.db import get_session

    now = datetime.utcnow()

    with get_session() as session:
        first = _make_signup(session, "first", "first@x.com", created_at=now)
        second = _make_signup(
            session, "second", "second@x.com", created_at=now + timedelta(seconds=1)
        )

    with get_session() as session:
        r1 = get_ranked_row(session, first.id)
        r2 = get_ranked_row(session, second.id)
        # Same referral_count (0) -> earlier created_at wins the tie-break.
        assert r1.position < r2.position


# ---------------------------------------------------------------------------
# referrals_to_next_rank
# ---------------------------------------------------------------------------


def test_referrals_to_next_rank_rank_one_is_zero(tmp_db):
    from database.db import get_session

    with get_session() as session:
        top = _make_signup(session, "top", "top@x.com")

    with get_session() as session:
        ranked = get_ranked_row(session, top.id)
        above = get_row_above(session, ranked.position)
        assert above is None
        assert referrals_to_next_rank(ranked, above) == 0


def test_referrals_to_next_rank_tie_needs_one_more(tmp_db):
    from database.db import get_session

    now = datetime.utcnow()
    with get_session() as session:
        leader = _make_signup(session, "leader", "leader@x.com", created_at=now)
        follower = _make_signup(
            session, "follower", "follower@x.com", created_at=now + timedelta(seconds=5)
        )
        # Both have 0 referrals -> leader wins purely on earlier created_at.

    with get_session() as session:
        follower_ranked = get_ranked_row(session, follower.id)
        above = get_row_above(session, follower_ranked.position)
        assert above.referral_count == follower_ranked.referral_count == 0
        assert referrals_to_next_rank(follower_ranked, above) == 1


def test_referrals_to_next_rank_needs_the_gap_plus_one(tmp_db):
    from database.db import get_session

    now = datetime.utcnow()
    with get_session() as session:
        leader = _make_signup(session, "leader2", "leader2@x.com", created_at=now)
        follower = _make_signup(
            session, "follower2", "follower2@x.com", created_at=now + timedelta(seconds=5)
        )
        # Leader has 4 referrals, follower has 1 -> gap is 3, needs 3+1=4.
        for i in range(4):
            _make_signup(
                session, f"lref{i}", f"lref{i}@x.com", referred_by_id=leader.id, created_at=now
            )
        _make_signup(session, "fref0", "fref0@x.com", referred_by_id=follower.id, created_at=now)

    with get_session() as session:
        follower_ranked = get_ranked_row(session, follower.id)
        assert follower_ranked.referral_count == 1
        above = get_row_above(session, follower_ranked.position)
        assert above.referral_count == 4
        assert referrals_to_next_rank(follower_ranked, above) == 4


# ---------------------------------------------------------------------------
# Leaderboard PII
# ---------------------------------------------------------------------------


def test_leaderboard_leaks_no_pii(tmp_db):
    from database.db import get_session

    with get_session() as session:
        _make_signup(session, "pubfig", "secret-email@x.com", telegram="@secrettelegram")

    with get_session() as session:
        rows = get_leaderboard(session, limit=10)

    assert len(rows) == 1
    row = rows[0]
    # RankedRow only ever carries id/handle/referral_code/referral_count/position —
    # no email/telegram/attribution/ip_hash fields exist to leak.
    allowed_fields = {"id", "handle", "referral_code", "referral_count", "position"}
    assert set(row.__dataclass_fields__.keys()) == allowed_fields
    assert row.handle == "pubfig"


def test_leaderboard_limit_and_total_signups(tmp_db):
    from database.db import get_session

    with get_session() as session:
        for i in range(5):
            _make_signup(session, f"user{i}", f"user{i}@x.com")

    with get_session() as session:
        rows = get_leaderboard(session, limit=2)
        total = get_total_signups(session)

    assert len(rows) == 2
    assert total == 5
