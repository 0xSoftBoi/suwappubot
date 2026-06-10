"""Unit tests for the weekly digest due-date logic."""

from datetime import datetime, timedelta, timezone

from bot.services.digest_service import DIGEST_INTERVAL_DAYS, is_digest_due

NOW = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)


def test_never_sent_is_due():
    assert is_digest_due(None, NOW) is True


def test_sent_recently_not_due():
    assert is_digest_due(NOW - timedelta(days=1), NOW) is False


def test_sent_exactly_interval_not_due():
    assert is_digest_due(NOW - timedelta(days=DIGEST_INTERVAL_DAYS), NOW) is False


def test_sent_past_interval_is_due():
    assert is_digest_due(NOW - timedelta(days=DIGEST_INTERVAL_DAYS, hours=1), NOW) is True


def test_naive_datetime_treated_as_utc():
    naive_old = (NOW - timedelta(days=8)).replace(tzinfo=None)
    naive_recent = (NOW - timedelta(days=2)).replace(tzinfo=None)
    assert is_digest_due(naive_old, NOW) is True
    assert is_digest_due(naive_recent, NOW) is False
