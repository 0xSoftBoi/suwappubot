"""One pool touched once, with several ports.

A pool with `N` coins can serve more than two ports in a single interaction:

    XDAI -> (3pool) -> 3Crv + USDC.e
    DAI  -> (3pool) -> USDC + USDT

Modelled as separate arcs those are two entries into one pool, which is two
`psi^2/2G` terms with no cross-term and two calibrations against a state only
the first of them will see.  Modelled as one **element** the pool appears
once, so there is no stale second calibration and nothing to cross-couple --
decision 3 is satisfied by construction rather than enforced.

This module is the representation and the arithmetic.  It does not touch the
solve; see `docs/multi-port-elements.md` for why that is a separate step.

The port bound is the structure's, not a cap:

    #coin-ports in + #coin-ports out <= N

because each port occupies a distinct coin.  One coin cannot be both an
input and an output -- that is a wash -- and two input ports on one coin are
just one larger port, so ports map injectively onto coins.  The **LP token
is not one of the `N`** and so consumes no slot: counting it would reject
`add_liquidity` of both coins of a 2-coin pool, which is a real operation.
"""

from __future__ import annotations

from dataclasses import dataclass

#: A port on the LP token rather than on one of the pool's coins.
LP = -1


class MultiPortError(Exception):
    pass


#: Shares are integers, in basis points, and the last port on a side takes
#: the remainder.  Not a style choice: `int(amount * 0.25)` on a wei-scale
#: integer silently loses the low digits -- float64 carries ~15 of them and a
#: 400,000-token deposit needs 24 -- so a float split disagrees with the
#: integer one it is meant to stand for.  This is also the arithmetic
#: `Leg.bps` already executes, so an element splits the way the router does.
BPS = 10_000


@dataclass(frozen=True, slots=True)
class Port:
    """One side of an element: which token, and its share of that side."""

    coin: int          # a coin index, or `LP`
    bps: int           # share of this side's total, in basis points


@dataclass(frozen=True, slots=True)
class MultiPort:
    """`inputs -> outputs` through one pool, priced on advancing state."""

    pool: str
    n_coins: int
    inputs: tuple[Port, ...]
    outputs: tuple[Port, ...]

    def __post_init__(self) -> None:
        if not self.inputs or not self.outputs:
            raise MultiPortError("an element needs a port on each side")
        coins_in = [p.coin for p in self.inputs if p.coin != LP]
        coins_out = [p.coin for p in self.outputs if p.coin != LP]
        seen = coins_in + coins_out
        for coin in seen:
            if not (0 <= coin < self.n_coins):
                raise MultiPortError(f"coin {coin} out of range")
        if len(set(seen)) != len(seen):
            # The injection that makes the bound below the right one: a coin
            # on both sides is a wash, and twice on one side is one port.
            raise MultiPortError("a coin may hold at most one port")
        if len(seen) > self.n_coins:
            raise MultiPortError(
                f"{len(seen)} coin-ports on a {self.n_coins}-coin pool")
        if sum(p.coin == LP for p in self.inputs) > 1 or \
                sum(p.coin == LP for p in self.outputs) > 1:
            raise MultiPortError("one LP port per side")
        for side, name in ((self.inputs, "inputs"), (self.outputs, "outputs")):
            if any(not (0 < p.bps <= BPS) for p in side):
                raise MultiPortError(f"{name}: shares must be in (0, {BPS}]")
            if sum(p.bps for p in side) != BPS:
                raise MultiPortError(f"{name}: shares must sum to {BPS}")

    @property
    def ports(self) -> int:
        return len(self.inputs) + len(self.outputs)


def _split(ports, total: int):
    """`(port, amount)` per port, in integers, last one taking the rest."""
    left = total
    for k, port in enumerate(ports):
        share = left if k == len(ports) - 1 else total * port.bps // BPS
        left -= share
        yield port, share


