"""Supervises long-running asyncio background tasks.

`asyncio.create_task()` handles that nothing holds onto are a silent single
point of failure: an unhandled exception kills the loop and the only signal
is a downstream symptom minutes later (a stale heartbeat, a dead poller).
This module gives every supervised task a name, a done-callback that logs the
crash and records it for `/health/ready`, and — for tasks that should keep
running for the life of the process — a restart with jittered exponential
backoff so a transient failure (DB blip, network hiccup) self-heals instead
of staying dead until the next deploy.
"""

import asyncio
import logging
import random
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, Optional

logger = logging.getLogger("bot.task_supervisor")

# name -> asyncio.Task, so shutdown can cancel everything this module spawned.
_tasks: Dict[str, asyncio.Task] = {}

BASE_BACKOFF_SECONDS = 5.0
JITTER_FRACTION = 0.25


@dataclass
class _TaskState:
    crash_count: int = 0
    last_error: Optional[str] = None
    last_crash_ts: Optional[float] = None


# name -> crash state, read-only from the outside via get_task_states().
_states: Dict[str, _TaskState] = {}


def get_task_states() -> Dict[str, dict]:
    """Snapshot of crash state per supervised task, for health endpoints.

    Only tasks that have crashed at least once appear here — a task that has
    never failed has nothing worth surfacing.
    """
    return {
        name: {
            "crash_count": s.crash_count,
            "last_error": s.last_error,
            "last_crash_ts": s.last_crash_ts,
        }
        for name, s in _states.items()
        if s.crash_count > 0
    }


def spawn(
    name: str,
    coro_factory: Callable[[], Awaitable],
    *,
    restart: bool = True,
    max_backoff: float = 300.0,
) -> asyncio.Task:
    """Create a supervised task from `coro_factory` (called fresh on each restart).

    A bare coroutine can only be awaited once, so restarting requires a
    factory rather than the coroutine object itself. The returned task is the
    long-lived *wrapper* task (it never exits while restart=True), not the
    inner coroutine run directly — supervised tasks are looked up in the
    registry by name, not by the handle returned here.
    """
    _states.setdefault(name, _TaskState())

    async def _run_supervised():
        backoff = BASE_BACKOFF_SECONDS
        while True:
            try:
                await coro_factory()
                # Coroutine returned normally (e.g. a one-shot task) — nothing
                # to restart or log as a crash.
                return
            except asyncio.CancelledError:
                # Clean shutdown request: not a crash, don't restart, don't log.
                raise
            except Exception as e:
                state = _states[name]
                state.crash_count += 1
                state.last_error = str(e)[:500]
                state.last_crash_ts = time.time()
                logger.error("background task %r crashed: %s", name, e, exc_info=True)

                if not restart:
                    return

                # Full jitter around exponential backoff: avoids every crashed
                # task reconverging on the same retry instant (thundering herd).
                jitter = backoff * JITTER_FRACTION
                sleep_for = max(0.0, backoff + random.uniform(-jitter, jitter))
                logger.warning(
                    "background task %r restarting in %.1fs (crash #%d)",
                    name,
                    sleep_for,
                    state.crash_count,
                )
                try:
                    await asyncio.sleep(sleep_for)
                except asyncio.CancelledError:
                    raise
                backoff = min(backoff * 2, max_backoff)
                # Loop and re-create the coroutine via the factory — a wrapper
                # loop, not recursion, so a task that crashes forever cannot
                # grow an unbounded call stack.

    task = asyncio.create_task(_run_supervised(), name=name)
    _tasks[name] = task
    return task


async def cancel_all(timeout: float = 10.0) -> None:
    """Cancel and await every supervised task, for use in shutdown.

    Never raises — a supervisor bug must not block the rest of shutdown from
    running.
    """
    tasks = list(_tasks.values())
    if not tasks:
        return
    for t in tasks:
        t.cancel()
    try:
        await asyncio.wait(tasks, timeout=timeout)
    except Exception as e:  # noqa: BLE001 — shutdown must never raise
        logger.error("cancel_all encountered an error: %s", e, exc_info=True)
    _tasks.clear()
