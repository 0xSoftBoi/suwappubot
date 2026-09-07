"""A `Transport` that executes locally, against state fetched once (§10).

Every question the router asks is a read at one pinned block, and it asks the
same few hundred arcs repeatedly.  Fetching the state once takes the round trips
to zero: a `get_dy` costs 30-449 us locally against ~0.8 ms on the wire.

State comes from `eth_createAccessList` -- exactly the accounts and slots the
call touches.  The touched set does not vary with trade size on any pool
measured, but lists are still gathered at several sizes and unioned.

**A missed slot reads as zero, not as an error.**  That is the hazard, and
`strict=True` (the default) accepts it: prefetching and lazy fallback are
mutually exclusive, since with `fork_url` set revm loads an account from the fork
before accepting an insert.  What makes it safe is upstream -- the router
verifies its chosen route on chain regardless, so a stale prefetch costs route
quality, never a wrong answer.

`strict=False` gives up the bulk load and serves every read lazily at ~34 ms a
slot: slow, correct by construction, and the mode to reach for when a quote
disagrees with the chain.  It matters for state a cached slot list cannot predict
-- a Chainlink aggregator's `s_transmissions[roundId]`, a LLAMMA's active band.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from typing import Any

from ..core.transport import Answer, Call, Status
from ..core.types import ArcKind
from .rpc import DEFAULT_STREAMS

# A caller that is nobody, funded so `msg.sender` balance checks never bind.
CALLER = "0x" + "11" * 20

#: One `get_dy` spelling per swap kind, for warming a chain with no deployed
#: quoter -- see `LocalEvm.warm_arcs`.
DIRECT_SIGS = {
    ArcKind.SWAP_STABLE: "get_dy(int128,int128,uint256)",
    ArcKind.SWAP_CRYPTO: "get_dy(uint256,uint256,uint256)",
}
# Erigon refuses a JSON-RPC batch larger than this by default ("batch limit 100
# exceeded"), and it refuses the *whole* batch -- so a route's worth of proofs
# has to be split or none of it arrives.
BATCH_LIMIT = 100

def _access_list_error(answer: Any) -> str:
    """Why an `eth_createAccessList` answer is unusable, or `""` if it is fine.

    Three failure modes, and only one of them is a JSON-RPC error.  Geth reports
    a *failed simulation* inside a successful result -- `{"accessList": [],
    "error": "..."}` -- and some endpoints do not report even that, returning a
    `get_dy` that supposedly burned a million gas and touched no storage.

    So an **empty list is treated as a failure**, not as a call that touched
    nothing.  A genuine no-storage call loses one tracer message, once, since the
    result is cached per call; believing the empty list cost a whole chain --
    pools loaded with their code and none of their state, read as holding zero,
    and every arc dropped at calibration.
    """
    if isinstance(answer, Exception):
        return str(answer)
    if not isinstance(answer, dict):
        return f"not an object: {answer!r}"
    if answer.get("error"):
        return str(answer["error"])
    if not answer.get("accessList"):
        return "empty access list"
    return ""


def _access_list_failed(answer: Any) -> bool:
    return bool(_access_list_error(answer))


# The storage sweep is a few thousand tiny independent reads, a very different
# shape from the probe batches the transport's default is tuned for.  Sixteen
# streams take 2.4x of the four-stream default; doubling again buys 12% more and
# twice the connections, which a hosted endpoint is entitled to object to.
PRIME_STREAMS = 16

# Twenty-seven bytes that read their own storage.
#
# No contract can read another account's storage, but an `eth_call` state
# override replaces an account's *code* while keeping its *storage* -- so this
# blob injected at a pool runs in that pool's context and can read all of it.
# The quoter's `raw_batch` coordinates, 600 reads a call.
#
# Not the default: an unmetered node answers many small `eth_getStorageAt` faster
# than seven big `eth_call`s, while a public endpoint is ~334x the other way.
# `prefer_dump` turns it on where requests are counted.  The keyed drpc cannot
# use it at all -- the blob rides an `eth_call` state override and that key's
# `eth_call` is restricted to the quoter.
#
# Calldata is a run of 32-byte slot numbers, the return their values in order.
#
#   36        CALLDATASIZE        [size]
#   6000      PUSH1 0             [size, i]
#   5b        JUMPDEST      <- 03 loop
#   81 81 10  DUP2 DUP2 LT        [size, i, i < size]
#   15        ISZERO
#   6016 57   PUSH1 22 JUMPI      exit when i reaches size
#   80 35     DUP1 CALLDATALOAD   [size, i, slot]
#   54        SLOAD               [size, i, value]
#   81 52     DUP2 MSTORE         mem[i] = value
#   6020 01   PUSH1 32 ADD        i += 32
#   6003 56   PUSH1 3 JUMP
#   5b        JUMPDEST      <- 22 end
#   50 6000   POP PUSH1 0
#   f3        RETURN              return(0, size)
DUMPER = bytes.fromhex("366000" "5b" "818110" "15" "601657" "8035" "54" "8152"
                       "602001" "600356" "5b" "50" "6000" "f3")
# Reads per `raw_batch`; the contract's own MAX_PROBES.
DUMP_CHUNK = 600
# ...but only when the caller has not said otherwise.  A hosted endpoint that
# allows two connections is a real constraint, not an oversight.


class LocalEvmError(RuntimeError):
    pass


@dataclass(slots=True)
class WarmStats:
    accounts: int = 0
    slots: int = 0
    list_calls: int = 0
    retried: int = 0
    fetch_calls: int = 0
    round_trips: int = 0
    ms: float = 0.0
    list_ms: float = 0.0
    code_ms: float = 0.0
    storage_ms: float = 0.0
    errors: list[str] = field(default_factory=list)
    #: Slots and balances the node would not give up, after a retry.  Each is a
    #: value the EVM will read as **zero**, so this is not a diagnostic: it says
    #: the state is wrong and the caller must not quote from it.
    unreadable: int = 0

    @property
    def complete(self) -> bool:
        return self.unreadable == 0


@dataclass(slots=True)
class LocalEvm:
    """Read-only chain access at a pinned block, executed in-process.

    Implements `core.transport.Transport`, so `QuoterClient` and everything above
    it work unchanged -- including the quoter contract, whose runtime bytecode is
    inserted here exactly as an `eth_call` state override would inject it.
    """

    rpc: object
    strict: bool = True
    cache: object = None
    quoter: str = ""
    prefer_dump: bool = False
    _evm: object = None
    _loaded: set[str] = field(default_factory=set)
    _slots: dict[str, set[int]] = field(default_factory=dict)
    _listed: set[tuple[str, bytes]] = field(default_factory=set)
    _injected: set[str] = field(default_factory=set)
    _tracing: bool | None = None
    _al_shape: dict | None = None
    #: What the last warm's access lists named, and which of those accounts were
    #: the pools themselves.  Kept so `last_arc_needs` can report what an arc
    #: reads *through* without asking the node for the same lists twice.
    _last_listed: dict[str, set[int]] = field(default_factory=dict)
    _arc_targets: set[str] = field(default_factory=set)
    stats: WarmStats = field(default_factory=WarmStats)

    def __post_init__(self) -> None:
        from pyrevm import EVM, BlockEnv

        header = self.rpc.fetch("eth_getBlockByNumber", [self.rpc.pin.hex_block, False])
        self._evm = EVM(
            fork_url=None if self.strict else self.rpc.url,
            fork_block=None if self.strict else str(self.rpc.block),
            tracing=False, spec_id="CANCUN",
        )
        # pyrevm does not take the block env from anywhere, and zero is not a
        # harmless default: 3pool's `A()` ramps off `block.timestamp` and
        # underflows at zero, so every call would revert.
        self._evm.set_block_env(BlockEnv(
            number=int(header["number"], 16),
            timestamp=int(header["timestamp"], 16),
            basefee=int(header.get("baseFeePerGas", "0x0") or "0x0", 16),
            gas_limit=int(header["gasLimit"], 16),
            coinbase=header["miner"],
            prevrandao=bytes.fromhex((header.get("mixHash") or "0x" + "00" * 32)[2:]),
            excess_blob_gas=int(header.get("excessBlobGas", "0x0") or "0x0", 16),
        ))
        self._evm.set_balance(CALLER, 10 ** 24)
        # Discovering the node's batch ceiling by failing into it is fine when
        # chunks go out one at a time -- the first failure teaches the rest.
        # Concurrently it is not: every in-flight chunk fails together and the
        # halving retries collide.  So the ceiling is *asked for* once, up front
        # and sequentially, rather than assumed at a value every node accepts --
        # which is the slowest node's ceiling imposed on all of them, measured at
        # 62 round trips against 3 on one sweep.
        probe = getattr(self.rpc, "probe_batch_limit", None)
        if probe is not None:
            sample = ("eth_getStorageAt",
                      [CALLER, "0x" + "00" * 32, self.rpc.pin.hex_block])
            try:
                self.rpc.batch_size = max(probe(sample), BATCH_LIMIT)
            except Exception:  # a transport that will not say keeps the floor
                self.rpc.batch_size = BATCH_LIMIT
        else:
            limit = getattr(self.rpc, "batch_size", None)
            if isinstance(limit, int) and limit > BATCH_LIMIT:
                self.rpc.batch_size = BATCH_LIMIT
        streams = getattr(self.rpc, "max_streams", None)
        if streams == DEFAULT_STREAMS:  # untouched default: this workload wants more
            self.rpc.max_streams = PRIME_STREAMS

    # ------------------------------------------------------------- Transport

    #: Quotes execute in-process, so callers may spend them freely.
    local = True

    @property
    def block(self) -> int:
        return self.rpc.block

    @property
    def chain_id(self) -> int:
        return self.rpc.chain_id

    def call(self, to: str, data: bytes, *, overrides: dict | None = None) -> bytes:
        self._inject(overrides)
        raw = self._evm.message_call(caller=CALLER, to=to, calldata=bytes(data))
        return bytes(raw)

    def call_many(self, calls: list[Call], *, overrides: dict | None = None) -> list[Answer]:
        self._inject(overrides)
        out: list[Answer] = []
        for one in calls:
            try:
                raw = bytes(self._evm.message_call(
                    caller=CALLER, to=one.to, calldata=bytes(one.data)))
            except Exception as exc:  # revm raises on revert
                out.append(Answer(Status.REVERTED, message=str(exc)[:120]))
                continue
            out.append(Answer(Status.VALUE if raw else Status.WRONG_ABI, raw))
        return out

    def _inject(self, overrides: dict | None) -> None:
        """Honour an `eth_call` code override by inserting the code locally."""
        if not overrides:
            return
        from pyrevm import AccountInfo

        for address, entry in overrides.items():
            code = entry.get("code") if isinstance(entry, dict) else None
            if not code or address in self._injected:
                continue
            raw = bytes.fromhex(code[2:] if code.startswith("0x") else code)
            self._evm.insert_account_info(address, AccountInfo(nonce=0, code=raw))
            self._evm.set_balance(address, 0)
            self._injected.add(address)

    # ----------------------------------------------------------------- warm

    def prime(self, pools=()) -> WarmStats:
        """Load everything the disk cache already knows, then read values.

        No access lists and no `eth_getCode` for a pool already in the cache --
        its layout and its bytecode are properties of code that does not change.
        What is left is the storage sweep, which is per-block and irreducible,
        plus the balances of the few accounts that hold any.  Returns without
        touching the network for any pool it does not know; `warm` discovers
        those.
        """
        import time as _t

        if self.cache is None:
            return self.stats
        started = _t.perf_counter()
        block = self.rpc.pin.hex_block
        wanted = self.cache.slots()
        if pools:
            reachable = self.cache.unknown(pools)
            self.stats.errors.extend(f"uncached pool {p[:10]}" for p in reachable[:3])
        for address in wanted:
            if address in self._loaded:
                continue
            blob = self.cache.bytecode(address)
            from pyrevm import AccountInfo

            self._evm.insert_account_info(address, AccountInfo(nonce=1, code=blob))
            self._loaded.add(address)
        self._read_values(wanted, block, funded=self.cache.funded)
        self.stats.ms += (_t.perf_counter() - started) * 1000
        self.stats.accounts = len(self._loaded)
        return self.stats

    def _read_values(self, wanted: dict, block: str, funded=None) -> None:
        """The only genuinely per-block traffic: slot values, and live balances."""
        import time as _t

        flat = [(a, slot) for a, slots in wanted.items() for slot in sorted(slots)]
        if flat:
            _mark = _t.perf_counter()
            values = self._dump(wanted, flat) if (self.prefer_dump and self.quoter) else None
            if values is None:
                values = self._batched(
                    [("eth_getStorageAt", [a, f"0x{slot:064x}", block]) for a, slot in flat])
                values = [None if isinstance(v, Exception) or not isinstance(v, str)
                          else int(v, 16) for v in values]
            self.stats.storage_ms += (_t.perf_counter() - _mark) * 1000
            self.stats.fetch_calls += len(values)
            # A slot that did not come back is not a slot we can skip.  py-evm
            # reads an uninserted slot as zero, and a zero fee, rate or balance
            # is a *plausible* number: the quote succeeds and is wrong, the arc
            # is mis-calibrated or silently dropped, and the route changes with
            # no error anywhere.  Retry once -- a dropped batch is usually
            # transient -- and count whatever is still missing so `complete` can
            # refuse the EVM.
            missing = [k for k, value in enumerate(values) if value is None]
            if missing:
                self.stats.retried += len(missing)
                again = self._batched(
                    [("eth_getStorageAt", [flat[k][0], f"0x{flat[k][1]:064x}", block])
                     for k in missing])
                for k, value in zip(missing, again, strict=True):
                    if isinstance(value, str):
                        with contextlib.suppress(ValueError):
                            values[k] = int(value, 16)
            for (address, slot), value in zip(flat, values, strict=True):
                if value is None:
                    self.stats.errors.append(f"slot {address[:10]}:{slot} unreadable")
                    self.stats.unreadable += 1
                    continue
                self._evm.insert_account_storage(address, slot, value)
                self._slots.setdefault(address, set()).add(slot)
                self.stats.slots += 1
        # Balances only where there is one to have.  Most pools hold no native
        # ETH at all, and the cache remembers which do -- but the ETH/stETH pool
        # does, and a zero there makes `get_dy` answer zero (E11).
        holders = sorted(set(funded or ()) & set(wanted)) if funded is not None else list(wanted)
        if holders:
            _mark = _t.perf_counter()
            got = self._batched([("eth_getBalance", [a, block]) for a in holders])
            self.stats.code_ms += (_t.perf_counter() - _mark) * 1000
            for address, balance in zip(holders, got, strict=True):
                if isinstance(balance, str) and balance:
                    self._evm.set_balance(address, int(balance, 16))
                else:
                    # `holders` is exactly the set the cache knows holds ETH, so
                    # a failed read here is a zero balance on a pool that has one
                    # -- and ETH/stETH answers `get_dy` with zero then (E11).
                    self.stats.errors.append(f"balance {address[:10]} unreadable")
                    self.stats.unreadable += 1

    def list_state(self, calls: list[Call]) -> dict[str, set[int]]:
        """`account -> slots` these calls read, without loading anything.

        The same access lists `warm` uses, kept rather than consumed, so a caller
        can record what was needed and check later whether it still has it.
        Account presence is not that check -- most of these accounts are already
        cached for other reasons, and the slots are what differ.
        """
        block = self.rpc.pin.hex_block
        extra = self._access_list_shape(calls[0] if calls else None)
        payloads = [
            ("eth_createAccessList",
             [{"from": CALLER, "to": one.to, "data": "0x" + bytes(one.data).hex(),
               **extra}, block])
            for one in calls
        ]
        needs: dict[str, set[int]] = {}
        for answer in self._batched(payloads):
            if _access_list_failed(answer):
                continue
            for entry in (answer or {}).get("accessList") or []:
                needs.setdefault(entry["address"].lower(), set()).update(
                    int(k, 16) for k in entry.get("storageKeys") or ())
        return needs

    def warm(self, calls: list[Call]) -> WarmStats:
        """Load every account and slot these calls touch.

        `eth_createAccessList` names the slots and `eth_getStorageAt` reads their
        values, because neither computes anything the caller discards.
        `prestateTracer` returns the same state in one message but re-executes
        the call under a tracer to do it -- tens of seconds over a 600-probe
        batch -- so it is the fallback, for nodes that serve `debug_*` but not
        `eth_createAccessList`.  Calls already seen are skipped.
        """
        import time as _time

        started = _time.perf_counter()
        if not self.strict:
            return self.stats  # every insert would cost a fork read; see above
        fresh = [c for c in calls if (c.to.lower(), bytes(c.data)) not in self._listed]
        if not fresh:
            return self.stats
        for one in fresh:
            self._listed.add((one.to.lower(), bytes(one.data)))

        if not self._warm_by_proof(fresh) and self._tracing is not False:
            # No access list came back at all -- the node may serve `debug_*`
            # instead.  This must not key off "did we load a new account": an
            # incremental warm legitimately adds only slots.
            self._warm_by_trace(fresh)
        self.stats.ms += (_time.perf_counter() - started) * 1000
        self.stats.accounts = len(self._loaded)
        return self.stats

    def _batched(self, payloads: list[tuple[str, list]]) -> list:
        """`fetch_multi`, split to the node's batch ceiling.

        Erigon rejects the *whole* batch over its limit rather than truncating,
        so an unsplit route's worth of requests returns nothing at all.
        """
        if not payloads:
            return []
        # Against the size actually in use, not the floor: the ceiling is
        # negotiated now, so counting in BATCH_LIMIT-sized chunks reported 62
        # round trips for a sweep that made 3.
        size = max(1, int(getattr(self.rpc, "batch_size", BATCH_LIMIT) or BATCH_LIMIT))
        self.stats.round_trips += max(1, (len(payloads) + size - 1) // size)
        try:
            return self.rpc.fetch_multi(payloads, concurrent=True)
        except TypeError:  # a transport that predates the keyword
            out: list = []
            for lo in range(0, len(payloads), BATCH_LIMIT):
                out.extend(self.rpc.fetch_multi(payloads[lo:lo + BATCH_LIMIT]))
            return out

    #: Request shapes for `eth_createAccessList`, cheapest first.  No single one
    #: works everywhere, which is only discoverable by asking:
    #:
    #:     chain     as-is   +gas   +gas +gasPrice 0
    #:     ethereum  ok      ok     ok
    #:     arbitrum  ok      ok     "gasPrice must be non-zero"
    #:     polygon   ok      ok     "gasPrice must be non-zero"
    #:     sonic     "insufficient funds"  "failed to apply"  ok
    #:
    #: Sonic prices the simulation against the sender's balance, so it refuses a
    #: cap it cannot pay for; arbitrum and polygon reject a zero price outright.
    #: Hence: try them in order once per endpoint and remember which answered.
    #:
    #: The 50M rung is last because only a *heavy call* needs it, not a fussy
    #: endpoint.  It sits at the end so no chain's resolution order changes; the
    #: retry ladder is what reaches it.
    ACCESS_LIST_SHAPES = (
        {},
        {"gas": "0x1e8480"},                      # 2M, small enough to afford
        {"gas": "0x1e8480", "gasPrice": "0x0"},
        {"gasPrice": "0x0"},
        {"gas": "0x2faf080"},                     # 50M, for a leg 2M cannot run
    )

    def _access_list_shape(self, sample: Call | None = None) -> dict:
        """The first shape this endpoint accepts, resolved once per session.

        Probed with a *real* call rather than a synthetic one: fraxtal accepts
        the bare request for a transfer to an empty account and then fails the
        same request against a contract, so a trivial probe picks a shape that
        does not work.
        """
        if self._al_shape is not None:
            return self._al_shape
        probe = {"from": CALLER, "to": CALLER, "data": "0x"}
        if sample is not None:
            probe = {"from": CALLER, "to": sample.to,
                     "data": "0x" + bytes(sample.data).hex()}
        block = self.rpc.pin.hex_block
        for shape in self.ACCESS_LIST_SHAPES:
            try:
                got = self.rpc.fetch("eth_createAccessList", [{**probe, **shape}, block])
            except Exception:
                continue
            if isinstance(got, dict) and "accessList" in got:
                self._al_shape = shape
                return shape
        # Nothing worked: keep the plain shape so the caller sees the real
        # error and falls back to the tracer, rather than failing silently.
        self._al_shape = {}
        return self._al_shape

    def _warm_by_trace(self, calls: list[Call]) -> bool:
        """prestateTracer: state values straight back, no second fetch."""
        block = self.rpc.pin.hex_block
        payloads = [
            ("debug_traceCall",
             [{"from": CALLER, "to": one.to, "data": "0x" + bytes(one.data).hex()},
              block, {"tracer": "prestateTracer"}])
            for one in calls
        ]
        answers = self._batched(payloads)
        self.stats.list_calls += len(payloads)
        good = 0
        for answer in answers:
            if isinstance(answer, Exception) or not isinstance(answer, dict):
                self.stats.errors.append(f"traceCall: {str(answer)[:100]}")
                continue
            good += 1
            self._install_prestate(answer)
        if not good:
            self._tracing = False
            return False
        self._tracing = True
        return True

    def _install_prestate(self, state: dict) -> None:
        """Load traced state into the EVM **and** into the disk cache.

        The cache writes matter as much as the EVM ones, and only the access-list
        path used to do them: state arriving by tracer landed in this process and
        nowhere else, so a warm on a chain that cannot serve access lists ran to
        completion, reported success, and wrote an empty file -- worse than
        failing, because the next run finds a cache and believes it.
        """
        from pyrevm import AccountInfo

        touched: dict[str, set[int]] = {}
        for raw_address, entry in state.items():
            address = raw_address.lower()
            if not isinstance(entry, dict):
                continue
            if address not in self._loaded:
                code = entry.get("code") or ""
                blob = bytes.fromhex(code[2:]) if code.startswith("0x") else b""
                self._evm.insert_account_info(
                    address, AccountInfo(nonce=int(entry.get("nonce", 0) or 0),
                                         code=blob or None))
                self._evm.set_balance(address, int(entry.get("balance", "0x0") or "0x0", 16))
                self._loaded.add(address)
                if self.cache is not None and blob:
                    self.cache.learn_code(address, blob)
            for key, value in (entry.get("storage") or {}).items():
                self._evm.insert_account_storage(address, int(key, 16), int(value, 16))
                self._slots.setdefault(address, set()).add(int(key, 16))
                touched.setdefault(address, set()).add(int(key, 16))
                self.stats.slots += 1
        self._last_listed = {a: set(v) for a, v in touched.items()}
        if self.cache is not None and touched:
            self.cache.learn_slots(touched)

    def _warm_by_proof(self, calls: list[Call]) -> bool:
        """accessList names the slots; getStorageAt fetches their values.

        Not `eth_getProof`: it returns many slots per account in one reply, which
        looks like the efficient choice and is not -- it computes a Merkle proof
        per account that this caller immediately discards, and the gap widens
        with account count, because proofs are per-account while storage reads
        batch.

        `eth_getCode` is the real cost here, because it ships whole contracts.
        Code is immutable, so it is fetched once per address per process.
        """
        block = self.rpc.pin.hex_block
        extra = self._access_list_shape(calls[0] if calls else None)
        payloads = [
            ("eth_createAccessList",
             [{"from": CALLER, "to": one.to, "data": "0x" + bytes(one.data).hex(),
               **extra}, block])
            for one in calls
        ]
        import time as _t
        _mark = _t.perf_counter()
        listed = self._batched(payloads)
        self.stats.list_ms += (_t.perf_counter() - _mark) * 1000
        touched: dict[str, set[int]] = {}
        served = False
        pending = list(zip(calls, listed, strict=True))
        # Retry what failed under the next shape, rather than dropping it: a
        # fixed shape per endpoint is not enough, because `lb.drpc.live` is a
        # load balancer and two requests a second apart can land on backends that
        # disagree about whether a zero gas price or a large cap is acceptable.
        # A failure here is not a warning -- it is slots the local EVM will read
        # as zero, which is a wrong quote rather than a missing one.
        #
        # What the *resolved* shape said, kept so a call that no shape can serve
        # is reported by the reason that shape gave.  The retries below walk
        # shapes this endpoint may reject wholesale, so the last attempt's error
        # is the ladder talking about itself, not a fact about the call.
        first: dict[int, object] = {
            k: answer for k, answer in enumerate(listed)
            if _access_list_failed(answer)
        }
        index = {id(one): k for k, one in enumerate(calls)}
        for shape in self.ACCESS_LIST_SHAPES[1:]:
            failed = [one for one, answer in pending if _access_list_failed(answer)]
            ok = [pair for pair in pending if not _access_list_failed(pair[1])]
            if not failed:
                break
            retry = self._batched([
                ("eth_createAccessList",
                 [{"from": CALLER, "to": one.to,
                   "data": "0x" + bytes(one.data).hex(), **shape}, block])
                for one in failed
            ])
            self.stats.list_calls += len(failed)
            self.stats.retried += len(failed)
            pending = ok + list(zip(failed, retry, strict=True))

        for one, answer in pending:
            if _access_list_failed(answer):
                original = first.get(index.get(id(one), -1), answer)
                self.stats.errors.append(
                    f"accessList: {_access_list_error(original)[:100]}")
                if isinstance(answer, Exception):
                    # A transport failure, not a reverting probe -- every shape
                    # above has already been tried, so this is the node refusing
                    # rather than the call failing.  The slots it would have
                    # named are slots the EVM now reads as zero, so it counts
                    # against `complete` exactly as an unreadable slot does.
                    #
                    # A revert is *not* counted: it arrives as a result with an
                    # error inside it, never as an exception, and a probe that
                    # reverts past what the pool holds is a real answer.
                    self.stats.unreadable += 1
                continue
            # Only a call that was actually simulated registers its target.
            # Doing this for failed calls too loaded the pool's code with an
            # empty slot set, which the EVM then reads as a pool holding zero.
            touched.setdefault(one.to.lower(), set())
            served = True
            for entry in answer.get("accessList") or []:
                # `storageKeys` may be **null**, not an empty list.  It is a
                # valid reply -- an account touched for its code or balance names
                # no slots -- and some backends spell that as `null` while others
                # send `[]`.  Iterating it killed the whole warm and read as a
                # transport failure.
                touched.setdefault(entry["address"].lower(), set()).update(
                    int(k, 16) for k in entry.get("storageKeys") or ())
        self.stats.list_calls += len(payloads)
        self._last_listed = {a: set(v) for a, v in touched.items()}
        if not served:
            return False

        # Only what is not already resident.  Without this an incremental warm
        # re-reads every slot of every account it has ever seen, which on five
        # successive quotes was 7,846 reads instead of a few hundred.
        if self.cache is not None:
            self.cache.learn_slots(touched)
        wanted = {}
        for address, keys in touched.items():
            fresh_keys = keys - self._slots.get(address, set())
            if fresh_keys or address not in self._loaded:
                wanted[address] = fresh_keys
        if not wanted:
            return True

        from pyrevm import AccountInfo

        cold = [a for a in wanted if a not in self._loaded]
        # Code only for what the disk cache cannot supply: `eth_getCode` ships
        # whole contracts and was 6,265 ms for 198 accounts, and code does not
        # change, so a committed cache removes this entirely on a warm repo.
        needs_code = [a for a in cold
                      if self.cache is None or self.cache.bytecode(a) is None]
        blobs: dict[str, bytes] = {}
        if needs_code:
            _mark = _t.perf_counter()
            answers = self._batched([("eth_getCode", [a, block]) for a in needs_code])
            self.stats.code_ms += (_t.perf_counter() - _mark) * 1000
            self.stats.fetch_calls += len(answers)
            for address, code in zip(needs_code, answers, strict=True):
                blob = b"" if isinstance(code, Exception) or not code \
                    else bytes.fromhex(code[2:])
                blobs[address] = blob
                if self.cache is not None and blob:
                    self.cache.learn_code(address, blob)
        for address in cold:
            blob = blobs.get(address)
            if blob is None and self.cache is not None:
                blob = self.cache.bytecode(address)
            self._evm.insert_account_info(address, AccountInfo(nonce=1, code=blob or None))
            self._loaded.add(address)

        self._read_values(wanted, block)
        if self.cache is not None:
            for address in cold:
                self.cache.learn_funded(address, self._evm.get_balance(address))
        return True



    def last_arc_needs(self) -> dict[str, set[int]]:
        """What the last arc warm read, excluding the pools' own storage.

        The pools are covered by `prime`, which refreshes every slot it knows.
        What it cannot know to ask for is what an arc reaches *through* -- a
        lending pool's cToken, a vault pool's vault, an oracle a pool consults
        -- and those are the accounts worth being able to check.
        """
        return {a: set(v) for a, v in (self._last_listed or {}).items()
                if a not in self._arc_targets and v}

    def warm_arcs(self, refs, quoter: str, grid=None, per_call: int = 200) -> WarmStats:
        """Discover state for specific arcs -- the ones the cache has not seen.

        A new pool costs an access list over a probe batch covering only its own
        arcs, so keeping up with a moving universe is proportional to what moved.
        The batch is the same shape the router itself sends, which is what makes
        one list cover every size that arc will ever be quoted at.

        **Without a deployed quoter, that shape is useless.**  The batch is a
        call to the quoter's address, and where the quoter is not deployed it
        rides along as an `eth_call` state override, which `eth_createAccessList`
        has no way to accept: the request executes against an address with no
        code and the cache learns nothing.

        So where there is no quoter, ask the pools directly.  One `get_dy` per
        arc rather than a batch -- more requests, exactly the same state, since
        the pool's own storage is what the quoter would have touched anyway.
        """
        from ..core.codec import encode_call
        from ..core.probe import COARSE_GRID, plan_grid
        from ..core.quoter import SIG_PROBE_BATCH

        plan = plan_grid(list(refs), grid or COARSE_GRID)
        self._arc_targets = {p.pool.lower() for p in plan.probes}
        if quoter:
            calls = [
                Call(quoter, encode_call(
                    SIG_PROBE_BATCH,
                    [p.as_tuple() for p in plan.probes[lo:lo + per_call]]))
                for lo in range(0, len(plan.probes), per_call)
            ]
        else:
            seen: set[str] = set()
            calls = []
            for probe in plan.probes:
                sig = DIRECT_SIGS.get(ArcKind(probe.kind))
                if sig is None:
                    continue  # deposits and withdrawals are not get_dy
                key = f"{probe.pool.lower()}:{probe.i}>{probe.j}"
                if key in seen:
                    continue  # one size per arc is enough; the list is the same
                seen.add(key)
                calls.append(Call(probe.pool,
                                  encode_call(sig, probe.i, probe.j, probe.dx)))
        return self.warm(calls) if calls else self.stats

    def _dump(self, wanted: dict, flat) -> list[int | None] | None:
        """Read every slot by becoming the account that owns it.

        Chunks carry only the overrides they use: hundreds of code overrides in
        one request is silently dropped by the node (`MISSING`, not an error),
        and the sweep comes back short with nothing to say so.

        The coordinator is never overridden.  The quoter's own address is in the
        state cache, and giving *it* the dumper makes the request execute the
        dumper instead of `raw_batch`, which loses the whole chunk.
        """
        from concurrent.futures import ThreadPoolExecutor

        from ..core.codec import decode, encode_call
        from ..core.quoter import SIG_RAW_BATCH

        quoter = self.quoter.lower()
        groups: list[list[str]] = []
        current: list[str] = []
        held = 0
        for address, slots in wanted.items():
            if address.lower() == quoter or not slots:
                continue
            if held and held + len(slots) > DUMP_CHUNK:
                groups.append(current)
                current, held = [], 0
            current.append(address)
            held += len(slots)
        if current:
            groups.append(current)
        if not groups:
            return None

        code = "0x" + DUMPER.hex()
        jobs = []
        for group in groups:
            pairs = [(a, slot) for a in group for slot in sorted(wanted[a])]
            jobs.append((
                encode_call(SIG_RAW_BATCH, [a for a, _ in pairs],
                            [slot.to_bytes(32, "big") for _, slot in pairs]),
                {a: {"code": code} for a in group},
                pairs,
            ))

        found: dict[tuple[str, int], int] = {}

        def run(job) -> bool:
            data, overrides, pairs = job
            try:
                raw = self.rpc.call(self.quoter, data, overrides=overrides)
                answers = decode(["(uint8,uint256)[]"], raw)[0]
            except Exception as exc:
                self.stats.errors.append(f"dump: {str(exc)[:80]}")
                return False
            if len(answers) != len(pairs):
                return False
            for (address, slot), (status, value) in zip(pairs, answers, strict=True):
                if status == 0:
                    found[(address, slot)] = int(value)
            return True

        workers = min(len(jobs), max(1, getattr(self.rpc, "max_streams", 8)))
        self.stats.round_trips += len(jobs)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            if not all(list(pool.map(run, jobs))):
                return None
        # Anything the dumper could not reach falls back rather than reading 0.
        return [found.get((a, slot)) for a, slot in flat]

    def refresh_arcs(self, refs, quoter: str, grid=None) -> int:
        """Re-list these arcs and load any slots the cache did not have.

        `prime` refreshes every slot *value* and `cache.unknown` finds every new
        *pool*, but neither sees a pool that has started reading a slot it was
        not reading before -- a Chainlink aggregator that advanced a round, a
        LLAMMA whose active band moved.  The pool is not unknown; its behaviour
        changed, and the new slots read as zero.

        Returns how many slots were new, so a caller can say when it mattered.
        """
        before = sum(len(v) for v in self._slots.values())
        self.warm_arcs(refs, quoter, grid=grid)
        return sum(len(v) for v in self._slots.values()) - before

    # --------------------------------------------------------------- checks

    def verify_against(self, node, calls: list[Call]) -> list[tuple[Call, int, int]]:
        """Every call, both ways.  Returns the disagreements.

        The prefetch is the one part of this that can be silently incomplete,
        so it gets an explicit check rather than a comment saying it is fine.
        """
        bad: list[tuple[Call, int, int]] = []
        for one in calls:
            try:
                mine = int.from_bytes(self.call(one.to, one.data)[:32], "big")
            except Exception:
                mine = -1
            try:
                theirs = int.from_bytes(node.call(one.to, one.data)[:32], "big")
            except Exception:
                theirs = -1
            if mine != theirs:
                bad.append((one, mine, theirs))
        return bad


@dataclass(slots=True)
class Recorder:
    """A `Transport` that passes through and remembers what was asked.

    The access list has to be built from the calls that will actually be made,
    and those are quoter batches, not bare `get_dy` -- so rather than re-deriving
    the contract's dispatch in Python, run once against the node and record.
    """

    inner: object
    calls: list[Call] = field(default_factory=list)
    seen: set[tuple[str, bytes]] = field(default_factory=set)

    @property
    def block(self) -> int:
        return self.inner.block

    @property
    def chain_id(self) -> int:
        return self.inner.chain_id

    def _note(self, to: str, data: bytes) -> None:
        key = (to.lower(), bytes(data))
        if key not in self.seen:
            self.seen.add(key)
            self.calls.append(Call(to, bytes(data)))

    def call(self, to: str, data: bytes, *, overrides: dict | None = None) -> bytes:
        self._note(to, data)
        return self.inner.call(to, data, overrides=overrides)

    def call_many(self, calls: list[Call], *, overrides: dict | None = None) -> list[Answer]:
        for one in calls:
            self._note(one.to, one.data)
        return self.inner.call_many(calls, overrides=overrides)

    def call_batch(self, requests, *, to: str, overrides: dict | None = None):
        # `run_batch` looks this up by name, so without it here `__getattr__`
        # hands over the inner transport's and every probe batch -- which is
        # most of what the router asks -- goes unrecorded.
        for data in requests:
            self._note(to, data)
        inner = getattr(self.inner, "call_batch", None)
        if inner is not None:
            return inner(requests, to=to, overrides=overrides)
        out = []
        for data in requests:
            try:
                out.append(self.inner.call(to, data, overrides=overrides))
            except Exception:
                out.append(None)
        return out

    def __getattr__(self, name):
        return getattr(self.inner, name)
