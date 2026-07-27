"""Delivery helpers for unsolicited (bot-initiated) messages.

Background services — price alerts, the perps monitor, the tx poller, the
weekly digest — push messages to users who did not just ask for one. Those
sends fail differently from a reply inside a handler:

* The user may have blocked the bot. Telegram answers ``Forbidden`` forever
  after, and every one of our 15 monitor services was swallowing that into a
  ``logger.warning`` and retrying on its next tick — the perps monitor every
  10 seconds, indefinitely. That burns API quota and flood budget on a chat
  that can never receive anything again, and we never learned the user churned.

* We may be flood-limited. Telegram answers ``RetryAfter`` with a delay; the
  correct response is to wait that long and try once more, not to drop the
  message.

* The user may have simply muted this category of push (Settings → Notify).
  Nothing enforced those toggles — swap-complete DMs, price alerts, etc. went
  out unconditionally. ``category=`` gates a send on the matching preference
  column so "Mute Notifications" (and the granular per-event toggles) mean
  something.

``safe_send`` centralises all three. It records a block in
``users.bot_blocked_at`` so senders can filter blocked users out of their
queries up front rather than discovering it one failed API call at a time.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from telegram.error import Forbidden, RetryAfter, TelegramError

from bot.utils.cache import AsyncCache
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# Notification category -> UserSettings boolean column that gates it.
#
# Every column here defaults to "send" when the user has no UserSettings row
# yet, or the column itself reads NULL (opt-out semantics) — most active users
# have never opened /settings and so have no row at all; defaulting missing
# to False would silently mute everyone the moment this check went live. Once
# a row exists, its stored value (whatever it is) is honored as-is — including
# for "proactive_alert", which is documented in bot/models/favorites.py as an
# opt-in scaffold that defaults OFF once a row is created. That's intentional:
# it only stops being "send by default" for a user after they (or a settings
# read) materialize a UserSettings row.
_CATEGORY_COLUMNS = {
    "swap_complete": "notify_on_complete",
    "price_alert": "notify_on_price_alert",
    "order_triggered": "notify_order_triggered",
    "copy_executed": "notify_copy_executed",
    "risk_event": "notify_risk_event",
    # DELIBERATELY UNGATED (mapped to None, like weekly_digest below).
    #
    # Both `proactive_alerts_enabled` and `notify_portfolio_milestone` are
    # declared `default=False`, and their migrations use
    # `ADD COLUMN ... DEFAULT FALSE`, which Postgres BACKFILLS into every
    # existing row. So these columns read as a stored `False`, not NULL — and
    # `_load_prefs` only treats NULL as "unconfigured". Worse, a UserSettings
    # row is created merely by VIEWING /settings
    # (settings.py::_get_or_create_settings), not by toggling anything.
    #
    # Gating on them would therefore have silently muted HyperLiquid fill,
    # funding, TWAP and stake alerts for every user who had ever opened the
    # settings screen — alerts they opted into by tracking the account. That is
    # the same silent-mass-mute failure the NULL handling was written to avoid,
    # reached through a different door. Restore pre-existing delivery until
    # these columns have a real opt-in surface and a sane default.
    "portfolio_milestone": None,
    "proactive_alert": None,
    # Gated at the query level today (User.weekly_digest == True in
    # digest_service._send_due_digests). Listed so a defensive re-check here
    # is a no-op rather than a KeyError if ever passed explicitly.
    "weekly_digest": None,
}

# Short-lived, in-process only (no Redis dependency) — read on every push.
_pref_cache = AsyncCache(default_ttl=30, maxsize=5000)


def _mark_blocked(telegram_id: int, blocked: bool) -> None:
    """Record (or clear) the blocked flag for a Telegram user. Blocking call."""
    from bot.models.user import User

    try:
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == telegram_id).first()
            if user is None:
                return
            user.bot_blocked_at = datetime.now(timezone.utc) if blocked else None
    except Exception as e:  # never let bookkeeping break a send path
        logger.warning(f"Could not update bot_blocked_at for {telegram_id}: {e}")


async def mark_blocked(telegram_id: int, blocked: bool) -> None:
    """Async wrapper — keeps the blocking session off the event loop."""
    await run_in_db(_mark_blocked, telegram_id, blocked)


def _load_prefs(telegram_id: int) -> dict:
    """Blocking read of the boolean prefs that gate background pushes."""
    from bot.models.favorites import UserSettings
    from bot.models.user import User

    prefs: dict = {"notifications_enabled": True}
    try:
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == telegram_id).first()
            if user is None:
                return prefs
            if user.notifications_enabled is not None:
                prefs["notifications_enabled"] = user.notifications_enabled

            settings_row = (
                session.query(UserSettings).filter(UserSettings.user_id == user.id).first()
            )
            if settings_row is not None:
                for column in set(_CATEGORY_COLUMNS.values()):
                    if column is None:
                        continue
                    value = getattr(settings_row, column, None)
                    if value is not None:
                        prefs[column] = value
    except Exception as e:
        logger.warning(f"Could not load notification prefs for {telegram_id}: {e}")
    return prefs


async def _category_allowed(telegram_id: int, category: Optional[str]) -> bool:
    """True unless the user has explicitly muted this notification category."""
    if category is None:
        return True

    column = _CATEGORY_COLUMNS.get(category, "__unknown__")
    if column == "__unknown__":
        logger.warning(f"safe_send: unknown notification category {category!r}; sending anyway")
        return True
    if column is None:
        return True

    cache_key = f"prefs:{telegram_id}"
    prefs = await _pref_cache.get(cache_key)
    if prefs is None:
        prefs = await run_in_db(_load_prefs, telegram_id)
        await _pref_cache.set(cache_key, prefs)

    if not prefs.get(column, True):
        return False

    # swap_complete is dual-gated: the Telegram "Mute Notifications" toggle
    # mirrors onto User.notifications_enabled (see
    # bot/handlers/settings.py::_toggle_synced_setting), but older rows can
    # have the two columns diverged — honor a mute from either surface.
    if category == "swap_complete" and not prefs.get("notifications_enabled", True):
        return False

    return True


async def safe_send(
    bot, telegram_id: int, text: str, *, category: Optional[str] = None, **kwargs
) -> bool:
    """Send a bot-initiated message. Returns True if it was delivered.

    ``category`` (optional) gates the send on the matching notification
    preference column (see ``_CATEGORY_COLUMNS``); pass ``None`` (default) for
    pushes that aren't subject to a per-category mute (e.g. admin broadcasts).

    Never raises: background loops must not die because one user blocked us.
    """
    if not await _category_allowed(telegram_id, category):
        logger.debug(f"Skipping '{category}' send to {telegram_id}: muted by user preference")
        return False

    try:
        await bot.send_message(chat_id=telegram_id, text=text, **kwargs)
        return True

    except Forbidden:
        # The user blocked the bot (or deleted their account). This is
        # permanent until they unblock, at which point my_chat_member clears
        # the flag. Stop retrying this chat.
        logger.info(f"User {telegram_id} has blocked the bot — marking and skipping future sends")
        await mark_blocked(telegram_id, True)
        return False

    except RetryAfter as e:
        delay = getattr(e, "retry_after", 1)
        logger.warning(f"Flood-limited sending to {telegram_id}; retrying in {delay}s")
        await asyncio.sleep(delay)
        try:
            await bot.send_message(chat_id=telegram_id, text=text, **kwargs)
            return True
        except Forbidden:
            await mark_blocked(telegram_id, True)
            return False
        except TelegramError as e2:
            logger.warning(f"Retry after flood control failed for {telegram_id}: {e2}")
            return False

    except TelegramError as e:
        logger.warning(f"Failed to send to {telegram_id}: {e}")
        return False


async def on_my_chat_member(update, context) -> None:
    """Track block/unblock events so senders can skip dead chats.

    Telegram emits ``my_chat_member`` when a user blocks or unblocks the bot.
    It emits nothing when a user merely MUTES it, so this undercounts real
    disengagement — treat it as a floor, not the full churn picture.

    Requires "my_chat_member" in allowed_updates (see ALLOWED_UPDATES in
    bot/main.py); without it Telegram never delivers these and this handler
    silently never runs.
    """
    member = update.my_chat_member
    if member is None or member.chat.type != "private":
        return

    status = member.new_chat_member.status
    telegram_id = member.chat.id

    if status in ("kicked", "left"):
        logger.info(f"User {telegram_id} blocked the bot")
        await mark_blocked(telegram_id, True)
    elif status == "member":
        logger.info(f"User {telegram_id} unblocked/restarted the bot")
        await mark_blocked(telegram_id, False)
