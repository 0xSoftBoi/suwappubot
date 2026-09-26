"""Every ABI signature the contracts spell out by hand.

A call the contract simply makes is declared as an interface, and the compiler
writes the calldata for it.  A call it has to *try* cannot be: the quoter has to
tell a pool that does not implement a function from one that reverts, and the
router has to attempt `coins(uint256)` before falling back to `coins(int128)`.
Vyper has no `try` around an external call and no way to take a selector off a
declared interface, so those stay `raw_call`, with the signature as a string
literal that nothing type-checks.

A typo in one therefore compiles.  It becomes a selector no pool implements,
which a Curve pool answers by falling into `__default__` and returning nothing,
which reads downstream as "this leg produced nothing".  The chain is the only
thing that would notice, and only for the pools a forked run happens to touch.

So both sources are read and the union is pinned.  Reading both is what keeps a
call moving from one form to the other from looking like a signature vanishing
-- and when the router's calls were converted to interfaces, the derived set
came back exactly equal to the literals it replaced, which is the check on the
derivation.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from erouter.core.codec import parse_type, selector, signature_types
from erouter.core.types import ArcKind

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
LITERAL = re.compile(r'method_id\(\s*"([^"]+)"')
#: `def name(a: T, b: U): mutability`, inside an `interface` block.
DECLARED = re.compile(r"^\s{4}def (\w+)\(([^)]*)\)\s*(?:->[^:]+)?:", re.MULTILINE)
INTERFACE = re.compile(r"^interface \w+:$", re.MULTILINE)


def _abi_type(text: str) -> str:
    """The ABI spelling of a Vyper parameter type."""
    text = text.strip()
    if text.startswith("DynArray["):
        inner = text[len("DynArray["):].rsplit(",", 1)[0]
        return f"{_abi_type(inner)}[]"
    return text


def _signature(name: str, params: str) -> str:
    args = [_abi_type(p.split(":", 1)[1]) for p in params.split(",")
            if ":" in p] if params.strip() else []
    return f"{name}({','.join(args)})"

#: What `ElectricRouter` calls.  Grouped as the contract groups them.
ROUTER = {
    # ERC20, and the wrappers that wear its shape
    "totalSupply()",
    # discovery: which spelling, which token
    "coins(uint256)", "coins(int128)",
    "lp_token()", "token()",
    "asset()", "underlying()", "UNDERLYING_ASSET_ADDRESS()", "stETH()",
    # swaps
    "exchange(int128,int128,uint256,uint256)",
    "exchange(uint256,uint256,uint256,uint256)",
    "exchange(uint256,uint256,uint256,uint256,bool)",
    # deposits: N is part of the signature
    "add_liquidity(uint256[],uint256)",
    *(f"add_liquidity(uint256[{n}],uint256)" for n in range(2, 9)),
    # withdrawals
    "remove_liquidity_one_coin(uint256,int128,uint256)",
    "remove_liquidity_one_coin(uint256,uint256,uint256)",
    # wrappers
    "deposit()", "deposit(uint256)", "deposit(uint256,address)",
    "withdraw(uint256)", "redeem(uint256)", "redeem(uint256,address,address)",
    "mint(uint256)", "wrap(uint256)", "unwrap(uint256)", "submit(address)",
}

#: What `RouteQuoter` calls.  Every one is a view; none of them move anything.
QUOTER = {
    "totalSupply()", "virtual_price()",
    "admin_fee()", "ADMIN_FEE()", "xcp_profit()", "xcp_profit_a()",
    "get_dy(int128,int128,uint256)", "get_dy(uint256,uint256,uint256)",
    "calc_token_amount(uint256[],bool)",
    *(f"calc_token_amount(uint256[{n}])" for n in range(2, 9)),
    *(f"calc_token_amount(uint256[{n}],bool)" for n in range(2, 9)),
    "calc_withdraw_one_coin(uint256,int128)",
    "calc_withdraw_one_coin(uint256,uint256)",
    "previewDeposit(uint256)", "previewRedeem(uint256)",
    "getStETHByWstETH(uint256)", "getWstETHByStETH(uint256)",
    "exchangeRateStored()",
}

EXPECTED = {"ElectricRouter": ROUTER, "RouteQuoter": QUOTER}


def spelled(name: str) -> set[str]:
    """Every signature the contract states, however it states it.

    Two ways, and both have to be covered or moving a call from one to the
    other reads as a signature disappearing.  `raw_call` spells it as a string;
    an `interface` declares it and the compiler spells it.
    """
    text = (CONTRACTS / f"{name}.vy").read_text()
    out = set(LITERAL.findall(text))
    if INTERFACE.search(text):
        # Interface bodies are the only four-space `def`s at module level.
        body = text[INTERFACE.search(text).start():]
        body = body[:body.index("\n@")] if "\n@" in body else body
        out |= {_signature(n, p) for n, p in DECLARED.findall(body)}
    return out


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_the_contract_spells_exactly_what_is_expected(name):
    got, want = spelled(name), EXPECTED[name]
    assert got - want == set(), f"{name} gained: {sorted(got - want)}"
    assert want - got == set(), f"{name} lost: {sorted(want - got)}"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_signature_is_one_the_abi_can_parse(name):
    """A malformed type is the typo a selector cannot show you."""
    for sig in sorted(spelled(name)):
        assert re.fullmatch(r"[A-Za-z_]\w*\([^()]*\)", sig), f"{sig} is not a signature"
        for arg in signature_types(sig):
            parse_type(arg)                    # raises on anything it cannot read


def test_no_two_signatures_collide():
    """Two spellings sharing a selector would dispatch to one of them."""
    for name, sigs in EXPECTED.items():
        seen: dict[bytes, str] = {}
        for sig in sorted(sigs):
            clash = seen.setdefault(selector(sig), sig)
            assert clash == sig, f"{name}: {sig} and {clash} share a selector"


#: The pairing that has to hold across the two contracts: a leg priced with one
#: index type must be executed with the same one.  Getting this wrong quotes a
#: pool through one ABI and trades it through another, and both calls succeed.
DIALECT = {
    ArcKind.SWAP_STABLE: ("get_dy(int128,int128,uint256)",
                          "exchange(int128,int128,uint256,uint256)"),
    ArcKind.SWAP_CRYPTO: ("get_dy(uint256,uint256,uint256)",
                          "exchange(uint256,uint256,uint256,uint256)"),
    ArcKind.WITHDRAW_STABLE: ("calc_withdraw_one_coin(uint256,int128)",
                              "remove_liquidity_one_coin(uint256,int128,uint256)"),
    ArcKind.WITHDRAW_CRYPTO: ("calc_withdraw_one_coin(uint256,uint256)",
                              "remove_liquidity_one_coin(uint256,uint256,uint256)"),
}


@pytest.mark.parametrize("kind", sorted(DIALECT, key=int))
def test_a_kind_is_priced_and_executed_through_the_same_index_type(kind):
    quoted, executed = DIALECT[kind]
    assert quoted in spelled("RouteQuoter"), f"{kind.name}: quoter lost {quoted}"
    assert executed in spelled("ElectricRouter"), f"{kind.name}: router lost {executed}"
    indexes = ("int128" in quoted, "int128" in executed)
    assert indexes[0] == indexes[1], (
        f"{kind.name} is quoted by {quoted} and executed by {executed} -- one "
        f"takes int128 and the other uint256, so the two disagree about the pool")
