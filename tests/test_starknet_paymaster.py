"""Tests for Phase 2 — AVNU SNIP-29 paymaster (bot/services/starknet/paymaster.py).

All HTTP is mocked (no network). starknet_py is NOT required: signing and
selector hashing are stubbed out, and tests that would truly need starknet_py
use pytest.importorskip.

Covers:
- JSON-RPC request body shapes for invoke / deploy / deploy_and_invoke
- fee_mode correctness (sponsored when API key set, default+gas_token when not)
- x-paymaster-api-key header presence only when the key is configured
- execute_transaction parsing of transaction_hash
- fallback behavior: wallet deploy falls back to self-paid when the paymaster
  is unavailable or raises; swap engine falls back to direct execution
"""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.config.settings import settings
from bot.config import starknet_addresses as sn
from bot.services.starknet import paymaster as pm
from bot.services.starknet.paymaster import (
    AvnuPaymaster,
    PaymasterError,
    PaymasterUnavailableError,
    build_argent_deployment,
    _to_hex,
)

USER = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
CALLS = [{"to": "0x123", "selector": "0x456", "calldata": ["0x1", "0x2"]}]


def _mock_httpx(monkeypatch, result=None, results=None, status=200):
    """Patch pm.httpx.AsyncClient; records (url, json, headers) per request."""
    requests = []
    queue = list(results) if results is not None else None

    class FakeResponse:
        status_code = status

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

        text = "raw"

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            requests.append({"url": url, "json": json, "headers": headers})
            payload = queue.pop(0) if queue else {"jsonrpc": "2.0", "id": 1, "result": result}
            return FakeResponse(payload)

    monkeypatch.setattr(pm.httpx, "AsyncClient", FakeClient)
    return requests


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _no_api_key(monkeypatch):
    """Default: no sponsored key, paymaster enabled, default URL."""
    monkeypatch.setattr(settings, "avnu_paymaster_api_key", None)
    monkeypatch.setattr(settings, "starknet_paymaster_enabled", True)
    yield


# ---------------------------------------------------------------------------
# fee_mode + headers
# ---------------------------------------------------------------------------


class TestFeeModeAndHeaders:
    def test_sponsored_when_key_set(self, monkeypatch):
        monkeypatch.setattr(settings, "avnu_paymaster_api_key", "sk-test")
        assert AvnuPaymaster().fee_mode() == {"mode": "sponsored"}
        # gas_token is ignored in sponsored mode
        assert AvnuPaymaster().fee_mode("0xabc") == {"mode": "sponsored"}

    def test_default_mode_requires_gas_token(self):
        p = AvnuPaymaster()
        assert p.fee_mode("0xabc") == {"mode": "default", "gas_token": "0xabc"}
        with pytest.raises(PaymasterError):
            p.fee_mode()

    def test_header_present_only_with_key(self, monkeypatch):
        requests = _mock_httpx(monkeypatch, result=True)
        run(AvnuPaymaster().is_available())
        assert "x-paymaster-api-key" not in requests[0]["headers"]

        monkeypatch.setattr(settings, "avnu_paymaster_api_key", "sk-test")
        run(AvnuPaymaster().is_available())
        assert requests[1]["headers"]["x-paymaster-api-key"] == "sk-test"

    def test_base_url_from_settings(self, monkeypatch):
        monkeypatch.setattr(settings, "starknet_paymaster_url", "https://sepolia.paymaster.avnu.fi")
        requests = _mock_httpx(monkeypatch, result=True)
        run(AvnuPaymaster().is_available())
        assert requests[0]["url"] == "https://sepolia.paymaster.avnu.fi"


# ---------------------------------------------------------------------------
# build_transaction request shapes
# ---------------------------------------------------------------------------


