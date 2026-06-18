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
    float_to_wire,
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
    assert action["signatureChainId"] == "0x66eee"
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

    async def _mid(_market):
        return 2000.0

    hl.get_mark_price = _mid  # market order needs a mid to cross the book

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

    async def _mid(_market):
        return 2000.0

    hl.get_mark_price = _mid

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


# --- Ecosystem: TWAP, vaults, referrals, staking ---------------------------


def _capturing_client():
    """A HyperLiquidClient whose POSTs are captured (accepts headers kwarg)."""
    captured = {}

    async def _fake_post(url, json=None, headers=None):
        captured.update(json or {})
        captured["_url"] = url
        # Provide a response shape that satisfies every method under test.
        return _FakeResp(
            {
                "status": "ok",
                "response": {"data": {"status": {"running": {"twapId": 77}}}},
            }
        )

    client_stub = type("C", (), {"post": staticmethod(_fake_post)})()
    hl = HyperLiquidClient()

    async def _get_client():
        return client_stub

    hl._get_client = _get_client
    # Avoid a real /info universe fetch for asset index resolution.
    hl._asset_index_cache = {"BTC": 0, "ETH": 1, "HYPE": 2}
    hl._asset_index_fetched_at = 9_999_999_999.0
    return hl, captured


def test_twap_order_action_shape():
    hl, cap = _capturing_client()
    twap_id = asyncio.run(
        hl.place_twap_order("0xUser", "k", PK, "BTC", "long", 0.05, 30, randomize=True)
    )
    assert twap_id == "77"
    twap = cap["action"]["twap"]
    assert cap["action"]["type"] == "twapOrder"
    assert twap == {"a": 0, "b": True, "s": "0.05", "r": False, "m": 30, "t": True}
    assert cap["signature"]["v"] in (27, 28)


def test_twap_cancel_action_shape():
    hl, cap = _capturing_client()
    ok = asyncio.run(hl.cancel_twap("0xUser", "k", PK, "ETH", 77))
    assert ok is True
    assert cap["action"] == {"type": "twapCancel", "a": 1, "t": 77}


def test_vault_transfer_converts_usd_to_micros():
    hl, cap = _capturing_client()
    vault = "0x1234567890123456789012345678901234567890"
    ok = asyncio.run(hl.vault_transfer(PK, vault, True, 12.5))
    assert ok is True
    assert cap["action"] == {
        "type": "vaultTransfer",
        "vaultAddress": vault,
        "isDeposit": True,
        "usd": 12_500_000,
    }
    assert cap["signature"]["v"] in (27, 28)


def test_set_referrer_action_shape():
    hl, cap = _capturing_client()
    ok = asyncio.run(hl.set_referrer(PK, "SUWAPPU"))
    assert ok is True
    assert cap["action"] == {"type": "setReferrer", "code": "SUWAPPU"}
    assert cap["signature"]["v"] in (27, 28)


def test_hype_to_wei():
    from bot.services.hyperliquid_client import hype_to_wei

    assert hype_to_wei(1) == 100_000_000
    assert hype_to_wei(2.5) == 250_000_000


def test_token_delegate_is_user_signed():
    hl, cap = _capturing_client()
    validator = "0x" + "ab" * 20
    ok = asyncio.run(hl.delegate_stake(PK, validator, 1.0, is_undelegate=False))
    assert ok is True
    action = cap["action"]
    assert action["type"] == "tokenDelegate"
    assert action["validator"] == validator
    assert action["wei"] == 100_000_000
    assert action["isUndelegate"] is False
    # User-signed actions carry the chain markers (matching the reference SDK).
    assert action["signatureChainId"] == "0x66eee"
    assert action["hyperliquidChain"] == "Mainnet"
    assert cap["signature"]["v"] in (27, 28)


def test_staking_transfer_cdeposit_vs_cwithdraw():
    hl, cap = _capturing_client()
    asyncio.run(hl.staking_transfer(PK, 3.0, is_deposit=True))
    assert cap["action"]["type"] == "cDeposit"
    assert cap["action"]["wei"] == 300_000_000

    hl2, cap2 = _capturing_client()
    asyncio.run(hl2.staking_transfer(PK, 3.0, is_deposit=False))
    assert cap2["action"]["type"] == "cWithdraw"


