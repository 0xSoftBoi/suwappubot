# pragma version 0.4.3
"""
@title RouteExecutor
@author Curve.Fi
@license GNU Affero General Public License v3.0 only
@notice Executes the same routing DAG `RouteQuoter` quotes, for real.
@dev A sibling rather than an extra entry point on the quoter, deliberately:

     1. `RouteQuoter` earns its keep by being injected with an `eth_call` state
        override, and that payload is its whole runtime bytecode.  Every branch
        added there is paid on the hot path of every quote, on every chain.  The
        executor is only ever deployed -- under `boa.fork` today, on chain when
        there is a router -- so it costs the quoter nothing.

     2. The quoter must stay `@view` end to end.  Sharing `_walk` between a
        staticcall walk and a state-changing one would mean the state-changing
        version decides its own mutability, and a single mistake there turns
        every quote into a transaction.

     THE LEG ENCODING IS SHARED AND MUST STAY IDENTICAL.  `Leg` is copied field
     for field from `RouteQuoter`, so `erouter.core.types.Leg.as_tuple` encodes
     for both.  A change to one is a change to both.

     WHAT IT ADDS is `tokens`: slot index -> token address.  Quoting needs only
     the numbers, so the quoter never has to know what a slot holds; executing
     has to approve the right ERC20 and count the right balance.  Slots are one
     per token by construction (`realize.slot`), aliases sharing one, so the map
     is total and unambiguous.

     AMOUNTS ARE MEASURED, NEVER BELIEVED.  Legacy Curve pools return nothing
     from `exchange`, newer ones return `dy`, `add_liquidity` varies the same
     way, and a fee-on-transfer token makes every one of them a lie.  So each
     leg is priced by the *balance delta it produced*, which is the only
     definition that is true for all of them and is also what the next leg
     actually has to spend.
"""

MAX_LEGS: public(constant(uint256)) = 128
MAX_SLOTS: public(constant(uint256)) = 128
MAX_COINS: public(constant(uint256)) = 8

BPS: constant(uint256) = 10_000

# The sentinel Curve uses for native ETH in `coins()`.
NATIVE: public(constant(address)) = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE

SWAP_STABLE: constant(uint8) = 0
SWAP_CRYPTO: constant(uint8) = 1
DEPOSIT_FIXED: constant(uint8) = 2
DEPOSIT_DYN: constant(uint8) = 3
DEPOSIT_FIXED_NOFLAG: constant(uint8) = 4
WITHDRAW_STABLE: constant(uint8) = 5
WITHDRAW_CRYPTO: constant(uint8) = 6
ERC4626_DEPOSIT: constant(uint8) = 7
ERC4626_REDEEM: constant(uint8) = 8
WRAP_NATIVE: constant(uint8) = 9
UNWRAP_NATIVE: constant(uint8) = 10
WSTETH_UNWRAP: constant(uint8) = 11
WSTETH_WRAP: constant(uint8) = 12
STAKE_NATIVE: constant(uint8) = 13
LEND_MINT: constant(uint8) = 15
LEND_REDEEM: constant(uint8) = 16


struct Leg:
    target: address
    kind: uint8
    i: uint8
    j: uint8
    n: uint8
    src_slot: uint8
    dst_slot: uint8
    bps: uint16


# --------------------------------------------------------------- ERC20


@internal
@view
def _held(token: address) -> uint256:
    if token == NATIVE:
        return self.balance
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        token,
        concat(method_id("balanceOf(address)"), abi_encode(self)),
        max_outsize=32,
        is_static_call=True,
        revert_on_failure=False,
    )
    assert ok and len(out) == 32, "balanceOf failed"
    return abi_decode(out, uint256)


@internal
def _approve(token: address, spender: address, amount: uint256):
    """Allowance for exactly this leg.  Native needs none.

    Reset to zero first and decode nothing back: USDT reverts on a non-zero to
    non-zero change and returns no data at all, so both the belt and the braces
    are load-bearing on mainnet's most-routed token.
    """
    if token == NATIVE:
        return
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        token,
        concat(method_id("approve(address,uint256)"), abi_encode(spender, empty(uint256))),
        max_outsize=32,
        revert_on_failure=False,
    )
    ok, out = raw_call(
        token,
        concat(method_id("approve(address,uint256)"), abi_encode(spender, amount)),
        max_outsize=32,
        revert_on_failure=False,
    )
    assert ok, "approve failed"


@internal
def _transfer(token: address, to: address, amount: uint256):
    if amount == 0:
        return
    if token == NATIVE:
        send(to, amount)
        return
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        token,
        concat(method_id("transfer(address,uint256)"), abi_encode(to, amount)),
        max_outsize=32,
        revert_on_failure=False,
    )
    assert ok, "transfer failed"


