"""Tests for bot/services/superstate_service.py and the Superstate gated-token
UX surfaces it feeds (swap_engine guard message, error_guidance classification).

No network — the web3 contract layer is mocked (contract.functions.X().call()),
following the mocking convention in tests/test_defi_protocols.py.
"""

from unittest.mock import MagicMock, patch

import pytest

from bot.services.superstate_service import SuperstateService, SuperstateError
from bot.services.swap_engine import SwapEngine
from bot.utils.exceptions import SwapError
from bot.services.error_guidance import classify_swap_failure, CAT_ALLOWLIST_GATED


def _mock_contract(is_allowed=None, paused=None, decimals=6, name="Test Fund", w3_addr="0xabc"):
    """Build a MagicMock standing in for w3.eth.contract(...)."""
    contract = MagicMock()
    contract.w3.to_checksum_address = lambda a: a

    def _fn(value, raise_exc=False):
        fn = MagicMock()
        if raise_exc:
            fn.call.side_effect = RuntimeError("rpc down")
        else:
            fn.call.return_value = value
        return fn

    contract.functions.isAllowed.return_value = (
        _fn(None, raise_exc=True) if is_allowed is None else _fn(is_allowed)
    )
    contract.functions.accountingPaused.return_value = (
        _fn(None, raise_exc=True) if paused is None else _fn(paused)
    )
    contract.functions.decimals.return_value = _fn(decimals)
    contract.functions.name.return_value = _fn(name)
    return contract


class TestIsAllowlisted:
    def test_returns_true_on_1_result(self):
        svc = SuperstateService()
        with patch.object(svc, "_contract", return_value=_mock_contract(is_allowed=True)):
            assert svc.is_allowlisted("USTB", "0x589254a1a3d8AE95ce984900d505D91Fd3eD167e") is True

    def test_returns_false_on_0_result(self):
        svc = SuperstateService()
        with patch.object(svc, "_contract", return_value=_mock_contract(is_allowed=False)):
            assert svc.is_allowlisted("USTB", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045") is False

    def test_returns_none_on_rpc_error_not_false(self):
        """A failed read must be indistinguishable from 'unknown', never a
        definitive block — this is the security-relevant assertion."""
        svc = SuperstateService()
        with patch.object(svc, "_contract", side_effect=RuntimeError("connection refused")):
            result = svc.is_allowlisted("USTB", "0x0000000000000000000000000000000000dEaD")
        assert result is None
        assert result is not False

    def test_unknown_symbol_returns_none(self):
        svc = SuperstateService()
        assert (
            svc.is_allowlisted("NOTAREALFUND", "0x0000000000000000000000000000000000dEaD") is None
        )

    def test_result_is_cached(self):
        svc = SuperstateService()
        contract = _mock_contract(is_allowed=True)
        with patch.object(svc, "_contract", return_value=contract) as mocked:
            svc.is_allowlisted("USTB", "0x589254a1a3d8AE95ce984900d505D91Fd3eD167e")
            svc.is_allowlisted("USTB", "0x589254a1a3d8AE95ce984900d505D91Fd3eD167e")
        assert mocked.call_count == 1


class TestGetFundStatus:
    def test_parses_paused_decimals_name(self):
        svc = SuperstateService()
        contract = _mock_contract(paused=False, decimals=6, name="Invesco Short Duration Fund")
        with patch.object(svc, "_contract", return_value=contract):
            status = svc.get_fund_status("USTB")
        assert status["accounting_paused"] is False
        assert status["decimals"] == 6
        assert status["onchain_name"] == "Invesco Short Duration Fund"

    def test_unknown_symbol_raises(self):
        svc = SuperstateService()
        with pytest.raises(SuperstateError):
            svc.get_fund_status("NOTAREALFUND")

    def test_partial_failure_leaves_none_fields(self):
        svc = SuperstateService()
        contract = _mock_contract(paused=None, decimals=6, name="Bitwise Crypto Carry Fund")
        with patch.object(svc, "_contract", return_value=contract):
            status = svc.get_fund_status("USCC")
        assert status["accounting_paused"] is None
        assert status["decimals"] == 6

    def test_status_is_cached(self):
        svc = SuperstateService()
        contract = _mock_contract(paused=False, decimals=6, name="X")
        with patch.object(svc, "_contract", return_value=contract) as mocked:
            svc.get_fund_status("USTB")
            svc.get_fund_status("USTB")
        assert mocked.call_count == 1


class TestSwapEngineGuardCannotBeBypassed:
    """The security-relevant test: the guard refuses USTB/USCC unconditionally
    and never consults an allowlist read — mocking is_allowlisted to True must
    NOT let a gated swap through."""

    def _engine(self) -> SwapEngine:
        return SwapEngine.__new__(SwapEngine)

    def test_guard_raises_for_ustb_regardless_of_mocked_allowlist(self):
        engine = self._engine()
        with patch(
            "bot.services.superstate_service.superstate_service.is_allowlisted",
            return_value=True,
        ):
            with pytest.raises(SwapError):
                engine._assert_not_gated("USTB", "USDC", "ethereum", "ethereum")

    def test_guard_raises_for_uscc(self):
        engine = self._engine()
        with pytest.raises(SwapError):
            engine._assert_not_gated("USDC", "USCC", "ethereum", "ethereum")

    def test_guard_message_names_fund_and_superstate(self):
        engine = self._engine()
        with pytest.raises(SwapError) as exc_info:
            engine._assert_not_gated("USTB", "USDC", "ethereum", "ethereum")
        message = str(exc_info.value)
        assert "USTB" in message
        assert "superstate.co" in message.lower()
        assert "kyc" in message.lower() or "allowlist" in message.lower()

    def test_guard_does_not_import_superstate_service(self):
        """The guard must stay cheap/synchronous in the hot quote path — it
        must never perform a blocking RPC call itself."""
        import inspect

        from bot.services import swap_engine as swap_engine_module

        source = inspect.getsource(swap_engine_module.SwapEngine._assert_not_gated)
        assert "import superstate_service" not in source
        assert ".is_allowlisted(" not in source
        assert "asyncio" not in source
        assert "to_thread" not in source


class TestErrorGuidanceClassification:
    def test_gated_message_classified_as_allowlist_gated(self):
        guidance = classify_swap_failure(
            "USTB (Invesco Short Duration US Government Securities Fund) is "
            "allowlist-gated: Superstate allowlist — transfers revert unless "
            "the wallet is KYC-allowlisted with Superstate. See superstate.co/ustb",
            {"from_token": "USTB"},
        )
        assert guidance.category == CAT_ALLOWLIST_GATED
        assert "kyc" in guidance.explanation.lower() or "allowlist" in guidance.explanation.lower()

    def test_gated_message_not_misclassified_as_simulation_revert(self):
        # The gated message contains "revert", which would otherwise match
        # the generic simulation-revert substring rule.
        guidance = classify_swap_failure(
            "USTB is allowlist-gated: transfers revert for non-allowlisted wallets.",
            {"from_token": "USTB"},
        )
        assert guidance.category == CAT_ALLOWLIST_GATED

    def test_gated_explanation_surfaces_protocol_via_get_protocol_for_token(self):
        """get_protocol_for_token was dead code — this is its live consumer."""
        guidance = classify_swap_failure(
            "USTB is allowlist-gated: transfers revert for non-allowlisted wallets.",
            {"from_token": "USTB"},
        )
        assert "superstate" in guidance.explanation.lower()
        assert "superstate.co" in guidance.explanation.lower()
