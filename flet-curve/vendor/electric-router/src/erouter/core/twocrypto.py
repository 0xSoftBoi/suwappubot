"""Twocrypto-ng, evaluated exactly (§11.3).

The same factory deploys two different pools, and they are not distinguishable
by pool type, name or coins -- only by the math contract each one holds as an
immutable:

* **Twocrypto** proper, the cryptoswap invariant with `gamma`;
* **FX Swap**, which is a *stableswap* invariant wearing all of cryptoswap's
  machinery -- price scale, dynamic fee, EMA oracle, rebalancing.

Everything except `get_y` is shared, which is what makes this module worth
having before either backend exists.  `TwocryptoView.get_dy` is:

    xp[i] += dx
    xp = [xp[0] * p[0], xp[1] * price_scale * p[1] / PRECISION]
    y  = MATH.get_y(A, gamma, xp, D, j)[0]
    dy = xp[j] - y - 1  ;  xp[j] = y
    if j > 0: dy = dy * PRECISION / price_scale
    dy /= p[j]
    dy -= fee(xp) * dy / FEE_PRECISION

Note the fee is charged on the *post-trade* `xp` -- after `xp[j] = y` -- which
is the sort of thing that is invisible in a formula and decides the last basis
point.

Two things this deliberately does not model.  `D` is read from storage, and a
pool mid-A/gamma-ramp recomputes it with `newton_D` instead: `is_ramping` says
when, and such a pool has to be probed until `newton_D` exists here.  And a
pool carrying a `POLICY` contract has its fee -- and its price scale -- driven
by arbitrary external code, which no parameter set can stand in for.  Both are
refused rather than approximated; the caller keeps probing them.
"""

from __future__ import annotations

from dataclasses import dataclass

from .cryptoswap import MAX_GAMMA_SMALL, CryptoSwapError, _newton_y, newton_y_fast
from .cryptoswap import get_y as crypto_get_y
from .stableswap import StableSwapError, solve_y, solve_y_fast

PRECISION = 10**18
FEE_PRECISION = 10**10
N_COINS = 2
#: `A_MULTIPLIER` in twocrypto-ng, where stableswap-ng calls it `A_PRECISION`
#: and sets it to 100.
A_MULTIPLIER = 10_000
MIN_FEE = FEE_PRECISION // 10 // 10_000  # 0.1 bp
MAX_FEE = FEE_PRECISION


class TwocryptoError(ArithmeticError):
    """The pool cannot be evaluated from its parameters."""


