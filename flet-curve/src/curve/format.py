"""Turning numbers into the strings a dense table can show."""

from __future__ import annotations

import math
from datetime import datetime
from decimal import Decimal


def compact_usd(value: float, *, sign: str = "$") -> str:
    """`$159.98m`, `$206.90k`, `$47.49` -- two decimals, lowercase suffix."""
    if value is None:
        return "-"
    magnitude = abs(value)
    if magnitude >= 1e12:
        return f"{sign}{value / 1e12:.2f}t"
    if magnitude >= 1e9:
        return f"{sign}{value / 1e9:.2f}b"
    if magnitude >= 1e6:
        return f"{sign}{value / 1e6:.2f}m"
    if magnitude >= 1e3:
        return f"{sign}{value / 1e3:.2f}k"
    if magnitude == 0:
        return f"{sign}0"
    return f"{sign}{value:.2f}"


def percent(value: float, *, places: int = 2) -> str:
    """`1.27%`, and `< 0.01%` for anything that would round to zero."""
    if value is None:
        return "-"
    if value == 0:
        return "0%"
    smallest = 10.0**-places
    if 0 < abs(value) < smallest:
        return f"< {smallest:.{places}f}%" if value > 0 else f"> -{smallest:.{places}f}%"
    return f"{value:.{places}f}%"


def apr_range(low: float, high: float) -> str:
    """`2.93% to 7.32%` for a boost range, collapsing when the ends match."""
    if not low and not high:
        return "-"
    if abs(high - low) < 1e-9:
        return percent(high)
    return f"{percent(low)} to {percent(high)}"


#: How many significant figures a quantity too small for `places` gets shown
#: to.  Enough to tell one small holding from another, and to tell either from
#: nothing at all.
FIGURES = 3


def token_amount(value: float, *, places: int = 4, figures: int = FIGURES) -> str:
    """A human token quantity: grouped, trailing zeros trimmed.

    `places` decimals, or as many as it takes to show `figures` significant
    ones -- whichever is more.  Eight-decimal coins make the second case
    ordinary: a few dollars of tBTC is 0.0000342 of one, which at four places
    is "0", and a zero says the wallet holds nothing rather than a little.
    Trailing zeros still go, so a quantity that *is* exactly 0.0001 is not
    padded out to pretend at a precision it does not have.
    """
    if value is None:
        return "-"
    if value == 0:
        return "0"
    if abs(value) >= 1000:
        return f"{value:,.2f}"
    # Plain decimals rather than an exponent: these are quantities someone
    # reads and may retype, and "3.42e-05" is not something to paste into an
    # amount box.
    exponent = math.floor(math.log10(abs(value)))
    decimals = max(places, figures - 1 - exponent)
    return f"{value:,.{decimals}f}".rstrip("0").rstrip(".") or "0"


#: Where a quantity stops being worth a line, a tab or a transaction.  Four
#: decimal places, which is where that line has always been -- it used to be
#: *implied* by asking whether `token_amount` printed "0", and stopped being a
#: question about size the moment small holdings started showing their
#: significant figures instead.
DUST_PLACES = 4


def is_dust(value: float | None) -> bool:
    """Too small to be worth acting on.

    A gauge accrues CRV every block, so an account that claimed a minute ago
    is owed a few wei of it -- and offering a transaction that costs more than
    it collects is worse than saying nothing.
    """
    return round(value or 0.0, DUST_PLACES) <= 0


def units_to_float(value: int, decimals: int) -> float:
    """Smallest units -> float, for display only."""
    if decimals <= 0:
        return float(value)
    return float(Decimal(value) / (Decimal(10) ** decimals))


def date_time(stamp: int) -> str:
    """A Unix second, in the reader's own time zone: "20 Aug 11:36"."""
    if not stamp:
        return ""
    return datetime.fromtimestamp(stamp).strftime("%d %b %H:%M")


def short_address(address: str) -> str:
    return f"{address[:6]}…{address[-4:]}" if len(address) > 12 else address


def price(value: float) -> str:
    """A coin's USD price, with enough precision to be useful."""
    if not value:
        return "-"
    if abs(value) >= 1000:
        return f"${value:,.2f}"
    text = f"{value:,.5f}".rstrip("0").rstrip(".")
    return f"${text}"
