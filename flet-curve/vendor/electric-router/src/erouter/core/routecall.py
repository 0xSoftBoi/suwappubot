"""Turn a realised route into the calldata `ElectricRouter.execute` takes.

Two conversions happen here, and both are places the router differs from what
the model produced.

**Fractions become fractions of what is left.**  `Leg.bps` is a share of the
balance a node held when its group of outgoing legs opened; the router asks
instead for a share of the balance standing there right now, so a 50/50 split
is `50%` then `100%`.  The second form cannot be starved by a first leg that
returned less than modelled, which is the only reason to prefer it.

**Every leg gets its own minimum rate.**  A single end-to-end bound lets a route
give everything away in one pool and win it back in another -- the shape of a
sandwich.  The bound is a fraction of the fee that pool is measured to be
charging *on this trade*, and what it buys is a ceiling on how much a sandwich
can take: the front-run can only be as large as the bound will still settle.
Where the output token is too coarse to express that fraction -- a trade small
enough that its intermediate is a few thousand raw units -- the ceiling becomes
one unit of that token, which is the finest one it can express.

Whether there is an attack to cap is decided elsewhere.  A leg whose own price
impact is under twice its pool's fee cannot be sandwiched profitably at all --
which every stableswap leg we emit satisfies, and some low-fee cryptoswap legs
do not.  See `docs/router.md` and `tests/test_sandwich.py`.
"""

from __future__ import annotations

import math
from collections.abc import Collection
from dataclasses import dataclass

from .codec import encode_call
from .realize import RealizedRoute
from .types import ArcKind

ONE = 10**18

#: Curve's sentinel for native ETH.
NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

MAX_LEGS = 32
MAX_TOKENS = 31

# Packing, low bit first.  Must match `contracts/ElectricRouter.vy`.
FRAC_SHIFT, FRAC_BITS = 0, 60
RATE_SHIFT, RATE_BITS = 60, 128
I_SHIFT = 188
J_SHIFT = 192
N_SHIFT = 196
KIND_SHIFT = 200
IN_REF_SHIFT = 205
OUT_REF_SHIFT = 210
RESERVED_SHIFT = 215

MAX_RATE = (1 << RATE_BITS) - 1

#: Vyper writes one entry point per default argument, so a call that wants
#: none of the trailing three can be sent as the shortest signature that still
#: says what it means.  Three words of calldata is real money on an L2, and
#: Curve's lending callbacks pass the whole thing through as `bytes`.
SIGNATURES = (
    "execute(uint256,address[],uint256[],bool)",
    "execute(uint256,address[],uint256[],bool,address[])",
    "execute(uint256,address[],uint256[],bool,address[],address)",
    "execute(uint256,address[],uint256[],bool,address[],address,uint256)",
)
SIGNATURE = SIGNATURES[-1]

#: How much of a pool's own fee a sandwich is allowed to take before the leg
#: refuses -- and, measured, almost exactly how much one does take when it can.
FEE_SHARE = 0.2

#: A floor on the tolerance for a pair whose price genuinely moves between the
#: quote and the block it lands in, in bp.  It is a real slippage allowance and
#: it is a real cost: measured against the deployed TricryptoUSDC, the fee rule
#: alone grants 0.60 bp and a sandwich nets 0.52 bp of the trade at $15,000,
#: while 5 bp lets the same attack take about eight times that.  Which is the
#: accepted trade for a pair that would otherwise revert on honest movement --
#: and the reason it applies to those pairs and nothing else.
VOLATILE_FLOOR_BP = 5.0

#: A floor on that tolerance, in bp, and not slippage at all: room for the wei
#: of rounding a wrap or a rebasing token loses on the way through, and the only
#: thing standing under a leg whose fee could not be measured.  A pool charging
#: anything at all clears it on the fee rule alone.
FLOOR_BP = 0.1


class EncodingError(ValueError):
    """The route cannot be expressed as calldata this router would execute."""


