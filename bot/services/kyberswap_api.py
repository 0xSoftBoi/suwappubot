"""KyberSwap Aggregator client for EVM swaps.

KyberSwap aggregates 100+ DEXes across major EVM chains. Used as a competing
quote provider in the best-quote engine alongside Li.Fi / CoW / OKX / 1inch.

No API key required — KyberSwap's aggregator API is public. We send a free
`x-client-id` identifier header to avoid aggressive anonymous rate-limiting.
Docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator

Two-step flow (EVM-only, no Solana/TRON):
  1. GET  /{chain}/api/v1/routes      -> price + routeSummary (for the race)
  2. POST /{chain}/api/v1/route/build -> ready-to-broadcast tx calldata

The router is a single contract: it is both the ERC20 spender to approve AND
the tx `to` target (simpler than 0x's Settler/AllowanceHolder split).
"""

import json
import logging
from typing import Optional
from dataclasses import dataclass

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.config.settings import settings

logger = logging.getLogger(__name__)

KYBERSWAP_BASE_URL = "https://aggregator-api.kyberswap.com"

# KyberSwap routes by chain SLUG in the URL path (not numeric chainId).
KYBERSWAP_CHAIN_SLUGS = {
    "ethereum": "ethereum",
    "bsc": "bsc",
    "polygon": "polygon",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "base": "base",
    "avalanche": "avalanche",
    "fantom": "fantom",
    "linea": "linea",
    "scroll": "scroll",
    "mantle": "mantle",
    "zksync": "zksync",
    "blast": "blast",
}

# KyberSwap represents the native asset (ETH/BNB/etc.) with this sentinel.
KYBERSWAP_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"


@dataclass
class KyberSwapQuote:
    """Quote response from the KyberSwap Aggregator."""
    chain_slug: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    gas_usd: float
    router_address: str
    tx_data: Optional[dict]  # Transaction data for execution (only after /route/build)
    raw_response: dict


