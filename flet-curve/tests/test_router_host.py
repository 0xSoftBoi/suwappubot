"""Who gets to quote when.

The router's costs are paid at three different rates -- a warm per chain, a
preparation per pair, a solve per keystroke -- and the whole job of
`RouterHost` is to make that felt as one thing. These are the rules that make
it feel wrong when they are broken:

* a keystroke never waits for the keystroke before it, and never queues behind
  the ones it overtook;
* an amount typed *during* the warm is answered when the warm ends, not
  forgotten;
* an answer for a pair or a chain the reader has moved on from is dropped
  rather than drawn;
* an incomplete warm refuses rather than quoting against zeros.
"""

from __future__ import annotations

import asyncio

import pytest

from router.host import REFRESH_SECONDS, RouterHost, Stage


class FakeReport:
    def __init__(self, unreadable=0):
        self.unreadable = unreadable
        self.complete = unreadable == 0
        self.warnings: list[str] = []


class FakeSession:
    """Enough of `RouterSession` to drive the host."""

    def __init__(self, *, unreadable=0, quote_ms=0.0):
        self.block = 100
        self.solver = "rust"
        self.warms = 0
        self.pairs: list[tuple[str, str]] = []
        self.quoted: list[int] = []
        self.refreshes = 0
        self._unreadable = unreadable
        self._quote_ms = quote_ms
        self.gate: asyncio.Event | None = None

    async def warm(self, progress=None):
        self.warms += 1
        if self.gate is not None:
            await self.gate.wait()
        if progress:
            progress("storage", 0.5)
            progress("models", 1.0)
        return FakeReport(self._unreadable)

    async def set_pair(self, src, dst, progress=None):
        self.pairs.append((src, dst))
        return object()

    def quote(self, amount):
        self.quoted.append(amount)
        return f"quote:{amount}"

    async def refresh(self):
        self.refreshes += 1
        self.block += 1
        return self.block


def build(session=None, **kw):
    session = session or FakeSession()
    seen: dict = {"quotes": [], "stages": [], "progress": [], "errors": []}

    async def make(chain_id):
        return session, [f"coin-on-{chain_id}"]

    host = RouterHost(
        make_session=kw.pop("make_session", make),
        on_stage=lambda stage, error: seen["stages"].append((stage, error)),
        on_progress=lambda phase, fraction: seen["progress"].append((phase, fraction)),
        on_quote=seen["quotes"].append,
        on_error=seen["errors"].append,
        **kw,
    )
    return host, session, seen


async def test_a_warm_chain_is_kept_and_a_second_visit_is_free():
    host, session, _seen = build()
    await host.open(1)
    assert host.stage is Stage.READY
    assert session.warms == 1
    assert host.coins == ["coin-on-1"]
    await host.open(1)
    assert session.warms == 1, "a chain already warmed is not warmed again"
    host.close()


async def test_an_incomplete_warm_refuses_rather_than_quoting():
    """An unread slot is a zero, and a zero fee is a plausible number."""
    host, _session, seen = build(FakeSession(unreadable=3))
    await host.open(1)
    assert host.stage is Stage.FAILED
    assert "3 slot(s)" in host.error
    host.request(5)
    await asyncio.sleep(0)
    assert seen["quotes"] == [], "a failed warm must not answer"
    host.close()


async def test_an_amount_typed_during_the_warm_is_answered_after_it():
    session = FakeSession()
    session.gate = asyncio.Event()
    host, _held, seen = build(session)
    warming = asyncio.ensure_future(host.open(1))
    await asyncio.sleep(0)
    host.request(42)                       # typed while the bar is moving
    assert seen["quotes"] == []
    session.gate.set()
    await warming
    await host.set_pair("0xa", "0xb")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert [q.amount_in for q in seen["quotes"]] == [42]
    host.close()


async def test_only_the_newest_amount_is_answered():
    """Someone types faster than a solve; they want the answer for what is in
    the box, not one for every character they passed through."""
    host, session, seen = build()
    await host.open(1)
    await host.set_pair("0xa", "0xb")
    for amount in (1, 12, 123, 1234):
        host.request(amount)
    for _ in range(8):
        await asyncio.sleep(0)
    assert [q.amount_in for q in seen["quotes"]] == [1234], seen["quotes"]
    assert session.quoted[-1] == 1234
    assert len(session.quoted) < 4, "the ones it overtook are not solved"
    host.close()


async def test_an_answer_for_a_pair_the_reader_left_is_dropped():
    """The pair changes while a solve is running: that answer is for a market
    nobody is looking at, and drawing it would show a number for the wrong
    pair with no way to tell."""
    session = FakeSession()
    host, _session, seen = build(session)
    await host.open(1)
    await host.set_pair("0xa", "0xb")

    moved: list[int] = []

    def quote(amount):
        # Stand in for the reader picking another coin mid-solve.
        if not moved:
            moved.append(amount)
            host._generation += 1
        session.quoted.append(amount)
        return f"quote:{amount}"

    session.quote = quote
    host.request(7)
    for _ in range(8):
        await asyncio.sleep(0)
    assert moved == [7], "the solve did run"
    assert seen["quotes"] == [], "and its answer was not drawn"
    host.close()


