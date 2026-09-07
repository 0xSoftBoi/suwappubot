"""The Swap tab's controller: the widget, the router, and the wallet.

`SwapView` draws, `router.host` decides when a quote happens, and this is
what sits between them and the chain -- balances, the pre-submit plan, the
approve step and the swap itself.

Split out of `main.py` rather than added to it because the flow has real
sequencing in it: a warm before a quote, a quote before a plan, a plan before
an approval is even a question, and a re-read after the swap lands.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import flet as ft

from curve.format import token_amount
from curve.gas import (
    fee_in_native,
    format_fee,
    native_for,
    native_price,
    read_fees,
    settlement_price,
)
from curve.http import ApiError
from curve.router_contract import RouterContract, RouterError
from router import (
    Backend,
    RouterHost,
    Stage,
    holdings,
    incidents,
    load_backend,
    wrapping,
)
from router.backend import BackendError
from router.session import (
    build_session,
    chain_for,
)
from router.universe import coins_by_volume, with_native
from wallet.base import WalletError

from .responsive import Layout
from .status import DONE, FAILED
from .swap import SwapView

#: How long after the last keystroke the route is *planned* rather than
#: merely quoted.  Planning re-reads the chosen route's state at the newest
#: block and simulates the call, which is a round trip and a full execution:
#: worth it once someone has stopped typing, and wasteful per character.
PLAN_DELAY = 0.45

#: Where the last pair someone chose on a chain is kept, so the tab opens on
#: what they were doing rather than on a guess.  Per chain, because the coins
#: are: a pair remembered on Ethereum means nothing on Base.
PAIR_KEY = "swap.pair.{chain_id}"


class SwapPage:
    """Everything the Swap tab does."""

    def __init__(self, page: ft.Page, *, api, chain_name, chain_id, provider_for,
                 account, on_loading, on_loaded, storage=None):
        self._page = page
        self._storage = storage if storage is not None else ft.SharedPreferences()
        self._api = api
        self._chain_name = chain_name
        self._chain_id = chain_id
        self._provider_for = provider_for
        self._account = account
        self._on_loading = on_loading
        self._on_loaded = on_loaded

        #: The newest block this tab has watched a transaction of its own
        #: confirm in.  Every plan after that waits for the endpoint to reach
        #: it -- see `_confirm`.
        self._floor_block = 0
        #: The picker's coins, in the order it shows them.  Re-ordered once
        #: what the wallet holds is known.
        self._coins: list = []
        self._backend: Backend | None = None
        self._backend_error = ""
        self._quote = None
        # An `ExecutionPlan` from the router, or a `WrapPlan` from
        # `router.wrapping` -- the same shape, and nothing downstream needs to
        # know which it is holding.
        self._plan: Any = None
        self._planner: asyncio.Task | None = None
        self._balances: dict[str, int] = {}
        self._opened_chain = 0
        #: Which chain is on screen, for the fee table.
        self.chain_id_now = 0
        self._sending = False

        self.host = RouterHost(
            make_session=self._make_session,
            on_stage=self._stage_changed,
            on_progress=self._progress,
            on_quote=self._quoted,
            on_error=self._failed,
        )
        self.view = SwapView(
            page, chain_name(),
            on_amount=self._amount_changed,
            on_pair=self._pair_changed,
            on_max=self._max_clicked,
            on_approve=self._approve,
            on_swap=self._swap,
        )

    @property
    def control(self) -> ft.Control:
        return self.view

    def set_layout(self, layout: Layout) -> None:
        self.view.set_layout(layout)

    def close(self) -> None:
        self.host.close()
        if self._planner is not None:
            self._planner.cancel()

    # ----------------------------------------------------------- opening it

    async def open(self) -> None:
        """Show the tab for whatever chain is being browsed.

        The coins first and the warm second, because they need different
        things: the list is a property of the *pool list*, which the headline
        figures have already downloaded, while quoting needs twenty seconds of
        reading state.  Waiting for the second to show the first left the two
        pickers empty for the whole warm with nothing to say why.

        Warming starts here rather than at app start for its own reason:
        someone who never opens this tab should never pay for it.
        """
        chain_id = await self._chain_id()
        if not chain_id:
            self.view.say("This network has no chain id yet.", FAILED)
            return
        self.view.chain = self._chain_name()
        if chain_id != self.chain_id_now:
            # A different network: the amount is a count of a coin that is not
            # in the new list, the figures were quoted against pools that are
            # not on it, and the route drawn belongs to the chain being left.
            # None of it survives, and the warm ahead is long enough that
            # leaving it up would be showing the old network's answer for
            # twenty seconds after somebody asked for a different one.
            self._quote = self._plan = None
            self._balances = {}
            self.view.forget_chain()
        self.chain_id_now = chain_id
        await self._offer_coins(chain_id)
        # Before the warm, not after it.  What the wallet holds is a question
        # for the wallet, and nothing about it needs twenty seconds of pool
        # state -- reading it here means the balance and MAX are there while
        # the bar is still moving, which is when someone is deciding what to
        # type.
        await self._read_balances()

        if self._backend is None:
            try:
                self._backend = await load_backend()
            except BackendError as exc:
                self._backend_error = str(exc)
                self.view.say(str(exc), FAILED)
                return
        await self.host.open(chain_id)
        if self.host.stage is not Stage.READY:
            return
        # The pair was chosen before there was anything to price it with, so
        # this is where it actually gets prepared.
        sell, buy = self.view.pair
        if sell is not None and buy is not None:
            await self._prepare(sell.address, buy.address)
        # A wrapping was answered while the warm was still going, and the warm
        # must not take that back: `_prepare` ends by redrawing from the
        # router's last quote, which for a pair the router never saw is
        # nothing at all.
        if self._wrapping():
            await self._wrap_quote(self.view.amount_in())
        await self._read_balances()

    async def _offer_coins(self, chain_id: int) -> None:
        """Fill the pickers off the pool list, before anything is warmed."""
        if chain_id == self._opened_chain:
            return
        try:
            rows = await self._api.router_pools(chain_id)
        except ApiError as exc:
            self.view.say(f"Could not read this network's pools: {exc}", FAILED)
            return
        coins = self._with_native(coins_by_volume(rows), chain_id)
        if not coins:
            return
        self._opened_chain = chain_id
        self._coins = coins
        self.view.offer(coins, self._chain_name(), pools=rows)
        await self._open_pair(chain_id, coins)
        # Behind the pair, not before it: which coins someone holds decides
        # the *order* of a list that is already usable, and two requests for
        # an ordering should not hold up the two pickers being filled.
        self._page.run_task(self._rank_by_holdings)

    async def _rank_by_holdings(self) -> None:
        """Put the coins the wallet actually holds at the top of the *sell*
        picker.

        A handful of requests for the whole list: every `balanceOf` through
        Multicall3, the way `curve.portfolio` already reads a wallet's
        positions, and one more for the chain's prices, which the Prices API
        serves in bulk.  Per coin it would be three hundred of each.

        Not over the router's endpoint: that key is scoped to reads and
        `eth_call` against the quoter and the router, and answers a token's
        `balanceOf` with a 403.

        Quiet when it cannot be done -- no wallet, no endpoint, no prices.  A
        picker ordered by how busy the markets are is the order it has always
        had, and losing the list to save the ordering would be a poor trade.
        """
        coins, account = self._coins, self._account()
        provider = self._provider_for()
        if not coins or not account or provider is None:
            return
        held = await holdings.read_balances(provider, account, coins)
        if not held:
            return
        try:
            prices = await self._api.usd_prices(self._chain_name())
        except ApiError:
            return
        ranked = holdings.rank(coins, held, prices)
        if self._coins is not coins:
            return          # the chain moved on while this was in flight
        # `coins` stays the volume order and stays what this is re-ranked
        # from; the ranking is handed over beside it, for the selling side.
        self.view.offer(coins, self._chain_name(), owned=ranked)

    async def wallet_changed(self) -> None:
        """A wallet arrived, left, or became a different account.

        Everything here that depends on one is read through a callable, so
        nothing is *stale* -- it is simply never asked again.  Someone who
        opened the tab first and connected second saw no balance, no MAX and
        an approval step decided when there was no account to decide it for.

        The router is untouched: it quotes over the public endpoint and has no
        idea a wallet exists, so a connection costs no warm and no re-read.
        """
        await self._read_balances()
        # The picker's order is a wallet question too: a different account
        # holds different coins.
        self._page.run_task(self._rank_by_holdings)
        if self._plan is not None:
            await self._sync_approval(self._plan)
            await self._show_gas(self._plan)

    async def _make_session(self, chain_id: int):
        assert self._backend is not None, "open() loads it before warming"
        return await build_session(chain_id, self._backend, api=self._api)

    async def _open_pair(self, chain_id: int, coins) -> None:
        """The pair someone last chose here, or the two busiest coins.

        Busiest rather than a list of symbols: the coins are already ordered
        by the volume of the pools holding them, so the top two are the pair
        this chain is actually used for -- which a hardcoded USDC/WETH is on
        Ethereum and is not anywhere else.

        Nothing is prepared here.  This runs before the warm, so there is
        nothing to prepare *with*; `open` does it once there is.
        """
        if not coins:
            return
        sell = buy = None
        remembered = await self._remembered_pair(chain_id)
        if remembered:
            by_address = {coin.address: coin for coin in coins}
            sell = by_address.get(remembered[0])
            buy = by_address.get(remembered[1])
        if sell is None or buy is None or sell is buy:
            sell = coins[0]
            buy = next((coin for coin in coins[1:]
                        if coin is not sell and not _wraps(sell, coin, chain_id)),
                       None)
        self.view.set_pair(sell, buy)

    async def _remembered_pair(self, chain_id: int) -> tuple[str, str] | None:
        try:
            saved = await self._storage.get(PAIR_KEY.format(chain_id=chain_id))
        except Exception:
            return None
        if not isinstance(saved, str) or "," not in saved:
            return None
        sell, _, buy = saved.partition(",")
        return (sell, buy) if sell and buy else None

    async def _remember_pair(self) -> None:
        sell, buy = self.view.pair
        if sell is None or buy is None or not self.chain_id_now:
            return
        with contextlib.suppress(Exception):
            await self._storage.set(
                PAIR_KEY.format(chain_id=self.chain_id_now),
                f"{sell.address},{buy.address}",
            )

    # ------------------------------------------------------------ the stages

    def _stage_changed(self, stage: Stage, error: str) -> None:
        if stage is Stage.WARMING:
            # No caption: the bar under the header is what says this is
            # happening, and it says it for the whole app rather than for one
            # panel.  A long fill is the state sweep, a short one is a pair.
            self.view.clear_status()
            self._on_loading(0.0)
        elif stage is Stage.READY:
            self.view.clear_status()
            self._on_loaded()
        elif stage is Stage.FAILED:
            self.view.say(error or "The router could not read this network.", FAILED)
            self._on_loaded()

    def _progress(self, phase: str, fraction: float) -> None:
        self._on_loading(min(1.0, max(0.0, fraction)))

    def _failed(self, exc: Exception) -> None:
        """Say what went wrong, at which block, and write the rest down.

        The block is not decoration.  A router that will not price a pair it
        priced a minute ago is a thing to reproduce, and reproducing it means
        pinning the state it happened against -- `erouter route --block N`
        takes exactly that number.  Without it a report is "it failed once",
        which is not a report.

        The line on screen has room for the block and nothing else, so the
        rest goes to `router.incidents`: the pair, the amount, the solver, and
        the chain, taken now while they are still true.
        """
        block = self._block_now()
        self._write_down("quote", exc, block)
        self.view.say(_with_block(exc, block), FAILED)

    def _block_now(self) -> int:
        session = self.host.session
        return int(getattr(session, "block", 0) or 0) if session else 0

    def _write_down(self, kind: str, exc: Exception, block: int) -> None:
        """Everything `erouter route` would need to see this again."""
        sell, buy = self.view.pair
        session = self.host.session
        incidents.record(
            kind,
            error=type(exc).__name__,
            message=str(exc),
            chain=self.chain_id_now,
            block=block,
            sell=getattr(sell, "address", ""),
            buy=getattr(buy, "address", ""),
            pair=(f"{getattr(sell, 'symbol', '?')}->{getattr(buy, 'symbol', '?')}"),
            amount=self.view.amount.value or "",
            solver=getattr(session, "solver", ""),
        )

    # -------------------------------------------------------------- the pair

    @staticmethod
    def _with_native(coins, chain_id: int):
        """The gas token in the list, where this chain's pools never name it.

        Asked of the router's own table rather than guessed at: it declares
        which chains genuinely wrap -- fraxtal's `0xFC00..06` answers the whole
        ERC20 surface and holds no native at all -- and it is the same table
        the solver merges from, so the list and the graph agree.
        """
        chain = chain_for(chain_id)
        if chain is None or not getattr(chain, "wraps_native", False):
            return coins
        return with_native(coins, symbol=chain.native_symbol,
                           wrapped=chain.wrapped)

    def _pair_changed(self, *_coins) -> None:
        sell, buy = self.view.pair
        self._quote = self._plan = None
        self.view.cannot_send("")
        self.view.clear_status()
        self.view.show_quote(None)
        if sell is None or buy is None or sell.address == buy.address:
            return
        self._page.run_task(self._remember_pair)
        if self._wrapping():
            # Nothing to prepare: there is no pair to probe and no arcs to
            # calibrate, so the answer is available before the warm is.
            self._page.run_task(self._wrap_quote, self.view.amount_in())
            return
        self._page.run_task(self._prepare, sell.address, buy.address)

    async def _prepare(self, sell: str, buy: str) -> None:
        if self.host.stage is not Stage.READY or self._wrapping():
            return
        self._on_loading(0.0)
        # Forgotten before the pair is prepared, and asked again after it.
        #
        # What the host holds is a count of the *old* selling coin's smallest
        # units, and `set_pair` ends by quoting whatever it still has.  Two
        # million USDC re-read as sDOLA is two millionths of one, which does
        # not route -- and the refusal clears the amount outright, so every
        # later change of pair quoted nothing at all and the widget sat there
        # saying the two coins were not connected.
        self.host.request(0)
        try:
            await self.host.set_pair(sell, buy)
        finally:
            self._on_loaded()
        # Read from the box rather than remembered, so it is in the units that
        # now apply -- and so an amount a failed quote threw away comes back.
        self.host.request(self.view.amount_in())
        await self._read_balances()
        self.view.show_quote(self._quote)

    # ------------------------------------------------------------ the amount

    def _amount_changed(self, amount: int) -> None:
        self._plan = None
        if self._wrapping():
            self._page.run_task(self._wrap_quote, amount)
            return
        self.host.request(amount)

    # ------------------------------------------------------------ wrapping

    def _wrapping(self) -> str | None:
        """Which way this pair wraps, if it wraps at all.

        A native/wrapped pair never reaches the router: `wrapping` explains
        why.  It is asked here rather than inside the host because the answer
        needs nothing the host has -- not the warm, not the pool list, not a
        block -- which is exactly the point.
        """
        sell, buy = self.view.pair
        if sell is None or buy is None:
            return None
        chain = chain_for(self.chain_id_now) if self.chain_id_now else None
        if chain is None:
            return None
        return wrapping.direction(sell.address, buy.address, chain.wrapped)

    async def _wrap_quote(self, amount: int) -> None:
        """The whole of a wrapping: one for one, and a call to the wrapper."""
        which = self._wrapping()
        chain = chain_for(self.chain_id_now) if self.chain_id_now else None
        sell, buy = self.view.pair
        if which is None or chain is None or sell is None or buy is None:
            return
        self.view.cannot_send("")
        self.view.show_wrap(amount)
        if not amount:
            self._plan = None
            self.view.show_route(None)
            self.view.show_gas("")
            return
        self._plan = wrapping.plan(which, chain.wrapped, amount)
        shown = token_amount(amount / 10 ** sell.decimals, places=6)
        self.view.show_route(
            wrapping.diagram(which, sell, buy, chain.wrapped, shown))
        self.view.show_approval(False)
        await self._show_gas(self._plan)

    def _quoted(self, quote) -> None:
        self._quote = quote
        self.view.show_quote(quote)
        if quote is None or quote.result is None or quote.result.route is None:
            self.view.diagram.show(None)
            return
        session = self.host.session
        try:
            self.view.show_route(session.diagram(quote.result))
        except Exception:
            # Cleared rather than left: a diagram that failed to rebuild goes
            # on showing the *previous* route beside the current numbers, and
            # there is nothing on screen to say the two disagree.
            self.view.show_route(None)
            self.view.diagram.say("This route could not be drawn.")
        self._schedule_plan()

    def _schedule_plan(self) -> None:
        """Plan the call once the typing has stopped.

        Not per keystroke: a plan re-reads the chosen route's state at the
        newest block and executes the whole call locally, which is a round
        trip and a real execution.  Once someone has stopped is exactly when
        the answer is wanted, because that is when they look at the cost.
        """
        if self._planner is not None:
            self._planner.cancel()
        self._planner = asyncio.ensure_future(self._plan_soon())

    async def _plan_soon(self) -> None:
        try:
            await asyncio.sleep(PLAN_DELAY)
        except asyncio.CancelledError:
            return
        await self._plan_now()

    async def _plan_now(self) -> None:
        quote, session = self._quote, self.host.session
        account = self._account()
        if quote is None or session is None or quote.result.route is None:
            return
        try:
            plan = await session.plan_call(
                quote.result, receiver=account or _NOBODY, sender=account or _NOBODY,
                not_before=self._floor_block)
        except Exception as exc:
            if self._quote is not quote:
                return      # a later amount is already being planned
            # The quote itself stands -- it was verified on chain like any
            # other -- so it stays on screen.  What cannot be done is *send*
            # it, and the commonest reason by far is a leg too small to carry
            # a minimum rate, which is the router refusing to ship something
            # it cannot protect rather than anything having gone wrong.
            self._plan = None
            # Worth writing down too: this is the router declining to *ship* a
            # route it was happy to price, which is a different fault from a
            # quote that would not price at all and has its own causes.
            self._write_down("plan", exc, self._block_now())
            self.view.cannot_send(_why_unsendable(exc))
            return
        if self._quote is not quote:
            return          # the amount moved on while this was in flight
        self._plan = plan
        self.view.cannot_send("")
        self.view.show_quote(quote, plan)
        await self._show_gas(plan)
        await self._sync_approval(plan)

    async def _sync_approval(self, plan) -> None:
        contract = self._contract()
        if contract is None or not contract.can_send:
            self.view.show_approval(False)
            return
        try:
            needed = await contract.needs_approval(plan)
        except RouterError:
            needed = False
        self.view.show_approval(needed)

    # ----------------------------------------------------------- the balances

    async def _read_balances(self) -> None:
        contract = self._contract()
        sell, buy = self.view.pair
        if contract is None or not contract.can_send:
            self.view.show_balances(None, None)
            return
        held: list[int | None] = []
        for coin in (sell, buy):
            if coin is None:
                held.append(None)
                continue
            try:
                held.append(await contract.balance_of(coin.address))
            except (RouterError, WalletError):
                held.append(None)
        if sell is not None and held[0] is not None:
            self._balances[sell.address] = held[0]
        self.view.show_balances(held[0], held[1])

    def _max_clicked(self) -> None:
        sell, _buy = self.view.pair
        if sell is None:
            return
        held = self._balances.get(sell.address)
        if held:
            self.view.fill_max(held)

    # ------------------------------------------------------------ the sending

    def _contract(self) -> RouterContract | None:
        provider = self._provider_for()
        if provider is None:
            return None
        return RouterContract(provider, self._account())

    async def _approve(self) -> None:
        contract, plan = self._contract(), self._plan
        if contract is None or plan is None or self._sending:
            return
        self._sending = True
        self.view.busy(True)
        try:
            self.view.say("Confirm the approval in your wallet…", pending=True)
            tx = await contract.approve(plan)
            await self._confirm(tx, "Approved.")
            # Re-planned, not just re-checked: the plan in hand was built
            # before the approval and its dry run says the route reverts.
            # Not re-synced afterwards either: `_plan_now` ends by doing
            # exactly that, and a second one asked the same question of the
            # same chain a few milliseconds later -- down the read fallback,
            # which is the one place in this path that can take minutes.
            await self._plan_now()
        except WalletError as exc:
            self._rejected(exc)
        finally:
            self._sending = False
            self.view.busy(False)

    async def _swap(self) -> None:
        contract, plan = self._contract(), self._plan
        if contract is None or self._sending:
            return
        if plan is None:
            # Someone reached the button before the plan landed; make one now
            # rather than send a route priced at a block that has moved.
            await self._plan_now()
            plan = self._plan
        if plan is None:
            return
        if plan.reverted:
            self.view.say(f"This route would not go through: {plan.reverted}", FAILED)
            return
        self._sending = True
        self.view.busy(True)
        try:
            self.view.say("Confirm the swap in your wallet…", pending=True)
            tx = await contract.execute(plan)
            await self._confirm(tx, "Swapped.")
            self.view.clear_amount()
            self._plan = None
            # Our own swap moved the pools it went through, so the next quote
            # has to be priced against what they hold now rather than what
            # they held before it landed.
            await self.host.after_swap()
            # And it moved this wallet: both boxes show a balance that the
            # swap has just changed, and the selling picker is *ordered* by
            # those balances with the figures printed beside them.  Leaving
            # either alone shows what was true before the swap this tab just
            # sent, which is the one moment somebody is looking at them.
            await self._read_balances()
            self._page.run_task(self._rank_by_holdings)
        except WalletError as exc:
            self._rejected(exc)
        finally:
            self._sending = False
            self.view.busy(False)

    async def _confirm(self, tx: str, done: str) -> int:
        """Wait for it to land, and remember which block it landed in.

        The block matters afterwards.  The router reads through a load
        balancer, which is many nodes at slightly different heights, and one
        still behind cannot see an approval that has already happened -- so
        the next plan is priced against a chain where it has not, and the dry
        run reverts on an allowance that is there.  `plan_call` takes the
        number and waits for the endpoint to reach it.
        """
        from curve.confirm import wait_for_confirmation

        provider = self._provider_for()
        self.view.say("Waiting for the transaction…", pending=True)
        block = await wait_for_confirmation(provider, tx)
        self._floor_block = max(self._floor_block, int(block or 0))
        self.view.say(done, DONE)
        return block

    def _rejected(self, error: WalletError) -> None:
        """A rejection is not an error worth a red line -- it is a decision."""
        self.view.say("" if getattr(error, "rejected_by_user", False) else str(error),
                      FAILED)

    # ------------------------------------------------------------------ gas

    async def _show_gas(self, plan) -> None:
        """What this route would cost to send, in the chain's own coin.

        Off the router's own simulation of the whole call rather than an
        `eth_estimateGas`: the chain will not estimate a transaction whose
        token has not been approved yet, and this one has already run it --
        granting the approval locally where the wallet holds the coin, which
        is what makes a figure possible before the approval is signed.
        """
        provider = self._provider_for()
        chain_id = self.chain_id_now
        if provider is None or not plan.gas or not chain_id:
            self.view.show_gas("")
            return
        try:
            base, price, tip, eip1559 = await read_fees(provider)
        except (WalletError, ApiError, OSError):
            self.view.show_gas("")
            return
        if not any((base, price)):
            self.view.show_gas("")
            return
        per_gas = settlement_price(base_fee=base, gas_price=price,
                                   node_tip=tip, eip1559=eip1559)
        native = native_for(chain_id)
        amount = fee_in_native(plan.gas, per_gas)
        usd = 0.0
        with contextlib.suppress(ApiError):
            usd = await native_price(self._api, self._chain_name(), chain_id)
        self.view.show_gas(format_fee(amount, native.symbol, amount * usd),
                           estimated=getattr(plan, "gas_estimated", False))


def _wraps(sell, buy, chain_id: int) -> bool:
    """Whether these two are a chain's gas token and its own wrapper.

    A fine pair to choose and a poor one to open on: one for one, for ever,
    with no rate to quote and nothing to compare.  Worth saying because the
    gas token is now listed immediately beside its wrapper, which is exactly
    where "the two busiest coins" takes them from.
    """
    chain = chain_for(chain_id) if chain_id else None
    if chain is None:
        return False
    return wrapping.direction(sell.address, buy.address, chain.wrapped) is not None


def _with_block(exc: Exception, block: int) -> str:
    """One line, ending in the block it happened at."""
    said = str(exc) or exc.__class__.__name__
    return f"{said} (block {block:,})" if block else said


def _why_unsendable(exc: Exception) -> str:
    """One line for why a quoted route cannot be sent.

    The router's own message is written for a terminal -- it names the pools,
    the wei in and out, and the flag that would ship it unprotected -- which
    is the right amount of detail for someone debugging a route and far too
    much under a swap button.
    """
    name = type(exc).__name__
    text = str(exc)
    if "minimum rate to bound" in text or "unbounded" in text:
        return "This route has a leg too small to protect, so it cannot be sent"
    if name == "EncodingError":
        return "This route cannot be packed into one call"
    return f"This route cannot be sent: {text.splitlines()[0][:120]}"


#: Who a route is priced for when no wallet is connected.  The quote does not
#: depend on the caller -- a `staticcall` from nobody answers the same as one
#: from anybody -- but the encoder needs a receiver to name.
_NOBODY = "0x" + "11" * 20


