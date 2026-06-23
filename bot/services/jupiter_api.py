"""Jupiter API client for Solana swaps."""

import logging
from typing import Optional
from dataclasses import dataclass
import base64
import aiohttp

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames

logger = logging.getLogger(__name__)

# Jupiter retired quote-api.jup.ag/v6 (now NXDOMAIN); the public host is lite-api.jup.ag.
# /swap/v1 keeps the same /quote, /swap, /swap-instructions request+response shapes as v6.
JUPITER_BASE_URL = "https://lite-api.jup.ag/swap/v1"


@dataclass
class JupiterQuote:
    """Quote response from Jupiter API."""

    input_mint: str
    output_mint: str
    in_amount: str
    out_amount: str
    other_amount_threshold: str
    price_impact_pct: float
    route_plan: list[dict]
    slippage_bps: int
    raw_response: dict


@dataclass
class JupiterSwapTransaction:
    """Swap transaction from Jupiter API."""

    swap_transaction: str  # Base64 encoded transaction
    last_valid_block_height: int
    raw_response: dict


class JupiterAPI:
    """Client for Jupiter DEX aggregator API on Solana."""

    def __init__(self):
        self.base_url = JUPITER_BASE_URL
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    @track_time(MetricNames.API_JUPITER)
    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
    ) -> dict:
        """Make an API request to Jupiter."""
        # Apply rate limiting
        await api_limiter.wait_and_acquire("jupiter")

        url = f"{self.base_url}{endpoint}"

        # Use shared session with connection pooling
        session = await get_session()
        async with session.request(
            method,
            url,
            params=params,
            json=json_data,
            headers=self.headers,
        ) as response:
            data = await response.json()

            if response.status != 200:
                error_msg = data.get("error", "Unknown error")
                raise JupiterError(f"Jupiter API error: {error_msg}", data)

            return data

    async def get_quote(
        self,
        input_mint: str,
        output_mint: str,
        amount: str,
        slippage_bps: int = 50,
        only_direct_routes: bool = False,
        as_legacy_transaction: bool = False,
        platform_fee_bps: Optional[int] = None,
    ) -> JupiterQuote:
        """
        Get a quote for a Solana swap.

        Args:
            input_mint: Source token mint address
            output_mint: Destination token mint address
            amount: Amount in smallest unit (lamports, token base units)
            slippage_bps: Slippage tolerance in basis points (50 = 0.5%)
            only_direct_routes: Only use direct routes (faster but possibly worse price)
            as_legacy_transaction: Return legacy transaction format
            platform_fee_bps: Optional platform fee in basis points (100 = 1%).
                When set, Jupiter reserves this fee in the quote; it is only
                actually collected if a matching ``feeAccount`` (referral token
                account) is passed to the swap request.

        Returns:
            JupiterQuote with swap details
        """
        params = {
            "inputMint": input_mint,
            "outputMint": output_mint,
            "amount": amount,
            "slippageBps": slippage_bps,
            "onlyDirectRoutes": str(only_direct_routes).lower(),
            "asLegacyTransaction": str(as_legacy_transaction).lower(),
        }
        if platform_fee_bps:
            params["platformFeeBps"] = platform_fee_bps

        data = await self._request("GET", "/quote", params=params)

        return JupiterQuote(
            input_mint=data.get("inputMint", input_mint),
            output_mint=data.get("outputMint", output_mint),
            in_amount=data.get("inAmount", amount),
            out_amount=data.get("outAmount", "0"),
            other_amount_threshold=data.get("otherAmountThreshold", "0"),
            price_impact_pct=float(data.get("priceImpactPct", 0)),
            route_plan=data.get("routePlan", []),
            slippage_bps=slippage_bps,
            raw_response=data,
        )

    async def get_swap_transaction(
        self,
        quote_response: dict,
        user_public_key: str,
        wrap_and_unwrap_sol: bool = True,
        use_shared_accounts: bool = True,
        fee_account: Optional[str] = None,
        compute_unit_price_micro_lamports: Optional[int] = None,
        priority_level: str = "medium",
        max_lamports: int = 1_000_000,
        jito_tip_lamports: Optional[int] = None,
        as_legacy_transaction: bool = False,
        dynamic_compute_unit_limit: bool = True,
    ) -> JupiterSwapTransaction:
        """
        Get a swap transaction from a quote.

        Args:
            quote_response: Quote response from get_quote (raw_response)
            user_public_key: User's Solana public key
            wrap_and_unwrap_sol: Automatically wrap/unwrap SOL
            use_shared_accounts: Use shared accounts for better fees
            fee_account: Optional fee account for referral
            compute_unit_price_micro_lamports: Priority fee in micro-lamports
            priority_level: Priority level (medium, high, veryHigh)
            max_lamports: Ceiling for the Jupiter-estimated priority fee, in lamports
                (1_000_000 = 0.001 SOL). Raise it so higher-priority tiers can
                actually outbid for faster landing during congestion.
            jito_tip_lamports: When set, Jupiter bakes a Jito tip instruction into
                the tx instead of a priority fee — the tx must then be submitted to
                the Jito block engine (not a normal RPC) to land as an MEV-protected
                bundle. Takes precedence over priority_level/max_lamports.
            as_legacy_transaction: Return legacy transaction format
            dynamic_compute_unit_limit: Use dynamic compute unit limit

        Returns:
            JupiterSwapTransaction with transaction to sign
        """
        request_data = {
            "quoteResponse": quote_response,
            "userPublicKey": user_public_key,
            "wrapAndUnwrapSol": wrap_and_unwrap_sol,
            "useSharedAccounts": use_shared_accounts,
            "asLegacyTransaction": as_legacy_transaction,
            "dynamicComputeUnitLimit": dynamic_compute_unit_limit,
        }

        # Priority-fee strategy, mutually exclusive, in precedence order:
        #   1. Jito tip            → MEV-protected bundle (turbo tier)
        #   2. explicit per-CU price → live network estimate sent by the client
        #   3. priorityLevel + cap  → default tier behaviour
        if jito_tip_lamports:
            request_data["prioritizationFeeLamports"] = {"jitoTipLamports": jito_tip_lamports}
        elif compute_unit_price_micro_lamports:
            request_data["computeUnitPriceMicroLamports"] = compute_unit_price_micro_lamports
        else:
            request_data["prioritizationFeeLamports"] = {
                "priorityLevelWithMaxLamports": {
                    "maxLamports": max_lamports,
                    "priorityLevel": priority_level,
                }
            }

        if fee_account:
            request_data["feeAccount"] = fee_account

        try:
            data = await self._request("POST", "/swap", json_data=request_data)
        except JupiterError as exc:
            # Some routes (e.g. simple AMMs) reject shared accounts with
            # "Simple AMMs are not supported with shared accounts". Retry once
            # without them so the swap still builds rather than failing outright.
            if request_data.get("useSharedAccounts") and "shared account" in str(exc).lower():
                logger.info("Jupiter rejected shared accounts for this route; retrying without")
                request_data["useSharedAccounts"] = False
                data = await self._request("POST", "/swap", json_data=request_data)
            else:
                raise

        return JupiterSwapTransaction(
            swap_transaction=data.get("swapTransaction", ""),
            last_valid_block_height=data.get("lastValidBlockHeight", 0),
            raw_response=data,
        )

    async def get_swap_instructions(
        self,
        quote_response: dict,
        user_public_key: str,
        wrap_and_unwrap_sol: bool = True,
        use_shared_accounts: bool = True,
        fee_account: Optional[str] = None,
    ) -> dict:
        """
        Get raw swap instructions from Jupiter API.

        Args:
            quote_response: Quote response from get_quote
            user_public_key: User's Solana public key
            wrap_and_unwrap_sol: Automatically wrap/unwrap SOL
            use_shared_accounts: Use shared accounts
            fee_account: Optional fee account

        Returns:
            Dict containing instructions, address lookup tables, etc.
        """
        request_data = {
            "quoteResponse": quote_response,
            "userPublicKey": user_public_key,
            "wrapAndUnwrapSol": wrap_and_unwrap_sol,
            "useSharedAccounts": use_shared_accounts,
        }

        if fee_account:
            request_data["feeAccount"] = fee_account

        return await self._request("POST", "/swap-instructions", json_data=request_data)

    async def get_price(self, token_ids: list[str]) -> dict[str, dict]:
        """
        Get token prices.

        Args:
            token_ids: List of token mint addresses

        Returns:
            Dict of token_id -> price info
        """
        # price.jup.ag/v6 is dead; Price API v3 lives at lite-api.jup.ag/price/v3 and
        # returns { <mint>: { usdPrice, ... } } (no "data" wrapper, field renamed).
        # Adapt back to the { <mint>: { price } } shape callers expect.
        url = "https://lite-api.jup.ag/price/v3"

        params = {
            "ids": ",".join(token_ids),
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                data = await response.json()
                return {
                    mint: {"price": info.get("usdPrice", info.get("price"))}
                    for mint, info in (data or {}).items()
                    if isinstance(info, dict)
                }

    async def get_token_list(self) -> list[dict]:
        """Get list of all tradeable tokens on Jupiter."""
        url = "https://token.jup.ag/all"

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                return await response.json()

    def decode_transaction(self, base64_transaction: str) -> bytes:
        """
        Decode a base64 encoded transaction.

        Args:
            base64_transaction: Base64 encoded transaction string

        Returns:
            Transaction bytes
        """
        return base64.b64decode(base64_transaction)


# Common Solana token mint addresses
SOLANA_TOKENS = {
    "SOL": "So11111111111111111111111111111111111111112",  # Wrapped SOL
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
}


class JupiterError(Exception):
    """Exception raised for Jupiter API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)
