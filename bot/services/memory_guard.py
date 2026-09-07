"""In-process memory guard for the long-running monolith (python-worker, python-api).

Why this exists
---------------
``python-worker`` idles at ~2 GB and, roughly weekly, balloons to 27–31 GB
within minutes (2026-08-22/23, again 2026-09-07 ~09:39Z) until the platform
SIGKILLs it at the 32 GB plan ceiling. A SIGKILL leaves no traceback, so three
weeks of static analysis (see docs/deployment/railway-cost-audit.md F2) never
found the cause. Railway bills RAM per minute, the restart policy is
``ON_FAILURE`` with a retry cap, and nothing inside the process noticed.

What it does
------------
1. **Observe.** Sample RSS from ``/proc/self/status`` (and the cgroup figure the
   platform meters) every ``interval`` seconds; log a heartbeat every 10 min.
2. **Diagnose.** Above the *soft* limit, switch ``tracemalloc`` on and, on the
   next tick, log the top allocation sites *since it was switched on*, plus an
   asyncio task histogram and a gc type histogram. Growth that is happening
   right now is exactly what a mid-climb tracemalloc catches, and keeping it
   off in steady state avoids its ~2x per-allocation overhead.
3. **Bound.** Above the *hard* limit, log CRITICAL with the same report and
   ``os._exit(137)`` so the platform restarts us. Startup already reconciles
   orphaned EXECUTING swaps, so a fast restart at 6 GB is no less safe than
   the SIGKILL at 30 GB it replaces — and ~5x cheaper per incident.
4. **Trim.** Call glibc ``malloc_trim(0)`` periodically so arenas freed after a
   transient spike are returned to the OS instead of staying resident (which
   is what Railway bills).

Every threshold is a setting (``MEMORY_GUARD_*``) so it can be tuned without a
code change; ``MEMORY_GUARD_HARD_ACTION=log`` turns the guard into pure
observability.
"""

from __future__ import annotations

import asyncio
import ctypes
import gc
import logging
import os
import sys
import time
import tracemalloc
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

GB = 1024**3

_CGROUP_USAGE_FILES = (
    "/sys/fs/cgroup/memory.current",  # cgroup v2
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",  # cgroup v1
)


# --------------------------------------------------------------------------- #
# Readers (pure / injectable so the guard is unit-testable off-Linux)
# --------------------------------------------------------------------------- #


def parse_proc_status_rss(text: str) -> Optional[int]:
    """Extract VmRSS (bytes) from the contents of ``/proc/<pid>/status``."""
    for line in text.splitlines():
        if line.startswith("VmRSS:"):
            parts = line.split()
            try:
                return int(parts[1]) * 1024  # kB -> bytes
            except (IndexError, ValueError):
                return None
    return None


def read_rss_bytes() -> Optional[int]:
    """Current resident set size of this process, or None where unavailable."""
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            return parse_proc_status_rss(fh.read())
    except OSError:
        return None


def read_cgroup_bytes() -> Optional[int]:
    """Memory charged to our cgroup (what the platform meters), or None."""
    for path in _CGROUP_USAGE_FILES:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return int(fh.read().strip())
        except (OSError, ValueError):
            continue
    return None


def malloc_trim() -> bool:
    """Ask glibc to return freed arena memory to the OS. Returns True on success."""
    try:
        libc = ctypes.CDLL("libc.so.6")
        return bool(libc.malloc_trim(0))
    except (OSError, AttributeError):
        return False


# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #


def task_histogram(limit: int = 10) -> List[Tuple[str, int]]:
    """Live asyncio tasks bucketed by coroutine name (which loop is leaking?)."""
    try:
        tasks = asyncio.all_tasks()
    except RuntimeError:  # no running loop (tests / shutdown)
        return []
    counts: Counter = Counter()
    for task in tasks:
        coro = task.get_coro()
        name = (
            getattr(coro, "__qualname__", None)
            or getattr(coro, "__name__", None)
            or type(coro).__name__
        )
        counts[name] += 1
    return counts.most_common(limit)


def type_histogram(limit: int = 10) -> List[Tuple[str, int]]:
    """gc-tracked objects bucketed by type name (container leaks)."""
    counts: Counter = Counter(type(obj).__name__ for obj in gc.get_objects())
    return counts.most_common(limit)


