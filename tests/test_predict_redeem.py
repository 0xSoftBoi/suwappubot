"""Tests for on-chain redemption of resolved Polymarket winners.

Money-path logic only, fully mocked (no live RPC / no funds): we exercise
``PolymarketClient._redeem_position_sync`` to prove it (1) refuses to spend gas
on an unresolved market, (2) routes neg-risk vs plain-CTF markets to the right
contract with the right ``redeemPositions`` arguments, and (3) surfaces an
insufficient-MATIC gas failure cleanly.
"""

import os
from unittest.mock import patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.services.polymarket_api import (  # noqa: E402
    PolymarketClient,
    CTF_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
)

CONDITION_ID = "0x" + "ab" * 32
WALLET_ADDR = "0x" + "11" * 20


class _Wallet:
    address = WALLET_ADDR


class _MockFn:
    def build_transaction(self, params):
        return dict(params)


class _MockContract:
    def __init__(self, recorder):
        self._recorder = recorder

        class _Fns:
            def redeemPositions(_self, *args):
                recorder["redeem_args"] = args
                return _MockFn()

        self.functions = _Fns()


class _MockEth:
    def __init__(self, recorder, gas_raises=False):
        self._recorder = recorder
        self._gas_raises = gas_raises
        self.gas_price = 30_000_000_000

    def contract(self, address=None, abi=None):
        self._recorder["contract_address"] = address
        return _MockContract(self._recorder)

    def get_transaction_count(self, addr):
        return 7

    def estimate_gas(self, tx):
        if self._gas_raises:
            raise Exception("insufficient funds for gas * price + value")
        return 100_000

    def send_raw_transaction(self, raw):
        class _H:
            def hex(self_inner):
                return "0x" + "cd" * 32

        return _H()

    def wait_for_transaction_receipt(self, tx_hash, timeout=180):
        return {"status": 1}


class _MockWeb3:
    def __init__(self, recorder, gas_raises=False):
        self.eth = _MockEth(recorder, gas_raises=gas_raises)


def _client():
    return PolymarketClient()


def test_refuses_redeem_when_unresolved():
    """Never broadcast a redeem for a market that isn't resolved on-chain."""
    client = _client()
    with patch.object(client, "is_resolved_onchain", return_value=False):
        result = client._redeem_position_sync(_Wallet(), CONDITION_ID, neg_risk=False)
    assert result.success is False
    assert result.error_category == "not_resolved"


def test_plain_ctf_branch_uses_ctf_contract_and_index_sets():
    client = _client()
    recorder = {}
    with (
        patch.object(client, "is_resolved_onchain", return_value=True),
        patch.object(client, "_get_polygon_web3", return_value=_MockWeb3(recorder)),
        patch.object(client, "_sign_evm_tx", return_value=b"\x01"),
    ):
        result = client._redeem_position_sync(_Wallet(), CONDITION_ID, neg_risk=False)
    assert result.success is True
    assert result.tx_hash.startswith("0x")
    assert recorder["contract_address"].lower() == CTF_ADDRESS.lower()
    # Plain CTF: redeemPositions(collateral, parentCollectionId, conditionId, [1, 2]).
    assert recorder["redeem_args"][-1] == [1, 2]


def test_neg_risk_branch_uses_adapter_contract():
    client = _client()
    recorder = {}
    with (
        patch.object(client, "is_resolved_onchain", return_value=True),
        patch.object(client, "_get_polygon_web3", return_value=_MockWeb3(recorder)),
        patch.object(client, "_sign_evm_tx", return_value=b"\x01"),
    ):
        result = client._redeem_position_sync(_Wallet(), CONDITION_ID, neg_risk=True)
    assert result.success is True
    assert recorder["contract_address"].lower() == NEG_RISK_ADAPTER_ADDRESS.lower()


def test_insufficient_gas_is_reported_cleanly():
    client = _client()
    recorder = {}
    with (
        patch.object(client, "is_resolved_onchain", return_value=True),
        patch.object(
            client, "_get_polygon_web3", return_value=_MockWeb3(recorder, gas_raises=True)
        ),
        patch.object(client, "_sign_evm_tx", return_value=b"\x01"),
    ):
        result = client._redeem_position_sync(_Wallet(), CONDITION_ID, neg_risk=False)
    assert result.success is False
    assert result.error_category == "insufficient_gas"
