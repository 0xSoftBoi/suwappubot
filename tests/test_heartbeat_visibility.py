"""A background loop that stops beating must be visible.

Production evidence: `balance_refresher` wedged and /health reported
`{"balance_refresher": "unknown"}` with `ready: true` and `degraded: []` for
four days. The loop's task was still alive, so nothing crashed and nothing
alerted. Two defects made that possible and both are fixed here.
"""

import asyncio
import os
import re

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _src(rel):
    return open(os.path.join(REPO, rel)).read()


# ── the loop cannot wedge ────────────────────────────────────────────────────


def test_the_refresh_pass_is_bounded():
    """_refresh_all gathers wallet-balance RPC calls with no per-call deadline.
    One provider that accepts a connection and never answers wedged the gather,
    the pass, and the loop — permanently."""
    src = _src("bot/services/balance_refresher.py")
    assert "_PASS_BUDGET_SECONDS" in src
    # gather waits for the SLOWEST member, so the batch needs its own bound
    assert "_BATCH_BUDGET_SECONDS" in src
    assert re.search(
        r"asyncio\.wait\(\s*tasks,\s*timeout=_BATCH_BUDGET_SECONDS", src
    ), "batch is unbounded"


def test_the_supervisor_never_awaits_the_pass():
    """The bound that failed in production was built out of `wait_for`, which
    cancels the pass and then *awaits* the cancellation. A child stuck in an
    uncancellable RPC read makes that await permanent: no TimeoutError, no
    beat, no log. Every `wait_for` around the pass inherits the flaw, so the
    supervisor must not use one — `asyncio.wait` returns on its deadline
    whatever the stragglers do."""
    src = _src("bot/services/balance_refresher.py")
    code = "\n".join(ln for ln in src.splitlines() if not ln.strip().startswith("#"))
    assert (
        "wait_for(self._refresh_all()" not in code
    ), "the pass is awaited again — a pass that ignores cancellation will wedge the loop"
    assert (
        re.search(r"wait_for\(\s*asyncio\.gather", code) is None
    ), "wait_for(gather(...)) awaits the slowest member's cancellation"
    assert "create_task(self._refresh_all())" in code, "the pass must run in its own task"


def test_the_warmup_cannot_read_as_a_dead_service():
    """Nothing beats until the warmup elapses, so a warmup longer than the
    staleness threshold would report the service dead on every single boot."""
    import bot.services.balance_refresher as br

    threshold = int(re.search(r'"balance_refresher": (\d+)', _src("api/main.py")).group(1))
    assert br._WARMUP_SECONDS < threshold


def test_the_beat_cadence_cannot_cost_a_heartbeat():
    """The beat is now the supervisor's own tick, so *it* is what has to fit
    inside the staleness threshold — the pass duration no longer can. Allow a
    few missed ticks before the service reads as dead."""
    import bot.services.balance_refresher as br

    health = _src("api/main.py")
    threshold = int(re.search(r'"balance_refresher": (\d+)', health).group(1))
    assert (
        br._HEARTBEAT_INTERVAL_SECONDS * 3 <= threshold
    ), f"beat every {br._HEARTBEAT_INTERVAL_SECONDS}s leaves no slack under {threshold}s"
    assert br._BATCH_BUDGET_SECONDS < br._PASS_BUDGET_SECONDS


def test_a_wedged_pass_is_still_visible():
    """Decoupling the beat from the work would be a regression if it let a
    service that does nothing report itself perfectly healthy. The completed-
    pass marker is what keeps that honest, and it has to reach a field the
    uptime probe actually walks (checks.*), not just the top-level list."""
    import bot.services.balance_refresher as br

    health = _src("api/main.py")
    assert "SERVICE_PASS_STALL_SECONDS" in health
    stall = int(
        re.search(
            r'"balance_refresher": (\d+),', health.split("SERVICE_PASS_STALL_SECONDS")[1]
        ).group(1)
    )
    assert stall > br._PASS_BUDGET_SECONDS + 60, "a healthy-but-slow pass would be reported stalled"
    assert br._LAST_PASS_TTL_SECONDS >= stall, "the marker evicts before it can read as stale"
    assert "last_pass" in br._LAST_PASS_KEY
    # the probe walks `checks`, so the verdict must be the status word itself
    assert "svc_heartbeats[svc] = await _pass_progress_status(svc, now)" in health