def tracemalloc_top(limit: int = 10, frames: int = 4) -> List[str]:
    """Top allocation sites since tracemalloc was started, innermost frames last."""
    if not tracemalloc.is_tracing():
        return []
    snapshot = tracemalloc.take_snapshot()
    lines: List[str] = []
    for stat in snapshot.statistics("traceback")[:limit]:
        where = " <- ".join(
            f"{frame.filename.rsplit('/', 1)[-1]}:{frame.lineno}"
            for frame in list(stat.traceback)[-frames:]
        )
        lines.append(f"{stat.size / 1e6:8.1f} MB {stat.count:>8} blocks  {where}")
    return lines


def build_report(rss: int, cgroup: Optional[int]) -> str:
    """Human-readable multi-line diagnostic; kept as one log record on purpose."""
    parts = [
        f"rss={rss / GB:.2f}GB cgroup={'n/a' if cgroup is None else f'{cgroup / GB:.2f}GB'} "
        f"gc_objects={len(gc.get_objects())} tracemalloc={'on' if tracemalloc.is_tracing() else 'off'}"
    ]
    tasks = task_histogram()
    if tasks:
        parts.append("tasks: " + ", ".join(f"{name}={n}" for name, n in tasks))
    types = type_histogram()
    if types:
        parts.append("types: " + ", ".join(f"{name}={n}" for name, n in types))
    top = tracemalloc_top()
    if top:
        parts.append("alloc since soft-limit:\n  " + "\n  ".join(top))
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# Guard
# --------------------------------------------------------------------------- #


@dataclass
class GuardConfig:
    soft_bytes: int = int(3.0 * GB)
    hard_bytes: int = int(6.0 * GB)
    interval_seconds: float = 15.0
    heartbeat_seconds: float = 600.0
    trim_seconds: float = 900.0
    soft_report_seconds: float = 60.0
    hard_action: str = "exit"  # "exit" | "log"
    trace_frames: int = 8

    @classmethod
    def from_settings(cls, settings=None) -> "GuardConfig":
        if settings is None:
            from bot.config.settings import settings

        # Sanitize rather than raise: a typo in an env var must never take the
        # process down at boot, and must never silently disarm the guard either.
        defaults = cls()
        soft = float(settings.memory_guard_soft_gb) * GB
        hard = float(settings.memory_guard_hard_gb) * GB
        if soft <= 0:
            logger.warning("MEMORY_GUARD_SOFT_GB must be > 0; using default")
            soft = defaults.soft_bytes
        if hard <= soft:
            logger.warning(
                "MEMORY_GUARD_HARD_GB (%.2f) must exceed the soft limit (%.2f); using 2x soft",
                hard / GB,
                soft / GB,
            )
            hard = soft * 2
        interval = float(settings.memory_guard_interval_seconds)
        if interval < 1:
            logger.warning("MEMORY_GUARD_INTERVAL_SECONDS must be >= 1; using default")
            interval = defaults.interval_seconds
        action = str(settings.memory_guard_hard_action).strip().lower()
        if action not in ("exit", "log"):
            logger.warning(
                "MEMORY_GUARD_HARD_ACTION=%r is not 'exit' or 'log'; using 'exit'", action
            )
            action = "exit"
        return cls(
            soft_bytes=int(soft),
            hard_bytes=int(hard),
            interval_seconds=interval,
            hard_action=action,
        )


def _hard_exit(code: int) -> None:
    # Flush what we can; os._exit skips atexit/finally on purpose — at the hard
    # limit we may not be able to allocate enough to shut down cleanly, and a
    # clean SIGTERM path exits 0, which ON_FAILURE would *not* restart.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass
    os._exit(code)


