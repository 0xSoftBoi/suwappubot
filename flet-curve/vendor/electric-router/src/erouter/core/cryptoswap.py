"""CryptoSwap's `get_y`, ported from the deployed math contracts.

`core/twocrypto.py` is the wrapper both twocrypto pools share; this is the
arithmetic underneath.  Integer throughout, matching the contracts to the wei.
"""

from __future__ import annotations

N_COINS = 2
A_MULTIPLIER = 10_000
PRECISION = 10**18
UINT256 = 2**256

MIN_GAMMA = 10**10
#: v2.1.0 raised this from 2e15 and added `MAX_GAMMA_SMALL`.
MAX_GAMMA_SMALL = 2 * 10**16
MAX_GAMMA_V21 = 199 * 10**15
MAX_GAMMA_V20 = 2 * 10**15
MIN_A = N_COINS**N_COINS * A_MULTIPLIER // 10
MAX_A = N_COINS**N_COINS * A_MULTIPLIER * 1000
MAX_ITER = 255

#: Where the float iteration stops, relative.  The integer one stops at a
#: wei-denominated floor, which has no floating-point meaning.
_FAST_TOL = 1e-14


class CryptoSwapError(ArithmeticError):
    """The state is outside what the invariant will solve."""


def _sdiv(a: int, b: int) -> int:
    """Signed division truncating toward zero, as the EVM does it."""
    if b == 0:
        raise CryptoSwapError("division by zero")
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def _log2(x: int) -> int:
    """`_snekmate_log_2(x, False)` -- the index of the top set bit, 0 for 0."""
    return x.bit_length() - 1 if x > 0 else 0


