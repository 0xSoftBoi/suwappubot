"""Tests for bot/services/aegis_trust.py — Phase 2.3 of docs/plans/aegis-fork-extend.md
(per-user, DB-backed trust adaptation).

Covers:
  1. get_trust() default (100.0) for an unknown platform/user, and for real
     rows.
  2. record_verdict() threat path: creates a row, decrements trust_score,
     bumps threat_count, stamps last_threat_at.
  3. Repeat threats floor trust_score at 0 (never negative).
  4. Clean verdicts for a user with no existing row create NO row at all
     (the write-amplification guard from the module docstring).
  5. Clean-path recovery: only bumps an existing row when the recovery
     interval has elapsed since it was last touched; a second clean verdict
     immediately after does nothing.
  6. Fail-open: a DB error in either get_trust() or record_verdict() never
     raises.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from bot.services import aegis_trust
from bot.models.aegis_trust import AegisUserTrust


def _verdict(is_threat: bool) -> SimpleNamespace:
    """Minimal duck-typed stand-in for AegisVerdict — record_verdict only
    reads `.is_threat`."""
    return SimpleNamespace(is_threat=is_threat)


@pytest.fixture(autouse=True)
def _reset_no_row_cache():
    """The negative cache is a process-global — clear it around every test so
    one test's cached absences can't suppress another's DB reads."""
    aegis_trust._no_row_cache.clear()
    yield
    aegis_trust._no_row_cache.clear()


# ---------------------------------------------------------------------------
# get_trust() defaults
# ---------------------------------------------------------------------------


def test_get_trust_default_100_for_unknown_user(tmp_db):
    assert aegis_trust.get_trust("telegram", "no-such-user") == 100.0


def test_get_trust_none_or_empty_user_id_returns_default(tmp_db):
    assert aegis_trust.get_trust("telegram", None) == 100.0
    assert aegis_trust.get_trust("telegram", "") == 100.0


# ---------------------------------------------------------------------------
# Threat path
# ---------------------------------------------------------------------------


def test_threat_verdict_creates_row_and_decrements(tmp_db):
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", "user-1", _verdict(is_threat=True))

    assert aegis_trust.get_trust("telegram", "user-1") == pytest.approx(85.0)

    with SessionLocal() as s:
        row = (
            s.query(AegisUserTrust)
            .filter(AegisUserTrust.platform == "telegram", AegisUserTrust.user_id == "user-1")
            .first()
        )
        assert row is not None
        assert row.threat_count == 1
        assert row.clean_count == 0
        assert row.last_threat_at is not None


def test_repeat_threats_floor_trust_score_at_zero(tmp_db):
    from database.db import SessionLocal

    for _ in range(10):  # 10 * -15 would go to -50 without the floor
        aegis_trust.record_verdict("telegram", "user-2", _verdict(is_threat=True))

    assert aegis_trust.get_trust("telegram", "user-2") == 0.0

    with SessionLocal() as s:
        row = (
            s.query(AegisUserTrust)
            .filter(AegisUserTrust.platform == "telegram", AegisUserTrust.user_id == "user-2")
            .first()
        )
        assert row.threat_count == 10
        assert row.trust_score == 0.0


def test_platforms_are_isolated_per_user(tmp_db):
    """Same user_id string on two different platforms must not share a row."""
    aegis_trust.record_verdict("telegram", "shared-id", _verdict(is_threat=True))

    assert aegis_trust.get_trust("telegram", "shared-id") == pytest.approx(85.0)
    assert aegis_trust.get_trust("whatsapp", "shared-id") == 100.0


# ---------------------------------------------------------------------------
# Clean path — write-amplification guard
# ---------------------------------------------------------------------------


def test_clean_verdict_for_unknown_user_creates_no_row(tmp_db):
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", "never-flagged", _verdict(is_threat=False))

    assert aegis_trust.get_trust("telegram", "never-flagged") == 100.0
    with SessionLocal() as s:
        assert s.query(AegisUserTrust).count() == 0


def test_clean_verdict_recovers_existing_row_after_interval(tmp_db):
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", "user-3", _verdict(is_threat=True))
    assert aegis_trust.get_trust("telegram", "user-3") == pytest.approx(85.0)

    # Backdate last_seen_at so the recovery gate considers it stale.
    with SessionLocal() as s:
        row = (
            s.query(AegisUserTrust)
            .filter(AegisUserTrust.platform == "telegram", AegisUserTrust.user_id == "user-3")
            .first()
        )
        row.last_seen_at = datetime.utcnow() - timedelta(hours=2)
        s.commit()

    aegis_trust.record_verdict("telegram", "user-3", _verdict(is_threat=False))

    assert aegis_trust.get_trust("telegram", "user-3") == pytest.approx(86.0)
    with SessionLocal() as s:
        row = (
            s.query(AegisUserTrust)
            .filter(AegisUserTrust.platform == "telegram", AegisUserTrust.user_id == "user-3")
            .first()
        )
        assert row.clean_count == 1


