"""Tests for HyperUnit region gating in the fund handler."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from bot.handlers import fund


def _patch_user(user):
    """Patch fund.get_session so the User lookup returns `user`."""

    @contextmanager
    def _cm():
        sess = MagicMock()
        sess.query.return_value.filter.return_value.first.return_value = user
        yield sess

    return patch("bot.handlers.fund.get_session", _cm)


def test_us_user_blocked():
    with _patch_user(SimpleNamespace(region="US")):
        assert fund.hyperunit_allowed(1) is False


def test_non_us_user_allowed():
    with _patch_user(SimpleNamespace(region="GB")):
        assert fund.hyperunit_allowed(1) is True
    with _patch_user(SimpleNamespace(region="sg")):  # case-insensitive
        assert fund.hyperunit_allowed(1) is True


def test_unknown_region_blocked_failclosed():
    # No region set -> fail closed (blocked).
    with _patch_user(SimpleNamespace(region=None)):
        assert fund.hyperunit_allowed(1) is False
    # No user row at all -> blocked.
    with _patch_user(None):
        assert fund.hyperunit_allowed(1) is False


def test_db_error_failclosed():
    with patch("bot.handlers.fund.get_session", side_effect=RuntimeError("db down")):
        assert fund.hyperunit_allowed(1) is False


def test_menu_hides_native_when_not_allowed():
    kb = fund._menu_keyboard(allow_native=False)
    labels = [b.callback_data for row in kb.inline_keyboard for b in row]
    assert not any(c.startswith("fund_native_") for c in labels)
    assert "fund_usdc" in labels


def test_menu_shows_native_when_allowed():
    kb = fund._menu_keyboard(allow_native=True)
    labels = [b.callback_data for row in kb.inline_keyboard for b in row]
    assert any(c.startswith("fund_native_") for c in labels)
