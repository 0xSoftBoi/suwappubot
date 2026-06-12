"""Tests for Phase 4 — Starknet BTC yield (bot/services/starknet_yield.py + /save BTC UX).

All mocked, no network and no starknet_py required:
- exact-amount approve targets the venue vault and equals the deposit amount
- multicall order: approve -> deposit
- redeem args: receiver = owner = wallet
- paymaster fallback split: Unavailable -> direct fallback fires;
  Submitted -> NO re-execution, user-safe error raised
- position math: shares -> assets via convert_to_assets
- sats validation in the handler (_parse_btc_amount)
- dead-button audit: every save_btc callback emitted by the handler module is
  matched by a registered pattern in the savings conversation
"""

import asyncio
import os
import re
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.config import starknet_addresses as sn
from bot.config.settings import settings
from bot.services.starknet_yield import (
    SATS,
    VENUES,
    StarknetYieldError,
    StarknetYieldService,
    get_venue,
)

WALLET_ADDR = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
AMOUNT = 50_000  # 0.0005 BTC in sats


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _wallet():
    w = MagicMock()
    w.address = WALLET_ADDR
    return w


# ---------------------------------------------------------------------------
# call builders
# ---------------------------------------------------------------------------


class TestCallBuilders:
    @pytest.mark.parametrize("venue_key", list(VENUES))
    def test_deposit_multicall_order_and_exact_approve(self, venue_key):
        venue = get_venue(venue_key)
        calls = StarknetYieldService.build_deposit_calls(venue, AMOUNT, WALLET_ADDR)

        assert len(calls) == 2
        approve, deposit = calls

        # Approve first, on the underlying token, spender = the venue vault.
        assert approve["entrypoint"] == "approve"
        assert approve["to"] == venue.underlying_address
        assert approve["calldata"][0] == int(venue.vault_address, 16)
        # Exact-amount u256(low, high) — equals the deposit amount, no infinite approval.
        assert approve["calldata"][1] == AMOUNT
        assert approve["calldata"][2] == 0

        # Then deposit(amount u256, receiver=wallet) on the vault.
        assert deposit["entrypoint"] == "deposit"
        assert deposit["to"] == venue.vault_address
        assert deposit["calldata"] == [AMOUNT, 0, int(WALLET_ADDR, 16)]

    def test_deposit_amount_matches_approve_amount_large_u256(self):
        venue = get_venue("endur_xwbtc")
        big = (1 << 128) + 7  # forces a non-zero high limb
        approve, deposit = StarknetYieldService.build_deposit_calls(venue, big, WALLET_ADDR)
        assert approve["calldata"][1:] == deposit["calldata"][:2] == [7, 1]

    def test_redeem_receiver_equals_owner_equals_wallet(self):
        venue = get_venue("vesu_vwbtc")
        (redeem,) = StarknetYieldService.build_redeem_calls(venue, AMOUNT, WALLET_ADDR)
        assert redeem["entrypoint"] == "redeem"
        assert redeem["to"] == venue.vault_address
        owner = int(WALLET_ADDR, 16)
        assert redeem["calldata"] == [AMOUNT, 0, owner, owner]

    def test_zero_amounts_rejected(self):
        venue = get_venue("endur_xwbtc")
        with pytest.raises(StarknetYieldError):
            StarknetYieldService.build_deposit_calls(venue, 0, WALLET_ADDR)
        with pytest.raises(StarknetYieldError):
            StarknetYieldService.build_redeem_calls(venue, 0, WALLET_ADDR)


# ---------------------------------------------------------------------------
# position math
# ---------------------------------------------------------------------------


class TestPosition:
    def test_shares_to_assets_via_convert_to_assets(self):
        """balanceOf -> shares; convert_to_assets(shares) -> BTC assets;
        convert_to_assets(1e8) -> implied share price."""
        ws = MagicMock()
        ws._starknet_selector = lambda name: f"sel_{name}"
        shares = 123_456
        price = int(1.05 * SATS)  # 1 share worth 1.05 underlying
        assets = shares * price // SATS

        async def fake_rpc(method, params, timeout=6.0):
            call = params[0]
            if call["entry_point_selector"] == "sel_balanceOf":
                return [hex(shares), "0x0"]
            # convert_to_assets — distinguish by the u256 calldata low limb
            low = int(call["calldata"][0], 16)
            if low == SATS:
                return [hex(price), "0x0"]
            assert low == shares
            return [hex(assets), "0x0"]

        ws._starknet_rpc_call = AsyncMock(side_effect=fake_rpc)
        svc = StarknetYieldService(wallet_service=ws)
        pos = run(svc.get_position(WALLET_ADDR, "vesu_vwbtc"))
        assert pos["shares_raw"] == shares
        assert pos["assets_raw"] == assets
        assert pos["share_price_raw"] == price
        assert pos["assets_btc"] == assets / SATS

    def test_zero_shares_skips_assets_call(self):
        ws = MagicMock()
        ws._starknet_selector = lambda name: f"sel_{name}"
        ws._starknet_rpc_call = AsyncMock(side_effect=[["0x0"], [hex(SATS)]])
        svc = StarknetYieldService(wallet_service=ws)
        pos = run(svc.get_position(WALLET_ADDR, "endur_xwbtc"))
        assert pos["shares_raw"] == 0
        assert pos["assets_raw"] == 0
        assert ws._starknet_rpc_call.await_count == 2  # balanceOf + price only

    def test_rpc_error_surfaces_user_safe(self):
        ws = MagicMock()
        ws._starknet_selector = lambda name: f"sel_{name}"
        ws._starknet_rpc_call = AsyncMock(return_value={"error": {"code": 20}})
        svc = StarknetYieldService(wallet_service=ws)
        with pytest.raises(StarknetYieldError):
            run(svc.get_position(WALLET_ADDR, "endur_xwbtc"))


