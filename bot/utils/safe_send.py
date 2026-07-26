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

``safe_send`` centralises both. It records a block in ``users.bot_blocked_at``
so senders can filter blocked users out of their queries up front rather than
discovering it one failed API call at a time.
"""

import asyncio
import logging
from datetime import datetime, timezone

from telegram.error import Forbidden, RetryAfter, TelegramError

from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)


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


async def safe_send(bot, telegram_id: int, text: str, **kwargs) -> bool:
    """Send a bot-initiated message. Returns True if it was delivered.

    Never raises: background loops must not die because one user blocked us.
    """
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
