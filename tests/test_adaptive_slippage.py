"""Tests for bot.utils.adaptive_slippage.compute_adaptive_slippage_bps.

Covers the unit-contract fix from the money-path review: Jupiter's
priceImpactPct is already a FRACTION of 1, OKX's priceImpactPercentage is a
PERCENT and conventionally negative — both must be normalized to "fraction
of 1" by the caller before this function is invoked. Also covers the
never-widen invariant and defensive handling of unavailable data.
"""

from bot.utils.adaptive_slippage import compute_adaptive_slippage_bps


def test_jupiter_fraction_case():
    """0.0078936 (Jupiter's real unit: a fraction of 1, == 0.789%) should
    become ~79 bps of price impact, then get the buffer added on top."""
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=200,
        price_impact_fraction=0.0078936,
        buffer_bps=20,
        floor_bps=10,
    )
    # round(0.0078936 * 10_000) == 79
    assert result == 79 + 20
    assert result < 200  # tightened relative to the flat request


def test_okx_negative_percent_case():
    """OKX reports priceImpactPercentage as a PERCENT, often negative for
    adverse impact (e.g. -0.42 == 0.42%). Caller must convert via
    abs(x) / 100 before calling in -- this test exercises that exact
    conversion, mirroring the swap_engine._get_okx_dex_quote call site."""
    okx_price_impact_percentage = -0.42
    price_impact_fraction = abs(okx_price_impact_percentage) / 100

    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=100,
        price_impact_fraction=price_impact_fraction,
        buffer_bps=20,
        floor_bps=10,
    )
    # -0.42% -> 0.0042 fraction -> 42 bps + 20 buffer = 62
    assert result == 62
    assert result < 100


def test_okx_raw_negative_fraction_is_untrustworthy():
    """If a caller forgets to abs() the OKX value and passes the raw negative
    percent straight through (a bug), the function must treat it as
    untrustworthy and fall back to the requested tolerance rather than
    guessing -- never silently produce a nonsensical (negative-impact-based)
    cap."""
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=100,
        price_impact_fraction=-0.42,
        buffer_bps=20,
        floor_bps=10,
    )
    assert result == 100


def test_zero_price_impact_uses_floor_plus_buffer():
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=100,
        price_impact_fraction=0.0,
        buffer_bps=20,
        floor_bps=10,
    )
    # 0 bps impact + 20 buffer = 20, which is already >= floor (10)
    assert result == 20


def test_none_price_impact_falls_back_to_requested():
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=75,
        price_impact_fraction=None,
        buffer_bps=20,
        floor_bps=10,
    )
    assert result == 75


def test_nan_price_impact_falls_back_to_requested():
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=75,
        price_impact_fraction=float("nan"),
        buffer_bps=20,
        floor_bps=10,
    )
    assert result == 75


def test_never_widens_beyond_requested():
    """A large price impact must never produce a cap ABOVE what the caller
    requested -- the function only ever tightens."""
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=50,
        price_impact_fraction=0.05,  # 5% impact -> 500 bps, way above 50
        buffer_bps=20,
        floor_bps=10,
    )
    assert result == 50


def test_floor_applies_when_impact_and_buffer_are_tiny():
    result = compute_adaptive_slippage_bps(
        requested_slippage_bps=100,
        price_impact_fraction=0.0001,  # 1 bps
        buffer_bps=0,
        floor_bps=10,
    )
    assert result == 10
