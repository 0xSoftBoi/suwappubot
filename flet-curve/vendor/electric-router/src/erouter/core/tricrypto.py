"""Tricrypto: the three-coin cryptoswap, evaluated exactly (§11.3).

Ported from the verified source of the contracts these pools actually call:

    0xcbff3004a20dbfe2731543aa38599a526e0fd6ee  CurveTricryptoMathOptimized
    the factory's `views_implementation()`      CurveTricryptoViews

A separate module from `twocrypto.py` rather than a generalisation of it, because
almost nothing carries over.  `get_y` is the same analytic *shape* -- a cubic, a
divider ladder, two cube roots -- with entirely different coefficients, and the
fee is a different function too.  Sharing the code would have meant a parameter
on every line.

What does carry over is the discipline: `_sdiv` for Vyper's truncate-toward-zero
signed division, an explicit mask where `pow_mod256` wraps, and every `assert` in
the contract as a raise, so the model refuses wherever the chain would revert.

`get_y` falls back to `_newton_y` when the discriminant is not positive, and the
contract itself notes the two "can be off by 2 wei or so" -- which is why the
check that admits a pool compares against the pool's own `get_dy` rather than
against either routine in isolation.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import isqrt

N_COINS = 3
A_MULTIPLIER = 10_000
PRECISION = 10**18
FEE_PRECISION = 10**10
UINT256 = 2**256

MIN_GAMMA = 10**10
MAX_GAMMA = 5 * 10**16
MIN_A = N_COINS**N_COINS * A_MULTIPLIER // 100
MAX_A = 1000 * A_MULTIPLIER * N_COINS**N_COINS
MAX_ITER = 255

#: Where the float iteration stops, relative; the integer one stops at a
#: wei-denominated floor with no floating-point meaning.
_FAST_TOL = 1e-14


class TricryptoError(ArithmeticError):
    """The state is outside what the invariant will solve."""


def _sdiv(a: int, b: int) -> int:
    """Signed division truncating toward zero, as the EVM does it."""
    if b == 0:
        raise TricryptoError("division by zero")
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def _cbrt(x: int) -> int:
    """`_cbrt`: log2 seed, then seven unrolled Newton steps -- not converged."""
    if x >= 115792089237316195423570985008687907853269 * 10**18:
        xx = x
    elif x >= 115792089237316195423570985008687907853269:
        xx = x * 10**18
    else:
        xx = x * 10**36

    log2x = xx.bit_length() - 1 if xx > 0 else 0
    remainder = log2x % 3
    a = (
        (pow(2, log2x // 3, UINT256) * pow(1260, remainder, UINT256)) % UINT256
    ) // pow(1000, remainder, UINT256)

    for _ in range(7):
        if a == 0:
            raise TricryptoError("cbrt seed collapsed")
        a = (2 * a + xx // (a * a)) // 3

    if x >= 115792089237316195423570985008687907853269 * 10**18:
        a *= 10**12
    elif x >= 115792089237316195423570985008687907853269:
        a *= 10**6
    return a


def reduction_coefficient(x: list[int], fee_gamma: int) -> int:
    """`K = prod(x) / (sum(x)/N)**N`, regulated by `fee_gamma`."""
    s = x[0] + x[1] + x[2]
    if s <= 0:
        raise TricryptoError("empty pool")
    k = PRECISION * N_COINS * x[0] // s
    k = k * N_COINS * x[1] // s
    k = k * N_COINS * x[2] // s
    if fee_gamma > 0:
        k = fee_gamma * PRECISION // (fee_gamma + PRECISION - k)
    return k


def _newton_y(ann: int, gamma: int, x: list[int], d: int, i: int,
              *, check_inputs: bool = False,
              a_multiplier: int = A_MULTIPLIER) -> int:
    """The fallback `get_y` takes when the discriminant is not positive.

    `check_inputs` adds the bound the 2021 pools apply before iterating -- every
    *other* balance must sit within `[1e16, 1e20]` of `D` -- which the optimized
    math dropped.  It is a refusal the pool makes, so a model of one of those
    pools has to make it too.

    `a_multiplier` is not a constant across the generations, which is the same
    trap `a_precision` is in stableswap: tricrypto2 and the optimized math use
    10,000, and the original 2021 tricrypto uses **100**.  Taking the wrong one
    quotes the pool about twice wrong -- close enough to look like a rounding
    problem and not be one.
    """
    scale = a_multiplier // A_MULTIPLIER if a_multiplier >= A_MULTIPLIER else 1
    lo_a = MIN_A * a_multiplier // A_MULTIPLIER
    hi_a = MAX_A * a_multiplier // A_MULTIPLIER
    del scale
    if not (lo_a - 1 < ann < hi_a + 1):
        raise TricryptoError("unsafe values A")
    if not (MIN_GAMMA - 1 < gamma < MAX_GAMMA + 1):
        raise TricryptoError("unsafe values gamma")
    if not (10**17 - 1 < d < 10**15 * 10**18 + 1):
        raise TricryptoError("unsafe values D")

    if check_inputs:
        for k in range(N_COINS):
            if k == i:
                continue
            frac = x[k] * PRECISION // d
            if not (10**16 - 1 < frac < 10**20 + 1):
                raise TricryptoError("unsafe values x[i]")

    y = d // N_COINS
    k0_i = PRECISION
    s_i = 0
    x_sorted = sorted((v for k, v in enumerate(x) if k != i), reverse=True)
    convergence_limit = max(max(x_sorted[0] // 10**14, d // 10**14), 100)

    for j in range(2, N_COINS + 1):
        _x = x_sorted[N_COINS - j]
        if _x <= 0:
            raise TricryptoError("empty balance")
        y = y * d // (_x * N_COINS)
        s_i += _x
    for j in range(N_COINS - 1):
        k0_i = k0_i * x_sorted[j] * N_COINS // d

    for _ in range(MAX_ITER):
        y_prev = y
        if y <= 0:
            raise TricryptoError("y collapsed")
        k0 = k0_i * y * N_COINS // d
        s = s_i + y
        if k0 <= 0:
            raise TricryptoError("K0 collapsed")

        g1k0 = gamma + PRECISION
        g1k0 = g1k0 - k0 + 1 if g1k0 > k0 else k0 - g1k0 + 1

        mul1 = PRECISION * d // gamma * g1k0 // gamma * g1k0 * a_multiplier // ann
        mul2 = PRECISION + (2 * PRECISION) * k0 // g1k0

        yfprime = PRECISION * y + s * mul2 + mul1
        dyfprime = d * mul2
        if yfprime < dyfprime:
            y = y_prev // 2
            continue
        yfprime -= dyfprime
        fprime = yfprime // y
        if fprime <= 0:
            raise TricryptoError("derivative collapsed")

        y_minus = mul1 // fprime
        y_plus = (yfprime + PRECISION * d) // fprime + y_minus * PRECISION // k0
        y_minus += PRECISION * s // fprime
        y = y_prev // 2 if y_plus < y_minus else y_plus - y_minus

        diff = y - y_prev if y > y_prev else y_prev - y
        if diff < max(convergence_limit, y // 10**14):
            frac = y * PRECISION // d
            if not (10**16 - 1 < frac < 10**20 + 1):
                raise TricryptoError("unsafe value for y")
            return y

    raise TricryptoError("y did not converge")


# ------------------------------------------------------ the float fast path
#
# The same dimensional reduction as `cryptoswap.newton_y_fast`, at N = 3.
# Balances, `D` and their sums are dollars, `PRECISION` is one dollar, `gamma`
# and `K0` are dimensionless, `ann` carries `A_MULTIPLIER` -- and every 1e18
# in the iteration cancels:
#
#     k0_i = 1e18 * prod(x_k * N // d)  ->  prod(N * x_k / D)
#     k0   = k0_i * y * N // d          ->  k0_i * N * y / D
#     mul1 = ... * A_MULTIPLIER // ann  ->  D * G**2 / (gamma**2 * A)   [$]
#     mul2 = 1e18 + 2e18 * k0 // g1k0   ->  1 + 2 * k0 / G              [-]
#
# The closing bound goes with it: `frac = y * 1e18 // d` against
# `1e16 < frac < 1e20` is `0.01 < y / D < 100`.  It is a refusal the pool
# makes, so the float path has to make it too.

def newton_y_fast(a: float, gamma: float, x: list[float], d: float,
                  i: int, check_inputs: bool = False) -> float:
    """Balance `i` restoring the invariant, in dollars.

    `a` is `ann / A_MULTIPLIER` and `gamma` is `gamma / 1e18`; `x` and `d` are
    dollars.  The `A`, `gamma` and `D` range checks stay with the caller,
    which still holds them as the integers the contract compares.
    """
    others = sorted((v for k, v in enumerate(x) if k != i), reverse=True)
    if others[-1] <= 0.0 or d <= 0.0 or a <= 0.0 or gamma <= 0.0:
        raise TricryptoError("empty balance")

    if check_inputs:
        # `1e16 <= x[k] * 1e18 / D <= 1e20` reduces to `0.01 <= x[k]/D <= 100`.
        for k in range(N_COINS):
            if k != i and not (0.01 <= x[k] / d <= 100.0):
                raise TricryptoError("unsafe values x[i]")

    y = d / N_COINS
    s_i = 0.0
    for j in range(2, N_COINS + 1):
        _x = others[N_COINS - j]
        y = y * d / (_x * N_COINS)
        s_i += _x
    k0_i = 1.0
    for j in range(N_COINS - 1):
        k0_i = k0_i * others[j] * N_COINS / d

    for _ in range(MAX_ITER):
        y_prev = y
        if y <= 0.0:
            raise TricryptoError("y collapsed")
        k0 = k0_i * y * N_COINS / d
        s = s_i + y
        if k0 <= 0.0:
            raise TricryptoError("K0 collapsed")

        g1k0 = abs(gamma + 1.0 - k0)
        if g1k0 <= 0.0:
            raise TricryptoError("K0 at the pole")

        mul1 = d * g1k0 * g1k0 / (gamma * gamma * a)
        mul2 = 1.0 + 2.0 * k0 / g1k0

        yfprime = y + s * mul2 + mul1
        dyfprime = d * mul2
        if yfprime < dyfprime:
            y = y_prev * 0.5
            continue
        yfprime -= dyfprime
        fprime = yfprime / y
        if fprime <= 0.0:
            raise TricryptoError("derivative collapsed")

        y_minus = mul1 / fprime
        y_plus = (yfprime + d) / fprime + y_minus / k0
        y_minus += s / fprime
        y = y_prev * 0.5 if y_plus < y_minus else y_plus - y_minus

        if abs(y - y_prev) < _FAST_TOL * y:
            frac = y / d
            if not (0.01 < frac < 100.0):
                raise TricryptoError("unsafe value for y")
            return y

    raise TricryptoError("y did not converge")


def get_y(ann: int, gamma: int, x: list[int], d: int, i: int) -> tuple[int, int]:
    """`CurveTricryptoMathOptimized.get_y`, returning `(y, K0_prev)`."""
    if not (MIN_A - 1 < ann < MAX_A + 1):
        raise TricryptoError("unsafe values A")
    if not (MIN_GAMMA - 1 < gamma < MAX_GAMMA + 1):
        raise TricryptoError("unsafe values gamma")
    if not (10**17 - 1 < d < 10**15 * 10**18 + 1):
        raise TricryptoError("unsafe values D")

    for k in range(N_COINS):
        if k != i:
            frac = x[k] * PRECISION // d
            if not (10**16 - 1 < frac < 10**20 + 1):
                raise TricryptoError("unsafe values x[i]")

    j, k = (1, 2) if i == 0 else ((0, 2) if i == 1 else (0, 1))
    x_j, x_k = x[j], x[k]
    gamma2 = gamma * gamma

    a = 10**36 // 27
    b = (
        10**36 // 9
        + 2 * 10**18 * gamma // 27
        - _sdiv(_sdiv(_sdiv(_sdiv(d * d, x_j) * gamma2 * ann, 27**2),
                      A_MULTIPLIER), x_k)
    )
    c = (
        10**36 // 9
        + gamma * (gamma + 4 * 10**18) // 27
        + _sdiv(_sdiv(_sdiv(gamma2 * (x_j + x_k - d), d) * ann, 27), A_MULTIPLIER)
    )
    dd = (PRECISION + gamma) ** 2 // 27

    if b == 0:
        raise TricryptoError("degenerate cubic")
    d0 = abs(_sdiv(3 * a * c, b) - b)

    divider = 1
    for bound, value in ((10**48, 10**30), (10**44, 10**26), (10**40, 10**22),
                         (10**36, 10**18), (10**32, 10**14), (10**28, 10**10),
                         (10**24, 10**6), (10**20, 10**2)):
        if d0 > bound:
            divider = value
            break

    if abs(a) > abs(b):
        additional_prec = abs(_sdiv(a, b))
        a = _sdiv(a * additional_prec, divider)
        b = _sdiv(b * additional_prec, divider)
        c = _sdiv(c * additional_prec, divider)
        dd = _sdiv(dd * additional_prec, divider)
    else:
        additional_prec = abs(_sdiv(b, a))
        if additional_prec == 0:
            raise TricryptoError("precision collapsed")
        a = _sdiv(_sdiv(a, additional_prec), divider)
        b = _sdiv(_sdiv(b, additional_prec), divider)
        c = _sdiv(_sdiv(c, additional_prec), divider)
        dd = _sdiv(_sdiv(dd, additional_prec), divider)
    if a == 0 or b == 0:
        raise TricryptoError("degenerate cubic after scaling")

    _3ac = 3 * a * c
    delta0 = _sdiv(_3ac, b) - b
    delta1 = _sdiv(3 * _3ac, b) - 2 * b - _sdiv(_sdiv(27 * a**2, b) * dd, b)

    sqrt_arg = delta1**2 + _sdiv(4 * delta0**2, b) * delta0
    if sqrt_arg <= 0:
        # Not a failure: the contract takes this branch too.
        return _newton_y(ann, gamma, x, d, i), 0
    sqrt_val = isqrt(sqrt_arg)

    b_cbrt = _cbrt(b) if b >= 0 else -_cbrt(-b)
    if delta1 > 0:
        second_cbrt = _cbrt((delta1 + sqrt_val) // 2)
    else:
        second_cbrt = -_cbrt(-(delta1 - sqrt_val) // 2)

    c1 = _sdiv(_sdiv(b_cbrt * b_cbrt, PRECISION) * second_cbrt, PRECISION)
    if c1 == 0:
        raise TricryptoError("C1 collapsed")

    root_k0 = _sdiv(b + _sdiv(b * delta0, c1) - c1, 3)
    root = _sdiv(_sdiv(_sdiv(_sdiv(d * d, 27), x_k) * d, x_j) * root_k0, a)
    if root <= 0:
        raise TricryptoError("unsafe value for y")

    frac = root * PRECISION // d
    if not (10**16 - 1 <= frac < 10**20 + 1):
        raise TricryptoError("unsafe value for y")
    return root, _sdiv(PRECISION * root_k0, a)


@dataclass(frozen=True, slots=True)
class Tricrypto:
    """One tricrypto pool, enough to reproduce `get_dy` exactly."""

    balances: tuple[int, int, int]
    precisions: tuple[int, int, int]
    #: `price_scale[k]` prices coin `k+1` against coin 0.
    price_scale: tuple[int, int]
    d: int
    amp: int
    gamma: int
    mid_fee: int
    out_fee: int
    fee_gamma: int
    #: True for the 2021 pools (tricrypto2 and its siblings), whose `get_dy`
    #: goes through `newton_y` rather than the optimized math's cubic.  The
    #: arithmetic after that point is the same in both.
    legacy: bool = False
    #: `A_MULTIPLIER` for this pool's generation: 10,000 for the optimized
    #: math and tricrypto2, 100 for the original 2021 tricrypto.
    a_multiplier: int = A_MULTIPLIER

    def fee(self, xp: list[int]) -> int:
        f = reduction_coefficient(xp, self.fee_gamma)
        return (self.mid_fee * f + self.out_fee * (PRECISION - f)) // PRECISION

    def get_dy(self, i: int, j: int, dx: int) -> int:
        """Exactly what the pool's `get_dy(i, j, dx)` returns on chain."""
        return self._quote(i, j, dx, False)

    def get_dy_fast(self, i: int, j: int, dx: int) -> int:
        """`get_dy`, solving the invariant in floating point.

        The fee, the price scale and the precisions stay integer -- they are a
        handful of operations, not a loop.  See `newton_y_fast`.
        """
        return self._quote(i, j, dx, True)

    def _quote(self, i: int, j: int, dx: int, fast: bool) -> int:
        if i == j or not (0 <= i < N_COINS) or not (0 <= j < N_COINS):
            raise TricryptoError("coin index out of range")
        if dx <= 0:
            return 0
        if not all(self.balances) or self.d <= 0:
            raise TricryptoError("empty pool")

        xp = list(self.balances)
        xp[i] += dx
        xp[0] *= self.precisions[0]
        for k in range(N_COINS - 1):
            xp[k + 1] = xp[k + 1] * self.price_scale[k] * self.precisions[k + 1] // PRECISION

        if fast and self.legacy:
            y = int(newton_y_fast(
                self.amp / self.a_multiplier, self.gamma / PRECISION,
                [v / PRECISION for v in xp], self.d / PRECISION, j,
                True) * PRECISION)
        elif self.legacy:
            y = _newton_y(self.amp, self.gamma, xp, self.d, j, check_inputs=True,
                          a_multiplier=self.a_multiplier)
        elif fast:
            # The range checks the contract makes on A, gamma and D are
            # comparisons against the integers it holds, so they are made
            # here rather than re-derived in floating point.
            if not (MIN_A - 1 < self.amp < MAX_A + 1):
                raise TricryptoError("unsafe values A")
            if not (MIN_GAMMA - 1 < self.gamma < MAX_GAMMA + 1):
                raise TricryptoError("unsafe values gamma")
            if not (10**17 - 1 < self.d < 10**15 * 10**18 + 1):
                raise TricryptoError("unsafe values D")
            y = int(newton_y_fast(
                self.amp / self.a_multiplier, self.gamma / PRECISION,
                [v / PRECISION for v in xp], self.d / PRECISION, j) * PRECISION)
        else:
            y = get_y(self.amp, self.gamma, xp, self.d, j)[0]
        if y >= xp[j]:
            raise TricryptoError("unsafe value for y")
        dy = xp[j] - y - 1
        xp[j] = y
        if j > 0:
            dy = dy * PRECISION // self.price_scale[j - 1]
        dy //= self.precisions[j]

        # The fee reads the post-trade balances.
        return dy - self.fee(xp) * dy // FEE_PRECISION


