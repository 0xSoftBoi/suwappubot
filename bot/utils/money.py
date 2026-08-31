"""Fixed-point money arithmetic.

Adopted from the Tektonic HyperReplay methodology (docs/plans/tektonic-blog-study.md,
W1.4): a clearinghouse keeps money in fixed point, so any system that reconstructs or
audits its state must *emulate* fixed point deliberately rather than hope IEEE-754
happens to agree. The rules here are the whole of that emulation:

1. Every money value has a declared precision, chosen per asset class, not per call site.
2. Arithmetic happens in ``Decimal`` at full precision; rounding happens **once**, at the
   published precision, at the boundary where the value is stored or displayed.
3. Rounding is ``ROUND_HALF_EVEN`` everywhere. Banker's rounding is unbiased over many
   fills; ``ROUND_HALF_UP`` accumulates a systematic drift in our favour, which is both a
   correctness bug and a compliance problem.
4. ``float`` is an I/O format, never an accumulator. Convert in at the edge with
   :func:`d`, accumulate in ``Decimal``, convert out with :func:`to_float` only when
   handing the value to SQLAlchemy/JSON.

Precision constants match the precision we publish, mirroring Tektonic's 8dp price /
4dp quantity split.
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from typing import Iterable, Mapping, Optional, Union

Numeric = Union[int, float, str, Decimal]

# --- Published precisions -------------------------------------------------------------
# USD-denominated amounts (fees, volume, notional). Six places keeps sub-cent micro
# payments (x402 tickets average $0.17-$0.32) representable without inventing precision.
USD_PRECISION = 6
# Token quantities. Chain-native decimals are handled separately by ATOMIC_* helpers;
# this is the precision of the human-readable quantity we persist and publish.
QTY_PRECISION = 8
# Prices and exchange rates.
PRICE_PRECISION = 8
# Percentages / basis-point rates expressed as fractions (0.01 == 1%).
RATE_PRECISION = 10
# Loyalty points and XP are integral by definition. Any fractional award is a bug
# upstream; we round it here rather than silently truncating in the DB.
POINTS_PRECISION = 0

_QUANTIZERS: dict[int, Decimal] = {}


def _quantizer(places: int) -> Decimal:
    q = _QUANTIZERS.get(places)
    if q is None:
        q = Decimal(1).scaleb(-places) if places > 0 else Decimal(1)
        _QUANTIZERS[places] = q
    return q


def d(value: Optional[Numeric]) -> Decimal:
    """Coerce any inbound numeric to ``Decimal`` without losing declared digits.

    ``float`` inputs go through ``repr`` so that ``0.1`` becomes ``Decimal("0.1")`` and
    not ``Decimal("0.1000000000000000055511151231257827021181583404541015625")``. That
    binary tail is exactly the noise that makes replay diverge from the ledger.
    """
    if value is None:
        return Decimal(0)
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"non-finite money value: {value!r}")
        return Decimal(repr(value))
    try:
        return Decimal(str(value).strip() or 0)
    except InvalidOperation as exc:  # pragma: no cover - defensive
        raise ValueError(f"not a money value: {value!r}") from exc


def quantize(value: Optional[Numeric], places: int) -> Decimal:
    """Round ``value`` to ``places`` decimal places, half-to-even."""
    with localcontext() as ctx:
        ctx.prec = 60
        return d(value).quantize(_quantizer(places), rounding=ROUND_HALF_EVEN)


def q_usd(value: Optional[Numeric]) -> Decimal:
    """Quantize to published USD precision."""
    return quantize(value, USD_PRECISION)


def q_qty(value: Optional[Numeric]) -> Decimal:
    """Quantize to published token-quantity precision."""
    return quantize(value, QTY_PRECISION)


def q_price(value: Optional[Numeric]) -> Decimal:
    """Quantize to published price precision."""
    return quantize(value, PRICE_PRECISION)


def q_rate(value: Optional[Numeric]) -> Decimal:
    """Quantize a fractional rate (0.01 == 1%)."""
    return quantize(value, RATE_PRECISION)


def q_points(value: Optional[Numeric]) -> Decimal:
    """Quantize a points/XP award to a whole number."""
    return quantize(value, POINTS_PRECISION)


def to_float(value: Optional[Numeric]) -> float:
    """Boundary conversion for storage/JSON. Do not use mid-computation."""
    return float(d(value))


def to_int(value: Optional[Numeric]) -> int:
    """Boundary conversion for integral columns (points, XP, counts)."""
    return int(q_points(value))


# --- Composite money operations -------------------------------------------------------


def apply_rate(
    amount: Optional[Numeric], rate: Optional[Numeric], *, places: int = USD_PRECISION
) -> Decimal:
    """``amount * rate`` with a single rounding at the end.

    Used for fee math. Computing ``amount * pct / 100`` in float and rounding at each
    step is how a fee schedule that reads as 1.00% ends up charging 1.0000004%.
    """
    with localcontext() as ctx:
        ctx.prec = 60
        return quantize(d(amount) * d(rate), places)


def pct_to_rate(percentage: Optional[Numeric]) -> Decimal:
    """Convert a human percentage (``1.0`` == 1%) to a fraction (``0.01``)."""
    with localcontext() as ctx:
        ctx.prec = 60
        return q_rate(d(percentage) / Decimal(100))


def clamp(
    value: Optional[Numeric], minimum: Optional[Numeric], maximum: Optional[Numeric]
) -> Decimal:
    """Clamp into ``[minimum, maximum]``; either bound may be ``None``."""
    v = d(value)
    if minimum is not None:
        lo = d(minimum)
        if v < lo:
            v = lo
    if maximum is not None:
        hi = d(maximum)
        if v > hi:
            v = hi
    return v


def total(values: Iterable[Optional[Numeric]], *, places: int = USD_PRECISION) -> Decimal:
    """Sum in ``Decimal``, round once. The whole point of the module in one function."""
    with localcontext() as ctx:
        ctx.prec = 60
        acc = Decimal(0)
        for v in values:
            acc += d(v)
        return quantize(acc, places)


def from_atomic(atomic: Optional[Numeric], decimals: int) -> Decimal:
    """Chain-native integer units -> human quantity, exact (no rounding)."""
    with localcontext() as ctx:
        ctx.prec = 60
        return d(atomic).scaleb(-int(decimals))


def to_atomic(amount: Optional[Numeric], decimals: int) -> int:
    """Human quantity -> chain-native integer units.

    Truncates toward zero rather than rounding: submitting more atomic units than the
    user authorised is worse than dusting a remainder.
    """
    with localcontext() as ctx:
        ctx.prec = 60
        return int(d(amount).scaleb(int(decimals)).to_integral_value(rounding="ROUND_DOWN"))


# --- Allocation -----------------------------------------------------------------------


def pro_rata(
    amount: Optional[Numeric], weights: Mapping[str, Numeric], *, places: int = USD_PRECISION
) -> dict[str, Decimal]:
    """Split ``amount`` across ``weights`` proportionally, conserving the total exactly.

    Tektonic's ADL analysis showed that greedy "fill the single largest claim first"
    allocation is provably suboptimal and transferred $45-52M unnecessarily, while
    integer pro-rata cut that to ~$3M with zero capital. Any place we distribute a pool
    (fee splits, referral tiers, epoch rewards, socialised loss) should use this rather
    than a greedy loop.

    The largest-remainder method assigns the rounding dust to the largest fractional
    remainders, so ``sum(result.values()) == quantize(amount)`` exactly.
    """
    with localcontext() as ctx:
        ctx.prec = 60
        target = quantize(amount, places)
        weight_total = Decimal(0)
        clean: dict[str, Decimal] = {}
        for key, w in weights.items():
            dw = d(w)
            if dw < 0:
                raise ValueError(f"negative weight for {key!r}: {w!r}")
            clean[key] = dw
            weight_total += dw
        if not clean:
            return {}
        if weight_total == 0:
            # Degenerate: everyone weighted zero. Split evenly rather than dropping funds.
            clean = {k: Decimal(1) for k in clean}
            weight_total = Decimal(len(clean))

        step = _quantizer(places)
        exact: dict[str, Decimal] = {}
        floors: dict[str, Decimal] = {}
        for key, w in clean.items():
            share = target * w / weight_total
            exact[key] = share
            floors[key] = share.quantize(step, rounding="ROUND_DOWN")

        allocated = sum(floors.values(), Decimal(0))
        dust_units = int(
            ((target - allocated) / step).to_integral_value(rounding="ROUND_HALF_EVEN")
        )

        # Deterministic ordering: largest remainder first, then lexicographic key. The
        # key tiebreak is what makes the split reproducible across runs and machines.
        order = sorted(
            clean.keys(),
            key=lambda k: (-(exact[k] - floors[k]), str(k)),
        )
        result = dict(floors)
        for i in range(max(dust_units, 0)):
            result[order[i % len(order)]] += step
        return {k: quantize(v, places) for k, v in result.items()}


__all__ = [
    "USD_PRECISION",
    "QTY_PRECISION",
    "PRICE_PRECISION",
    "RATE_PRECISION",
    "POINTS_PRECISION",
    "d",
    "quantize",
    "q_usd",
    "q_qty",
    "q_price",
    "q_rate",
    "q_points",
    "to_float",
    "to_int",
    "apply_rate",
    "pct_to_rate",
    "clamp",
    "total",
    "from_atomic",
    "to_atomic",
    "pro_rata",
]