@dataclass(frozen=True, slots=True)
class Step:
    """One packed leg, as the contract unpacks it."""

    pool: str
    kind: ArcKind
    i: int = 0
    j: int = 1
    n: int = 2
    frac: int = ONE
    min_rate: int = 0
    #: 0 means "read the token off the pool"; otherwise an index into the
    #: call's `tokens`, one-based so that zero can be the sentinel.
    in_ref: int = 0
    out_ref: int = 0

    def pack(self) -> int:
        if not 0 < self.frac <= ONE:
            raise EncodingError(f"frac {self.frac} outside (0, 1e18]")
        if not 0 <= self.min_rate <= MAX_RATE:
            raise EncodingError(f"min_rate {self.min_rate} does not fit in {RATE_BITS} bits")
        for name, value, limit in (("i", self.i, 15), ("j", self.j, 15),
                                   ("n", self.n, 15), ("kind", int(self.kind), 31),
                                   ("in_ref", self.in_ref, MAX_TOKENS),
                                   ("out_ref", self.out_ref, MAX_TOKENS)):
            if not 0 <= value <= limit:
                raise EncodingError(f"{name}={value} outside 0..{limit}")
        return (
            self.frac
            | self.min_rate << RATE_SHIFT
            | self.i << I_SHIFT
            | self.j << J_SHIFT
            | self.n << N_SHIFT
            | int(self.kind) << KIND_SHIFT
            | self.in_ref << IN_REF_SHIFT
            | self.out_ref << OUT_REF_SHIFT
        )


def unpack(word: int, pool: str = "") -> Step:
    if word >> RESERVED_SHIFT:
        raise EncodingError("reserved bits set")
    return Step(
        pool=pool,
        kind=ArcKind((word >> KIND_SHIFT) & 31),
        i=(word >> I_SHIFT) & 15,
        j=(word >> J_SHIFT) & 15,
        n=(word >> N_SHIFT) & 15,
        frac=word & ((1 << FRAC_BITS) - 1),
        min_rate=(word >> RATE_SHIFT) & MAX_RATE,
        in_ref=(word >> IN_REF_SHIFT) & 31,
        out_ref=(word >> OUT_REF_SHIFT) & 31,
    )


@dataclass(frozen=True, slots=True)
class RouteCall:
    """A ready-to-send call, and what it is and is not protecting."""

    amount_in: int
    pools: tuple[str, ...]
    params: tuple[int, ...]
    tokens: tuple[str, ...] = ()
    set_approvals: bool = True
    receiver: str = ""
    min_out: int = 0
    #: What the caller has to hold and approve, and what comes back.  Neither
    #: appears in the calldata -- the router reads them -- so they are carried
    #: here rather than made the caller's problem to re-derive.
    token_in: str = ""
    token_out: str = ""
    #: What the per-leg bounds alone promise, against what the route was
    #: quoted at.  The gap between them is the slippage the caller is granting;
    #: `min_out` is where they can take some of it back.
    guaranteed_out: int = 0
    #: The chained walk's figure where there was one, the model's otherwise --
    #: the number the user was shown, so the number the tolerance is against.
    quoted_out: int = 0
    #: Legs whose bound imposes no floor at all.  Empty unless the caller asked
    #: for them: `encode_route` refuses such a route by default, because a leg
    #: producing too little to bound is a leg producing too little to want.
    unbounded: tuple[int, ...] = ()

    def calldata(self, sender: str = "") -> bytes:
        """The shortest entry point that still expresses this call.

        An empty `receiver` means "whoever sends it", which is the contract's
        own default and therefore a word that does not have to be sent.  Naming
        `sender` buys the same saving for a call that pays its own sender.
        """
        pays_the_sender = not self.receiver or (
            bool(sender) and self.receiver.lower() == sender.lower())
        if not self.receiver and self.min_out:
            raise EncodingError(
                "min_out needs a receiver: a call cannot default the one and "
                "send the other")
        args = [self.amount_in, list(self.pools), list(self.params), self.set_approvals,
                list(self.tokens), self.receiver, self.min_out]
        keep = 7
        if self.min_out == 0:
            keep = 6
            if pays_the_sender:
                keep = 5
                if not self.tokens:
                    keep = 4
        return encode_call(SIGNATURES[keep - 4], *args[:keep])

    @property
    def tolerance_bp(self) -> float:
        """How far below the quote the route may land without reverting."""
        if not self.quoted_out:
            return 0.0
        return (1.0 - self.guaranteed_out / self.quoted_out) * 1e4

    def steps(self) -> list[Step]:
        return [unpack(word, pool) for pool, word in zip(self.pools, self.params, strict=True)]


# --------------------------------------------------------------- fractions


def fractions(route: RealizedRoute) -> list[int]:
    """Each leg's share of the balance standing at its source when it runs.

    Taken from the modelled amounts rather than from `Leg.bps`, so the split is
    whatever the solver actually chose and not a basis-point rounding of it.
    The last leg out of a node always takes everything, which is what stops
    dust accumulating a node at a time.
    """
    balances: dict[int, int] = {0: route.amount_in}
    out: list[int] = []
    for k, realized in enumerate(route.legs):
        src = realized.leg.src_slot
        have = balances.get(src, 0)
        last = not any(later.leg.src_slot == src for later in route.legs[k + 1:])
        if last or realized.amount_in >= have:
            frac = ONE
            take = have
        elif have <= 0:
            raise EncodingError(f"leg {k} spends slot {src}, which nothing has filled")
        else:
            frac = realized.amount_in * ONE // have
            take = realized.amount_in
        out.append(frac)
        balances[src] = have - take
        dst = realized.leg.dst_slot
        balances[dst] = balances.get(dst, 0) + leg_out(realized)
    return out


