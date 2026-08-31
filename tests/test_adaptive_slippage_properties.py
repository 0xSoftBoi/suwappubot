"""Property-based tests for bot.utils.adaptive_slippage.compute_adaptive_slippage_bps.

Complements tests/test_adaptive_slippage.py's example-based tests with
Hypothesis fuzzing over the FULL float domain (NaN, +/-inf, negatives, huge
finite values, non-numeric types) to pin down the invariants the module's own
docstring promises:

  1. The result is always an int.
  2. The result never widens the tolerance: result <= requested_slippage_bps,
     for ANY input (valid or garbage).
  3. For a trustworthy input (finite, non-negative price_impact_fraction),
     the result is never tightened below min(requested_slippage_bps, floor_bps)
     -- the floor is a floor.
  4. For untrustworthy input (NaN, +/-inf, negative finite, None, or a
     non-numeric value), the function returns requested_slippage_bps
     UNCHANGED.

A registered "ci" Hypothesis profile bounds max_examples=200 so the new
property-tests CI lane stays fast; see .github/workflows/test.yml.

BUG FOUND AND FIXED BY THESE TESTS: +inf originally slipped through the
guard (``... != ... or ... < 0`` caught NaN and -inf but not +inf) and
crashed ``round(+inf * 10_000)`` with OverflowError. The guard now uses
``math.isfinite``, which rejects +inf too; ``test_positive_infinity_falls_back_to_requested``
below is the regression guard against reintroducing the crash.
"""

import math

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

from bot.utils.adaptive_slippage import compute_adaptive_slippage_bps

# Keep bps knobs in a realistic-but-generous integer range. Arbitrary-precision
# Python ints mean there's no overflow risk even at the bounds; the range is
# chosen to stay meaningful (bps units), not to dodge overflow.
bps_ints = st.integers(min_value=-1_000_000, max_value=1_000_000)

# Any float in the FULL IEEE-754 domain the module claims to handle: NaN,
# +/-inf, subnormals, negatives, and enormous finite values.
any_float = st.floats(allow_nan=True, allow_infinity=True)

# The "trustworthy" subdomain per the module's own contract: finite and >= 0.
trustworthy_price_impact = st.floats(
    min_value=0, allow_nan=False, allow_infinity=False, max_value=1e15
)

# The "untrustworthy" subdomain: NaN, +/-inf, or any negative float — exactly
# what the ``not math.isfinite(x) or x < 0`` guard catches. All must fall back
# to requested_slippage_bps without crashing (+inf included, post-fix).
untrustworthy_price_impact = any_float.filter(lambda x: (not math.isfinite(x)) or (x < 0))

non_numeric_values = st.one_of(
    st.none(),
    st.text(),
    st.lists(st.integers()),
    st.dictionaries(st.text(), st.integers()),
)


@given(
    requested_slippage_bps=bps_ints,
    price_impact_fraction=trustworthy_price_impact,
    buffer_bps=bps_ints,
    floor_bps=bps_ints,
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_result_is_always_int(requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps):
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
    )
    assert isinstance(result, int)


@given(
    requested_slippage_bps=bps_ints,
    price_impact_fraction=trustworthy_price_impact,
    buffer_bps=bps_ints,
    floor_bps=bps_ints,
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_never_widens_for_trustworthy_input(
    requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
):
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
    )
    assert result <= requested_slippage_bps


@given(
    requested_slippage_bps=bps_ints,
    price_impact_fraction=untrustworthy_price_impact,
    buffer_bps=bps_ints,
    floor_bps=bps_ints,
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_never_widens_for_untrustworthy_input(
    requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
):
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
    )
    assert result <= requested_slippage_bps


@given(
    requested_slippage_bps=bps_ints,
    price_impact_fraction=trustworthy_price_impact,
    buffer_bps=bps_ints,
    floor_bps=bps_ints,
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_never_tightened_below_requested_and_floor_for_trustworthy_input(
    requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
):
    """result >= min(requested_slippage_bps, floor_bps) whenever the caller's
    price_impact_fraction is itself trustworthy (finite, non-negative) --
    i.e. the floor genuinely floors the result, it doesn't get bypassed by a
    small requested tolerance interacting badly with the floor."""
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
    )
    assert result >= min(requested_slippage_bps, floor_bps)


@given(
    requested_slippage_bps=bps_ints,
    price_impact_fraction=untrustworthy_price_impact,
    buffer_bps=bps_ints,
    floor_bps=bps_ints,
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_untrustworthy_numeric_input_returns_requested_exactly(
    requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
):
    """NaN, +/-inf, and negative finite must all fall back to the requested
    tolerance UNCHANGED -- not clamped, not floored, not adjusted at all."""
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
    )
    assert result == requested_slippage_bps


@given(
    requested_slippage_bps=bps_ints,
    price_impact_fraction=non_numeric_values,
    buffer_bps=bps_ints,
    floor_bps=bps_ints,
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_non_numeric_input_returns_requested_exactly(
    requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
):
    """None, strings, lists, dicts -- anything float() can't coerce -- must
    fall back to the requested tolerance unchanged rather than raising."""
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps, price_impact_fraction, buffer_bps, floor_bps
    )
    assert result == requested_slippage_bps


def test_positive_infinity_falls_back_to_requested():
    """Regression: +inf is untrustworthy input and must fall back to
    requested_slippage_bps, not crash.

    This property test originally surfaced a bug — the guard checked only
    NaN and negativity, so +inf slipped through to
    ``round(price_impact_fraction * 10_000)`` and raised OverflowError. The
    guard now uses ``math.isfinite``, which rejects +inf too. This test
    asserts the documented contract (fall back), guarding against a
    regression to the crashing behavior.
    """
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=50,
        price_impact_fraction=float("inf"),
        buffer_bps=10,
        floor_bps=5,
    )
    assert result == 50


def test_negative_infinity_falls_back_to_requested():
    """Sanity check that -inf (unlike +inf) IS caught by the existing
    ``price_impact_fraction < 0`` guard, matching the general untrustworthy
    property above with a concrete example."""
    assert math.isinf(float("-inf"))
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=75,
        price_impact_fraction=float("-inf"),
        buffer_bps=10,
        floor_bps=5,
    )
    assert result == 75
