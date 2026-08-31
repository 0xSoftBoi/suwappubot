"""Per-trade computed slippage bound (Heimbach & Wattenhofer, ASIA CCS 2022).

Static/flat slippage tolerances leave a "free" extraction window for sandwich
attackers equal to (tolerance - actual price impact). This module implements
their closed-form idea in miniature: instead of always applying the user's
flat slippage tolerance, tighten it down to just above the trade's own
*expected* price impact (as reported by the aggregator's own quote) whenever
that's smaller than what the user asked for.

Feature-flagged via ``settings.adaptive_slippage_enabled`` — OFF by default.
When OFF, callers must not invoke this and behavior is unchanged.

Only wire this in for providers whose quote objects return a REAL,
API-computed price-impact figure (e.g. Jupiter's ``priceImpactPct``, OKX
DEX's ``priceImpactPercentage``). Several providers in this codebase
hardcode ``price_impact=0.0`` because their client doesn't compute/parse it
(sunswap, 1inch fallback, li.fi, kyberswap, 0x as of this writing) — feeding
that 0.0 into this helper would silently clamp slippage to the floor on a
trade whose real impact is unknown, which is worse than doing nothing. Do
NOT wire those providers in until they return a genuine figure.

UNIT CONTRACT (verified live against both aggregators — this is the part
that is easy to get wrong and dangerous to get wrong on a money path):

- Jupiter's ``priceImpactPct`` field is already a FRACTION of 1, despite the
  "Pct" in its name (e.g. ``0.0078936`` means 0.789% impact, NOT 0.79 = 79%).
  Callers pass ``float(quote.price_impact_pct)`` straight through.
- OKX DEX's ``priceImpactPercentage`` is a PERCENT (not a fraction of 1) and
  is conventionally reported as a NEGATIVE number for adverse impact (e.g.
  ``-0.42`` means 0.42% impact). Callers must pass
  ``abs(price_impact) / 100`` to convert it to the same fraction-of-1 unit.

This function's sole input unit is therefore "fraction of 1" — callers are
responsible for converting their provider's native unit to that before
calling in.
"""

from __future__ import annotations

import math


def compute_adaptive_slippage_bps(
    requested_slippage_bps: int,
    price_impact_fraction: float,
    buffer_bps: int,
    floor_bps: int,
) -> int:
    """Compute a tightened slippage bound from the quote's own price impact.

    cap_bps = max(price_impact_bps + buffer_bps, floor_bps)
    result  = min(requested_slippage_bps, cap_bps)

    This can only ever tighten (reduce) the tolerance relative to what the
    caller requested — it never widens it. If ``price_impact_fraction`` looks
    unavailable/untrustworthy (negative, or not a finite number), the
    requested tolerance is returned unchanged.

    Args:
        requested_slippage_bps: The user's/default slippage tolerance, in bps.
        price_impact_fraction: The aggregator-reported expected price impact
            for this specific trade, expressed as a FRACTION OF 1 (e.g. 0.0042
            == 0.42% impact) — NOT a percent and NOT already in bps. See the
            module docstring's "UNIT CONTRACT" for how to convert each
            provider's native field into this unit before calling in. Must
            already be non-negative (e.g. OKX's negative-percent convention
            must be ``abs()``-ed by the caller); a negative value here is
            treated as "untrustworthy" and the requested tolerance is
            returned unchanged rather than guessed at.
        buffer_bps: Extra headroom added on top of the expected impact so
            ordinary quote-to-execution price drift doesn't cause reverts.
        floor_bps: Minimum tolerance regardless of how small the reported
            price impact is (protects against 0-bps quotes on illiquid
            pairs whose impact estimate is itself noisy).

    Returns:
        The (possibly tightened) slippage tolerance in bps, always
        ``<= requested_slippage_bps``.
    """
    try:
        price_impact_fraction = float(price_impact_fraction)
    except (TypeError, ValueError):
        return requested_slippage_bps

    if not math.isfinite(price_impact_fraction) or price_impact_fraction < 0:
        # NaN, ±inf, or negative — untrustworthy input, don't guess. (isfinite
        # rejects +inf too, which would otherwise crash round() with an
        # OverflowError below.) Callers must normalize sign conventions
        # (e.g. OKX) before calling in.
        return requested_slippage_bps

    price_impact_bps = round(price_impact_fraction * 10_000)
    cap_bps = max(price_impact_bps + buffer_bps, floor_bps)

    return min(requested_slippage_bps, cap_bps)
