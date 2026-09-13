"""Unit tests for bot/services/memory_guard.py — the state machine only.

No /proc, no real tracemalloc thresholds: readers and the exit hook are injected.
"""

from __future__ import annotations

import asyncio
import logging
import tracemalloc

import pytest

from bot.services.memory_guard import (
    GB,
    GuardConfig,
    MemoryGuard,
    build_report,
    parse_proc_status_rss,
    task_histogram,
)


@pytest.fixture(autouse=True)
def _tracemalloc_clean():
    """Tests arm tracemalloc via the guard; never leak it across tests."""
    was_tracing = tracemalloc.is_tracing()
    yield
    if tracemalloc.is_tracing() and not was_tracing:
        tracemalloc.stop()


def _guard(rss_values, *, soft=3.0, hard=6.0, action="exit"):
    """Guard whose reader replays rss_values (GB) in order, then repeats the last."""
    values = [None if v is None else int(v * GB) for v in rss_values]
    exits: list[int] = []
    trims: list[bool] = []

    def reader():
        return values.pop(0) if len(values) > 1 else values[0]

    guard = MemoryGuard(
        GuardConfig(
            soft_bytes=int(soft * GB),
            hard_bytes=int(hard * GB),
            hard_action=action,
            heartbeat_seconds=600,
            trim_seconds=900,
            soft_report_seconds=60,
        ),
        rss_reader=reader,
        cgroup_reader=lambda: None,
        exit_fn=exits.append,
        trim_fn=lambda: trims.append(True) or True,
    )
    return guard, exits, trims


def test_parse_proc_status_rss():
    text = "Name:\tpython\nVmPeak:\t 123 kB\nVmRSS:\t   2048 kB\nThreads:\t9\n"
    assert parse_proc_status_rss(text) == 2048 * 1024
    assert parse_proc_status_rss("Name:\tpython\n") is None
    assert parse_proc_status_rss("VmRSS: garbage\n") is None


def test_unavailable_reader_is_noop():
    guard, exits, _ = _guard([None])
    assert guard.tick(now=0.0) == "unavailable"
    assert exits == []
    assert guard.last_rss is None


def test_below_soft_heartbeats_and_trims_on_schedule(caplog):
    guard, exits, trims = _guard([1.9])
    with caplog.at_level(logging.INFO, logger="bot.services.memory_guard"):
        assert guard.tick(now=1000.0) == "ok"  # first tick: heartbeat + trim
        assert guard.tick(now=1015.0) == "ok"  # nothing scheduled
        assert guard.tick(now=1700.0) == "ok"  # heartbeat again (>600s)
    assert exits == []
    assert len(trims) == 1  # 900s trim cadence not reached
    heartbeats = [r for r in caplog.records if "Memory guard: rss=" in r.getMessage()]
    assert len(heartbeats) == 2
    assert guard.peak_rss == int(1.9 * GB)
    assert not tracemalloc.is_tracing()


def test_soft_limit_arms_tracemalloc_then_reports(caplog):
    guard, exits, trims = _guard([3.5, 3.6, 3.7, 2.0])
    with caplog.at_level(logging.INFO, logger="bot.services.memory_guard"):
        assert guard.tick(now=0.0) == "soft-armed"
        assert tracemalloc.is_tracing()
        assert guard.tick(now=15.0) == "soft"  # <60s since arming: no new report
        assert guard.tick(now=75.0) == "soft"  # report + trim
        assert guard.tick(now=90.0) == "ok"  # back under: tracing off, trim
    assert exits == []
    assert not tracemalloc.is_tracing()
    messages = [r.getMessage() for r in caplog.records]
    assert any("SOFT limit" in m for m in messages)
    reports = [m for m in messages if "above soft limit for" in m]
    assert len(reports) == 1
    assert "gc_objects=" in reports[0]
    assert any("back under soft limit" in m for m in messages)
    assert len(trims) == 2


def test_hard_limit_exits_137_with_report(caplog):
    guard, exits, _ = _guard([7.0])
    with caplog.at_level(logging.CRITICAL, logger="bot.services.memory_guard"):
        assert guard.tick(now=0.0) == "hard"
    assert exits == [137]
    assert guard.hard_trips == 1
    crit = [r for r in caplog.records if r.levelno == logging.CRITICAL]
    assert crit and "HARD limit" in crit[0].getMessage()
    assert "rss=7.00GB" in crit[0].getMessage()


def test_hard_limit_log_only_action_never_exits():
    guard, exits, _ = _guard([9.0], action="log")
    assert guard.tick(now=0.0) == "hard"
    assert guard.tick(now=15.0) == "hard"
    assert exits == []
    assert guard.hard_trips == 2


def test_report_survives_diagnostic_failure(monkeypatch):
    import bot.services.memory_guard as mg

    monkeypatch.setattr(mg, "build_report", lambda *_: 1 / 0)
    guard, exits, _ = _guard([7.0])
    assert guard.tick(now=0.0) == "hard"  # limit event still fires
    assert exits == [137]


def test_snapshot_shape():
    guard, _, _ = _guard([2.5])
    guard.tick(now=0.0)
    snap = guard.snapshot()
    assert snap["rss_gb"] == 2.5
    assert snap["peak_gb"] == 2.5
    assert snap["soft_gb"] == 3.0
    assert snap["hard_gb"] == 6.0
    assert snap["hard_action"] == "exit"
    assert snap["running"] is False


def test_from_settings_reads_env(monkeypatch):
    monkeypatch.setenv("MEMORY_GUARD_SOFT_GB", "2.5")
    monkeypatch.setenv("MEMORY_GUARD_HARD_GB", "5")
    monkeypatch.setenv("MEMORY_GUARD_INTERVAL_SECONDS", "30")
    monkeypatch.setenv("MEMORY_GUARD_HARD_ACTION", "LOG")
    from bot.config.settings import Settings

    cfg = GuardConfig.from_settings(Settings())
    assert cfg.soft_bytes == int(2.5 * GB)
    assert cfg.hard_bytes == 5 * GB
    assert cfg.interval_seconds == 30
    assert cfg.hard_action == "log"


@pytest.mark.asyncio
async def test_task_histogram_names_running_loops():
    async def leaky_loop():
        await asyncio.sleep(10)

    tasks = [asyncio.create_task(leaky_loop()) for _ in range(3)]
    try:
        await asyncio.sleep(0)
        hist = dict(task_histogram())
        key = next(k for k in hist if "leaky_loop" in k)
        assert hist[key] == 3
        report = build_report(2 * GB, None)
        assert "leaky_loop" in report
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_start_stop_lifecycle():
    guard, _, _ = _guard([1.0])
    guard.config.interval_seconds = 0.01
    await guard.start()
    assert guard.snapshot()["running"] is True
    await asyncio.sleep(0.05)
    assert guard.last_rss == 1 * GB
    await guard.stop()
    assert guard.snapshot()["running"] is False