def test_token_delegate_matches_reference_sdk():
    """Byte-parity for the user-signed staking signature, when the SDK is present."""
    pytest.importorskip("hyperliquid")
    from eth_account import Account
    from hyperliquid.utils import signing as sdk

    if not hasattr(sdk, "sign_token_delegate_action"):
        pytest.skip("reference SDK lacks sign_token_delegate_action")

    from bot.services.hyperliquid_signing import sign_token_delegate

    validator = "0x" + "cd" * 20
    nonce = 1700000000000
    sdk_action = {
        "type": "tokenDelegate",
        "validator": validator,
        "wei": 100_000_000,
        "isUndelegate": False,
        "nonce": nonce,
    }
    expected = sdk.sign_token_delegate_action(Account.from_key(PK), sdk_action, True)
    _, actual = sign_token_delegate(PK, validator, 100_000_000, False, nonce, True)
    assert actual == expected


def test_approve_builder_fee_matches_reference_sdk():
    """Lock the (previously 0xa4b1) approveBuilderFee signature to the current SDK."""
    pytest.importorskip("hyperliquid")
    from eth_account import Account
    from hyperliquid.utils import signing as sdk

    if not hasattr(sdk, "sign_approve_builder_fee"):
        pytest.skip("reference SDK lacks sign_approve_builder_fee")

    from bot.services.hyperliquid_signing import sign_approve_builder_fee

    nonce = 1700000000000
    builder = "0x" + "ab" * 20
    sdk_action = {
        "type": "approveBuilderFee",
        "maxFeeRate": "0.1%",
        "builder": builder,
        "nonce": nonce,
    }
    expected = sdk.sign_approve_builder_fee(Account.from_key(PK), sdk_action, True)
    _, actual = sign_approve_builder_fee(PK, builder, "0.1%", nonce, True)
    assert actual == expected


# --- Order wire format: byte-parity with the reference SDK ------------------
# A wrong wire format (bare str(float), missing szDecimals rounding, or wrong
# trigger key order) produces signatures HyperLiquid rejects. These lock our
# serialization to the SDK's.


def test_float_to_wire_matches_reference_sdk():
    pytest.importorskip("hyperliquid")
    from hyperliquid.utils.signing import float_to_wire as sdk_ftw

    for x in [0.1, 1.0, 0.25, 2500.5, 100000.0, 0.0, 0.00010000, 73.205]:
        assert float_to_wire(x) == sdk_ftw(x), x
    # 1.0 normalizes to "1", not "1.0".
    assert float_to_wire(1.0) == "1"


def test_order_wire_matches_reference_sdk_limit():
    pytest.importorskip("hyperliquid")
    from hyperliquid.utils.signing import order_request_to_order_wire

    sdk_wire = order_request_to_order_wire(
        {
            "coin": "ETH",
            "is_buy": True,
            "sz": 0.25,
            "limit_px": 2500.5,
            "order_type": {"limit": {"tif": "Gtc"}},
            "reduce_only": False,
        },
        1,
    )
    ours = HyperLiquidClient._order_wire(
        1, True, 2500.5, 0.25, sz_decimals=2, is_spot=False, tif="Gtc", reduce_only=False
    )
    assert ours == sdk_wire


def test_order_wire_matches_reference_sdk_trigger():
    pytest.importorskip("hyperliquid")
    from hyperliquid.utils.signing import order_request_to_order_wire

    sdk_wire = order_request_to_order_wire(
        {
            "coin": "ETH",
            "is_buy": False,
            "sz": 0.1,
            "limit_px": 2600.0,
            "order_type": {"trigger": {"isMarket": True, "triggerPx": 2600.0, "tpsl": "tp"}},
            "reduce_only": True,
        },
        1,
    )
    ours = HyperLiquidClient._order_wire(
        1, False, 2600.0, 0.1, sz_decimals=2, is_spot=False, reduce_only=True, tpsl="tp"
    )
    assert ours == sdk_wire


def test_full_order_action_signature_matches_sdk():
    """End-to-end: our assembled order action signs identically to the SDK."""
    pytest.importorskip("hyperliquid")
    from eth_account import Account
    from hyperliquid.utils.signing import (
        order_request_to_order_wire,
        order_wires_to_order_action,
        sign_l1_action as sdk_sign,
    )

    wire = order_request_to_order_wire(
        {
            "coin": "ETH",
            "is_buy": True,
            "sz": 0.25,
            "limit_px": 2500.5,
            "order_type": {"limit": {"tif": "Ioc"}},
            "reduce_only": False,
        },
        1,
    )
    action = order_wires_to_order_action([wire])
    ours = {
        "type": "order",
        "orders": [
            HyperLiquidClient._order_wire(
                1, True, 2500.5, 0.25, sz_decimals=2, is_spot=False, tif="Ioc"
            )
        ],
        "grouping": "na",
    }
    assert ours == action
    nonce = 1700000000000
    expected = sdk_sign(Account.from_key(PK), action, None, nonce, None, True)
    assert sign_l1_action(PK, ours, None, nonce, is_mainnet=True) == expected
