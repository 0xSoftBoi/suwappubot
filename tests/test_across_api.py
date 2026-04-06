import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests._module_loader import load_module

across_api_module = load_module("test_across_api_module", "bot/services/across_api.py")
AcrossAPI = across_api_module.AcrossAPI
AcrossError = across_api_module.AcrossError


class _FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._payload

    async def text(self):
        return str(self._payload)


class _FakeSession:
    def __init__(self, response):
        self._response = response

    def get(self, _url, params=None):
        return self._response


class TestAcrossAPI(unittest.IsolatedAsyncioTestCase):
    async def test_get_quote_parses_fee_response(self):
        api = AcrossAPI()
        payload = {
            "totalRelayFee": {"total": "1000", "pct": "1000000000000000"},
            "estimatedFillTimeSec": 90,
            "timestamp": 1,
            "fillDeadline": 2,
            "exclusivityDeadline": 3,
            "exclusiveRelayer": "0x0000000000000000000000000000000000000000",
        }

        with patch.object(across_api_module, "get_session", AsyncMock(return_value=_FakeSession(_FakeResponse(200, payload)))):
            quote = await api.get_quote(
                from_chain="base",
                to_chain="ethereum",
                token="USDC",
                amount="1000000",
                from_address="0x1234567890123456789012345678901234567890",
            )

        self.assertEqual(quote.to_amount, "999000")
        self.assertEqual(quote.estimated_fill_time, 90)
        self.assertEqual(quote.spoke_pool.lower(), api.get_spoke_pool("base").lower())

    async def test_get_deposit_status_handles_missing_deposit(self):
        api = AcrossAPI()
        with patch.object(across_api_module, "get_session", AsyncMock(return_value=_FakeSession(_FakeResponse(404, {})))):
            status = await api.get_deposit_status("base", 123)

        self.assertEqual(status.status, "PENDING")
        self.assertIsNone(status.fill_tx_hash)

    def test_unsupported_route_raises(self):
        api = AcrossAPI()
        self.assertFalse(api.is_supported_route("base", "base", "USDC"))
        with self.assertRaises(AcrossError):
            api.get_chain_id("solana")
