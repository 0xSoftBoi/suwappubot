"""Best-effort Telegram presentation feedback: typing indicators and reactions.

Why the typing keepalive needs explicit cancellation
-----------------------------------------------------
Telegram's "typing…" indicator expires ~5 seconds after `sendChatAction` is
called, so a handler that awaits real network I/O (a quote fetch, a balance
check) needs to keep re-firing the action every few seconds to keep it
visible for the whole operation. The naive way to build that is a background
loop that "runs until the work is done" — but if "done" is inferred from
something other than an explicit signal (e.g. hoping the loop notices the
handler returned, or tying it to the reply arriving), the loop has no reason
to ever stop: it keeps re-sending chat actions forever, leaking one task per
call and eventually hammering the Bot API with actions for a chat nobody is
looking at anymore. This module avoids that class of bug entirely: the
keepalive task is created explicitly, torn down by an explicit
`asyncio.Event` + `task.cancel()` in a `finally` block, and always *awaited*
after cancellation before `typing()` returns — regardless of whether the
`async with` body returned normally or raised. There is no code path where
exiting the context manager doesn't deterministically stop the loop.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from telegram import Update
from telegram.constants import ChatAction, ReactionEmoji

logger = logging.getLogger(__name__)

# Strong references to in-flight fire-and-forget reaction tasks (see react()).
_pending_reactions: set[asyncio.Task] = set()

# Telegram's typing indicator expires after ~5s; refresh comfortably before that.
TYPING_REFRESH_SECONDS = 4.0

# The full set of emoji Telegram accepts for message reactions (per this
# python-telegram-bot version's telegram.constants.ReactionEmoji). Used only to
# sanity-check ALLOWED_REACTIONS below — not exposed for direct use.
_TELEGRAM_REACTION_WHITELIST = frozenset(e.value for e in ReactionEmoji)

# The curated subset of Telegram's reaction whitelist this bot actually uses.
# Telegram's reaction whitelist is much larger than this (~70 emoji, including
# ones that don't fit a calm/professional trading bot). Emoji like ⏳ or ⚙️ are
# NOT in Telegram's whitelist at all and would fail at send time — asserting
# against the real whitelist here catches that kind of typo at import time
# instead of as a silently-swallowed API error in production.
ALLOWED_REACTIONS = frozenset(
    {
        "👀",
        "🤔",
        "👍",
        "⚡",
        "🔥",
        "💯",
        "🤯",
        "😱",
        "🎉",
        "🙏",
    }
)
assert ALLOWED_REACTIONS <= _TELEGRAM_REACTION_WHITELIST, (
    "ALLOWED_REACTIONS contains an emoji Telegram does not accept for message "
    "reactions — check telegram.constants.ReactionEmoji"
)


async def _typing_keepalive(bot, chat_id: int, done: asyncio.Event) -> None:
    """Re-fire the typing action every TYPING_REFRESH_SECONDS until `done` fires.

    Only exits via the `done` event or task cancellation (both driven by
    `typing()`'s `finally` block) — never on its own accord.
    """
    try:
        while not done.is_set():
            try:
                await asyncio.wait_for(done.wait(), timeout=TYPING_REFRESH_SECONDS)
            except asyncio.TimeoutError:
                try:
                    await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
                except Exception as e:
                    logger.debug(f"Typing keepalive send_chat_action failed: {e}")
    except asyncio.CancelledError:
        # Expected — typing().__aexit__ cancels us on the way out.
        raise


@asynccontextmanager
async def typing(update: Update) -> AsyncIterator[None]:
    """Show a typing indicator for the duration of the `async with` block.

    Fires immediately on entry (before any awaited work in the body) and
    re-fires every ~4s so it never expires mid-operation. Best-effort — any
    Telegram/API error is logged at debug and never raised to the caller; a
    failed chat action must never surface to the user or abort the handler.

    The keepalive task is always cancelled and awaited on exit, even if the
    body raises — see the module docstring for why that matters.
    """
    chat = update.effective_chat
    if chat is None:
        yield
        return

    try:
        bot = update.get_bot()
    except RuntimeError:
        # No bot associated with this Update (e.g. a hand-built test Update).
        yield
        return

    try:
        await bot.send_chat_action(chat_id=chat.id, action=ChatAction.TYPING)
    except Exception as e:
        logger.debug(f"Initial send_chat_action failed: {e}")

    done = asyncio.Event()
    task = asyncio.create_task(_typing_keepalive(bot, chat.id, done))
    try:
        yield
    finally:
        done.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"Typing keepalive task raised during teardown: {e}")


async def react(update: Update, emoji: str) -> None:
    """Fire-and-forget a message reaction on `update`'s message.

    `emoji` must be one of ALLOWED_REACTIONS — asserted so a typo (or a
    non-whitelisted emoji like ⏳/⚙️) is caught during development rather than
    silently failing as a swallowed API error in production.

    The actual `set_message_reaction` call is scheduled as a background task
    and this coroutine returns immediately — a reaction is decorative and
    must never make a handler wait on Telegram's response. Any API error
    (including the target message having been deleted) is swallowed at debug.
    """
    assert emoji in ALLOWED_REACTIONS, f"{emoji!r} is not an allowed reaction emoji"

    message = update.effective_message
    if message is None:
        return

    try:
        bot = update.get_bot()
    except RuntimeError:
        return

    chat_id = message.chat_id
    message_id = message.message_id

    async def _send() -> None:
        try:
            await bot.set_message_reaction(chat_id=chat_id, message_id=message_id, reaction=emoji)
        except Exception as e:
            logger.debug(f"set_message_reaction failed: {e}")

    # asyncio only keeps a weak reference to a running task, so a bare
    # create_task() can be garbage-collected mid-flight and the reaction
    # silently never sent. Hold a strong reference until it finishes.
    task = asyncio.create_task(_send())
    _pending_reactions.add(task)
    task.add_done_callback(_pending_reactions.discard)
