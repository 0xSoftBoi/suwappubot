import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "x" * 32)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests._module_loader import load_module

lifi_api_module = load_module("test_lifi_api_module", "bot/services/lifi_api.py")
LiFiAPI = lifi_api_module.LiFiAPI
LiFiError = lifi_api_module.LiFiError


class TestLiFiAPI(unittest.IsolatedAsyncioTestCase):
    async def test_get_quote_parses_response(self):
        api = LiFiAPI()
        response = {
            "id": "quote-1",
            "action": {
                "fromChainId": 8453,
                "toChainId": 1,
                "fromToken": {"address": "0xfrom"},
                "toToken": {"address": "0xto"},
            },
            "estimate": {
                "fromAmount": "1000",
                "toAmount": "990",
                "toAmountMin": "980",
                "executionDuration": 180,
                "gasCosts": [{"amountUSD": "1.25"}],
                "feeCosts": [{"amountUSD": "0.50"}],
            },
            "tool": "across",
            "transactionRequest": {"to": "0xrouter"},
        }

        with patch.object(api, "_request", AsyncMock(return_value=response)):
            quote = await api.get_quote(
                from_chain="base",
                to_chain="ethereum",
                from_token="0xfrom",
                to_token="0xto",
                from_amount="1000",
                from_address="0xsender",
            )

        self.assertEqual(quote.id, "quote-1")
        self.assertEqual(quote.from_chain_id, 8453)
        self.assertEqual(quote.to_chain_id, 1)
        self.assertEqual(quote.gas_cost_usd, 1.25)
        self.assertEqual(quote.fee_cost_usd, 0.50)
        self.assertEqual(quote.transaction_request["to"], "0xrouter")

    async def test_get_status_parses_receiving_tx(self):
        api = LiFiAPI()
        response = {
            "status": "DONE",
            "substatus": "COMPLETED",
            "receiving": {"chainId": 1, "txHash": "0xreceive"},
            "sending": {"txHash": "0xsend"},
            "tool": "cctp",
        }

        with patch.object(api, "_request", AsyncMock(return_value=response)):
            status = await api.get_status("0xsend", "base", "ethereum")

        self.assertEqual(status.status, "DONE")
        self.assertEqual(status.receiving_tx_hash, "0xreceive")
        self.assertEqual(status.sending_tx_hash, "0xsend")
        self.assertEqual(status.tool, "cctp")

    async def test_invalid_chain_raises_error(self):
        api = LiFiAPI()
        with self.assertRaises(LiFiError):
            await api.get_quote(
                from_chain="not-a-chain",
                to_chain="ethereum",
                from_token="0xfrom",
                to_token="0xto",
                from_amount="1000",
                from_address="0xsender",
            )
