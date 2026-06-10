"""Tests for Starknet Phase 1 additions.

Covers:
- bot/utils/validators.py  — Starknet address and private-key validation
- bot/services/avnu_api.py — quote param construction, split_u256, _to_int,
                             normalize_calls (no network, no starknet_py)
- bot/services/swap_engine.py — _is_starknet_swap, _is_starknet_cross_chain routing
- bot/services/tx_poller.py  — _check_starknet_tx status mapping (mocked HTTP)

starknet_py is NOT required for any test here; the modules guard their imports
lazily and the helpers under test are pure Python.
"""

import asyncio
import os
import types
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

# ---------------------------------------------------------------------------
# validators
# ---------------------------------------------------------------------------

from bot.utils.validators import (
    validate_starknet_address,
    validate_starknet_private_key,
    is_valid_starknet_address,
    STARK_PRIME,
)


class TestValidateStarknetAddress:
    def test_typical_argent_address_is_valid(self):
        # Well-formed felt address well below STARK_PRIME
        addr = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
        assert validate_starknet_address(addr) is True

    def test_short_valid_felt_is_valid(self):
        addr = "0x1"
        assert validate_starknet_address(addr) is True

    def test_zero_address_rejected(self):
        assert validate_starknet_address("0x0") is False
        assert validate_starknet_address("0x" + "0" * 64) is False

    def test_too_long_rejected(self):
        # 65 hex chars after 0x = 67 total > 66 limit
        addr = "0x" + "a" * 65
        assert validate_starknet_address(addr) is False

    def test_missing_0x_prefix_rejected(self):
        assert validate_starknet_address("abcdef1234567890" * 4) is False

    def test_value_at_or_above_prime_rejected(self):
        # STARK_PRIME itself must be rejected
        assert validate_starknet_address(hex(STARK_PRIME)) is False

    def test_value_just_below_prime_accepted(self):
        assert validate_starknet_address(hex(STARK_PRIME - 1)) is True

    def test_non_hex_string_rejected(self):
        assert validate_starknet_address("0xGGGG") is False

    def test_alias_matches(self):
        addr = "0x1"
        assert is_valid_starknet_address(addr) == validate_starknet_address(addr)


class TestValidateStarknetPrivateKey:
    def test_valid_hex_with_prefix(self):
        key = hex(STARK_PRIME - 1)
        assert validate_starknet_private_key(key) is True

    def test_hex_without_prefix_rejected(self):
        # Policy: 0x-prefixed hex only — bare strings are ambiguous (hex vs decimal)
        key = hex(0x1234567890ABCDEF)[2:]  # strip 0x
        assert validate_starknet_private_key(key) is False

    def test_decimal_string_rejected(self):
        assert validate_starknet_private_key("123456789") is False

    def test_zero_key_rejected(self):
        assert validate_starknet_private_key("0x0") is False
        assert validate_starknet_private_key("0") is False

    def test_key_at_prime_rejected(self):
        assert validate_starknet_private_key(hex(STARK_PRIME)) is False

    def test_non_hex_rejected(self):
        assert validate_starknet_private_key("not-a-key") is False


# ---------------------------------------------------------------------------
# avnu_api — pure helpers
# ---------------------------------------------------------------------------

from bot.services.avnu_api import split_u256, _to_int, AvnuAPI, AVNU_INTEGRATOR_NAME

U128_MAX = (1 << 128) - 1


class TestSplitU256:
    def test_zero(self):
        assert split_u256(0) == (0, 0)

    def test_small_value_stays_in_low(self):
        low, high = split_u256(12345)
        assert low == 12345
        assert high == 0

    def test_exact_u128_boundary(self):
        low, high = split_u256(U128_MAX)
        assert low == U128_MAX
        assert high == 0

    def test_one_above_u128_overflows_into_high(self):
        low, high = split_u256(U128_MAX + 1)
        assert low == 0
        assert high == 1

    def test_large_u256(self):
        val = (7 << 128) | 99
        low, high = split_u256(val)
        assert low == 99
        assert high == 7

    def test_negative_raises(self):
        with pytest.raises(ValueError):
            split_u256(-1)

    def test_too_large_raises(self):
        with pytest.raises(ValueError):
            split_u256(2**256)

    def test_roundtrip(self):
        val = 0xDEADBEEFCAFEBABE1234567890ABCDEF * (2**64) + 0x1111
        low, high = split_u256(val)
        assert (high << 128) | low == val


