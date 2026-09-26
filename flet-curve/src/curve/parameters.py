"""The numbers that define a pool's curve, and how to read each one."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum

from .format import percent

#: `fee()` and friends are fractions of this. 1e10 == 100%.
FEE_DENOMINATOR = 10**10

#: Vyper's fixed-point one, for `gamma`, `fee_gamma` and the prices.
PRECISION = 10**18

#: What `stored_rates()` scales every coin to, whatever its own decimals.
RATE_DECIMALS = 36

#: What a rate row is called, before the pair.
RATE_LABEL = "External oracle"

#: Decimal places for `Kind.PRECISE`, which in practice means the virtual
#: price.
PRECISE_PLACES = 12


class Kind(Enum):
    """How a raw integer becomes something worth reading."""

    #: A plain count. `A` is this: it carries its family's multiplier
    #: and is shown the way Curve shows it.
    INTEGER = "integer"
    #: A fraction of `FEE_DENOMINATOR`, shown as a percentage.
    PERCENT = "percent"
    #: 1e18 fixed point, shown as a number.
    RATIO = "ratio"
    #: 1e10 fixed point, shown as "10x".
    MULTIPLIER = "multiplier"
    #: 1e18 fixed point again, but shown to `PRECISE_PLACES` rather than
    #: to six significant digits: a number that sits near 1.0 and whose
    #: whole interest is how far it has crept away from it.
    PRECISE = "precise"


@dataclass(frozen=True)
class Parameter:
    """One number, and what to call it."""

    key: str
    label: str
    kind: Kind
    note: str = ""


#: In the order they are worth reading: the shape of the curve first, then
#: what it charges, then where it thinks the price is, and last what all of
#: that has added up to.
PARAMETERS: tuple[Parameter, ...] = (
    Parameter("A", "A", Kind.INTEGER, "Amplification: how flat the curve is near balance"),
    Parameter("gamma", "gamma", Kind.RATIO, "How quickly the curve leaves the peg"),
    Parameter("fee", "Fee", Kind.PERCENT, "What a swap pays right now"),
    Parameter("mid_fee", "Mid fee", Kind.PERCENT, "The fee when the pool is balanced"),
    Parameter("out_fee", "Out fee", Kind.PERCENT, "The fee when it is far from balance"),
    Parameter("fee_gamma", "Fee gamma", Kind.RATIO, "How fast the fee moves between the two"),
    Parameter(
        "offpeg_fee_multiplier",
        "Fee multiplier",
        Kind.MULTIPLIER,
        "How much the fee rises off peg",
    ),
    Parameter("price_oracle", "Price oracle", Kind.RATIO, "The pool's own moving-average price"),
    Parameter("price_scale", "Price scale", Kind.RATIO, "The price the curve is currently pegged to"),
    Parameter(
        "get_virtual_price",
        "Virtual price",
        Kind.PRECISE,
        "What one LP token is worth, from 1.0 at launch",
    ),
)

#: Keyed, for the reader.
BY_KEY = {parameter.key: parameter for parameter in PARAMETERS}


@dataclass(frozen=True)
class Readings:
    """One batch of reads, in the two shapes that come back."""

    values: dict[str, int] = field(default_factory=dict)
    rates: tuple[int, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.values or self.rates)


def format_value(kind: Kind, raw: int) -> str:
    """A raw contract integer as something to put in a row."""
    if kind is Kind.INTEGER:
        return f"{raw:,}"
    if kind is Kind.PERCENT:
        return percent(raw / FEE_DENOMINATOR * 100, places=4)
    if kind is Kind.MULTIPLIER:
        return f"{raw / FEE_DENOMINATOR:,.4g}x"
    if kind is Kind.PRECISE:
        return f"{Decimal(raw) / PRECISION:,.{PRECISE_PLACES}f}"
    return f"{raw / PRECISION:,.6g}"


def rows(values: dict[str, int]) -> list[tuple[Parameter, str]]:
    """The parameters this pool answered, formatted, in table order."""
    return [
        (parameter, format_value(parameter.kind, values[parameter.key]))
        for parameter in PARAMETERS
        if parameter.key in values
    ]


def rate_rows(
    rates: Sequence[int], coins: Sequence[tuple[str, int]]
) -> list[tuple[Parameter, str]]:
    """`stored_rates()` as a price per coin, against the first one."""
    if not rates or len(rates) != len(coins) or not rates[0]:
        return []
    base, (base_symbol, base_decimals) = rates[0], coins[0]
    shown: list[tuple[Parameter, str]] = []
    for index in range(1, len(rates)):
        symbol, decimals = coins[index]
        scaled = (
            PRECISION * rates[index] * 10 ** (RATE_DECIMALS - base_decimals)
        ) // (base * 10 ** (RATE_DECIMALS - decimals))
        shown.append(
            (
                Parameter(
                    f"stored_rates[{index}]",
                    f"{RATE_LABEL} {symbol}/{base_symbol}",
                    Kind.PRECISE,
                    "stored_rates(): the outside price this pool has cached",
                ),
                format_value(Kind.PRECISE, scaled),
            )
        )
    flat = format_value(Kind.PRECISE, PRECISION)
    return [] if all(value == flat for _parameter, value in shown) else shown
