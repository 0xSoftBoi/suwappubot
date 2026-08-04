"""Tests for bot/services/capture_service.py — specifically the fail-closed
denylist behavior when the lazy `CAPTURE_DENYLISTED_STATES` import breaks.

An empty frozenset() would make `state in denylist` always False (fail
OPEN — the state would be treated as NOT denylisted), which is the exact
opposite of the documented "fail closed" contract. `_denylisted_states()`
must return a sentinel that treats every state as denylisted instead.
"""

import asyncio
from unittest.mock import patch

import pytest

from bot.services import capture_service


def test_denylisted_states_returns_always_contains_sentinel_on_import_failure():
    """Simulate the lazy `from bot.handlers.wallet import CAPTURE_DENYLISTED_STATES`
    import breaking (e.g. a refactor renames/removes the constant, or wallet.py
    fails to import for an unrelated reason). The fallback must deny-list
    *every* conversation state, not none of them.
    """
    # Force `import bot.handlers.wallet` to fail inside `_denylisted_states()`
    # by making the module unimportable via sys.modules (a None entry raises
    # ImportError on import, simulating a broken/renamed constant or a
    # handler-module import error).
    with patch.dict("sys.modules", {"bot.handlers.wallet": None}):
        result = capture_service._denylisted_states()
        # Fails CLOSED: an arbitrary, previously-unknown state must be treated
        # as denylisted (i.e. `in` the returned collection is True), not safe.
        assert "SOME_RANDOM_STATE_NEVER_SEEN_BEFORE" in result
        assert 12345 in result
        assert None in result
        # And it must NOT be the fail-open empty frozenset.
        assert result != frozenset()


def test_denylisted_states_normal_path_is_a_real_set():
    """Sanity check the happy path still returns the real, finite denylist
    (not the always-True sentinel) when the import succeeds.
    """
    result = capture_service._denylisted_states()
    from bot.handlers.wallet import CAPTURE_DENYLISTED_STATES

    assert result == CAPTURE_DENYLISTED_STATES
    # A state that is NOT in the real denylist must not be flagged.
    assert "definitely_not_a_denylisted_state" not in result


def test_screen_raw_text_denylists_everything_when_import_fails():
    """End-to-end: `_screen_raw_text` must withhold raw_text for ANY
    conversation_state when the denylist import is broken, not just the
    real wallet-key states.
    """
    with patch.dict("sys.modules", {"bot.handlers.wallet": None}):
        stored_text, redacted, reason = capture_service._screen_raw_text(
            "hello world", conversation_state="some_totally_unrelated_state"
        )
        assert stored_text is None
        assert redacted is True
        assert reason == "denylisted_state"


def test_fire_retains_strong_reference_until_task_completes():
    """`fire()` must keep the Task in `_background_tasks` until it finishes,
    preventing garbage collection of an unreferenced asyncio Task mid-await.
    """

    async def _run():
        done = asyncio.Event()

        async def _coro():
            await asyncio.sleep(0.01)
            done.set()

        capture_service.fire(_coro())
        # The task must be tracked immediately after scheduling.
        assert len(capture_service._background_tasks) >= 1

        await asyncio.wait_for(done.wait(), timeout=1)
        # Give the done-callback a tick to fire and discard the task.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(_run())
