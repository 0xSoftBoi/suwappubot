"""Wave 2 tests for HyperLiquid perps (#246 EIP-712 signing, #256 asset indices).

#246 is verified by asserting byte-for-byte parity with the reference
``hyperliquid-python-sdk`` signer (no funds / live orders needed). The SDK is a
test-only dependency; the test is skipped if it isn't installed.
"""

import asyncio
import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.hyperliquid_signing import (
    sign_l1_action,
    sign_approve_builder_fee,
)
from bot.services.hyperliquid_client import (
    HyperLiquidClient,
    BUILDER_MIN_ACCOUNT_VALUE_USD,
)

# Well-known throwaway test key (same one the HL SDK uses in its own tests).
PK = "0x0123456789012345678901234567890123456789012345678901234567890123"

ACTIONS = [
    {
        "type": "order",
        "orders": [
            {"a": 0, "b": True, "p": "0", "s": "0.1", "r": False, "t": {"limit": {"tif": "Ioc"}}}
        ],
        "grouping": "na",
    },
    {"type": "cancel", "cancels": [{"a": 1, "o": 123456}]},
    {"type": "updateLeverage", "asset": 2, "isCross": True, "leverage": 5},
]


# --- #246: EIP-712 signing parity with the reference SDK -------------------


@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("is_mainnet", [True, False])
@pytest.mark.parametrize("vault", [None, "0x1234567890123456789012345678901234567890"])
def test_signing_matches_reference_sdk(action, is_mainnet, vault):
    pytest.importorskip("hyperliquid")
    from eth_account import Account
    from hyperliquid.utils.signing import sign_l1_action as sdk_sign

    nonce = 1700000000000
    expected = sdk_sign(Account.from_key(PK), action, vault, nonce, None, is_mainnet)
    actual = sign_l1_action(PK, action, vault, nonce, is_mainnet=is_mainnet)
    assert actual == expected


def test_signature_is_not_a_plain_sha256():
    """Guards against regressing to the old fake-hash signer."""
    sig = sign_l1_action(PK, ACTIONS[0], None, 1700000000000)
    assert sig["v"] in (27, 28)
    assert sig["r"].startswith("0x") and sig["s"].startswith("0x")
    # Old bug sliced one 64-char sha256 hexdigest into r (64) + s (0).
    assert len(sig["s"]) > 2


# --- #256: dynamic asset index resolution ----------------------------------


class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp
        self.calls = 0

    async def post(self, url, json=None):
        self.calls += 1
        if isinstance(self._resp, Exception):
            raise self._resp
        return self._resp


def _client_with(resp):
    hl = HyperLiquidClient()
    fake = _FakeClient(resp)

    async def _get_client():
        return fake

    hl._get_client = _get_client
    return hl, fake


def test_dynamic_index_from_universe():
    universe = {"universe": [{"name": "BTC"}, {"name": "ETH"}, {"name": "HYPE"}]}
    hl, fake = _client_with(_FakeResp(universe))
    assert asyncio.run(hl._resolve_asset_index("HYPE")) == 2
    # A new asset not in the hardcoded fallback resolves correctly.
    assert asyncio.run(hl._resolve_asset_index("ETH")) == 1
    # Cached: only one network call despite multiple lookups.
    assert fake.calls == 1


def test_falls_back_when_fetch_fails():
    hl, _ = _client_with(RuntimeError("network down"))
    # Fallback map still serves known assets.
    assert asyncio.run(hl._resolve_asset_index("ETH")) == 1


def test_unknown_asset_raises_not_btc():
    hl, _ = _client_with(_FakeResp({"universe": [{"name": "BTC"}]}))
    with pytest.raises(ValueError):
        asyncio.run(hl._resolve_asset_index("NOTACOIN"))


# --- Builder codes: approveBuilderFee signing ------------------------------

BUILDER = "0xAbC0000000000000000000000000000000000123"


def test_approve_builder_fee_action_shape():
    action, sig = sign_approve_builder_fee(PK, BUILDER, "0.1%", 1700000000000)
    assert action["type"] == "approveBuilderFee"
    assert action["maxFeeRate"] == "0.1%"
    # Builder address is lowercased so it matches the per-order builder field.
    assert action["builder"] == BUILDER.lower()
    assert action["nonce"] == 1700000000000
    assert action["hyperliquidChain"] == "Mainnet"
    assert action["signatureChainId"] == "0xa4b1"
    assert sig["v"] in (27, 28)
    assert sig["r"].startswith("0x") and len(sig["s"]) > 2


