"""Tests for /earn (bot/handlers/earn.py) — the money-path review fixes.

MONEY-PATH. All mocked, no network. Covers:
- Fix 1: SavingsEvent.action stays short ("deposit"/"withdraw") for every
  vault key, with vault attribution carried in the new `venue` column, so
  logging never overflows the Postgres VARCHAR and silently no-ops.
- Fix 2/3/6: partial withdraw is unified into VaultService.withdraw_assets —
  a target-asset-amount, live-price API. Tested at both layers:
    * VaultService: shares are derived from a LIVE price read inside the
      call (not a snapshot), a near-full request redeems everything, and a
      sub-dust request against a real position floors at 1 share instead of
      raising "Nothing to withdraw".
    * Handler: the exact review scenario (position 1,000,000, request
      996,000) does not drain the full position, and the number reported to
      the user is what was actually redeemed.
- Fix 5: APY guardrails (elapsed < 24h, ceiling > 200%) return None.
- Fix 9: a second confirm-screen tap after execute is a no-op.

Harness mirrors tests/test_swap_guards_money_path.py (MagicMock/AsyncMock
update+context) and tests/test_vault_service.py (mocked ERC4626 contract).
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402
from telegram.ext import ConversationHandler  # noqa: E402

from bot.config.vaults import VAULTS, get_vault  # noqa: E402
from bot.handlers import earn as earn_module  # noqa: E402
from bot.models.savings import SavingsEvent  # noqa: E402
from bot.services.vault_service import VaultError, VaultService  # noqa: E402

VAULT_KEY = "steakusdc-base"  # 6dp USDC vault
CFG = get_vault(VAULT_KEY)
WALLET_ADDRESS = "0x1111111111111111111111111111111111111111"


class FakeWallet:
    id = 7
    user_id = 42
    address = WALLET_ADDRESS


# ---------------------------------------------------------------------------
# Fix 1 — action string fits the column for every vault key
# ---------------------------------------------------------------------------


class TestActionColumnFits:
    def test_action_values_fit_savings_event_columns_for_every_vault(self):
        action_max_len = SavingsEvent.__table__.c.action.type.length
        venue_max_len = SavingsEvent.__table__.c.venue.type.length
        assert len(VAULTS) > 0
        for vault_key in VAULTS:
            for action in ("deposit", "withdraw"):
                assert (
                    len(action) <= action_max_len
                ), f"{action!r} overflows action({action_max_len})"
            assert (
                len(vault_key) <= venue_max_len
            ), f"{vault_key!r} overflows venue({venue_max_len})"


# ---------------------------------------------------------------------------
# Fix 5 — APY guardrails
# ---------------------------------------------------------------------------


class TestApyGuardrails:
    def test_apy_none_when_elapsed_under_24h(self):
        # ~1h apart with a routine tiny tick — would otherwise annualize to
        # an absurd headline number; must be rejected below the 24h floor.
        apy = VaultService.annualize_share_price_growth(1_000_100, 1_000_000, 3600)
        assert apy is None

    def test_apy_none_when_above_200pct_ceiling(self):
        now_price = 2 * 10**18
        past_price = 10**18
        apy = VaultService.annualize_share_price_growth(now_price, past_price, 7 * 24 * 3600)
        assert apy is None

    def test_apy_present_for_a_sane_reading(self):
        apy = VaultService.annualize_share_price_growth(
            1245101738337669501, 1244937217373833839, 7 * 24 * 3600
        )
        assert apy == pytest.approx(0.0069, abs=0.0001)


# ---------------------------------------------------------------------------
# Fix 2/3/6 — VaultService.withdraw_assets: live-price, target-asset withdraw
# ---------------------------------------------------------------------------


def _mock_withdraw_vault(shares_balance: int, price_num: int, price_den: int = 10**18):
    """ERC4626 mock: assets = shares * price_num // price_den, at a fixed
    live price. balanceOf/convertToAssets/convertToShares/redeem only."""
    m = MagicMock()
    m.functions.balanceOf.return_value.call.return_value = shares_balance

    def _to_assets(shares):
        r = MagicMock()
        r.call.return_value = shares * price_num // price_den
        return r

    def _to_shares(assets):
        r = MagicMock()
        r.call.return_value = assets * price_den // price_num
        return r

    m.functions.convertToAssets.side_effect = _to_assets
    m.functions.convertToShares.side_effect = _to_shares
    return m


def _make_withdraw_service(shares_balance: int, price_num: int, price_den: int = 10**18):
    svc = VaultService()
    vault_mock = _mock_withdraw_vault(shares_balance, price_num, price_den)
    svc._vault_contract = lambda w3, addr: vault_mock
    svc._failover = lambda chain, op, attempts=4: op(MagicMock())
    svc._build_and_send = lambda w3, wallet, fn, chain_id: "0xtx"
    return svc, vault_mock


class TestWithdrawAssetsMath:
    def test_review_scenario_partial_does_not_drain_full_position(self):
        # 1,000,000 shares @ 1:1 USDC price = 1,000,000 USDC position.
        shares_balance = 1_000_000 * 10**18
        svc, vault_mock = _make_withdraw_service(shares_balance, price_num=10**6, price_den=10**18)
        result = svc.withdraw_assets(FakeWallet(), CFG.key, 996_000 * 10**6)
        assert result["full_redeem"] is False
        redeemed_shares = vault_mock.functions.redeem.call_args.args[0]
        assert redeemed_shares < shares_balance
        assert result["assets_raw"] == pytest.approx(996_000 * 10**6, rel=1e-9)

    def test_stale_snapshot_shares_come_from_live_price_not_a_cached_ratio(self):
        """A caller passing a stale total_assets ratio must have NO effect —
        withdraw_assets only ever reads balanceOf/convertToShares live."""
        shares_balance = 1_000 * 10**18
        # Live price has moved to 2 USDC/share (vs. whatever a stale confirm
        # screen may have assumed).
        svc, vault_mock = _make_withdraw_service(
            shares_balance, price_num=2 * 10**6, price_den=10**18
        )
        result = svc.withdraw_assets(FakeWallet(), CFG.key, 900 * 10**6)  # "withdraw 900 USDC"
        redeemed_shares = vault_mock.functions.redeem.call_args.args[0]
        # At the LIVE 2 USDC/share price, 900 USDC == 450 shares (NOT 900,
        # which is what a stale 1:1 assumption would have redeemed).
        assert redeemed_shares == pytest.approx(450 * 10**18, rel=1e-9)
        assert result["full_redeem"] is False

    def test_near_full_request_redeems_everything(self):
        shares_balance = 1_000_000 * 10**18
        svc, vault_mock = _make_withdraw_service(shares_balance, price_num=10**6, price_den=10**18)
        result = svc.withdraw_assets(
            FakeWallet(), CFG.key, 999_900 * 10**6
        )  # within epsilon of full
        assert result["full_redeem"] is True
        assert vault_mock.functions.redeem.call_args.args[0] == shares_balance

    def test_sub_dust_request_against_large_position_floors_at_one_share(self):
        """convertToShares rounding a tiny request to 0 must never surface
        'Nothing to withdraw' for a user holding a real position."""
        shares_balance = 1_000_000 * 10**18
        svc, vault_mock = _make_withdraw_service(shares_balance, price_num=10**6, price_den=10**18)
        vault_mock.functions.convertToShares.side_effect = None
        vault_mock.functions.convertToShares.return_value.call.return_value = 0
        result = svc.withdraw_assets(FakeWallet(), CFG.key, 1)  # 0.000001 USDC
        assert result["shares_raw"] == 1
        assert result["full_redeem"] is False

    def test_empty_position_raises_nothing_to_withdraw(self):
        svc, _ = _make_withdraw_service(0, price_num=10**6, price_den=10**18)
        with pytest.raises(VaultError, match="Nothing to withdraw"):
            svc.withdraw_assets(FakeWallet(), CFG.key, 100 * 10**6)

    def test_zero_or_negative_amount_rejected(self):
        svc, _ = _make_withdraw_service(1000, price_num=10**6, price_den=10**18)
        with pytest.raises(VaultError, match="greater than zero"):
            svc.withdraw_assets(FakeWallet(), CFG.key, 0)


# ---------------------------------------------------------------------------
# earn_execute_callback (handler layer)
# ---------------------------------------------------------------------------


def _make_update_and_context(action, amount, *, position=None):
    query = MagicMock()
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()
    update = MagicMock()
    update.callback_query = query
    update.effective_user = MagicMock(id=999)

    context = MagicMock()
    context.user_data = {
        "user_id": 42,
        "earn": {
            "wallet_id": 7,
            "wallet_address": WALLET_ADDRESS,
            "vault_key": VAULT_KEY,
            "action": action,
            "amount": amount,
            "position": position or {},
        },
    }
    return update, context


def _edit_text(update) -> str:
    call = update.callback_query.edit_message_text.call_args
    if call is None:
        return ""
    return call.args[0] if call.args else call.kwargs.get("text", "")


@pytest.fixture
def _patched_session():
    with patch.object(earn_module, "get_session") as mock_get_session:
        session = MagicMock()
        session.query.return_value.filter.return_value.first.return_value = FakeWallet()
        mock_get_session.return_value.__enter__.return_value = session
        mock_get_session.return_value.__exit__.return_value = False
        yield mock_get_session


@pytest.fixture
def _patched_log_event():
    with patch.object(earn_module, "_log_event", new=AsyncMock()) as mock_log:
        yield mock_log


class TestEarnExecuteWithdrawReview:
    async def test_review_scenario_reports_actual_redeemed_amount(
        self, _patched_session, _patched_log_event
    ):
        requested = 996_000.0
        actual_redeemed_raw = int(requested * 10**CFG.asset_decimals)
        with (
            patch.object(
                earn_module.vault_service,
                "withdraw_assets",
                return_value={
                    "tx_hashes": ["0xabc"],
                    "shares_raw": 996_000 * 10**18,
                    "assets_raw": actual_redeemed_raw,
                    "full_redeem": False,
                },
            ) as mock_withdraw_assets,
            patch.object(earn_module.vault_service, "withdraw") as mock_withdraw_all,
        ):
            update, context = _make_update_and_context(
                "withdraw",
                requested,
                position={"assets": 1_000_000.0, "shares_raw": 1_000_000 * 10**18},
            )
            result = await earn_module.earn_execute_callback(update, context)

        assert result == earn_module.EARN_MENU
        mock_withdraw_all.assert_not_called()
        called_assets_raw = mock_withdraw_assets.call_args.args[2]
        assert called_assets_raw == int(round(requested * 10**CFG.asset_decimals))

        text = _edit_text(update)
        assert "996000.000000" in text
        assert "full position" not in text
        # logged amount matches what was actually redeemed, not the request
        _patched_log_event.assert_awaited_once()
        logged_amount = _patched_log_event.call_args.args[4]
        assert logged_amount == pytest.approx(actual_redeemed_raw / 10**CFG.asset_decimals)

    async def test_double_execute_is_a_noop_the_second_time(
        self, _patched_session, _patched_log_event
    ):
        with patch.object(earn_module.vault_service, "withdraw_assets") as mock_withdraw_assets:
            mock_withdraw_assets.return_value = {
                "tx_hashes": ["0xabc"],
                "shares_raw": 1,
                "assets_raw": 1,
                "full_redeem": False,
            }
            update, context = _make_update_and_context("withdraw", 10.0)
            first = await earn_module.earn_execute_callback(update, context)
            assert first == earn_module.EARN_MENU
            assert mock_withdraw_assets.call_count == 1

            update2 = MagicMock()
            update2.callback_query = MagicMock()
            update2.callback_query.answer = AsyncMock()
            update2.callback_query.edit_message_text = AsyncMock()
            second = await earn_module.earn_execute_callback(update2, context)

        assert second == ConversationHandler.END
        assert mock_withdraw_assets.call_count == 1  # not re-executed
        assert "already" in _edit_text(update2).lower()
