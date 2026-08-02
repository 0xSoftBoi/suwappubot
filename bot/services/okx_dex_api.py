"""OKX DEX Aggregator API client for multi-chain swaps.

OKX DEX API covers TRON, EVM, and Solana with 400+ DEX sources.
Used as a competing quote provider in the best-quote engine.

Auth: HMAC-SHA256 signatures using API Key + Secret Key + Passphrase + Project ID.
Docs: https://www.okx.com/web3/build/docs/waas/dex-swap
"""

import hmac
import hashlib
import base64
import logging
import time
from typing import Optional
from dataclasses import dataclass
from datetime import datetime, timezone

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.config.settings import settings

logger = logging.getLogger(__name__)

OKX_DEX_BASE_URL = "https://www.okx.com"

# OKX chain ID mapping
OKX_CHAIN_IDS = {
    "ethereum": "1",
    "bsc": "56",
    "polygon": "137",
    "arbitrum": "42161",
    "optimism": "10",
    "base": "8453",
    "avalanche": "43114",
    "fantom": "250",
    "linea": "59144",
    "mantle": "5000",
    "gnosis": "100",
    "scroll": "534352",
    "solana": "501",
    "tron": "195",
    "plasma": "9745",
}


@dataclass
class OKXDEXQuote:
    """Quote response from OKX DEX Aggregator."""

    chain_id: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    estimated_gas: str
    price_impact: float
    router_address: str
    tx_data: Optional[dict]  # Transaction data for execution (only from /swap)
    raw_response: dict


