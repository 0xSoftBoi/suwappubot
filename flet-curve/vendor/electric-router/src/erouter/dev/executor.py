"""Execute a route on a fork and report what it actually paid.

Every other check in this system asks the chain a *question*: the quoter walks a
candidate with chained `staticcall` and the answer that counts is the one that
comes back.  That is enough for most routes and not enough for three kinds, all
invisible to a view-only walk:

* **A pool entered twice.**  The second leg quotes against state the first leg
  has already moved, so the quoter's answer is wrong by construction.  This is
  why `decision 3` forbids it, and why `certificate: RESTRICTED` shows up on
  routes that would obviously be better without the rule.
* **Multi-port elements.**  Same thing by another name -- one pool, several ports
  -- which is why every element candidate measured comes back unquotable rather
  than merely worse.
* **Anything that reverts only when it moves value.**  A paused transfer, a
  deposit cap, a token with a transfer hook: `get_dy` prices all of them happily.

So this runs the route for real -- `boa.fork` at the same pinned block, the
executor contract from `contracts/`, and real calls -- and reports the balance
that actually arrives.  The number is not a better quote; it is a different
claim: that the route is executable at all, and that the quote was honest.
"""

from __future__ import annotations

import functools
import pathlib
from dataclasses import dataclass, field

from ..core.realize import RealizedRoute

CONTRACT = pathlib.Path(__file__).resolve().parents[3] / "contracts" / "RouteExecutor.vy"

# Curve's sentinel for native ETH.
NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

# `approve` returns nothing here, which is USDT's spelling and the widest one
# that still binds.  `totalSupply` is present because `boa.deal` writes it.
ERC20_ABI = """[
 {"name":"balanceOf","outputs":[{"type":"uint256","name":""}],
  "inputs":[{"type":"address","name":"o"}],
  "stateMutability":"view","type":"function"},
 {"name":"totalSupply","outputs":[{"type":"uint256","name":""}],
  "inputs":[],"stateMutability":"view","type":"function"},
 {"name":"decimals","outputs":[{"type":"uint8","name":""}],
  "inputs":[],"stateMutability":"view","type":"function"},
 {"name":"approve","outputs":[],
  "inputs":[{"type":"address","name":"s"},{"type":"uint256","name":"v"}],
  "stateMutability":"nonpayable","type":"function"}]"""

GAS_HEADROOM_WEI = 10**19


def describe(exc: BaseException) -> str:
    """One line for a failure, even when the failure will not be rendered.

    boa formats a `BoaError` by decoding every frame of its call trace, and a
    frame with an empty selector -- paying native out is one -- has no method
    id to decode, so `str(exc)` raises from inside the formatter.  A reporter
    that cannot report is worse than a short message.
    """
    try:
        return f"{type(exc).__name__}: {exc}".strip()[:400]
    except Exception:
        return f"{type(exc).__name__} (boa could not render its own trace)"

#: `transfer`, for funding out of a holder when the balance slot cannot be
#: found.  Declared as returning a bool, which is the common spelling; a token
#: that returns nothing still executes, the decode is what would differ.
TRANSFER_ABI = """[
 {"name":"transfer","outputs":[{"type":"bool","name":""}],
  "inputs":[{"type":"address","name":"t"},{"type":"uint256","name":"v"}],
  "stateMutability":"nonpayable","type":"function"}]"""

# An OUSD-family token names the only address allowed to mint it.
VAULT_MINT_ABI = """[
 {"name":"vaultAddress","outputs":[{"type":"address","name":""}],"inputs":[],
  "stateMutability":"view","type":"function"},
 {"name":"mint","outputs":[],
  "inputs":[{"type":"address","name":"a"},{"type":"uint256","name":"v"}],
  "stateMutability":"nonpayable","type":"function"}]"""

# A native wrapper mints against native, so it is funded rather than dealt.
WRAPPED_ABI = """[
 {"name":"deposit","outputs":[],"inputs":[],
  "stateMutability":"payable","type":"function"}]"""


