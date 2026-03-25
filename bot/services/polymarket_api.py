"""Polymarket API client for prediction market trading.

Endpoints:
- Gamma API (read-only market data): https://gamma-api.polymarket.com
- CLOB API (orderbook + trading): https://clob.polymarket.com
"""

import base64
import logging
import secrets
import time
import json
import hashlib
import hmac
from typing import Optional
from dataclasses import dataclass, field

import aiohttp
from eth_account import Account
from eth_account.messages import encode_typed_data

logger = logging.getLogger(__name__)


GAMMA_BASE_URL = "https://gamma-api.polymarket.com"
CLOB_BASE_URL = "https://clob.polymarket.com"


@dataclass
class MarketInfo:
    """Polymarket market data."""
    condition_id: str
    question: str
    description: str = ""
    outcome_yes_price: float = 0.0
    outcome_no_price: float = 0.0
    volume_24hr: float = 0.0
    volume_total: float = 0.0
    liquidity: float = 0.0
    end_date: str = ""
    active: bool = True
    closed: bool = False
    tokens: list = field(default_factory=list)
    image: str = ""
    category: str = ""


@dataclass
class OrderbookSummary:
    """Simplified orderbook data."""
    token_id: str
    best_bid: float = 0.0
    best_ask: float = 0.0
    spread: float = 0.0
    bid_depth: float = 0.0
    ask_depth: float = 0.0


@dataclass
class CLOBCredentials:
    """CLOB API credentials derived from wallet signing."""
    api_key: str
    secret: str
    passphrase: str


@dataclass
class OrderResult:
    """Result of an order placement."""
    success: bool
    order_id: str = ""
    status: str = ""
    error: str = ""