def evaluate(element: MultiPort, pool, lp, amount_in: int) -> tuple[list[int], object, object]:
    """`(outputs, pool after, lp after)` for one unit of `element`.

    `pool` is a `StableSwap` and `lp` its `StableSwapLP`, or `None` when the
    element has no LP port.  Every leg is priced against the pool as the
    previous leg left it, which is what makes this one element rather than
    several arcs: the coupling *is* the advancing state.

    Two shapes are served today, which are the ones that arise:

    * **one in, many out** -- split the input by the output weights, then one
      `exchange` per coin port and one `add_liquidity` for an LP port;
    * **many in, one out** -- an `add_liquidity` whose amounts vector is the
      input weights, which is a single call and needs no ordering.

    The general `j`-in-`k`-out case needs a pairing rule between the sides and
    is deliberately refused rather than guessed at.
    """
    if amount_in <= 0:
        raise MultiPortError("nothing to route")
    if len(element.inputs) > 1 and len(element.outputs) > 1:
        raise MultiPortError("many-in many-out needs a pairing rule")

    if len(element.inputs) > 1:
        # k in, 1 out.  Only the LP token can absorb several coins at once.
        out = element.outputs[0]
        if out.coin != LP or lp is None:
            raise MultiPortError("several inputs pay only an LP port")
        amounts = [0] * element.n_coins
        for port, share in _split(element.inputs, amount_in):
            if port.coin == LP:
                raise MultiPortError("an LP input cannot join a deposit")
            amounts[port.coin] = share
        minted, after = lp.add_liquidity(amounts)
        return [minted], after.pool, after

    # 1 in, k out.
    source = element.inputs[0]
    outs: list[int] = []
    for port, share in _split(element.outputs, amount_in):
        if share <= 0:
            raise MultiPortError("a port was allocated nothing")
        if port.coin == LP:
            if lp is None or source.coin == LP:
                raise MultiPortError("no LP model for an LP port")
            amounts = [0] * element.n_coins
            amounts[source.coin] = share
            minted, lp = lp.add_liquidity(amounts)
            pool = lp.pool
            outs.append(minted)
        elif source.coin == LP:
            if lp is None:
                raise MultiPortError("no LP model for an LP input")
            outs.append(lp.calc_withdraw_one_coin(share, port.coin))
        else:
            dy, pool = pool.exchange(source.coin, port.coin, share)
            if lp is not None:
                from dataclasses import replace
                lp = replace(lp, pool=pool)
            outs.append(dy)
    return outs, pool, lp


def best_split(element: MultiPort, pool, lp, amount_in: int, value,
               *, grid: int = 25) -> tuple[MultiPort, float]:
    """The two-port split that maximises what the element pays out.

    `value(port_index, amount) -> float` prices each port's token, because the
    ports pay different tokens and only the caller knows what they are worth.

    This is the piece the pin sweep approximates.  §6.3 sweeps an allocation
    over `psi* x {0, 1/8, 1/4, 1/2, 1, 2, 4}` because the model underneath it
    cannot be trusted; here the element's own arithmetic *is* trustworthy --
    it advances the pool between legs, matching execution to within a wei on
    the shapes tested -- so the split can be optimised rather than bracketed.

    Ternary search, because the objective is concave in the split: each port's
    output is concave in its own share, and a sum of concave functions of a
    linear split is concave.  That holds for `exchange` and `add_liquidity` on
    a stableswap in its normal range; it is not asserted for a pool being
    pushed off its peg, where §2.5's split arcs apply and the caller should
    not be here.  Falls back to the best grid point if the search leaves the
    feasible interior.

    Only two ports.  Three needs a simplex search and no caller wants one yet.
    """
    if len(element.inputs) != 1 or len(element.outputs) != 2:
        raise MultiPortError("best_split is for one-in two-out elements")

    def payout(bps: int) -> float:
        try:
            outs, _, _ = evaluate(_at(element, bps), pool, lp, amount_in)
        except (MultiPortError, ArithmeticError, ValueError):
            return float("-inf")
        return sum(value(k, out) for k, out in enumerate(outs))

    low, high = 1, BPS - 1
    for _ in range(grid):
        if high - low < 3:
            break
        left = low + (high - low) // 3
        right = high - (high - low) // 3
        if payout(left) < payout(right):
            low = left
        else:
            high = right
    best = max(range(low, high + 1), key=payout)
    found = payout(best)
    if found == float("-inf"):
        raise MultiPortError("no feasible split")
    return _at(element, best), found


def _at(element: MultiPort, bps: int) -> MultiPort:
    """`element` with its two output ports split `bps` / `BPS - bps`."""
    first, second = element.outputs
    return MultiPort(pool=element.pool, n_coins=element.n_coins,
                     inputs=element.inputs,
                     outputs=(Port(first.coin, bps),
                              Port(second.coin, BPS - bps)))


