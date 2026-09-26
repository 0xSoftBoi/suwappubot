"""Send a route through `ElectricRouter` -- on a fork today, on a chain later.

`executor.py` runs the *quoter's* leg encoding with every bound switched off,
because its question is "would this route run at all".  This one runs the
router's encoding with the bounds on, because its question is the opposite:
does a call a user would actually sign deliver what the quote promised.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field

from ..core.routecall import RouteCall

CONTRACT = pathlib.Path(__file__).resolve().parents[3] / "contracts" / "ElectricRouter.vy"

NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
GAS_HEADROOM_WEI = 10**19

#: `Error(string)`.
REVERT_SELECTOR = bytes.fromhex("08c379a0")


def _decode(output) -> str:
    """`Error(string)` if that is what these bytes are."""
    from ..core.codec import decode_result

    if not output or bytes(output[:4]) != REVERT_SELECTOR:
        return ""
    try:
        return str(decode_result(["string"], bytes(output)[4:])[0])
    except Exception:
        return ""


def _frames(frame, depth: int = 0):
    """Every erroring frame, deepest last."""
    comp = getattr(frame, "computation", None)
    if comp is not None and getattr(comp, "error", None) is not None:
        yield depth, comp
    for child in getattr(frame, "children", ()) or ():
        yield from _frames(child, depth + 1)


def revert_reason(exc: Exception) -> str:
    """Where the call died, and what it said if it said anything.

    Two reasons to dig rather than take `str(exc)`.  boa leads its rendering
    with every argument, so a route with six pools pushes any message past a
    sane truncation -- and a frame with an empty selector, which is what paying
    native out is, makes that rendering raise instead of merely be long.
    """
    frame = exc.args[0] if exc.args else None
    if frame is None:
        return ""
    said, deepest = "", None
    for depth, comp in _frames(frame):
        deepest = (depth, comp)
        text = _decode(getattr(comp, "output", b""))
        if text:
            said = text
    if said:
        return said
    if deepest is None:
        return ""
    _, comp = deepest
    message = getattr(getattr(comp, "msg", None), "data", b"") or b""
    to = bytes(getattr(getattr(comp, "msg", None), "to", b"") or b"")
    selector = bytes(message)[:4].hex() if len(bytes(message)) >= 4 else "none"
    return (f"reverted with no reason, deepest frame 0x{to.hex()[:8]} "
            f"selector 0x{selector}")


@dataclass(slots=True)
class Sent:
    """What the router really paid, and what it cost to find out."""

    amount_out: int = 0
    quoted_out: int | None = None
    gas: int = 0
    calldata_bytes: int = 0
    error: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.error and self.amount_out > 0

    @property
    def drift_bp(self) -> float:
        if not self.quoted_out:
            return 0.0
        return (self.amount_out - self.quoted_out) / self.quoted_out * 1e4


def deploy(name: str = "ElectricRouter", *, prefer_deployed: bool = True):
    """The router to run a route through, on the active fork.

    The deployed one where the fork has it, because that is the contract a
    caller will reach and compiling a fresh copy would only prove the source
    compiles.  They are the same bytes -- `ROUTER_ADDRESS` is checked against
    the compiled runtime -- so this changes which address is exercised, not
    what runs.  Falls back to loading the source, which is what a chain
    without a deployment and every synthetic test needs.
    """
    import boa

    from erouter.core.schema import ROUTER_ADDRESS

    if prefer_deployed and ROUTER_ADDRESS:
        try:
            if bytes(boa.env.get_code(ROUTER_ADDRESS)):
                return boa.loads_partial(CONTRACT.read_text(), name=name).at(
                    ROUTER_ADDRESS)
        except Exception:      # no fork, or an env that cannot read code
            pass
    return boa.loads(CONTRACT.read_text(), name=name)


def send(
    call: RouteCall,
    *,
    router=None,
    quoted_out: int | None = None,
    wrapped: str = "",
    holders: list[str] | None = None,
    expect_block: int | None = None,
) -> Sent:
    """Run `call` against the active fork.  Never raises; reports instead.

    A revert is an answer here -- it is what a user would have seen -- so it
    lands in `error` rather than propagating out of a batch.
    """
    import boa

    from .executor import ERC20_ABI, _fund, describe

    result = Sent(quoted_out=quoted_out,
                  calldata_bytes=len(call.calldata(sender=call.receiver)))
    if expect_block is not None:
        at = int(boa.env.evm.patch.block_number)
        if at != expect_block:
            result.error = (
                f"fork is at block {at:,}, the quote was pinned to "
                f"{expect_block:,}; the comparison would be meaningless")
            return result

    contract = router or deploy()
    native_in = call.token_in.lower() == NATIVE

    try:
        with boa.env.anchor():
            who = boa.env.generate_address()
            boa.env.set_balance(
                who, GAS_HEADROOM_WEI + (call.amount_in if native_in else 0))
            if not native_in:
                token = boa.loads_abi(ERC20_ABI).at(call.token_in)
                _fund(boa, token, who, call.amount_in, result, wrapped, holders)
                with boa.env.prank(who):
                    token.approve(contract.address, call.amount_in)
            with boa.env.prank(who):
                result.amount_out = contract.execute(
                    call.amount_in,
                    list(call.pools),
                    list(call.params),
                    call.set_approvals,
                    list(call.tokens),
                    who,
                    call.min_out,
                    value=call.amount_in if native_in else 0,
                )
            result.gas = int(contract._computation.get_gas_used())
    except Exception as exc:
        result.error = revert_reason(exc) or describe(exc)
    return result
