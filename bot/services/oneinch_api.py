"""1inch Aggregation Protocol (v6) client for EVM swaps.

1inch aggregates 1000+ liquidity sources across major EVM chains. Used as a
competing quote provider in the best-quote engine alongside Li.Fi / CoW / OKX.

Auth: Bearer token from the 1inch Developer Portal (https://portal.1inch.dev).
Docs: https://portal.1inch.dev/documentation/apis/swap/classic-swap/quick-start

EVM-only — no Solana/TRON. The /swap endpoint returns ready-to-broadcast
transaction calldata; we sign and send it exactly like the Li.Fi / OKX path.
"""

import logging
from typing import Optional
from dataclasses import dataclass

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.config.settings import settings

logger = logging.getLogger(__name__)

ONEINCH_BASE_URL = "https://api.1inch.dev"
ONEINCH_API_VERSION = "v6.0"

# 1inch uses native EVM chain IDs (same as OKX numeric values).
ONEINCH_CHAIN_IDS = {
    "ethereum": "1",
    "bsc": "56",
    "polygon": "137",
    "arbitrum": "42161",
    "optimism": "10",
    "base": "8453",
    "avalanche": "43114",
    "fantom": "250",
    "gnosis": "100",
    "zksync": "324",
    "linea": "59144",
    "aurora": "1313161554",
}

# 1inch represents the native asset (ETH/BNB/etc.) with this sentinel address.
ONEINCH_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"


@dataclass
class OneInchQuote:
    """Quote response from 1inch Aggregation Protocol."""

    chain_id: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    estimated_gas: str
    router_address: str
    tx_data: Optional[dict]  # Transaction data for execution (only from /swap)
    raw_response: dict


class OneInchError(Exception):
    """Exception raised for 1inch API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class OneInchAPI:
    """Client for the 1inch Aggregation Protocol (v6) swap API."""

    def __init__(self):
        self.base_url = ONEINCH_BASE_URL
        self.api_key = settings.oneinch_api_key

    @property
    def is_configured(self) -> bool:
        """Check if a 1inch API key is configured."""
        return bool(self.api_key)

    @staticmethod
    def get_chain_id(chain_name: str) -> Optional[str]:
        """Get the 1inch chain ID for a chain name."""
        return ONEINCH_CHAIN_IDS.get(chain_name.lower())

    @staticmethod
    def _fee_params(platform_fee_bps: Optional[int]) -> dict:
        """Build 1inch partner-fee params, gated on (fee bps AND collector set).

        1inch takes `fee` as a percent number (100 bps -> 1.0) plus a `referrer`
        wallet. CAVEAT: 1inch rejects fee-on-transfer tokens when fee+referrer
        are set — that surfaces as an API error, which is caught by the engine's
        gather(return_exceptions=True), so other providers still win the race.
        Returns an empty dict when the fee is off (default behavior unchanged).
        """
        collector = settings.fee_collector_address
        if not platform_fee_bps or not collector:
            return {}
        fee_percent = int(platform_fee_bps) / 100.0
        if fee_percent <= 0:
            return {}
        return {
            "fee": fee_percent,
            "referrer": collector,
        }

    def _get_headers(self) -> dict:
        """Build authenticated headers for the 1inch API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            # api.1inch.dev is fronted by Cloudflare, which 403s (error 1010)
            # requests with no/automated User-Agent — verified that a browser UA
            # passes while python-default UAs are blocked. Same fix as OKX.
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            ),
        }

    @track_time(MetricNames.API_1INCH)
    async def _request(self, chain_id: str, endpoint: str, params: dict) -> dict:
        """Make an authenticated GET request to the 1inch swap API."""
        await api_limiter.wait_and_acquire("1inch")

        url = f"{self.base_url}/swap/{ONEINCH_API_VERSION}/{chain_id}/{endpoint}"
        clean_params = {k: v for k, v in params.items() if v is not None}

        session = await get_session()
        async with session.get(url, headers=self._get_headers(), params=clean_params) as response:
            data = await response.json()

            if response.status != 200:
                # 1inch returns {description, error, statusCode} on failure.
                msg = data.get("description") or data.get("error") or f"HTTP {response.status}"
                raise OneInchError(f"1inch API error: {msg}", data)

            return data

    async def get_quote(
        self,
        chain_id: str,
        from_token: str,
        to_token: str,
        amount: str,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
    ) -> OneInchQuote:
        """Get a swap quote from 1inch (price discovery, no tx calldata).

        Args:
            chain_id: Numeric EVM chain ID (e.g., "1", "8453")
            from_token: Source token address (native = ONEINCH_NATIVE_TOKEN)
            to_token: Destination token address
            amount: Input amount in smallest units
            slippage: Slippage tolerance as a percentage (0.5 = 0.5%)
        """
        params = {
            "src": from_token,
            "dst": to_token,
            "amount": amount,
            "includeGas": "true",
            **self._fee_params(platform_fee_bps),
        }

        # v6 /quote returns {dstAmount, gas?} — no tx data.
        data = await self._request(chain_id, "quote", params)

        to_amount = str(data.get("dstAmount", "0"))
        if to_amount == "0":
            raise OneInchError("Empty quote response from 1inch", data)

        slippage_factor = 1 - (slippage / 100)
        to_amount_min = str(int(int(to_amount) * slippage_factor))

        return OneInchQuote(
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
        chain_id: str,
        from_token: str,
        to_token: str,
        amount: str,
        user_address: str,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
    ) -> OneInchQuote:
        """Get a swap quote WITH transaction calldata for execution.

        Returns an OneInchQuote with tx_data populated ({to, data, value, gas, gasPrice}).
        """
        params = {
            "src": from_token,
            "dst": to_token,
            "amount": amount,
            "from": user_address,
            "origin": user_address,
            "slippage": slippage,  # 1inch expects percent directly (1 = 1%)
            # We run our own ERC20 approval + broadcast (like OKX/Li.Fi), so skip
            # 1inch's on-chain eth_call estimate which would fail pre-approval.
            "disableEstimate": "true",
            **self._fee_params(platform_fee_bps),
        }

        data = await self._request(chain_id, "swap", params)

        tx = data.get("tx", {})
        if not tx:
            raise OneInchError("1inch did not return transaction data", data)

        to_amount = str(data.get("dstAmount", "0"))
        slippage_factor = 1 - (slippage / 100)
        to_amount_min = str(int(int(to_amount) * slippage_factor)) if to_amount != "0" else "0"

        return OneInchQuote(
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
