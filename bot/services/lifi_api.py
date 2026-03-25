"""Li.Fi API client for cross-chain swaps."""

from typing import Optional, Any
from dataclasses import dataclass
from bot.config.settings import settings
from bot.config.chains import get_chain_by_name
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames


LIFI_BASE_URL = "https://li.quest/v1"


@dataclass
class LiFiQuote:
    """Quote response from Li.Fi API."""
    id: str
    from_chain_id: int
    to_chain_id: int
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    gas_cost_usd: float
    fee_cost_usd: float
    estimated_time: int  # seconds
    tool: str  # Bridge/DEX used
    transaction_request: dict  # Transaction to sign
    raw_response: dict


@dataclass
class LiFiStatus:
    """Transaction status from Li.Fi API."""
    status: str  # PENDING, DONE, FAILED
    substatus: Optional[str]
    receiving_chain_id: Optional[int]
    receiving_tx_hash: Optional[str]
    sending_tx_hash: Optional[str]
    tool: Optional[str]
    raw_response: dict


class LiFiAPI:
    """Client for Li.Fi cross-chain swap API."""
    
    def __init__(self):
        self.base_url = LIFI_BASE_URL
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if settings.lifi_api_key:
            self.headers["x-lifi-api-key"] = settings.lifi_api_key
    
    @track_time(MetricNames.API_LIFI)
    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
    ) -> dict:
        """Make an API request to Li.Fi."""
        # Apply rate limiting
        await api_limiter.wait_and_acquire("lifi")
        
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
                error_msg = data.get("message", "Unknown error")
                raise LiFiError(f"Li.Fi API error: {error_msg}", data)
            
            return data
    
    async def get_chains(self) -> list[dict]:
        """Get list of supported chains."""
        data = await self._request("GET", "/chains")
        return data.get("chains", [])
    
    async def get_tokens(self, chain_id: Optional[int] = None) -> list[dict]:
        """Get list of supported tokens, optionally filtered by chain."""
        params = {}
        if chain_id:
            params["chains"] = str(chain_id)
        
        data = await self._request("GET", "/tokens", params=params)
        return data.get("tokens", {})
    
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
        integrator: Optional[str] = None,
        fee: float = 0.008,  # 0.8% integrator fee (80 bips)
        from_amount_for_gas: Optional[str] = None,
        max_price_impact: Optional[float] = None,
        prefer_bridges: Optional[list[str]] = None,
        prefer_exchanges: Optional[list[str]] = None,
    ) -> LiFiQuote:
        """
        Get a quote for a cross-chain swap.
        
        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            from_token: Source token address
            to_token: Destination token address
            from_amount: Amount in smallest unit (wei, lamports)
            from_address: Sender wallet address
            to_address: Receiver wallet address (defaults to from_address)
            slippage: Slippage tolerance as percentage (0.5 = 0.5%)
            integrator: Integrator identifier
            
        Returns:
            LiFiQuote with swap details
        """
        from_chain_config = get_chain_by_name(from_chain)
        to_chain_config = get_chain_by_name(to_chain)
        
        if not from_chain_config or not to_chain_config:
            raise LiFiError("Invalid chain name")
        
        params = {
            "fromChain": str(from_chain_config.lifi_chain_id),
            "toChain": str(to_chain_config.lifi_chain_id),
            "fromToken": from_token,
            "toToken": to_token,
            "fromAmount": from_amount,
            "fromAddress": from_address,
            "toAddress": to_address or from_address,
            "slippage": slippage / 100,  # Convert percentage to decimal
            "integrator": integrator or settings.lifi_integrator_id,
            "fee": fee,  # Integrator fee collected by LiFi FeeCollection contract
        }

        # LI.Fuel: receive native gas tokens on destination chain
        if from_amount_for_gas:
            params["fromAmountForGas"] = str(from_amount_for_gas)

        # Route quality controls
        if max_price_impact is not None:
            params["maxPriceImpact"] = max_price_impact
        if prefer_bridges:
            params["preferBridges"] = ",".join(prefer_bridges)
        if prefer_exchanges:
            params["preferExchanges"] = ",".join(prefer_exchanges)
        
        data = await self._request("GET", "/quote", params=params)
        
        # Extract relevant data
        estimate = data.get("estimate", {})
        action = data.get("action", {})
        
        # Calculate costs
        gas_costs = estimate.get("gasCosts", [])
        gas_cost_usd = sum(float(g.get("amountUSD", 0)) for g in gas_costs)
        
        fee_costs = estimate.get("feeCosts", [])
        fee_cost_usd = sum(float(f.get("amountUSD", 0)) for f in fee_costs)
        
        return LiFiQuote(
            id=data.get("id", ""),
            from_chain_id=int(action.get("fromChainId", 0)),
            to_chain_id=int(action.get("toChainId", 0)),
            from_token=action.get("fromToken", {}).get("address", ""),
            to_token=action.get("toToken", {}).get("address", ""),
            from_amount=estimate.get("fromAmount", from_amount),
            to_amount=estimate.get("toAmount", "0"),
            to_amount_min=estimate.get("toAmountMin", "0"),
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=fee_cost_usd,
            estimated_time=estimate.get("executionDuration", 300),
            tool=data.get("tool", ""),
            transaction_request=data.get("transactionRequest", {}),
            raw_response=data,
        )
    
    async def get_status(
        self,
        tx_hash: str,
        from_chain: str,
        to_chain: str,
    ) -> LiFiStatus:
        """
        Get the status of a cross-chain transaction.
        
        Args:
            tx_hash: Source chain transaction hash
            from_chain: Source chain name
            to_chain: Destination chain name
            
        Returns:
            LiFiStatus with transaction status
        """
        from_chain_config = get_chain_by_name(from_chain)
        to_chain_config = get_chain_by_name(to_chain)
        
        if not from_chain_config or not to_chain_config:
            raise LiFiError("Invalid chain name")
        
        params = {
            "txHash": tx_hash,
            "fromChain": str(from_chain_config.lifi_chain_id),
            "toChain": str(to_chain_config.lifi_chain_id),
        }
        
        data = await self._request("GET", "/status", params=params)
        
        return LiFiStatus(
            status=data.get("status", "PENDING"),
            substatus=data.get("substatus"),
            receiving_chain_id=data.get("receiving", {}).get("chainId"),
            receiving_tx_hash=data.get("receiving", {}).get("txHash"),
            sending_tx_hash=data.get("sending", {}).get("txHash"),
            tool=data.get("tool"),
            raw_response=data,
        )
    
    async def get_routes(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
    ) -> list[dict]:
        """
        Get multiple route options for a swap.
        
        Returns:
            List of route options sorted by output amount
        """
        from_chain_config = get_chain_by_name(from_chain)
        to_chain_config = get_chain_by_name(to_chain)
        
        if not from_chain_config or not to_chain_config:
            raise LiFiError("Invalid chain name")
        
        request_data = {
            "fromChainId": from_chain_config.lifi_chain_id,
            "toChainId": to_chain_config.lifi_chain_id,
            "fromTokenAddress": from_token,
            "toTokenAddress": to_token,
            "fromAmount": from_amount,
            "fromAddress": from_address,
            "toAddress": to_address or from_address,
            "options": {
                "slippage": slippage / 100,
                "order": "RECOMMENDED",
            }
        }
        
        data = await self._request("POST", "/advanced/routes", json_data=request_data)
        return data.get("routes", [])
    
    async def build_transaction(self, route: dict) -> dict:
        """
        Build a transaction from a route.
        
        Args:
            route: Route object from get_routes
            
        Returns:
            Transaction request object
        """
        data = await self._request("POST", "/advanced/stepTransaction", json_data={
            "route": route,
        })
        return data.get("transactionRequest", {})


class LiFiError(Exception):
    """Exception raised for Li.Fi API errors."""
    
    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)

