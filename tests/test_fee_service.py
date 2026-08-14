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
    monkeypatch.setattr(svc, "_active_fee_discount_decimal", lambda uid: points)
    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: card)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: referee)


@pytest.mark.parametrize(
    "tier,no_card_bps,with_card_bps",
    [
        (SubscriptionTier.FREE, 100, 60),
        (SubscriptionTier.PRO, 50, 30),
        (SubscriptionTier.PREMIUM, 30, 18),
        (SubscriptionTier.ENTERPRISE, 10, 6),
    ],
)
def test_exact_fee_bps_table_card_vs_no_card(svc, monkeypatch, tier, no_card_bps, with_card_bps):
    """Pinned table: a 40% proportional card discount off each tier's own rate,
    not a flat 40bps subtraction off all of them."""
    _patch_discounts(monkeypatch, svc, card=0.0)
    assert svc.get_fee_bps(tier, user_id=1) == no_card_bps

    _patch_discounts(monkeypatch, svc, card=0.40)
    assert svc.get_fee_bps(tier, user_id=1) == with_card_bps


@pytest.mark.parametrize("card_fraction", [0.0, 0.40])
@pytest.mark.parametrize("points_discount", [0.0, 0.0015])
@pytest.mark.parametrize("referee_rebate", [False, True])
def test_ladder_is_strictly_monotonic_across_every_stacking_combination(
    svc, monkeypatch, card_fraction, points_discount, referee_rebate
):
    """The regression lock for the flat-40bps bug. With a card held and a points
    discount that binds the ENTERPRISE floor (0.0015 leaves headroom on every
    other tier but always floors ENTERPRISE, since its base rate == the floor),
    the OLD formula (base - points - flat 40bps, floored) collapsed PRO and
    PREMIUM to the same rate as ENTERPRISE. Every combination of the three
    stackable discounts must preserve FREE > PRO > PREMIUM > ENTERPRISE."""
    _patch_discounts(
        monkeypatch, svc, points=points_discount, card=card_fraction, referee=referee_rebate
    )

    bps = [svc.get_fee_bps(tier, user_id=1) for tier in _TIER_LADDER]
    assert bps[0] > bps[1] > bps[2] > bps[3], (
        f"ladder collapsed: FREE={bps[0]} PRO={bps[1]} PREMIUM={bps[2]} ENTERPRISE={bps[3]} "
        f"(card={card_fraction}, points={points_discount}, referee_rebate={referee_rebate})"
    )


@pytest.mark.parametrize("tier", _TIER_LADDER)
@pytest.mark.parametrize("card_fraction", [0.0, 0.40])
@pytest.mark.parametrize("points_discount", [0.0, 0.0015])
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
