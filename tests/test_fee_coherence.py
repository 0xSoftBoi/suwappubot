"""Tests locking fee coherence across surfaces.

The audit found fee rates diverging up to 10x. The fix made fee_service.
TIER_FEE_RATES the single source of truth and had x402_service.TIER_LIMITS
*derive* its per-tier fee_rate from it. This test fails the moment someone
re-hardcodes a fee_rate in x402 and lets the two drift again.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.services.fee_service import TIER_FEE_RATES  # noqa: E402
from bot.services.x402_service import TIER_LIMITS  # noqa: E402


def test_x402_fee_rate_derives_from_canonical_table():
    # Every tier x402 knows about must quote exactly the canonical charged rate.
    for tier, limits in TIER_LIMITS.items():
        assert "fee_rate" in limits, f"{tier} missing fee_rate"
        assert limits["fee_rate"] == TIER_FEE_RATES[tier], (
            f"x402 fee_rate for {tier} ({limits['fee_rate']}) drifted from "
            f"canonical TIER_FEE_RATES ({TIER_FEE_RATES[tier]})"
        )


def test_canonical_rates_are_descending_by_tier():
    # Sanity: higher tiers never pay a worse rate than lower ones.
    rates = list(TIER_FEE_RATES.values())
    assert rates == sorted(rates, reverse=True), "tier rates should be non-increasing"


def test_all_canonical_tiers_covered_by_x402():
    # x402 must price every tier the fee table defines (no silent gaps that fall
    # back to a default rate).
    assert set(TIER_FEE_RATES.keys()).issubset(set(TIER_LIMITS.keys()))
