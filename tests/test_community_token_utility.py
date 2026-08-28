"""Tests for the $Suwappu community-token holder utility (docs/plans/suwappu-token-utility.md).

Covers, all behind COMMUNITY_TOKEN_ENABLED (default OFF):
  - flag off => no change to fee tier or XP
  - holder >= PRO threshold => PRO fee rate
  - holder >= PREMIUM threshold => PREMIUM fee rate
  - an ENTERPRISE subscriber is never downgraded by the holder perk
  - RPC/lookup failure => no perk, never an exception
  - XP multiplier is applied (int-rounded) via the single award_points choke point
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import asyncio  # noqa: E402
from decimal import Decimal  # noqa: E402
from unittest.mock import MagicMock, patch  # noqa: E402

import pytest  # noqa: E402

from bot.config.settings import settings  # noqa: E402
from bot.services.fee_service import FeeService, TIER_FEE_RATES  # noqa: E402
from bot.models.subscription import SubscriptionTier  # noqa: E402
from bot.services import wallet as wallet_module  # noqa: E402
from bot.services.wallet import WalletService  # noqa: E402


@pytest.fixture()
def svc():
    return FeeService()


@pytest.fixture(autouse=True)
def _reset_community_token_settings(monkeypatch):
    """Every test starts from the documented defaults (flag OFF) and a clean
    balance cache, so tests can't leak state into each other."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", False)
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_PRO_THRESHOLD", 20_000_000.0)
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_PREMIUM_THRESHOLD", 100_000_000.0)
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_XP_MULTIPLIER", 1.5)
    wallet_module._community_token_balance_cache.clear()
    yield
    wallet_module._community_token_balance_cache.clear()


def _seed_cache(user_id: int, balance: Decimal, age_seconds: float = 0.0) -> None:
    """Populate the module-level 60s cache directly, bypassing RPC — this is
    exactly what WalletService.get_community_token_balance would leave behind.

    ``age_seconds`` backdates the entry (using time.monotonic(), matching the
    production cache — see finding #3) so tests can exercise TTL expiry.
    """
    import time

    wallet_module._community_token_balance_cache[user_id] = (
        time.monotonic() - age_seconds,
        balance,
    )


# ---------------------------------------------------------------------------
# Fee tier holder perk (fee_service._community_token_tier_floor / get_fee_decimal)
# ---------------------------------------------------------------------------


def test_flag_off_holder_balance_has_no_effect(svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", False)
    _seed_cache(111, Decimal("500_000_000"))

    rate = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=111)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.FREE])


def test_holder_at_pro_threshold_gets_pro_rate(svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(222, Decimal("20_000_000"))  # exactly at threshold

    rate = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=222)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.PRO])


def test_holder_below_pro_threshold_stays_free(svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(223, Decimal("19_999_999"))

    rate = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=223)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.FREE])


def test_holder_at_premium_threshold_gets_premium_rate(svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(333, Decimal("100_000_000"))

    rate = svc.get_fee_decimal(SubscriptionTier.PRO, user_id=333)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.PREMIUM])


def test_enterprise_subscriber_never_downgraded_by_holder_perk(svc, monkeypatch):
    """An ENTERPRISE subscriber holding even a huge $Suwappu balance keeps
    their contracted (better) rate — the perk only ever raises a tier, never
    lowers one relative to the subscription tier the user already has."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(444, Decimal("999_000_000"))

    rate = svc.get_fee_decimal(SubscriptionTier.ENTERPRISE, user_id=444)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.ENTERPRISE])


def test_cold_cache_means_no_perk_even_when_enabled(svc, monkeypatch):
    """A user who was never warmed (no RPC done yet) is treated exactly like a
    non-holder — never blocks fee computation waiting on a fetch."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    # No _seed_cache call — cache miss.

    rate = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=555)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.FREE])