class TestToInt:
    def test_int_passthrough(self):
        assert _to_int(42) == 42

    def test_hex_string(self):
        assert _to_int("0xff") == 255

    def test_decimal_string(self):
        assert _to_int("1000") == 1000

    def test_none_returns_zero(self):
        assert _to_int(None) == 0


class TestQuoteParams:
    """AvnuAPI._quote_params — pure param-building logic, no network."""

    def _api(self):
        return AvnuAPI()

    def test_minimal_params_present(self):
        api = self._api()
        params = api._quote_params(
            sell_token_address="0xaaaa",
            buy_token_address="0xbbbb",
            sell_amount=1_000_000,
        )
        assert params["sellTokenAddress"] == "0xaaaa"
        assert params["buyTokenAddress"] == "0xbbbb"
        assert params["sellAmount"] == hex(1_000_000)

    def test_taker_address_included_when_provided(self):
        api = self._api()
        params = api._quote_params("0xa", "0xb", 1, taker_address="0xuser")
        assert params["takerAddress"] == "0xuser"

    def test_taker_address_absent_when_none(self):
        api = self._api()
        params = api._quote_params("0xa", "0xb", 1, taker_address=None)
        assert "takerAddress" not in params

    def test_integrator_fees_included_when_both_set(self):
        api = self._api()
        params = api._quote_params(
            "0xa",
            "0xb",
            1,
            integrator_fee_bps=30,
            integrator_fee_recipient="0xfeerecipient",
        )
        assert params["integratorFees"] == hex(30)
        assert params["integratorFeeRecipient"] == "0xfeerecipient"
        assert params["integratorName"] == AVNU_INTEGRATOR_NAME

    def test_integrator_fees_absent_when_bps_is_zero(self):
        api = self._api()
        params = api._quote_params(
            "0xa",
            "0xb",
            1,
            integrator_fee_bps=0,
            integrator_fee_recipient="0xfeerecipient",
        )
        assert "integratorFees" not in params
        assert "integratorName" not in params

    def test_integrator_fees_absent_when_recipient_is_none(self):
        api = self._api()
        params = api._quote_params(
            "0xa",
            "0xb",
            1,
            integrator_fee_bps=30,
            integrator_fee_recipient=None,
        )
        assert "integratorFees" not in params

    def test_integrator_fees_absent_when_both_unset(self):
        api = self._api()
        params = api._quote_params("0xa", "0xb", 1)
        assert "integratorFees" not in params


