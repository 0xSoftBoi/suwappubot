"""One warmed session per chain, and who gets to quote when.

The router's own shape is three costs, each paid at a different rate:

    warm       once per chain, and again per block for the state
    set_pair   when either token changes
    quote      per keystroke

A frontend has to make that felt as one thing.  What this owns is the timing:
the loading bar during a warm, a background re-read every two minutes and
after a swap of our own lands, and the rule that a keystroke never waits for
the keystroke before it.

Flet-free on purpose.  It reports progress and results through callbacks, so
the view decides what a stage looks like and this decides when one happens.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

#: How often the swept state is re-read while the tab is open.  Pool balances
#: move with every trade anyone makes, and a quote priced against a two-minute
#: old pool is a quote against a pool that has moved -- which the pre-submit
#: re-read catches, but only after someone has decided to sign it.
REFRESH_SECONDS = 120.0

#: How long a failed warm waits before trying again.  The endpoint is a load
#: balancer and a raised warm is usually a bad backend.
RETRY_SECONDS = 20.0


class Stage(Enum):
    """What the tab can say about a chain."""

    COLD = "cold"
    WARMING = "warming"
    READY = "ready"
    FAILED = "failed"


@dataclass(slots=True)
class Quote:
    """One answer, and everything the widget draws from it."""

    amount_in: int
    result: Any
    block: int
    solver: str
    elapsed_ms: float = 0.0


@dataclass(slots=True)
class _Chain:
    """What has been paid for on one chain."""

    session: Any = None
    stage: Stage = Stage.COLD
    error: str = ""
    pair: tuple[str, str] | None = None
    warmed_at: float = 0.0
    coins: list = field(default_factory=list)


class RouterHost:
    """The router, from the tab's point of view."""

    def __init__(self, *, make_session, on_stage=None, on_progress=None,
                 on_quote=None, on_error=None, sleep=None, clock=None):
        #: `async (chain_id) -> (RouterSession, coins)`.  Injected so this can
        #: be driven by a fake in tests and by the real thing in the app.
        self._make_session = make_session
        self._on_stage = on_stage or (lambda *_: None)
        self._on_progress = on_progress or (lambda *_: None)
        self._on_quote = on_quote or (lambda *_: None)
        self._on_error = on_error or (lambda *_: None)
        self._sleep = sleep or asyncio.sleep
        self._clock = clock or time.monotonic

        self._chains: dict[int, _Chain] = {}
        self.chain_id = 0
        #: Bumped whenever the chain or the pair changes.  A quote that comes
        #: back under a stale generation is dropped rather than drawn -- the
        #: same guard `CurveApp.load_pools` uses, and for the same reason: every
        #: await is a place the reader can have moved on.
        self._generation = 0
        self._wanted: int | None = None
        self._quoting = False
        self._quoter: asyncio.Task | None = None
        self._refresher: asyncio.Task | None = None

    # ------------------------------------------------------------- the chain

    @property
    def stage(self) -> Stage:
        return self._held.stage

    @property
    def session(self):
        return self._held.session

    @property
    def coins(self) -> list:
        return self._held.coins

    @property
    def error(self) -> str:
        return self._held.error

    @property
    def _held(self) -> _Chain:
        return self._chains.setdefault(self.chain_id, _Chain())

    async def open(self, chain_id: int) -> None:
        """Show this chain, warming it if this is the first time.

        A chain already warmed keeps its session: switching away and back is
        free, which is what makes the network picker usable at all.
        """
        self.chain_id = int(chain_id)
        self._generation += 1
        held = self._held
        if held.stage is Stage.READY:
            self._say(held.stage)
            return
        if held.stage is Stage.WARMING:
            return
        await self._warm()

    async def _warm(self) -> None:
        held = self._held
        generation = self._generation
        held.stage = Stage.WARMING
        held.error = ""
        self._say(Stage.WARMING)
        try:
            session, coins = await self._make_session(self.chain_id)
            report = await session.warm(self._progress)
        except Exception as exc:
            if generation != self._generation:
                return
            held.stage = Stage.FAILED
            held.error = str(exc)
            self._say(Stage.FAILED)
            self._on_error(exc)
            return
        if generation != self._generation:
            return          # the reader moved on; this warm is somebody else's
        if not report.complete:
            # An unread slot is a zero, and a zero fee or rate is a plausible
            # number: the quote succeeds and is wrong.  Refuse rather than
            # answer -- see `LocalEvm`.
            held.stage = Stage.FAILED
            held.error = (
                f"{report.unreadable} slot(s) could not be read, so a quote "
                f"here would be priced against zeros"
            )
            self._say(Stage.FAILED)
            return
        held.session = session
        held.coins = coins
        held.warmed_at = self._clock()
        held.stage = Stage.READY
        held.pair = None
        self._say(Stage.READY)
        self._start_refresher()
        # Someone who typed an amount while the bar was moving is owed an
        # answer now rather than another keystroke.
        if self._wanted is not None:
            self._pump()

    # -------------------------------------------------------------- the pair

    async def set_pair(self, src: str, dst: str) -> bool:
        """Probe and price this pair.  False if the chain is not ready."""
        held = self._held
        if held.stage is not Stage.READY or held.session is None:
            return False
        pair = (src.lower(), dst.lower())
        if held.pair == pair:
            return True
        self._generation += 1
        generation = self._generation
        # Forgotten *before* the new one is prepared, not after.  Kept until
        # then, a preparation that failed or was overtaken left the old pair
        # in place and every later keystroke was answered against it -- the
        # widget said crvUSD to sDOLA, the route said crvUSD to USDT, and the
        # rate read "1 crvUSD = 0 sDOLA" because the old pair's numbers were
        # being formatted with the new coin's decimals.
        held.pair = None
        try:
            await held.session.set_pair(*pair, progress=self._pair_progress)
        except Exception as exc:
            if generation == self._generation:
                self._on_error(exc)
            return False
        if generation != self._generation:
            return False
        held.pair = pair
        self._on_progress("ready", 1.0)
        if self._wanted is not None:
            self._pump()
        return True

    # ------------------------------------------------------------ the amount

    def request(self, amount_in: int) -> None:
        """Quote this amount, as soon as there is nothing else to answer.

        Latest wins, and nothing queues: a quote takes ~300 ms and someone
        types faster than that, so the answer they want is the one for what is
        in the box now -- not one for each character they passed through.
        There is no debounce either, because a debounce makes the first answer
        arrive later for no benefit when the input has stopped changing.
        """
        self._wanted = int(amount_in) if amount_in else None
        if self._wanted is None:
            self._on_quote(None)
            return
        self._pump()

    def _pump(self) -> None:
        if self._quoting or self._wanted is None:
            return
        held = self._held
        if held.stage is not Stage.READY or held.pair is None:
            return          # parked until the warm, or the pair, is done
        self._quoting = True
        # Held, so it is not collected mid-flight -- asyncio keeps only a weak
        # reference to a running task.
        self._quoter = asyncio.ensure_future(self._quote_loop())

    async def _quote_loop(self) -> None:
        """Answer the newest amount until nothing new has arrived."""
        try:
            while True:
                held = self._held
                amount = self._wanted
                if amount is None or held.session is None:
                    return
                generation = self._generation
                # The solve is synchronous and ~300 ms; yield first so the
                # keystroke that asked for it has been drawn.
                await self._sleep(0)
                started = self._clock()
                try:
                    result = held.session.quote(amount)
                except Exception as exc:
                    if generation == self._generation and amount == self._wanted:
                        # The figures on screen are for an amount that is no
                        # longer in the box, so they go before the reason for
                        # their going does.  Left up, they would sit under a
                        # red line describing a *different* trade, with
                        # nothing anywhere saying the two disagree -- the
                        # solver's own tripwires fire on some sizes and not
                        # their neighbours, so this is not a rare shape.
                        self._on_quote(None)
                        self._on_error(exc)
                        self._wanted = None
                    return
                if generation != self._generation:
                    return
                if amount == self._wanted:
                    self._on_quote(Quote(
                        amount_in=amount,
                        result=result,
                        block=held.session.block,
                        solver=getattr(held.session, "solver", ""),
                        elapsed_ms=(self._clock() - started) * 1000,
                    ))
                    return
                # It changed while this one ran: answer the new one instead.
        finally:
            self._quoting = False

    # ------------------------------------------------------------- refreshing

    def _start_refresher(self) -> None:
        if self._refresher is None or self._refresher.done():
            self._refresher = asyncio.ensure_future(self._refresh_loop())

    async def _refresh_loop(self) -> None:
        """Re-read the swept state on a timer, with nothing drawn for it.

        Timestamped rather than locked, the way `CurveApp.refresh_totals`
        does it: the loop sleeps until the state is actually due, so a refresh
        forced by a confirmed swap resets the clock instead of racing it.
        """
        while True:
            held = self._held
            await self._sleep(max(REFRESH_SECONDS - self._age(held), 1.0))
            held = self._held
            if held.stage is not Stage.READY or held.session is None:
                continue
            if self._age(held) < REFRESH_SECONDS:
                continue
            await self.refresh()

    def _age(self, held: _Chain) -> float:
        return self._clock() - held.warmed_at if held.warmed_at else REFRESH_SECONDS

    async def refresh(self) -> int:
        """Re-read the state at the newest block, and re-quote if anything is
        showing.  Nothing is drawn for this: it is not a wait anyone asked for.
        """
        held = self._held
        if held.stage is not Stage.READY or held.session is None:
            return 0
        pair = held.pair
        try:
            block = await held.session.refresh()
        except Exception as exc:
            self._on_error(exc)
            return 0
        held.warmed_at = self._clock()
        # A refresh drops the preparation, because probes fitted at one block
        # are a fit against a state that has moved.  Redo it now rather than
        # on the next keystroke, which is where it would be felt.
        held.pair = None
        if pair is not None:
            await self.set_pair(*pair)
        elif self._wanted is not None:
            self._pump()
        return block

    async def after_swap(self) -> int:
        """A swap of ours landed, so the pools it went through have moved."""
        held = self._held
        held.warmed_at = 0.0
        return await self.refresh()

    def close(self) -> None:
        for task in (self._refresher, self._quoter):
            if task is not None:
                task.cancel()
        self._refresher = self._quoter = None

    # ------------------------------------------------------------- reporting

    def _say(self, stage: Stage) -> None:
        self._on_stage(stage, self._held.error)

    def _progress(self, phase: str, fraction: float) -> None:
        self._on_progress(phase, fraction)

    def _pair_progress(self, phase: str, fraction: float) -> None:
        """A pair's own 0..1, not the warm's phase weighting.

        The session reports both through one callback, and the warm's weights
        map an unknown phase to 1.0 -- so a pair jumped the bar straight to
        full and back.
        """
        self._on_progress("pair", fraction)