async def test_clearing_the_box_clears_the_answer():
    host, _session, seen = build()
    await host.open(1)
    await host.set_pair("0xa", "0xb")
    host.request(0)
    assert seen["quotes"] == [None]
    host.close()


async def test_a_refresh_redoes_the_pair_and_the_showing_amount():
    """A refresh drops the preparation -- probes fitted at one block are a fit
    against a state that has moved."""
    host, session, seen = build()
    await host.open(1)
    await host.set_pair("0xa", "0xb")
    host.request(9)
    for _ in range(6):
        await asyncio.sleep(0)
    seen["quotes"].clear()
    await host.refresh()
    for _ in range(6):
        await asyncio.sleep(0)
    assert session.refreshes == 1
    assert session.pairs == [("0xa", "0xb"), ("0xa", "0xb")], "the pair is redone"
    assert [q.amount_in for q in seen["quotes"]] == [9]
    host.close()


async def test_a_swap_of_ours_forces_a_refresh():
    """Our own swap moved the pools it went through."""
    ticks: list[float] = []

    async def sleep(seconds):
        ticks.append(seconds)
        await asyncio.sleep(0)

    host, session, _seen = build(sleep=sleep)
    await host.open(1)
    await host.set_pair("0xa", "0xb")
    before = session.refreshes
    await host.after_swap()
    assert session.refreshes == before + 1
    host.close()


async def test_the_refresher_sleeps_until_the_state_is_due():
    """Timestamped rather than ticking: a forced refresh resets the clock
    instead of racing it."""
    ticks: list[float] = []
    now = [1000.0]

    async def sleep(seconds):
        ticks.append(seconds)
        now[0] += seconds
        await asyncio.sleep(0)

    host, _session, _seen = build(sleep=sleep, clock=lambda: now[0])
    await host.open(1)
    for _ in range(4):
        await asyncio.sleep(0)
    assert ticks, "the refresher must be running"
    assert ticks[0] == pytest.approx(REFRESH_SECONDS, abs=1.0)
    host.close()


async def test_a_quote_that_raises_takes_the_old_figures_with_it():
    """The solver's tripwires fire on some sizes and not their neighbours, so
    a failed quote leaving the last good one on screen would put figures for a
    different trade under a red line about this one."""
    session = FakeSession()
    host, _session, seen = build(session)
    await host.open(1)
    await host.set_pair("0xa", "0xb")
    host.request(100)
    for _ in range(6):
        await asyncio.sleep(0)
    assert [q.amount_in for q in seen["quotes"] if q] == [100]

    def boom(amount):
        raise RuntimeError("flow conservation is violated by 3.343e-03")

    session.quote = boom
    host.request(200)
    for _ in range(6):
        await asyncio.sleep(0)
    assert seen["quotes"][-1] is None, "the stale figures were cleared"
    assert seen["errors"], "and the reason was reported"
    host.close()


async def test_a_pair_that_would_not_prepare_is_not_quoted_anyway():
    """The one that got out.

    `held.pair` was cleared only on success, so a preparation that failed or
    was overtaken left the *previous* pair in place and every later keystroke
    was answered against it: the widget said crvUSD to sDOLA, the route said
    crvUSD to USDT, and the rate read "1 crvUSD = 0 sDOLA" because the old
    pair's numbers were being formatted with the new coin's decimals.
    """
    session = FakeSession()
    host, _session, seen = build(session)
    await host.open(1)
    assert await host.set_pair("0xa", "0xb")

    async def refuse(src, dst, progress=None):
        session.pairs.append((src, dst))
        raise RuntimeError("this pair cannot be priced")

    session.set_pair = refuse
    assert not await host.set_pair("0xa", "0xc")
    assert seen["errors"], "the refusal is reported"

    seen["quotes"].clear()
    host.request(5)
    for _ in range(8):
        await asyncio.sleep(0)
    assert seen["quotes"] == [], "and nothing is answered for the old pair"
    assert 5 not in session.quoted
    host.close()


async def test_a_pair_is_prepared_before_anything_is_quoted_against_it():
    session = FakeSession()
    host, _session, _seen = build(session)
    await host.open(1)
    host.request(7)
    for _ in range(4):
        await asyncio.sleep(0)
    assert session.quoted == [], "no pair yet, so nothing to quote"
    await host.set_pair("0xa", "0xb")
    for _ in range(6):
        await asyncio.sleep(0)
    assert session.quoted == [7]
    host.close()


async def test_a_failed_warm_is_reported_not_swallowed():
    async def make(chain_id):
        raise RuntimeError("the endpoint declined")

    host, _session, seen = build(make_session=make)
    await host.open(1)
    assert host.stage is Stage.FAILED
    assert "declined" in host.error
    assert seen["errors"], "the exception reaches the view"
    host.close()