class TestBuildTransactionShapes:
    def test_invoke_shape_default_mode(self, monkeypatch):
        requests = _mock_httpx(monkeypatch, result={"typed_data": {}})
        run(
            AvnuPaymaster().build_transaction(
                user_address=USER, calls=CALLS, fee_mode={"mode": "default", "gas_token": "0xabc"}
            )
        )
        body = requests[0]["json"]
        assert body["method"] == "paymaster_buildTransaction"
        tx = body["params"]["transaction"]
        assert tx["type"] == "invoke"
        assert tx["invoke"]["user_address"] == USER
        assert tx["invoke"]["calls"] == CALLS
        params = body["params"]["parameters"]
        assert params["version"] == "0x1"
        assert params["fee_mode"] == {"mode": "default", "gas_token": "0xabc"}
        assert "time_bounds" in params
        before = int(params["time_bounds"]["execute_before"], 16)
        after = int(params["time_bounds"]["execute_after"], 16)
        assert before - after == pm.EXECUTE_WINDOW_SECONDS + 60

    def test_invoke_sponsored_fee_mode_from_settings(self, monkeypatch):
        monkeypatch.setattr(settings, "avnu_paymaster_api_key", "sk-test")
        requests = _mock_httpx(monkeypatch, result={"typed_data": {}})
        run(AvnuPaymaster().build_transaction(user_address=USER, calls=CALLS))
        params = requests[0]["json"]["params"]["parameters"]
        assert params["fee_mode"] == {"mode": "sponsored"}
        assert requests[0]["headers"]["x-paymaster-api-key"] == "sk-test"

    def test_deploy_shape_no_signature_no_time_bounds(self, monkeypatch):
        requests = _mock_httpx(monkeypatch, result={"fee": {}})
        deployment = build_argent_deployment(USER, 0xCAFE)
        run(
            AvnuPaymaster().build_transaction(
                deployment=deployment, fee_mode={"mode": "default", "gas_token": sn.STRK}
            )
        )
        tx = requests[0]["json"]["params"]["transaction"]
        assert tx["type"] == "deploy"
        assert "invoke" not in tx
        assert tx["deployment"]["class_hash"] == sn.ARGENT_V040_CLASS_HASH
        assert tx["deployment"]["salt"] == hex(0xCAFE)
        assert tx["deployment"]["calldata"] == ["0x0", hex(0xCAFE), "0x0"]
        assert tx["deployment"]["version"] == 1
        assert "time_bounds" not in requests[0]["json"]["params"]["parameters"]

    def test_deploy_and_invoke_shape(self, monkeypatch):
        requests = _mock_httpx(monkeypatch, result={"typed_data": {}})
        deployment = build_argent_deployment(USER, 0xCAFE)
        run(
            AvnuPaymaster().build_transaction(
                user_address=USER,
                calls=CALLS,
                deployment=deployment,
                fee_mode={"mode": "default", "gas_token": sn.USDC},
            )
        )
        tx = requests[0]["json"]["params"]["transaction"]
        assert tx["type"] == "deploy_and_invoke"
        assert tx["deployment"]["address"] == USER
        assert tx["invoke"]["calls"] == CALLS

    def test_requires_calls_or_deployment(self):
        with pytest.raises(PaymasterError):
            run(AvnuPaymaster().build_transaction(user_address=USER))

    def test_format_calls_normalizes_ints(self):
        calls = AvnuPaymaster._format_calls(
            [{"contractAddress": "0xAA", "selector": 0x1F, "calldata": [1, "0x2", "3"]}]
        )
        assert calls == [{"to": "0xAA", "selector": "0x1f", "calldata": ["0x1", "0x2", "0x3"]}]

    def test_to_hex(self):
        assert _to_hex(255) == "0xff"
        assert _to_hex("0xFF") == "0xFF"
        assert _to_hex("255") == "0xff"


# ---------------------------------------------------------------------------
# execute_transaction
# ---------------------------------------------------------------------------


