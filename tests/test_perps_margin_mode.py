"""Perps margin-mode and leverage safety regression tests."""

import asyncio
import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.hyperliquid_client import HyperLiquidClient


PK = "0x0123456789012345678901234567890123456789012345678901234567890123"


class _Resp:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


class _HTTP:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return self.responses.pop(0)


def _client_with_index(index=1):
    hl = HyperLiquidClient()

    async def _index(_asset):
        return index

    hl._resolve_asset_index = _index
    return hl


def test_isolated_mode_serializes_is_cross_false():
    hl = _client_with_index()
    http = _HTTP([_Resp({"status": "ok"})])

    asyncio.run(hl._set_leverage(http, "0xUser", "k", PK, "ETH", 7, is_cross=False))

    action = http.calls[0]["json"]["action"]
    assert action == {
        "type": "updateLeverage",
        "asset": 1,
        "isCross": False,
        "leverage": 7,
    }


def test_rejected_margin_mode_update_fails_closed():
    hl = _client_with_index()
    http = _HTTP([_Resp({"status": "err", "response": "cannot change margin mode"})])

    with pytest.raises(RuntimeError, match="rejected leverage/margin mode update"):
        asyncio.run(hl._set_leverage(http, "0xUser", "k", PK, "ETH", 5, is_cross=False))


def test_reduce_only_close_never_mutates_leverage_or_margin_mode():
    hl = _client_with_index()
    http = _HTTP(
        [
            _Resp(
                {
                    "response": {
                        "data": {
                            "statuses": [
                                {
                                    "filled": {
                                        "oid": 9,
                                        "avgPx": "2000",
                                        "totalSz": "0.1",
                                    }
                                }
                            ]
                        }
                    }
                }
            )
        ]
    )

    async def _get_client():
        return http

    async def _mid(_market):
        return 2000.0

    async def _must_not_run(*_args, **_kwargs):
        raise AssertionError("reduce-only order attempted to change leverage")

    hl._get_client = _get_client
    hl.get_mark_price = _mid
    hl._set_leverage = _must_not_run

    result = asyncio.run(
        hl.place_order(
            address="0xUser",
            api_key="k",
            api_secret=PK,
            market="ETH-USD",
            side="long",
            size=0.1,
            reduce_only=True,
            is_cross=False,
        )
    )

    assert result is not None
    assert len(http.calls) == 1
    assert http.calls[0]["json"]["action"]["type"] == "order"


def test_entry_forwards_selected_margin_mode_to_leverage_update():
    hl = _client_with_index()
    http = _HTTP(
        [
            _Resp(
                {
                    "response": {
                        "data": {
                            "statuses": [
                                {
                                    "filled": {
                                        "oid": 10,
                                        "avgPx": "2000",
                                        "totalSz": "0.1",
                                    }
                                }
                            ]
                        }
                    }
                }
            )
        ]
    )
    seen = {}

    async def _get_client():
        return http

    async def _mid(_market):
        return 2000.0

    async def _capture(*_args, **kwargs):
        seen.update(kwargs)

    hl._get_client = _get_client
    hl.get_mark_price = _mid
    hl._set_leverage = _capture

    result = asyncio.run(
        hl.place_order(
            address="0xUser",
            api_key="k",
            api_secret=PK,
            market="ETH-USD",
            side="long",
            size=0.1,
            leverage=7,
            is_cross=False,
        )
    )

    assert result is not None
    assert seen["is_cross"] is False