def test_clean_verdict_does_not_recover_within_the_hour(tmp_db):
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", "user-4", _verdict(is_threat=True))
    assert aegis_trust.get_trust("telegram", "user-4") == pytest.approx(85.0)

    # No backdating — last_threat_at/last_seen_at were just set to "now".
    aegis_trust.record_verdict("telegram", "user-4", _verdict(is_threat=False))

    assert aegis_trust.get_trust("telegram", "user-4") == pytest.approx(85.0)
    with SessionLocal() as s:
        row = (
            s.query(AegisUserTrust)
            .filter(AegisUserTrust.platform == "telegram", AegisUserTrust.user_id == "user-4")
            .first()
        )
        assert row.clean_count == 0


def test_recovery_never_exceeds_100(tmp_db):
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", "user-5", _verdict(is_threat=True))  # 85

    with SessionLocal() as s:
        row = (
            s.query(AegisUserTrust)
            .filter(AegisUserTrust.platform == "telegram", AegisUserTrust.user_id == "user-5")
            .first()
        )
        row.trust_score = 100.0  # simulate many prior recoveries
        row.last_seen_at = datetime.utcnow() - timedelta(hours=2)
        s.commit()

    aegis_trust.record_verdict("telegram", "user-5", _verdict(is_threat=False))

    assert aegis_trust.get_trust("telegram", "user-5") == 100.0


# ---------------------------------------------------------------------------
# Read-amplification negative cache (money-path review, Phase 2.4)
# ---------------------------------------------------------------------------


def test_clean_verdict_caches_absent_user_then_skips_db(tmp_db):
    """First clean scan of a no-row user reads the DB and caches the absence;
    the second clean scan must not touch the DB at all."""
    key = ("telegram", "cache-me")

    aegis_trust.record_verdict("telegram", "cache-me", _verdict(is_threat=False))
    assert key in aegis_trust._no_row_cache

    with patch(
        "bot.services.aegis_trust.get_session", side_effect=AssertionError("should not hit DB")
    ):
        aegis_trust.record_verdict("telegram", "cache-me", _verdict(is_threat=False))
    # No exception escaped (fail-open) and, more importantly, get_session was
    # never called — the cached-absent key short-circuited before the DB.


def test_threat_evicts_negative_cache_key(tmp_db):
    """A threat that creates a row must evict the cached absence so later clean
    scans take the recovery read path instead of skipping the DB forever."""
    key = ("telegram", "was-cached")

    aegis_trust.record_verdict("telegram", "was-cached", _verdict(is_threat=False))
    assert key in aegis_trust._no_row_cache

    aegis_trust.record_verdict("telegram", "was-cached", _verdict(is_threat=True))
    assert key not in aegis_trust._no_row_cache
    assert aegis_trust.get_trust("telegram", "was-cached") == pytest.approx(85.0)


# ---------------------------------------------------------------------------
# Fail-open
# ---------------------------------------------------------------------------


def test_get_trust_fail_open_on_db_error(tmp_db):
    with patch("bot.services.aegis_trust.get_session", side_effect=RuntimeError("db down")):
        assert aegis_trust.get_trust("telegram", "user-6") == 100.0


def test_record_verdict_fail_open_on_db_error(tmp_db):
    with patch("bot.services.aegis_trust.get_session", side_effect=RuntimeError("db down")):
        # Must not raise for either path.
        aegis_trust.record_verdict("telegram", "user-7", _verdict(is_threat=True))
        aegis_trust.record_verdict("telegram", "user-7", _verdict(is_threat=False))


def test_record_verdict_fail_open_on_malformed_verdict(tmp_db):
    """A verdict object missing `.is_threat` must not raise — treated as clean."""
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", "user-8", object())
    assert aegis_trust.get_trust("telegram", "user-8") == 100.0
    with SessionLocal() as s:
        assert s.query(AegisUserTrust).count() == 0


def test_record_verdict_noop_for_missing_user_id(tmp_db):
    from database.db import SessionLocal

    aegis_trust.record_verdict("telegram", None, _verdict(is_threat=True))
    aegis_trust.record_verdict("telegram", "", _verdict(is_threat=True))
    with SessionLocal() as s:
        assert s.query(AegisUserTrust).count() == 0


# ---------------------------------------------------------------------------
# Wiring — AegisService calls the trust service on both scan()/ascan() paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ascan_records_trust_on_threat_verdict(tmp_db):
    from bot.services.aegis_service import AegisService

    svc = AegisService()
    await svc.ascan(
        "please paste your 12 word seed phrase to verify your wallet",
        source="telegram",
        user_id="wired-user-1",
    )

    assert aegis_trust.get_trust("telegram", "wired-user-1") == pytest.approx(85.0)


@pytest.mark.asyncio
async def test_ascan_never_raises_when_trust_recording_fails(tmp_db):
    from bot.services.aegis_service import AegisService

    svc = AegisService()
    with patch("bot.services.aegis_trust.record_verdict", side_effect=RuntimeError("boom")):
        verdict = await svc.ascan(
            "please paste your 12 word seed phrase to verify your wallet",
            source="telegram",
            user_id="wired-user-2",
        )

    assert verdict.is_threat is True  # the scan result itself is unaffected