def test_approve_builder_fee_signature_recovers_signer():
    """The user-signed action must recover to the signing account address."""
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    from bot.services.hyperliquid_signing import (
        _user_signed_payload,
        _APPROVE_BUILDER_FEE_SIGN_TYPES,
    )

    action, sig = sign_approve_builder_fee(PK, BUILDER, "0.1%", 1700000000000)
    payload = _user_signed_payload(
        "HyperliquidTransaction:ApproveBuilderFee",
        _APPROVE_BUILDER_FEE_SIGN_TYPES,
        action,
    )
    signable = encode_typed_data(full_message=payload)
    recovered = Account.recover_message(
        signable, vrs=(sig["v"], int(sig["r"], 16), int(sig["s"], 16))
    )
    assert recovered.lower() == Account.from_key(PK).address.lower()


def test_testnet_flag_sets_chain():
    action, _ = sign_approve_builder_fee(PK, BUILDER, "0.05%", 1, is_mainnet=False)
    assert action["hyperliquidChain"] == "Testnet"


# --- Builder codes: order attaches builder field ---------------------------


def test_order_attaches_builder_field():
    hl, _ = _client_with(_FakeResp({"universe": [{"name": "BTC"}, {"name": "ETH"}]}))
    captured = {}

    async def _fake_post(url, json=None, headers=None):
        captured.update(json or {})
        return _FakeResp(
            {
                "response": {
                    "data": {"statuses": [{"filled": {"oid": 1, "avgPx": "100", "totalSz": "0.1"}}]}
                }
            }
        )

    async def _noop_leverage(*a, **k):
        return None

    # Patch the network + leverage so we can inspect the signed action.
    client_stub = type("C", (), {"post": staticmethod(_fake_post)})()

    async def _get_client():
        return client_stub

    hl._get_client = _get_client
    hl._set_leverage = _noop_leverage

    asyncio.run(
        hl.place_order(
            address="0xUser",
            api_key="k",
            api_secret=PK,
            market="ETH-USD",
            side="long",
            size=0.1,
            leverage=1,
            builder_address=BUILDER,
            builder_fee_tenths_bps=10,
        )
    )

    builder = captured["action"]["builder"]
    assert builder["b"] == BUILDER.lower()
    assert builder["f"] == 10


def test_order_omits_builder_when_unset():
    hl, _ = _client_with(_FakeResp({"universe": [{"name": "BTC"}, {"name": "ETH"}]}))
    captured = {}

    async def _fake_post(url, json=None, headers=None):
        captured.update(json or {})
        return _FakeResp(
            {
                "response": {
                    "data": {"statuses": [{"filled": {"oid": 1, "avgPx": "100", "totalSz": "0.1"}}]}
                }
            }
        )

    async def _noop_leverage(*a, **k):
        return None

    client_stub = type("C", (), {"post": staticmethod(_fake_post)})()

    async def _get_client():
        return client_stub

    hl._get_client = _get_client
    hl._set_leverage = _noop_leverage

    asyncio.run(
        hl.place_order(
            address="0xUser",
            api_key="k",
            api_secret=PK,
            market="ETH-USD",
            side="long",
            size=0.1,
            leverage=1,
        )
    )

    assert "builder" not in captured["action"]


# --- Builder codes: 100 USDC account-value eligibility ---------------------


def test_builder_eligibility_below_threshold():
    payload = {"marginSummary": {"accountValue": "40"}}
    hl, _ = _client_with(_FakeResp(payload))
    result = asyncio.run(hl.check_builder_eligibility(BUILDER))
    assert result["account_value_usd"] == 40.0
    assert result["required_usd"] == BUILDER_MIN_ACCOUNT_VALUE_USD == 100.0
    assert result["eligible"] is False
    assert result["remaining_usd"] == 60.0


def test_builder_eligibility_met():
    payload = {"marginSummary": {"accountValue": "150"}}
    hl, _ = _client_with(_FakeResp(payload))
    result = asyncio.run(hl.check_builder_eligibility(BUILDER))
    assert result["account_value_usd"] == 150.0
    assert result["eligible"] is True
    assert result["remaining_usd"] == 0.0


def test_claim_rewards_signs_l1_action():
    captured = {}

    async def _fake_post(url, json=None, headers=None):
        captured.update(json or {})
        return _FakeResp({"status": "ok"})

    client_stub = type("C", (), {"post": staticmethod(_fake_post)})()
    hl = HyperLiquidClient()

    async def _get_client():
        return client_stub

    hl._get_client = _get_client

    ok = asyncio.run(hl.claim_rewards(PK))
    assert ok is True
    assert captured["action"] == {"type": "claimRewards"}
    # Signed as an L1 action -> recoverable r/s/v signature.
    assert captured["signature"]["v"] in (27, 28)