@pytest.mark.asyncio
async def test_a_hung_pass_does_not_stop_the_loop(monkeypatch):
    """The behaviour that matters: one pathological pass must cost one cycle,
    not the service. Before the bound, the first hung pass was the last thing
    the loop ever did."""
    import bot.services.balance_refresher as br
    from bot.utils.redis_cache import redis_cache

    beats = []

    async def _set(key, value, ttl_seconds=None):
        beats.append(key)

    monkeypatch.setattr(redis_cache, "set", _set)
    monkeypatch.setattr(br, "_PASS_BUDGET_SECONDS", 0.05)
    monkeypatch.setattr(br, "_WARMUP_SECONDS", 0)
    monkeypatch.setattr(br, "_HEARTBEAT_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(br, "_CANCEL_GRACE_SECONDS", 0.05)

    svc = br.BalanceRefresher()
    calls = {"n": 0}

    async def _hang():
        calls["n"] += 1
        if calls["n"] == 1:
            await asyncio.sleep(3600)  # the wedge

    svc._refresh_all = _hang
    svc._refresh_interval = 0
    svc._running = True

    task = asyncio.create_task(svc._refresh_loop())
    await asyncio.sleep(0.5)
    svc._running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert calls["n"] >= 2, f"the loop never recovered from a hung pass (ran {calls['n']}x)"
    assert len(beats) >= 2, f"only {len(beats)} heartbeats — a wedge still silences the service"


# ── and if it does stop, it is not silent ────────────────────────────────────


def test_a_service_that_never_beats_is_reported_dead_not_unknown():
    """`unknown` meant 'the Redis key is absent', which is what a service that
    never started looks like — and it was excluded from `degraded`, so it was
    indistinguishable from healthy."""
    src = _src("api/main.py")
    block = src[
        src.index("for svc in watched_services:") : src.index(  # noqa: E203
            "# The worker publishes"
        )  # noqa: E203
    ]  # noqa: E203
    # Strip comments first — the assertion below otherwise matches the word
    # inside the comment that explains the fix, which is the same false positive
    # already hit twice in this repo (the disclaimer greps).
    code = "\n".join(ln for ln in block.splitlines() if not ln.strip().startswith("#"))
    assert '"unknown"' not in code, "a missing heartbeat can still read as unknown"
    assert '"starting"' in code, "no grace window for a genuinely fresh boot"
    assert "_PROCESS_STARTED_AT" in src, "cannot tell a fresh boot from a dead loop without uptime"
    assert "uptime > threshold" in code


def test_a_dead_heartbeat_reaches_the_degraded_list():
    """It was previously visible only as a word nested inside
    checks.background_services, which nothing alerted on."""
    src = _src("api/main.py")
    degraded = src[src.index('"degraded": [') :]  # noqa: E203
    degraded = degraded[: degraded.index("},\n    )")]
    assert "never_beat" in degraded, "dead heartbeats do not surface in degraded"
    assert "no heartbeat past staleness threshold" in degraded


def test_every_watched_service_has_a_threshold_under_its_writer_ttl():
    """The health code's own rule: the TTL must be >= the threshold, or the key
    evicts before it can ever be seen as stale. balance_refresher writes a 300s
    TTL, so 300s is the ceiling for its threshold."""
    import bot.services.balance_refresher as br

    health = _src("api/main.py")
    ttl = br._HEARTBEAT_TTL_SECONDS
    threshold = int(re.search(r'"balance_refresher": (\d+)', health).group(1))
    assert (
        ttl >= threshold
    ), f"TTL {ttl}s < threshold {threshold}s — the key evicts before it is stale"


def test_the_worker_fingerprint_is_refreshed_not_written_once():
    """Observed in production: the worker last deployed 04 Aug, its fingerprint
    key carried a 24h TTL and was written only at startup, so it expired on the
    5th and /health reported `worker_fingerprint: unknown` for ten days on a
    worker that was alive and logging.

    The code's own comment says a short TTL would 'expire on a perfectly healthy
    worker and report unknown, recreating exactly the ambiguity this is meant to
    remove'. 24h was still short, because a stable worker does not restart for
    weeks — the answer is to refresh it, not to lengthen it further."""
    src = _src("api/main.py")
    block = src[
        src.index("service:worker:fingerprint") : src.index(  # noqa: E203
            "Could not publish worker"
        )  # noqa: E203
    ]  # noqa: E203
    assert "_republish_fingerprint" in block, "the fingerprint is still written only at startup"
    assert "asyncio.create_task" in block
    # refresh interval must be comfortably under the TTL it is refreshing
    import re

    ttl = int(re.search(r"ttl_seconds=(\d+)", block).group(1))
    sleep = int(re.search(r"asyncio\.sleep\((\d+)\)", block).group(1))
    assert sleep < ttl / 2, f"refresh every {sleep}s against a {ttl}s TTL leaves no margin"


@pytest.mark.asyncio
async def test_a_pass_that_ignores_cancellation_does_not_stop_the_loop(monkeypatch):
    """The production failure, exactly.

    `asyncio.sleep` is cancellable, so a pass that merely hangs was always
    recoverable and the old bound looked fine in tests. What actually shipped
    was a pass whose child sat in an RPC read that never honoured the cancel.
    `wait_for` cancels and then awaits — so the loop stopped at the cancel it
    issued itself. One beat at boot, then four hours of silence behind
    `ready: true`. The supervisor must outlive a pass that refuses to die.
    """
    import bot.services.balance_refresher as br
    from bot.utils.redis_cache import redis_cache

    beats = []
    stubborn = {"die": False}

    async def _set(key, value, ttl_seconds=None):
        beats.append(key)

    monkeypatch.setattr(redis_cache, "set", _set)
    monkeypatch.setattr(br, "_WARMUP_SECONDS", 0)
    monkeypatch.setattr(br, "_HEARTBEAT_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(br, "_PASS_BUDGET_SECONDS", 0.05)
    monkeypatch.setattr(br, "_CANCEL_GRACE_SECONDS", 0.02)

    async def _undying():
        while True:
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                if stubborn["die"]:
                    raise
                # Swallow it. This is what an uncancellable socket read looks
                # like from the supervisor's point of view.

    svc = br.BalanceRefresher()
    svc._refresh_all = _undying
    svc._refresh_interval = 0
    svc._running = True

    task = asyncio.create_task(svc._refresh_loop())
    await asyncio.sleep(0.5)

    beats_at_wedge = len(beats)
    assert beats_at_wedge >= 3, f"only {beats_at_wedge} beats — the wedge silenced the loop"

    # It must also stop piling new passes onto ones that will not die.
    assert (
        len(svc._abandoned) <= br._MAX_ABANDONED_PASSES
    ), f"{len(svc._abandoned)} abandoned passes — the loop is leaking wedged work"
    assert svc._abandoned, "an undying pass was not recorded as abandoned"

    await asyncio.sleep(0.2)
    assert len(beats) > beats_at_wedge, "the loop stopped beating once it gave up on passes"

    stubborn["die"] = True
    svc._running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    for leftover in list(svc._abandoned):
        leftover.cancel()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_a_completed_pass_is_recorded_so_a_silent_loop_cannot_look_healthy(monkeypatch):
    """A beat that no longer depends on the work would let a service that does
    nothing report `alive`. The completed-pass marker is what stops that."""
    import bot.services.balance_refresher as br
    from bot.utils.redis_cache import redis_cache

    written = {}

    async def _set(key, value, ttl_seconds=None):
        written[key] = value

    monkeypatch.setattr(redis_cache, "set", _set)
    monkeypatch.setattr(br, "_WARMUP_SECONDS", 0)
    monkeypatch.setattr(br, "_HEARTBEAT_INTERVAL_SECONDS", 0.01)

    svc = br.BalanceRefresher()
    ran = {"n": 0}

    async def _quick():
        ran["n"] += 1

    svc._refresh_all = _quick
    svc._refresh_interval = 0
    svc._running = True

    task = asyncio.create_task(svc._refresh_loop())
    await asyncio.sleep(0.2)
    svc._running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert ran["n"] >= 1
    assert br._HEARTBEAT_KEY in written, "no liveness beat"
    assert br._LAST_PASS_KEY in written, "a completed pass was not recorded"


@pytest.mark.asyncio
async def test_a_pass_that_never_completes_is_never_recorded_as_one(monkeypatch):
    """The marker has to mean what it says, or it is just a second heartbeat."""
    import bot.services.balance_refresher as br
    from bot.utils.redis_cache import redis_cache

    written = {}

    async def _set(key, value, ttl_seconds=None):
        written[key] = value

    monkeypatch.setattr(redis_cache, "set", _set)
    monkeypatch.setattr(br, "_WARMUP_SECONDS", 0)
    monkeypatch.setattr(br, "_HEARTBEAT_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(br, "_PASS_BUDGET_SECONDS", 0.05)
    monkeypatch.setattr(br, "_CANCEL_GRACE_SECONDS", 0.02)

    svc = br.BalanceRefresher()

    async def _hang():
        await asyncio.sleep(3600)

    svc._refresh_all = _hang
    svc._refresh_interval = 0
    svc._running = True

    task = asyncio.create_task(svc._refresh_loop())
    await asyncio.sleep(0.3)
    svc._running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert br._HEARTBEAT_KEY in written, "the loop should still be beating"
    assert br._LAST_PASS_KEY not in written, "a cancelled pass was recorded as completed"
