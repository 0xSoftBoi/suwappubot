"""Property-based tests for the PURE parts of bot.services.fee_service.FeeService.

Scope note: FeeService.get_fee_decimal / get_fee_bps / calculate_fee take an
optional ``user_id``. When ``user_id`` is given, they hit the DB (points
discount, position-card cache, referee-rebate lookup via
``_active_referee_rebate_applies`` -> ``get_session()``) -- that path is I/O,
not math, and is intentionally OUT of scope here per Phase 2 ("if the fee
math is inseparable from I/O, skip rather than mocking heavily"). With
``user_id=None`` (and ``referrer_id=None`` for the referral-reward branch),
every one of those lookups short-circuits to 0.0/False before touching the
DB (see the ``if user_id is None: return 0.0`` guards in
bot/services/fee_service.py), leaving pure arithmetic over TIER_FEE_RATES.
That pure surface is what these properties fuzz.

Covers:
  - fee never exceeds notional (fee_amount_usd <= swap_amount_usd)
  - zero-fee identity (swap_amount_usd == 0 => fee_amount_usd == 0, and every
    downstream split is 0 too)
  - monotonicity (fee_amount_usd is non-decreasing in swap_amount_usd, for a
    fixed tier)
  - tier ordering is preserved in the resulting bps/decimal rate (FREE > PRO
    > PREMIUM > ENTERPRISE), and get_fee_bps/get_fee_decimal agree with each
    other (bps == round(decimal * 10_000))

A registered Hypothesis profile bounds max_examples=200 for the CI lane; see
.github/workflows/test.yml.
"""

from decimal import Decimal

from hypothesis import HealthCheck, given, settings, strategies as st

from bot.models.subscription import SubscriptionTier
from bot.services.fee_service import FeeService, TIER_FEE_RATES

fee_service = FeeService()

all_tiers = st.sampled_from(list(SubscriptionTier))

# Realistic finite, non-negative swap notionals. NaN/inf are out of scope:
# Decimal(str(swap_amount_usd)) raises decimal.InvalidOperation on NaN/inf
# before any fee math runs, so those inputs fail at the I/O boundary
# (converting an untrusted float to Decimal), not in the arithmetic this
# file is fuzzing.
swap_amounts = st.floats(min_value=0, max_value=1e12, allow_nan=False, allow_infinity=False)


@given(tier=all_tiers, swap_amount_usd=swap_amounts)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_fee_never_exceeds_notional(tier, swap_amount_usd):
    calc = fee_service.calculate_fee(swap_amount_usd, referrer_id=None, tier=tier, user_id=None)
    assert calc.fee_amount_usd <= calc.swap_amount_usd


@given(tier=all_tiers)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_zero_amount_is_zero_fee_identity(tier):
    calc = fee_service.calculate_fee(0.0, referrer_id=None, tier=tier, user_id=None)
    assert calc.fee_amount_usd == Decimal("0.00")
    assert calc.net_fee_usd == Decimal("0.00")
    assert calc.referral_reward_usd == Decimal("0.00")
    assert calc.staking_allocation_usd == 0.0
    assert calc.protocol_allocation_usd == 0.0


@given(tier=all_tiers, referrer_id=st.none() | st.integers(min_value=1, max_value=10_000_000))
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_zero_amount_is_zero_fee_identity_with_referrer(tier, referrer_id):
    """The identity holds whether or not a referrer is attached -- 30% of
    zero is still zero."""
    calc = fee_service.calculate_fee(0.0, referrer_id=referrer_id, tier=tier, user_id=None)
    assert calc.fee_amount_usd == Decimal("0.00")
    assert calc.net_fee_usd == Decimal("0.00")
    assert calc.referral_reward_usd == Decimal("0.00")


@given(
    tier=all_tiers,
    low=swap_amounts,
    delta=st.floats(min_value=0, max_value=1e12, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_fee_amount_is_monotonic_in_swap_amount(tier, low, delta):
    """A larger (or equal) notional must never produce a smaller fee, for a
    fixed tier -- the ROUND_DOWN-to-cent quantization is a floor, and floor
    is monotonic non-decreasing."""
    high = low + delta
    fee_low = fee_service.calculate_fee(
        low, referrer_id=None, tier=tier, user_id=None
    ).fee_amount_usd
    fee_high = fee_service.calculate_fee(
        high, referrer_id=None, tier=tier, user_id=None
    ).fee_amount_usd
    assert fee_low <= fee_high


@given(swap_amount_usd=swap_amounts)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_tier_ordering_is_preserved_in_effective_rate(swap_amount_usd):
    """FREE pays the most, ENTERPRISE the least -- the tier ladder must never
    invert, independent of the notional (user_id=None so no points/position
    discount can perturb the ladder)."""
    rates = {tier: fee_service.get_fee_decimal(tier, user_id=None) for tier in SubscriptionTier}
    assert (
        rates[SubscriptionTier.FREE]
        >= rates[SubscriptionTier.PRO]
        >= rates[SubscriptionTier.PREMIUM]
        >= rates[SubscriptionTier.ENTERPRISE]
    )


@given(tier=all_tiers)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_get_fee_bps_agrees_with_get_fee_decimal(tier):
    """The on-chain bps figure and the display decimal must be the exact same
    rate (bps == round(decimal * 10_000)) -- this is the invariant the
    module docstring calls out explicitly: the collected fee can never
    diverge from the recorded/displayed one."""
    decimal_rate = fee_service.get_fee_decimal(tier, user_id=None)
    bps = fee_service.get_fee_bps(tier, user_id=None)
    assert bps == round(decimal_rate * 10_000)


@given(tier=all_tiers)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_get_fee_bps_matches_static_tier_table_when_no_discounts_apply(tier):
    """With user_id=None, no points/position discount or referee rebate can
    apply, so the effective rate must exactly equal the static
    TIER_FEE_RATES entry for that tier -- no floor or multiplier should ever
    fire when there is nothing to floor or multiply."""
    expected_bps = round(TIER_FEE_RATES[tier] * 10_000)
    assert fee_service.get_fee_bps(tier, user_id=None) == expected_bps