# ---------------------------------------------------------------------------
# APY policy
# ---------------------------------------------------------------------------


class TestApy:
    def test_endur_apy_is_none_never_hardcoded(self):
        svc = StarknetYieldService(wallet_service=MagicMock())
        assert run(svc.get_apy("endur_xwbtc")) is None

    def test_vesu_apy_probe_failure_returns_none(self):
        # No clean rate view / probe failure -> None ("variable"), never a guess.
        svc = StarknetYieldService(wallet_service=MagicMock())
        with patch(
            "bot.services.starknet.client.get_starknet_client",
            new=AsyncMock(side_effect=RuntimeError("no rpc in tests")),
        ):
            assert run(svc.get_apy("vesu_vwbtc")) is None

    def test_no_hardcoded_apy_numbers_in_module(self):
        import inspect

        import bot.services.starknet_yield as mod

        source = inspect.getsource(mod)
        assert "893" not in source  # the incentive-spike figure from research
        assert not re.search(r"apy\s*=\s*\d", source, re.IGNORECASE)


# ---------------------------------------------------------------------------
# execution: paymaster fallback split
# ---------------------------------------------------------------------------


def _exec_service(strk_balance=0.0, deployed=True, balance_btc=1.0):
    ws = MagicMock()

    async def token_balance(symbol, address):
        return strk_balance if symbol == "STRK" else balance_btc

    ws.get_starknet_token_balance = AsyncMock(side_effect=token_balance)
    ws.is_starknet_deployed = AsyncMock(return_value=deployed)
    ws.ensure_starknet_deployed = AsyncMock()
    ws.get_private_key = MagicMock(return_value="0x1234")
    ws._pick_paymaster_gas_token = AsyncMock(return_value=sn.STRK)
    return StarknetYieldService(wallet_service=ws), ws


class TestExecutionFallbackSplit:
    def _run_deposit(self, svc, monkeypatch, paymaster_exc=None, paymaster_hash="0xfeed"):
        from bot.services.starknet import paymaster as pm

        monkeypatch.setattr(settings, "starknet_paymaster_enabled", True)
        monkeypatch.setattr(settings, "avnu_paymaster_api_key", "sk-test")

        account = MagicMock()
        account.address = int(WALLET_ADDR, 16)
        account.signer.public_key = 0xABC

        direct = AsyncMock(return_value="0xd14ec7")
        if paymaster_exc is not None:
            execute_pm = AsyncMock(side_effect=paymaster_exc)
        else:
            execute_pm = AsyncMock(return_value=paymaster_hash)

        with (
            patch(
                "bot.services.starknet.client.get_starknet_account",
                new=AsyncMock(return_value=account),
            ),
            patch.object(pm.avnu_paymaster, "execute_calls_via_paymaster", execute_pm),
            patch.object(StarknetYieldService, "_execute_direct", direct),
            patch("bot.services.wallet._zeroize_str"),
        ):
            result = run(svc.deposit(_wallet(), "endur_xwbtc", AMOUNT))
        return result, execute_pm, direct

    def test_paymaster_success_no_direct_execution(self, monkeypatch):
        svc, ws = _exec_service(strk_balance=0.0)
        tx, execute_pm, direct = self._run_deposit(svc, monkeypatch)
        assert tx == "0xfeed"
        assert execute_pm.await_count == 1
        direct.assert_not_awaited()

    def test_unavailable_falls_back_to_direct(self, monkeypatch):
        from bot.services.starknet.paymaster import PaymasterUnavailableError

        svc, ws = _exec_service(strk_balance=0.0)
        tx, execute_pm, direct = self._run_deposit(
            svc, monkeypatch, paymaster_exc=PaymasterUnavailableError("down")
        )
        assert tx == "0xd14ec7"
        assert execute_pm.await_count == 1
        assert direct.await_count == 1
        ws.ensure_starknet_deployed.assert_awaited()  # deploy before direct invoke

    def test_submitted_never_reexecutes(self, monkeypatch):
        from bot.services.starknet.paymaster import PaymasterSubmittedError

        svc, ws = _exec_service(strk_balance=0.0)
        with pytest.raises(StarknetYieldError, match="may still confirm"):
            self._run_deposit(svc, monkeypatch, paymaster_exc=PaymasterSubmittedError("timeout"))
        # The direct path must NOT have been called.
        ws.ensure_starknet_deployed.assert_not_awaited()

    def test_strk_holder_skips_paymaster(self, monkeypatch):
        svc, ws = _exec_service(strk_balance=5.0, deployed=True)
        tx, execute_pm, direct = self._run_deposit(svc, monkeypatch)
        assert tx == "0xd14ec7"
        execute_pm.assert_not_awaited()
        assert direct.await_count == 1

    def test_insufficient_balance_rejected_before_any_execution(self, monkeypatch):
        svc, ws = _exec_service(balance_btc=0.0)
        monkeypatch.setattr(settings, "starknet_paymaster_enabled", False)
        with pytest.raises(StarknetYieldError, match="Insufficient"):
            run(svc.deposit(_wallet(), "endur_xwbtc", AMOUNT))
        ws.get_private_key.assert_not_called()

    def test_withdraw_max_resolves_full_share_balance(self, monkeypatch):
        svc, ws = _exec_service()
        monkeypatch.setattr(settings, "starknet_paymaster_enabled", False)
        shares = 777
        with (
            patch.object(
                StarknetYieldService,
                "get_position",
                new=AsyncMock(
                    return_value={"shares_raw": shares, "assets_raw": 1, "share_price_raw": 1}
                ),
            ),
            patch.object(
                StarknetYieldService, "_execute_calls", new=AsyncMock(return_value="0xabc")
            ) as exec_mock,
        ):
            run(svc.withdraw(_wallet(), "vesu_vstrkbtc", "max"))
        calls = exec_mock.await_args.args[1]
        assert calls[0]["calldata"][0] == shares


