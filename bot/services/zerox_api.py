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
ZEROX_CROSS_CHAIN_QUOTES_PATH = "/cross-chain/quotes"
ZEROX_CROSS_CHAIN_STATUS_PATH = "/cross-chain/status"

# 0x uses native EVM chain IDs (integers in v2).
ZEROX_CHAIN_IDS = {
    "ethereum": 1,
    "base": 8453,
    "arbitrum": 42161,
    "optimism": 10,
    "polygon": 137,
    "bsc": 56,
    "avalanche": 43114,
    "robinhood": 4663,
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


@dataclass
class ZeroXCrossChainQuote:
    """Best ready-to-sign route returned by 0x Cross-Chain API."""

    origin_chain_id: int
    destination_chain_id: int
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    estimated_gas: str
    estimated_time: int
    quote_id: str
    tx_data: dict
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

    @staticmethod
    def _fee_params(platform_fee_bps: Optional[int], sell_token: str) -> dict:
        """Build 0x partner-fee params, gated on (fee bps AND collector set).

        0x's swapFeeBps must be 0–1000 (clamped). The fee is charged on the
        sellToken (input side) and forwarded to swapFeeRecipient. Returns an
        empty dict when the fee is off so default behavior is unchanged.
        """
        collector = settings.fee_collector_address
        if not platform_fee_bps or not collector:
            return {}
        bps = max(0, min(int(platform_fee_bps), 1000))
        if bps <= 0:
            return {}
        return {
            "swapFeeRecipient": collector,
            "swapFeeBps": bps,
            "swapFeeToken": sell_token,
        }

    @staticmethod
    def _cross_chain_fee_params(platform_fee_bps: Optional[int], sell_token: str) -> dict:
        """Build Cross-Chain API fee params using the same fee/collector gate.

        Cross-Chain uses ``feeBps``/``feeRecipient`` rather than Swap API's
        ``swapFee*`` names. Fees are charged from the origin sell amount, so
        pass the source token explicitly for auditability even though 0x
        currently defaults ``feeToken`` to ``sellToken``.
        """
        collector = settings.fee_collector_address
        if not platform_fee_bps or not collector:
            return {}
        bps = max(0, min(int(platform_fee_bps), 10_000))
        if bps <= 0:
            return {}
        return {
            "feeRecipient": collector,
            "feeBps": bps,
            "feeToken": sell_token,
        }

    async def get_quote(
        self,
        chain_id: int,
        from_token: str,
        to_token: str,
        amount: str,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
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
            **self._fee_params(platform_fee_bps, from_token),
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
        platform_fee_bps: Optional[int] = None,
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
            **self._fee_params(platform_fee_bps, from_token),
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

    async def get_cross_chain_quote(
        self,
        origin_chain_id: int,
        destination_chain_id: int,
        from_token: str,
        to_token: str,
        amount: str,
        origin_address: str,
        destination_address: Optional[str] = None,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
    ) -> ZeroXCrossChainQuote:
        """Get 0x's best ready-to-sign EVM cross-chain route.

        ``destination_address`` is always supplied by Suwappu's Robinhood
        flow so the provider cannot silently fall back to a different wallet.
        The endpoint may combine an origin swap, bridge, and destination swap
        into the single transaction returned in ``transaction.details``.
        """
        params = {
            "originChain": origin_chain_id,
            "destinationChain": destination_chain_id,
            "sellToken": from_token,
            "buyToken": to_token,
            "sellAmount": amount,
            "originAddress": origin_address,
            "destinationAddress": destination_address or origin_address,
            "slippageBps": self._slippage_bps(slippage),
            "sortQuotesBy": "price",
            "maxNumQuotes": 1,
            **self._cross_chain_fee_params(platform_fee_bps, from_token),
        }

        data = await self._request(ZEROX_CROSS_CHAIN_QUOTES_PATH, params)
        routes = data.get("quotes") or []
        if not data.get("liquidityAvailable", bool(routes)) or not routes:
            raise ZeroXError("0x Cross-Chain API returned no route", data)

        route = routes[0]
        tx = (route.get("transaction") or {}).get("details") or {}
        if (route.get("transaction") or {}).get("chainType") != "evm" or not tx:
            raise ZeroXError("0x Cross-Chain API did not return an EVM transaction", data)

        to_amount = str(route.get("buyAmount", "0"))
        if to_amount == "0":
            raise ZeroXError("0x Cross-Chain API returned an empty output", data)

        to_amount_min = route.get("minBuyAmount")
        if to_amount_min is None:
            slippage_factor = 1 - (slippage / 100)
            to_amount_min = str(int(int(to_amount) * slippage_factor))
        else:
            to_amount_min = str(to_amount_min)

        gas_costs = route.get("gasCosts") or {}
        estimated_gas = str(gas_costs.get("gasLimit") or tx.get("gas") or "0")

        return ZeroXCrossChainQuote(
            origin_chain_id=int(data.get("originChainId") or origin_chain_id),
            destination_chain_id=int(data.get("destinationChainId") or destination_chain_id),
            from_token=str(data.get("sellToken") or from_token),
            to_token=str(data.get("buyToken") or to_token),
            from_amount=str(route.get("sellAmount") or amount),
            to_amount=to_amount,
            to_amount_min=to_amount_min,
            estimated_gas=estimated_gas,
            estimated_time=int(route.get("estimatedTimeSeconds") or 0),
            quote_id=str(route.get("quoteId") or ""),
            tx_data=tx,
            raw_response=data,
        )

    async def get_cross_chain_status(
        self,
        origin_chain_id: int,
        origin_tx_hash: str,
        quote_id: Optional[str] = None,
    ) -> dict:
        """Return 0x Cross-Chain lifecycle state for a submitted origin tx."""
        params = {
            "originChain": origin_chain_id,
            "originTxHash": origin_tx_hash,
            "quoteId": quote_id,
        }
        return await self._request(ZEROX_CROSS_CHAIN_STATUS_PATH, params)
