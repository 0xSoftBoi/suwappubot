"""Data-capture service: banks (user input -> resolved structured action)
pairs for a future fine-tune, plus broad interaction telemetry.

Writes to the append-only `user_intents` / `interaction_events` tables (see
bot/models/data_capture.py, DDL in database/db.py `_create_data_capture_tables`).

HARD RULES:
- These helpers must NEVER raise. Capture is a side effect, not a critical
  path — a bug here must never break a trade, a wallet import, or anything
  else. All internal work is wrapped in try/except and failures are logged
  at debug level only.
- `record_intent` always screens `raw_text` with
  `bot.utils.capture_redaction.screen_for_secrets` before persisting it.
  Unsafe text is replaced with a redaction marker but the row is still
  written — the structured fields are still useful training signal even
  when the raw text can't be kept.
- Conversation states in `DENYLISTED_CAPTURE_STATES` (wallet private-key /
  mnemonic entry) NEVER get their raw_text persisted, independent of the
  secret screen — this is a belt-and-suspenders denylist, not a substitute
  for it.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from database.db import get_session, run_in_db
from bot.models.data_capture import UserIntent, InteractionEvent
from bot.utils.capture_redaction import screen_for_secrets

logger = logging.getLogger(__name__)


class _AlwaysContains:
    """Sentinel: `x in this` is always True.

    Used as the fail-closed denylist when the real
    `CAPTURE_DENYLISTED_STATES` import breaks. An empty frozenset() would
    make `state in denylist` always False (fail OPEN — the exact opposite of
    the intent), silently disabling the belt-and-suspenders wallet
    private-key/mnemonic-state denylist. This sentinel instead treats every
    conversation state as denylisted (raw_text withheld) until the import is
    fixed.
    """

    def __contains__(self, item: object) -> bool:
        return True


_ALWAYS_DENYLISTED = _AlwaysContains()

# Background capture tasks, referenced strongly so they aren't garbage
# collected mid-await (asyncio.ensure_future/create_task only keeps a weak
# reference internally when nothing else holds the Task object).
_background_tasks: set = set()


def fire(coro) -> None:
    """Schedule a capture coroutine as a fire-and-forget task without losing it.

    `asyncio.ensure_future(coro)` with no retained reference can have its
    Task garbage-collected before it finishes awaiting, silently dropping
    the row. This keeps a strong reference in `_background_tasks` until the
    task completes, then discards it.
    """
    task = asyncio.ensure_future(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _denylisted_states():
    """Wallet private-key / seed entry states from bot/handlers/wallet.py.

    Imported lazily (not at module load) to avoid a circular import — wallet.py
    is a handler module and handlers may import this service.

    Fails CLOSED: if the import breaks, returns a sentinel that treats every
    state as denylisted, instead of an empty frozenset() (which would fail
    OPEN — `state in frozenset()` is always False).
    """
    try:
        from bot.handlers.wallet import CAPTURE_DENYLISTED_STATES

        return CAPTURE_DENYLISTED_STATES
    except Exception:  # noqa: BLE001 — fail closed: treat everything as denylisted
        logger.debug("capture_service: could not load CAPTURE_DENYLISTED_STATES", exc_info=True)
        return _ALWAYS_DENYLISTED


def _screen_raw_text(raw_text: Optional[str], conversation_state: Optional[Any]):
    """Returns (stored_text, redacted, redaction_reason)."""
    if conversation_state is not None and conversation_state in _denylisted_states():
        return None, True, "denylisted_state"

    if raw_text is None:
        return None, False, None

    is_unsafe, reason = screen_for_secrets(raw_text)
    if is_unsafe:
        return None, True, reason or "secret_detected"

    return raw_text, False, None


def _insert_intent(**kwargs) -> None:
    with get_session() as session:
        session.add(UserIntent(**kwargs))


def _insert_event(**kwargs) -> None:
    with get_session() as session:
        session.add(InteractionEvent(**kwargs))


async def record_intent(
    user_id: Optional[int],
    surface: str,
    raw_text: Optional[str],
    session_key: str,
    turn_index: int = 0,
    intent_type: Optional[str] = None,
    resolved_action: Optional[dict] = None,
    resolution_status: str = "resolved",
    swap_id: Optional[int] = None,
    conversation_state: Optional[str] = None,
) -> None:
    """Record one (input -> resolved action) training pair. Never raises."""
    try:
        stored_text, redacted, reason = _screen_raw_text(raw_text, conversation_state)

        await run_in_db(
            _insert_intent,
            user_id=user_id,
            surface=surface,
            raw_text=stored_text,
            redacted=redacted,
            redaction_reason=reason,
            intent_type=intent_type,
            resolved_action=resolved_action,
            resolution_status=resolution_status,
            turn_index=turn_index,
            session_key=session_key,
            swap_id=swap_id,
        )
    except Exception:  # noqa: BLE001 — capture must never break a trade
        logger.debug("capture_service.record_intent failed", exc_info=True)


async def record_event(
    user_id: Optional[int],
    surface: str,
    event_type: str,
    payload: Optional[dict] = None,
    session_key: Optional[str] = None,
) -> None:
    """Record one interaction-telemetry event. Never raises."""
    try:
        await run_in_db(
            _insert_event,
            user_id=user_id,
            surface=surface,
            event_type=event_type,
            payload=payload,
            session_key=session_key,
        )
    except Exception:  # noqa: BLE001 — capture must never break a trade
        logger.debug("capture_service.record_event failed", exc_info=True)
