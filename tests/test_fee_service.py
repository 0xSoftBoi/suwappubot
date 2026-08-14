"""Tests for bot/services/fee_service.py — tier rates + fee-allocation reconciliation.

Locks in the fix for the gross-vs-net allocation bug: a referred swap must never
"allocate" more than 100% of the fee (referral + staking + protocol == fee_amount).
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.services.fee_service import (
    FeeService,
    TIER_FEE_RATES,
    DEFAULT_FEE_RATE,
    MAX_POINTS_DISCOUNT_FRACTION,
    MIN_EFFECTIVE_FEE_RATE,
    ABSOLUTE_FLOOR,
)
from bot.models.subscription import SubscriptionTier


@pytest.fixture()
def svc():
    return FeeService()


# Ladder in ranked order (highest fee to lowest) — used by the stacking tests below.
_TIER_LADDER = [
    SubscriptionTier.FREE,
    SubscriptionTier.PRO,
    SubscriptionTier.PREMIUM,
    SubscriptionTier.ENTERPRISE,
]


# ---------------------------------------------------------------------------
# Tier-based fee rates
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "tier,expected_pct",
    [
        (SubscriptionTier.FREE, 1.0),
        (SubscriptionTier.PRO, 0.5),
        (SubscriptionTier.PREMIUM, 0.3),
        (SubscriptionTier.ENTERPRISE, 0.1),
    ],
)
def test_tier_fee_rates(svc, tier, expected_pct):
    calc = svc.calculate_fee(1000.0, tier=tier)
    assert float(calc.fee_percentage) == pytest.approx(expected_pct)
    # fee_amount = swap * rate
    assert float(calc.fee_amount_usd) == pytest.approx(1000.0 * expected_pct / 100, abs=0.01)


def test_none_tier_falls_back_to_default(svc):
    calc = svc.calculate_fee(1000.0, tier=None)
    assert float(calc.fee_percentage) == pytest.approx(DEFAULT_FEE_RATE * 100)  # 1.0%


# ---------------------------------------------------------------------------
# Allocation reconciliation — the regression lock for the 130% bug
# ---------------------------------------------------------------------------


def _assert_reconciles(calc):
    """referral + staking + protocol must equal the gross fee (within rounding)."""
    total = (
        float(calc.referral_reward_usd) + calc.staking_allocation_usd + calc.protocol_allocation_usd
    )
    assert total == pytest.approx(float(calc.fee_amount_usd), abs=0.01)


def test_allocation_reconciles_without_referrer(svc):
    calc = svc.calculate_fee(1000.0, tier=SubscriptionTier.FREE)
    assert calc.has_referrer is False
    assert float(calc.referral_reward_usd) == 0.0
    # no referrer → net == gross → 40/60 of the full fee
    assert float(calc.net_fee_usd) == pytest.approx(float(calc.fee_amount_usd))
    assert calc.staking_allocation_usd == pytest.approx(float(calc.fee_amount_usd) * 0.40, abs=0.01)
    assert calc.protocol_allocation_usd == pytest.approx(
        float(calc.fee_amount_usd) * 0.60, abs=0.01
    )
    _assert_reconciles(calc)


def test_allocation_reconciles_with_referrer(svc):
    # $1000 swap, free tier → $10 fee; referrer present → $3 referral, $7 net.
    calc = svc.calculate_fee(1000.0, referrer_id=42, tier=SubscriptionTier.FREE)
    assert calc.has_referrer is True
    assert float(calc.fee_amount_usd) == pytest.approx(10.0, abs=0.01)
    assert float(calc.referral_reward_usd) == pytest.approx(3.0, abs=0.01)  # 30% of gross
    assert float(calc.net_fee_usd) == pytest.approx(7.0, abs=0.01)
    assert calc.staking_allocation_usd == pytest.approx(2.8, abs=0.01)  # 40% of net
    assert calc.protocol_allocation_usd == pytest.approx(4.2, abs=0.01)  # 60% of net
    # the whole point: 3 + 2.8 + 4.2 == 10, NOT 13 (the old 130% bug)
    _assert_reconciles(calc)


@pytest.mark.parametrize("tier", list(TIER_FEE_RATES.keys()) + [None])
def test_allocation_reconciles_across_tiers_with_referrer(svc, tier):
    calc = svc.calculate_fee(2500.0, referrer_id=7, tier=tier)
    _assert_reconciles(calc)


# ---------------------------------------------------------------------------
# Position-card discount is PROPORTIONAL (fraction of the post-points rate),
# not a flat bps subtraction. Regression lock for the bug where a flat 40bps
# subtraction, floored at the ENTERPRISE rate, made PRO ($9.99/mo) and PREMIUM
# ($29.99/mo) card holders both pay 10bps — identical to ENTERPRISE ($99.99/mo),
# because PRO and PREMIUM are only 20bps apart.
# ---------------------------------------------------------------------------


def _patch_discounts(monkeypatch, svc, *, points=0.0, card=0.0, referee=False):
    """``points`` and ``card`` are both FRACTIONS of the tier rate now
    (0.50 == 50% off), not percentage points subtracted from it."""
    monkeypatch.setattr(svc, "_active_fee_discount_fraction", lambda uid: points)
    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: card)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: referee)


@pytest.mark.parametrize(
    "tier,no_card_bps,with_card_bps",
    [
        (SubscriptionTier.FREE, 100, 60),
        (SubscriptionTier.PRO, 50, 30),
        (SubscriptionTier.PREMIUM, 30, 18),
        # ENTERPRISE is unchanged BY DESIGN — the card perk is not offered on
        # contracted pricing. See get_fee_decimal.
        (SubscriptionTier.ENTERPRISE, 10, 10),
    ],
)
def test_exact_fee_bps_table_card_vs_no_card(svc, monkeypatch, tier, no_card_bps, with_card_bps):
    """Pinned table: a 40% proportional card discount off each tier's own rate,
    not a flat 40bps subtraction off all of them — and not offered at all on
    ENTERPRISE."""
    _patch_discounts(monkeypatch, svc, card=0.0)
    assert svc.get_fee_bps(tier, user_id=1) == no_card_bps

    _patch_discounts(monkeypatch, svc, card=0.40)
    assert svc.get_fee_bps(tier, user_id=1) == with_card_bps


@pytest.mark.parametrize("card_fraction", [0.0, 0.40])
@pytest.mark.parametrize("points_discount", [0.0, 0.50])
@pytest.mark.parametrize("referee_rebate", [False, True])
def test_ladder_is_never_inverted_across_every_stacking_combination(
    svc, monkeypatch, card_fraction, points_discount, referee_rebate
):
    """No stack of consumer perks may reorder the tiers or undercut contracted
    pricing.

    Non-strict at the bottom on purpose. The card is not offered on ENTERPRISE
    (contracted pricing), so a PREMIUM holder stacking points + card is floored
    at the ENTERPRISE base rather than allowed to dive under it — that floor
    produces a legitimate TIE, not a collapse. What must never happen is an
    INVERSION: a cheaper subscription charging less than a dearer one.
    points_discount=0.0015 is chosen because it binds that floor (ENTERPRISE's
    base rate IS the floor), which is exactly where inversion would appear.

    Strict separation of the self-serve tiers is asserted by the test below,
    which is the real regression lock for the flat-40bps bug.
    """
    _patch_discounts(
        monkeypatch, svc, points=points_discount, card=card_fraction, referee=referee_rebate
    )

    bps = [svc.get_fee_bps(tier, user_id=1) for tier in _TIER_LADDER]
    ctx = (
        f"FREE={bps[0]} PRO={bps[1]} PREMIUM={bps[2]} ENTERPRISE={bps[3]} "
        f"(card={card_fraction}, points={points_discount}, referee_rebate={referee_rebate})"
    )
    assert bps[0] >= bps[1] >= bps[2] >= bps[3], f"ladder inverted: {ctx}"
    # ...and nothing self-serve may end up under contracted pricing. The referee
    # rebate is the one thing that legitimately takes ENTERPRISE below its base,
    # and it applies to every tier equally, so compare against the same floor.
    floor_bps = round(MIN_EFFECTIVE_FEE_RATE * 10_000 * (0.90 if referee_rebate else 1.0))
    assert min(bps) >= floor_bps, f"a perk beat contracted pricing: {ctx}"


@pytest.mark.parametrize("referee_rebate", [False, True])
@pytest.mark.parametrize("points_fraction", [0.0, 0.50])
@pytest.mark.parametrize("card_fraction", [0.0, 0.40])
def test_perks_never_make_two_self_serve_tiers_cost_the_same(
    svc, monkeypatch, card_fraction, points_fraction, referee_rebate
):
    """THE regression lock. No stack of consumer perks may flatten FREE, PRO and
    PREMIUM into each other.

    Both perks used to be absolute subtractions off unevenly-spaced tiers, and
    both were sized against the FREE rate, so both collapsed the ladder on their
    own. The card took 40bps off tiers 20bps apart. The points reward was worse:
    the only one in the catalogue is 0.5pp == 50bps, larger than the whole PRO
    rate, so 500 points bought PRO, PREMIUM and ENTERPRISE the identical floored
    rate. Now both are proportional and both compose multiplicatively, so the
    self-serve tiers stay strictly ordered under every combination.

    ENTERPRISE is excluded from the comparison on purpose: it takes no perks, so
    a heavily-discounted PREMIUM legitimately TIES it at the contracted-pricing
    floor. That tie is asserted as a non-inversion by the test above.
    """
    _patch_discounts(
        monkeypatch, svc, points=points_fraction, card=card_fraction, referee=referee_rebate
    )
    free, pro, premium = (
        svc.get_fee_bps(t, user_id=1)
        for t in (SubscriptionTier.FREE, SubscriptionTier.PRO, SubscriptionTier.PREMIUM)
    )
    assert free > pro > premium, (
        f"perks collapsed the self-serve ladder: FREE={free} PRO={pro} PREMIUM={premium} "
        f"(card={card_fraction}, points={points_fraction}, referee_rebate={referee_rebate})"
    )


def test_points_reward_value_converts_to_a_fraction_of_the_free_rate(svc, monkeypatch):
    """The catalogue ships percentage POINTS ("0.5"); the fee path needs a
    fraction. Pin the conversion, and pin that it leaves a FREE user's charged
    rate bit-for-bit unchanged — that calibration is the whole reason 0.5pp maps
    to 50% and not to some rounder number.
    """
    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: 0.0)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: False)

    class _FakePoints:
        @staticmethod
        def get_active_fee_discount(_uid):
            return 0.5  # the ONLY fee_discount reward_value in DEFAULT_REWARDS

    import bot.services.points_service as ps

    monkeypatch.setattr(ps, "points_service", _FakePoints)
    assert svc._active_fee_discount_fraction(1) == pytest.approx(0.50)
    # 100bps -> 50bps: identical to the old absolute "subtract 0.5pp" on FREE.
    assert svc.get_fee_bps(SubscriptionTier.FREE, user_id=1) == 50
    # ...and the paid tiers now scale instead of all landing on the floor.
    assert svc.get_fee_bps(SubscriptionTier.PRO, user_id=1) == 25
    assert svc.get_fee_bps(SubscriptionTier.PREMIUM, user_id=1) == 15
    assert svc.get_fee_bps(SubscriptionTier.ENTERPRISE, user_id=1) == 10


def test_points_fraction_is_clamped(svc, monkeypatch):
    """A mis-seeded catalogue row (say 5pp, larger than the whole FREE rate)
    would otherwise produce a fraction above 1.0 and a negative fee."""

    class _AbsurdPoints:
        @staticmethod
        def get_active_fee_discount(_uid):
            return 5.0

    import bot.services.points_service as ps

    monkeypatch.setattr(ps, "points_service", _AbsurdPoints)
    assert svc._active_fee_discount_fraction(1) == MAX_POINTS_DISCOUNT_FRACTION


@pytest.mark.parametrize("tier", _TIER_LADDER)
@pytest.mark.parametrize("card_fraction", [0.0, 0.40])
@pytest.mark.parametrize("points_discount", [0.0, 0.50])
@pytest.mark.parametrize("referee_rebate", [False, True])
def test_effective_fee_never_reaches_zero_or_negative(
    svc, monkeypatch, tier, card_fraction, points_discount, referee_rebate
):
    """Across every combination, the effective rate/bps must stay strictly
    positive — a zero fee would also zero the referral fee-share and treasury
    split."""
    _patch_discounts(
        monkeypatch, svc, points=points_discount, card=card_fraction, referee=referee_rebate
    )

    rate = svc.get_fee_decimal(tier, user_id=1)
    assert rate > 0.0
    assert svc.get_fee_bps(tier, user_id=1) > 0


@pytest.mark.parametrize("tier", _TIER_LADDER)
def test_absurd_stacked_discounts_still_floor_above_zero(svc, monkeypatch, tier):
    """Pathological inputs (a bad points/card read) must still land at or above
    ABSOLUTE_FLOOR, never at or below zero."""
    _patch_discounts(monkeypatch, svc, points=99.0, card=0.99, referee=True)
    rate = svc.get_fee_decimal(tier, user_id=1)
    assert rate >= ABSOLUTE_FLOOR
    assert rate > 0.0


@pytest.mark.parametrize("tier", _TIER_LADDER)
@pytest.mark.parametrize("points_discount", [0.005, 0.01, 5.0])
def test_points_discount_alone_cannot_beat_enterprise_base_rate(
    svc, monkeypatch, tier, points_discount
):
    """MIN_EFFECTIVE_FEE_RATE floors the points step at the ENTERPRISE rate — a
    points redemption can match our best paid tier, but never beat it."""
    _patch_discounts(monkeypatch, svc, points=points_discount, card=0.0, referee=False)
    rate = svc.get_fee_decimal(tier, user_id=1)
    assert rate >= MIN_EFFECTIVE_FEE_RATE - 1e-12


@pytest.mark.parametrize("card_fraction", [0.40, 0.60, 1.0])
def test_position_card_never_discounts_enterprise(svc, monkeypatch, card_fraction):
    """ENTERPRISE is contracted pricing and a tradeable NFT must not move it.

    Anyone can buy a Position card on the secondary market. If the perk applied
    at ENTERPRISE, a card bought for the price of a JPEG would cut a rate that
    was agreed in a contract — so the perk stops at PREMIUM. Parametrised past
    the 0.60 service clamp because the exclusion has to hold on the value the
    resolver ACTUALLY returns, not merely on the value we expect it to return.
    """
    _patch_discounts(monkeypatch, svc, card=card_fraction)
    assert svc.get_fee_bps(SubscriptionTier.ENTERPRISE, user_id=1) == 10
    # ...and the tier below it still gets the perk, so this is an exclusion and
    # not an accidental global disable.
    assert svc.get_fee_bps(SubscriptionTier.PREMIUM, user_id=1) < 30