def leg_out(realized) -> int:
    """What this leg produces: its own pool's answer, or the model's.

    The two differ by tens of basis points on a cryptoswap leg, which does not
    matter for a share of a node -- both branches out of it move together -- and
    matters entirely for a bound on the leg itself.
    """
    return realized.verified_out or realized.amount_out


# --------------------------------------------------------------- min rates


def _usable(value: float) -> bool:
    return math.isfinite(value) and 0.0 <= value < 1.0


def leg_fee(realized) -> float:
    """What this leg pays in fees, at its own size where that is known.

    For display and diagnostics.  `fee_frac` is the pool's own model charging
    the real trade; `gamma_live` is two tiny probes measuring the marginal fee.
    They agree on a fixed-fee pool and diverge on a dynamic one exactly when it
    matters -- the trade that skews the pool is the trade the fee climbs for.
    """
    if _usable(realized.fee_frac):
        return realized.fee_frac
    gamma = realized.gamma_live
    if not math.isfinite(gamma) or not 0.0 < gamma <= 1.0:
        return 0.0
    return 1.0 - gamma


def bounding_fee(realized) -> float:
    """What the minimum rate is set from: the least this pool can charge.

    Not what the leg pays.  A sandwich front-runs and unwinds in small,
    balanced trades and is charged near `mid_fee`, while the leg it wraps pays
    the dynamic fee at its own size -- measured on TricryptoUSDC, 3 bp against
    13 bp.  Bounding on the larger of the two hands the attacker the gap:
    against the deployed pool on a fork, it cost the victim 2.72 bp instead of
    0.60 bp for the same attack.
    """
    if _usable(realized.fee_floor):
        return realized.fee_floor
    return leg_fee(realized)


def leg_in(realized) -> int:
    """The size this leg's output was measured at.

    `leg_out` is the pool's own answer where there is one, and it was quoted at
    the leg's real input rather than its modelled one.  Dividing that by the
    modelled input would inflate the rate by exactly the gap the measurement
    exists to close.
    """
    return realized.verified_in or realized.amount_in


def min_rates(
    route: RealizedRoute,
    *,
    volatile: Collection[str] = (),
    fee_share: float = FEE_SHARE,
    floor_bp: float = FLOOR_BP,
    volatile_floor_bp: float = VOLATILE_FLOOR_BP,
) -> tuple[list[int], list[int]]:
    """`(min_rate per leg, indices the bound does not really cover)`.

    A fifth of the least that pool can charge, floored at `volatile_floor_bp`
    for a pair whose price moves on its own and at the wei of rounding for
    everything else.

    `volatile` names those pools by address.  It is data rather than something
    inferred here: an oraclised stableswap holding a volatile pair looks
    exactly like a pegged one from the arc alone, and that shape is the one
    that rugs on broadcast.

    A tolerance finer than one unit of the output token cannot be expressed as
    a rate -- `min_rate` is `out * 1e18 // in`, so one unit is `1/out` of it,
    and a leg making a few thousand units quantises harder than the room the
    fee rule asks for.  What ships then is the tightest rate that still leaves
    a whole unit: the finest tolerance the token has, and never less than one.

    Binding at the quote itself is what that replaced, and it does not survive
    contact.  The route's own arithmetic moves a leg by a wei with no market
    behind it -- a downstream `dx` is a 60-bit fraction of a standing balance,
    and the sweeper takes whatever earlier divisions stranded in the slot -- so
    a leg with no room reverts on rounding.  Measured: the tBTC -> USDT dust
    route tripped its own bound at some blocks and not others, on a fork, where
    nothing moved at all.  One unit is 5.3 bp on a 1,881-unit leg, which is the
    price of the coarsest intermediate a trade that size can go through.

    A leg lands in `unbounded` only when the floor its bound really imposes
    rounds to nothing, which is a bound guarding nothing.  Everything short of
    that ships, so the number to read is the floor and not the fraction: where
    `in` dwarfs `out` the *rate* keeps only a few significant figures, and one
    step of it can be percent-sized whatever `tol` asked for.  `tolerance_bp`
    is read off `walk_bounds` for that reason.
    """
    loose = {address.lower() for address in volatile}
    rates: list[int] = []
    unbounded: list[int] = []
    for k, realized in enumerate(route.legs):
        floor = volatile_floor_bp if realized.target.lower() in loose else floor_bp
        tol = min(1.0, max(fee_share * bounding_fee(realized), floor / 1e4))
        if leg_in(realized) <= 0 or leg_out(realized) <= 0:
            rates.append(0)
            unbounded.append(k)
            continue
        want, have = leg_out(realized), leg_in(realized)
        share = round(tol * 1e9)
        rate = want * ONE // have
        bound = rate - rate * share // 10**9
        # A tolerance worth less than one unit of the output token has no rate
        # to be written as, so grant the unit: the tightest rate whose floor is
        # a whole unit under the quote.  Binding at the quote itself leaves no
        # room for the route's own arithmetic -- a downstream leg's `dx` is a
        # 60-bit fraction of a standing balance and the sweeper takes whatever
        # wei were stranded by earlier divisions, so a wei in the wrong
        # direction reverts.  Measured: the tBTC -> USDT dust route trips its
        # own bound at some blocks and not others, on a fork with no market
        # movement at all.
        if want * share < 10**9:
            bound = (want * ONE - 1) // have
        if bound > MAX_RATE:
            raise EncodingError(
                f"leg {k} on {realized.target} has a raw-unit rate of {rate}, "
                f"beyond what {RATE_BITS} bits can bound")
        rates.append(bound)
        if have * bound // ONE <= 0:
            unbounded.append(k)
    return rates, unbounded


