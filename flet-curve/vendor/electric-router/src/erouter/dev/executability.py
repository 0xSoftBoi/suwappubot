"""Which arcs quote and then revert, learned once by trying them.

`get_dy` runs a pool's invariant over its own accounting.  It does not ask
whether the coins exist, whether the protocol beneath will take a deposit, or
whether anyone paused anything -- so a quote can be a faithful reading of a
fiction.  Three shapes of that, all live on mainnet today:

* **Frozen reserves.**  Aave V2's pool quotes 9,996 USDC for 10k DAI and reverts,
  because `exchange_underlying` has to deposit into a frozen reserve.
* **Paused mint.**  Compound V2 answers "mint is paused" to the same move, while
  `USDT->DAI` through the same family executes -- that direction only *redeems*.
* **Retired tokens.**  sUSD/sUSDe quoted 6.5x and reverted with "sUSD retired".
  `check_reserves_are_real` catches that one from the balances; the other two
  leave no trace in state at all.

None of it is visible without executing, and none of it changes between blocks,
which is the shape of a fact worth storing.  So this runs when the facts file is
built and the router reads the answer.

Deprecated protocols stop taking deposits long before they stop honouring
withdrawals, so capability is recorded per direction.  That is what lets a
lending pool keep its redeem arcs instead of being blacklisted whole.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field

from ..chain.gas_probe import (
    CALLER,
    Funder,
    _pad,
    revert_reason,  # re-exported: callers read it from here
)
from ..core.keccak import keccak256

__all__ = ["WRAPPER_CALLS", "Capability", "discover_wrappers",
           "refused_by_protocol", "revert_reason", "try_wrapper"]


#: How each wrapper is entered and left.  `None` means the protocol has no such
#: call, which is not the same as the call failing.
WRAPPER_CALLS = {
    "ctoken": {
        "mint": lambda token, underlying, amount, owner: (
            token, keccak256(b"mint(uint256)")[:4] + _pad(amount), underlying),
        "redeem": lambda token, underlying, amount, owner: (
            token, keccak256(b"redeem(uint256)")[:4] + _pad(amount), token),
    },
    "erc4626": {
        "mint": lambda token, underlying, amount, owner: (
            token, keccak256(b"deposit(uint256,address)")[:4] + _pad(amount) + _pad(owner),
            underlying),
        "redeem": lambda token, underlying, amount, owner: (
            token,
            keccak256(b"redeem(uint256,address,address)")[:4]
            + _pad(amount) + _pad(owner) + _pad(owner),
            token),
    },
}


@dataclass(slots=True)
class Capability:
    """What a wrapper will still do.  `None` means untested, not refused.

    The distinction is the whole point.  cUSDC's redeem could not be funded --
    conjuring a cToken means writing a balance the protocol computes rather
    than stores -- and reporting that as "cannot redeem" would deny a working
    arc for the rest of the file's life.  A direction is only ever recorded
    once it has actually been attempted.
    """

    address: str
    family: str
    mint: bool | None = None
    redeem: bool | None = None
    notes: dict = field(default_factory=dict)


def refused_by_protocol(exc: Exception) -> bool:
    """Did the contract say no, or did the harness fail to ask?

    revm reports the two differently and the difference is the whole verdict.
    `Revert {...}` and `Halt {...}` come from executing the contract -- that is a
    refusal.  `Transaction(...)` is rejected before execution begins, and the ones
    seen here are entirely about the caller: `RejectCallerWithCode` is EIP-3607
    refusing an account with code, which is what impersonating a pool asks for,
    and `LackOfFundForMaxFee` is an unfunded caller.  Neither says anything about
    the token.

    Recording those as refusals is how thirteen vaults came to be marked
    unredeemable in one run -- and `redeem: false` is what gates a merge.
    """
    # boa raises `BoaError` precisely when the contract call failed, and its
    # message is a formatted trace that contains the word "revert" nowhere.
    # Matching on the text alone recorded every refusal as untested -- sUSDe,
    # which is the whole reason this probe exists, among them.
    if type(exc).__name__ == "BoaError":
        return True
    text = str(exc)
    if "Transaction(" in text:
        return False
    return "Revert" in text or "Halt" in text or "revert" in text.lower()


def _obtain(evm, funder: Funder, token: str, spender: str, amount: int,
            holders: dict | None) -> str:
    """Get `amount` of `token` into someone's hands, and say whose.

    Writing the balance slot works for an ordinary ERC20.  It does not work for
    a token whose balance is *computed* -- a rebasing supply, a share converted
    at a rate -- so the fallback borrows from an address that already holds
    some, which for these tokens is a pool's own reserves.  Returns "" when
    neither works, which is untested rather than refused.
    """
    if funder.fund(token, spender, amount * 2):
        return CALLER
    holder = (holders or {}).get(token.lower(), "")
    if holder:
        lent = funder.lend_from(token, holder, spender, amount)
        if lent is not None:
            evm.set_balance(lent, 10 ** 20)
            return lent
    return ""


def try_wrapper(evm, funder: Funder, *, token: str, underlying: str, family: str,
                amount: int, holders: dict | None = None) -> Capability:
    """Can this wrapper still be entered, and can it still be left?

    Both are attempted independently, because on a deprecated protocol they
    genuinely differ: Compound V2 answers "mint is paused" and redeems fine,
    sUSDe mints on demand and refuses redemption inside seven days.

    Redemption is the harder one to test, because it needs the share token and
    a share balance is not a slot to write.  So it is tested by becoming an
    address that already holds some -- a pool's own reserves -- and redeeming
    part of what it has.
    """
    out = Capability(address=token.lower(), family=family)
    calls = WRAPPER_CALLS.get(family)
    if calls is None:
        return out

    mint_target, mint_data, mint_spend = calls["mint"](token, underlying, amount, CALLER)
    snapshot = evm.snapshot()
    try:
        caller = _obtain(evm, funder, mint_spend, mint_target, amount, holders)
        if not caller:
            out.notes["mint"] = "not funded"
        else:
            try:
                evm.message_call(caller=caller, to=mint_target, calldata=mint_data)
                out.mint = True
            except Exception as exc:
                out.mint = False if refused_by_protocol(exc) else None
                out.notes["mint"] = revert_reason(exc)
    finally:
        with contextlib.suppress(Exception):
            evm.revert(snapshot)

    # Redemption is tested on shares that already exist.  Minting some first and
    # redeeming those would be a different question with the same shape: a vault
    # with a cooldown refuses a share minted a moment ago while honouring one an
    # owner has held for a week, so fresh shares manufacture refusals no real
    # holder would meet.  A pool's reserves have been sitting there, which is
    # exactly the position a router would redeem from.
    #
    # No approval is needed to burn your own, so becoming the holder is the whole
    # trick.
    snapshot = evm.snapshot()
    try:
        caller, shares = "", 0
        if funder.fund(token, token, amount * 2):
            caller, shares = CALLER, amount
        else:
            holder = (holders or {}).get(token.lower(), "")
            held = max(0, funder.balance_of(token, holder)) if holder else 0
            if held > 0:
                # Half of what it holds, so the redemption is a real one and
                # still cannot be refused for asking beyond the balance.
                caller, shares = holder, max(min(amount, held // 2), 1)
                evm.set_balance(caller, 10 ** 20)
        if not caller or shares <= 0:
            out.notes.setdefault("redeem", "no holder to redeem from")
        else:
            target, data, _ = calls["redeem"](token, underlying, shares, caller)
            try:
                evm.message_call(caller=caller, to=target, calldata=data)
                out.redeem = True
            except Exception as exc:
                # Only the contract's own refusal counts.  Anything rejected
                # before it ran is this harness's limit, not the vault's.
                out.redeem = False if refused_by_protocol(exc) else None
                out.notes["redeem"] = revert_reason(exc)
    finally:
        with contextlib.suppress(Exception):
            evm.revert(snapshot)
    return out


def discover_wrappers(pools, client) -> list[tuple[str, str, str]]:
    """Every coin that wraps another token, found by asking rather than listing.

    Mintability and redeemability are properties of a *token*, not of a pool or a
    swap, and the asymmetry is everywhere once looked for: Compound's mint is
    paused while redeem works, Aave's reserves are frozen, sUSDe mints on demand
    and redeems on a seven-day cooldown, pufETH redeems through a queue, sfrxUSD
    reports `maxDeposit == 0`.  E8 found thirty-one linear ERC4626 tokens and
    concluded that linearity says nothing about whether you can get back out.

    Executing both directions answers what the merge allowlist is guessing at, so
    the discovery has to be universal: every coin of every pool at every index,
    not a list someone maintains.

    `asset()` identifies an ERC4626 vault and `underlying()` a cToken.  Both are
    view calls and go out in one batch.
    """
    from ..core.codec import encode_call
    from ..core.transport import Call, Status

    tokens = sorted({coin.address.lower() for pool in pools for coin in pool.coins})
    if not tokens:
        return []
    calls: list[Call] = []
    for token in tokens:
        calls.append(Call(token, encode_call("asset()")))
        calls.append(Call(token, encode_call("underlying()")))
    answers = client.raw(calls)

    found: list[tuple[str, str, str]] = []
    for k, token in enumerate(tokens):
        for answer, family in ((answers[2 * k], "erc4626"),
                               (answers[2 * k + 1], "ctoken")):
            if answer.status is not Status.VALUE or len(answer.data) < 32:
                continue
            underlying = "0x" + answer.data[-20:].hex()
            if int(underlying, 16) == 0 or underlying == token:
                continue
            found.append((token, underlying, family))
            break
    return found


# --- the same questions, asked where impersonation is allowed --------------
#
# revm refuses a caller that has code (EIP-3607), and every holder of these
# tokens is a pool, so borrowing from one is impossible there -- which left 19
# redemptions untestable.  boa's fork env has no such rule: `prank` makes any
# address the sender, including a contract.  Slower than revm, which is why
# quoting does not use it, but this runs once per facts build.

MINIMAL_ERC20 = """[
  {"name":"balanceOf","type":"function","stateMutability":"view",
   "inputs":[{"name":"a","type":"address"}],"outputs":[{"name":"","type":"uint256"}]},
  {"name":"approve","type":"function","stateMutability":"nonpayable",
   "inputs":[{"name":"s","type":"address"},{"name":"v","type":"uint256"}],"outputs":[]}
]"""

WRAPPER_ABI = {
    "ctoken": """[
      {"name":"mint","type":"function","stateMutability":"nonpayable",
       "inputs":[{"name":"a","type":"uint256"}],"outputs":[]},
      {"name":"redeem","type":"function","stateMutability":"nonpayable",
       "inputs":[{"name":"a","type":"uint256"}],"outputs":[]}
    ]""",
    "erc4626": """[
      {"name":"deposit","type":"function","stateMutability":"nonpayable",
       "inputs":[{"name":"a","type":"uint256"},{"name":"r","type":"address"}],
       "outputs":[]},
      {"name":"redeem","type":"function","stateMutability":"nonpayable",
       "inputs":[{"name":"s","type":"uint256"},{"name":"r","type":"address"},
                 {"name":"o","type":"address"}],"outputs":[]}
    ]""",
}


def probe_wrappers_by_prank(wrappers, holders, *, share: int = 4) -> list[Capability]:
    """Mint and redeem as an address that actually holds the tokens.

    `holders` maps a token to someone holding it.  Each attempt runs inside an
    `anchor()` so nothing it does survives, and `prank` makes the holder the
    sender -- which is the whole point, since the holders are contracts.

    `share` is the divisor applied to the holder's balance: a quarter of what
    it has is a real redemption, and cannot be refused merely for exceeding the
    balance.  Both directions are attempted independently, and a direction that
    could not be attempted stays `None` -- untested, never refused.
    """
    import boa

    out: list[Capability] = []
    for token, underlying, family in wrappers:
        got = Capability(address=token.lower(), family=family)
        abi = WRAPPER_ABI.get(family)
        if abi is None:
            out.append(got)
            continue
        contract = boa.loads_abi(abi).at(token)
        erc20 = boa.loads_abi(MINIMAL_ERC20)

        for direction, spend_token in (("mint", underlying), ("redeem", token)):
            holder = (holders or {}).get(spend_token.lower(), "")
            if not holder:
                got.notes[direction] = "no holder"
                continue
            try:
                with boa.env.anchor():
                    held = erc20.at(spend_token).balanceOf(holder)
                    if held <= 0:
                        got.notes[direction] = "holder is empty"
                        continue
                    amount = max(held // share, 1)
                    with boa.env.prank(holder):
                        if direction == "mint":
                            erc20.at(spend_token).approve(token, amount)
                            if family == "ctoken":
                                contract.mint(amount)
                            else:
                                contract.deposit(amount, holder)
                        elif family == "ctoken":
                            contract.redeem(amount)
                        else:
                            contract.redeem(amount, holder, holder)
                    setattr(got, direction, True)
            except Exception as exc:
                # boa surfaces the contract's revert; anything else is this
                # harness failing to ask, which is not a refusal.
                if refused_by_protocol(exc) or "revert" in str(exc).lower():
                    setattr(got, direction, False)
                got.notes[direction] = revert_reason(exc)
        out.append(got)
    return out