# ---------------------------------------------------------------------------
# handler: sats validation
# ---------------------------------------------------------------------------


def _load_savings_module():
    """Load bot/handlers/savings.py directly, bypassing bot/handlers/__init__.py
    (the package __init__ pulls in handlers using Python>=3.10 syntax; CI runs
    3.12 but local interpreters may be older)."""
    import importlib.util
    import pathlib
    import sys

    if "savings_handler_under_test" in sys.modules:
        return sys.modules["savings_handler_under_test"]
    path = pathlib.Path(__file__).resolve().parents[1] / "bot" / "handlers" / "savings.py"
    spec = importlib.util.spec_from_file_location("savings_handler_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["savings_handler_under_test"] = module
    spec.loader.exec_module(module)
    return module


class TestSatsValidation:
    def test_valid_amounts(self):
        _parse_btc_amount = _load_savings_module()._parse_btc_amount

        assert _parse_btc_amount("0.0005") == 50_000
        assert _parse_btc_amount("1") == 100_000_000
        assert _parse_btc_amount("0.00000001") == 1  # 1 sat
        assert _parse_btc_amount("1,000") == 100_000_000_000

    def test_invalid_amounts(self):
        _parse_btc_amount = _load_savings_module()._parse_btc_amount

        assert _parse_btc_amount("0.000000001") is None  # 9 dp — below 1 sat
        assert _parse_btc_amount("0") is None
        assert _parse_btc_amount("-1") is None
        assert _parse_btc_amount("abc") is None
        assert _parse_btc_amount("") is None
        assert _parse_btc_amount("1e400") is None


# ---------------------------------------------------------------------------
# dead-button audit
# ---------------------------------------------------------------------------


class TestDeadButtonAudit:
    def test_every_emitted_save_btc_callback_is_handled(self):
        """Every save_btc* callback_data emitted in bot/handlers/savings.py must
        match a registered CallbackQueryHandler pattern in the conversation."""
        import inspect

        from telegram.ext import CallbackQueryHandler

        handlers = _load_savings_module()
        conv = handlers.savings_conversation_handler

        source = inspect.getsource(handlers)
        emitted = set(re.findall(r'callback_data=["\'](save_btc[^"\']*)["\']', source))
        # f-string venue buttons: expand to one per venue key.
        for fstring in re.findall(r'callback_data=f["\'](save_btc[^"\']*)["\']', source):
            emitted.discard(fstring)
            for key in VENUES:
                emitted.add(re.sub(r"\{[^}]*\}", key, fstring))
        assert emitted, "expected save_btc buttons in the handler"

        patterns = []
        for handler_list in list(conv.states.values()) + [conv.entry_points, conv.fallbacks]:
            for h in handler_list:
                if isinstance(h, CallbackQueryHandler) and h.pattern is not None:
                    patterns.append(h.pattern)

        for data in emitted:
            assert any(
                p.search(data) for p in patterns
            ), f"dead button: callback_data {data!r} matches no registered pattern"

    def test_btc_states_registered(self):
        handlers = _load_savings_module()

        for state in (
            handlers.SAVE_BTC_MENU,
            handlers.SAVE_BTC_VENUE,
            handlers.SAVE_BTC_AMOUNT,
            handlers.SAVE_BTC_CONFIRM,
        ):
            assert state in handlers.savings_conversation_handler.states