@dataclass(slots=True)
class Execution:
    """What happened when the route was run rather than asked about."""

    executed_out: int = 0
    quoted_out: int | None = None
    amount_in: int = 0
    legs: int = 0
    slots: list[str] = field(default_factory=list)
    error: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.error and self.executed_out > 0

    @property
    def drift_bp(self) -> float:
        """Executed against quoted, in bp.  Positive means execution did better.

        Zero is the expected answer for a route with no reentry in it: the
        quoter walked the same calls against the same block.  A non-zero value
        on such a route is a bug in one of the two paths, which is the whole
        reason to compare them.
        """
        if not self.quoted_out:
            return 0.0
        return (self.executed_out / self.quoted_out - 1) * 10_000


def slot_tokens(route: RealizedRoute) -> list[str]:
    """Slot index -> token address, which is what execution needs and quoting does not.

    `realize.slot` assigns one slot per token and collapses aliases onto the
    canonical address, so this inverts cleanly and every index is filled.
    """
    out = [""] * len(route.slots)
    for token, index in route.slots.items():
        out[index] = token
    missing = [k for k, token in enumerate(out) if not token]
    if missing:
        raise ValueError(f"slot map has holes at {missing}")
    return out


_RETRIES_INSTALLED = False


def serves_prestate(url: str, timeout: float = 10.0, attempts: int = 3) -> bool:
    """Does this node answer `debug_traceCall` with the prestate tracer?

    Asked more than once because a no here is expensive and irreversible: it
    puts the whole run on one `eth_getStorageAt` per slot, and a stalled socket
    would be indistinguishable from a node that does not serve `debug_*`.
    """
    import json
    import urllib.error
    import urllib.request

    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "debug_traceCall",
        "params": [{"to": "0x" + "00" * 19 + "01", "data": "0x"},
                   "latest", {"tracer": "prestateTracer"}],
    }).encode()
    for _ in range(attempts):
        request = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as reply:
                return "result" in json.loads(reply.read())
        except urllib.error.HTTPError:
            return False      # a status is an answer, and it was no
        except (TimeoutError, OSError):
            continue          # no answer yet; a fresh connection may get one
        except Exception:
            return False
    return False


#: Retrying one of these would broadcast twice, so a stall on one is final.
SUBMITS = ("eth_send", "eth_sign", "personal_")


def reads_only(args) -> bool:
    """Is this request safe to ask twice?

    `fetch` takes a method, `fetch_multi` a list of them; anything else is a
    shape this does not know, and the safe answer for an unknown shape is no.
    """
    first = args[0] if args else None
    if isinstance(first, str):
        return not first.startswith(SUBMITS)
    if isinstance(first, (list, tuple)):
        return all(isinstance(m, str) and not m.startswith(SUBMITS)
                   for m, _ in first)
    return False


def _with_retries(call, attempts: int, stalled: tuple):
    """Re-ask a read, on a fresh socket, up to `attempts` times."""

    @functools.wraps(call)
    def wrapper(self, *args):
        for attempt in range(attempts):
            try:
                return call(self, *args)
            except stalled:
                if attempt == attempts - 1 or not reads_only(args):
                    raise
                self._session.close()

    return wrapper


def install_read_retries(attempts: int = 4, timeout: float = 15.0) -> None:
    """Survive an endpoint that accepts a read and never answers it.

    Measured on base: `eth_getStorageAt` came back in 50 ms for 114 of 116
    calls and hung the full 60 s for the other two, same request shape, while
    `debug_traceCall` never missed.  So it is the socket, not the payload.  boa
    retries nothing and keeps one session for the whole sweep, so a stall both
    loses the route and stays in the pool.  Every request a fork makes is a
    read; re-asking costs a round trip and nothing else.

    Four attempts at 15 s keep the old 60 s ceiling, as four draws instead of
    one.
    """
    global _RETRIES_INSTALLED
    if _RETRIES_INSTALLED:
        return
    import boa.rpc
    from requests import exceptions as rex

    stalled = (rex.ReadTimeout, rex.ConnectionError, rex.ChunkedEncodingError)
    boa.rpc.TIMEOUT = timeout   # looked up per call, so it bounds one attempt
    for name in ("fetch", "fetch_multi"):
        setattr(boa.rpc.EthereumRPC, name,
                _with_retries(getattr(boa.rpc.EthereumRPC, name), attempts,
                              stalled))
    _RETRIES_INSTALLED = True


