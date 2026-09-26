"""Socket (Bungee) API client for super-aggregated swaps and bridges.

Socket is unique because it aggregates:
- 18+ bridges (Across, Stargate, Hop, Celer, Hyphen, Connext, etc.)
- 15+ DEXes (Uniswap, 1inch, Paraswap, 0x, etc.)
- Finds the absolute cheapest route by comparing ALL options
- Can combine bridge + swap in a single optimized route
"""

import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum


from bot.config.settings import settings
from bot.utils.http_client import get_session, with_retry
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Socket API configuration
SOCKET_API_URL = "https://api.socket.tech/v2"

# Socket chain IDs (same as standard EVM chain IDs)
SOCKET_CHAIN_IDS = {
    "ethereum": 1,
    "polygon": 137,
    "bsc": 56,
    "arbitrum": 42161,
    "optimism": 10,
    "avalanche": 43114,
    "fantom": 250,
    "base": 8453,
    "gnosis": 100,
    "linea": 59144,
    "scroll": 534352,
    "mantle": 5000,
    "aurora": 1313161554,
    "zksync": 324,
}

# Socket supports these bridges
SOCKET_BRIDGES = [
    "across",
    "stargate",
    "hop",
    "celer",
    "hyphen",
    "connext",
    "anyswap",
    "synapse",
    "refuel",
    "cctp",
]

# Socket supports these DEXes
SOCKET_DEXES = [
    "uniswap",
    "1inch",
    "paraswap",
    "0x",
    "kyberswap",
    "openocean",
    "odos",
]


class SortBy(str, Enum):
    """Sort criteria for routes."""

    OUTPUT = "output"  # Best output amount
    GAS = "gas"  # Lowest gas cost
    TIME = "time"  # Fastest route


@dataclass
class SocketRoute:
    """A route option from Socket."""

    route_id: str
    from_chain_id: int
    to_chain_id: int
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_human: float
    gas_usd: float
    service_fee_usd: float
    total_fee_usd: float
    estimated_time_seconds: int
    bridge_name: str
    dex_names: List[str]
    steps: List[Dict[str, Any]]
    user_tx_count: int
    raw_route: Dict[str, Any]


@dataclass
class SocketQuote:
    """Quote from Socket with multiple route options."""

    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    routes: List[SocketRoute]
    best_route: Optional[SocketRoute]
    raw_response: Dict[str, Any]


@dataclass
class SocketTx:
    """Transaction data for executing a Socket route."""

    chain_id: int
    to: str
    data: str
    value: str
    gas_limit: str
    tx_type: str  # "approval" or "swap"
    approval_data: Optional[Dict[str, Any]]
    raw_response: Dict[str, Any]


@dataclass
class SocketStatus:
    """Status of a Socket transaction."""

    source_tx: str
    dest_tx: Optional[str]
    from_chain_id: int
    to_chain_id: int
    status: str  # "pending", "completed", "failed"
    substatus: Optional[str]
    raw_response: Dict[str, Any]