class MemoryGuard:
    """Sampling loop. ``tick()`` is the whole state machine and is unit-tested."""

    def __init__(
        self,
        config: Optional[GuardConfig] = None,
        *,
        rss_reader: Callable[[], Optional[int]] = read_rss_bytes,
        cgroup_reader: Callable[[], Optional[int]] = read_cgroup_bytes,
        exit_fn: Callable[[int], None] = _hard_exit,
        trim_fn: Callable[[], bool] = malloc_trim,
    ) -> None:
        self.config = config or GuardConfig()
        self._rss_reader = rss_reader
        self._cgroup_reader = cgroup_reader
        self._exit_fn = exit_fn
        self._trim_fn = trim_fn

        self._task: Optional[asyncio.Task] = None
        self._tracing_started_by_us = False
        self._last_heartbeat = 0.0
        self._last_trim = 0.0
        self._last_soft_report = 0.0
        self._soft_since: Optional[float] = None
        self.last_rss: Optional[int] = None
        self.peak_rss: int = 0
        self.hard_trips: int = 0

    # -- lifecycle ---------------------------------------------------------- #

    async def start(self) -> None:
        if self._task is not None:
            return
        cfg = self.config
        logger.info(
            "Memory guard started: soft=%.1fGB hard=%.1fGB action=%s interval=%ss",
            cfg.soft_bytes / GB,
            cfg.hard_bytes / GB,
            cfg.hard_action,
            cfg.interval_seconds,
        )
        self._task = asyncio.create_task(self._loop(), name="memory_guard")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):
            pass
        self._task = None
        self._stop_tracing()

    async def _loop(self) -> None:
        while True:
            try:
                self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # never let the guard itself take the process down
                logger.warning("Memory guard tick failed: %s", exc)
            await asyncio.sleep(self.config.interval_seconds)

    # -- state machine ------------------------------------------------------ #

    def tick(self, now: Optional[float] = None) -> str:
        """One sample. Returns the branch taken (for tests/health): ok | soft-armed |
        soft | hard | unavailable."""
        now = time.monotonic() if now is None else now
        cfg = self.config
        rss = self._rss_reader()
        if rss is None:
            return "unavailable"
        self.last_rss = rss
        self.peak_rss = max(self.peak_rss, rss)

        if rss >= cfg.hard_bytes:
            self.hard_trips += 1
            logger.critical(
                "Memory guard HARD limit: rss=%.2fGB >= %.2fGB — %s\n%s",
                rss / GB,
                cfg.hard_bytes / GB,
                (
                    "exiting 137 so the platform restarts us"
                    if cfg.hard_action == "exit"
                    else "logging only"
                ),
                self._safe_report(rss),
            )
            if cfg.hard_action == "exit":
                self._exit_fn(137)
            return "hard"

        if rss >= cfg.soft_bytes:
            if not tracemalloc.is_tracing():
                tracemalloc.start(cfg.trace_frames)
                self._tracing_started_by_us = True
                self._soft_since = now
                self._last_soft_report = now
                logger.warning(
                    "Memory guard SOFT limit: rss=%.2fGB >= %.2fGB — tracemalloc armed; "
                    "allocation report on next tick",
                    rss / GB,
                    cfg.soft_bytes / GB,
                )
                return "soft-armed"
            if now - self._last_soft_report >= cfg.soft_report_seconds or self._soft_since == now:
                self._last_soft_report = now
                logger.warning(
                    "Memory guard above soft limit for %ds: rss=%.2fGB\n%s",
                    int(now - (self._soft_since or now)),
                    rss / GB,
                    self._safe_report(rss),
                )
                self._trim_fn()
            return "soft"

        # Below soft.
        if self._tracing_started_by_us:
            logger.info("Memory guard back under soft limit: rss=%.2fGB", rss / GB)
            self._stop_tracing()
            self._soft_since = None
            self._trim_fn()
            self._last_trim = now
        if now - self._last_trim >= cfg.trim_seconds:
            self._trim_fn()
            self._last_trim = now
        if now - self._last_heartbeat >= cfg.heartbeat_seconds:
            self._last_heartbeat = now
            cgroup = self._cgroup_reader()
            logger.info(
                "Memory guard: rss=%.2fGB cgroup=%s peak=%.2fGB",
                rss / GB,
                "n/a" if cgroup is None else f"{cgroup / GB:.2f}GB",
                self.peak_rss / GB,
            )
        return "ok"

    # -- helpers ------------------------------------------------------------ #

    def _safe_report(self, rss: int) -> str:
        try:
            return build_report(rss, self._cgroup_reader())
        except Exception as exc:  # diagnostics must never mask the limit event itself
            return f"(report failed: {exc})"

    def _stop_tracing(self) -> None:
        if self._tracing_started_by_us and tracemalloc.is_tracing():
            tracemalloc.stop()
        self._tracing_started_by_us = False

    def snapshot(self) -> Dict[str, object]:
        """Small dict for /health payloads."""
        cfg = self.config
        return {
            "rss_gb": None if self.last_rss is None else round(self.last_rss / GB, 3),
            "peak_gb": round(self.peak_rss / GB, 3),
            "soft_gb": round(cfg.soft_bytes / GB, 2),
            "hard_gb": round(cfg.hard_bytes / GB, 2),
            "hard_action": cfg.hard_action,
            "tracing": tracemalloc.is_tracing(),
            "running": self._task is not None and not self._task.done(),
        }


memory_guard = MemoryGuard()
