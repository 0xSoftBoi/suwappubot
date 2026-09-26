"""Stableswap, evaluated exactly from its own parameters (§11.3).

The quadratic in `calibrate.py` is the right model for choosing *which* pools and
*what split* -- both are first-order-flat at the optimum, so an `O(theta^2)` curve
error does not move them.  It is the wrong model for what a pool pays at a size
approaching its own reserves, and sampling closer does not rescue it: a secant
fitted at trade size still describes the chord of something that is not a
parabola.

So read `A`, the fee, the balances and the rates and evaluate the pool's own
invariant.  Exact at any size, no probes once the parameters are in hand.  Third
way of knowing a curve here: `calibrate.py` fits two derivatives for the convex
program, `curves.py` interpolates `x/f(x)` through probes for any pool at all,
and this is the pool's own arithmetic -- exact, but stableswap only.

Two dialects, and the difference is not cosmetic.  **legacy** stores `A` unscaled
and takes the fee after converting to token units.  **ng** stores
`A * A_PRECISION`, takes the fee in `xp` units before converting, and scales it
with how far off peg the balances are -- so a badly imbalanced pool charges
several times its nominal fee, which is exactly the regime a large trade creates.

Integer arithmetic with floor division throughout, because the point is to agree
with the contracts to the wei.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

PRECISION = 10**18
#: The same, as a float, so the quote path never converts it.
PRECISION_F = 1e18
FEE_DENOMINATOR = 10**10
A_PRECISION = 100
#: Newton's method in the contracts is capped at 255 and asserted to converge.
MAX_ITER = 255

#: Where the float iterations stop.  The integer ones stop at `|delta| <= 1` wei,
#: which has no floating-point analogue; this is the relative equivalent, two
#: orders inside double precision so the loop converges rather than chattering.
_FAST_TOL = 1e-14


class StableSwapError(ArithmeticError):
    """The invariant did not converge, or the pool cannot serve the trade."""


def solve_y(amp: int, a_precision: int, xp: list[int], d: int,
            i: int, j: int, x: int) -> int:
    """The `j` balance restoring the invariant when `i` holds `x`.

    Module level because two pool families run exactly this iteration:
    `CurveStableSwapNG`, and twocrypto-ng's `StableswapMath`, which the same
    factory deploys as an "FX Swap" -- cryptoswap machinery (price scale, dynamic
    fee, EMA oracle) around a stableswap invariant.  Its only difference is
    `A_MULTIPLIER = 10000` where stableswap-ng uses `A_PRECISION = 100`, which
    `a_precision` already parameterises.
    """
    n = len(xp)
    ann = amp * n
    c = d
    s = 0
    for k in range(n):
        if k == i:
            below = x
        elif k != j:
            below = xp[k]
        else:
            continue
        if below <= 0:
            raise StableSwapError("empty balance")
        s += below
        c = c * d // (below * n)
    c = c * d * a_precision // (ann * n)
    b = s + d * a_precision // ann
    y = d
    for _ in range(MAX_ITER):
        prev = y
        y = (y * y + c) // (2 * y + b - d)
        if abs(y - prev) <= 1:
            return y
    raise StableSwapError("y did not converge")


@dataclass(frozen=True, slots=True)
class StableSwap:
    """One pool's state, enough to evaluate `get_dy` exactly.

    `rates` are the 1e18-scaled multipliers taking a raw balance into the
    common-precision `xp` space: `10**(36 - decimals)` for a legacy pool's
    `RATES`, `stored_rates()` for ng (which folds in an LST's exchange rate as
    well as its decimals).  Passing them explicitly means this module never has
    to know which of the two it is looking at.

    `amp` is whatever `A_precise()`/`A()` returned *together with* the matching
    `a_precision`, so either spelling describes the pool without losing a digit.
    """

    balances: tuple[int, ...]
    rates: tuple[int, ...]
    amp: int
    fee: int
    #: 0 or FEE_DENOMINATOR both mean "no dynamic fee"; ng pools carry a real one.
    offpeg_fee_multiplier: int = 0
    a_precision: int = A_PRECISION
    #: ng takes the fee in `xp` space; legacy takes it in token space.
    fee_on_xp: bool = True
    #: The share of the fee that leaves the pool for the DAO.  Only `exchange`
    #: needs it -- `get_dy` is the trader's side -- but the pool keeps
    #: `fee - admin_fee` and that is the part which changes the next quote.
    #: `-1` means "not read", and `exchange` refuses rather than assuming zero:
    #: assuming zero leaves too much in the pool and flatters the second leg.
    admin_fee: int = -1
    #: Whether the pool rounds its output down by a wei.  The ng generation
    #: computes `dy = xp[j] - y - 1`; the 2020 lending pools keep the wei.  One
    #: wei is the whole difference between a model admitted and one that is not.
    subtract_one: bool = True
    #: Lazily filled by `xp` / `xp_float`.  Not part of the value: the pool is
    #: frozen at a block, so these are a function of it rather than more state.
    #: `init=False` is what keeps them safe -- with it, `dataclasses.replace`
    #: leaves them at `None` on the copy; without it, replacing the balances
    #: would carry the old `xp` across and quote the new pool with old reserves.
    _xp: list[int] | None = field(default=None, init=False, compare=False, repr=False)
    _xpf: list[float] | None = field(default=None, init=False, compare=False,
                                     repr=False)
    #: The pool's own constants, as floats, so the quote path stops converting
    #: them: `rates` reach 1e30, every conversion is a big-integer-to-double at
    #: ~47 ns, and a quote makes thousands.  See `_constants`.
    _consts: tuple | None = field(default=None, init=False, compare=False,
                                  repr=False)

    @property
    def n(self) -> int:
        return len(self.balances)

    def xp(self) -> list[int]:
        """Balances in the common-precision space.

        Cached: the pool is frozen at a block, so this is a constant, and it was
        being recomputed on every one of ~3,000 calls a route.
        """
        got = self._xp
        if got is None:
            got = [b * r // PRECISION
                   for b, r in zip(self.balances, self.rates, strict=True)]
            object.__setattr__(self, "_xp", got)
        return got

    def _constants(self) -> tuple:
        """`(amp, a_precision, rates, PRECISION / rates)`, all as floats.

        The quote path multiplies and divides by these on every call and they
        never change: the pool is frozen at a block.
        """
        got = self._consts
        if got is None:
            inv = tuple(PRECISION / r if r else 0.0 for r in self.rates)
            got = (float(self.amp), float(self.a_precision),
                   tuple(float(r) for r in self.rates), inv)
            object.__setattr__(self, "_consts", got)
        return got

    def dynamic_fee_fast(self, xpi: float, xpj: float) -> float:
        """`dynamic_fee`, without squaring a 1e24 integer into a 1e48 one.

        The integer form is 160-bit arithmetic on every quote; in floats the same
        expression is three multiplications, and the fee agrees to a part in 1e12
        -- of a four basis-point fee.
        """
        multiplier = self.offpeg_fee_multiplier
        if multiplier <= FEE_DENOMINATOR:
            return float(self.fee)
        total = xpi + xpj
        if total <= 0.0:
            return float(self.fee)
        balanced = 4.0 * xpi * xpj / (total * total)
        return ((multiplier * self.fee)
                / ((multiplier - FEE_DENOMINATOR) * balanced + FEE_DENOMINATOR))

    def xp_float(self) -> list[float]:
        """`xp` as floats, cached alongside it for the same reason."""
        got = self._xpf
        if got is None:
            got = [float(v) for v in self.xp()]
            object.__setattr__(self, "_xpf", got)
        return got

    # ------------------------------------------------------------ invariant

    def d(self, xp: list[int] | None = None) -> int:
        """`D`, by the contracts' own Newton iteration.

        Written as the contracts write it, including the order of operations:
        `D_P = D_P * D // (x * n)` accumulates a different rounding than the
        algebraically equal `D**(n+1) // (n**n * prod(x))`, and the difference
        shows up in the last wei of a quote.
        """
        xp = self.xp() if xp is None else xp
        s = sum(xp)
        if s == 0:
            return 0
        n = self.n
        ann = self.amp * n
        d = s
        for _ in range(MAX_ITER):
            d_p = d
            for x in xp:
                if x == 0:
                    raise StableSwapError("empty balance")
                d_p = d_p * d // (x * n)
            prev = d
            d = ((ann * s // self.a_precision + d_p * n) * d
                 // ((ann - self.a_precision) * d // self.a_precision + (n + 1) * d_p))
            if abs(d - prev) <= 1:
                return d
        raise StableSwapError("D did not converge")

    def y(self, i: int, j: int, x: int, xp: list[int] | None = None,
          d: int | None = None) -> int:
        """The `j` balance that restores the invariant when `i` holds `x`."""
        if i == j:
            raise StableSwapError("i and j must differ")
        xp = self.xp() if xp is None else xp
        return solve_y(self.amp, self.a_precision, xp,
                       self.d(xp) if d is None else d, i, j, x)

    # ----------------------------------------------------------------- fees

    def dynamic_fee(self, xpi: int, xpj: int) -> int:
        """The fee this pool charges at that imbalance (ng only).

        `4 xi xj / (xi + xj)^2` is 1 at peg and falls toward 0 as the two sides
        diverge, so the fee rises from `fee` toward `offpeg_fee_multiplier` times
        it -- the term that matters exactly when the trade is large enough to do
        the pushing.
        """
        multiplier = self.offpeg_fee_multiplier
        if multiplier <= FEE_DENOMINATOR:
            return self.fee
        xps2 = (xpi + xpj) ** 2
        return ((multiplier * self.fee)
                // ((multiplier - FEE_DENOMINATOR) * 4 * xpi * xpj // xps2
                    + FEE_DENOMINATOR))

    # ----------------------------------------------------------------- quote

    def get_dy(self, i: int, j: int, dx: int) -> int:
        """Exactly what `get_dy(i, j, dx)` returns on chain."""
        if dx <= 0:
            return 0
        xp = self.xp()
        d = self.d(xp)
        x = xp[i] + dx * self.rates[i] // PRECISION
        y = self.y(i, j, x, xp, d)
        raw = xp[j] - y - (1 if self.subtract_one else 0)
        if raw <= 0:
            return 0
        if self.fee_on_xp:
            fee = self.dynamic_fee((xp[i] + x) // 2, (xp[j] + y) // 2)
            return (raw - raw * fee // FEE_DENOMINATOR) * PRECISION // self.rates[j]
        out = raw * PRECISION // self.rates[j]
        return out - out * self.fee // FEE_DENOMINATOR

    def exchange(self, i: int, j: int, dx: int) -> tuple[int, StableSwap]:
        """`(dy, the pool after the trade)` -- what `exchange` would leave.

        A view-only chained quoter cannot see its own earlier leg, which is why a
        route may not touch a pool twice (decision 3).  That is a limitation of
        *asking the chain*, not of the arithmetic: for a pool the wei-exact gate
        admitted, the state after a trade is as computable as the trade itself,
        and stableswap makes it easy because `D` is derived from the balances
        rather than stored.

        The update is the contract's own:

            balances[i] = balances[i] + dx
            balances[j] = balances[j] - dy - dy_admin_fee

        so the pool keeps the LP's share of the fee and loses the DAO's.  Skipping
        `dy_admin_fee` would leave the pool richer than it is and quote the next
        leg through it too well.
        """
        if self.admin_fee < 0:
            raise StableSwapError("admin_fee unknown; cannot advance state")
        if dx <= 0:
            return 0, self
        xp = self.xp()
        d = self.d(xp)
        x = xp[i] + dx * self.rates[i] // PRECISION
        y = self.y(i, j, x, xp, d)
        raw = xp[j] - y - (1 if self.subtract_one else 0)
        if raw <= 0:
            return 0, self
        if self.fee_on_xp:
            fee = self.dynamic_fee((xp[i] + x) // 2, (xp[j] + y) // 2)
            charged = raw * fee // FEE_DENOMINATOR
            dy = (raw - charged) * PRECISION // self.rates[j]
            admin = (charged * self.admin_fee // FEE_DENOMINATOR
                     * PRECISION // self.rates[j])
        else:
            out = raw * PRECISION // self.rates[j]
            charged = out * self.fee // FEE_DENOMINATOR
            dy = out - charged
            admin = charged * self.admin_fee // FEE_DENOMINATOR
        balances = list(self.balances)
        balances[i] += dx
        if balances[j] < dy + admin:
            raise StableSwapError("pool cannot pay the trade")
        balances[j] -= dy + admin
        # `replace` drops the cached `xp`/`_consts` because both are `init=False`
        # -- see the note on those fields, which exists for exactly this call.
        return dy, replace(self, balances=tuple(balances))

    def get_dy_fast(self, i: int, j: int, dx: int) -> int:
        """`get_dy`, priced in floating point.

        Same algebra, same fee, same rates -- only the invariant iterations move
        to `f64`.  See the note above `d_fast`.
        """
        if dx <= 0:
            return 0
        xp = self.xp_float()
        amp, a_precision, rates, inv_rates = self._constants()
        d = d_fast(xp, amp, a_precision, self.n)
        # `dx` is the one integer that has to cross: it is the caller's amount
        # and changes every call.  Everything it meets is already a float.
        x = xp[i] + float(dx) * rates[i] / PRECISION_F
        y = solve_y_fast(amp, a_precision, xp, d, i, j, x)
        raw = xp[j] - y - (1.0 if self.subtract_one else 0.0)
        if raw <= 0.0:
            return 0
        if self.fee_on_xp:
            fee = self.dynamic_fee_fast((xp[i] + x) * 0.5, (xp[j] + y) * 0.5)
            return int((raw - raw * fee / FEE_DENOMINATOR) * inv_rates[j])
        out = raw * inv_rates[j]
        return int(out - out * self.fee / FEE_DENOMINATOR)


# ------------------------------------------------------- the float fast path
#
# The integer math above *is* the contract, wei for wei, and that is what makes
# the admission gate meaningful: a pool is trusted only when the arithmetic
# reproduces the chain exactly, and a wrong rate shows up as a one-wei
# disagreement.  Keep it for that.
#
# But a quote calls this thousands of times, and there the last wei buys nothing.
# Measured over 1,052 (pool, size) samples on 263 mainnet stableswaps, the float
# form is out by a median of 2e-9 bp and a worst case of 5.4e-4 bp -- below the
# tick of any token, far inside `STALE_TOL_BP`, and orders of magnitude below the
# spread between the candidates it has to rank.  It runs 2.5x faster in Python,
# and ports to Rust as plain `f64`: no u256, and native in wasm.
#
# So: integers decide whether a model may be used, floats price with it.

def d_fast(xp: list[float], amp: float, a_precision: float, n: int) -> float:
    """`D` by the same Newton iteration, in floating point."""
    s = 0.0
    for v in xp:
        s += v
    if s == 0.0:
        return 0.0
    ann = amp * n
    d = s
    for _ in range(MAX_ITER):
        d_p = d
        for x in xp:
            if x <= 0.0:
                raise StableSwapError("empty balance")
            d_p = d_p * d / (x * n)
        prev = d
        d = ((ann * s / a_precision + d_p * n) * d
             / ((ann - a_precision) * d / a_precision + (n + 1) * d_p))
        if abs(d - prev) <= _FAST_TOL * d:
            return d
    raise StableSwapError("D did not converge")


def solve_y_fast(amp: float, a_precision: float, xp: list[float], d: float,
                 i: int, j: int, x: float) -> float:
    """The `j` balance restoring the invariant, in floating point."""
    n = len(xp)
    ann = amp * n
    c = d
    s = 0.0
    for k in range(n):
        if k == i:
            below = x
        elif k != j:
            below = xp[k]
        else:
            continue
        if below <= 0.0:
            raise StableSwapError("empty balance")
        s += below
        c = c * d / (below * n)
    c = c * d * a_precision / (ann * n)
    b = s + d * a_precision / ann
    y = d
    for _ in range(MAX_ITER):
        prev = y
        y = (y * y + c) / (2 * y + b - d)
        if abs(y - prev) <= _FAST_TOL * y:
            return y
    raise StableSwapError("y did not converge")


# --------------------------------------------------------------- LP arcs

def solve_y_d(amp: int, a_precision: int, xp: list[int], d: int, i: int,
              n: int) -> int:
    """`get_y_D`: balance `i` when `D` is reduced to `d`, the others held.

    A different question from `solve_y`, which asks what `i` becomes when another
    balance changes at constant `D`.  Here `D` itself moves -- which is what a
    single-sided deposit or withdrawal does -- and the same quadratic is iterated
    with `c` and `b` built from the *target* `D`.

    Generalised over `A_PRECISION`: the pools that predate it have
    `a_precision == 1`, which makes every scaling term below vanish.
    """
    ann = amp * n
    c = d
    s = 0
    for k in range(n):
        if k == i:
            continue
        x = xp[k]
        if x <= 0:
            raise StableSwapError("empty balance")
        s += x
        c = c * d // (x * n)
    c = c * d * a_precision // (ann * n)
    b = s + d * a_precision // ann
    y = d
    for _ in range(255):
        prev = y
        y = (y * y + c) // (2 * y + b - d)
        if (y - prev if y > prev else prev - y) <= 1:
            return y
    raise StableSwapError("y_D did not converge")


def solve_y_d_fast(amp: float, a_precision: float, xp: list[float], d: float,
                   i: int, n: int) -> float:
    """`get_y_D`, in floating point.

    Same quadratic, same `c` and `b` built from the target `D`; balances and `D`
    are dollars, so the `a_precision` scalings ride along unchanged.
    """
    ann = amp * n
    c = d
    s = 0.0
    for k in range(n):
        if k == i:
            continue
        x = xp[k]
        if x <= 0.0:
            raise StableSwapError("empty balance")
        s += x
        c = c * d / (x * n)
    c = c * d * a_precision / (ann * n)
    b = s + d * a_precision / ann
    y = d
    for _ in range(MAX_ITER):
        prev = y
        y = (y * y + c) / (2 * y + b - d)
        if abs(y - prev) <= _FAST_TOL * y:
            return y
    raise StableSwapError("y_D did not converge")


@dataclass(frozen=True, slots=True)
class StableSwapLP:
    """A pool's LP arcs: what a deposit mints and a withdrawal returns.

    The invariant is the same one `StableSwap` already reproduces; what is new
    is that `D` moves.  Two conventions the deployed source settles, and both
    are easy to assume wrongly:

    * `calc_token_amount` takes **no fee at all** on the legacy pools -- its own
      docstring calls it "needed to prevent front-running, not for precise
      calculations".  It is `(D1 - D0) * totalSupply / D0` and nothing else.
    * `calc_withdraw_one_coin` charges `fee * N / (4 * (N - 1))` on each
      coin's *imbalance* against the ideal, not on the output, and then
      withdraws one wei less "to account for rounding errors".
    """

    pool: StableSwap
    total_supply: int

    @property
    def n(self) -> int:
        return self.pool.n

    def _xp(self) -> list[int]:
        return self.pool.xp()

    def calc_token_amount(self, amounts: list[int], deposit: bool) -> int:
        """LP minted for a deposit, or burned for a withdrawal.  Fee-free."""
        if self.total_supply <= 0:
            raise StableSwapError("no supply")
        p = self.pool
        d0 = p.d()
        moved = list(p.balances)
        for k, amount in enumerate(amounts):
            if deposit:
                moved[k] += amount
            else:
                if amount > moved[k]:
                    raise StableSwapError("withdrawing more than the pool holds")
                moved[k] -= amount
        after = StableSwap(balances=tuple(moved), rates=p.rates, amp=p.amp,
                           fee=p.fee, offpeg_fee_multiplier=p.offpeg_fee_multiplier,
                           a_precision=p.a_precision, fee_on_xp=p.fee_on_xp)
        d1 = after.d()
        diff = d1 - d0 if deposit else d0 - d1
        return diff * self.total_supply // d0

    def add_liquidity(self, amounts: list[int]) -> tuple[int, StableSwapLP]:
        """`(LP minted, the pool after)` -- what `add_liquidity` really does.

        Not the same number as `calc_token_amount`, and the gap is the point:
        that getter is fee-free on the legacy pools by its own admission, so it
        over-states a deposit.  This charges the imbalance fee actually paid:

            fee_i     = fee * N / (4(N-1)) * |ideal_i - new_i|
            minted    = supply * (D(new - fees) - D0) / D0
            stored_i  = new_i - fee_i * admin_fee / FEE_DENOMINATOR

        Two different subtractions, which is the part worth reading twice.  The
        *mint* is priced against balances less the whole fee, so the depositor
        pays all of it; the pool *keeps* all but the DAO's share, so the balances
        left behind are higher than the ones the mint was priced from.  Using one
        figure for both would leave the pool poorer than it is and misprice every
        later leg through it.

        A pool with no supply yet is refused rather than guessed: the first
        deposit sets the price of the pool and takes a different branch.
        """
        minted, charged, new = self._deposit(amounts)
        p = self.pool
        if p.admin_fee < 0:
            raise StableSwapError("admin_fee unknown; cannot advance state")
        stored = [v - f * p.admin_fee // FEE_DENOMINATOR
                  for v, f in zip(new, charged, strict=True)]
        return minted, replace(
            self, pool=replace(p, balances=tuple(stored)),
            total_supply=self.total_supply + minted,
        )

    def calc_token_amount_charged(self, amounts: list[int]) -> int:
        """What a deposit actually mints -- the imbalance fee included.

        `calc_token_amount` is the *getter*, fee-free on the legacy pools, so it
        over-states every deposit it is asked about.  This is the number
        `add_liquidity` returns, and it needs no `admin_fee`: the DAO's share
        changes what the pool keeps, never what the depositor is handed.
        """
        return self._deposit(amounts)[0]

    def _deposit(self, amounts: list[int]) -> tuple[int, list[int], list[int]]:
        """`(minted, fee per coin, balances before the fee is split)`.

        The mint is priced against balances less the *whole* fee -- the depositor
        pays all of it -- while the pool keeps all but the DAO's share.  Two
        subtractions off one figure, which is why this returns the pieces.
        """
        if self.total_supply <= 0:
            raise StableSwapError("no supply")
        p = self.pool
        n = self.n
        if len(amounts) != n:
            raise StableSwapError("amounts do not match the coins")
        d0 = p.d()
        new = [b + a for b, a in zip(p.balances, amounts, strict=True)]
        d1 = replace(p, balances=tuple(new)).d()
        if d1 <= d0:
            raise StableSwapError("deposit does not raise the invariant")
        fee = p.fee * n // (4 * (n - 1)) if n > 1 else 0
        charged = [0] * n
        priced = list(new)
        for k in range(n):
            ideal = d1 * p.balances[k] // d0
            difference = ideal - new[k] if ideal > new[k] else new[k] - ideal
            charged[k] = fee * difference // FEE_DENOMINATOR
            priced[k] = new[k] - charged[k]
        d2 = replace(p, balances=tuple(priced)).d()
        return self.total_supply * (d2 - d0) // d0, charged, new

    def calc_token_amount_fast(self, amounts: list[int], deposit: bool) -> int:
        """`calc_token_amount`, with the two invariants solved in floats."""
        if self.total_supply <= 0:
            raise StableSwapError("no supply")
        p = self.pool
        rates = p.rates
        xp0 = [float(b) * r / PRECISION for b, r in zip(p.balances, rates, strict=True)]
        d0 = d_fast(xp0, float(p.amp), float(p.a_precision), p.n)
        moved = list(p.balances)
        for k, amount in enumerate(amounts):
            if deposit:
                moved[k] += amount
            else:
                if amount > moved[k]:
                    raise StableSwapError("withdrawing more than the pool holds")
                moved[k] -= amount
        xp1 = [float(b) * r / PRECISION for b, r in zip(moved, rates, strict=True)]
        d1 = d_fast(xp1, float(p.amp), float(p.a_precision), p.n)
        diff = d1 - d0 if deposit else d0 - d1
        return int(diff * self.total_supply / d0)

    def calc_token_amount_charged_fast(self, amounts: list[int]) -> int:
        """`calc_token_amount_charged`, with the three invariants in floats."""
        if self.total_supply <= 0:
            raise StableSwapError("no supply")
        p = self.pool
        n = self.n
        if len(amounts) != n:
            raise StableSwapError("amounts do not match the coins")
        rates, amp, ap = p.rates, float(p.amp), float(p.a_precision)
        xp0 = [float(b) * r / PRECISION
               for b, r in zip(p.balances, rates, strict=True)]
        d0 = d_fast(xp0, amp, ap, n)
        new = [float(b + a) for b, a in zip(p.balances, amounts, strict=True)]
        d1 = d_fast([v * r / PRECISION for v, r in zip(new, rates, strict=True)],
                    amp, ap, n)
        if d1 <= d0:
            raise StableSwapError("deposit does not raise the invariant")
        fee = (p.fee * n // (4 * (n - 1)) if n > 1 else 0) / FEE_DENOMINATOR
        priced = [v - fee * abs(d1 * float(b) / d0 - v)
                  for v, b in zip(new, p.balances, strict=True)]
        d2 = d_fast([v * r / PRECISION
                     for v, r in zip(priced, rates, strict=True)], amp, ap, n)
        return int((d2 - d0) * self.total_supply / d0)

    def calc_withdraw_one_coin_fast(self, token_amount: int, i: int) -> int:
        """`calc_withdraw_one_coin`, with the invariants solved in floats.

        The imbalance fee is the contract's own integer expression and stays
        one: it is three operations, not a loop.
        """
        if self.total_supply <= 0:
            raise StableSwapError("no supply")
        if not (0 <= i < self.n):
            raise StableSwapError("coin index out of range")
        p = self.pool
        n = self.n
        fee = p.fee * n // (4 * (n - 1))
        xp = [float(v) for v in self._xp()]
        amp, ap = float(p.amp), float(p.a_precision)
        d0 = d_fast(xp, amp, ap, n)
        d1 = d0 - float(token_amount) * d0 / self.total_supply
        new_y = solve_y_d_fast(amp, ap, xp, d1, i, n)

        reduced = list(xp)
        for j in range(n):
            expected = xp[j] * d1 / d0 - new_y if j == i else xp[j] - xp[j] * d1 / d0
            reduced[j] -= fee * expected / FEE_DENOMINATOR
        dy = reduced[i] - solve_y_d_fast(amp, ap, reduced, d1, i, n)
        return int((dy - 1.0) * PRECISION / p.rates[i])

    def calc_withdraw_one_coin(self, token_amount: int, i: int) -> int:
        """Coin `i` returned for burning `token_amount` of LP."""
        if self.total_supply <= 0:
            raise StableSwapError("no supply")
        if not (0 <= i < self.n):
            raise StableSwapError("coin index out of range")
        p = self.pool
        n = self.n
        fee = p.fee * n // (4 * (n - 1))
        xp = self._xp()
        d0 = p.d()
        d1 = d0 - token_amount * d0 // self.total_supply
        new_y = solve_y_d(p.amp, p.a_precision, xp, d1, i, n)

        reduced = list(xp)
        for j in range(n):
            expected = xp[j] * d1 // d0 - new_y if j == i else xp[j] - xp[j] * d1 // d0
            reduced[j] -= fee * expected // FEE_DENOMINATOR
        dy = reduced[i] - solve_y_d(p.amp, p.a_precision, reduced, d1, i, n)
        # One wei less, as the pool does, and back out of `xp` space.
        return (dy - 1) * PRECISION // p.rates[i]