def test_community_token_lookup_exception_never_raises(svc, monkeypatch):
    """A broken cache read must degrade to 'no perk', never propagate."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)

    def _boom(user_id):
        raise RuntimeError("cache backend exploded")

    with patch(
        "bot.services.wallet.get_cached_community_token_balance",
        side_effect=_boom,
    ):
        rate = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=666)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.FREE])


# ---------------------------------------------------------------------------
# Balance helper (bot/services/wallet.py) — fail-safe on RPC error
# ---------------------------------------------------------------------------


def test_get_community_token_balance_disabled_flag_returns_zero(monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", False)
    svc = WalletService()

    balance = asyncio.run(svc.get_community_token_balance(777))

    assert balance == Decimal(0)


def test_get_erc20_balance_rpc_failure_returns_zero_no_raise(monkeypatch):
    """RPC errors anywhere in the balance path must resolve to Decimal(0),
    never raise into the caller (swap/fee/points paths)."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    svc = WalletService()

    fake_wallet = MagicMock()
    fake_wallet.address = "0x000000000000000000000000000000000000AA"
    monkeypatch.setattr(svc, "get_default_wallet", lambda user_id, chain_type: fake_wallet)

    async def _raise(*args, **kwargs):
        raise ConnectionError("all_circuits_open")

    monkeypatch.setattr(svc, "_evm_rpc_call", _raise)

    balance = asyncio.run(
        svc.get_erc20_balance(
            888, settings.COMMUNITY_TOKEN_CHAIN_ID, settings.COMMUNITY_TOKEN_ADDRESS
        )
    )

    assert balance == Decimal(0)


def test_get_erc20_balance_no_wallet_returns_zero(monkeypatch):
    svc = WalletService()
    monkeypatch.setattr(svc, "get_default_wallet", lambda user_id, chain_type: None)

    balance = asyncio.run(
        svc.get_erc20_balance(
            999, settings.COMMUNITY_TOKEN_CHAIN_ID, settings.COMMUNITY_TOKEN_ADDRESS
        )
    )

    assert balance == Decimal(0)


def test_get_community_token_balance_caches_for_60s(monkeypatch):
    """A second call within the TTL window must not hit the RPC path again."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    svc = WalletService()

    calls = {"n": 0}

    async def _fake_get_erc20_balance(user_id, chain_id, token_address, decimals=18):
        calls["n"] += 1
        return Decimal("42")

    monkeypatch.setattr(svc, "get_erc20_balance", _fake_get_erc20_balance)

    first = asyncio.run(svc.get_community_token_balance(1010))
    second = asyncio.run(svc.get_community_token_balance(1010))

    assert first == Decimal("42")
    assert second == Decimal("42")
    assert calls["n"] == 1  # second call served from cache


def test_ttl_expiry_means_no_perk(svc, monkeypatch):
    """An entry past the 60s TTL must be treated as a cache miss — a stale
    balance can never grant (or keep granting) a perk."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(
        901,
        Decimal("999_000_000"),
        age_seconds=wallet_module.COMMUNITY_TOKEN_CACHE_TTL_SECONDS + 1,
    )

    assert wallet_module.get_cached_community_token_balance(901) is None

    rate = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=901)

    assert rate == pytest.approx(TIER_FEE_RATES[SubscriptionTier.FREE])


def test_cross_user_cache_isolation(svc, monkeypatch):
    """Seeding user A's balance must never leak a perk to user B."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(902, Decimal("999_000_000"))  # user A: a large holder

    rate_b = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=903)  # user B: never seeded
    rate_a = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=902)

    assert rate_b == pytest.approx(TIER_FEE_RATES[SubscriptionTier.FREE])
    assert rate_a == pytest.approx(TIER_FEE_RATES[SubscriptionTier.PREMIUM])


def test_get_erc20_balance_never_fetches_decimals_from_rpc(monkeypatch):
    """Regression for the fail-open decimals() bug: only ONE eth_call
    (balanceOf) may ever be made — decimals must come exclusively from the
    caller-supplied `decimals` argument, never a second on-chain round trip
    that a malicious/broken token could answer with 0 to inflate dust into a
    holder-qualifying balance."""
    svc = WalletService()
    fake_wallet = MagicMock()
    fake_wallet.address = "0x000000000000000000000000000000000000AA"
    monkeypatch.setattr(svc, "get_default_wallet", lambda user_id, chain_type: fake_wallet)

    calls = []

    async def _fake_rpc(chain_name, method, params, timeout=3.5):
        calls.append((method, params))
        return hex(1_000_000)  # 1,000,000 raw units

    monkeypatch.setattr(svc, "_evm_rpc_call", _fake_rpc)

    balance = asyncio.run(
        svc.get_erc20_balance(1, 8453, "0x1234567890123456789012345678901234567890", decimals=6)
    )

    assert len(calls) == 1  # balanceOf only — no decimals() round trip
    assert balance == Decimal("1000000") / Decimal(10**6)  # == 1.0, using the PASSED decimals


def test_get_community_token_balance_uses_settings_decimals(monkeypatch):
    """get_community_token_balance must forward settings.COMMUNITY_TOKEN_DECIMALS
    explicitly to get_erc20_balance — never rely on an on-chain lookup."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_DECIMALS", 6)
    svc = WalletService()

    captured = {}

    async def _fake_get_erc20_balance(user_id, chain_id, token_address, decimals=18):
        captured["decimals"] = decimals
        return Decimal("1")

    monkeypatch.setattr(svc, "get_erc20_balance", _fake_get_erc20_balance)

    asyncio.run(svc.get_community_token_balance(2))

    assert captured["decimals"] == 6


