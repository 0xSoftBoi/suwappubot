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
    assert "asyncio.wait_for(self._refresh_all()" in src, "the whole pass is unbounded"
    assert "_PASS_BUDGET_SECONDS" in src
    # gather waits for the SLOWEST member, so the batch needs its own bound
    assert "_BATCH_BUDGET_SECONDS" in src
    assert re.search(r"wait_for\(\s*asyncio\.gather", src), "batch gather is unbounded"


def test_the_warmup_cannot_read_as_a_dead_service():
    """Nothing beats until the warmup elapses, so a warmup longer than the
    staleness threshold would report the service dead on every single boot."""
    import bot.services.balance_refresher as br

    threshold = int(re.search(r'"balance_refresher": (\d+)', _src("api/main.py")).group(1))
    assert br._WARMUP_SECONDS < threshold


def test_the_pass_budget_cannot_cost_a_heartbeat():
    """The budget must sit under the staleness threshold, or a slow-but-healthy
    pass reads as dead — which is the false alarm that makes people ignore the
    real one."""
    import bot.services.balance_refresher as br

    health = _src("api/main.py")
    threshold = int(re.search(r'"balance_refresher": (\d+)', health).group(1))
    assert (
        br._PASS_BUDGET_SECONDS < threshold
    ), f"pass budget {br._PASS_BUDGET_SECONDS}s >= staleness {threshold}s"
    assert br._BATCH_BUDGET_SECONDS < br._PASS_BUDGET_SECONDS


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
    block = src[src.index("for svc in watched_services:") : src.index("# The worker publishes")]
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
    degraded = src[src.index('"degraded": [') :]
    degraded = degraded[: degraded.index("},\n    )")]
    assert "never_beat" in degraded, "dead heartbeats do not surface in degraded"
    assert "no heartbeat past staleness threshold" in degraded


def test_every_watched_service_has_a_threshold_under_its_writer_ttl():
    """The health code's own rule: the TTL must be >= the threshold, or the key
    evicts before it can ever be seen as stale. balance_refresher writes a 300s
    TTL, so 300s is the ceiling for its threshold."""
    health = _src("api/main.py")
    refresher = _src("bot/services/balance_refresher.py")
    ttl = int(
        re.search(r"balance_refresher:heartbeat\".*?ttl_seconds=(\d+)", refresher, re.S).group(1)
    )
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
    block = src[src.index("service:worker:fingerprint") : src.index("Could not publish worker")]
    assert "_republish_fingerprint" in block, "the fingerprint is still written only at startup"
    assert "asyncio.create_task" in block
    # refresh interval must be comfortably under the TTL it is refreshing
    import re

    ttl = int(re.search(r"ttl_seconds=(\d+)", block).group(1))
    sleep = int(re.search(r"asyncio\.sleep\((\d+)\)", block).group(1))
    assert sleep < ttl / 2, f"refresh every {sleep}s against a {ttl}s TTL leaves no margin"
