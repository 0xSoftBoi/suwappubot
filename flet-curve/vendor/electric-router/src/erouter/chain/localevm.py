"""A `Transport` that executes locally, against state fetched once.

The same idea as `dev/local_evm.py` -- sweep the universe's storage once and a
`get_dy` costs microseconds instead of a round trip, which is what makes
probing a thousand arcs and gating every exact model affordable -- written so
the identical code answers in CPython and in a browser.  Two differences, and
both are why this exists rather than being an import:

**No RPC inside.**  That one owns a `JsonRpcTransport` and fetches as it goes,
which cannot be done from a `Transport.call` that has to return synchronously
in an event loop.  Here the fetching is the caller's, through `fill`, which is
`async` and sits outside the calls it repairs.

**Misses rather than access lists.**  `eth_createAccessList` says up front
which slots a call will touch; the scoped drpc key does not serve it, and a
browser has no second endpoint to fall back to.  So the discovery runs the
other way round: make the call, ask the EVM what it read and could not find,
fetch exactly that, and make the call again.  An unknown *account* takes two
rounds by construction -- its slots only become visible once its code is there
to read them -- which is why `fill` loops rather than doing one pass.

The hazard both designs share is that **a missed slot reads as zero, not as an
error**, and a zero fee, rate or balance is a plausible number: the quote
succeeds and is wrong.  `WarmStats.unreadable` is what refuses to route on one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.evm import CALLER, CALLER_BALANCE
from ..core.transport import Answer, Call, Status

#: Erigon refuses a JSON-RPC batch larger than this by default, and refuses the
#: *whole* batch -- so a sweep has to be split or none of it arrives.
BATCH_LIMIT = 100

#: Gas for one `eth_call`.  Far above EIP-7825's 16.7M transaction cap on
#: purpose: a probe batch is several hundred sub-calls inside one call, which
#: is not a transaction and which a node answers.
CALL_GAS = 1_000_000_000

#: How many times `fill` will fetch-and-retry before giving up.  Two rounds are
#: structural (account, then its slots); more cover a slot read *through* a
#: contract discovered in an earlier round, which nests as deep as the calls
#: do.  It rarely runs out -- the loop normally stops because a round asked for
#: nothing new -- and this is the backstop, not the mechanism.
#:
#: Twelve was not a backstop, though: executing a sixteen-leg route locally
#: needs twenty-four, because a reverting call reports only the layer it got
#: to and each round buys exactly one more.  At twelve it gave up mid-route
#: and reported a Maker slot as unreadable that the endpoint answers happily.
FILL_ROUNDS = 64


@dataclass(slots=True)
class WarmStats:
    accounts: int = 0
    slots: int = 0
    fetched: int = 0
    rounds: int = 0
    unreadable: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        """Whether every read was answered from state that was really read.

        Not "did the warm finish".  An unreadable slot leaves a zero the EVM
        will quote against quite happily.
        """
        return self.unreadable == 0


class LocalEvm:
    """Read-only chain access at a pinned block, executed in-process."""

    #: Quotes execute here, so callers may spend thousands of them -- this is
    #: how `QuoterClient.local` asks without importing anything about revm.
    local = True

    def __init__(self, backend, chain_id: int, block: int, *, quoter: str = "",
                 gas: int = CALL_GAS) -> None:
        self._evm = backend
        self._chain_id = int(chain_id)
        self._block = int(block)
        self._quoter = quoter.lower()
        self._gas = gas
        self._injected: set[str] = set()
        self.stats = WarmStats()
        # The caller has to exist before anything asks about it, or every call
        # reports it as a missing account and the loop fetches an empty one.
        backend.set_balance(CALLER, CALLER_BALANCE)

    # ------------------------------------------------------------- Transport

    @property
    def block(self) -> int:
        return self._block

    @property
    def chain_id(self) -> int:
        return self._chain_id

    def repin(self, block: int) -> None:
        """Point at a newer block.  The caller re-reads the state to match;
        this is only what the transport reports as its pin, which everything
        downstream compares against to decide whether a preparation is stale."""
        self._block = int(block)

    def call(self, to: str, data: bytes, *, overrides: dict | None = None) -> bytes:
        self._inject(overrides)
        got = self._evm.call(CALLER, to, bytes(data), "0x0", self._gas)
        if not got["success"]:
            raise LocalEvmError(got["revert_reason"] or got["halt_reason"] or "reverted")
        return got["output"]

    def call_many(self, calls: list[Call], *, overrides: dict | None = None) -> list[Answer]:
        self._inject(overrides)
        if not calls:
            return []
        answers = self._evm.call_many(
            CALLER, [(one.to, bytes(one.data)) for one in calls], self._gas)
        out: list[Answer] = []
        for got in answers:
            if not got["success"]:
                reason = got["revert_reason"] or got["halt_reason"] or ""
                out.append(Answer(Status.REVERTED, message=str(reason)[:120]))
                continue
            raw = got["output"]
            # Empty returndata is not a value: a Curve pool that does not
            # implement a function returns `0x` rather than reverting, and
            # `decode_uint("0x") == 0` would quote it at zero.
            out.append(Answer(Status.VALUE if raw else Status.WRONG_ABI, raw))
        return out

    def _inject(self, overrides: dict | None) -> None:
        """Honour an `eth_call` code override by inserting the code locally."""
        if not overrides:
            return
        for address, entry in overrides.items():
            code = entry.get("code") if isinstance(entry, dict) else None
            key = address.lower()
            if not code or key in self._injected:
                continue
            blob = code[2:] if code.startswith("0x") else code
            self._evm.insert_account(address, nonce=0, code=bytes.fromhex(blob))
            self._injected.add(key)

    # ------------------------------------------------------------------ warm

    def install(self, cache) -> int:
        """Insert every account the slot cache knows, with its code.

        Storage is *not* loaded here -- it is per block and comes from `sweep`.
        Returns how many accounts were installed.
        """
        installed = 0
        for address in cache.slots():
            blob = cache.bytecode(address)
            self._evm.insert_account(address, nonce=1, code=blob)
            installed += 1
        self.stats.accounts = installed
        return installed

    def apply_storage(self, values) -> int:
        """`(address, slot, value)` triples.  Returns how many landed.

        Slots and values are normalised here because they arrive from three
        places that spell them differently -- the committed cache holds
        integers, `misses()` reports hex, and a node answers with a padded
        word -- and the backend takes one spelling.
        """
        rows = [(address, _hex(slot), _hex(value)) for address, slot, value in values]
        if rows:
            self._evm.insert_storage_many(rows)
        self.stats.slots += len(rows)
        return len(rows)

    def apply_balances(self, balances) -> int:
        """`(address, wei)` pairs.  Most pools hold no native ETH; the ones
        that do answer `get_dy` with zero without it."""
        count = 0
        for address, value in balances:
            self._evm.set_balance(address, value)
            count += 1
        return count

    def misses(self) -> dict:
        return self._evm.take_misses()

    def forget_misses(self) -> None:
        self._evm.take_misses()

    async def fill(self, rpc, run, *, block: str = "latest",
                   code_for=None, rounds: int = FILL_ROUNDS):
        """Run `run()`, fetch whatever it could not read, and run it again.

        `run` is a plain callable that drives this transport; it is called once
        per round and its last return value is handed back.  Anything still
        missing after `rounds` is counted in `stats.unreadable`, which is what
        stops a quote going out against zeros.

        `code_for` is consulted before the wire for an account's bytecode -- the
        committed cache has most of it, and a `eth_getCode` for a pool whose
        code cannot change is a round trip for a constant.
        """
        result = None
        missed: dict = {}
        asked_before: frozenset | None = None
        self.forget_misses()
        for _ in range(rounds):
            self.stats.rounds += 1
            result = run()
            missed = self.misses()
            asking = _asked(missed)
            if not asking:
                return result
            # Only a miss that survives having been fetched is unreadable.  A
            # slot touched for the first time in the last round has simply not
            # been asked for yet, and counting it would call a good warm
            # incomplete -- which is the difference between quoting and
            # refusing to.  So the loop stops on *no progress*, not on a
            # round count.
            if asking == asked_before:
                break
            asked_before = asking
            await self._fetch(rpc, missed, block=block, code_for=code_for)
        short = len(missed["accounts"]) + len(missed["slots"])
        if short:
            self.stats.unreadable += short
            for address in missed["accounts"][:3]:
                self.stats.errors.append(f"account {address[:10]} unreadable")
            for address, slot in missed["slots"][:3]:
                self.stats.errors.append(f"slot {address[:10]}:{slot} unreadable")
        return result

    async def _fetch(self, rpc, missed: dict, *, block: str, code_for=None) -> None:
        """One round of repair: code and balances for accounts, values for slots."""
        wanted_code = []
        for address in missed["accounts"]:
            blob = code_for(address) if code_for is not None else None
            if blob is None:
                wanted_code.append(address)
            else:
                self._evm.insert_account(address, nonce=1, code=blob)
        if wanted_code:
            got = await self._batched(
                rpc, [("eth_getCode", [a, block]) for a in wanted_code])
            balances = await self._batched(
                rpc, [("eth_getBalance", [a, block]) for a in wanted_code])
            for address, code, balance in zip(wanted_code, got, balances, strict=True):
                blob = b"" if not isinstance(code, str) else bytes.fromhex(code[2:])
                self._evm.insert_account(
                    address, nonce=1,
                    balance=balance if isinstance(balance, str) else "0x0",
                    code=blob or None,
                )
                self.stats.fetched += 1
        if missed["slots"]:
            payloads = [("eth_getStorageAt", [a, _slot(s), block])
                        for a, s in missed["slots"]]
            values = await self._batched(rpc, payloads)
            rows = []
            for (address, slot), value in zip(missed["slots"], values, strict=True):
                # A slot that did not come back is left absent on purpose: it
                # will be reported again next round rather than cached as a
                # zero this code cannot tell from a real one.
                if isinstance(value, str):
                    rows.append((address, slot, value))
            self.apply_storage(rows)
            self.stats.fetched += len(rows)
        for number in missed["blocks"]:
            header = await rpc.call("eth_getBlockByNumber", [hex(int(number)), False])
            if isinstance(header, dict) and header.get("hash"):
                self._evm.insert_block_hash(int(number), header["hash"])

    @staticmethod
    async def _batched(rpc, payloads: list[tuple[str, list]]) -> list:
        out: list = []
        for start in range(0, len(payloads), BATCH_LIMIT):
            out.extend(await rpc.batch(payloads[start:start + BATCH_LIMIT]))
        return out


def _asked(missed: dict) -> frozenset:
    """What a round wants, as something two rounds can be compared by."""
    return frozenset(
        [("a", a) for a in missed["accounts"]]
        + [("s", a, s) for a, s in missed["slots"]]
        + [("b", n) for n in missed["blocks"]]
    )


class LocalEvmError(RuntimeError):
    """A call that reverted, or halted, inside the local EVM."""


def _slot(slot) -> str:
    """A slot as the 32-byte hex `eth_getStorageAt` wants."""
    return f"0x{_int(slot):064x}"


def _hex(value) -> str:
    return value if isinstance(value, str) else f"0x{int(value):x}"


def _int(value) -> int:
    return int(value, 16) if isinstance(value, str) else int(value)