# ---------------------------------------------------------------------------
# XP multiplier (points_service.award_points single choke point)
# ---------------------------------------------------------------------------


@pytest.fixture()
def points_svc():
    from bot.services.points_service import PointsService

    return PointsService()


def _fake_locked_account():
    account = MagicMock()
    account.total_points_earned = 0
    account.current_points = 0
    account.xp = 0
    account.check_level_up.return_value = None
    # award_swap_points also reads/writes these on the same locked account.
    account.last_swap_date = None
    account.total_swaps = 0
    account.total_volume_usd = 0.0
    return account


def test_xp_multiplier_disabled_flag_no_change(points_svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", False)
    _seed_cache(2020, Decimal("500_000_000"))

    with (
        patch("bot.services.points_service.get_session") as mock_session,
        patch.object(points_svc, "_get_locked_points_account", return_value=_fake_locked_account()),
    ):
        mock_session.return_value.__enter__.return_value = MagicMock()
        points, _level = points_svc.award_points(user_id=2020, action="checkin", amount=100)

    assert points == 100


def test_xp_multiplier_applied_and_int_rounded(points_svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_XP_MULTIPLIER", 1.5)
    _seed_cache(2021, Decimal("20_000_000"))  # >= PRO threshold

    with (
        patch("bot.services.points_service.get_session") as mock_session,
        patch.object(points_svc, "_get_locked_points_account", return_value=_fake_locked_account()),
    ):
        mock_session.return_value.__enter__.return_value = MagicMock()
        # 101 * 1.5 = 151.5 -> rounds to 152 (banker's rounding on .5 ties would
        # give 152 here since 151.5 is exactly between 151/152 and round() picks
        # the even one — assert via the documented int(round(...)) semantics).
        points, _level = points_svc.award_points(user_id=2021, action="checkin", amount=101)

    assert points == int(round(101 * 1.5))


def test_xp_multiplier_below_threshold_no_change(points_svc, monkeypatch):
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    _seed_cache(2022, Decimal("1"))  # well below PRO threshold

    with (
        patch("bot.services.points_service.get_session") as mock_session,
        patch.object(points_svc, "_get_locked_points_account", return_value=_fake_locked_account()),
    ):
        mock_session.return_value.__enter__.return_value = MagicMock()
        points, _level = points_svc.award_points(user_id=2022, action="checkin", amount=50)

    assert points == 50


def test_xp_multiplier_is_clamped_to_2x(points_svc, monkeypatch):
    """A misconfigured/out-of-range COMMUNITY_TOKEN_XP_MULTIPLIER must never
    exceed 2x or drop below 1x (never a penalty), mirroring MAX_TICKER_BOOST_BPS."""
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_ENABLED", True)
    monkeypatch.setattr(settings, "COMMUNITY_TOKEN_XP_MULTIPLIER", 50.0)  # way out of range
    _seed_cache(2023, Decimal("20_000_000"))  # >= PRO threshold

    with (
        patch("bot.services.points_service.get_session") as mock_session,
        patch.object(points_svc, "_get_locked_points_account", return_value=_fake_locked_account()),
    ):
        mock_session.return_value.__enter__.return_value = MagicMock()
        points, _level = points_svc.award_points(user_id=2023, action="checkin", amount=100)

    assert points == 200  # clamped to 2.0x, not 50x


def test_award_swap_points_returns_multiplied_value(points_svc, monkeypatch):
    """award_swap_points must surface whatever award_points ACTUALLY wrote
    (post community-token multiplier), not the pre-multiplier total_points it
    computed internally — otherwise the UI/return value would understate the
    real XP credited to the account."""
    with (
        patch("bot.services.points_service.get_session") as mock_session,
        patch.object(points_svc, "_get_locked_points_account", return_value=_fake_locked_account()),
        patch.object(points_svc, "_check_milestones", return_value=[]),
        patch.object(points_svc, "award_points", return_value=(999, None)) as mock_award_points,
    ):
        mock_session.return_value.__enter__.return_value = MagicMock()
        points_earned, _is_first, _level = points_svc.award_swap_points(
            user_id=3030, swap_amount_usd=100.0, swap_id=1
        )

    assert mock_award_points.called
    # 999 is what award_points (which applies the multiplier) reported — NOT
    # the pre-multiplier base_points (int(100.0 / 10) == 10) award_swap_points
    # computed on its own.
    assert points_earned == 999
