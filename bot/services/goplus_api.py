"""GoPlus Security API client for token risk assessment.

API docs: https://docs.gopluslabs.io/reference/token-security-api
Free tier, no API key required.
"""

import logging
from typing import Optional, Dict
from dataclasses import dataclass, field

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.cache import AsyncCache
from bot.utils.retry import async_retry
from bot.utils.performance import track_time, MetricNames

logger = logging.getLogger(__name__)

# Cache for security data (5 min TTL)
security_cache = AsyncCache(default_ttl=300)


class GoPlusError(Exception):
    """GoPlus API error."""
    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class GoPlusTokenSecurity:
    """Token security data from GoPlus."""
    is_honeypot: bool = False
    is_open_source: bool = False
    is_proxy: bool = False
    is_mintable: bool = False
    can_take_back_ownership: bool = False
    owner_change_balance: bool = False
    hidden_owner: bool = False
    selfdestruct: bool = False
    external_call: bool = False
    buy_tax: Optional[float] = None
    sell_tax: Optional[float] = None
    holder_count: int = 0
    lp_holder_count: int = 0
    is_anti_whale: bool = False
    is_blacklisted: bool = False
    is_whitelisted: bool = False
    trading_cooldown: bool = False
    transfer_pausable: bool = False
    creator_address: Optional[str] = None
    owner_address: Optional[str] = None
    risk_count: int = 0

    def __post_init__(self):
        """Compute risk_count from flags."""
        flags = [
            self.is_honeypot,
            self.is_proxy,
            self.is_mintable,
            self.can_take_back_ownership,
            self.owner_change_balance,
            self.hidden_owner,
            self.selfdestruct,
            self.external_call,
            self.is_blacklisted,
            self.trading_cooldown,
            self.transfer_pausable,
        ]
        self.risk_count = sum(1 for f in flags if f)


def _parse_bool(value) -> bool:
    """Parse GoPlus '0'/'1' string to bool."""
    if value is None:
        return False
    return str(value) == "1"


def _parse_float(value) -> Optional[float]:
    """Parse GoPlus tax string to float percentage."""
    if value is None or value == "":
        return None
    try:
        return float(value) * 100  # GoPlus returns as decimal (0.05 = 5%)
    except (ValueError, TypeError):
        return None


def _parse_int(value) -> int:
    """Parse GoPlus int string."""
    if value is None or value == "":
        return 0
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


class GoPlusAPI:
    """GoPlus Security API client."""

    BASE_URL = "https://api.gopluslabs.io/api/v1"

    # Chain ID mapping (GoPlus uses EVM chain IDs + "solana" string)
    CHAIN_MAP = {
        "ethereum": "1",
        "bsc": "56",
        "polygon": "137",
        "arbitrum": "42161",
        "optimism": "10",
        "base": "8453",
        "avalanche": "43114",
        "fantom": "250",
        "linea": "59144",
        "scroll": "534352",
        "gnosis": "100",
        "solana": "solana",
    }

    @track_time(MetricNames.API_GOPLUS)
    @async_retry(max_attempts=2, delay=0.5)
    async def get_token_security(
        self, chain: str, contract_address: str
    ) -> GoPlusTokenSecurity:
        """
        Get security info for a single token.

        Args:
            chain: Chain name (e.g. "ethereum", "solana")
            contract_address: Token contract address

        Returns:
            GoPlusTokenSecurity with risk flags
        """
        chain_id = self.CHAIN_MAP.get(chain)
        if not chain_id:
            raise GoPlusError(f"Unsupported chain: {chain}")

        # Check cache
        cache_key = f"goplus:{chain_id}:{contract_address.lower()}"
        cached = await security_cache.get(cache_key)
        if cached is not None:
            return cached

        await api_limiter.wait_and_acquire("goplus")
        session = await get_session()

        url = f"{self.BASE_URL}/token_security/{chain_id}"
        params = {"contract_addresses": contract_address}

        async with session.get(url, params=params) as response:
            if response.status != 200:
                raise GoPlusError(
                    f"GoPlus API returned {response.status}",
                    status_code=response.status,
                )

            data = await response.json()

        if data.get("code") != 1:
            raise GoPlusError(f"GoPlus API error: {data.get('message', 'Unknown')}")

        result_data = data.get("result", {})

        # GoPlus returns data keyed by lowercase address
        addr_lower = contract_address.lower()
        token_data = result_data.get(addr_lower, {})

        if not token_data:
            raise GoPlusError(f"No data returned for {contract_address}")

        security = self._parse_token_data(token_data)

        # Cache result
        await security_cache.set(cache_key, security)
        return security

    @track_time(MetricNames.API_GOPLUS)
    @async_retry(max_attempts=2, delay=0.5)
    async def get_token_security_batch(
        self, chain: str, addresses: list[str]
    ) -> dict[str, GoPlusTokenSecurity]:
        """
        Get security info for multiple tokens in one call.

        Args:
            chain: Chain name
            addresses: List of contract addresses

        Returns:
            Dict mapping address -> GoPlusTokenSecurity
        """
        chain_id = self.CHAIN_MAP.get(chain)
        if not chain_id:
            raise GoPlusError(f"Unsupported chain: {chain}")

        await api_limiter.wait_and_acquire("goplus")
        session = await get_session()

        url = f"{self.BASE_URL}/token_security/{chain_id}"
        params = {"contract_addresses": ",".join(addresses)}

        async with session.get(url, params=params) as response:
            if response.status != 200:
                raise GoPlusError(
                    f"GoPlus API returned {response.status}",
                    status_code=response.status,
                )

            data = await response.json()

        if data.get("code") != 1:
            raise GoPlusError(f"GoPlus API error: {data.get('message', 'Unknown')}")

        result_data = data.get("result", {})
        results = {}

        for addr in addresses:
            addr_lower = addr.lower()
            token_data = result_data.get(addr_lower, {})
            if token_data:
                results[addr] = self._parse_token_data(token_data)

        return results

    def _parse_token_data(self, data: dict) -> GoPlusTokenSecurity:
        """Parse raw GoPlus response into dataclass."""
        return GoPlusTokenSecurity(
            is_honeypot=_parse_bool(data.get("is_honeypot")),
            is_open_source=_parse_bool(data.get("is_open_source")),
            is_proxy=_parse_bool(data.get("is_proxy")),
            is_mintable=_parse_bool(data.get("is_mintable")),
            can_take_back_ownership=_parse_bool(data.get("can_take_back_ownership")),
            owner_change_balance=_parse_bool(data.get("owner_change_balance")),
            hidden_owner=_parse_bool(data.get("hidden_owner")),
            selfdestruct=_parse_bool(data.get("selfdestruct")),
            external_call=_parse_bool(data.get("external_call")),
            buy_tax=_parse_float(data.get("buy_tax")),
            sell_tax=_parse_float(data.get("sell_tax")),
            holder_count=_parse_int(data.get("holder_count")),
            lp_holder_count=_parse_int(data.get("lp_holder_count")),
            is_anti_whale=_parse_bool(data.get("is_anti_whale")),
            is_blacklisted=_parse_bool(data.get("is_blacklisted")),
            is_whitelisted=_parse_bool(data.get("is_whitelisted")),
            trading_cooldown=_parse_bool(data.get("trading_cooldown")),
            transfer_pausable=_parse_bool(data.get("transfer_pausable")),
            creator_address=data.get("creator_address"),
            owner_address=data.get("owner_address"),
        )


# Global singleton
goplus_api = GoPlusAPI()