@dataclass(frozen=True, slots=True)
class Twocrypto:
    """One twocrypto-ng pool, enough to reproduce `get_dy` exactly.

    `stable` selects the FX Swap backend -- the caller decides it by reading
    the pool's `MATH()` and recognising the implementation, never by guessing
    from the pool's name or its coins.
    """

    balances: tuple[int, int]
    precisions: tuple[int, int]
    price_scale: int
    d: int
    amp: int  # `A`, already carrying A_MULTIPLIER * N**N
    gamma: int
    mid_fee: int
    out_fee: int
    fee_gamma: int
    #: True for an FX Swap (stableswap invariant), False for cryptoswap.
    stable: bool = True
    #: Which deployed math a cryptoswap pool uses.  The arithmetic is the same
    #: in both; only the gamma ceiling and the `K0_i` window differ.
    v21: bool = True
    #: Which `_fee` the *pool* implements.  Two are deployed and they are not
    #: algebraically equal -- see `fee`.
    legacy_fee: bool = False
    #: The pre-factory generation, whose maths is inlined in the pool rather
    #: than in a `MATH` contract: Newton's `y`, and a different rounding order
    #: on the way out.  `price_scale` there already carries `precisions[1]`,
    #: so `dy` is divided by the product in one step for `j > 0` and by
    #: `precisions[0]` alone for `j == 0` -- not by both in sequence.  Same
    #: value in exact arithmetic, different wei in integer arithmetic.
    legacy_pool: bool = False
    #: Within that inline generation, whether `mul2` divides the whole sum.
    #: Vyper 0.3.1 wrote `10**18 + (2 * 10**18) * K0 / _g1k0`; 0.3.3 rewrote
    #: it as `unsafe_div(10**18 + (2 * 10**18) * K0, _g1k0)`, moving the
    #: `10**18` inside.  Both are deployed, so both are offered to the gate.
    legacy_mul2: bool = False

    # ------------------------------------------------------------------ fee

    def fee(self, xp: list[int]) -> int:
        """`_fee`, on the balances *after* the trade.

        Two versions are deployed and they are **not** algebraically equal, so
        which one a pool implements has to be established rather than assumed:

            legacy   f = fee_gamma * 1e18 / (fee_gamma + 1e18 - K)
            current  f = fee_gamma * K    / (fee_gamma * K / 1e18 + 1e18 - K)

        with `K = 1e18 * N**N * x0/S * x1/S`, the balance indicator: 1e18 at
        perfect balance, falling toward 0 as the pool skews, so the fee slides
        from `mid_fee` toward `out_fee`.  The legacy one also does not clamp.

        The difference is around a part in ten million of the output -- small
        enough to look like a rounding bug and far too large to be one.  It was
        found by reading the deployed source rather than a repository copy, which
        had only the current form.
        """
        total = xp[0] + xp[1]
        if total <= 0:
            raise TwocryptoError("empty pool")
        k = PRECISION * N_COINS**N_COINS * xp[0] // total * xp[1] // total
        if self.legacy_fee:
            denominator = self.fee_gamma + PRECISION - k
            if denominator <= 0:
                raise TwocryptoError("fee denominator collapsed")
            f = self.fee_gamma * PRECISION // denominator
            return (self.mid_fee * f + self.out_fee * (PRECISION - f)) // PRECISION
        b = self.fee_gamma * k // (self.fee_gamma * k // PRECISION + PRECISION - k)
        fee = (self.mid_fee * b + self.out_fee * (PRECISION - b)) // PRECISION
        return min(MAX_FEE, max(MIN_FEE, fee))

    # ---------------------------------------------------------------- quote

    def get_dy(self, i: int, j: int, dx: int) -> int:
        """Exactly what the pool's `get_dy(i, j, dx)` returns on chain."""
        return self._quote(i, j, dx, self._y)

    def get_dy_fast(self, i: int, j: int, dx: int) -> int:
        """`get_dy`, solving the invariant in floating point.

        Only the iteration moves: the fee, the price scale and the precisions are
        a handful of integer operations and stay exactly as the contract does
        them.  See `cryptoswap.newton_y_fast` for why the float form is a
        dimensional reduction rather than a transcription -- measured on 68
        mainnet cryptoswap pools, it tracks the integer path to 8e-6 bp.
        """
        return self._quote(i, j, dx, self._y_fast)

    def _quote(self, i: int, j: int, dx: int, solve) -> int:
        if i == j or not (0 <= i < N_COINS) or not (0 <= j < N_COINS):
            raise TwocryptoError("coin index out of range")
        if dx <= 0:
            return 0
        if not all(self.balances) or self.d <= 0:
            raise TwocryptoError("empty pool")

        scale = (self.price_scale * self.precisions[1] if self.legacy_pool
                 else self.price_scale)
        xp = [self.balances[0], self.balances[1]]
        xp[i] += dx
        xp = [
            xp[0] * self.precisions[0],
            (xp[1] * scale // PRECISION if self.legacy_pool
             else xp[1] * self.price_scale * self.precisions[1] // PRECISION),
        ]

        y = solve(xp, j)
        if y >= xp[j]:
            raise TwocryptoError("unsafe value for y")
        dy = xp[j] - y - 1
        xp[j] = y
        if self.legacy_pool:
            if j > 0:
                dy = dy * PRECISION // scale
            else:
                dy //= self.precisions[0]
        else:
            if j > 0:
                dy = dy * PRECISION // self.price_scale
            dy //= self.precisions[j]

        # The fee reads the post-trade balances, which is why `xp[j]` is
        # assigned above rather than after this line.
        return dy - self.fee(xp) * dy // FEE_PRECISION

    def _y_fast(self, xp: list[int], j: int) -> int:
        """`_y`, in floating point, for the families that have one.

        The stableswap backend is the FX Swap's, so it reuses that module's
        float iteration; the cryptoswap ones share `newton_y_fast`.  Both
        return an integer, because everything downstream -- the fee, the
        price scale -- is still the contract's integer arithmetic.
        """
        try:
            if self.stable and not self.legacy_pool:
                other = 1 - j
                return int(solve_y_fast(
                    float(self.amp), float(A_MULTIPLIER),
                    [float(v) for v in xp], float(self.d), other, j,
                    float(xp[other])))
            # The `K0_i` window, in the same units as everything else.  The
            # legacy pools fix it at 100; the optimized math narrows it once
            # gamma passes MAX_GAMMA_SMALL, exactly as `get_y` does.
            lim = 100.0
            if not self.legacy_pool and self.v21 and self.gamma > MAX_GAMMA_SMALL:
                lim = lim * MAX_GAMMA_SMALL / self.gamma
            got = newton_y_fast(self.amp / A_MULTIPLIER, self.gamma / PRECISION,
                                [v / PRECISION for v in xp],
                                self.d / PRECISION, j, lim,
                                inline=self.legacy_pool,
                                mul2_over_sum=self.legacy_mul2)
            return int(got * PRECISION)
        except (CryptoSwapError, StableSwapError) as exc:
            raise TwocryptoError(str(exc)) from exc

    def _y(self, xp: list[int], j: int) -> int:
        if self.legacy_pool:
            # The generation before the optimized math: Newton, inlined in the
            # pool itself.  `lim_mul` is the fixed 100e18 of that era.
            try:
                return _newton_y(self.amp, self.gamma, xp, self.d, j,
                                 100 * PRECISION, inline=True,
                                 mul2_over_sum=self.legacy_mul2)
            except CryptoSwapError as exc:
                raise TwocryptoError(str(exc)) from exc
        if not self.stable:
            # `ANN` is `A * N**N`, which is what `A()` already returns.
            try:
                return crypto_get_y(self.amp, self.gamma, xp, self.d, j,
                                    v21=self.v21)[0]
            except CryptoSwapError as exc:
                raise TwocryptoError(str(exc)) from exc
        # `StableswapMath.get_y`: the stableswap iteration at A_MULTIPLIER.
        # `i` and `j` are the other way round from `solve_y`'s signature --
        # there, `i` is the coin whose balance is known.
        other = 1 - j
        try:
            return solve_y(self.amp, A_MULTIPLIER, xp, self.d,
                           other, j, xp[other])
        except StableSwapError as exc:
            raise TwocryptoError(str(exc)) from exc