class KyberSwapError(Exception):
    """Exception raised for KyberSwap API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class KyberSwapAPI:
    """Client for the KyberSwap Aggregator API (EVM, no API key)."""

    def __init__(self):
        self.base_url = KYBERSWAP_BASE_URL

    @property
    def is_configured(self) -> bool:
        """KyberSwap needs no key — it's gated behind an explicit enable flag so
        it ships dark and has a no-redeploy kill switch."""
        return bool(settings.kyberswap_enabled)

    @staticmethod
    def get_chain_slug(chain_name: str) -> Optional[str]:
        """Get the KyberSwap chain slug for a chain name."""
        return KYBERSWAP_CHAIN_SLUGS.get(chain_name.lower())

    def _get_headers(self) -> dict:
        """Build headers. x-client-id is a free identifier (not a key) that
        lifts anonymous rate limits."""
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-client-id": settings.kyberswap_client_id,
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            ),
        }

    @track_time(MetricNames.API_KYBERSWAP)
    async def _routes(self, chain_slug: str, params: dict) -> dict:
        """GET /{chain}/api/v1/routes — price discovery + routeSummary."""
        await api_limiter.wait_and_acquire("kyberswap")
        url = f"{self.base_url}/{chain_slug}/api/v1/routes"
        session = await get_session()
        async with session.get(url, headers=self._get_headers(), params=params) as response:
            data = await response.json()
            if response.status != 200 or data.get("code") not in (0, None):
                msg = data.get("message") or f"HTTP {response.status}"
                raise KyberSwapError(f"KyberSwap routes error: {msg}", data)
            return data.get("data", {})

    @track_time(MetricNames.API_KYBERSWAP)
    async def _build(self, chain_slug: str, body: dict) -> dict:
        """POST /{chain}/api/v1/route/build — encode the swap into tx calldata."""
        await api_limiter.wait_and_acquire("kyberswap")
        url = f"{self.base_url}/{chain_slug}/api/v1/route/build"
        session = await get_session()
        # Serialize the body ourselves (Content-Type set in headers) so we don't
        # depend on the shared session's json_serialize, which is None unless
        # orjson is installed.
        payload = json.dumps(body)
        async with session.post(url, headers=self._get_headers(), data=payload) as response:
            data = await response.json()
            if response.status != 200 or data.get("code") not in (0, None):
                msg = data.get("message") or f"HTTP {response.status}"
                raise KyberSwapError(f"KyberSwap build error: {msg}", data)
            return data.get("data", {})

    async def get_quote(
        self,
        chain_slug: str,
        from_token: str,
        to_token: str,
        amount: str,
        slippage: float = 0.5,
    ) -> KyberSwapQuote:
        """Get a swap quote (price discovery — no tx calldata).

        Args:
            chain_slug: KyberSwap chain slug (e.g. "base")
            from_token: Source token address (native = KYBERSWAP_NATIVE_TOKEN)
            to_token: Destination token address
            amount: Input amount in smallest units
            slippage: Slippage tolerance as a percentage (0.5 = 0.5%)
        """
        params = {
            "tokenIn": from_token,
            "tokenOut": to_token,
            "amountIn": amount,
        }
        data = await self._routes(chain_slug, params)

        route_summary = data.get("routeSummary") or {}
        to_amount = str(route_summary.get("amountOut", "0"))
        if to_amount == "0":
            raise KyberSwapError("Empty quote response from KyberSwap", data)

        slippage_factor = 1 - (slippage / 100)
        to_amount_min = str(int(int(to_amount) * slippage_factor))

        gas_usd = 0.0
        try:
            gas_usd = float(route_summary.get("gasUsd", 0))
        except (ValueError, TypeError):
            pass

        return KyberSwapQuote(
            chain_slug=chain_slug,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            gas_usd=gas_usd,
            router_address=data.get("routerAddress", ""),
            tx_data=None,
            raw_response=data,
        )

    async def get_swap(
        self,
        chain_slug: str,
        from_token: str,
        to_token: str,
        amount: str,
        user_address: str,
        slippage: float = 0.5,
    ) -> KyberSwapQuote:
        """Get a swap quote WITH transaction calldata for execution.

        Re-fetches a fresh route (routes expire) then builds the tx. The router
        is both the ERC20 spender to approve and the tx `to` target.
        """
        # 1. Fresh route
        route_data = await self._routes(chain_slug, {
            "tokenIn": from_token,
            "tokenOut": to_token,
            "amountIn": amount,
        })
        route_summary = route_data.get("routeSummary") or {}
        router_address = route_data.get("routerAddress", "")
        if not route_summary or not router_address:
            raise KyberSwapError("KyberSwap returned no route to build", route_data)

        # 2. Encode the swap. slippageTolerance is in bps (50 = 0.5%).
        build_data = await self._build(chain_slug, {
            "routeSummary": route_summary,
            "sender": user_address,
            "recipient": user_address,
            "slippageTolerance": int(slippage * 100),
        })

        call_data = build_data.get("data")
        if not call_data:
            raise KyberSwapError("KyberSwap did not return transaction calldata", build_data)

        # Native sells carry value = amountIn; token sells use approve + value 0.
        is_native = from_token.lower() == KYBERSWAP_NATIVE_TOKEN.lower()
        value = str(build_data.get("amountIn", amount)) if is_native else "0"
        to_router = build_data.get("routerAddress") or router_address

        to_amount = str(build_data.get("amountOut", route_summary.get("amountOut", "0")))
        slippage_factor = 1 - (slippage / 100)
        to_amount_min = str(int(int(to_amount) * slippage_factor)) if to_amount != "0" else "0"

        tx_data = {
            "to": to_router,
            "data": call_data,
            "value": value,
        }
        # Only carry a gas estimate when it's a positive value — a "0" would
        # otherwise produce a 0-gas tx; the executor defaults to 500000 if absent.
        gas_est = build_data.get("gas") or route_summary.get("gas")
        try:
            if gas_est and int(gas_est) > 0:
                tx_data["gas"] = str(gas_est)
        except (ValueError, TypeError):
            pass

        return KyberSwapQuote(
            chain_slug=chain_slug,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount,
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            gas_usd=0.0,
            router_address=to_router,
            tx_data=tx_data,
            raw_response=build_data,
        )