class TestExecuteTransaction:
    def test_parses_transaction_hash(self, monkeypatch):
        requests = _mock_httpx(
            monkeypatch, result={"tracking_id": "t-1", "transaction_hash": "0xdeadbeef"}
        )
        tx_hash = run(
            AvnuPaymaster().execute_transaction(
                tx_type="invoke",
                user_address=USER,
                typed_data={"types": {}},
                signature=["0x1", "0x2"],
            )
        )
        assert tx_hash == "0xdeadbeef"
        body = requests[0]["json"]
        assert body["method"] == "paymaster_executeTransaction"
        tx = body["params"]["transaction"]
        assert tx["type"] == "invoke"
        assert tx["invoke"]["typed_data"] == {"types": {}}
        assert tx["invoke"]["signature"] == ["0x1", "0x2"]

    def test_missing_hash_raises(self, monkeypatch):
        _mock_httpx(monkeypatch, result={"tracking_id": "t-1"})
        with pytest.raises(PaymasterError):
            run(
                AvnuPaymaster().execute_transaction(
                    tx_type="invoke", user_address=USER, typed_data={}, signature=[]
                )
            )

    def test_rpc_error_raises(self, monkeypatch):
        _mock_httpx(
            monkeypatch,
            results=[{"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "boom"}}],
        )
        with pytest.raises(PaymasterError, match="boom"):
            run(AvnuPaymaster().get_supported_tokens())

    def test_deploy_execute_has_no_invoke_section(self, monkeypatch):
        requests = _mock_httpx(monkeypatch, result={"transaction_hash": "0xabc"})
        deployment = build_argent_deployment(USER, 0xCAFE)
        run(AvnuPaymaster().execute_transaction(tx_type="deploy", deployment=deployment))
        tx = requests[0]["json"]["params"]["transaction"]
        assert "invoke" not in tx
        assert tx["deployment"] == deployment


# ---------------------------------------------------------------------------
# execute_calls_via_paymaster
# ---------------------------------------------------------------------------


class TestExecuteCallsViaPaymaster:
    def test_unavailable_raises(self, monkeypatch):
        _mock_httpx(monkeypatch, result=False)
        account = MagicMock(address=int(USER, 16))
        with pytest.raises(PaymasterUnavailableError):
            run(AvnuPaymaster().execute_calls_via_paymaster(account, CALLS, gas_token="0xabc"))

    def test_full_invoke_flow(self, monkeypatch):
        results = [
            {"jsonrpc": "2.0", "id": 1, "result": True},  # isAvailable
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"typed_data": {"d": 1}, "parameters": {"version": "0x1"}},
            },
            {"jsonrpc": "2.0", "id": 1, "result": {"transaction_hash": "0xfeed"}},
        ]
        requests = _mock_httpx(monkeypatch, results=results)
        account = MagicMock(address=int(USER, 16))
        monkeypatch.setattr(
            AvnuPaymaster, "sign_typed_data", staticmethod(lambda acct, td: ["0x1", "0x2"])
        )
        tx_hash = run(
            AvnuPaymaster().execute_calls_via_paymaster(account, CALLS, gas_token="0xabc")
        )
        assert tx_hash == "0xfeed"
        exec_tx = requests[2]["json"]["params"]["transaction"]
        assert exec_tx["type"] == "invoke"
        assert exec_tx["invoke"]["signature"] == ["0x1", "0x2"]

    def test_deploy_and_invoke_when_deployment_given(self, monkeypatch):
        results = [
            {"jsonrpc": "2.0", "id": 1, "result": True},
            {"jsonrpc": "2.0", "id": 1, "result": {"typed_data": {"d": 1}}},
            {"jsonrpc": "2.0", "id": 1, "result": {"transaction_hash": "0xfeed"}},
        ]
        requests = _mock_httpx(monkeypatch, results=results)
        account = MagicMock(address=int(USER, 16))
        monkeypatch.setattr(
            AvnuPaymaster, "sign_typed_data", staticmethod(lambda acct, td: ["0x1"])
        )
        deployment = build_argent_deployment(USER, 0xCAFE)
        run(
            AvnuPaymaster().execute_calls_via_paymaster(
                account, CALLS, gas_token="0xabc", deployment=deployment
            )
        )
        assert requests[1]["json"]["params"]["transaction"]["type"] == "deploy_and_invoke"
        assert requests[2]["json"]["params"]["transaction"]["type"] == "deploy_and_invoke"


# ---------------------------------------------------------------------------
# wallet deploy fallback
# ---------------------------------------------------------------------------


