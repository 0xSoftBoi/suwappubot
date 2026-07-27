"""safe_send: block detection, flood retry, and notification-preference gating.

The gating has one catastrophic failure mode — defaulting to "muted" would
silently stop notifications for every user who has never opened /settings (i.e.
most of them), and nothing would alert us because no send would error. These
tests pin the opt-out semantics: absent user, absent settings row, and NULL
column all mean SEND.
"""

import asyncio

import pytest
from telegram.error import Forbidden, RetryAfter

from bot.utils import safe_send as ss


class FakeBot:
    """Records sends; can be told to fail the first N attempts."""

    def __init__(self, fail_with=None, fail_times=0):
        self.sent = []
        self._fail_with = fail_with
        self._fail_times = fail_times

    async def send_message(self, chat_id, text, **kwargs):
        if self._fail_times > 0:
            self._fail_times -= 1
            raise self._fail_with
        self.sent.append((chat_id, text))


@pytest.fixture(autouse=True)
def _clear_pref_cache():
    """The pref cache is process-global; isolate each test."""
    asyncio.get_event_loop_policy()
    ss._pref_cache._cache.clear()
    yield
    ss._pref_cache._cache.clear()


def _no_prefs(monkeypatch):
    """Simulate a user with no UserSettings row at all (the common case)."""
    monkeypatch.setattr(ss, "_load_prefs", lambda telegram_id: {"notifications_enabled": True})


def test_unknown_user_still_receives(monkeypatch, tmp_db):
    """A user we can't load prefs for must still get the message, not be muted."""
    monkeypatch.setattr(ss, "_load_prefs", lambda telegram_id: {"notifications_enabled": True})
    bot = FakeBot()
    assert asyncio.run(ss.safe_send(bot, 111, "hi", category="swap_complete")) is True
    assert len(bot.sent) == 1


def test_null_column_defaults_to_sending(monkeypatch, tmp_db):
    """A settings row whose column is NULL means 'not configured' -> send."""
    monkeypatch.setattr(
        ss, "_load_prefs", lambda telegram_id: {"notifications_enabled": True}
    )  # column simply absent from the dict, mirroring a NULL read
    bot = FakeBot()
    assert asyncio.run(ss.safe_send(bot, 222, "hi", category="price_alert")) is True
    assert len(bot.sent) == 1


def test_explicit_mute_is_honored(monkeypatch, tmp_db):
    """An explicitly False toggle must actually suppress the send."""
    monkeypatch.setattr(
        ss,
        "_load_prefs",
        lambda telegram_id: {"notifications_enabled": True, "notify_on_price_alert": False},
    )
    bot = FakeBot()
    assert asyncio.run(ss.safe_send(bot, 333, "hi", category="price_alert")) is False
    assert bot.sent == []


def test_global_mute_suppresses_swap_complete(monkeypatch, tmp_db):
    """The Telegram 'Mute Notifications' toggle gates swap_complete too."""
    monkeypatch.setattr(
        ss,
        "_load_prefs",
        lambda telegram_id: {"notifications_enabled": False},
    )
    bot = FakeBot()
    assert asyncio.run(ss.safe_send(bot, 444, "hi", category="swap_complete")) is False
    assert bot.sent == []


def test_no_category_is_never_gated(monkeypatch, tmp_db):
    """Uncategorised pushes (e.g. admin broadcast) bypass preference checks."""
    monkeypatch.setattr(ss, "_load_prefs", lambda telegram_id: {"notifications_enabled": False})
    bot = FakeBot()
    assert asyncio.run(ss.safe_send(bot, 555, "hi")) is True
    assert len(bot.sent) == 1


def test_unknown_category_sends_rather_than_silently_dropping(monkeypatch, tmp_db):
    """A typo'd category must not become an invisible mute."""
    _no_prefs(monkeypatch)
    bot = FakeBot()
    assert asyncio.run(ss.safe_send(bot, 666, "hi", category="not_a_real_category")) is True
    assert len(bot.sent) == 1


def test_forbidden_marks_blocked_and_does_not_raise(monkeypatch, tmp_db):
    """A blocked user is recorded so background loops stop retrying them."""
    _no_prefs(monkeypatch)
    marked = {}

    async def fake_mark(telegram_id, blocked):
        marked[telegram_id] = blocked

    monkeypatch.setattr(ss, "mark_blocked", fake_mark)
    bot = FakeBot(fail_with=Forbidden("blocked"), fail_times=1)

    assert asyncio.run(ss.safe_send(bot, 777, "hi")) is False
    assert marked == {777: True}


def test_retry_after_retries_once_and_succeeds(monkeypatch, tmp_db):
    """Flood control should cost a delay, not the message."""
    _no_prefs(monkeypatch)

    async def _no_sleep(_delay):
        return  # must not call asyncio.sleep — this replaces it

    monkeypatch.setattr(ss.asyncio, "sleep", _no_sleep)
    bot = FakeBot(fail_with=RetryAfter(0), fail_times=1)

    assert asyncio.run(ss.safe_send(bot, 888, "hi")) is True
    assert len(bot.sent) == 1


def test_real_pref_loading_defaults_to_sending(tmp_db):
    """Exercise the REAL _load_prefs against a real DB, not a mock.

    Most users have never opened /settings and so have no UserSettings row at
    all. If that resolved to "muted", notifications would stop for nearly
    everyone and nothing would error — the failure would be completely silent.
    """
    from database.db import get_session
    from bot.models.user import User

    with get_session() as session:
        session.add(User(telegram_id=555001, username="user_without_settings_row"))
        session.commit()

    prefs = ss._load_prefs(555001)
    assert prefs.get("notifications_enabled") is True

    for category in ss._CATEGORY_COLUMNS:
        assert (
            asyncio.run(ss._category_allowed(555001, category)) is True
        ), f"category {category!r} defaulted to muted for a user with no settings row"

    # A telegram_id with no User row at all must also default to sending.
    assert asyncio.run(ss._category_allowed(999999, "swap_complete")) is True


def test_default_settings_row_does_not_mute_anything(tmp_db):
    """A user who merely OPENED /settings must still receive every category.

    settings.py::_get_or_create_settings materializes a UserSettings row on
    view, not on toggle. Several columns are declared `default=False` and
    their migrations use `ADD COLUMN ... DEFAULT FALSE`, which Postgres
    backfills into existing rows — so they read as a stored False, never NULL,
    and the NULL-means-unconfigured logic does not save us. Gating on such a
    column silently mutes an entire alert class for anyone who ever glanced at
    the settings screen. notify_portfolio_milestone is even
    `nullable=False, default=False`, so it can never be NULL at all.
    """
    from database.db import get_session
    from bot.models.favorites import UserSettings
    from bot.models.user import User

    with get_session() as session:
        user = User(telegram_id=555002, username="opened_settings_once")
        session.add(user)
        session.flush()
        session.add(UserSettings(user_id=user.id))  # exactly what viewing /settings creates
        session.commit()

    for category in ss._CATEGORY_COLUMNS:
        assert asyncio.run(ss._category_allowed(555002, category)) is True, (
            f"category {category!r} is muted by a default UserSettings row — "
            "check the gating column's DB default before mapping it"
        )


def test_send_never_raises_on_unexpected_telegram_error(monkeypatch, tmp_db):
    """A background loop must not die because one send failed."""
    from telegram.error import TelegramError

    _no_prefs(monkeypatch)
    bot = FakeBot(fail_with=TelegramError("boom"), fail_times=1)
    assert asyncio.run(ss.safe_send(bot, 999, "hi")) is False