class OKXDEXError(Exception):
    """Exception raised for OKX DEX API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class OKXDEXAPI:
    """Client for OKX DEX Aggregator API."""

    def __init__(self):
        self.base_url = OKX_DEX_BASE_URL
        self.api_key = settings.okx_dex_api_key
        self.secret_key = settings.okx_dex_secret_key
        self.passphrase = settings.okx_dex_passphrase
        self.project_id = settings.okx_dex_project_id

    @property
    def is_configured(self) -> bool:
        """Check if OKX DEX API credentials are configured."""
        return bool(self.api_key and self.secret_key and self.passphrase and self.project_id)

    def _sign_request(self, timestamp: str, method: str, request_path: str, body: str = "") -> str:
        """Generate HMAC-SHA256 signature for OKX API auth."""
        prehash = timestamp + method.upper() + request_path + body
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            prehash.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return base64.b64encode(signature).decode("utf-8")

    def _get_headers(self, method: str, request_path: str, body: str = "") -> dict:
        """Build authenticated headers for OKX API."""
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        signature = self._sign_request(timestamp, method, request_path, body)
        return {
            "OK-ACCESS-KEY": self.api_key,
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": self.passphrase,
            "OK-ACCESS-PROJECT": self.project_id,
            "Content-Type": "application/json",
            # OKX fronts the API with Cloudflare, which 403s (error 1010) requests
            # with no/automated User-Agent — verified that a browser UA passes while
            # python-default/bot UAs are blocked, so use a standard browser string.
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            ),
        }

    @staticmethod
    def get_chain_id(chain_name: str) -> Optional[str]:
        """Get OKX chain ID for a chain name."""
        return OKX_CHAIN_IDS.get(chain_name.lower())

    @staticmethod
    def _fee_params(platform_fee_bps: Optional[int]) -> dict:
        """Build OKX DEX referrer-fee params, gated on (fee bps AND collector set).

        OKX charges the fee on the from-token referrer wallet as a percent
        (100 bps -> 1.0), capped at 3% on EVM (clamped). Returns an empty dict
        when the fee is off (default behavior unchanged).
        """
        collector = settings.fee_collector_address
        if not platform_fee_bps or not collector:
            return {}
        fee_percent = min(int(platform_fee_bps) / 100.0, 3.0)
        if fee_percent <= 0:
            return {}
        return {
            "fromTokenReferrerWalletAddress": collector,
            "feePercent": str(fee_percent),
        }

    @track_time(MetricNames.API_OKX_DEX)
    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict] = None,
    ) -> dict:
        """Make an authenticated API request to OKX DEX."""
        await api_limiter.wait_and_acquire("okx_dex")

        # Build query string for GET requests
        if params:
            query_parts = []
            for k, v in sorted(params.items()):
                if v is not None:
                    query_parts.append(f"{k}={v}")
            query_string = "&".join(query_parts)
            request_path = f"{path}?{query_string}"
        else:
            request_path = path

        headers = self._get_headers(method, request_path)
        url = f"{self.base_url}{request_path}"

        session = await get_session()
        async with session.request(method, url, headers=headers) as response:
            data = await response.json()

            if response.status != 200:
                raise OKXDEXError(f"OKX DEX API error: HTTP {response.status}", data)

            code = data.get("code", "0")
            if code != "0":
                msg = data.get("msg", "Unknown error")
                raise OKXDEXError(f"OKX DEX error ({code}): {msg}", data)

            return data

    async def get_quote(
        self,
        chain_id: str,
        from_token: str,
        to_token: str,
        amount: str,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
    ) -> OKXDEXQuote:
        """Get a swap quote from OKX DEX Aggregator.

        Args:
            chain_id: OKX chain ID (e.g., "1" for Ethereum, "195" for TRON)
            from_token: Source token address
            to_token: Destination token address
            amount: Input amount in smallest units
            slippage: Slippage tolerance as percentage (0.5 = 0.5%)
            platform_fee_bps: Optional referrer fee in bps (collected to the
                configured fee wallet); applied only when a collector is set.

        Returns:
            OKXDEXQuote with swap details
        """
        params = {
            "chainIndex": chain_id,  # V6 renamed chainId -> chainIndex (same numeric value)
            "fromTokenAddress": from_token,
            "toTokenAddress": to_token,
            "amount": amount,
            "slippage": str(slippage / 100),  # OKX expects decimal (0.005 = 0.5%)
            **self._fee_params(platform_fee_bps),
        }

        # V5 DEX API is deprecated (code 50050); V6 is the live aggregator.
        data = await self._request("GET", "/api/v6/dex/aggregator/quote", params=params)

        result = data.get("data", [{}])[0] if data.get("data") else {}
        if not result:
            raise OKXDEXError("Empty quote response from OKX DEX", data)

        to_amount = result.get("toTokenAmount", "0")
        # Apply slippage for minimum amount
        slippage_factor = 1 - (slippage / 100)
        to_amount_min = str(int(int(to_amount) * slippage_factor))

        return OKXDEXQuote(
            chain_id=chain_id,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            estimated_gas=result.get("estimateGasFee", "0"),
            price_impact=float(result.get("priceImpactPercentage", 0)),
            router_address=result.get("dexRouterAddress", ""),
            tx_data=None,
            raw_response=result,
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
    ) -> OKXDEXQuote:
        """Get a swap quote with transaction data from OKX DEX.

        This endpoint returns both the quote AND the transaction calldata
        needed to execute the swap.

        Args:
            chain_id: OKX chain ID
            from_token: Source token address
            to_token: Destination token address
            amount: Input amount in smallest units
            user_address: User's wallet address
            slippage: Slippage tolerance as percentage
            platform_fee_bps: Optional referrer fee in bps; must match the value
                used at quote time so the executed tx collects the fee.

        Returns:
            OKXDEXQuote with tx_data populated for execution
        """
        params = {
            "chainIndex": chain_id,  # V6 renamed chainId -> chainIndex
            "fromTokenAddress": from_token,
            "toTokenAddress": to_token,
            "amount": amount,
            "slippage": str(slippage / 100),
            "userWalletAddress": user_address,
            **self._fee_params(platform_fee_bps),
        }

        data = await self._request("GET", "/api/v6/dex/aggregator/swap", params=params)

        result = data.get("data", [{}])[0] if data.get("data") else {}
        if not result:
            raise OKXDEXError("Empty swap response from OKX DEX", data)

        router_result = result.get("routerResult", {})
        to_amount = router_result.get("toTokenAmount", "0")
        slippage_factor = 1 - (slippage / 100)
        to_amount_min = str(int(int(to_amount) * slippage_factor))

        tx = result.get("tx", {})

        return OKXDEXQuote(
            chain_id=chain_id,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            estimated_gas=tx.get("gas", router_result.get("estimateGasFee", "0")),
            price_impact=float(router_result.get("priceImpactPercentage", 0)),
            router_address=tx.get("to", router_result.get("dexRouterAddress", "")),
            tx_data=tx if tx else None,
            raw_response=result,
        )