class SocketError(Exception):
    """Exception for Socket API errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class SocketAPI:
    """Client for Socket super-aggregated swaps and bridges.

    Socket finds the absolute best route by comparing ALL available options:
    - All major bridges (Across, Stargate, Hop, etc.)
    - All major DEXes (Uniswap, 1inch, etc.)
    - Combines bridge + swap when needed

    This is the ultimate aggregator.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or getattr(settings, "socket_api_key", None)

    def _get_headers(self) -> Dict[str, str]:
        """Get API headers."""
        headers = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["API-KEY"] = self.api_key
        return headers

    def is_supported_chain(self, chain: str) -> bool:
        """Check if Socket supports this chain."""
        return chain.lower() in SOCKET_CHAIN_IDS

    def get_chain_id(self, chain: str) -> int:
        """Get Socket chain ID."""
        chain_id = SOCKET_CHAIN_IDS.get(chain.lower())
        if chain_id is None:
            raise SocketError(f"Chain not supported by Socket: {chain}")
        return chain_id

    def get_supported_chains(self) -> List[str]:
        """Get list of supported chains."""
        return list(SOCKET_CHAIN_IDS.keys())

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        sort_by: SortBy = SortBy.OUTPUT,
        unique_routes: bool = True,
        include_bridges: Optional[List[str]] = None,
        exclude_bridges: Optional[List[str]] = None,
        include_dexes: Optional[List[str]] = None,
        exclude_dexes: Optional[List[str]] = None,
        single_tx_only: bool = False,
    ) -> SocketQuote:
        """
        Get quotes from Socket super-aggregator.

        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            from_token: Source token address
            to_token: Destination token address
            from_amount: Amount in smallest units
            from_address: User's address
            to_address: Destination address (defaults to from_address)
            sort_by: Sort criteria (output, gas, time)
            unique_routes: Only return unique routes
            include_bridges: Only include these bridges
            exclude_bridges: Exclude these bridges
            include_dexes: Only include these DEXes
            exclude_dexes: Exclude these DEXes
            single_tx_only: Only routes with single transaction

        Returns:
            SocketQuote with all route options
        """
        from_chain_id = self.get_chain_id(from_chain)
        to_chain_id = self.get_chain_id(to_chain)
        to_address = to_address or from_address

        await api_limiter.wait_and_acquire("socket")

        session = await get_session()

        # Build query params
        params = {
            "fromChainId": from_chain_id,
            "toChainId": to_chain_id,
            "fromTokenAddress": from_token,
            "toTokenAddress": to_token,
            "fromAmount": from_amount,
            "userAddress": from_address,
            "recipient": to_address,
            "sort": sort_by.value,
            "uniqueRoutesPerBridge": str(unique_routes).lower(),
            "singleTxOnly": str(single_tx_only).lower(),
        }

        if include_bridges:
            params["includeBridges"] = ",".join(include_bridges)
        if exclude_bridges:
            params["excludeBridges"] = ",".join(exclude_bridges)
        if include_dexes:
            params["includeDexes"] = ",".join(include_dexes)
        if exclude_dexes:
            params["excludeDexes"] = ",".join(exclude_dexes)

        async def _do_quote():
            import aiohttp as _aiohttp

            async with session.get(
                f"{SOCKET_API_URL}/quote",
                params=params,
                headers=self._get_headers(),
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise _aiohttp.ClientResponseError(
                        response.request_info,
                        response.history,
                        status=response.status,
                        message=error_text[:200],
                    )
                return await response.json()

        try:
            data = await with_retry(_do_quote, label="Socket quote", base_delay=0.5)
        except Exception as exc:
            raise SocketError(f"Socket quote error: {exc}") from exc

        if not data.get("success"):
            raise SocketError(f"Socket quote failed: {data.get('message', 'Unknown error')}", data)

        result = data.get("result", {})
        routes_data = result.get("routes", [])

        routes = []
        for route_data in routes_data:
            route = self._parse_route(route_data, from_chain, to_chain)
            routes.append(route)

        best_route = routes[0] if routes else None

        return SocketQuote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=from_amount,
            routes=routes,
            best_route=best_route,
            raw_response=data,
        )

    def _parse_route(
        self,
        route_data: Dict[str, Any],
        from_chain: str,
        to_chain: str,
    ) -> SocketRoute:
        """Parse a route from Socket response."""
        user_txs = route_data.get("userTxs", [])

        # Get bridge and DEX names
        bridge_name = "unknown"
        dex_names = []
        steps = []

        for tx in user_txs:
            for step in tx.get("steps", []):
                step_type = step.get("type")
                protocol = step.get("protocol", {})

                if step_type == "bridge":
                    bridge_name = protocol.get("name", "unknown")
                elif step_type == "swap":
                    dex_names.append(protocol.get("name", "unknown"))

                steps.append(
                    {
                        "type": step_type,
                        "protocol": protocol.get("name"),
                        "from_token": step.get("fromToken", {}).get("symbol"),
                        "to_token": step.get("toToken", {}).get("symbol"),
                        "from_amount": step.get("fromAmount"),
                        "to_amount": step.get("toAmount"),
                    }
                )

        # Calculate fees
        gas_usd = float(route_data.get("totalGasFeesInUsd", 0))
        service_fee_usd = float(route_data.get("integrationFee", {}).get("feeTakenInUsd", 0))
        total_fee_usd = gas_usd + service_fee_usd

        # Parse output amount
        to_amount = route_data.get("toAmount", "0")
        to_decimals = route_data.get("toAsset", {}).get("decimals", 18)
        to_amount_human = int(to_amount) / (10**to_decimals)

        return SocketRoute(
            route_id=route_data.get("routeId", ""),
            from_chain_id=self.get_chain_id(from_chain),
            to_chain_id=self.get_chain_id(to_chain),
            from_token=route_data.get("fromAsset", {}).get("address", ""),
            to_token=route_data.get("toAsset", {}).get("address", ""),
            from_amount=route_data.get("fromAmount", "0"),
            to_amount=to_amount,
            to_amount_human=to_amount_human,
            gas_usd=gas_usd,
            service_fee_usd=service_fee_usd,
            total_fee_usd=total_fee_usd,
            estimated_time_seconds=route_data.get("serviceTime", 0),
            bridge_name=bridge_name,
            dex_names=dex_names,
            steps=steps,
            user_tx_count=len(user_txs),
            raw_route=route_data,
        )

    async def build_tx(
        self,
        route: SocketRoute,
    ) -> SocketTx:
        """
        Build transaction for a route.

        Args:
            route: Route from get_quote

        Returns:
            SocketTx with transaction data
        """
        await api_limiter.wait_and_acquire("socket")

        session = await get_session()

        async with session.post(
            f"{SOCKET_API_URL}/build-tx",
            json={"route": route.raw_route},
            headers=self._get_headers(),
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise SocketError(f"Socket build-tx error: {error_text}")

            data = await response.json()

        if not data.get("success"):
            raise SocketError(
                f"Socket build-tx failed: {data.get('message', 'Unknown error')}", data
            )

        result = data.get("result", {})
        tx_data = result.get("txData", {})

        # Check if approval is needed
        approval_data = None
        if result.get("approvalData"):
            approval_data = result["approvalData"]

        return SocketTx(
            chain_id=tx_data.get("chainId", route.from_chain_id),
            to=tx_data.get("to", ""),
            data=tx_data.get("data", ""),
            value=tx_data.get("value", "0"),
            gas_limit=str(tx_data.get("gasLimit", 500000)),
            tx_type="swap",
            approval_data=approval_data,
            raw_response=data,
        )

    async def check_allowance(
        self,
        chain: str,
        token_address: str,
        owner: str,
        spender: str,
    ) -> str:
        """Check token allowance."""
        chain_id = self.get_chain_id(chain)

        await api_limiter.wait_and_acquire("socket")

        session = await get_session()

        params = {
            "chainId": chain_id,
            "tokenAddress": token_address,
            "owner": owner,
            "spender": spender,
        }

        async with session.get(
            f"{SOCKET_API_URL}/approval/check-allowance", params=params, headers=self._get_headers()
        ) as response:
            if response.status != 200:
                return "0"

            data = await response.json()

        return data.get("result", {}).get("value", "0")

    async def build_approval_tx(
        self,
        chain: str,
        token_address: str,
        owner: str,
        spender: str,
        amount: str,
    ) -> Dict[str, Any]:
        """Build approval transaction."""
        chain_id = self.get_chain_id(chain)

        await api_limiter.wait_and_acquire("socket")

        session = await get_session()

        params = {
            "chainId": chain_id,
            "tokenAddress": token_address,
            "owner": owner,
            "allowanceTarget": spender,
            "amount": amount,
        }

        async with session.get(
            f"{SOCKET_API_URL}/approval/build-tx", params=params, headers=self._get_headers()
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise SocketError(f"Socket approval-tx error: {error_text}")

            data = await response.json()

        return data.get("result", {})

    async def get_bridge_status(
        self,
        source_tx_hash: str,
        from_chain: str,
        to_chain: str,
    ) -> SocketStatus:
        """
        Get status of a bridge transaction.

        Args:
            source_tx_hash: Transaction hash on source chain
            from_chain: Source chain name
            to_chain: Destination chain name

        Returns:
            SocketStatus with current status
        """
        from_chain_id = self.get_chain_id(from_chain)
        to_chain_id = self.get_chain_id(to_chain)

        await api_limiter.wait_and_acquire("socket")

        session = await get_session()

        params = {
            "transactionHash": source_tx_hash,
            "fromChainId": from_chain_id,
            "toChainId": to_chain_id,
        }

        async with session.get(
            f"{SOCKET_API_URL}/bridge-status", params=params, headers=self._get_headers()
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.warning(f"Socket status error: {error_text}")
                return SocketStatus(
                    source_tx=source_tx_hash,
                    dest_tx=None,
                    from_chain_id=from_chain_id,
                    to_chain_id=to_chain_id,
                    status="pending",
                    substatus=None,
                    raw_response={},
                )

            data = await response.json()

        result = data.get("result", {})

        # Parse status
        source_status = result.get("sourceTxStatus", "PENDING")
        dest_status = result.get("destinationTxStatus", "PENDING")

        if dest_status == "COMPLETED":
            status = "completed"
        elif source_status == "FAILED" or dest_status == "FAILED":
            status = "failed"
        else:
            status = "pending"

        return SocketStatus(
            source_tx=source_tx_hash,
            dest_tx=result.get("destinationTransactionHash"),
            from_chain_id=from_chain_id,
            to_chain_id=to_chain_id,
            status=status,
            substatus=result.get("bridgeStatus"),
            raw_response=data,
        )

    async def get_supported_tokens(
        self,
        chain: str,
    ) -> List[Dict[str, Any]]:
        """Get supported tokens on a chain."""
        chain_id = self.get_chain_id(chain)

        await api_limiter.wait_and_acquire("socket")

        session = await get_session()

        async with session.get(
            f"{SOCKET_API_URL}/token-lists/from-token-list",
            params={"fromChainId": chain_id},
            headers=self._get_headers(),
        ) as response:
            if response.status != 200:
                return []

            data = await response.json()

        return data.get("result", [])


# Global instance
socket_api = SocketAPI()
