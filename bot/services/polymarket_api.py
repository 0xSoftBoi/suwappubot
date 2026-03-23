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

    # ============ CLOB API (Authenticated Trading) ============

    # EIP-712 domain and types for CLOB order signing
    CLOB_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"
    ORDER_DOMAIN = {
        "name": "ClobExchange",
        "version": "1",
        "chainId": 137,
        "verifyingContract": CLOB_EXCHANGE_ADDRESS,
    }
    ORDER_TYPES = {
        "Order": [
            {"name": "salt", "type": "uint256"},
            {"name": "maker", "type": "address"},
            {"name": "signer", "type": "address"},
            {"name": "taker", "type": "address"},
            {"name": "tokenId", "type": "uint256"},
            {"name": "makerAmount", "type": "uint256"},
            {"name": "takerAmount", "type": "uint256"},
            {"name": "expiration", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "feeRateBps", "type": "uint256"},
            {"name": "side", "type": "uint8"},
            {"name": "signatureType", "type": "uint8"},
        ],
    }

    async def create_api_credentials(self, private_key: str) -> CLOBCredentials:
        """Create CLOB API credentials by signing auth message and registering with server."""
        account = Account.from_key(private_key)
        address = account.address

        timestamp = int(time.time())
        nonce = 0

        domain_data = {
            "name": "ClobAuthDomain",
            "version": "1",
            "chainId": 137,
        }
        message_types = {
            "ClobAuth": [
                {"name": "address", "type": "address"},
                {"name": "timestamp", "type": "string"},
                {"name": "nonce", "type": "uint256"},
                {"name": "message", "type": "string"},
            ],
        }
        message_data = {
            "address": address,
            "timestamp": str(timestamp),
            "nonce": nonce,
            "message": "This message attests that I control the given wallet",
        }

        signable = encode_typed_data(domain_data, message_types, message_data)
        signed = account.sign_message(signable)

        # POST to CLOB API to register credentials (not local derivation)
        session = await self._get_session()
        req_body = {
            "address": address,
            "timestamp": str(timestamp),
            "nonce": str(nonce),
            "signature": "0x" + signed.signature.hex(),
        }
        async with session.post(
            f"{CLOB_BASE_URL}/auth/api-key",
            json=req_body,
        ) as resp:
            if resp.status not in (200, 201):
                text = await resp.text()
                raise Exception(f"CLOB auth/api-key failed ({resp.status}): {text}")
            data = await resp.json()

        return CLOBCredentials(
            api_key=data["apiKey"],
            secret=data["secret"],
            passphrase=data["passphrase"],
        )

    def _sign_clob_request(self, creds: CLOBCredentials, wallet_address: str, method: str, path: str, body: str = "") -> dict:
        """Create HMAC headers for authenticated CLOB requests."""
        timestamp = str(int(time.time()))
        message = f"{timestamp}{method}{path}{body}"
        signature = base64.b64encode(
            hmac.new(
                creds.secret.encode(),
                message.encode(),
                hashlib.sha256,
            ).digest()
        ).decode()

        return {
            "POLY_ADDRESS": wallet_address,
            "POLY_SIGNATURE": signature,
            "POLY_TIMESTAMP": timestamp,
            "POLY_NONCE": "0",
            "POLY_API_KEY": creds.api_key,
            "POLY_PASSPHRASE": creds.passphrase,
            "Content-Type": "application/json",
        }

    async def place_order(
        self,
        private_key: str,
        token_id: str,
        side: str,
        amount: float,
        price: float,
    ) -> OrderResult:
        """Place an EIP-712 signed order on the CLOB.

        Args:
            private_key: Wallet private key for signing.
            token_id: Polymarket token ID.
            side: "BUY" or "SELL".
            amount: USDC amount to spend (for BUY) or shares to sell (for SELL).
            price: Limit price per share.
        """
        try:
            account = Account.from_key(private_key)
            wallet_address = account.address

            creds = await self.create_api_credentials(private_key)

            size = amount / price if side == "BUY" else amount
            salt = secrets.randbelow(10**18)
            maker_amount = int(size * price * 1e6) if side == "BUY" else int(size * 1e6)
            taker_amount = int(size * 1e6) if side == "BUY" else int(size * price * 1e6)

            order_data = {
                "salt": salt,
                "maker": wallet_address,
                "signer": wallet_address,
                "taker": "0x0000000000000000000000000000000000000000",
                "tokenId": int(token_id),
                "makerAmount": maker_amount,
                "takerAmount": taker_amount,
                "expiration": 0,
                "nonce": 0,
                "feeRateBps": 0,
                "side": 0 if side == "BUY" else 1,
                "signatureType": 0,
            }

            # Sign the EIP-712 order
            signable = encode_typed_data(
                self.ORDER_DOMAIN,
                self.ORDER_TYPES,
                order_data,
            )
            signed = account.sign_message(signable)

            order_payload = {
                "tokenID": token_id,
                "price": str(price),
                "size": str(size),
                "side": side,
                "type": "GTC",
                "feeRateBps": 0,
                "nonce": "0",
                "signature": "0x" + signed.signature.hex(),
                "owner": wallet_address,
                "orderType": "GTC",
            }

            body = json.dumps(order_payload)
            path = "/order"
            headers = self._sign_clob_request(creds, wallet_address, "POST", path, body)

            session = await self._get_session()
            async with session.post(
                f"{CLOB_BASE_URL}{path}",
                data=body,
                headers=headers,
            ) as resp:
                data = await resp.json()

                if resp.status in (200, 201):
                    return OrderResult(
                        success=True,
                        order_id=data.get("orderID", data.get("id", "")),
                        status=data.get("status", "placed"),
                    )
                else:
                    return OrderResult(
                        success=False,
                        error=data.get("error", data.get("message", f"HTTP {resp.status}")),
                    )

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
