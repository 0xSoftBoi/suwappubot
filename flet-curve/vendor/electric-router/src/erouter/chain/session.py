"""One chain, warmed once and quoted many times.

`dev/cli.py::cmd_route` is the reference for what a quote needs, and it is a
command-line program: it loads a universe, warms a local EVM, resolves
dialects and balances and wrappers, gates every exact model, and only then
routes.  A frontend needs the same stages and cannot have that shape -- it is
async, it must report progress, the pair changes without the universe
changing, and the amount changes on every keystroke.

So this is those stages, in that order, as an object that holds what it has
already paid for:

    warm()        once per chain, per block, with a progress callback
    set_pair()    when either token changes -- the probe and price fit
    quote()       per keystroke, synchronous, off the prepared pair
    plan_call()   once, before signing, against freshly re-read state

The one structural difference from the CLI is how state is discovered.  That
one asks `eth_createAccessList` which slots a call will touch; the scoped drpc
key does not serve it, and a browser has no second endpoint.  Here the local
EVM reports what it *read and could not find*, `LocalEvm.fill` fetches exactly
that and runs the stage again, and the loop settles.  Same guarantee, no
tracer: what neither can do is let a missing slot read as a plausible zero.
"""

from __future__ import annotations

import asyncio
import copy
import time
from dataclasses import dataclass, field

from ..core import pipeline
from ..core.pools import PoolSpec, parse_universe, volatile_pools
from ..core.probe import COARSE_GRID, plan_grid
from ..core.quoter import QuoterClient
from ..core.rendermodel import build_diagram
from ..core.routecall import NEEDED, encode_route
from ..core.schema import ROUTER_ADDRESS
from ..core.solve import accel_in_use
from . import gas_probe
from .exact_cache import ExactCache
from .facts import FactsCache, apply_broken_facts
from .localevm import LocalEvm
from .statecache import StateCache
from .universe import (
    check_reserves_are_real,
    read_balances,
    resolve_deposit_gates,
    resolve_dialects,
    resolve_lp_tokens,
)

#: Where a `DataSource` is asked for each committed file.  Directory names
#: match `data/` so one implementation can serve a checkout and a web root.
STATE_FILE = "evm-state/{name}.json.gz"
EXACT_FILE = "exact/{name}.json"
FACTS_FILE = "facts/{name}.json"
QUOTER_FILE = "quoter/RouteQuoter.runtime.hex"

#: How many times to ask again for the newest block while waiting for an
#: endpoint to catch up to one already seen, and how long to wait between.
#: Twelve seconds of patience, against a lag that is normally under one.
CATCH_UP_TRIES = 8
CATCH_UP_PAUSE = 1.5

#: What the pre-submit simulation is allowed to spend.  Generous: a thirteen-leg
#: mainnet route measured 2.47M, and this is a local execution where the only
#: cost of a high ceiling is that a runaway loop takes longer to stop.
DRY_RUN_GAS = 3_000_000_000

#: Curve's sentinel for native ETH, which a route spends through `msg.value`
#: rather than through an allowance.
NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

#: Where the quoter is injected when a chain has none deployed.  Any address
#: with no code of its own; the same one `dev/boa_host.py` uses.
SCRATCH = "0x" + "5c" * 20

#: A chain's pool list is filtered to this before anything is probed.  Below
#: it a pool is noise: base carries 610 of them.  `docs/theory.md` section 5
#: records what the floor costs -- one 50-cent trade, replayed.
DEFAULT_MIN_TVL = 10_000.0

#: What `warm` is doing, and how much of the bar each stage is worth.  Measured
#: on mainnet, where the storage sweep is 6,174 slots and dominates everything
#: else put together.
PHASES: tuple[tuple[str, float], ...] = (
    ("block", 0.02),
    ("caches", 0.10),
    ("code", 0.06),
    ("storage", 0.42),
    ("universe", 0.04),
    ("pools", 0.10),
    ("wrappers", 0.08),
    ("arcs", 0.08),
    ("models", 0.10),
)


@dataclass(slots=True)
class WarmReport:
    block: int = 0
    accounts: int = 0
    slots: int = 0
    fetched: int = 0
    pools: int = 0
    arcs: int = 0
    exact: int = 0
    unreadable: int = 0
    ms: float = 0.0
    warnings: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        """Whether every read was answered.  See `LocalEvm`: an unread slot is
        a zero the EVM quotes against quite happily."""
        return self.unreadable == 0


@dataclass(slots=True)
class ExecutionPlan:
    """What to send, and what it promises."""

    to: str
    data: bytes
    value: int
    token_in: str
    amount_in: int
    quoted_out: int
    guaranteed_out: int
    tolerance_bp: float
    gas: int
    block: int
    unbounded: tuple = ()
    reverted: str = ""
    #: True when `gas` was measured with the approval granted locally rather
    #: than by the call that would actually be sent -- which is the only way
    #: to have a figure at all before the token is approved.  See
    #: `_estimate_gas`.
    gas_estimated: bool = False


