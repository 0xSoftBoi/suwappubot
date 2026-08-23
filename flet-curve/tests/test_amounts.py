"""What a typed amount turns into, and the three ways it used to lie."""

from __future__ import annotations

import pytest

from wallet.erc20 import format_units, parse_units


def test_a_plain_amount_scales() -> None:
    assert parse_units("1.5", 18) == 1_500_000_000_000_000_000
    assert parse_units("  2  ", 6) == 2_000_000
    assert parse_units("0.000001", 6) == 1


def test_thousands_separators_are_still_read() -> None:
    assert parse_units("1,000.5", 18) == 1_000_500_000_000_000_000_000
    assert parse_units("1,234,567.89", 6) == 1_234_567_890_000


@pytest.mark.parametrize("typed", ["1,5", "12,34", "0,5", "1.5,5", "1,23"])
def test_a_decimal_comma_is_refused_rather_than_reinterpreted(typed: str) -> None:
    """Every comma used to be stripped, so `1,5` -- which is how most of
    Europe writes 1.5 -- became **fifteen** tokens, silently, on the way to
    a signature. Guessing which was meant is not this function's business;
    saying so is."""
    with pytest.raises(ValueError, match="dot"):
        parse_units(typed, 18)


def test_the_whole_balance_survives_the_round_trip() -> None:
    """What MAX does. `_max_for` fills the field with the balance at full
    precision, so a balance of 100 billion tokens is 29 significant digits
    -- one more than `Decimal`'s default context keeps. It rounded *up*,
    which asks for one unit more than the wallet holds, and the transaction
    reverts."""
    balance = 99_999_999_999_999_999_999_999_999_999  # ~1e11 tokens at 1e18

    typed = format_units(balance, 18, precision=18)

    assert typed == "99999999999.999999999999999999"
    assert parse_units(typed, 18) == balance


@pytest.mark.parametrize("typed", ["nan", "inf", "-inf", "Infinity", "NaN"])
def test_the_not_numbers_raise_the_error_callers_catch(typed: str) -> None:
    """`Decimal("nan") < 0` raises `InvalidOperation` and `int(Decimal("inf"))`
    raises `OverflowError` -- neither is a `ValueError`, and every caller
    catches only that. So they went straight past the guard and killed the
    task that was holding the panel."""
    with pytest.raises(ValueError):
        parse_units(typed, 18)


def test_more_than_a_uint256_could_hold_is_refused() -> None:
    """And refused before anything tries to make an integer out of it: a
    Decimal exponent is cheap to write and expensive to expand."""
    with pytest.raises(ValueError, match="too large"):
        parse_units("1e400", 18)


def test_the_ordinary_refusals_still_read_as_they_did() -> None:
    with pytest.raises(ValueError, match="Enter an amount"):
        parse_units("", 18)
    with pytest.raises(ValueError, match="negative"):
        parse_units("-1", 18)
    with pytest.raises(ValueError, match="decimal places"):
        parse_units("1.1234567", 6)
    with pytest.raises(ValueError, match="not a number"):
        parse_units("half of it", 18)