#: Arc kinds an element can price, and which side of the pool each port sits on.
#: A withdrawal is absent for the same reason `realize.ADVANCEABLE` omits it:
#: `remove_liquidity_one_coin`'s effect on the supply has not been read off the
#: deployed source, and an element prices on advancing state or not at all.
def ports_of(kind, i: int, j: int) -> tuple[int, int]:
    """`(input port, output port)` for one leg, `LP` for the LP token."""
    name = kind.name if hasattr(kind, "name") else str(kind)
    if name.startswith("SWAP"):
        return i, j
    if name.startswith("DEPOSIT"):
        return i, LP
    if name.startswith("WITHDRAW"):
        return LP, j
    raise MultiPortError(f"{name} is not a port of a pool")


def element_of(legs) -> MultiPort:
    """The element a pool's legs form, or `MultiPortError` saying why not.

    This is what replaces the re-entry exemption.  Two arcs of one pool used to
    be admitted when every leg but the last could be advanced past, which priced
    them as two independent resistors -- no cross-term, each calibrated at a
    state the other never sees.  An element is the same trade with the pool
    appearing *once*, so the coupling is the advancing state rather than
    something the model has to carry separately, and the port bound is
    structural: `#coin-ports in + #coin-ports out <= N`, because a coin holds at
    most one port.  A 2-coin pool therefore admits exactly one in and one out --
    it cannot be re-entered at all, which is the whole point.

    Shares are left at whatever the legs already carry; `best_split` is what
    chooses them.  Here the question is only whether the shape is admissible.
    """
    legs = list(legs)
    if not legs:
        raise MultiPortError("no legs")
    return element_from(legs[0].target, legs[0].leg.n,
                        [(rl.kind, rl.leg.i, rl.leg.j) for rl in legs])


def element_of_arcs(arcs) -> MultiPort:
    """The same rule on `PoolArc`s, before realisation orders them into legs."""
    arcs = list(arcs)
    if not arcs:
        raise MultiPortError("no arcs")
    return element_from(arcs[0].pool, arcs[0].n_coins,
                        [(a.kind, a.i, a.j) for a in arcs])


def element_from(pool: str, n_coins: int, triples) -> MultiPort:
    """The element `(kind, i, j)` triples on one pool form, or why they do not."""
    pool = pool.lower()
    triples = list(triples)
    # `dict.fromkeys` keeps order and dedupes: several legs drawing on one coin
    # are *one* input port, which is what makes 1-in-k-out a single element.
    # A coin appearing on both sides is a wash and `MultiPort` refuses it there,
    # along with the `#in + #out <= N` bound.
    ins: dict[int, None] = {}
    outs: dict[int, None] = {}
    for kind, i, j in triples:
        source, sink = ports_of(kind, i, j)
        ins.setdefault(source)
        outs.setdefault(sink)
    # An LP *input* would be several `calc_withdraw_one_coin` against one state:
    # `evaluate` cannot advance a withdrawal, because its effect on the supply
    # has not been read off the deployed source.  Pricing two burns against the
    # same supply is the error an element exists to prevent, so refuse it here
    # rather than answer confidently.  Same omission as `realize.ADVANCEABLE`.
    if LP in ins and len(outs) > 1:
        raise MultiPortError("a multi-output withdrawal cannot be advanced")
    # Built first, so the injection and the `#in + #out <= N` bound answer
    # before the shape does -- "a coin may hold at most one port" is the useful
    # thing to say about a re-entered 2-coin pool.
    element = MultiPort(pool=pool, n_coins=n_coins,
                        inputs=_even(ins), outputs=_even(outs))
    if len(ins) > 1 and len(outs) > 1:
        raise MultiPortError("many-in many-out needs a pairing rule")
    # One leg per port on the many side.  Two arcs sharing *both* ports dedupe
    # to a 1-in-1-out and would read as admissible; they are not an element but
    # §9.5's duplicate pair, which belongs in the graph as parallel resistors
    # and in a route as one leg.
    if len(triples) != max(len(ins), len(outs)):
        raise MultiPortError(
            f"{len(triples)} legs over {len(ins)}-in {len(outs)}-out: "
            "duplicate ports are a parallel pair, not an element")
    return element


def _even(coins) -> tuple[Port, ...]:
    """Equal shares over `coins`, the last taking the remainder.

    A placeholder: `element_of` answers whether the *shape* is admissible, and
    `best_split` is what chooses the shares.  Even is the honest starting point
    -- it asserts nothing about the split the solver wanted.
    """
    coins = list(coins)
    each = BPS // len(coins)
    return tuple(Port(coin, each if k < len(coins) - 1 else BPS - each * (len(coins) - 1))
                 for k, coin in enumerate(coins))
