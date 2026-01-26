"""Jupiter API client for Solana swaps."""

from typing import Optional
from dataclasses import dataclass
import base64
import aiohttp

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames


JUPITER_BASE_URL = "https://quote-api.jup.ag/v6"


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
            priority_level: Priority level (low, medium, high, very_high)
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
            "prioritizationFeeLamports": {
                "priorityLevelWithMaxLamports": {
                    "maxLamports": 1000000,
                    "priorityLevel": priority_level,
                }
            }
        }
        
        if fee_account:
            request_data["feeAccount"] = fee_account
        
        if compute_unit_price_micro_lamports:
            request_data["computeUnitPriceMicroLamports"] = compute_unit_price_micro_lamports
        
        data = await self._request("POST", "/swap", json_data=request_data)
        
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
        # Jupiter Price API v2
        url = "https://price.jup.ag/v6/price"
        
        params = {
            "ids": ",".join(token_ids),
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                data = await response.json()
                return data.get("data", {})
    
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