@dataclass(frozen=True, slots=True)
class TricryptoLP:
    """A tricrypto pool's withdrawal arc, to the wei.

    Only `remove_liquidity_one_coin` is modelled here.  Deposits are already
    exact through the pool's own `calc_token_amount`, which charges the same fee
    `add_liquidity` does -- measured across every tricrypto pool on Ethereum,
    view and execution agree to the wei -- so there is nothing for a model to
    correct.

    **What this does not model is the admin fee claim.**
    `remove_liquidity_one_coin` runs `_claim_admin_fees()` before it prices `dy`,
    and that is a *state* change the pool makes to itself, not part of the
    withdrawal arithmetic.  It is corrected in `RouteQuoter._quote`, where it
    applies to the probed and verified paths alike.  Keeping the two separate is
    deliberate: this reproduces `calc_withdraw_one_coin`, and that is the thing it
    can be checked against.
    """

    pool: Tricrypto
    total_supply: int

    @property
    def n(self) -> int:
        return N_COINS

    def calc_withdraw_one_coin(self, token_amount: int, i: int) -> int:
        """Exactly what the pool's `calc_withdraw_one_coin` returns on chain."""
        if not 0 <= i < N_COINS:
            raise TricryptoError("coin index out of range")
        if self.total_supply <= 0:
            raise TricryptoError("no supply")
        if token_amount > self.total_supply:
            raise TricryptoError("token amount more than supply")
        if token_amount <= 0:
            return 0
        p = self.pool
        if not all(p.balances) or p.d <= 0:
            raise TricryptoError("empty pool")

        # `price_scale_i` is read *before* `xp[i]` is overwritten, so for i > 0
        # it carries `precisions[i]` and not the scaled balance.  Following the
        # source literally here matters: the two differ by the balance itself.
        xp = list(p.precisions)
        price_scale_i = PRECISION * p.precisions[0]
        xp[0] *= p.balances[0]
        for k in range(1, N_COINS):
            scale = p.price_scale[k - 1]
            if i == k:
                price_scale_i = scale * xp[i]
            xp[k] = xp[k] * p.balances[k] * scale // PRECISION

        d = p.d
        # The fee is charged on a deliberately imprecise post-withdrawal `xp`:
        # the pool says so in as many words, because it only wants the fee to
        # rise with imbalance, not to be exact.  A withdrawal too large for the
        # correction to fit keeps the maximum fee, which is what stops the
        # subtraction underflowing.
        imprecise = list(xp)
        correction = xp[i] * N_COINS * token_amount // self.total_supply
        fee = p.out_fee
        if correction < imprecise[i]:
            imprecise[i] -= correction
            fee = p.fee(imprecise)

        d_delta = token_amount * d // self.total_supply
        d_fee = fee * d_delta // (2 * 10**10) + 1
        d -= d_delta - d_fee
        y = get_y(p.amp, p.gamma, xp, d, i)[0]
        return (xp[i] - y) * PRECISION // price_scale_i
