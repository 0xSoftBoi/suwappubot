"""0x Swap API v2 (allowance-holder) client for EVM swaps.

0x aggregates liquidity across major EVM chains. Used as a competing quote
provider in the best-quote engine alongside Li.Fi / CoW / OKX / 1inch.

Auth: API key from the 0x Dashboard (https://dashboard.0x.org), sent in the
`0x-api-key` header alongside the required `0x-version: v2` header.
Docs: https://0x.org/docs/api

EVM-only — no Solana/TRON. The /quote (allowance-holder) endpoint returns
ready-to-broadcast transaction calldata; we sign and send it exactly like the
Li.Fi / OKX / 1inch path.

IMPORTANT (v2 allowance-holder): the spender to approve is the AllowanceHolder
contract exposed at `issues.allowance.spender` — NOT `transaction.to`, which is
the Settler execution contract. Approve the spender, send to transaction.to.
"""

import logging
from typing import Optional
from dataclasses import dataclass

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.config.settings import settings

logger = logging.getLogger(__name__)

ZEROX_BASE_URL = "https://api.0x.org"
ZEROX_API_VERSION = "v2"

ZEROX_PRICE_PATH = "/swap/allowance-holder/price"
ZEROX_QUOTE_PATH = "/swap/allowance-holder/quote"

# 0x uses native EVM chain IDs (integers in v2).
ZEROX_CHAIN_IDS = {
    "ethereum": 1,
    "base": 8453,
    "arbitrum": 42161,
    "optimism": 10,
    "polygon": 137,
    "bsc": 56,
    "avalanche": 43114,
}

# 0x represents the native asset (ETH/BNB/etc.) with this sentinel address.
ZEROX_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"


@dataclass
class ZeroXQuote:
    """Quote response from 0x Swap API v2 (allowance-holder)."""
    chain_id: int
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    estimated_gas: str
    router_address: str
    tx_data: Optional[dict]  # Transaction data for execution (only from /quote)
    raw_response: dict


class ZeroXError(Exception):
    """Exception raised for 0x API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class ZeroXAPI:
    """Client for the 0x Swap API v2 (allowance-holder) swap API."""

    def __init__(self):
        self.base_url = ZEROX_BASE_URL
        self.api_key = settings.zerox_api_key

    @property
    def is_configured(self) -> bool:
        """Check if a 0x API key is configured."""
        return bool(self.api_key)

    @staticmethod
    def get_chain_id(chain_name: str) -> Optional[int]:
        """Get the 0x chain ID for a chain name."""
        return ZEROX_CHAIN_IDS.get(chain_name.lower())

    def _get_headers(self) -> dict:
        """Build authenticated headers for the 0x API.

        v2 requires both `0x-api-key` and `0x-version: v2`. api.0x.org is not
        Cloudflare-fronted, so no browser User-Agent is needed.
        """
        return {
            "0x-api-key": self.api_key or "",
            "0x-version": ZEROX_API_VERSION,
            "Accept": "application/json",
        }

    @track_time(MetricNames.API_0X)
    async def _request(self, path: str, params: dict) -> dict:
        """Make an authenticated GET request to the 0x swap API."""
        await api_limiter.wait_and_acquire("0x")

        url = f"{self.base_url}{path}"
        clean_params = {k: v for k, v in params.items() if v is not None}

        session = await get_session()
        async with session.get(url, headers=self._get_headers(), params=clean_params) as response:
            data = await response.json()

            if response.status != 200:
                # 0x returns {name, message, ...} on failure.
                msg = data.get("message") or data.get("name") or f"HTTP {response.status}"
                raise ZeroXError(f"0x API error: {msg}", data)

            return data

    @staticmethod
    def _slippage_bps(slippage: float) -> int:
        """Convert a percent slippage (0.5 = 0.5%) to integer basis points."""
        return int(round(slippage * 100))

    async def get_quote(
        self,
        chain_id: int,
        from_token: str,
        to_token: str,
        amount: str,
        slippage: float = 0.5,
    ) -> ZeroXQuote:
        """Get a swap quote from 0x (price discovery, no tx calldata).

        Uses the read-only /swap/allowance-holder/price endpoint — no taker
        required, no calldata returned.

        Args:
            chain_id: Numeric EVM chain ID (e.g., 1, 8453)
            from_token: Source token address (native = ZEROX_NATIVE_TOKEN)
            to_token: Destination token address
            amount: Input amount in smallest units
            slippage: Slippage tolerance as a percentage (0.5 = 0.5%)
        """
        params = {
            "chainId": chain_id,
            "sellToken": from_token,
            "buyToken": to_token,
            "sellAmount": amount,
            "slippageBps": self._slippage_bps(slippage),
        }

        data = await self._request(ZEROX_PRICE_PATH, params)

        to_amount = str(data.get("buyAmount", "0"))
        if to_amount == "0":
            raise ZeroXError("Empty quote response from 0x", data)

        # 0x returns minBuyAmount directly; fall back to slippage-derived min.
        to_amount_min = data.get("minBuyAmount")
        if to_amount_min is None:
            slippage_factor = 1 - (slippage / 100)
            to_amount_min = str(int(int(to_amount) * slippage_factor))
        else:
            to_amount_min = str(to_amount_min)

        return ZeroXQuote(
            chain_id=chain_id,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            estimated_gas=str(data.get("gas", "0")),
            router_address="",
            tx_data=None,
            raw_response=data,
        )

    async def get_swap(
        self,
        chain_id: int,
        from_token: str,
        to_token: str,
        amount: str,
        user_address: str,
        slippage: float = 0.5,
    ) -> ZeroXQuote:
        """Get a swap quote WITH transaction calldata for execution.

        Uses the /swap/allowance-holder/quote endpoint, which requires a taker
        and returns the full tx object ({to, data, value, gas}). The response
        also carries `issues.allowance.spender` — the AllowanceHolder contract
        to approve (NOT transaction.to, which is the Settler).
        """
        params = {
            "chainId": chain_id,
            "sellToken": from_token,
            "buyToken": to_token,
            "sellAmount": amount,
            "taker": user_address,
            "slippageBps": self._slippage_bps(slippage),
        }

        data = await self._request(ZEROX_QUOTE_PATH, params)

        tx = data.get("transaction", {})
        if not tx:
            raise ZeroXError("0x did not return transaction data", data)

        to_amount = str(data.get("buyAmount", "0"))
        to_amount_min = data.get("minBuyAmount")
        if to_amount_min is None:
            slippage_factor = 1 - (slippage / 100)
            to_amount_min = str(int(int(to_amount) * slippage_factor)) if to_amount != "0" else "0"
        else:
            to_amount_min = str(to_amount_min)

        return ZeroXQuote(
            chain_id=chain_id,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            estimated_gas=str(tx.get("gas", "0")),
            router_address=tx.get("to", ""),
            tx_data=tx,
            raw_response=data,
        )