class TestWalletDeployFallback:
    def _wallet_service(self):
        from bot.services.wallet import WalletService

        svc = WalletService.__new__(WalletService)
        return svc

    def test_falls_back_to_self_paid_when_paymaster_raises(self, monkeypatch):
        """Paymaster path raising → direct (self-paid) path is entered, which
        surfaces the no-STRK ValueError (proving the fallback ran)."""
        from bot.services.wallet import WalletService

        svc = self._wallet_service()
        wallet = MagicMock(address=USER)
        monkeypatch.setattr(svc, "is_starknet_deployed", AsyncMock(return_value=False))
        monkeypatch.setattr(
            svc, "_deploy_starknet_via_paymaster", AsyncMock(side_effect=PaymasterError("down"))
        )
        balance_mock = AsyncMock(return_value=0.0)
        monkeypatch.setattr(svc, "get_starknet_token_balance", balance_mock)

        with pytest.raises(ValueError, match="STRK"):
            run(svc.ensure_starknet_deployed(wallet))
        balance_mock.assert_awaited()  # direct path ran

    def test_paymaster_success_skips_self_paid(self, monkeypatch):
        svc = self._wallet_service()
        wallet = MagicMock(address=USER)
        monkeypatch.setattr(svc, "is_starknet_deployed", AsyncMock(return_value=False))
        monkeypatch.setattr(svc, "_deploy_starknet_via_paymaster", AsyncMock(return_value=True))
        balance_mock = AsyncMock(return_value=0.0)
        monkeypatch.setattr(svc, "get_starknet_token_balance", balance_mock)

        run(svc.ensure_starknet_deployed(wallet))
        balance_mock.assert_not_awaited()  # direct path never ran

    def test_paymaster_disabled_goes_straight_to_self_paid(self, monkeypatch):
        monkeypatch.setattr(settings, "starknet_paymaster_enabled", False)
        svc = self._wallet_service()
        wallet = MagicMock(address=USER)
        monkeypatch.setattr(svc, "is_starknet_deployed", AsyncMock(return_value=False))
        pm_mock = AsyncMock(return_value=True)
        monkeypatch.setattr(svc, "_deploy_starknet_via_paymaster", pm_mock)
        monkeypatch.setattr(svc, "get_starknet_token_balance", AsyncMock(return_value=0.0))

        with pytest.raises(ValueError, match="STRK"):
            run(svc.ensure_starknet_deployed(wallet))
        pm_mock.assert_not_awaited()

    def test_unavailable_paymaster_returns_false(self, monkeypatch):
        """_deploy_starknet_via_paymaster → False when isAvailable is false."""
        _mock_httpx(monkeypatch, result=False)
        svc = self._wallet_service()
        wallet = MagicMock(address=USER)
        assert run(svc._deploy_starknet_via_paymaster(wallet)) is False

    def test_pick_gas_token_intersects_supported_and_balances(self, monkeypatch):
        _mock_httpx(
            monkeypatch,
            result=[{"token_address": sn.ETH}, {"token_address": sn.USDC}],
        )
        svc = self._wallet_service()

        async def fake_balance(symbol, address):
            return 5.0 if symbol == "USDC" else 0.0

        monkeypatch.setattr(svc, "get_starknet_token_balance", fake_balance)
        # STRK not supported, ETH balance 0 → USDC picked
        assert run(svc._pick_paymaster_gas_token(USER)) == sn.USDC

    def test_pick_gas_token_none_when_no_overlap(self, monkeypatch):
        _mock_httpx(monkeypatch, result=[{"token_address": "0x999"}])
        svc = self._wallet_service()
        monkeypatch.setattr(svc, "get_starknet_token_balance", AsyncMock(return_value=10.0))
        assert run(svc._pick_paymaster_gas_token(USER)) is None


# ---------------------------------------------------------------------------
# swap engine fallback
# ---------------------------------------------------------------------------