@internal
def _pull(token: address, owner: address, amount: uint256):
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        token,
        concat(
            method_id("transferFrom(address,address,uint256)"),
            abi_encode(owner, self, amount),
        ),
        max_outsize=32,
        revert_on_failure=False,
    )
    assert ok, "transferFrom failed"


# --------------------------------------------------------------- calldata


@internal
@pure
def _amounts_calldata(i: uint8, n: uint8, dx: uint256) -> Bytes[256]:
    words: uint256[MAX_COINS] = empty(uint256[MAX_COINS])
    words[convert(i, uint256)] = dx
    return slice(abi_encode(words), 0, 32 * convert(n, uint256))


@internal
@pure
def _add_liquidity_selector(n: uint8) -> Bytes[4]:
    """`add_liquidity(uint256[N],uint256)` -- N is part of the signature.

    One spelling for all three DEPOSIT kinds: they differ in how
    `calc_token_amount` is asked, which is a quoting distinction, not an
    executing one.
    """
    if n == 2:
        return method_id("add_liquidity(uint256[2],uint256)")
    if n == 3:
        return method_id("add_liquidity(uint256[3],uint256)")
    if n == 4:
        return method_id("add_liquidity(uint256[4],uint256)")
    if n == 5:
        return method_id("add_liquidity(uint256[5],uint256)")
    if n == 6:
        return method_id("add_liquidity(uint256[6],uint256)")
    if n == 7:
        return method_id("add_liquidity(uint256[7],uint256)")
    if n == 8:
        return method_id("add_liquidity(uint256[8],uint256)")
    return b""


@internal
def _send(target: address, data: Bytes[512], wei_value: uint256) -> bool:
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        target, data, max_outsize=32, value=wei_value, revert_on_failure=False
    )
    return ok


# --------------------------------------------------------------- one leg


@internal
def _execute(
    target: address, kind: uint8, i: uint8, j: uint8, n: uint8, dx: uint256,
    token_in: address,
) -> bool:
    """The state-changing twin of `RouteQuoter._quote`.

    `min_out` is zero on every leg on purpose.  This contract exists to find out
    what a route really pays, and a slippage bound would turn a bad answer into
    a revert -- which is exactly the information being sought.  A router built
    on this must set them; a measurement must not.
    """
    if kind == WRAP_NATIVE:
        if token_in == NATIVE:
            # WETH and its siblings: payable `deposit()`, value carries the amount.
            return self._send(target, method_id("deposit()"), dx)
        # A 1:1 *token* adapter wearing the same kind.  Gnosis's USDC
        # transmuter takes `deposit(uint256)`, is not payable, and needs an
        # allowance -- so the payable spelling reverts on it, and every route
        # crossing that adapter failed to execute while quoting perfectly well.
        # Measured: it is on the path for USDC -> USDC.e, worth 55 bp there.
        self._approve(token_in, target, dx)
        return self._send(
            target, concat(method_id("deposit(uint256)"), abi_encode(dx)), 0
        )

    if kind == UNWRAP_NATIVE:
        # One spelling covers both: WETH burns the caller's balance and the
        # adapter pulls it, so the allowance is harmless in the first case and
        # required in the second.
        self._approve(token_in, target, dx)
        return self._send(
            target, concat(method_id("withdraw(uint256)"), abi_encode(dx)), 0
        )

    if kind == STAKE_NATIVE:
        # Lido: submit(referral) is payable and mints 1:1 in shares.
        return self._send(
            target, concat(method_id("submit(address)"), abi_encode(empty(address))), dx
        )

    self._approve(token_in, target, dx)

    if kind == SWAP_STABLE:
        return self._send(
            target,
            concat(
                method_id("exchange(int128,int128,uint256,uint256)"),
                abi_encode(convert(i, int128), convert(j, int128), dx, empty(uint256)),
            ),
            0,
        )

    if kind == SWAP_CRYPTO:
        if self._send(
            target,
            concat(
                method_id("exchange(uint256,uint256,uint256,uint256)"),
                abi_encode(convert(i, uint256), convert(j, uint256), dx, empty(uint256)),
            ),
            0,
        ):
            return True
        # The older crypto pools take a trailing `use_eth` flag and have no
        # 4-argument overload at all.  Quoting never sees this because `get_dy`
        # is the same shape on both.
        return self._send(
            target,
            concat(
                method_id("exchange(uint256,uint256,uint256,uint256,bool)"),
                abi_encode(
                    convert(i, uint256), convert(j, uint256), dx, empty(uint256), False
                ),
            ),
            0,
        )

    if kind == WITHDRAW_STABLE:
        return self._send(
            target,
            concat(
                method_id("remove_liquidity_one_coin(uint256,int128,uint256)"),
                abi_encode(dx, convert(j, int128), empty(uint256)),
            ),
            0,
        )

    if kind == WITHDRAW_CRYPTO:
        return self._send(
            target,
            concat(
                method_id("remove_liquidity_one_coin(uint256,uint256,uint256)"),
                abi_encode(dx, convert(j, uint256), empty(uint256)),
            ),
            0,
        )

    if kind == ERC4626_DEPOSIT:
        return self._send(
            target,
            concat(method_id("deposit(uint256,address)"), abi_encode(dx, self)),
            0,
        )

    if kind == ERC4626_REDEEM:
        return self._send(
            target,
            concat(
                method_id("redeem(uint256,address,address)"), abi_encode(dx, self, self)
            ),
            0,
        )

    if kind == WSTETH_WRAP:
        return self._send(
            target, concat(method_id("wrap(uint256)"), abi_encode(dx)), 0
        )

    if kind == WSTETH_UNWRAP:
        return self._send(
            target, concat(method_id("unwrap(uint256)"), abi_encode(dx)), 0
        )

    if kind == LEND_MINT:
        return self._send(
            target, concat(method_id("mint(uint256)"), abi_encode(dx)), 0
        )

    if kind == LEND_REDEEM:
        return self._send(
            target, concat(method_id("redeem(uint256)"), abi_encode(dx)), 0
        )

    if kind == DEPOSIT_DYN:
        return self._send(
            target,
            concat(
                method_id("add_liquidity(uint256[],uint256)"),
                abi_encode(convert(64, uint256)),
                abi_encode(empty(uint256)),
                abi_encode(convert(n, uint256)),
                self._amounts_calldata(i, n, dx),
            ),
            0,
        )

    if kind == DEPOSIT_FIXED or kind == DEPOSIT_FIXED_NOFLAG:
        selector: Bytes[4] = self._add_liquidity_selector(n)
        if len(selector) == 0:
            return False
        return self._send(
            target,
            concat(
                selector, self._amounts_calldata(i, n, dx), abi_encode(empty(uint256))
            ),
            0,
        )

    return False