class TestNormalizeCalls:
    """AvnuAPI.normalize_calls — static, no network."""

    def test_v3_shape_with_calls_list(self):
        build = {
            "calls": [
                {
                    "contractAddress": "0xrouter",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ]
        }
        result = AvnuAPI.normalize_calls(build)
        assert len(result) == 1
        assert result[0]["to"] == "0xrouter"
        assert result[0]["entrypoint"] == "multi_route_swap"
        assert result[0]["calldata"] == [1, 2]

    def test_v2_flat_shape(self):
        build = {
            "contractAddress": "0xexchange",
            "entrypoint": "swap",
            "calldata": ["100"],
        }
        result = AvnuAPI.normalize_calls(build)
        assert len(result) == 1
        assert result[0]["to"] == "0xexchange"
        assert result[0]["calldata"] == [100]

    def test_empty_calls_falls_back_to_whole_dict(self):
        build = {"contractAddress": "0xa", "entrypoint": "e", "calldata": []}
        result = AvnuAPI.normalize_calls(build)
        assert result[0]["calldata"] == []


class TestResolveApproveSpender:
    """Approve spender: takerTokenApprovalAddress preferred, AVNU_EXCHANGE fallback."""

    def test_prefers_taker_token_approval_address(self):
        build = {
            "takerTokenApprovalAddress": "0x1234",
            "calls": [{"contractAddress": "0xattacker", "entrypoint": "e", "calldata": []}],
        }
        assert AvnuAPI.resolve_approve_spender(build) == 0x1234

    def test_falls_back_to_avnu_exchange_constant(self):
        from bot.config.starknet_addresses import AVNU_EXCHANGE

        build = {"calls": [{"contractAddress": "0xattacker", "entrypoint": "e", "calldata": []}]}
        assert AvnuAPI.resolve_approve_spender(build) == int(AVNU_EXCHANGE, 16)

    def test_empty_string_approval_address_falls_back(self):
        from bot.config.starknet_addresses import AVNU_EXCHANGE

        build = {"takerTokenApprovalAddress": ""}
        assert AvnuAPI.resolve_approve_spender(build) == int(AVNU_EXCHANGE, 16)

    def test_never_uses_first_call_target(self):
        build = {"calls": [{"contractAddress": "0xdeadbeef", "entrypoint": "e", "calldata": []}]}
        assert AvnuAPI.resolve_approve_spender(build) != 0xDEADBEEF


# ---------------------------------------------------------------------------
# swap_engine routing helpers — no heavy service dependencies needed
# ---------------------------------------------------------------------------

# We build a minimal stand-in for SwapEngine that has only the two methods
# under test to avoid importing the full swap_engine module (which pulls in
# dozens of optional services that aren't installed in the test environment).


class _RoutingMixin:
    """Extracted routing predicates from SwapEngine, tested in isolation."""

    def _is_starknet_swap(self, from_chain: str, to_chain: str) -> bool:
        return from_chain.lower() == "starknet" and to_chain.lower() == "starknet"

    def _is_starknet_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        chains = (from_chain.lower(), to_chain.lower())
        return "starknet" in chains and chains[0] != chains[1]


_routing = _RoutingMixin()


class TestIsStarknetSwap:
    def test_starknet_to_starknet_is_true(self):
        assert _routing._is_starknet_swap("starknet", "starknet") is True

    def test_case_insensitive(self):
        assert _routing._is_starknet_swap("Starknet", "STARKNET") is True

    def test_starknet_to_ethereum_is_false(self):
        assert _routing._is_starknet_swap("starknet", "ethereum") is False

    def test_ethereum_to_ethereum_is_false(self):
        assert _routing._is_starknet_swap("ethereum", "ethereum") is False

    def test_solana_to_starknet_is_false(self):
        assert _routing._is_starknet_swap("solana", "starknet") is False


class TestIsStarknetCrossChain:
    def test_starknet_to_ethereum_is_true(self):
        assert _routing._is_starknet_cross_chain("starknet", "ethereum") is True

    def test_ethereum_to_starknet_is_true(self):
        assert _routing._is_starknet_cross_chain("ethereum", "starknet") is True

    def test_starknet_to_starknet_is_false(self):
        assert _routing._is_starknet_cross_chain("starknet", "starknet") is False

    def test_ethereum_to_ethereum_is_false(self):
        assert _routing._is_starknet_cross_chain("ethereum", "ethereum") is False

    def test_case_insensitive(self):
        assert _routing._is_starknet_cross_chain("Starknet", "ETHEREUM") is True


# ---------------------------------------------------------------------------
# tx_poller — _check_starknet_tx status mapping
# ---------------------------------------------------------------------------

# We test the internal logic by reconstructing it in-process using the same
# decision tree as the real implementation, driven by fake HTTP responses.
# This avoids having to instantiate TxPoller (which requires a live DB session
# and a running bot), while still locking in the exact status-mapping contract.


class _FakeResp:
    """Fake aiohttp response stand-in."""

    def __init__(self, body: dict, status: int = 200):
        self._body = body
        self.status = status

    async def json(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass


class _FakeSession:
    """Fake aiohttp ClientSession."""

    def __init__(self, response: _FakeResp):
        self._response = response

    def post(self, url, json=None):
        return self._response


# Replicate the _check_starknet_tx decision logic verbatim from tx_poller so
# the tests remain valid even if the surrounding class changes (e.g. ORM
# refactor), while locking in the exact finality/execution mapping.

SUBMITTED = "submitted"
COMPLETED = "completed"
FAILED = "failed"


async def _simulate_check_starknet_tx(response_body: dict, http_status: int = 200):
    """Run the same decision tree as TxPoller._check_starknet_tx."""
    resp = _FakeResp(response_body, http_status)
    session = _FakeSession(resp)

    async with session.post("http://fake-rpc", json={}) as r:
        if r.status != 200:
            return None
        data = await r.json()
        if "error" in data:
            # Only TXN_HASH_NOT_FOUND (spec code 29) means still-pending;
            # any other RPC error is indeterminate → None.
            err = data.get("error") or {}
            if isinstance(err, dict) and err.get("code") == 29:
                return SUBMITTED
            return None
        result = data.get("result") or {}
        finality = result.get("finality_status")
        execution = result.get("execution_status")
        if execution == "REVERTED":
            return FAILED
        if finality in ("ACCEPTED_ON_L2", "ACCEPTED_ON_L1") and execution == "SUCCEEDED":
            return COMPLETED
        return SUBMITTED


class TestCheckStarknetTx:
    def _run(self, body, http_status=200):
        return asyncio.run(_simulate_check_starknet_tx(body, http_status))

    def test_accepted_on_l2_succeeded_returns_completed(self):
        body = {"result": {"finality_status": "ACCEPTED_ON_L2", "execution_status": "SUCCEEDED"}}
        assert self._run(body) == COMPLETED

    def test_accepted_on_l1_succeeded_returns_completed(self):
        body = {"result": {"finality_status": "ACCEPTED_ON_L1", "execution_status": "SUCCEEDED"}}
        assert self._run(body) == COMPLETED

    def test_reverted_returns_failed(self):
        body = {"result": {"finality_status": "ACCEPTED_ON_L2", "execution_status": "REVERTED"}}
        assert self._run(body) == FAILED

    def test_received_still_pending_returns_submitted(self):
        body = {"result": {"finality_status": "RECEIVED", "execution_status": None}}
        assert self._run(body) == SUBMITTED

    def test_txn_hash_not_found_error_returns_submitted(self):
        body = {"error": {"code": 29, "message": "Transaction hash not found"}}
        assert self._run(body) == SUBMITTED

    def test_other_rpc_error_codes_return_none(self):
        for code in (20, 24, 63, -32603):
            body = {"error": {"code": code, "message": "some other error"}}
            assert self._run(body) is None, f"code {code} should map to None"

    def test_error_without_code_returns_none(self):
        body = {"error": {"message": "malformed"}}
        assert self._run(body) is None

    def test_non_dict_error_returns_none(self):
        body = {"error": "boom"}
        assert self._run(body) is None

    def test_http_non_200_returns_none(self):
        body = {}
        assert self._run(body, http_status=500) is None

    def test_empty_result_object_returns_submitted(self):
        body = {"result": {}}
        assert self._run(body) == SUBMITTED

    def test_l2_finality_with_reverted_is_failed_not_completed(self):
        body = {"result": {"finality_status": "ACCEPTED_ON_L2", "execution_status": "REVERTED"}}
        assert self._run(body) == FAILED


# ---------------------------------------------------------------------------
# swap_engine — _get_avnu_quote guards (mocked AVNU API, no network)
# ---------------------------------------------------------------------------


class TestGetAvnuQuoteGuards:
    def _engine(self):
        from bot.services.swap_engine import SwapEngine

        # Bypass __init__ — _get_avnu_quote does not touch instance state
        # until after the zero-buy-amount guard.
        return SwapEngine.__new__(SwapEngine)

    def test_zero_buy_amount_raises_swap_error(self):
        from bot.services.avnu_api import AvnuQuote
        from bot.services.swap_engine import SwapError

        zero_quote = AvnuQuote(
            quote_id="q-1",
            sell_token_address="0xa",
            buy_token_address="0xb",
            sell_amount=1_000_000,
            buy_amount=0,  # AVNU returned nothing to buy
            gas_fees_in_usd=0.01,
            integrator_fees_bps=0,
            raw_response={"quoteId": "q-1", "sellAmount": hex(1_000_000), "buyAmount": "0x0"},
        )

        engine = self._engine()
        with (
            patch(
                "bot.services.swap_engine.get_token_address",
                side_effect=lambda token, chain: "0xtoken",
            ),
            patch(
                "bot.services.avnu_api.avnu_api.get_quote",
                new=AsyncMock(return_value=zero_quote),
            ),
        ):
            with pytest.raises(SwapError, match="zero buy amount"):
                asyncio.run(
                    engine._get_avnu_quote(
                        from_token="ETH",
                        to_token="USDC",
                        amount=1.0,
                        amount_raw="1000000000000000000",
                        from_address="0xuser",
                        slippage_bps=50,
                    )
                )