class TestSwapEnginePaymasterFallback:
    def _engine(self):
        from bot.services.swap_engine import SwapEngine

        engine = SwapEngine.__new__(SwapEngine)
        engine.wallet_service = MagicMock()
        return engine

    def _quote(self):
        from bot.services.swap_engine import SwapQuote

        return SwapQuote(
            provider="avnu",
            from_chain="starknet",
            to_chain="starknet",
            from_token="STRK",
            to_token="USDC",
            from_amount="1000",
            from_amount_human=1.0,
            to_amount="500",
            to_amount_human=0.5,
            to_amount_min="495",
            gas_cost_usd=0.01,
            fee_cost_usd=0.0,
            total_cost_usd=0.01,
            estimated_time=30,
            price_impact=0.0,
            exchange_rate=0.5,
            raw_quote={
                "quoteId": "q-1",
                "sellAmount": "0x3e8",
                "suwappu_slippage_bps": 50,
            },
            platform_fee_bps=80,
        )

    def test_paymaster_failure_falls_back_to_direct(self, monkeypatch):
        engine = self._engine()
        quote = self._quote()
        wallet = MagicMock(address=USER)
        engine._get_wallet_for_signing = AsyncMock(return_value=wallet)
        engine.wallet_service.is_starknet_deployed = AsyncMock(return_value=True)
        engine.wallet_service.get_starknet_token_balance = AsyncMock(return_value=0.0)
        engine.wallet_service.get_private_key = MagicMock(return_value="0x1")
        engine.wallet_service.ensure_starknet_deployed = AsyncMock()
        engine._execute_avnu_swap_via_paymaster = AsyncMock(side_effect=PaymasterError("down"))

        account = MagicMock(address=int(USER, 16))
        direct = AsyncMock(return_value="0xdirect")
        with (
            patch(
                "bot.services.starknet.client.get_starknet_account",
                AsyncMock(return_value=account),
            ),
            patch("bot.services.avnu_api.avnu_api.execute_swap", direct),
        ):
            tx_hash = run(engine._execute_avnu_swap(quote, {"id": 1}))

        assert tx_hash == "0xdirect"
        direct.assert_awaited_once()
        engine._execute_avnu_swap_via_paymaster.assert_awaited_once()
        engine.wallet_service.ensure_starknet_deployed.assert_awaited_once()

    def test_no_paymaster_when_deployed_with_strk(self, monkeypatch):
        engine = self._engine()
        quote = self._quote()
        wallet = MagicMock(address=USER)
        engine._get_wallet_for_signing = AsyncMock(return_value=wallet)
        engine.wallet_service.is_starknet_deployed = AsyncMock(return_value=True)
        engine.wallet_service.get_starknet_token_balance = AsyncMock(return_value=10.0)
        engine.wallet_service.get_private_key = MagicMock(return_value="0x1")
        engine.wallet_service.ensure_starknet_deployed = AsyncMock()
        pm_mock = AsyncMock(return_value="0xpm")
        engine._execute_avnu_swap_via_paymaster = pm_mock

        account = MagicMock(address=int(USER, 16))
        with (
            patch(
                "bot.services.starknet.client.get_starknet_account",
                AsyncMock(return_value=account),
            ),
            patch("bot.services.avnu_api.avnu_api.execute_swap", AsyncMock(return_value="0xd")),
        ):
            tx_hash = run(engine._execute_avnu_swap(quote, {"id": 1}))

        assert tx_hash == "0xd"
        pm_mock.assert_not_awaited()

    def test_both_paths_failing_surfaces_combined_error(self, monkeypatch):
        from bot.services.swap_engine import SwapError

        engine = self._engine()
        quote = self._quote()
        wallet = MagicMock(address=USER)
        engine._get_wallet_for_signing = AsyncMock(return_value=wallet)
        engine.wallet_service.is_starknet_deployed = AsyncMock(return_value=False)
        engine.wallet_service.get_private_key = MagicMock(return_value="0x1")
        engine.wallet_service.ensure_starknet_deployed = AsyncMock(
            side_effect=ValueError("no STRK")
        )
        engine._execute_avnu_swap_via_paymaster = AsyncMock(side_effect=PaymasterError("down"))

        account = MagicMock(address=int(USER, 16))
        with patch(
            "bot.services.starknet.client.get_starknet_account",
            AsyncMock(return_value=account),
        ):
            with pytest.raises(SwapError, match="paymaster"):
                run(engine._execute_avnu_swap(quote, {"id": 1}))


# ---------------------------------------------------------------------------
# signing (requires starknet_py)
# ---------------------------------------------------------------------------


class TestSignTypedData:
    def test_sign_typed_data_hexifies_signature(self):
        pytest.importorskip("starknet_py")
        account = MagicMock()
        account.sign_message = MagicMock(return_value=[1, 2])
        with patch("starknet_py.utils.typed_data.TypedData") as td_cls:
            td_cls.from_dict.return_value = "TD"
            sig = AvnuPaymaster.sign_typed_data(account, {"types": {}})
        assert sig == ["0x1", "0x2"]
        account.sign_message.assert_called_once_with("TD")
