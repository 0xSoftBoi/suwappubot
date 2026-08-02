"""pump.fun API client for token launch sniping on Solana.

pump.fun is the dominant token launch platform on Solana. Key events:
- Token creation: New bonding curve token created
- Migration: Token graduates from pump.fun to Raydium (bonding curve filled)
- Trade: Buy/sell on the bonding curve

This client provides:
1. API access for token info and quotes
2. WebSocket subscription for real-time launch events
3. Buy transaction construction for sniping
"""

import logging
import asyncio
import json
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# pump.fun API endpoints
PUMP_FUN_API = "https://frontend-api.pump.fun"
PUMP_FUN_WS = "wss://pumpportal.fun/api/data"

# Bonding curve constants
PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
PUMP_FUN_FEE_RECIPIENT = "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
MIGRATION_THRESHOLD_SOL = 85.0  # ~85 SOL to complete bonding curve


class PumpFunEventType(Enum):
    """Event types from pump.fun WebSocket."""

    TOKEN_CREATED = "tokenCreated"
    TRADE = "trade"
    MIGRATION = "migration"


@dataclass
class PumpFunToken:
    """Token information from pump.fun."""

    mint: str
    name: str
    symbol: str
    description: str
    image_uri: str
    creator: str
    created_timestamp: int
    bonding_curve: str
    associated_bonding_curve: str
    virtual_sol_reserves: int
    virtual_token_reserves: int
    total_supply: int
    market_cap_sol: float
    complete: bool  # Whether bonding curve is complete (migrated to Raydium)
    metadata_uri: Optional[str] = None
    twitter: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None

    @property
    def price_sol(self) -> float:
        """Calculate current price in SOL."""
        if self.virtual_token_reserves == 0:
            return 0
        return self.virtual_sol_reserves / self.virtual_token_reserves

    @property
    def progress_percent(self) -> float:
        """Progress toward migration (bonding curve completion)."""
        return min(100, (self.market_cap_sol / MIGRATION_THRESHOLD_SOL) * 100)

    @property
    def is_migratable(self) -> bool:
        """Whether token is about to migrate to Raydium."""
        return self.progress_percent >= 95 and not self.complete


@dataclass
class PumpFunTrade:
    """Trade event from pump.fun."""

    signature: str
    mint: str
    sol_amount: int  # In lamports
    token_amount: int
    is_buy: bool
    user: str
    timestamp: int
    virtual_sol_reserves: int
    virtual_token_reserves: int

    @property
    def sol_amount_float(self) -> float:
        return self.sol_amount / 1e9

    @property
    def price_sol(self) -> float:
        if self.token_amount == 0:
            return 0
        return self.sol_amount / self.token_amount


@dataclass
class PumpFunQuote:
    """Quote for buying/selling on pump.fun."""

    mint: str
    sol_amount: int
    token_amount: int
    is_buy: bool
    price_per_token: float
    fee: int  # In lamports
    total_sol: int  # Total including fee


