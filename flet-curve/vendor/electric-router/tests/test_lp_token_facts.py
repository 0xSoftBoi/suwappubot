"""`resolve_lp_tokens` reads an LP token's `decimals()`, and zero is not one.

An LP token that lives at its own address is an ERC20, not a pool.  The local
EVM holds pool storage, so `decimals()` there reads an absent slot and returns
**zero** -- 32 bytes, well-formed, and wrong.  Zero decimals is legal for an
ERC20 in general and has never been legal for a Curve LP token, so it is
rejected rather than cached as an immutable fact.

Believed, it scales the whole deposit arc by 1e18: `a` is fitted in canonical
units, so a deposit into 3pool quoted 1.9e24 3Crv for 2M USDT.  The withdrawal
back out divides by the same wrong supply and cancels it, which is why the
round trip still looked sane and the only visible symptom was the renderer
raising `InvalidOperation` on a number too large to format.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from erouter.core.transport import Answer, Status
from erouter.dev.universe import resolve_lp_tokens


@dataclass
class Coin:
    address: str
    decimals: int = 18
    symbol: str = "X"


@dataclass
class Pool:
    address: str = "0x" + "aa" * 20
    coins: list = field(default_factory=lambda: [Coin("0x" + "b1" * 20),
                                                 Coin("0x" + "b2" * 20)])
    n_coins: int = 2
    balances: tuple = ()
    base_pool: str = ""
    lp_token: str = ""
    lp_decimals: int = 18
    lp_supply: int = 0
    name: str = "pool"


LP = "0x" + "cc" * 20


TOKEN = bytes.fromhex("fc0c546a")          # token()
TOTAL_SUPPLY = bytes.fromhex("18160ddd")   # totalSupply()


class Client:
    """`token()` names a separate LP token; everything else answers `value`.

    The pool refuses `totalSupply()`, which is what 3pool does -- its supply
    lives on 3Crv -- and is what puts it on the `separate` path where the LP
    token's own `decimals()` is read.
    """

    def __init__(self, value: int):
        self.value = value
        self.targets: list[str] = []

    def raw(self, calls):
        out = []
        for call in calls:
            self.targets.append(call.to.lower())
            selector = call.data[:4]
            if selector == TOKEN:
                out.append(Answer(Status.VALUE, int(LP, 16).to_bytes(32, "big")))
            elif selector == TOTAL_SUPPLY and call.to.lower() != LP.lower():
                out.append(Answer(Status.WRONG_ABI, b""))
            else:
                out.append(Answer(Status.VALUE, self.value.to_bytes(32, "big")))
        return out


def test_a_zero_decimals_read_is_refused():
    pool = Pool()
    # A client that answers every non-`token()` call with zero is exactly the
    # local EVM against an LP token whose storage it never loaded.
    resolve_lp_tokens([pool], Client(0))
    assert pool.lp_decimals == 18, (
        f"a zero from an unloaded account was believed: {pool.lp_decimals}")


def test_a_real_decimals_read_is_kept():
    pool = Pool(lp_decimals=18)
    resolve_lp_tokens([pool], Client(6))
    assert pool.lp_decimals == 6, "a genuine six-decimal LP token was overridden"


def test_the_lp_token_is_read_through_the_token_client():
    pool = Pool()
    pools = Client(0)
    tokens = Client(18)

    resolve_lp_tokens([pool], pools, None, token_client=tokens)

    assert tokens.targets and set(tokens.targets) == {LP.lower()}, (
        f"the LP token went somewhere else: {tokens.targets}")
    assert LP.lower() not in pools.targets, (
        "an ERC20 read was served by the pool client")
    assert pool.lp_decimals == 18
