"""Execution gas, measured by executing it.

`core/gas.py` prices every swap at a flat 102,000 borrowed from curve_solver.
That cannot be right for every pool, and quote gas is no help: `get_dy` is a view
call that pays for none of the transfers or storage writes the real `exchange`
pays for.  So the only honest source is an execution, and revm gives us one for
free -- the state is already local and pinned, `snapshot`/`revert` isolate each
attempt, and a caller can be funded by writing the token's own balance slot.

Two properties of the measurement, both load-bearing for how it is used:

- **It is cold.**  Each leg runs alone in a fresh snapshot, so every account it
  touches is a first touch.  A later leg in a real route inherits warm accounts
  and costs less, which makes a sum over legs an upper bound (see `GasTable`).
- **It is size-dependent, and not smoothly.**  A crypto pool may rebalance inside
  `exchange` -- tens of thousands of gas that appear only at some sizes -- which
  is why this is driven from realised legs rather than a synthetic ladder.

Funding needs the token's balance and allowance slots, which are not discoverable
from an ABI.  They are found by writing a candidate slot and asking the token
whether it agrees, over both mapping layouts -- Solidity hashes `key ‖ slot`,
Vyper hashes `slot ‖ key`, and the universe holds plenty of both.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field

from ..core.keccak import keccak256
from ..core.types import ArcKind

#: Funded fresh for every measurement; never an address that holds anything.
CALLER = "0x1234567890AbcdEF1234567890aBcdef12345678"

_BALANCE_OF = keccak256(b"balanceOf(address)")[:4]
_ALLOWANCE = keccak256(b"allowance(address,address)")[:4]
#: How far up the storage layout to look before giving up on a token.  Both
#: mappings must be found, and Compound puts allowances one slot after
#: balances: cDAI is 14 and 15, cUSDC is 15 and 16, so at 16 cUSDC missed by a
#: single slot and its redemption read as untestable.
SLOTS_SEARCHED = 32

SOLIDITY, VYPER = "solidity", "vyper"


def _pad(value) -> bytes:
    if isinstance(value, str):
        return bytes(12) + bytes.fromhex(value[2:].rjust(40, "0"))
    if value < 0:  # int128 indices arrive as Python ints; two's complement
        value += 1 << 256
    return value.to_bytes(32, "big")


def _mapping_slot(layout: str, key, index: int | bytes) -> int:
    """Where `mapping[key]` lives, for a mapping declared at `index`."""
    parent = _pad(index) if isinstance(index, int) else index
    raw = _pad(key) + parent if layout == SOLIDITY else parent + _pad(key)
    return int.from_bytes(keccak256(raw), "big")


@dataclass(slots=True)
class Funder:
    """Gives an account a balance and an allowance in any token it can decode.

    `CALLER` by default, which is who the gas measurements trade as.  Another
    `owner` is for measuring what a route would cost *someone else* without
    touching their real state -- the layout is a property of the contract, so
    the cache is shared whoever is being funded.

    The layout it finds is cached per token, because the search costs a handful
    of calls and the answer is a property of the deployed contract.
    """

    evm: object
    owner: str = CALLER
    layout: dict[str, tuple[str, int, int]] = field(default_factory=dict)
    unreadable: set[str] = field(default_factory=set)

    def _read(self, token: str, selector: bytes, args: list) -> int:
        try:
            out = self.evm.message_call(
                caller=CALLER, to=token,
                calldata=selector + b"".join(_pad(a) for a in args),
            )
        except Exception:
            return -1
        raw = bytes(out)
        return int.from_bytes(raw[-32:], "big") if len(raw) >= 32 else -1

    def _find(self, token: str, spender: str, probe: int) -> tuple[str, int, int] | None:
        for layout in (SOLIDITY, VYPER):
            balance_at = None
            for index in range(SLOTS_SEARCHED):
                slot = _mapping_slot(layout, self.owner, index)
                self.evm.insert_account_storage(token, slot, probe)
                # stETH and friends report `shares * pooled / total`, so the
                # write comes back rescaled rather than verbatim.  Requiring
                # equality here is what left nine tokens unfundable; requiring
                # that the slot *moved the balance materially* finds them and
                # still cannot be fooled by an unrelated slot, which moves it
                # not at all.
                if self._read(token, _BALANCE_OF, [self.owner]) >= probe // 2:
                    balance_at = index
                    break
                self.evm.insert_account_storage(token, slot, 0)
            if balance_at is None:
                continue
            for index in range(SLOTS_SEARCHED):
                inner = keccak256(
                    _pad(self.owner) + _pad(index) if layout == SOLIDITY
                    else _pad(index) + _pad(self.owner)
                )
                slot = _mapping_slot(layout, spender, inner)
                self.evm.insert_account_storage(token, slot, probe)
                if self._read(token, _ALLOWANCE,
                              [self.owner, spender]) >= probe // 2:
                    return (layout, balance_at, index)
                self.evm.insert_account_storage(token, slot, 0)
        return None

    def lend_from(self, token: str, holder: str, spender: str, amount: int) -> str | None:
        """Approve `spender` as `holder`, and trade as them.

        Some tokens keep balances where a slot scan cannot reach: Lido's stETH
        puts its shares mapping behind a hashed name, and a rebasing balance is
        not a slot at all.  Rather than teach the prober every such layout, borrow
        an account that already holds the token and let the token's own `approve`
        do the work.
        """
        approve = keccak256(b"approve(address,uint256)")[:4]
        try:
            self.evm.message_call(
                caller=holder, to=token,
                calldata=approve + _pad(spender) + _pad(amount * 2),
            )
        except Exception:
            return None
        if self._read_as(holder, token, _BALANCE_OF, [holder]) < amount:
            return None
        return holder

    def _read_as(self, caller: str, token: str, selector: bytes, args: list) -> int:
        try:
            out = self.evm.message_call(
                caller=caller, to=token,
                calldata=selector + b"".join(_pad(a) for a in args),
            )
        except Exception:
            return -1
        raw = bytes(out)
        return int.from_bytes(raw[-32:], "big") if len(raw) >= 32 else -1

    def balance_of(self, token: str, owner: str) -> int:
        """What `owner` holds, as the token itself reports it.

        Asked as `CALLER`, deliberately.  Asking *as the owner* made every holder
        look empty: the call failed and `-1` was flattened to `0`, which is
        indistinguishable from holding nothing.  Returns -1 when the token will
        not answer, so a caller can tell a refusal from a zero.
        """
        return self._read(token, _BALANCE_OF, [owner])

    def slots_for(self, token: str, spender: str) -> tuple[int, int] | None:
        """Where `owner`'s balance and `spender`'s allowance live in `token`.

        Only once the layout is known -- `fund` is what finds it.  For a
        caller that has to put a real holder's slots back afterwards, since
        the search writes markers into both while it looks for them.
        """
        known = self.layout.get(token.lower())
        if known is None:
            return None
        layout, balance_at, allowance_at = known
        inner = keccak256(
            _pad(self.owner) + _pad(allowance_at) if layout == SOLIDITY
            else _pad(allowance_at) + _pad(self.owner)
        )
        return (_mapping_slot(layout, self.owner, balance_at),
                _mapping_slot(layout, spender, inner))

    def fund(self, token: str, spender: str, amount: int) -> bool:
        """Leave `owner` holding `amount` and `spender` approved for it."""
        token, spender = token.lower(), spender.lower()
        if token in self.unreadable:
            return False
        known = self.layout.get(token)
        if known is None:
            known = self._find(token, spender, probe=amount or 10 ** 18)
            if known is None:
                self.unreadable.add(token)
                return False
            self.layout[token] = known
        layout, balance_at, allowance_at = known
        # Twice the trade, so a rescaling token still ends up with enough.
        self.evm.insert_account_storage(
            token, _mapping_slot(layout, self.owner, balance_at), amount * 2)
        inner = keccak256(
            _pad(self.owner) + _pad(allowance_at) if layout == SOLIDITY
            else _pad(allowance_at) + _pad(self.owner)
        )
        self.evm.insert_account_storage(
            token, _mapping_slot(layout, spender, inner), amount * 2)
        return self._read(token, _BALANCE_OF, [self.owner]) >= amount


# --------------------------------------------------------------- calldata

def _swap_calldata(kind: ArcKind, i: int, j: int, dx: int) -> bytes:
    dialect = "uint256" if kind is ArcKind.SWAP_CRYPTO else "int128"
    selector = keccak256(
        f"exchange({dialect},{dialect},uint256,uint256)".encode())[:4]
    return selector + _pad(i) + _pad(j) + _pad(dx) + _pad(0)


#: Redemptions and wraps are their own contracts with their own costs -- a
#: vault share burn is not a swap, and pricing it as one is how a route through
#: three wrappers looks cheaper than it is.
_WRAPPER_CALLDATA = {
    ArcKind.ERC4626_DEPOSIT: lambda dx: (
        keccak256(b"deposit(uint256,address)")[:4] + _pad(dx) + _pad(CALLER)),
    ArcKind.ERC4626_REDEEM: lambda dx: (
        keccak256(b"redeem(uint256,address,address)")[:4]
        + _pad(dx) + _pad(CALLER) + _pad(CALLER)),
    ArcKind.WSTETH_WRAP: lambda dx: keccak256(b"wrap(uint256)")[:4] + _pad(dx),
    ArcKind.WSTETH_UNWRAP: lambda dx: keccak256(b"unwrap(uint256)")[:4] + _pad(dx),
    ArcKind.UNWRAP_NATIVE: lambda dx: keccak256(b"withdraw(uint256)")[:4] + _pad(dx),
    ArcKind.WRAP_NATIVE: lambda dx: keccak256(b"deposit()")[:4],
    ArcKind.STAKE_NATIVE: lambda dx: (
        keccak256(b"submit(address)")[:4] + _pad("0x" + "00" * 20)),
}

#: Value-bearing legs: the input is ether, so there is nothing to fund or
#: approve and the amount rides on the call instead of in the calldata.
PAYABLE = (ArcKind.WRAP_NATIVE, ArcKind.STAKE_NATIVE)


#: A Solidity revert carries its string after a 4-byte selector and two words.
_ERROR_SELECTOR = bytes.fromhex("08c379a0")


def _boa_reason(exc: Exception) -> str:
    """One committable line out of boa's multi-line failure trace.

    boa reports a contract failure as a formatted trace with a banner, a stack
    and the raw calldata.  None of that belongs in a committed file; the last
    meaningful line usually names the contract or the decoded error.
    """
    # Only a decoded error is worth keeping.  The trace is mostly frames --
    # "<Unknown contract 0x...>" names where it stopped, not why, and that is
    # noise in a file meant to be read in a diff.
    for line in reversed([x.strip() for x in str(exc).splitlines() if x.strip()]):
        if line.startswith(("=", "[E]", "0x", "b'", 'b"', "<", "(")):
            continue
        if ":" in line or line.isidentifier() or " " in line:
            return line[:60]
    return "reverted"


def revert_reason(exc: Exception) -> str:
    """The best short explanation available for a revert.

    Worth decoding rather than storing raw: this ends up committed, and
    "mint is paused" tells a reader what to do about it where a hex blob does
    not.  Aave V2 answers with a bare numeric code, which stays as-is.
    """
    if type(exc).__name__ == "BoaError":
        return _boa_reason(exc)
    text = str(exc)
    if "output: 0x" not in text:
        return text[:60] or type(exc).__name__
    blob = text.split("output: 0x")[1].split(",")[0].split("}")[0].strip()
    try:
        data = bytes.fromhex(blob)
    except ValueError:
        return text[:60]
    if not data:
        return "reverted without a reason"
    if data[:4] == _ERROR_SELECTOR and len(data) > 68:
        return data[68:].rstrip(b"\x00").decode("utf8", "replace")[:60] or "reverted"
    return f"reverted (0x{data[:8].hex()})"


@dataclass(slots=True)
class Measurement:
    target: str
    kind: ArcKind
    i: int
    j: int
    gas: int = 0
    note: str = ""

    @property
    def ok(self) -> bool:
        return self.gas > 0


def measure(evm, funder: Funder, *, target: str, kind: ArcKind, token_in: str,
            amount: int, i: int = 0, j: int = 0, holder: str = "") -> Measurement:
    """Execute one leg and report what it burned, leaving no state behind.

    `holder` is an address known to hold `token_in` -- used only when the slot
    scan cannot fund `CALLER`, which is the case for tokens whose balances are
    not a plain mapping (see `Funder.lend_from`).
    """
    out = Measurement(target=target.lower(), kind=kind, i=i, j=j)
    if amount <= 0:
        out.note = "no amount"
        return out
    snapshot = evm.snapshot()
    try:
        payable = kind in PAYABLE
        caller = CALLER
        if payable:
            # `LackOfFundForMaxFee`: revm charges the fee against the caller's
            # balance, so the value alone is not enough to fund the call.
            evm.set_balance(CALLER, amount + 10 ** 20)
        elif not funder.fund(token_in, target, amount):
            borrowed = (funder.lend_from(token_in, holder, target, amount)
                        if holder else None)
            if borrowed is None:
                out.note = "cannot fund"
                return out
            caller = borrowed
            evm.set_balance(caller, 10 ** 20)
        if kind.is_swap:
            data = _swap_calldata(kind, i, j, amount)
        else:
            build = _WRAPPER_CALLDATA.get(kind)
            if build is None:
                out.note = f"no calldata for {kind.name}"
                return out
            data = build(amount)
        try:
            evm.message_call(caller=caller, to=target, calldata=data,
                             value=amount if payable else 0)
        except Exception as exc:
            out.note = f"reverted: {revert_reason(exc)}"
            return out
        result = getattr(evm, "result", None)
        used = getattr(result, "gas_used", 0) if result is not None else 0
        out.gas = int(used)
        if not out.gas:
            out.note = "no gas reported"
    finally:
        # A reverted call may have unwound the checkpoint already.
        with contextlib.suppress(Exception):
            evm.revert(snapshot)
    return out


def measure_legs(evm, legs, *, funder: Funder | None = None) -> dict:
    """Measure a set of realised legs, keyed for `core.gas.GasTable`.

    `legs` is an iterable of `(target, kind, i, j, token_in, amount)`, or the
    same with a seventh element naming an address that holds `token_in` -- what
    a route actually chose, at the size it chose, which is the only sample that
    reflects the state-dependent costs a synthetic ladder would miss.
    """
    funder = funder or Funder(evm)
    table: dict[tuple[str, int, int, int], int] = {}
    notes: list[Measurement] = []
    for entry in legs:
        target, kind, i, j, token_in, amount = entry[:6]
        holder = entry[6] if len(entry) > 6 else ""
        got = measure(evm, funder, target=target, kind=kind, token_in=token_in,
                      amount=amount, i=i, j=j, holder=holder)
        if got.ok:
            key = (got.target, int(kind), int(i), int(j))
            # Several routes exercise the same leg at different sizes.  Keep the
            # dearest: a pool that sometimes rebalances inside `exchange` really
            # does cost that, and charging the cheap sample would under-price it.
            table[key] = max(table.get(key, 0), got.gas)
        else:
            notes.append(got)
    return {"legs": table, "failed": notes}
