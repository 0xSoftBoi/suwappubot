import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests._module_loader import load_module

jupiter_api_module = load_module("test_jupiter_api_module", "bot/services/jupiter_api.py")
JupiterAPI = jupiter_api_module.JupiterAPI


class TestJupiterAPI(unittest.IsolatedAsyncioTestCase):
    async def test_get_quote_parses_route_plan(self):
        api = JupiterAPI()
        response = {
            "inputMint": "So11111111111111111111111111111111111111112",
            "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "inAmount": "1000000000",
            "outAmount": "150000000000",
            "otherAmountThreshold": "149000000000",
            "priceImpactPct": "0.02",
            "routePlan": [{"swapInfo": {"label": "Jupiter"}}],
        }

        with patch.object(api, "_request", AsyncMock(return_value=response)):
            quote = await api.get_quote(
                input_mint=response["inputMint"],
                output_mint=response["outputMint"],
                amount="1000000000",
            )

        self.assertEqual(quote.out_amount, "150000000000")
        self.assertAlmostEqual(quote.price_impact_pct, 0.02)
        self.assertEqual(len(quote.route_plan), 1)

    async def test_get_swap_transaction_parses_payload(self):
        api = JupiterAPI()
        response = {
            "swapTransaction": "YmFzZTY0dHg=",
            "lastValidBlockHeight": 12345,
        }

        with patch.object(api, "_request", AsyncMock(return_value=response)):
            swap_tx = await api.get_swap_transaction(
                quote_response={"dummy": True},
                user_public_key="sender",
            )

        self.assertEqual(swap_tx.swap_transaction, "YmFzZTY0dHg=")
        self.assertEqual(swap_tx.last_valid_block_height, 12345)

    def test_decode_transaction_decodes_base64(self):
        api = JupiterAPI()
        self.assertEqual(api.decode_transaction("aGVsbG8="), b"hello")
