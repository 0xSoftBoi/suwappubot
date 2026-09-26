"""Native to wrapped native, without going near the router.

WETH is not a pool.  `deposit()` mints one wrapped token per wei sent and
`withdraw(n)` burns them back, exactly, for ever -- there is no curve, no fee,
no slippage and nothing to solve.  The router *can* carry it as a leg, but
doing so costs an approval on the wrapped side and routes a 1:1 identity
through a contract that has to be told about it.

So the tab short-circuits: the same widget, the same picture, and a call
straight to the wrapper.  No approval either way -- a deposit rides on
`msg.value` and a withdraw burns the caller's own balance -- which is the
difference between one transaction and two.

Flet-free.  What the wallet does with the call is `curve.router_contract`'s
half; this is which call it is, and what the widget should say about it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from curve import abi

#: Curve's sentinel for native ETH, and every other chain's native coin.
NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

#: The two directions, named as the wrapper names them.
DEPOSIT = "deposit"
WITHDRAW = "withdraw"

#: What each one costs, near enough, when the chain will not say.  Measured on
#: mainnet WETH: a deposit into a slot that already holds something is 27,938
#: and a first-time one is 45,038; a withdraw is 30,014.  The larger of the
#: pair, since being asked for more gas than a transaction uses costs nothing
#: and being asked for less costs the transaction.
FALLBACK_GAS = {DEPOSIT: 48_000, WITHDRAW: 32_000}


def direction(sell: str, buy: str, wrapped: str) -> str | None:
    """Which way this pair wraps, or None if it is not a wrapping at all."""
    if not sell or not buy or not wrapped:
        return None
    sell, buy, wrapped = sell.lower(), buy.lower(), wrapped.lower()
    if sell == NATIVE and buy == wrapped:
        return DEPOSIT
    if sell == wrapped and buy == NATIVE:
        return WITHDRAW
    return None


def calldata(which: str, amount: int) -> str:
    """`deposit()` takes no arguments; `withdraw(uint256)` takes the amount."""
    if which == DEPOSIT:
        return "0x" + abi.selector("deposit()")
    return "0x" + abi.selector("withdraw(uint256)") + f"{int(amount):064x}"


@dataclass(frozen=True, slots=True)
class WrapPlan:
    """A wrapping, in the shape the tab already knows how to send.

    The same fields `erouter`'s `ExecutionPlan` has, so `show_quote`,
    `_show_gas` and `RouterContract.execute` need no idea which kind of plan
    they are holding -- plus `wrap`, which is how `needs_approval` knows there
    is nothing to approve.
    """

    to: str
    data: bytes
    value: int
    token_in: str
    amount_in: int
    quoted_out: int
    guaranteed_out: int
    tolerance_bp: float = 0.0
    gas: int = 0
    block: int = 0
    unbounded: tuple = ()
    reverted: str = ""
    gas_estimated: bool = False
    #: Always. There is no allowance on either side of a wrapper.
    wrap: bool = True


def plan(which: str, wrapped: str, amount: int, *, gas: int = 0) -> WrapPlan:
    """The call, and what it promises -- which is the whole amount, exactly."""
    data = calldata(which, amount)
    return WrapPlan(
        to=wrapped,
        data=bytes.fromhex(data[2:]),
        value=amount if which == DEPOSIT else 0,
        token_in=NATIVE if which == DEPOSIT else wrapped,
        amount_in=amount,
        # One for one, and not "about" one for one: there is no rate here to
        # be bounded, so the guarantee is the amount itself.
        quoted_out=amount,
        guaranteed_out=amount,
        gas=gas or FALLBACK_GAS.get(which, 0),
        gas_estimated=not gas,
    )


# -- what the widget draws -------------------------------------------------
#
# `ui.routegraph` reads a `Diagram` by attribute, so these are the smallest
# objects that answer to one.  Built here rather than in the view because the
# figures in them are this module's arithmetic, not the view's.


@dataclass(frozen=True, slots=True)
class _Bus:
    slot: int
    symbol: str
    amount: str
    token: str
    is_source: bool = False
    is_dest: bool = False


@dataclass(frozen=True, slots=True)
class _Kind:
    name: str


@dataclass(frozen=True, slots=True)
class _Element:
    index: int
    src_slot: int
    dst_slot: int
    share_pct: float
    label: str
    target: str
    detail: str
    kind: _Kind
    #: What the leg carries, which is how `routegraph` divides a bus between
    #: the legs out of it.  One for one both ways here, so the two sides of a
    #: wrapping are the same number.
    amount_in: str = ""
    amount_out: str = ""


@dataclass(frozen=True, slots=True)
class _Diagram:
    buses: list = field(default_factory=list)
    elements: list = field(default_factory=list)
    order: list = field(default_factory=list)


def diagram(which: str, sell, buy, wrapped: str, shown: str):
    """One column each side and one ribbon between, named for what it does."""
    kind = "WRAP_NATIVE" if which == DEPOSIT else "UNWRAP_NATIVE"
    return _Diagram(
        buses=[
            _Bus(0, getattr(sell, "symbol", "?"), shown,
                 getattr(sell, "address", ""), is_source=True),
            _Bus(1, getattr(buy, "symbol", "?"), shown,
                 getattr(buy, "address", ""), is_dest=True),
        ],
        elements=[_Element(0, 0, 1, 100.0, which, wrapped, wrapped, _Kind(kind),
                           amount_in=shown, amount_out=shown)],
        order=[0, 1],
    )


__all__ = ["DEPOSIT", "FALLBACK_GAS", "NATIVE", "WITHDRAW", "WrapPlan",
           "calldata", "diagram", "direction", "plan"]