class PolymarketClient:
    """Client for Polymarket Gamma API (read-only) and CLOB API (trading)."""

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    # ============ GAMMA API (Read-Only Market Data) ============

    async def search_markets(self, query: str, limit: int = 10) -> list[MarketInfo]:
        """Search markets by keyword."""
        try:
            session = await self._get_session()
            params = {
                "_q": query,
                "_limit": limit,
                "active": "true",
                "closed": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/markets", params=params) as resp:
                if resp.status != 200:
                    logger.warning(f"Gamma search_markets returned {resp.status}")
                    return []
                data = await resp.json()
                return [self._parse_market(m) for m in data]
        except Exception as e:
            logger.error(f"search_markets error: {e}")
            return []

    async def get_market(self, condition_id: str) -> Optional[MarketInfo]:
        """Get a single market by condition_id."""
        try:
            session = await self._get_session()
            async with session.get(f"{GAMMA_BASE_URL}/markets/{condition_id}") as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return self._parse_market(data)
        except Exception as e:
            logger.error(f"get_market error: {e}")
            return None

    async def get_trending_markets(self, limit: int = 10) -> list[MarketInfo]:
        """Get trending markets by 24hr volume."""
        try:
            session = await self._get_session()
            params = {
                "_limit": limit,
                "active": "true",
                "closed": "false",
                "order": "volume24hr",
                "ascending": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/markets", params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                return [self._parse_market(m) for m in data]
        except Exception as e:
            logger.error(f"get_trending_markets error: {e}")
            return []

    async def get_events(self, limit: int = 10) -> list[dict]:
        """Get active events."""
        try:
            session = await self._get_session()
            params = {
                "_limit": limit,
                "active": "true",
                "closed": "false",
            }
            async with session.get(f"{GAMMA_BASE_URL}/events", params=params) as resp:
                if resp.status != 200:
                    return []
                return await resp.json()
        except Exception as e:
            logger.error(f"get_events error: {e}")
            return []

    # ============ CLOB API (Public Read-Only) ============

    async def get_orderbook(self, token_id: str) -> Optional[OrderbookSummary]:
        """Get orderbook for a token."""
        try:
            session = await self._get_session()
            params = {"token_id": token_id}
            async with session.get(f"{CLOB_BASE_URL}/book", params=params) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()

                bids = data.get("bids", [])
                asks = data.get("asks", [])

                best_bid = float(bids[0]["price"]) if bids else 0.0
                best_ask = float(asks[0]["price"]) if asks else 0.0
                bid_depth = sum(float(b.get("size", 0)) for b in bids[:5])
                ask_depth = sum(float(a.get("size", 0)) for a in asks[:5])

                return OrderbookSummary(
                    token_id=token_id,
                    best_bid=best_bid,
                    best_ask=best_ask,
                    spread=best_ask - best_bid if best_ask and best_bid else 0.0,
                    bid_depth=bid_depth,
                    ask_depth=ask_depth,
                )
        except Exception as e:
            logger.error(f"get_orderbook error: {e}")
            return None

    async def get_midpoint(self, token_id: str) -> Optional[float]:
        """Get midpoint price for a token."""
        try:
            session = await self._get_session()
            params = {"token_id": token_id}
            async with session.get(f"{CLOB_BASE_URL}/midpoint", params=params) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return float(data.get("mid", 0))
        except Exception as e:
            logger.error(f"get_midpoint error: {e}")
            return None

    # ============ CLOB API (Authenticated Trading via Official SDK) ============

    def _get_clob_client(self, private_key: str):
        """Create an authenticated ClobClient using the official Polymarket SDK."""
        from py_clob_client.client import ClobClient
        from py_clob_client.clob_types import ApiCreds

        pk = private_key if private_key.startswith("0x") else "0x" + private_key
        client = ClobClient(
            host=CLOB_BASE_URL,
            key=pk,
            chain_id=137,
        )
        # Create or derive API credentials
        client.set_api_creds(client.create_or_derive_api_creds())
        return client

    async def place_order(
        self,
        private_key: str,
        token_id: str,
        side: str,
        amount: float,
        price: float,
    ) -> OrderResult:
        """Place an order using the official py-clob-client SDK."""
        try:
            from py_clob_client.clob_types import OrderArgs, OrderType
            from py_clob_client.order_builder.constants import BUY, SELL

            client = self._get_clob_client(private_key)

            size = amount / price if side == "BUY" else amount
            order_side = BUY if side == "BUY" else SELL

            order_args = OrderArgs(
                price=price,
                size=size,
                side=order_side,
                token_id=token_id,
            )

            signed_order = client.create_order(order_args)
            resp = client.post_order(signed_order, OrderType.GTC)

            if resp and resp.get("success"):
                return OrderResult(
                    success=True,
                    order_id=resp.get("orderID", resp.get("id", "")),
                    status=resp.get("status", "placed"),
                )
            else:
                error_msg = resp.get("errorMsg", resp.get("error", "Unknown error")) if resp else "No response"
                return OrderResult(success=False, error=str(error_msg))

        except Exception as e:
            logger.error(f"place_order error: {e}")
            return OrderResult(success=False, error=str(e))

    async def cancel_order(self, creds: CLOBCredentials, wallet_address: str, order_id: str) -> bool:
        """Cancel an open order."""
        try:
            path = f"/order/{order_id}"
            headers = self._sign_clob_request(creds, wallet_address, "DELETE", path)

            session = await self._get_session()
            async with session.delete(
                f"{CLOB_BASE_URL}{path}",
                headers=headers,
            ) as resp:
                return resp.status in (200, 204)

        except Exception as e:
            logger.error(f"cancel_order error: {e}")
            return False

    async def get_positions(self, creds: CLOBCredentials, wallet_address: str) -> list[dict]:
        """Get open positions for authenticated user."""
        try:
            path = "/positions"
            headers = self._sign_clob_request(creds, wallet_address, "GET", path)

            session = await self._get_session()
            async with session.get(
                f"{CLOB_BASE_URL}{path}",
                headers=headers,
            ) as resp:
                if resp.status != 200:
                    return []
                return await resp.json()

        except Exception as e:
            logger.error(f"get_positions error: {e}")
            return []

    # ============ Helpers ============

    def _parse_market(self, data: dict) -> MarketInfo:
        """Parse raw Gamma API market response into MarketInfo."""
        tokens = data.get("tokens", [])

        yes_price = 0.0
        no_price = 0.0
        for token in tokens:
            outcome = token.get("outcome", "").lower()
            price = float(token.get("price", 0) or 0)
            if outcome == "yes":
                yes_price = price
            elif outcome == "no":
                no_price = price

        return MarketInfo(
            condition_id=data.get("conditionId", data.get("condition_id", "")),
            question=data.get("question", ""),
            description=data.get("description", ""),
            outcome_yes_price=yes_price,
            outcome_no_price=no_price,
            volume_24hr=float(data.get("volume24hr", 0) or 0),
            volume_total=float(data.get("volumeNum", data.get("volume", 0)) or 0),
            liquidity=float(data.get("liquidityNum", data.get("liquidity", 0)) or 0),
            end_date=data.get("endDate", data.get("end_date_iso", "")),
            active=data.get("active", True),
            closed=data.get("closed", False),
            tokens=tokens,
            image=data.get("image", ""),
            category=data.get("category", ""),
        )


# Singleton instance
polymarket_client = PolymarketClient()