def walk_bounds(route: RealizedRoute, fracs: list[int],
                rates: list[int]) -> tuple[int, list[int]]:
    """`(what the bounds promise, the minimum output each leg enforces)`.

    The router's own arithmetic, run with `dy = dx * min_rate / 1e18` at every
    step.  Worth computing twice over.  The bounds compound, so the total is a
    number a caller should see before signing rather than discover afterwards.
    And the per-leg figure is the check as the contract will really apply it.
    It is not a useful alarm from here -- `fractions` makes `dx` the leg's own
    modelled amount, so the floor lands at roughly the leg's output every time
    -- but it is what an executed route should be measured against, where `dx`
    is whatever really arrived.
    """
    balances: dict[int, int] = {0: route.amount_in}
    floors: list[int] = []
    for k, realized in enumerate(route.legs):
        src, dst = realized.leg.src_slot, realized.leg.dst_slot
        dx = balances.get(src, 0) * fracs[k] // ONE
        floors.append(dx * rates[k] // ONE)
        balances[src] = balances.get(src, 0) - dx
        balances[dst] = balances.get(dst, 0) + floors[-1]
    return balances.get(route.dst_slot, 0), floors


def guaranteed_out(route: RealizedRoute, fracs: list[int], rates: list[int]) -> int:
    """What the per-leg bounds alone promise, if every leg pays its minimum."""
    return walk_bounds(route, fracs, rates)[0]


# --------------------------------------------------------------- token naming


#: How the contract works out a leg's token when the caller does not name it.
#: `getter` is the one that can fail -- fourteen mainnet pools keep their LP
#: token elsewhere and expose no getter for it at all.
_DERIVE = {
    ArcKind.SWAP_STABLE: ("coin", "coin"),
    ArcKind.SWAP_CRYPTO: ("coin", "coin"),
    ArcKind.DEPOSIT_FIXED: ("coin", "getter"),
    ArcKind.DEPOSIT_DYN: ("coin", "getter"),
    ArcKind.DEPOSIT_FIXED_NOFLAG: ("coin", "getter"),
    ArcKind.WITHDRAW_STABLE: ("getter", "coin"),
    ArcKind.WITHDRAW_CRYPTO: ("getter", "coin"),
    ArcKind.ERC4626_DEPOSIT: ("getter", "target"),
    ArcKind.ERC4626_REDEEM: ("target", "getter"),
    ArcKind.WSTETH_WRAP: ("getter", "target"),
    ArcKind.WSTETH_UNWRAP: ("target", "getter"),
    ArcKind.LEND_MINT: ("getter", "target"),
    ArcKind.LEND_REDEEM: ("target", "getter"),
    ArcKind.WRAP_NATIVE: ("native", "target"),
    ArcKind.STAKE_NATIVE: ("native", "target"),
    ArcKind.UNWRAP_NATIVE: ("target", "native"),
}


#: What to put in `tokens`, which is a straight trade of calldata against gas.
#:
#: `NEEDED` names only what the router cannot read for itself -- LP tokens,
#: vault assets, lending underlyings -- so a route made of swaps names nothing.
#: `NONE` names nothing at all and trusts every getter, which is the shortest
#: calldata there is and the form to use where calldata is the cost: an L2, or
#: a Curve lending callback that carries the whole call as `bytes`.  `ALL`
#: names everything, which is the cheapest to execute and the longest to send.
NEEDED, NONE, ALL = "needed", "none", "all"


def _must_name(rule: str, token: str, target: str, naming: str) -> bool:
    if naming == ALL:
        return True
    if rule == "target":
        return token.lower() != target.lower()
    if rule == "native":
        return token.lower() != NATIVE
    if rule == "getter":
        return naming != NONE
    return False  # a pool coin: `i` and `j` already say which one


# --------------------------------------------------------------- the call


def encode_route(
    route: RealizedRoute,
    *,
    receiver: str,
    set_approvals: bool = True,
    min_out: int = 0,
    amount_in: int | None = None,
    quoted_out: int | None = None,
    volatile: Collection[str] = (),
    naming: str = NEEDED,
    allow_unbounded: bool = False,
    **policy,
) -> RouteCall:
    """Encode `route` for `ElectricRouter.execute`.

    Tokens a leg does not name are read off the pool at execution time, which
    is what makes `i` and `j` binding rather than advisory: the caller cannot
    point a minimum rate at a token the pool does not hold there.  `naming`
    chooses how much of that reading to pay for; see `NEEDED` / `NONE` / `ALL`.

    A leg whose token cannot be derived *at all* -- a 1:1 adapter that is
    neither a native wrapper nor a pool -- is named whatever `naming` says,
    because the alternative is a call that quietly means something else.
    """
    if naming not in (NEEDED, NONE, ALL):
        raise EncodingError(f"naming must be one of {NEEDED}/{NONE}/{ALL}, got {naming!r}")
    if not route.legs:
        raise EncodingError("route has no legs; an alias pair has nothing to execute")
    if len(route.legs) > MAX_LEGS:
        raise EncodingError(f"{len(route.legs)} legs, the router takes {MAX_LEGS}")
    if route.legs[-1].leg.dst_slot != route.dst_slot:
        raise EncodingError("the last leg does not produce the destination token")

    fracs = fractions(route)
    rates, unbounded = min_rates(route, volatile=volatile, **policy)
    if unbounded and not allow_unbounded:
        legs = ", ".join(
            f"{k} on {route.legs[k].target} ({route.legs[k].amount_in} in, "
            f"{leg_out(route.legs[k])} out)" for k in unbounded)
        raise EncodingError(
            f"leg(s) {legs} produce too little for a minimum rate to bound -- "
            f"the floor it imposes rounds to nothing, so the check is vacuous. "
            f"A leg worth that little is not worth executing; re-solve without "
            f"it, or pass allow_unbounded to ship it unprotected")
    promised, _floors = walk_bounds(route, fracs, rates)

    tokens: list[str] = []

    def ref(token: str) -> int:
        key = token.lower()
        if key not in tokens:
            if len(tokens) >= MAX_TOKENS:
                raise EncodingError(f"route names more than {MAX_TOKENS} tokens")
            tokens.append(key)
        return tokens.index(key) + 1

    steps: list[Step] = []
    for k, realized in enumerate(route.legs):
        rule = _DERIVE.get(realized.kind)
        if rule is None:
            raise EncodingError(f"leg {k}: {realized.kind.name} is not executable")
        target = realized.target
        steps.append(Step(
            pool=target,
            kind=realized.kind,
            i=realized.leg.i,
            j=realized.leg.j,
            n=realized.leg.n,
            frac=fracs[k],
            min_rate=rates[k],
            in_ref=ref(realized.token_in)
            if _must_name(rule[0], realized.token_in, target, naming) else 0,
            out_ref=ref(realized.token_out)
            if _must_name(rule[1], realized.token_out, target, naming) else 0,
        ))

    return RouteCall(
        amount_in=route.amount_in if amount_in is None else amount_in,
        pools=tuple(step.pool for step in steps),
        params=tuple(step.pack() for step in steps),
        tokens=tuple(tokens),
        set_approvals=set_approvals,
        receiver=receiver,
        min_out=min_out,
        token_in=route.legs[0].token_in.lower(),
        token_out=route.legs[-1].token_out.lower(),
        guaranteed_out=promised,
        quoted_out=route.modelled_out if quoted_out is None else quoted_out,
        unbounded=tuple(unbounded),
    )