class PumpFunError(Exception):
    """Exception for pump.fun API errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class PumpFunAPI:
    """Client for pump.fun token launch platform.

    Features:
    - Get token information
    - Get buy/sell quotes
    - Subscribe to real-time events
    - Monitor for new launches and migrations
    """

    def __init__(self):
        self._ws = None
        self._ws_task = None
        self._callbacks: Dict[PumpFunEventType, List[Callable]] = {
            PumpFunEventType.TOKEN_CREATED: [],
            PumpFunEventType.TRADE: [],
            PumpFunEventType.MIGRATION: [],
        }
        self._subscribed_tokens: set = set()
        self._running = False

    # ============ HTTP API Methods ============

    async def get_token(self, mint: str) -> Optional[PumpFunToken]:
        """
        Get token information by mint address.

        Args:
            mint: Token mint address

        Returns:
            PumpFunToken or None if not found
        """
        await api_limiter.wait_and_acquire("pump_fun")

        try:
            session = await get_session()

            async with session.get(
                f"{PUMP_FUN_API}/coins/{mint}", headers={"Accept": "application/json"}
            ) as response:
                if response.status == 404:
                    return None
                if response.status != 200:
                    error_text = await response.text()
                    raise PumpFunError(f"Failed to get token: {error_text}")

                data = await response.json()

            return self._parse_token(data)
        except PumpFunError:
            raise
        except Exception as e:
            logger.error(f"Error getting pump.fun token {mint}: {e}")
            return None

    async def get_new_tokens(self, limit: int = 50) -> List[PumpFunToken]:
        """
        Get recently created tokens.

        Args:
            limit: Number of tokens to return (max 100)

        Returns:
            List of recent tokens
        """
        await api_limiter.wait_and_acquire("pump_fun")

        try:
            session = await get_session()

            async with session.get(
                f"{PUMP_FUN_API}/coins",
                params={"limit": min(limit, 100), "sort": "created_timestamp", "order": "DESC"},
                headers={"Accept": "application/json"},
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise PumpFunError(f"Failed to get new tokens: {error_text}")

                data = await response.json()

            return [self._parse_token(t) for t in data.get("coins", [])]
        except PumpFunError:
            raise
        except Exception as e:
            logger.error(f"Error getting new pump.fun tokens: {e}")
            return []

    async def get_graduating_tokens(self, limit: int = 20) -> List[PumpFunToken]:
        """
        Get tokens close to graduation (migration to Raydium).

        Args:
            limit: Number of tokens to return

        Returns:
            List of tokens close to migration
        """
        await api_limiter.wait_and_acquire("pump_fun")

        try:
            session = await get_session()

            # Get tokens sorted by market cap (closest to graduation)
            async with session.get(
                f"{PUMP_FUN_API}/coins",
                params={
                    "limit": 100,
                    "sort": "market_cap",
                    "order": "DESC",
                    "includeNsfw": "false",
                },
                headers={"Accept": "application/json"},
            ) as response:
                if response.status != 200:
                    return []

                data = await response.json()

            tokens = [self._parse_token(t) for t in data.get("coins", [])]

            # Filter to tokens close to graduation but not yet complete
            graduating = [t for t in tokens if t.is_migratable]

            return graduating[:limit]
        except Exception as e:
            logger.error(f"Error getting graduating tokens: {e}")
            return []

    async def get_buy_quote(
        self,
        mint: str,
        sol_amount: float,
    ) -> Optional[PumpFunQuote]:
        """
        Get quote for buying tokens with SOL.

        Args:
            mint: Token mint address
            sol_amount: Amount of SOL to spend

        Returns:
            Quote or None if not available
        """
        token = await self.get_token(mint)
        if not token:
            return None

        sol_lamports = int(sol_amount * 1e9)

        # Calculate tokens received using bonding curve formula
        # pump.fun uses constant product: k = x * y
        # Price = virtual_sol_reserves / virtual_token_reserves
        # Tokens out = (sol_in * virtual_token_reserves) / (virtual_sol_reserves + sol_in)
        k = token.virtual_sol_reserves * token.virtual_token_reserves
        new_sol_reserves = token.virtual_sol_reserves + sol_lamports
        new_token_reserves = k // new_sol_reserves
        tokens_out = token.virtual_token_reserves - new_token_reserves

        # pump.fun fee is 1%
        fee = int(sol_lamports * 0.01)

        return PumpFunQuote(
            mint=mint,
            sol_amount=sol_lamports,
            token_amount=tokens_out,
            is_buy=True,
            price_per_token=sol_lamports / tokens_out if tokens_out > 0 else 0,
            fee=fee,
            total_sol=sol_lamports + fee,
        )

    async def get_sell_quote(
        self,
        mint: str,
        token_amount: int,
    ) -> Optional[PumpFunQuote]:
        """
        Get quote for selling tokens for SOL.

        Args:
            mint: Token mint address
            token_amount: Amount of tokens to sell

        Returns:
            Quote or None if not available
        """
        token = await self.get_token(mint)
        if not token:
            return None

        # Calculate SOL received
        k = token.virtual_sol_reserves * token.virtual_token_reserves
        new_token_reserves = token.virtual_token_reserves + token_amount
        new_sol_reserves = k // new_token_reserves
        sol_out = token.virtual_sol_reserves - new_sol_reserves

        # pump.fun fee is 1%
        fee = int(sol_out * 0.01)
        sol_after_fee = sol_out - fee

        return PumpFunQuote(
            mint=mint,
            sol_amount=sol_after_fee,
            token_amount=token_amount,
            is_buy=False,
            price_per_token=sol_out / token_amount if token_amount > 0 else 0,
            fee=fee,
            total_sol=sol_after_fee,
        )

    # ============ WebSocket Subscription ============

    def on_token_created(self, callback: Callable[[PumpFunToken], None]):
        """Register callback for new token creation events."""
        self._callbacks[PumpFunEventType.TOKEN_CREATED].append(callback)

    def on_trade(self, callback: Callable[[PumpFunTrade], None]):
        """Register callback for trade events."""
        self._callbacks[PumpFunEventType.TRADE].append(callback)

    def on_migration(self, callback: Callable[[str], None]):
        """Register callback for migration events (token graduated to Raydium)."""
        self._callbacks[PumpFunEventType.MIGRATION].append(callback)

    async def subscribe_new_tokens(self):
        """Subscribe to all new token creation events."""
        if self._ws:
            await self._ws.send(json.dumps({"method": "subscribeNewToken"}))
            logger.info("Subscribed to pump.fun new token events")

    async def subscribe_token_trades(self, mint: str):
        """Subscribe to trades for a specific token."""
        self._subscribed_tokens.add(mint)
        if self._ws:
            await self._ws.send(json.dumps({"method": "subscribeTokenTrade", "keys": [mint]}))
            logger.debug(f"Subscribed to trades for {mint}")

    async def unsubscribe_token_trades(self, mint: str):
        """Unsubscribe from trades for a specific token."""
        self._subscribed_tokens.discard(mint)
        if self._ws:
            await self._ws.send(json.dumps({"method": "unsubscribeTokenTrade", "keys": [mint]}))

    async def start(self):
        """Start WebSocket connection for real-time events."""
        if self._running:
            return

        self._running = True
        self._ws_task = asyncio.create_task(self._ws_loop())
        logger.info("pump.fun WebSocket started")

    async def stop(self):
        """Stop WebSocket connection."""
        self._running = False
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
        logger.info("pump.fun WebSocket stopped")

    async def _ws_loop(self):
        """Main WebSocket event loop."""
        import websockets

        while self._running:
            try:
                async with websockets.connect(PUMP_FUN_WS) as ws:
                    self._ws = ws
                    logger.info("Connected to pump.fun WebSocket")

                    # Subscribe to new tokens
                    await self.subscribe_new_tokens()

                    # Resubscribe to any tokens we were watching
                    for mint in self._subscribed_tokens:
                        await self.subscribe_token_trades(mint)

                    # Process messages
                    async for message in ws:
                        try:
                            await self._handle_ws_message(message)
                        except Exception as e:
                            logger.error(f"Error handling pump.fun message: {e}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"pump.fun WebSocket error: {e}")
                await asyncio.sleep(5)  # Reconnect delay

    async def _handle_ws_message(self, message: str):
        """Handle incoming WebSocket message."""
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            return

        event_type = data.get("txType")

        if event_type == "create":
            # New token created
            token = self._parse_token(data)
            for callback in self._callbacks[PumpFunEventType.TOKEN_CREATED]:
                try:
                    (
                        await callback(token)
                        if asyncio.iscoroutinefunction(callback)
                        else callback(token)
                    )
                except Exception as e:
                    logger.error(f"Error in token_created callback: {e}")

        elif event_type in ("buy", "sell"):
            # Trade event
            trade = self._parse_trade(data)
            for callback in self._callbacks[PumpFunEventType.TRADE]:
                try:
                    (
                        await callback(trade)
                        if asyncio.iscoroutinefunction(callback)
                        else callback(trade)
                    )
                except Exception as e:
                    logger.error(f"Error in trade callback: {e}")

            # Check if this trade triggered migration
            if data.get("complete"):
                mint = data.get("mint")
                for callback in self._callbacks[PumpFunEventType.MIGRATION]:
                    try:
                        (
                            await callback(mint)
                            if asyncio.iscoroutinefunction(callback)
                            else callback(mint)
                        )
                    except Exception as e:
                        logger.error(f"Error in migration callback: {e}")

    # ============ Helper Methods ============

    def _parse_token(self, data: Dict) -> PumpFunToken:
        """Parse token data from API response."""
        return PumpFunToken(
            mint=data.get("mint", ""),
            name=data.get("name", ""),
            symbol=data.get("symbol", ""),
            description=data.get("description", ""),
            image_uri=data.get("image_uri", ""),
            creator=data.get("creator", ""),
            created_timestamp=data.get("created_timestamp", 0),
            bonding_curve=data.get("bonding_curve", ""),
            associated_bonding_curve=data.get("associated_bonding_curve", ""),
            virtual_sol_reserves=data.get("virtual_sol_reserves", 0),
            virtual_token_reserves=data.get("virtual_token_reserves", 0),
            total_supply=data.get("total_supply", 0),
            market_cap_sol=data.get("usd_market_cap", 0) / 200,  # Rough SOL conversion
            complete=data.get("complete", False),
            metadata_uri=data.get("metadata_uri"),
            twitter=data.get("twitter"),
            telegram=data.get("telegram"),
            website=data.get("website"),
        )

    def _parse_trade(self, data: Dict) -> PumpFunTrade:
        """Parse trade data from WebSocket message."""
        return PumpFunTrade(
            signature=data.get("signature", ""),
            mint=data.get("mint", ""),
            sol_amount=data.get("solAmount", 0),
            token_amount=data.get("tokenAmount", 0),
            is_buy=data.get("txType") == "buy",
            user=data.get("traderPublicKey", ""),
            timestamp=data.get("timestamp", 0),
            virtual_sol_reserves=data.get("vSolInBondingCurve", 0),
            virtual_token_reserves=data.get("vTokensInBondingCurve", 0),
        )


# Global instance
pump_fun_api = PumpFunAPI()
