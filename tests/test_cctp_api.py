import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests._module_loader import load_module

cctp_api_module = load_module("test_cctp_api_module", "bot/services/cctp_api.py")
CircleCCTPAPI = cctp_api_module.CircleCCTPAPI
CCTPError = cctp_api_module.CCTPError


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


class _FakeSession:
    def __init__(self, response):
        self._response = response

    def get(self, _url):
        return self._response


class TestCCTPAPI(unittest.IsolatedAsyncioTestCase):
    async def test_get_quote_returns_one_to_one_usdc_transfer(self):
        api = CircleCCTPAPI()
        quote = await api.get_quote("base", "ethereum", "25000000")

        self.assertEqual(quote.from_amount, "25000000")
        self.assertEqual(quote.to_amount, "25000000")
        self.assertEqual(quote.bridge_fee_usd, 0.0)
        self.assertEqual(quote.destination_domain, 0)

    async def test_get_attestation_returns_attested_status(self):
        api = CircleCCTPAPI()
        response = _FakeResponse(200, {"status": "complete", "attestation": "0xabc"})

        with patch.object(cctp_api_module, "get_session", AsyncMock(return_value=_FakeSession(response))):
            status = await api.get_attestation("0xmessage", max_attempts=1, poll_interval=0)

        self.assertEqual(status.status, "ATTESTED")
        self.assertEqual(status.attestation, "0xabc")

    def test_unsupported_route_raises(self):
        api = CircleCCTPAPI()
        self.assertFalse(api.is_supported_route("base", "base", "USDC"))
        with self.assertRaises(CCTPError):
            api.get_domain_id("solana")
