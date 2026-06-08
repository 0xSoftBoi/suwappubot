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

from bot.services.fee_service import FeeService, TIER_FEE_RATES, DEFAULT_FEE_RATE
from bot.models.subscription import SubscriptionTier


@pytest.fixture()
def svc():
    return FeeService()


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
        float(calc.referral_reward_usd)
        + calc.staking_allocation_usd
        + calc.protocol_allocation_usd
    )
    assert total == pytest.approx(float(calc.fee_amount_usd), abs=0.01)


def test_allocation_reconciles_without_referrer(svc):
    calc = svc.calculate_fee(1000.0, tier=SubscriptionTier.FREE)
    assert calc.has_referrer is False
    assert float(calc.referral_reward_usd) == 0.0
    # no referrer → net == gross → 40/60 of the full fee
    assert float(calc.net_fee_usd) == pytest.approx(float(calc.fee_amount_usd))
    assert calc.staking_allocation_usd == pytest.approx(float(calc.fee_amount_usd) * 0.40, abs=0.01)
    assert calc.protocol_allocation_usd == pytest.approx(float(calc.fee_amount_usd) * 0.60, abs=0.01)
    _assert_reconciles(calc)


def test_allocation_reconciles_with_referrer(svc):
    # $1000 swap, free tier → $10 fee; referrer present → $3 referral, $7 net.
    calc = svc.calculate_fee(1000.0, referrer_id=42, tier=SubscriptionTier.FREE)
    assert calc.has_referrer is True
    assert float(calc.fee_amount_usd) == pytest.approx(10.0, abs=0.01)
    assert float(calc.referral_reward_usd) == pytest.approx(3.0, abs=0.01)   # 30% of gross
    assert float(calc.net_fee_usd) == pytest.approx(7.0, abs=0.01)
    assert calc.staking_allocation_usd == pytest.approx(2.8, abs=0.01)        # 40% of net
    assert calc.protocol_allocation_usd == pytest.approx(4.2, abs=0.01)       # 60% of net
    # the whole point: 3 + 2.8 + 4.2 == 10, NOT 13 (the old 130% bug)
    _assert_reconciles(calc)


@pytest.mark.parametrize("tier", list(TIER_FEE_RATES.keys()) + [None])
def test_allocation_reconciles_across_tiers_with_referrer(svc, tier):
    calc = svc.calculate_fee(2500.0, referrer_id=7, tier=tier)
    _assert_reconciles(calc)
