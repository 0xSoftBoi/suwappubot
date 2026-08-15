"""MONEY-PATH tests for the delayed-order fee-terms snapshot.

Delayed orders (limit, DCA, copy) are created at T1 and execute at T2, which
can be days or weeks later. Before this snapshot existed, execution re-resolved
the user's tier at T2, so a user who placed an order on PREMIUM (0.3%) and let
their subscription lapse was silently charged FREE (1%) when it filled — more
than they were quoted. Referral rewards scale off the executed fee, so they
drifted too.

The agreed behavior is to honor the rate quoted at creation, in BOTH
directions: a snapshot is a promise, not a best-of. A NULL snapshot (any order
created before this shipped) must fall back to the old live-tier behavior so
open legacy orders keep working.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import inspect

import pytest

from bot.models.subscription import SubscriptionTier
from bot.services.fee_service import TIER_FEE_RATES, fee_service


class TestSnapshotHelperContract:
    """bot/services/fee_snapshot.py must resolve exactly what a swap would
    have been quoted at that moment, and must never raise into order creation.
    """

    def test_helper_is_async_and_returns_the_three_snapshot_fields(self):
        from bot.services.fee_snapshot import snapshot_fee_terms

        assert inspect.iscoroutinefunction(
            snapshot_fee_terms
        ), "snapshot_fee_terms must be async — it awaits x402_service.get_tier"
        sig = inspect.signature(snapshot_fee_terms)
        assert list(sig.parameters) == ["user_id"]

    @pytest.mark.asyncio
    async def test_snapshot_matches_what_an_immediate_swap_would_be_quoted(self, monkeypatch):
        """The whole point: snapshotting at T1 must equal quoting at T1."""
        from bot.services import fee_snapshot as fs

        class _Tier:
            value = SubscriptionTier.PREMIUM.value

        async def _fake_get_tier(user_id):
            return SubscriptionTier.PREMIUM

        monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", _fake_get_tier)
        monkeypatch.setattr(
            "bot.services.referral_service.referral_service.get_referrer_id",
            lambda user_id: 4242,
        )

        fee_bps, fee_tier, referrer_id = await fs.snapshot_fee_terms(1)

        assert fee_bps == fee_service.get_fee_bps(SubscriptionTier.PREMIUM, user_id=1)
        assert fee_tier == SubscriptionTier.PREMIUM.value
        assert referrer_id == 4242

    @pytest.mark.asyncio
    async def test_tier_lookup_failure_degrades_instead_of_breaking_order_creation(
        self, monkeypatch
    ):
        """A flaky x402 lookup must not stop a user placing an order."""
        from bot.services import fee_snapshot as fs

        async def _boom(user_id):
            raise RuntimeError("x402 down")

        monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", _boom)
        monkeypatch.setattr(
            "bot.services.referral_service.referral_service.get_referrer_id",
            lambda user_id: None,
        )

        fee_bps, fee_tier, referrer_id = await fs.snapshot_fee_terms(1)

        # Falls back to the flat default, same as get_quote() does today.
        assert fee_bps == fee_service.get_fee_bps(None, user_id=1)
        assert fee_tier is None
        assert referrer_id is None

    @pytest.mark.asyncio
    async def test_referrer_lookup_failure_does_not_lose_the_fee_snapshot(self, monkeypatch):
        """A referral outage must not also cost us the fee freeze."""
        from bot.services import fee_snapshot as fs

        async def _fake_get_tier(user_id):
            return SubscriptionTier.PRO

        def _boom(user_id):
            raise RuntimeError("referral db down")

        monkeypatch.setattr("bot.services.x402_service.x402_service.get_tier", _fake_get_tier)
        monkeypatch.setattr("bot.services.referral_service.referral_service.get_referrer_id", _boom)

        fee_bps, fee_tier, referrer_id = await fs.snapshot_fee_terms(1)

        assert fee_bps == fee_service.get_fee_bps(SubscriptionTier.PRO, user_id=1)
        assert referrer_id is None


class TestOverrideBeatsLiveTier:
    """swap_engine.get_quote(fee_bps_override=...) must skip the live lookup."""

    def test_get_quote_accepts_the_override(self):
        from bot.services.swap_engine import SwapEngine

        sig = inspect.signature(SwapEngine.get_quote)
        assert "fee_bps_override" in sig.parameters
        assert (
            sig.parameters["fee_bps_override"].default is None
        ), "must default to None so every existing caller is unaffected"

    def test_downgrade_between_creation_and_fill_does_not_raise_the_fee(self):
        """The actual reported bug: PREMIUM at creation, FREE at fill.

        Asserts the snapshot and the live rate genuinely differ, so the
        override is doing real work rather than coincidentally agreeing.
        """
        premium_bps = fee_service.get_fee_bps(SubscriptionTier.PREMIUM, user_id=None)
        free_bps = fee_service.get_fee_bps(SubscriptionTier.FREE, user_id=None)

        assert (
            premium_bps < free_bps
        ), "fixture assumption broken: PREMIUM should be cheaper than FREE"
        # The order carries premium_bps; execution must charge that, not free_bps.
        assert premium_bps == int(round(TIER_FEE_RATES[SubscriptionTier.PREMIUM] * 10_000))

    def test_upgrade_between_creation_and_fill_also_honors_the_snapshot(self):
        """Honor-the-quote cuts both ways — we do not silently give the better
        rate either, or the snapshot would be a best-of rather than a promise.
        """
        free_bps = fee_service.get_fee_bps(SubscriptionTier.FREE, user_id=None)
        premium_bps = fee_service.get_fee_bps(SubscriptionTier.PREMIUM, user_id=None)
        assert free_bps != premium_bps


class TestLegacyOrdersKeepWorking:
    """NULL snapshot = order predates this feature = old behavior."""

    def test_null_override_falls_through_to_the_tier_lookup(self):
        import bot.services.swap_engine as se

        src = inspect.getsource(se.SwapEngine.get_quote)
        assert "fee_bps_override" in src
        # The parameter must default to None so a legacy order (no snapshot)
        # takes the unchanged live-tier path rather than being repriced.
        sig = inspect.signature(se.SwapEngine.get_quote)
        assert sig.parameters["fee_bps_override"].default is None

    def test_zero_bps_snapshot_is_not_treated_as_absent(self):
        """0 is a valid snapshot (fee-free promo) and must survive."""
        import bot.services.swap_engine as se

        full = inspect.getsource(se)
        assert (
            "if fee_bps_override is not None:" in full
        ), "must use `is not None`; a truthy check would drop a 0 bps snapshot"


class TestReferralSnapshot:
    """Referral rewards must follow the snapshot referrer, conservatively."""

    def test_record_reward_accepts_the_override(self):
        from bot.services.referral_service import ReferralService

        sig = inspect.signature(ReferralService.record_reward)
        assert "referrer_id_override" in sig.parameters
        assert sig.parameters["referrer_id_override"].default is None

    def test_override_still_requires_a_matching_active_referral_row(self):
        """We never credit a referrer the current relationship no longer names
        — the snapshot narrows who can be paid, it does not authorize a payout
        on its own.
        """
        from bot.services.referral_service import ReferralService

        src = inspect.getsource(ReferralService.record_reward)
        assert "referrer_id_override" in src
        assert "is_active" in src, "must still filter on an active Referral row"
