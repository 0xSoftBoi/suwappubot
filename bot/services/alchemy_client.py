"""
Alchemy API client for enhanced blockchain data.

Provides access to Alchemy's full suite:
- Enhanced RPC (faster, more reliable)
- Token API (balances, metadata)
- NFT API (metadata, ownership)
- Transaction simulation
- Webhook subscriptions
"""

import logging
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from decimal import Decimal
import aiohttp

from bot.config.settings import settings
from bot.utils.http_client import get_session as get_http_session

logger = logging.getLogger(__name__)


class AlchemyRateLimitError(Exception):
    """Raised when Alchemy returns 429 or circuit breaker is open."""

    pass


class _CircuitBreaker:
    """Simple circuit breaker for Alchemy API rate limits."""

    def __init__(self):
        self._open_until: float = 0.0
        self._consecutive_429s: int = 0

    @property
    def is_open(self) -> bool:
        return time.monotonic() < self._open_until

    def record_429(self):
        self._consecutive_429s += 1
        backoff = min(300, 30 * (2 ** (self._consecutive_429s - 1)))
        self._open_until = time.monotonic() + backoff
        logger.warning(
            f"Alchemy circuit breaker OPEN for {backoff}s "
            f"(consecutive 429s: {self._consecutive_429s})"
        )

    def record_success(self):
        if self._consecutive_429s > 0:
            logger.info("Alchemy circuit breaker CLOSED (successful request)")
        self._consecutive_429s = 0
        self._open_until = 0.0

    def check(self):
        if self.is_open:
            raise AlchemyRateLimitError("Alchemy circuit breaker is open — rate limited")


alchemy_circuit = _CircuitBreaker()


# Alchemy network mappings
ALCHEMY_NETWORKS = {
    "ethereum": "eth-mainnet",
    "polygon": "polygon-mainnet",
    "arbitrum": "arb-mainnet",
    "optimism": "opt-mainnet",
    "base": "base-mainnet",
    # Testnets
    "ethereum-sepolia": "eth-sepolia",
    "polygon-amoy": "polygon-amoy",
    "arbitrum-sepolia": "arb-sepolia",
    "base-sepolia": "base-sepolia",
}

# Chains not supported by Alchemy
UNSUPPORTED_CHAINS = {"bsc", "solana"}


@dataclass
class TokenBalance:
    """Token balance with metadata."""

    contract_address: str
    symbol: str
    name: str
    decimals: int
    balance: str  # Raw balance (wei)
    balance_formatted: float  # Human-readable balance
    logo_url: Optional[str] = None
    usd_value: Optional[float] = None


@dataclass
class TokenMetadata:
    """Token metadata from Alchemy."""

    address: str
    symbol: str
    name: str
    decimals: int
    logo_url: Optional[str] = None
    total_supply: Optional[str] = None


@dataclass
class AssetTransfer:
    """Asset transfer record from Alchemy."""

    block_num: int
    block_hash: str
    tx_hash: str
    from_address: str
    to_address: str
    value: Optional[float]
    asset: str
    category: str  # "external", "internal", "erc20", "erc721", "erc1155"
    raw_contract: Optional[Dict[str, Any]] = None
    block_timestamp: Optional[str] = None  # ISO timestamp from withMetadata


@dataclass
class SimulationResult:
    """Transaction simulation result."""

    success: bool
    gas_used: int
    gas_limit: int
    return_data: Optional[str] = None
    error: Optional[str] = None
    state_changes: Optional[List[Dict]] = None


