"""Price fetching service using CoinGecko and caching."""

import aiohttp
from typing import Optional

from bot.utils.cache import price_cache
from bot.utils.retry import async_retry
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.utils.http_client import get_session as get_http_session

# Token to CoinGecko ID mapping
TOKEN_TO_COINGECKO = {
    # Stablecoins
    "USDT": "tether",
    "USDC": "usd-coin",
    "DAI": "dai",
    "BUSD": "binance-usd",
    "FRAX": "frax",
    "TUSD": "true-usd",
    "LUSD": "liquity-usd",
    "PYUSD": "paypal-usd",
    "GHO": "gho",
    "USDD": "usdd",
    "USDP": "paxos-standard",
    "EURC": "euro-coin",
    "CRVUSD": "crvusd",
    "FDUSD": "first-digital-usd",
    "USDe": "ethena-usde",
    # Major tokens
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "WETH": "weth",
    "WBTC": "wrapped-bitcoin",
    "BNB": "binancecoin",
    "WBNB": "wbnb",
    "MATIC": "matic-network",
    "WMATIC": "wmatic",
    "SOL": "solana",
    "ARB": "arbitrum",
    "OP": "optimism",
    # DeFi tokens
    "LINK": "chainlink",
    "UNI": "uniswap",
    "AAVE": "aave",
    "CRV": "curve-dao-token",
    # Meme tokens
    "PEPE": "pepe",
    "SHIB": "shiba-inu",
}


class PriceService:
    """Service for fetching token prices."""

    COINGECKO_API = "https://api.coingecko.com/api/v3"

    def __init__(self):
        pass

    async def _get_session(self) -> aiohttp.ClientSession:
        return await get_http_session()

    async def close(self):
        # Shared session is managed by bot.utils.http_client; nothing to close here.
        pass

    async def get_price(self, token: str) -> Optional[float]:
        """Get USD price for a single token."""
        cache_key = f"price_{token.upper()}"

        # Check cache
        cached_price = await price_cache.get(cache_key)
        if cached_price is not None:
            return cached_price

        # Stablecoins - assume $1
        if token.upper() in ["USDT", "USDC", "DAI", "BUSD", "TUSD", "PYUSD", "USDP", "FDUSD"]:
            await price_cache.set(cache_key, 1.0)
            return 1.0

        # Fetch from CoinGecko
        coingecko_id = TOKEN_TO_COINGECKO.get(token.upper())
        if not coingecko_id:
            return None

        try:
            price = await self._fetch_coingecko_price(coingecko_id)
            if price:
                await price_cache.set(cache_key, price)
            return price
        except Exception:
            return None

    async def get_prices(self, tokens: list[str]) -> dict[str, Optional[float]]:
        """Get USD prices for multiple tokens."""
        results = {}
        tokens_to_fetch = []

        # Check cache first
        for token in tokens:
            token_upper = token.upper()
            cache_key = f"price_{token_upper}"
            cached_price = await price_cache.get(cache_key)

            if cached_price is not None:
                results[token_upper] = cached_price
            elif token_upper in ["USDT", "USDC", "DAI", "BUSD", "TUSD", "PYUSD", "USDP", "FDUSD"]:
                results[token_upper] = 1.0
                await price_cache.set(cache_key, 1.0)
            else:
                tokens_to_fetch.append(token_upper)

        # Fetch remaining from CoinGecko
        if tokens_to_fetch:
            coingecko_ids = [
                TOKEN_TO_COINGECKO.get(t) for t in tokens_to_fetch if t in TOKEN_TO_COINGECKO
            ]

            if coingecko_ids:
                fetched = await self._fetch_multiple_prices(coingecko_ids)

                # Map back to token symbols
                for token in tokens_to_fetch:
                    cg_id = TOKEN_TO_COINGECKO.get(token)
                    if cg_id and cg_id in fetched:
                        results[token] = fetched[cg_id]
                        await price_cache.set(f"price_{token}", fetched[cg_id])
                    else:
                        results[token] = None

        return results

    @async_retry(max_attempts=3, delay=1.0)
    @track_time(MetricNames.API_COINGECKO)
    async def _fetch_coingecko_price(self, coingecko_id: str) -> Optional[float]:
        """Fetch price from CoinGecko."""
        # Apply rate limiting (CoinGecko free tier: 10-30 calls/min)
        await api_limiter.wait_and_acquire("coingecko")

        session = await self._get_session()

        url = f"{self.COINGECKO_API}/simple/price"
        params = {
            "ids": coingecko_id,
            "vs_currencies": "usd",
        }

        async with session.get(url, params=params) as resp:
            if resp.status == 200:
                data = await resp.json()
                return data.get(coingecko_id, {}).get("usd")
            return None

    @async_retry(max_attempts=3, delay=1.0)
    @track_time(MetricNames.API_COINGECKO)
    async def _fetch_multiple_prices(self, coingecko_ids: list[str]) -> dict[str, float]:
        """Fetch multiple prices from CoinGecko in one call."""
        # Apply rate limiting
        await api_limiter.wait_and_acquire("coingecko")

        session = await self._get_session()

        url = f"{self.COINGECKO_API}/simple/price"
        params = {
            "ids": ",".join(coingecko_ids),
            "vs_currencies": "usd",
        }

        async with session.get(url, params=params) as resp:
            if resp.status == 200:
                data = await resp.json()
                return {
                    cg_id: info.get("usd")
                    for cg_id, info in data.items()
                    if info.get("usd") is not None
                }
            return {}

    async def get_token_change_24h(self, token: str) -> Optional[float]:
        """Get 24h price change percentage for a token."""
        coingecko_id = TOKEN_TO_COINGECKO.get(token.upper())
        if not coingecko_id:
            return None

        cache_key = f"change_24h_{token.upper()}"
        cached = await price_cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            session = await self._get_session()

            url = f"{self.COINGECKO_API}/simple/price"
            params = {
                "ids": coingecko_id,
                "vs_currencies": "usd",
                "include_24hr_change": "true",
            }

            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    change = data.get(coingecko_id, {}).get("usd_24h_change")
                    if change is not None:
                        await price_cache.set(cache_key, change, ttl=300)  # 5 min cache
                    return change
            return None
        except Exception:
            return None


# Global instance
price_service = PriceService()