def cbrt(x: int) -> int:
    """`_cbrt`: seeded from log2, then seven unrolled Newton steps.

    The iteration count is part of the answer: the contract runs exactly seven
    and stops, so a "converged" result here would be a different number.
    """
    if x >= 115792089237316195423570985008687907853269 * 10**18:
        xx = x
    elif x >= 115792089237316195423570985008687907853269:
        xx = x * 10**18
    else:
        xx = x * 10**36

    log2x = _log2(xx)
    remainder = log2x % 3
    a = (
        (pow(2, log2x // 3, UINT256) * pow(1260, remainder, UINT256)) % UINT256
    ) // pow(1000, remainder, UINT256)

    for _ in range(7):
        if a == 0:
            raise CryptoSwapError("cbrt seed collapsed")
        a = (2 * a + xx // (a * a)) // 3

    if x >= 115792089237316195423570985008687907853269 * 10**18:
        a *= 10**12
    elif x >= 115792089237316195423570985008687907853269:
        a *= 10**6
    return a


def _isqrt(x: int) -> int:
    import math

    return math.isqrt(x)


def _newton_y(ann: int, gamma: int, x: list[int], d: int, i: int,
              lim_mul: int, *, inline: bool = False,
              mul2_over_sum: bool = False) -> int:
    """The fallback `get_y` reaches for when the discriminant is not positive.

    Also the *whole* of `get_y` for the 2-coin pools that predate the optimized
    math and iterate in the pool itself (`inline`).  Those bound `K0_i` rather
    than `frac` -- twice ours at each end, since `K0_i` carries the `N_COINS`
    factor `frac` does not -- and re-check the answer before returning it.

    `mul2_over_sum` is the one line on which two deployed generations of that
    inline loop disagree: Vyper 0.3.1's `10**18 + (2 * 10**18) * K0 / _g1k0`
    against 0.3.3's `unsafe_div(10**18 + (2 * 10**18) * K0, _g1k0)`, which moved
    the `10**18` inside the division.  Both are live -- 41 mainnet pools take the
    first, Gnosis's EURe-3Crv the second -- and they differ by ~1e18 in 2e20,
    which Newton damps to 4e-10 in the answer: small enough to read as rounding
    and far too large to be it, so the pool misses the wei-exact gate and goes
    unmodelled.  Which one a pool implements is settled by that gate, never by a
    list of addresses.
    """
    x_j = x[1 - i]
    if x_j <= 0 or d <= 0:
        raise CryptoSwapError("empty balance")
    y = d**2 // (x_j * N_COINS**2)
    k0_i = (PRECISION * N_COINS) * x_j // d
    if inline:
        if not (10**16 * N_COINS - 1 < k0_i < 10**20 * N_COINS + 1):
            raise CryptoSwapError("unsafe values x[i]")
    elif not (k0_i >= 10**36 // lim_mul and k0_i <= lim_mul):
        raise CryptoSwapError("unsafe values x[i]")

    convergence_limit = max(max(x_j // 10**14, d // 10**14), 100)

    for _ in range(MAX_ITER):
        y_prev = y
        if y <= 0:
            raise CryptoSwapError("y collapsed")
        k0 = k0_i * y * N_COINS // d
        s = x_j + y
        if k0 <= 0:
            raise CryptoSwapError("K0 collapsed")

        g1k0 = gamma + PRECISION
        g1k0 = g1k0 - k0 + 1 if g1k0 > k0 else k0 - g1k0 + 1

        mul1 = PRECISION * d // gamma * g1k0 // gamma * g1k0 * A_MULTIPLIER // ann
        mul2 = ((PRECISION + (2 * PRECISION) * k0) // g1k0 if mul2_over_sum
                else PRECISION + (2 * PRECISION) * k0 // g1k0)

        yfprime = PRECISION * y + s * mul2 + mul1
        dyfprime = d * mul2
        if yfprime < dyfprime:
            y = y_prev // 2
            continue
        yfprime -= dyfprime
        fprime = yfprime // y
        if fprime <= 0:
            raise CryptoSwapError("derivative collapsed")

        y_minus = mul1 // fprime
        y_plus = (yfprime + PRECISION * d) // fprime + y_minus * PRECISION // k0
        y_minus += PRECISION * s // fprime
        y = y_prev // 2 if y_plus < y_minus else y_plus - y_minus

        diff = y - y_prev if y > y_prev else y_prev - y
        if diff < max(convergence_limit, y // 10**14):
            if inline and not (10**16 - 1 < y * PRECISION // d < 10**20 + 1):
                # The inline generation checks its own answer before handing
                # it back, so a size it would refuse must not be quoted here.
                raise CryptoSwapError("unsafe value for y")
            return y

    raise CryptoSwapError("y did not converge")


# ------------------------------------------------------ the float fast path
#
# This arithmetic was floating point before it was integer.  `PRECISION`,
# `A_MULTIPLIER` and the `divider` ladder stepping 10**48 down to 10**20 are not
# the algorithm -- they are armour keeping intermediates inside u256.
# Transcribing them into `f64` would be the worst of both: `delta0 = 3ac/b - b`
# differences two like-sized 1e32 quantities, catastrophic cancellation at 53
# bits of mantissa.
#
# So the scaling is undone instead, one variable at a time, by giving each its
# dimension.  Balances, `D` and their sums are *dollars*; `PRECISION` is one
# dollar; `gamma` and `K0` are dimensionless; `ann` carries `A_MULTIPLIER`.
# Written that way every 1e18 cancels:
#
#     k0_i = 1e18 * N * x_j // d          ->  N * x_j / D
#     k0   = k0_i * y * N // d            ->  N**2 * x_j * y / D**2
#     g1k0 = |gamma + 1e18 - k0| + 1      ->  G = |gamma + 1 - k0|
#     mul1 = 1e18*d//gamma*g1k0//gamma
#            *g1k0*A_MULTIPLIER//ann      ->  D * G**2 / (gamma**2 * A)   [$]
#     mul2 = 1e18 + 2e18*k0//g1k0         ->  1 + 2 * k0 / G             [-]
#       ... or (1e18 + 2e18*k0)//g1k0    ->  (1 + 2 * k0) / G           [-]
#     fprime = yfprime // y               ->  yfprime / y                [-]
#
# What is left is the Newton iteration the whitepaper describes, self-correcting
# rather than accumulating the rounding of a closed form.  The `+ 1` on `g1k0`
# and the wei-denominated convergence floor are integer artifacts and go.

def newton_y_fast(a: float, gamma: float, x: list[float], d: float,
                  i: int, lim: float = 100.0, *, inline: bool = False,
                  mul2_over_sum: bool = False) -> float:
    """Balance `i` restoring the invariant, in dollars.

    `a` is `ann / A_MULTIPLIER`, `gamma` is `gamma / 1e18`, and `x` and `d` are
    in dollars -- the units the algorithm was written in before it was made to
    fit in integers.  `lim` is the `K0_i` window, `lim_mul / 1e18`: the contract
    asks `10**36 // lim_mul <= k0_i <= lim_mul`, and dividing through leaves
    `1 / lim <= N * x_j / D <= lim`.  Not decoration -- a pool outside that
    window reverts, so a float path that skipped the test would quote sizes the
    chain refuses.
    """
    x_j = x[1 - i]
    if x_j <= 0.0 or d <= 0.0 or a <= 0.0 or gamma <= 0.0:
        raise CryptoSwapError("empty balance")

    y = d * d / (x_j * N_COINS * N_COINS)
    k0_i = N_COINS * x_j / d
    if inline:
        # `10**16 * N < K0_i < 10**20 * N` with the 1e18 divided out.
        if not (0.01 * N_COINS < k0_i < 100.0 * N_COINS):
            raise CryptoSwapError("unsafe values x[i]")
    elif not (1.0 / lim <= k0_i <= lim):
        raise CryptoSwapError("unsafe values x[i]")

    for _ in range(MAX_ITER):
        y_prev = y
        if y <= 0.0:
            raise CryptoSwapError("y collapsed")
        k0 = k0_i * y * N_COINS / d
        if k0 <= 0.0:
            raise CryptoSwapError("K0 collapsed")
        s = x_j + y

        g1k0 = abs(gamma + 1.0 - k0)
        if g1k0 <= 0.0:
            raise CryptoSwapError("K0 at the pole")

        mul1 = d * g1k0 * g1k0 / (gamma * gamma * a)
        mul2 = (1.0 + 2.0 * k0) / g1k0 if mul2_over_sum else 1.0 + 2.0 * k0 / g1k0

        yfprime = y + s * mul2 + mul1
        dyfprime = d * mul2
        if yfprime < dyfprime:
            y = y_prev * 0.5
            continue
        yfprime -= dyfprime
        fprime = yfprime / y
        if fprime <= 0.0:
            raise CryptoSwapError("derivative collapsed")

        y_minus = mul1 / fprime
        y_plus = (yfprime + d) / fprime + y_minus / k0
        y_minus += s / fprime
        y = y_prev * 0.5 if y_plus < y_minus else y_plus - y_minus

        if abs(y - y_prev) < _FAST_TOL * y:
            if inline and not (0.01 < y / d < 100.0):
                raise CryptoSwapError("unsafe value for y")
            return y

    raise CryptoSwapError("y did not converge")


def get_y(ann: int, gamma: int, x: list[int], d: int, i: int,
          *, v21: bool = True) -> tuple[int, int]:
    """`CurveTwocryptoMathOptimized.get_y`, returning `(y, K0_prev)`.

    `v21` selects which deployed version's bounds apply; the arithmetic
    between them is identical.
    """
    max_gamma = MAX_GAMMA_V21 if v21 else MAX_GAMMA_V20
    if not (MIN_A - 1 < ann < MAX_A + 1):
        raise CryptoSwapError("unsafe values A")
    if not (MIN_GAMMA - 1 < gamma < max_gamma + 1):
        raise CryptoSwapError("unsafe values gamma")
    if not (10**17 - 1 < d < 10**15 * 10**18 + 1):
        raise CryptoSwapError("unsafe values D")

    lim_mul = 100 * PRECISION
    if v21 and gamma > MAX_GAMMA_SMALL:
        lim_mul = lim_mul * MAX_GAMMA_SMALL // gamma

    x_j = x[1 - i]
    if x_j <= 0:
        raise CryptoSwapError("empty balance")
    gamma2 = gamma * gamma

    y = d**2 // (x_j * N_COINS**2)
    k0_i = PRECISION * N_COINS * x_j // d
    if v21:
        if not (10**36 // lim_mul <= k0_i <= lim_mul):
            raise CryptoSwapError("unsafe values x[i]")
    elif not (10**16 * N_COINS - 1 < k0_i < 10**20 * N_COINS + 1):
        raise CryptoSwapError("unsafe values x[i]")

    ann_gamma2 = ann * gamma2

    a = 10**32
    b = _sdiv(_sdiv(d * ann_gamma2, 400000000), x_j) - 10**32 * 3 - 2 * gamma * 10**14
    c = (
        10**32 * 3
        + 4 * gamma * 10**14
        + gamma2 // 10**4
        + _sdiv(_sdiv(4 * ann_gamma2, 400000000) * x_j, d)
        - _sdiv(4 * ann_gamma2, 400000000)
    )
    dd = -((PRECISION + gamma) ** 2 // 10**4)

    if b == 0:
        raise CryptoSwapError("degenerate cubic")
    delta0 = _sdiv(3 * a * c, b) - b
    delta1 = 3 * delta0 + b - _sdiv(_sdiv(27 * a**2, b) * dd, b)

    divider = 1
    threshold = min(min(abs(delta0), abs(delta1)), a)
    for bound, value in ((10**48, 10**30), (10**46, 10**28), (10**44, 10**26),
                         (10**42, 10**24), (10**40, 10**22), (10**38, 10**20),
                         (10**36, 10**18), (10**34, 10**16), (10**32, 10**14),
                         (10**30, 10**12), (10**28, 10**10), (10**26, 10**8),
                         (10**24, 10**6), (10**20, 10**2)):
        if threshold > bound:
            divider = value
            break

    a = _sdiv(a, divider)
    b = _sdiv(b, divider)
    c = _sdiv(c, divider)
    dd = _sdiv(dd, divider)
    if b == 0 or a == 0:
        raise CryptoSwapError("degenerate cubic after scaling")

    delta0 = _sdiv(3 * a * c, b) - b
    delta1 = 3 * delta0 + b - _sdiv(_sdiv(27 * a**2, b) * dd, b)

    sqrt_arg = delta1**2 + _sdiv(4 * delta0**2, b) * delta0
    if sqrt_arg <= 0:
        # Not a failure: the contract takes this branch too.
        return _newton_y(ann, gamma, x, d, i, lim_mul), 0
    sqrt_val = _isqrt(sqrt_arg)

    b_cbrt = cbrt(b) if b > 0 else -cbrt(-b)
    second_cbrt = cbrt((delta1 + sqrt_val) // 2) if delta1 > 0 else -cbrt((sqrt_val - delta1) // 2)

    c1 = _sdiv(_sdiv(b_cbrt**2, PRECISION) * second_cbrt, PRECISION)
    if c1 == 0:
        raise CryptoSwapError("C1 collapsed")

    root = _sdiv(
        PRECISION * c1 - PRECISION * b - _sdiv(PRECISION * b, c1) * delta0,
        3 * a,
    )
    y = _sdiv(_sdiv(_sdiv(d**2, x_j) * root, 4), PRECISION)
    if y <= 0:
        raise CryptoSwapError("unsafe value for y")

    frac = y * PRECISION // d
    if not (10**36 // N_COINS // lim_mul <= frac <= lim_mul // N_COINS):
        raise CryptoSwapError("unsafe value for y")
    return y, root