def fork(url: str, block: int, *, prefetch: bool | None = None):
    """Point boa at the chain, at the block the quote was pinned to.

    **Prefetch decides whether this takes minutes or hours.**  Without it every
    storage slot a leg touches is its own `eth_getStorageAt` at ~33 ms apiece even
    on the LAN -- the cost is per-request scheduling, not per-slot work -- so a
    pool with a few hundred slots spends ten seconds fetching before it computes
    anything.  With it, boa asks `debug_traceCall{prestateTracer}` once per
    message and gets the whole working set in ~0.13 s.

    Not every node serves `debug_*`, so this probes rather than assumes: `None`
    means detect, and a node that will not answer keeps the slow path.
    """
    import boa

    install_read_retries()
    boa.fork(url, block_identifier=block, allow_dirty=True)
    if prefetch is None:
        prefetch = serves_prestate(url)
    boa.env.evm._fork_try_prefetch_state = bool(prefetch)
    return boa.env


def deploy(name: str = "RouteExecutor"):
    import boa

    return boa.loads(CONTRACT.read_text(), name=name)


def execute(
    route: RealizedRoute,
    *,
    executor=None,
    quoted_out: int | None = None,
    amount_in: int | None = None,
    wrapped: str = "",
    expect_block: int | None = None,
    holders: list[str] | None = None,
) -> Execution:
    """Run `route` against the active fork.  Never raises; reports instead.

    A revert is a result -- it is the answer to "is this executable" -- so it
    lands in `error` rather than propagating.  The caller is usually verifying
    a batch and wants the failures listed, not the first one thrown.
    """
    import boa

    amount = route.amount_in if amount_in is None else amount_in
    result = Execution(amount_in=amount, legs=len(route.legs), quoted_out=quoted_out)
    try:
        tokens = slot_tokens(route)
    except ValueError as exc:
        result.error = str(exc)
        return result
    result.slots = tokens

    if not route.legs:
        # An alias pair: two addresses over one balance, nothing to execute.
        result.executed_out = amount
        return result

    # A quote is only comparable to an execution at the same block, and the
    # failure is silent: fork at `latest` instead and every number still looks
    # plausible, just measured against a market that has moved.  boa holds both
    # the block number and its timestamp fixed while executing -- measured to
    # the wei on scrvUSD, which accrues per second -- so when this matches, the
    # two paths really are looking at one state.
    if expect_block is not None:
        at = int(boa.env.evm.patch.block_number)
        if at != expect_block:
            result.error = (
                f"fork is at block {at:,}, the quote was pinned to "
                f"{expect_block:,}; the comparison would be meaningless"
            )
            return result

    contract = executor or deploy()
    wire = [leg.as_tuple() for leg in route.wire_legs]
    src = tokens[0]
    native_in = src.lower() == NATIVE.lower()

    try:
        with boa.env.anchor():
            who = boa.env.generate_address()
            boa.env.set_balance(who, GAS_HEADROOM_WEI + (amount if native_in else 0))
            if not native_in:
                token = boa.loads_abi(ERC20_ABI).at(src)
                _fund(boa, token, who, amount, result, wrapped, holders)
                with boa.env.prank(who):
                    token.approve(contract.address, amount)
            with boa.env.prank(who):
                result.executed_out = contract.execute_route(
                    wire, tokens, amount, route.dst_slot, 0,
                    value=amount if native_in else 0,
                )
    except Exception as exc:                       # see docstring
        result.error = describe(exc)
    return result