class _Prank:
    """`gas_probe.Funder`'s idea of an EVM, over an `EvmBackend`.

    Two methods and a spelling difference: the prober was written against the
    CLI's pyrevm wrapper, and the portable backend names the same two things
    `call` and `insert_storage`.
    """

    def __init__(self, backend) -> None:
        self.backend = backend

    def message_call(self, *, caller: str, to: str, calldata: bytes) -> bytes:
        got = self.backend.call(caller, to, bytes(calldata))
        if not got.get("success"):
            raise SessionError(str(got.get("revert_reason") or "call reverted"))
        return bytes(got.get("output") or b"")

    def insert_account_storage(self, address: str, slot: int, value: int) -> None:
        self.backend.insert_storage(address, hex(int(slot)), hex(int(value)))


class SessionError(RuntimeError):
    """A stage that could not be completed, with what stopped it."""


class RouterSession:
    """Everything one chain needs, held between quotes."""

    def __init__(self, chain, rpc, backend, data, raw_pools, *,
                 min_tvl: float = DEFAULT_MIN_TVL, max_legs: int | None = None):
        self.chain = chain
        self.rpc = rpc
        self.backend = backend
        self.data = data
        self.raw_pools = raw_pools
        self.min_tvl = min_tvl
        self.max_legs = max_legs or pipeline.DEFAULT_MAX_LEGS

        self.block = 0
        self.pools: list[PoolSpec] = []
        self.nodes = None
        self.wrappers = None
        self.stake_arcs: list = []
        self.client: QuoterClient | None = None
        self.evm: LocalEvm | None = None
        self.state: StateCache | None = None
        self.verdicts: ExactCache | None = None
        self.facts: FactsCache | None = None
        self.gas_table = None
        self.risk_table = None
        self.gas_price_wei = 0
        self.prepared = None
        self.pair: tuple[str, str] | None = None
        self.report = WarmReport()
        self.notes: list[str] = []
        #: Which solver will answer.  A property of the build rather than of
        #: this session -- `core.accel` decided it at import time -- but the
        #: frontend asks the session, because the session is what it holds.
        #:
        #: `available()` alone is not the answer: the compiled solver is opt-in
        #: behind `EROUTER_ACCEL=1`, so reporting "rust" merely because the
        #: module imports told a caller trying to bisect a bug onto the other
        #: solver that they had failed to, when in fact they were already on
        #: the one they wanted.
        self.solver = "rust" if accel_in_use() else "python"
        self._models = None
        self._quoter = ""
        self._overrides: dict | None = None

    # ------------------------------------------------------------------ warm

    async def warm(self, progress=None, *, block: int | str = "latest") -> WarmReport:
        """Everything that does not depend on the pair or the amount.

        `block` resolves once and pins everything after it.  A quote is only
        comparable to another if both read the same state, so nothing
        downstream ever sees `"latest"` -- and passing a number here is what
        makes a run reproducible against the CLI.
        """
        started = time.monotonic()
        report = WarmReport()
        say = _reporter(progress)

        say("block", 0.0)
        header = await self._header(
            block if isinstance(block, str) else hex(int(block)))
        self.block = int(header["number"], 16)
        report.block = self.block
        say("block", 1.0)

        say("caches", 0.0)
        name = self.chain.name.lower()
        self.state = StateCache.from_bytes(
            self.chain.chain_id, await self.data.load(STATE_FILE.format(name=name)))
        self.verdicts = ExactCache.from_bytes(
            self.chain.chain_id, await self.data.load(EXACT_FILE.format(name=name)))
        self.facts = FactsCache.from_bytes(
            self.chain.chain_id, await self.data.load(FACTS_FILE.format(name=name)))
        say("caches", 1.0)

        say("code", 0.0)
        evm = self.evm = LocalEvm(
            self.backend, self.chain.chain_id, self.block, quoter=self.chain.quoter)
        self._set_block_env(header)
        report.accounts = evm.install(self.state)
        await self._install_quoter()
        say("code", 1.0)

        report.slots = await self._sweep(say)
        report.fetched = evm.stats.fetched

        say("universe", 0.0)
        self.pools = self._universe()
        report.pools = len(self.pools)
        say("universe", 1.0)

        self.client = QuoterClient(evm, self._quoter, overrides=self._overrides)
        await self._resolve_pools(say)
        await self._build_wrappers(say)
        report.arcs = await self._preflight_arcs(say)
        report.exact = await self._build_models(say)

        self.gas_table, _ = self.facts.table(self.pools), None
        self.risk_table = self.facts.risk_table()
        self.gas_price_wei = await self._gas_price()

        report.unreadable = evm.stats.unreadable
        report.warnings.extend(evm.stats.errors[:6])
        report.ms = (time.monotonic() - started) * 1000
        self.report = report
        return report

    async def refresh(self) -> int:
        """Re-read every slot already loaded, at the newest block.

        The pool set, the code and the slot *list* are properties of bytecode
        and do not move between blocks; only the values do.  So this is one
        batched sweep and nothing else -- no access lists, no re-gating -- and
        it is what runs on a timer and after a swap of our own lands.
        """
        if self.evm is None:
            raise SessionError("refresh before warm")
        header = await self._header("latest")
        block = int(header["number"], 16)
        if block == self.block:
            return block
        self.block = block
        self.evm.repin(block)
        self._set_block_env(header)
        known = self.backend.known_slots()
        await self._read_slots(known)
        await self._read_balances()
        # The models hold balances frozen at the block they were built from, so
        # a refresh that kept them would be self-consistent and wrong.
        client = self.client
        refresh_at = getattr(client, "refresh_at", None)
        if refresh_at is not None:
            refresh_at(block)
        # A preparation is a function of (universe, block); the pair has to be
        # re-prepared before the next quote is comparable to the last.
        self.prepared = None
        return block

    # -------------------------------------------------------------- the pair

    async def set_pair(self, src: str, dst: str, progress=None):
        """Probe and price for one (src, dst).  Independent of the amount."""
        if self.client is None or self.nodes is None:
            raise SessionError("set_pair before warm")
        # Its own 0..1 rather than the warm's phase weighting: `_reporter`
        # maps a phase it does not know to 1.0, so a pair reported "done"
        # before it started and a bar driven from it never moved.
        say = progress or (lambda phase, fraction: None)
        say("pair", 0.0)
        src, dst = src.lower(), dst.lower()
        if not self.nodes.has(src) or not self.nodes.has(dst):
            raise SessionError("token not routable in this universe")

        def run():
            return pipeline.prepare(
                self.pools, self.nodes, self.client,
                src_token=src, dst_token=dst, extra_arcs=self.stake_arcs,
            )

        self.prepared = await self.evm.fill(
            self.rpc, run, block=hex(self.block), code_for=self._code_for)
        self.pair = (src, dst)
        say("pair", 1.0)
        return self.prepared

    def quote(self, amount_in: int):
        """One size, off the prepared pair.  Synchronous and ~100-600 ms.

        No `await` anywhere in here on purpose: everything it reads is already
        in the local EVM, so a keystroke costs arithmetic and no round trips.
        """
        if self.prepared is None or self.pair is None:
            raise SessionError("quote before set_pair")
        src, dst = self.pair
        return pipeline.route(
            self.pools, self.nodes, self.client,
            src_token=src, dst_token=dst, amount_in=int(amount_in),
            prepared=self.prepared, extra_arcs=self.stake_arcs,
            max_legs=self.max_legs, gas_price_wei=self.gas_price_wei,
            gas_table=self.gas_table, risk_table=self.risk_table,
        )

    def diagram(self, result, **kw):
        """The structured route diagram; a frontend draws it with controls."""
        if result.route is None:
            return None
        return build_diagram(
            result.route, self.nodes,
            pool_names=result.pool_names if hasattr(result, "pool_names") else None,
            certificate=result.certificate,
            certificate_reason=result.certificate_reason,
            **kw,
        )

    # ----------------------------------------------------------- the sending

    async def plan_call(self, result, *, receiver: str, sender: str = "",
                        min_out_bp: float = 0.0,
                        not_before: int = 0) -> ExecutionPlan:
        """Re-read the route's state, re-price its legs, and encode the call.

        A quote is priced at the block the slots were swept at.  Between that
        and the block a transaction lands in, the pools move -- and every leg's
        minimum rate is derived from what its pool would really pay, so a bound
        set against stale state is a promise about a number nothing checked.
        `docs/router.md` measures the damage: 37.9 bp per leg from the model's
        own figures, against a tolerance of 13.9.

        So this re-reads exactly the accounts the chosen route touches at the
        newest block, re-quotes the legs at their final sizes, and encodes
        against that.
        """
        if result.route is None:
            raise SessionError("no route to send")
        # `not_before` is a block the caller has seen a transaction confirmed
        # in -- an approval, usually.  See `_header_at_least`.
        header = await self._header_at_least(not_before)
        block = int(header["number"], 16)
        self._set_block_env(header)
        touched = self._route_accounts(result.route)
        await self._read_slots(
            [s for s in self.backend.known_slots() if s[0] in touched], at=block)

        def price():
            return pipeline.price_legs(result.route, self.client)

        await self.evm.fill(self.rpc, price, block=hex(block), code_for=self._code_for)
        # An end-to-end bound *as well as* the per-leg ones, when the caller
        # asks for one.  Taken off the route's own modelled figure, as the CLI
        # does: `guaranteed_out` already discounts every leg's tolerance, so
        # deriving it from that would compound the two.
        min_out = (int(result.route.modelled_out * (1 - min_out_bp / 1e4))
                   if min_out_bp else 0)
        call = encode_route(
            result.route,
            receiver=receiver,
            volatile=volatile_pools(self.pools, self.chain.stables + self.chain.forex),
            quoted_out=result.verified_out,
            naming=NEEDED,
            min_out=min_out,
        )
        data = call.calldata(sender=sender or receiver)
        # Native ETH is Curve's `0xEeee…` sentinel rather than a token, so a
        # route that spends it needs `msg.value` to match -- and one that does
        # not refuses a non-zero value rather than keeping it.
        value = result.amount_in if call.token_in.lower() == NATIVE else 0
        gas, reverted = await self._dry_run(data, sender or receiver, value, block)
        estimated = False
        if not gas and reverted:
            # The usual reason is an approval that is not there yet, and
            # "we cannot say what it costs until you approve it" is a poor
            # answer to "what does it cost".  Measured on a stand-in account,
            # so nothing about the real sender is touched and the refusal
            # above stays the honest one.
            gas = await self._estimate_gas(
                call, result, value, block, sender or receiver)
            estimated = bool(gas)
        return ExecutionPlan(
            to=ROUTER_ADDRESS,
            data=data,
            value=value,
            token_in=call.token_in,
            amount_in=result.amount_in,
            quoted_out=result.verified_out or 0,
            guaranteed_out=call.guaranteed_out,
            tolerance_bp=call.tolerance_bp,
            gas=gas,
            block=block,
            unbounded=tuple(call.unbounded),
            reverted=reverted,
            gas_estimated=estimated,
        )

    async def _seed_from_access_list(self, data: bytes, sender: str,
                                     value: int, block: int) -> int:
        """Ask the node what this call touches, and fetch all of it at once.

        The miss loop can only discover state one layer of calls at a time,
        because that is all a local EVM can report: it stops at the first
        thing it does not have, and each round buys exactly one more layer.  A
        sixteen-leg route is twenty-four layers deep, which is twenty-four
        sequential round trips before a gas figure appears.
        `eth_createAccessList` answers the same question in one.

        Partial by nature: the call it is asked about reverts for want of an
        allowance, so the list stops where the execution did.  The miss loop
        still runs afterwards -- this only means it has much less to find.

        Best-effort throughout.  A node that will not answer, a key not
        scoped for the router, an answer in an unexpected shape: all of them
        just leave the loop to do the work it did before.

        It writes the *chain's* values, so anything that has been overridden
        locally has to be overridden again afterwards -- see `_estimate_gas`,
        which grants an allowance this would otherwise fetch back to zero.
        """
        transaction = {
            "from": sender,
            "to": ROUTER_ADDRESS,
            "data": "0x" + bytes(data).hex(),
            "gas": hex(DRY_RUN_GAS),
            "value": hex(int(value)),
        }
        try:
            answer = (await self.rpc.batch(
                [("eth_createAccessList", [transaction, hex(block)])]))[0]
        except Exception:
            return 0
        if not isinstance(answer, dict):
            return 0
        wanted: list[tuple[str, str]] = []
        unknown: list[str] = []
        for entry in answer.get("accessList") or ():
            address = str((entry or {}).get("address") or "")
            if not address:
                continue
            if not self.backend.has_account(address):
                unknown.append(address)
            wanted += [(address, str(key)) for key in entry.get("storageKeys") or ()]
        if unknown:
            await self._read_code(unknown, block)
        if wanted:
            await self._read_slots(wanted, at=block)
        return len(wanted)

    async def _read_code(self, accounts: list[str], block: int) -> None:
        """Code and balance for accounts the sweep never had a reason to hold."""
        payloads = [("eth_getCode", [a, hex(block)]) for a in accounts]
        payloads += [("eth_getBalance", [a, hex(block)]) for a in accounts]
        got = await self._batched(payloads)
        codes, balances = got[:len(accounts)], got[len(accounts):]
        for address, code, balance in zip(accounts, codes, balances, strict=True):
            blob = self._code_for(address)
            if blob is None and isinstance(code, str):
                blob = bytes.fromhex(code[2:])
            self.backend.insert_account(
                address, nonce=1,
                balance=balance if isinstance(balance, str) else "0x0",
                code=blob or None,
            )

    async def _estimate_gas(self, call, result, value: int, block: int,
                            sender: str) -> int:
        """What this route would cost, for a sender who already holds the coin.

        Everything the estimate needs is already here -- the swept state, the
        router's code, and an EVM to run it in -- so the only thing missing is
        the approval, and that is one storage slot.  `gas_probe.Funder` finds
        it by writing a marker and asking the token's own `allowance` whether
        it landed, which works without knowing any token's layout in advance.

        Only the approval is granted.  A wallet that does not hold the coin
        gets no figure rather than a figure for a trade it cannot make: giving
        it a balance would be quoting the cost of somebody else's swap, and
        finding a real holder to impersonate is a fork trick with a great deal
        behind it that this does not need.

        Both slots the search touches are re-read from the chain afterwards.
        The search writes markers into the balance slot to identify it, and
        the approval it grants is not real -- left behind, either would make
        the *next* honest dry run agree to a transaction that cannot go
        through, which is worse than having no estimate at all.
        """
        token = call.token_in
        if token.lower() == NATIVE or not sender:
            return 0
        funder = gas_probe.Funder(_Prank(self.backend), owner=sender)
        held = funder.balance_of(token, sender)
        if held < result.amount_in:
            return 0
        try:
            if not funder.fund(token, ROUTER_ADDRESS, result.amount_in):
                return 0
            # The receiver is named rather than defaulted: defaulting it pays
            # whoever sent the call, and that is the same sender here, so the
            # shape stays the one that will really be sent.
            data = call.calldata(sender=sender)
            gas, _reason = await self._dry_run(
                data, sender, value, block, seed=False)
        except Exception:
            gas = 0
        finally:
            slots = funder.slots_for(token, ROUTER_ADDRESS)
            if slots:
                await self._read_slots(
                    [(token, hex(slot)) for slot in slots], at=block)
        return gas

    async def _dry_run(self, data: bytes, sender: str, value: int,
                       block: int, *, seed: bool = True) -> tuple[int, str]:
        """Execute the encoded call locally, for the gas and for a reason.

        Through the miss loop, and that is the whole point of doing it here at
        all.  Nothing in a quote ever calls the router, so its code is not in
        the swept state, and a call into an account with no code *succeeds* --
        it is an EOA as far as the EVM is concerned.  That reported a 6-leg
        route as costing 34,090 gas and reverting nowhere, which is 21,000 for
        the transaction plus the calldata and not one opcode of routing.

        Fetching what the call reads gets the router's code, and then the
        caller's own balance and allowance for the input token, which nothing
        else has ever needed.  So this is also the honest answer to "will this
        go through": a revert naming the token is an approval that is not
        there, and one naming a leg's minimum rate is a route that has moved.
        """
        held: dict = {}

        def run():
            held["got"] = self.backend.call(
                sender, ROUTER_ADDRESS, bytes(data), hex(int(value)), DRY_RUN_GAS)
            return held["got"]

        if seed:
            await self._seed_from_access_list(data, sender, value, block)
        await self.evm.fill(self.rpc, run, block=hex(block),
                            code_for=self._code_for)
        if not self.backend.has_account(ROUTER_ADDRESS):
            return 0, f"no router deployed at {ROUTER_ADDRESS} on this chain"
        got = held.get("got") or {}
        if got.get("success"):
            return int(got["gas_used"]), ""
        return 0, str(got.get("revert_reason") or got.get("halt_reason") or "reverted")

    # ------------------------------------------------------------- internals

    async def _header(self, block: str) -> dict:
        header = await self.rpc.call("eth_getBlockByNumber", [block, False])
        if not isinstance(header, dict) or "number" not in header:
            raise SessionError(f"could not read the {block} block header")
        return header

    async def _header_at_least(self, floor: int) -> dict:
        """The newest block, once the endpoint has caught up to `floor`.

        An endpoint behind a load balancer is many nodes, and they are not at
        the same height.  A transaction the caller has *seen confirmed* in
        block N is not visible to a node still at N-1, so a plan pinned there
        prices the route against a chain where the approval has not happened
        -- and the dry run reverts on an allowance that does exist, which
        reads as "this route would not go through" and is simply wrong.

        So a caller that knows a block waits for it.  Briefly: this is a
        second or two of lag, not a reorg, and pinning a stale block is worse
        than pinning a slightly later one.
        """
        header = await self._header("latest")
        if not floor:
            return header
        for _ in range(CATCH_UP_TRIES):
            if int(header["number"], 16) >= floor:
                return header
            await asyncio.sleep(CATCH_UP_PAUSE)
            header = await self._header("latest")
        # Still behind: answer with what there is rather than refuse.  A plan
        # against a stale block is a plan the dry run will speak up about,
        # and refusing outright would be this deciding on the caller's behalf
        # that a slow endpoint is a broken one.
        return header

    def _set_block_env(self, header: dict) -> None:
        """The header the calls run against.

        Zero is not a harmless default: 3pool's `A()` ramps off
        `block.timestamp` and underflows there, so every call would revert.
        """
        self.backend.set_block(
            number=int(header["number"], 16),
            timestamp=int(header["timestamp"], 16),
            basefee=int(header.get("baseFeePerGas") or "0x0", 16),
            gas_limit=int(header["gasLimit"], 16),
            coinbase=header.get("miner") or "0x" + "00" * 20,
            prevrandao=header.get("mixHash") or "0x" + "00" * 32,
            excess_blob_gas=(int(header["excessBlobGas"], 16)
                             if header.get("excessBlobGas") else None),
        )

    async def _install_quoter(self) -> None:
        """The deployed quoter, or the committed runtime injected in its place.

        Deployed is preferred: it needs no state override, which is the only
        form the scoped endpoint serves.  Where a chain has none, the runtime
        rides in as an override -- and locally an override is just an account
        with code, so it costs nothing here.
        """
        address = (self.chain.quoter or "").strip()
        if address:
            self._quoter = address
            if not self.backend.has_account(address):
                code = await self.rpc.call("eth_getCode", [address, hex(self.block)])
                if isinstance(code, str) and len(code) > 2:
                    self.backend.insert_account(
                        address, nonce=1, code=bytes.fromhex(code[2:]))
                else:
                    raise SessionError(
                        f"no quoter deployed at {address} on {self.chain.name}")
            return
        blob = await self.data.load(QUOTER_FILE)
        if not blob:
            raise SessionError(
                f"{self.chain.name} has no deployed quoter and no committed runtime")
        body = "".join(line.strip() for line in blob.decode().splitlines()
                       if line.strip() and not line.startswith("#"))
        code = bytes.fromhex(body)
        self._quoter = SCRATCH
        self.backend.insert_account(SCRATCH, nonce=1, code=code)
        # Recorded as an override too, so a client that re-injects on a wire
        # transport keeps working against the same address.
        self._overrides = {SCRATCH: {"code": "0x" + code.hex()}}

    async def _sweep(self, say) -> int:
        """The one genuinely per-block cost: what every known slot holds now."""
        say("storage", 0.0)
        wanted = [(address, f"0x{slot:x}")
                  for address, slots in self.state.slots().items()
                  for slot in sorted(slots)]
        loaded = await self._read_slots(wanted, say=say)
        await self._read_balances()
        say("storage", 1.0)
        return loaded

    async def _read_slots(self, wanted, *, say=None, at: int | None = None) -> int:
        """Read these slots at `at`, or at the pinned block, and insert them.

        `at` is for the pre-submit re-read, which is the one place that wants
        a *different* block from the one the session is pinned to: it re-reads
        the route's own accounts at the newest block without moving the pin,
        because the pin is what the next `refresh` compares against and moving
        it would make that refresh decide it had nothing to do.

        A slot that will not come back is retried once -- a dropped batch is
        usually transient -- and then counted, because a slot the EVM does not
        hold reads as zero and a zero fee or rate is a plausible number.
        """
        wanted = list(wanted)
        if not wanted:
            return 0
        block = hex(at if at is not None else self.block)
        values = await self._batched(
            [("eth_getStorageAt", [a, _word(s), block]) for a, s in wanted], say=say)
        rows, missing = [], []
        for (address, slot), value in zip(wanted, values, strict=True):
            if isinstance(value, str):
                rows.append((address, slot, value))
            else:
                missing.append((address, slot))
        if missing:
            again = await self._batched(
                [("eth_getStorageAt", [a, _word(s), block]) for a, s in missing])
            for (address, slot), value in zip(missing, again, strict=True):
                if isinstance(value, str):
                    rows.append((address, slot, value))
                else:
                    self.evm.stats.unreadable += 1
                    self.evm.stats.errors.append(f"slot {address[:10]}:{slot} unreadable")
        self.evm.apply_storage(rows)
        return len(rows)

    async def _read_balances(self) -> None:
        """Only where there is one to have.

        Most pools hold no native ETH and the cache remembers which do -- but
        the ETH/stETH pool does, and a zero there makes `get_dy` answer zero.
        """
        holders = sorted(self.state.funded & set(self.state.accounts))
        if not holders:
            return
        block = hex(self.block)
        got = await self._batched([("eth_getBalance", [a, block]) for a in holders])
        self.evm.apply_balances(
            (a, v) for a, v in zip(holders, got, strict=True) if isinstance(v, str))

    async def _batched(self, payloads, *, say=None) -> list:
        """Hand the transport enough at a time to keep its streams busy.

        A transport chunks and streams internally; handing it one chunk and
        awaiting that before building the next made the whole sweep as serial
        as a transport with one stream.  Measured against the same endpoint,
        6,174 slots took 16.9 s that way and 1.3 s from the CLI, which does
        not.

        Still in groups rather than all at once, because whoever asked is
        drawing a loading bar and one await reports nothing until it is over.
        """
        out: list = []
        size = getattr(self.rpc, "batch_size", 0) or 100
        streams = getattr(self.rpc, "max_streams", 0) or 1
        step = size * streams
        for start in range(0, len(payloads), step):
            out.extend(await self.rpc.batch(payloads[start:start + step]))
            if say is not None and payloads:
                say("storage", min(1.0, len(out) / len(payloads)))
        return out

    def _universe(self) -> list[PoolSpec]:
        """The frontend's pool rows, filtered the way the CLI filters them."""
        pools = [p for p in parse_universe(self.raw_pools)
                 if p.tvl_usd >= self.min_tvl]
        banned = {a.lower() for a in getattr(self.chain, "blacklist", ())}
        if banned:
            pools = [p for p in pools if p.address.lower() not in banned]
        apply_broken_facts(pools, self.facts)
        return pools

    async def _settle(self, touch) -> None:
        """Fetch everything `touch` reads, discarding what it produced.

        The miss loop runs its stage several times, and several of these
        stages **mutate**: `check_reserves_are_real` drops a pool that looks
        insolvent, `resolve_deposit_gates` marks one gated, the exact gate
        records a refusal.  Run against incomplete state, each of those makes
        a decision it will not revisit -- a token whose account is not loaded
        answers `balanceOf` with zero, so 35 solvent pools read as holding
        nothing and lost their arcs, measured against the CLI at one block.

        So the loop runs on throwaway copies until it stops asking for
        anything, and the real stage then runs exactly once, against state
        that is complete.
        """
        await self.evm.fill(self.rpc, touch, block=hex(self.block),
                            code_for=self._code_for)

    async def _resolve_pools(self, say) -> None:
        """Dialects, balances, LP tokens and deposit gates, off the local EVM."""
        say("pools", 0.0)
        client = self.client
        chain_id = self.chain.chain_id

        # What each pool holds in *native* ETH, before the stages run.  A pool
        # listing WETH may legitimately hold ether instead -- 29 of the 31
        # apparent shortfalls on mainnet -- and `check_reserves_are_real`
        # expresses a drop by zeroing balances, so without these thirty solvent
        # crypto pools lose every arc they have.  It cannot fetch them itself
        # here: it is synchronous, and this is the only side that can await.
        native = await self._native_balances()

        def stages(pools, notes):
            resolve_dialects(pools, client, self.chain, use_cache=False)
            read_balances(pools, client, notes, chain_id)
            resolve_lp_tokens(pools, client, chain_id)
            resolve_deposit_gates(pools, client)
            # Kept, not discarded.  Zeroing a pool's balances is how a drop is
            # expressed, and with the reason thrown away a frontend has a pool
            # that was there a moment ago and nothing to say about it: polygon
            # drops five this way -- four on retired am3CRV and one reporting
            # 139,834 WPOL against a wei it actually holds -- and the CLI names
            # all five while the session named none.
            notes.extend(check_reserves_are_real(pools, client, None,
                                                 native=native))
            return notes

        await self._settle(lambda: stages(copy.deepcopy(self.pools), []))
        self.notes = stages(self.pools, [])
        say("pools", 1.0)

    async def _native_balances(self) -> dict[str, int]:
        """`pool -> wei` for every pool that lists WETH or ETH among its coins."""
        wanted = [p.address for p in self.pools
                  if any(c.symbol.upper() in ("WETH", "ETH") for c in p.coins)]
        if not wanted:
            return {}
        block = hex(self.block)
        got = await self._batched([("eth_getBalance", [a, block]) for a in wanted])
        return {a: int(v, 16) for a, v in zip(wanted, got, strict=True)
                if isinstance(v, str)}

    async def _build_wrappers(self, say) -> None:
        """The node map, and the arcs no pool list mentions.

        Vaults, wrapped native, transmuters and lending tokens.  These read
        ERC20s and vaults that no pool probe touches, which is exactly the
        state a slot cache built from arc probes does not have -- so the miss
        loop earns its keep here more than anywhere.
        """
        say("wrappers", 0.0)
        from .wrappers import (
            build_lending_arcs,
            build_node_map,
            build_stake_arcs,
            build_transmuter_arcs,
        )

        client = self.client

        def stages():
            nodes, wrappers = build_node_map(
                self.pools, self.chain, client, facts=self.facts, token_client=client)
            stake = build_stake_arcs(nodes, self.chain, client)
            stake = stake + build_transmuter_arcs(nodes, self.chain, client)
            stake = stake + build_lending_arcs(nodes, self.chain, client, self.facts)
            return nodes, wrappers, stake

        # These build fresh objects rather than mutating, but a round run
        # against incomplete state still *decides* -- a vault whose
        # `convertToAssets` reads zero is rejected as non-linear and its arc
        # never appears.  So the answer is taken from a run after the state
        # has settled, not from the last round of the loop.
        await self._settle(stages)
        self.nodes, self.wrappers, self.stake_arcs = stages()
        say("wrappers", 1.0)

    async def _preflight_arcs(self, say) -> int:
        """Quote every arc once, so the slots they read are loaded before a
        quote depends on them.

        This is what `eth_createAccessList` bought the CLI, obtained the other
        way round: run the coarse probe grid, see what the EVM could not read,
        fetch it.  A pool that has begun reading a slot it was not reading
        before -- an oracle round advancing, a LLAMMA band moving -- is only
        visible here, and reading it as zero is a wrong quote rather than a
        missing one.
        """
        say("arcs", 0.0)
        refs, _ = pipeline.build_arcs(self.pools, self.nodes)
        if not refs:
            say("arcs", 1.0)
            return 0
        plan = plan_grid(refs, grid=COARSE_GRID)

        def run():
            self.client.probe(plan.probes)
            return len(refs)

        await self.evm.fill(self.rpc, run, block=hex(self.block),
                            code_for=self._code_for)
        say("arcs", 1.0)
        return len(refs)

    async def _build_models(self, say) -> int:
        """The exact-model gate, run here rather than trusted from a file.

        A model whose parameters were misread is confidently wrong at every
        size and does not announce itself, so every candidate is quoted for
        real and kept only if it reproduces the pool to the wei.  The verdict
        cache is a *seed* -- it says which pools passed last time, under a
        fingerprint of the maths that earned it -- and the gate still runs.
        """
        say("models", 0.0)
        from ..core.types import ArcKind
        from .crypto_lp_params import build_exact_crypto_lp
        from .exact_probe import ExactQuoterClient
        from .lp_params import build_exact_lp
        from .stable_params import build_exact_pools
        from .tricrypto_params import build_exact_tricrypto
        from .twocrypto_params import build_exact_twocrypto
        from .vault_params import build_exact_vaults

        measured = self.client
        held: dict = {}

        def build(block: int = 0, cache=None):
            cache = self.verdicts if cache is None else cache
            if block:
                # Balances are frozen into each model, so a rebuild that kept
                # the old ones would be self-consistent and wrong.
                read_balances(self.pools, measured, None, self.chain.chain_id)
            refs, _ = pipeline.build_arcs(self.pools, self.nodes)
            lp_pools = {r.pool.lower() for r in refs
                        if r.kind.is_deposit or r.kind.is_withdraw}
            vault_arcs = {a.pool for a in self.stake_arcs
                          if a.kind in (ArcKind.ERC4626_DEPOSIT, ArcKind.ERC4626_REDEEM)}
            vault_arcs |= {v.token for v in self.wrappers.merged_vaults}
            stable = build_exact_pools(self.pools, measured, cache=cache)
            crypto = build_exact_tricrypto(self.pools, measured, cache=cache)
            carrying = [p for p in self.pools if p.address.lower() in lp_pools]
            return (
                stable,
                build_exact_twocrypto(self.pools, measured, cache=cache),
                crypto,
                build_exact_vaults(vault_arcs, measured),
                build_exact_lp(carrying, stable, measured),
                build_exact_crypto_lp(carrying, crypto, measured),
            )

        # The gate refuses a pool that will not reproduce its own quote, and
        # records the refusal.  A round against incomplete state would refuse
        # pools for reading zeros -- `ExactCache.mass_refusal` exists because
        # that has happened over the wire -- so the loop runs against a
        # throwaway cache and the verdicts are earned once, afterwards.
        await self._settle(lambda: build(cache=ExactCache.from_bytes(self.chain.chain_id, None)))
        held["models"] = build()
        exact, two, tri, vaults, lp, crypto_lp = held["models"]
        self._models = held["models"]
        # No probe memoisation under this.  `probe_cache` exists to avoid round
        # trips and there are none here -- and it also memoises *route*
        # verifications, which is wrong for a route that uses one pool twice:
        # the second leg meets a pool the first leg moved, and a cached answer
        # would price it as though it had not.  The CLI drops it for the same
        # reason once its local EVM is warm.
        if exact or two or tri:
            self.client = ExactQuoterClient(
                self.client, exact, two, tri, vaults, lp,
                models_block=self.block, rebuild=build, crypto_lp=crypto_lp)
        say("models", 1.0)
        return len(exact) + len(two) + len(tri)

    async def _gas_price(self) -> int:
        """What a leg costs to execute, priced.

        Left at zero every route looks free to branch, which is backwards for
        the small trades where an extra leg costs more than it saves.
        """
        got = await self.rpc.call("eth_gasPrice", [])
        return int(got, 16) if isinstance(got, str) else 0

    def _code_for(self, address: str) -> bytes | None:
        """The committed cache before the wire: a pool's code cannot change,
        so `eth_getCode` for one is a round trip for a constant."""
        return self.state.bytecode(address) if self.state is not None else None

    def _route_accounts(self, route) -> set[str]:
        """Every account the chosen route reads, for a targeted re-read.

        The pools themselves, plus what their arcs read *through* -- a lending
        pool's cToken, a vault pool's vault, an oracle -- which the slot cache
        records precisely because those are not the pool's own storage.
        """
        touched = {leg.target.lower() for leg in route.legs}
        needs = getattr(self.state, "arc_needs", {}) or {}
        for address in list(touched):
            touched.update(a for a in needs.get(address, ()) if isinstance(a, str))
        for address, slots in needs.items():
            if address in touched:
                touched.update(s for s in slots if isinstance(s, str))
        return {a.lower() for a in touched}


def _reporter(progress):
    """Turn a per-phase fraction into one number for a loading bar.

    The phases are weighted by what they measure on mainnet, so the bar moves
    at roughly the rate the work does rather than in nine equal jumps.
    """
    if progress is None:
        return lambda phase, fraction: None
    weights = dict(PHASES)
    order = [name for name, _ in PHASES]

    def say(phase: str, fraction: float) -> None:
        done = sum(weights[name] for name in order[:order.index(phase)]) \
            if phase in weights else 1.0
        share = weights.get(phase, 0.0)
        progress(phase, min(1.0, done + share * max(0.0, min(1.0, fraction))))

    return say


def _word(slot) -> str:
    value = int(slot, 16) if isinstance(slot, str) else int(slot)
    return f"0x{value:064x}"