class AlchemyClient:
    """
    Client for Alchemy's enhanced blockchain APIs.

    Supports Token API, NFT API, transaction simulation, and webhooks.
    """

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Alchemy client.

        Args:
            api_key: Alchemy API key (uses settings if not provided)
        """
        self._api_key = api_key or settings.alchemy_api_key

        if not self._api_key:
            logger.warning("Alchemy API key not configured - using fallback RPCs")

    @property
    def is_configured(self) -> bool:
        """Check if Alchemy is configured."""
        return bool(self._api_key)

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get the shared, pooled HTTP session (see bot/utils/http_client.py)."""
        return await get_http_session()

    async def close(self):
        """No-op: the underlying session is shared/global and closed centrally
        on app shutdown (bot.utils.http_client.close_session), not per-instance."""
        pass

    def _get_base_url(self, chain: str) -> Optional[str]:
        """Get Alchemy base URL for a chain."""
        if not self._api_key:
            return None

        network = ALCHEMY_NETWORKS.get(chain.lower())
        if not network:
            return None

        return f"https://{network}.g.alchemy.com/v2/{self._api_key}"

    def _get_nft_url(self, chain: str) -> Optional[str]:
        """Get Alchemy NFT API URL for a chain."""
        if not self._api_key:
            return None

        network = ALCHEMY_NETWORKS.get(chain.lower())
        if not network:
            return None

        return f"https://{network}.g.alchemy.com/nft/v3/{self._api_key}"

    def supports_chain(self, chain: str) -> bool:
        """Check if Alchemy supports a chain."""
        return chain.lower() in ALCHEMY_NETWORKS and chain.lower() not in UNSUPPORTED_CHAINS

    # === Token API ===

    async def get_token_balances(
        self,
        address: str,
        chain: str = "ethereum",
        include_spam: bool = False,
    ) -> List[TokenBalance]:
        """
        Get all token balances for an address.

        Args:
            address: Wallet address
            chain: Chain name (ethereum, polygon, etc.)
            include_spam: Include suspected spam tokens

        Returns:
            List of TokenBalance objects
        """
        base_url = self._get_base_url(chain)
        if not base_url:
            logger.warning(f"Alchemy not available for chain: {chain}")
            return []

        session = await self._get_session()

        # Call alchemy_getTokenBalances
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_getTokenBalances",
            "params": [address, "erc20"],
        }

        try:
            async with session.post(base_url, json=payload) as response:
                if response.status != 200:
                    logger.error(f"Alchemy token balances failed: {await response.text()}")
                    return []

                result = await response.json()

            if "error" in result:
                logger.error(f"Alchemy error: {result['error']}")
                return []

            token_data = result.get("result", {}).get("tokenBalances", [])

            # Filter and enrich with metadata
            balances = []
            for token in token_data:
                if token.get("tokenBalance") == "0x0":
                    continue

                contract = token.get("contractAddress")
                raw_balance = int(token.get("tokenBalance", "0"), 16)

                if raw_balance == 0:
                    continue

                # Get token metadata
                metadata = await self.get_token_metadata(contract, chain)
                if not metadata:
                    continue

                if not include_spam and self._is_spam_token(metadata):
                    continue

                balance_formatted = raw_balance / (10**metadata.decimals)

                balances.append(
                    TokenBalance(
                        contract_address=contract,
                        symbol=metadata.symbol,
                        name=metadata.name,
                        decimals=metadata.decimals,
                        balance=str(raw_balance),
                        balance_formatted=balance_formatted,
                        logo_url=metadata.logo_url,
                    )
                )

            return balances

        except Exception as e:
            logger.error(f"Failed to get token balances: {e}")
            return []

    async def get_token_metadata(
        self,
        contract_address: str,
        chain: str = "ethereum",
    ) -> Optional[TokenMetadata]:
        """
        Get token metadata.

        Args:
            contract_address: Token contract address
            chain: Chain name

        Returns:
            TokenMetadata or None
        """
        base_url = self._get_base_url(chain)
        if not base_url:
            return None

        session = await self._get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_getTokenMetadata",
            "params": [contract_address],
        }

        try:
            async with session.post(base_url, json=payload) as response:
                if response.status != 200:
                    return None

                result = await response.json()

            if "error" in result:
                return None

            data = result.get("result", {})

            return TokenMetadata(
                address=contract_address,
                symbol=data.get("symbol", "???"),
                name=data.get("name", "Unknown"),
                decimals=data.get("decimals", 18),
                logo_url=data.get("logo"),
            )

        except Exception as e:
            logger.error(f"Failed to get token metadata: {e}")
            return None

    async def get_native_balance(
        self,
        address: str,
        chain: str = "ethereum",
    ) -> Optional[float]:
        """
        Get native token balance (ETH, MATIC, etc.).

        Args:
            address: Wallet address
            chain: Chain name

        Returns:
            Balance in native units (e.g., ETH not wei)
        """
        alchemy_circuit.check()

        base_url = self._get_base_url(chain)
        if not base_url:
            return None

        session = await self._get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getBalance",
            "params": [address, "latest"],
        }

        try:
            async with session.post(base_url, json=payload) as response:
                if response.status == 429:
                    alchemy_circuit.record_429()
                    raise AlchemyRateLimitError(f"Alchemy 429: {await response.text()}")
                if response.status != 200:
                    return None

                result = await response.json()

            if "error" in result:
                return None

            alchemy_circuit.record_success()
            balance_wei = int(result.get("result", "0x0"), 16)
            return balance_wei / (10**18)

        except AlchemyRateLimitError:
            raise
        except Exception as e:
            logger.error(f"Failed to get native balance: {e}")
            return None

    # === Transfer History ===

    async def get_asset_transfers(
        self,
        address: str,
        chain: str = "ethereum",
        category: Optional[List[str]] = None,
        max_count: int = 100,
        from_block: str = "0x0",
        to_block: str = "latest",
    ) -> List[AssetTransfer]:
        """
        Get asset transfer history for an address.

        Args:
            address: Wallet address
            chain: Chain name
            category: Transfer categories (external, internal, erc20, erc721, erc1155)
            max_count: Maximum number of transfers to return
            from_block: Starting block
            to_block: Ending block

        Returns:
            List of AssetTransfer objects
        """
        base_url = self._get_base_url(chain)
        if not base_url:
            return []

        if category is None:
            category = ["external", "erc20"]

        session = await self._get_session()

        # Get incoming and outgoing transfers
        transfers = []

        for direction in ["from", "to"]:
            params = {
                direction + "Address": address,
                "category": category,
                "maxCount": hex(max_count),
                "fromBlock": from_block,
                "toBlock": to_block,
                "withMetadata": True,
                "order": "desc",  # newest first so maxCount caps the most recent
            }

            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "alchemy_getAssetTransfers",
                "params": [params],
            }

            try:
                async with session.post(base_url, json=payload) as response:
                    if response.status != 200:
                        continue

                    result = await response.json()

                if "error" in result:
                    continue

                for tx in result.get("result", {}).get("transfers", []):
                    transfers.append(
                        AssetTransfer(
                            block_num=int(tx.get("blockNum", "0x0"), 16),
                            block_hash=tx.get("hash", ""),
                            tx_hash=tx.get("hash", ""),
                            from_address=tx.get("from", ""),
                            to_address=tx.get("to", ""),
                            value=tx.get("value"),
                            asset=tx.get("asset", "ETH"),
                            category=tx.get("category", "external"),
                            raw_contract=tx.get("rawContract"),
                            block_timestamp=(tx.get("metadata") or {}).get("blockTimestamp"),
                        )
                    )

            except Exception as e:
                logger.error(f"Failed to get asset transfers: {e}")

        # Sort by block number descending
        transfers.sort(key=lambda t: t.block_num, reverse=True)
        return transfers[:max_count]

    # === Transaction Simulation ===

    async def simulate_transaction(
        self,
        from_address: str,
        to_address: str,
        data: str,
        value: str = "0x0",
        chain: str = "ethereum",
    ) -> SimulationResult:
        """
        Simulate a transaction before execution.

        Args:
            from_address: Sender address
            to_address: Recipient/contract address
            data: Transaction data (hex)
            value: Value to send (hex)
            chain: Chain name

        Returns:
            SimulationResult with success status and gas used
        """
        base_url = self._get_base_url(chain)
        if not base_url:
            return SimulationResult(
                success=False,
                gas_used=0,
                gas_limit=0,
                error="Alchemy not configured for this chain",
            )

        session = await self._get_session()

        # Use alchemy_simulateExecution
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_simulateExecution",
            "params": [
                {
                    "from": from_address,
                    "to": to_address,
                    "data": data,
                    "value": value,
                }
            ],
        }

        try:
            async with session.post(base_url, json=payload) as response:
                if response.status != 200:
                    error_text = await response.text()
                    return SimulationResult(
                        success=False,
                        gas_used=0,
                        gas_limit=0,
                        error=f"API error: {error_text}",
                    )

                result = await response.json()

            if "error" in result:
                return SimulationResult(
                    success=False,
                    gas_used=0,
                    gas_limit=0,
                    error=result["error"].get("message", "Unknown error"),
                )

            sim_result = result.get("result", {})

            return SimulationResult(
                success=not sim_result.get("error"),
                gas_used=int(sim_result.get("gasUsed", "0x0"), 16),
                gas_limit=(
                    int(sim_result.get("gasLimit", "0x0"), 16) if sim_result.get("gasLimit") else 0
                ),
                return_data=sim_result.get("returnValue"),
                error=sim_result.get("error"),
                state_changes=sim_result.get("stateDiff"),
            )

        except Exception as e:
            logger.error(f"Transaction simulation failed: {e}")
            return SimulationResult(
                success=False,
                gas_used=0,
                gas_limit=0,
                error=str(e),
            )

    # === NFT API ===

    async def get_nfts_for_owner(
        self,
        address: str,
        chain: str = "ethereum",
        page_size: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get all NFTs owned by an address.

        Args:
            address: Wallet address
            chain: Chain name
            page_size: Number of NFTs per page

        Returns:
            List of NFT objects
        """
        nft_url = self._get_nft_url(chain)
        if not nft_url:
            return []

        session = await self._get_session()
        url = f"{nft_url}/getNFTsForOwner?owner={address}&pageSize={page_size}"

        try:
            async with session.get(url) as response:
                if response.status != 200:
                    return []

                result = await response.json()

            return result.get("ownedNfts", [])

        except Exception as e:
            logger.error(f"Failed to get NFTs: {e}")
            return []

    async def get_nft_metadata(
        self,
        contract_address: str,
        token_id: str,
        chain: str = "ethereum",
    ) -> Optional[Dict[str, Any]]:
        """
        Get metadata for a specific NFT.

        Args:
            contract_address: NFT contract address
            token_id: Token ID
            chain: Chain name

        Returns:
            NFT metadata or None
        """
        nft_url = self._get_nft_url(chain)
        if not nft_url:
            return None

        session = await self._get_session()
        url = f"{nft_url}/getNFTMetadata?contractAddress={contract_address}&tokenId={token_id}"

        try:
            async with session.get(url) as response:
                if response.status != 200:
                    return None

                return await response.json()

        except Exception as e:
            logger.error(f"Failed to get NFT metadata: {e}")
            return None

    # === Webhooks ===

    async def create_address_activity_webhook(
        self,
        addresses: List[str],
        webhook_url: str,
        chain: str = "ethereum",
    ) -> Optional[str]:
        """
        Create a webhook for address activity notifications.

        Args:
            addresses: Addresses to monitor
            webhook_url: URL to receive notifications
            chain: Chain name

        Returns:
            Webhook ID or None
        """
        if not self._api_key:
            return None

        network = ALCHEMY_NETWORKS.get(chain.lower())
        if not network:
            return None

        session = await self._get_session()
        url = "https://dashboard.alchemy.com/api/create-webhook"

        headers = {
            "X-Alchemy-Token": settings.alchemy_webhook_auth_token or self._api_key,
            "Content-Type": "application/json",
        }

        payload = {
            "network": network,
            "webhook_type": "ADDRESS_ACTIVITY",
            "webhook_url": webhook_url,
            "addresses": addresses,
        }

        try:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"Failed to create webhook: {await response.text()}")
                    return None

                result = await response.json()
                return result.get("data", {}).get("id")

        except Exception as e:
            logger.error(f"Failed to create webhook: {e}")
            return None

    # === Raw Token Balances (no metadata N+1) ===

    async def get_token_balances_raw(
        self,
        address: str,
        chain: str = "ethereum",
    ) -> Dict[str, int]:
        """
        Get all ERC-20 token balances as {contract_address_lower: raw_balance_int}.

        Unlike get_token_balances(), this does NOT call get_token_metadata() per
        token, avoiding an N+1 API round-trip.  The caller is expected to map
        contract addresses back to known symbols via its own config (e.g. TOKENS).
        """
        alchemy_circuit.check()

        base_url = self._get_base_url(chain)
        if not base_url:
            return {}

        session = await self._get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_getTokenBalances",
            "params": [address, "erc20"],
        }

        try:
            async with session.post(base_url, json=payload) as response:
                if response.status == 429:
                    alchemy_circuit.record_429()
                    raise AlchemyRateLimitError(f"Alchemy 429: {await response.text()}")
                if response.status != 200:
                    logger.error(f"Alchemy raw token balances failed: {await response.text()}")
                    return {}

                result = await response.json()

            if "error" in result:
                logger.error(f"Alchemy error: {result['error']}")
                return {}

            alchemy_circuit.record_success()

            token_data = result.get("result", {}).get("tokenBalances", [])

            balances: Dict[str, int] = {}
            for token in token_data:
                raw_hex = token.get("tokenBalance", "0x0")
                raw_balance = int(raw_hex, 16)
                if raw_balance == 0:
                    continue
                contract = token.get("contractAddress", "").lower()
                if contract:
                    balances[contract] = raw_balance

            return balances

        except AlchemyRateLimitError:
            raise
        except Exception as e:
            logger.error(f"Failed to get raw token balances: {e}")
            return {}

    # === Helpers ===

    def _is_spam_token(self, metadata: TokenMetadata) -> bool:
        """Check if a token is likely spam."""
        spam_indicators = [
            "airdrop",
            "claim",
            "visit",
            ".com",
            ".io",
            ".xyz",
            "reward",
            "free",
        ]

        name_lower = metadata.name.lower()
        symbol_lower = metadata.symbol.lower()

        for indicator in spam_indicators:
            if indicator in name_lower or indicator in symbol_lower:
                return True

        return False


# Global client instance
_alchemy_client: Optional[AlchemyClient] = None


def get_alchemy_client() -> AlchemyClient:
    """Get the Alchemy client instance."""
    global _alchemy_client
    if _alchemy_client is None:
        _alchemy_client = AlchemyClient()
    return _alchemy_client


def is_alchemy_configured() -> bool:
    """Check if Alchemy is configured."""
    return bool(settings.alchemy_api_key)