def _fund(boa, token, who, amount: int, result: Execution, wrapped: str,
          holders: list[str] | None = None) -> None:
    """Put `amount` of the input token in `who`'s hands, faithfully.

    **A native wrapper is minted, not dealt.**  WXDAI is to xDAI what WETH is to
    ETH: its supply is exactly the native balance it holds, and it hands out
    tokens only through payable `deposit()`.  `boa.deal` writes the balance slot
    directly, which leaves the wrapper owing tokens it has no native behind -- and
    its `totalSupply` is its own native balance rather than a slot, so the supply
    half fails outright.  A pure swap never notices, which is what makes it
    dangerous: the run passes and the first route that unwraps fails for reasons
    that look unrelated.  Native is free to conjure in a fork, so mint it the way
    any holder would.

    Everything else is dealt, and **the supply is left alone**.  That ordering is
    the whole point: minting shares an LP token's pool has no assets behind
    dilutes it, and a withdrawal is priced off `totalSupply`.  Measured on gnosis
    USDCe/EURe, adjusting supply to deal 1% of the LP moved the virtual price from
    1.000205 to 0.990302 and `remove_liquidity_one_coin` refused its own state
    with "virtual price decreased"; leaving it alone reproduces the view to the
    wei.  Adjusting is the fallback for a token that packs or computes its balance
    slot, and is recorded rather than silent.
    """
    if wrapped and token.address.lower() == wrapped.lower():
        boa.env.set_balance(who, amount + GAS_HEADROOM_WEI)
        with boa.env.prank(who):
            boa.loads_abi(WRAPPED_ABI).at(token.address).deposit(value=amount)
        return
    try:
        boa.deal(token, who, amount, adjust_supply=False)
        return
    except Exception as exc:
        first = str(exc)
        result.warnings.append(
            f"supply adjusted to fund {token.address}, whose balance slot was "
            f"not found -- an LP token priced this way is diluted: {exc}"[:200]
        )
    try:
        boa.deal(token, who, amount)
        return
    except Exception:
        pass
    # **A rebasing token has no balance slot to find.**  An OUSD-family balance
    # is `creditBalances[a] * 1e18 / creditsPerToken(a)` -- computed, not stored --
    # so both halves of the brute force miss it, and base superOETHb reached the
    # holder drain below.  The token names its minter, `mint` being `onlyVault`,
    # so pranking that address creates the tokens the way the token itself does.
    # Measured there: the pool the route prices does not move a wei and
    # `creditsPerToken` is unchanged, so nothing is diluted.
    try:
        rebasing = boa.loads_abi(VAULT_MINT_ABI).at(token.address)
        with boa.env.prank(rebasing.vaultAddress()):
            rebasing.mint(who, amount)
        if token.balanceOf(who) >= amount:
            result.warnings.pop()
            result.warnings.append(
                f"minted through its own vault, having no balance slot to "
                f"deal: {token.address}")
            return
    except Exception:
        pass

    # **Take it from someone who has it.**  `boa.deal` finds the balance slot by
    # brute force, and a token that packs its balances or computes them -- gnosis
    # EURe, whose two contracts share one market -- defeats both halves of that.
    # A holder does not need to be discovered: the pools in the route's own
    # universe hold the token by definition, and pranking one is a real
    # `transfer`, so whatever the token does on the way out happens.
    #
    # The pool is left short, which is why this is the fallback and not the first
    # choice: it moves the very liquidity the route is about to price.  Recorded,
    # so a caller reading a suspiciously good number can see it.
    result.warnings.pop()                          # replaced by the line below
    for holder in holders or ():
        try:
            if token.balanceOf(holder) < amount:
                continue
            with boa.env.prank(holder):
                boa.loads_abi(TRANSFER_ABI).at(token.address).transfer(who, amount)
        except Exception:
            continue
        if token.balanceOf(who) >= amount:
            result.warnings.append(
                f"funded by transfer from {holder}: {token.address} has no "
                f"findable balance slot ({first[:60]}).  That holder is left "
                f"short -- if the route trades through it, the execution saw "
                f"reserves the quote did not")
            return
    raise RuntimeError(
        f"cannot fund {token.address}: boa.deal found no balance slot and no "
        f"holder among {len(holders or ())} candidate(s) had {amount}")
