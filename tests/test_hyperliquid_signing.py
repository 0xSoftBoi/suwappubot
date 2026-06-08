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

from bot.services.hyperliquid_signing import sign_l1_action
from bot.services.hyperliquid_client import HyperLiquidClient

# Well-known throwaway test key (same one the HL SDK uses in its own tests).
PK = "0x0123456789012345678901234567890123456789012345678901234567890123"

ACTIONS = [
    {"type": "order", "orders": [{"a": 0, "b": True, "p": "0", "s": "0.1",
                                   "r": False, "t": {"limit": {"tif": "Ioc"}}}], "grouping": "na"},
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