# --------------------------------------------------------------- external


@external
@payable
def execute_route(
    legs: DynArray[Leg, MAX_LEGS],
    tokens: DynArray[address, MAX_SLOTS],
    amount_in: uint256,
    dst_slot: uint8,
    min_out: uint256,
) -> uint256:
    """Run the route and return what the destination token actually gained.

    The caller must have approved `amount_in` of `tokens[0]`, or sent it as
    `msg.value` when slot 0 is native.  Everything the route produces is swept
    back to the caller, so the contract holds nothing between calls and two
    executions cannot contaminate each other.
    """
    assert len(tokens) > 0, "no slot map"
    assert convert(dst_slot, uint256) < len(tokens), "dst_slot outside the slot map"

    src_token: address = tokens[0]
    dst_token: address = tokens[convert(dst_slot, uint256)]
    if src_token == NATIVE:
        assert msg.value == amount_in, "native input needs msg.value"
    else:
        self._pull(src_token, msg.sender, amount_in)

    # Anything already here is not this route's output.  It should be nothing,
    # but measuring the delta rather than the balance is what makes that a
    # property of the answer instead of an assumption about the contract.
    opening: uint256 = self._held(dst_token)

    bal: uint256[MAX_SLOTS] = empty(uint256[MAX_SLOTS])
    bal[0] = amount_in
    cur: uint256 = max_value(uint256)
    base: uint256 = 0

    for k: uint256 in range(MAX_LEGS):
        if k >= len(legs):
            break
        leg: Leg = legs[k]
        src: uint256 = convert(leg.src_slot, uint256)
        dst: uint256 = convert(leg.dst_slot, uint256)
        assert src < len(tokens) and dst < len(tokens), "slot outside the slot map"

        if src != cur:
            cur = src
            base = bal[src]

        dx: uint256 = 0
        if leg.bps == 0:
            dx = bal[src]
        else:
            dx = base * convert(leg.bps, uint256) // BPS
            if dx > bal[src]:
                dx = bal[src]
        if dx == 0:
            continue

        before: uint256 = self._held(tokens[dst])
        assert self._execute(
            leg.target, leg.kind, leg.i, leg.j, leg.n, dx, tokens[src]
        ), "leg reverted"
        gained: uint256 = self._held(tokens[dst]) - before
        assert gained > 0, "leg produced nothing"

        bal[src] -= dx
        bal[dst] += gained

    produced: uint256 = self._held(dst_token) - opening
    assert produced >= min_out, "min_out"

    # Sweep every slot, not just the destination: a leg that rounded down and
    # was skipped leaves its input behind, and silently keeping it would make
    # the executor's own balance a hidden part of the next answer.
    for k: uint256 in range(MAX_SLOTS):
        if k >= len(tokens):
            break
        if k == convert(dst_slot, uint256):
            continue
        self._transfer(tokens[k], msg.sender, self._held(tokens[k]))
    self._transfer(dst_token, msg.sender, produced)
    return produced


@external
@payable
def __default__():
    """WETH's `withdraw` pays back with a bare `call`, and so does Curve."""
    pass
