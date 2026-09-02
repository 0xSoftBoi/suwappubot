"""Discovery feeds map GeckoTerminal per-network pools into the terminal's pool shape."""

import asyncio
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import api.webapp as webapp  # noqa: E402

GECKO_PAYLOAD = {
    "data": [
        {
            "id": "eth_0xpool",
            "type": "pool",
            "attributes": {
                "name": "HODL / ETH",
                "address": "0xpool",
                "base_token_price_usd": "0.0000033",
                "fdv_usd": "3313.68",
                "reserve_in_usd": "12.5",
                "pool_created_at": "2026-09-02T14:39:35Z",
                "volume_usd": {"h24": "1.19"},
                "price_change_percentage": {"h1": "0", "h24": "-2.5"},
            },
            "relationships": {
                "base_token": {"data": {"id": "eth_0xbase", "type": "token"}},
                "quote_token": {"data": {"id": "eth_0xquote", "type": "token"}},
            },
        }
    ],
    "included": [
        {
            "id": "eth_0xbase",
            "type": "token",
            "attributes": {"address": "0xbase", "symbol": "HODL"},
        },
        {
            "id": "eth_0xquote",
            "type": "token",
            "attributes": {"address": "0xquote", "symbol": "WETH"},
        },
    ],
}


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _Client:
    calls = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        _Client.calls.append((url, params))
        if "geckoterminal" in url:
            if "/networks/eth/" in url:
                return _Resp(GECKO_PAYLOAD)
            return _Resp({}, status=500)
        return _Resp({"pairs": [{"chainId": "bsc", "pairAddress": "0xdex", "pairCreatedAt": 1}]})


def test_gecko_pools_are_mapped_into_the_terminal_shape(monkeypatch):
    monkeypatch.setattr(webapp.httpx, "AsyncClient", _Client)
    pools = asyncio.run(webapp._fetch_dex_pools("ethereum", 20, "new"))
    assert pools == [
        {
            "name": "HODL / ETH",
            "address": "0xpool",
            "createdAt": "2026-09-02T14:39:35Z",
            "baseToken": {"symbol": "HODL", "address": "0xbase"},
            "quoteToken": {"symbol": "WETH", "address": "0xquote"},
            "priceUsd": "0.0000033",
            "fdvUsd": "3313.68",
            "volumeH24": "1.19",
            "reserveUsd": "12.5",
            "priceChangeH1": 0.0,
            "priceChangeH24": -2.5,
        }
    ]
    assert "/networks/eth/new_pools" in _Client.calls[-1][0]


def test_falls_back_to_dexscreener_when_gecko_fails(monkeypatch):
    monkeypatch.setattr(webapp.httpx, "AsyncClient", _Client)
    pools = asyncio.run(webapp._fetch_dex_pools("bsc", 20, "trending"))
    assert pools and pools[0]["address"] == "0xdex"
