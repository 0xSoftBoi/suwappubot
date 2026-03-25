"""Raydium pool creation monitor for token launch sniping.

Raydium is the largest DEX on Solana. New token launches either:
1. Start on pump.fun and migrate to Raydium after bonding curve completes
2. Launch directly on Raydium with a new liquidity pool

This monitor watches for:
- New AMM pool creation (liquidity added)
- CLMM (concentrated liquidity) pool creation
- Migration events from pump.fun

Key events to snipe:
1. New pool initialization transaction
2. First liquidity add after pool creation
3. pump.fun graduation (bonding curve -> Raydium pool)
"""

import logging
import asyncio
import json
import base64
from typing import Optional, Dict, Any, List, Callable, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from solders.pubkey import Pubkey

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Raydium program IDs
RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
RAYDIUM_CLMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
RAYDIUM_CPSWAP = "CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW"

# Token programs
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

# Known wrapped SOL
WRAPPED_SOL = "So11111111111111111111111111111111111111112"


class PoolType(Enum):
    """Type of Raydium pool."""
    AMM_V4 = "amm_v4"
    CLMM = "clmm"
    CPSWAP = "cpswap"


@dataclass
class RaydiumPool:
    """Raydium liquidity pool information."""
    pool_id: str
    pool_type: PoolType
    base_mint: str
    quote_mint: str
    base_vault: str
    quote_vault: str
    lp_mint: str
    base_reserve: int
    quote_reserve: int
    lp_supply: int
    created_slot: Optional[int] = None
    created_time: Optional[datetime] = None
    fee_rate: float = 0.0025  # Default 0.25%
    open_time: Optional[int] = None

    @property
    def is_sol_pair(self) -> bool:
        """Check if pool is paired with SOL."""
        return self.quote_mint == WRAPPED_SOL or self.base_mint == WRAPPED_SOL

    @property
    def token_mint(self) -> str:
        """Get the non-SOL token mint."""
        if self.base_mint == WRAPPED_SOL:
            return self.quote_mint
        return self.base_mint

    @property
    def initial_price(self) -> float:
        """Calculate initial price in SOL."""
        if self.base_mint == WRAPPED_SOL:
            if self.quote_reserve == 0:
                return 0
            return self.base_reserve / self.quote_reserve
        else:
            if self.base_reserve == 0:
                return 0
            return self.quote_reserve / self.base_reserve


@dataclass
class PoolCreationEvent:
    """Event emitted when a new pool is created."""
    pool: RaydiumPool
    signature: str
    slot: int
    timestamp: datetime
    creator: str
    initial_base_amount: int
    initial_quote_amount: int

    @property
    def initial_liquidity_sol(self) -> float:
        """Initial liquidity in SOL."""
        if self.pool.base_mint == WRAPPED_SOL:
            return self.initial_base_amount / 1e9
        elif self.pool.quote_mint == WRAPPED_SOL:
            return self.initial_quote_amount / 1e9
        return 0


class RaydiumError(Exception):
    """Exception for Raydium monitor errors."""
    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class RaydiumMonitor:
    """Monitor for Raydium pool creation events.

    Features:
    - Poll for new pools via RPC logs subscription
    - Parse pool initialization transactions
    - Track liquidity additions
    - Detect pump.fun migrations
    """

    def __init__(self):
        self._ws = None
        self._ws_task = None
        self._running = False
        self._callbacks: List[Callable[[PoolCreationEvent], None]] = []
        self._last_signature: Optional[str] = None
        self._check_interval = 2  # seconds

    def on_pool_created(self, callback: Callable[[PoolCreationEvent], None]):
        """Register callback for new pool creation events."""
        self._callbacks.append(callback)

    async def get_pool_info(self, pool_id: str) -> Optional[RaydiumPool]:
        """
        Get pool information by pool ID.

        Args:
            pool_id: Pool account address

        Returns:
            RaydiumPool or None if not found
        """
        await api_limiter.wait_and_acquire("solana")

        try:
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            # Get account info
            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getAccountInfo",
                    "params": [pool_id, {"encoding": "base64"}]
                }
            ) as response:
                if response.status != 200:
                    return None

                data = await response.json()
                result = data.get("result", {})

                if not result or not result.get("value"):
                    return None

                account_data = result["value"]["data"][0]
                owner = result["value"]["owner"]

                return self._parse_pool_account(pool_id, account_data, owner)

        except Exception as e:
            logger.error(f"Error getting pool info {pool_id}: {e}")
            return None

    async def get_recent_pools(
        self,
        limit: int = 20,
        pool_type: Optional[PoolType] = None,
    ) -> List[RaydiumPool]:
        """
        Get recently created pools.

        Args:
            limit: Maximum number of pools to return
            pool_type: Filter by pool type

        Returns:
            List of recent pools
        """
        await api_limiter.wait_and_acquire("solana")

        pools = []
        try:
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            # Get recent signatures for Raydium programs
            program = RAYDIUM_AMM_V4
            if pool_type == PoolType.CLMM:
                program = RAYDIUM_CLMM
            elif pool_type == PoolType.CPSWAP:
                program = RAYDIUM_CPSWAP

            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getSignaturesForAddress",
                    "params": [program, {"limit": limit * 2}]
                }
            ) as response:
                if response.status != 200:
                    return []

                data = await response.json()
                signatures = data.get("result", [])

            # Parse transactions for pool creations
            for sig_info in signatures[:limit]:
                signature = sig_info.get("signature")
                pool = await self._parse_pool_creation_tx(signature)
                if pool:
                    pools.append(pool)
                    if len(pools) >= limit:
                        break

        except Exception as e:
            logger.error(f"Error getting recent pools: {e}")

        return pools

    async def start(self):
        """Start monitoring for new pool creations."""
        if self._running:
            return

        self._running = True
        self._ws_task = asyncio.create_task(self._monitor_loop())
        logger.info("Raydium pool monitor started")

    async def stop(self):
        """Stop monitoring."""
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
        logger.info("Raydium pool monitor stopped")

    async def _monitor_loop(self):
        """Main monitoring loop using log subscription."""
        while self._running:
            try:
                await self._poll_new_pools()
            except Exception as e:
                logger.error(f"Error in pool monitor loop: {e}")

            await asyncio.sleep(self._check_interval)

    async def _poll_new_pools(self):
        """Poll for new pool creation transactions."""
        await api_limiter.wait_and_acquire("solana")

        try:
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            # Get recent signatures for AMM program
            params = {"limit": 10}
            if self._last_signature:
                params["until"] = self._last_signature

            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getSignaturesForAddress",
                    "params": [RAYDIUM_AMM_V4, params]
                }
            ) as response:
                if response.status != 200:
                    return

                data = await response.json()
                signatures = data.get("result", [])

            if signatures:
                self._last_signature = signatures[0].get("signature")

            # Process new transactions
            for sig_info in reversed(signatures):  # Process oldest first
                signature = sig_info.get("signature")
                event = await self._check_pool_creation(signature)
                if event:
                    for callback in self._callbacks:
                        try:
                            if asyncio.iscoroutinefunction(callback):
                                await callback(event)
                            else:
                                callback(event)
                        except Exception as e:
                            logger.error(f"Error in pool created callback: {e}")

        except Exception as e:
            logger.error(f"Error polling new pools: {e}")

    async def _check_pool_creation(self, signature: str) -> Optional[PoolCreationEvent]:
        """Check if a transaction is a pool creation."""
        try:
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getTransaction",
                    "params": [
                        signature,
                        {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}
                    ]
                }
            ) as response:
                if response.status != 200:
                    return None

                data = await response.json()
                result = data.get("result")

                if not result:
                    return None

                return self._parse_pool_creation_event(result, signature)

        except Exception as e:
            logger.debug(f"Error checking pool creation {signature}: {e}")
            return None

    def _parse_pool_creation_event(
        self,
        tx_data: Dict,
        signature: str
    ) -> Optional[PoolCreationEvent]:
        """Parse a transaction to extract pool creation event."""
        try:
            meta = tx_data.get("meta", {})
            if meta.get("err"):
                return None

            slot = tx_data.get("slot", 0)
            block_time = tx_data.get("blockTime", 0)

            # Look for pool initialization instruction
            message = tx_data.get("transaction", {}).get("message", {})
            instructions = message.get("instructions", [])
            inner_instructions = meta.get("innerInstructions", [])

            # Find Raydium AMM initialize instruction
            for ix in instructions:
                program_id = ix.get("programId", "")
                if program_id != RAYDIUM_AMM_V4:
                    continue

                # Check if it's an initialize instruction
                # AMM initialize creates new accounts for pool, vaults, etc.
                accounts = ix.get("accounts", [])
                if len(accounts) < 10:
                    continue

                # Parse pool accounts from instruction
                # Standard AMM v4 initialize layout:
                # [0] token_program, [1] system_program, [2] rent, [3] amm
                # [4] amm_authority, [5] amm_open_orders, [6] lp_mint
                # [7] coin_mint, [8] pc_mint, [9] coin_vault, [10] pc_vault
                try:
                    pool_id = accounts[3] if len(accounts) > 3 else None
                    lp_mint = accounts[6] if len(accounts) > 6 else None
                    base_mint = accounts[7] if len(accounts) > 7 else None
                    quote_mint = accounts[8] if len(accounts) > 8 else None
                    base_vault = accounts[9] if len(accounts) > 9 else None
                    quote_vault = accounts[10] if len(accounts) > 10 else None

                    if not all([pool_id, base_mint, quote_mint]):
                        continue

                    # Get initial amounts from token balance changes
                    pre_balances = meta.get("preTokenBalances", [])
                    post_balances = meta.get("postTokenBalances", [])

                    initial_base = 0
                    initial_quote = 0

                    for bal in post_balances:
                        owner = bal.get("owner", "")
                        mint = bal.get("mint", "")
                        amount = int(bal.get("uiTokenAmount", {}).get("amount", "0"))

                        if owner == base_vault and mint == base_mint:
                            initial_base = amount
                        elif owner == quote_vault and mint == quote_mint:
                            initial_quote = amount

                    pool = RaydiumPool(
                        pool_id=pool_id,
                        pool_type=PoolType.AMM_V4,
                        base_mint=base_mint,
                        quote_mint=quote_mint,
                        base_vault=base_vault or "",
                        quote_vault=quote_vault or "",
                        lp_mint=lp_mint or "",
                        base_reserve=initial_base,
                        quote_reserve=initial_quote,
                        lp_supply=0,
                        created_slot=slot,
                        created_time=datetime.fromtimestamp(block_time) if block_time else None,
                    )

                    # Get creator from fee payer
                    account_keys = message.get("accountKeys", [])
                    creator = account_keys[0] if account_keys else ""
                    if isinstance(creator, dict):
                        creator = creator.get("pubkey", "")

                    return PoolCreationEvent(
                        pool=pool,
                        signature=signature,
                        slot=slot,
                        timestamp=datetime.fromtimestamp(block_time) if block_time else datetime.now(timezone.utc),
                        creator=creator,
                        initial_base_amount=initial_base,
                        initial_quote_amount=initial_quote,
                    )

                except (IndexError, KeyError, TypeError) as e:
                    logger.debug(f"Error parsing pool accounts: {e}")
                    continue

        except Exception as e:
            logger.debug(f"Error parsing pool creation: {e}")

        return None

    async def _parse_pool_creation_tx(self, signature: str) -> Optional[RaydiumPool]:
        """Parse a transaction to extract pool info."""
        event = await self._check_pool_creation(signature)
        return event.pool if event else None

    def _parse_pool_account(
        self,
        pool_id: str,
        account_data: str,
        owner: str
    ) -> Optional[RaydiumPool]:
        """Parse pool account data."""
        try:
            data = base64.b64decode(account_data)

            # Determine pool type from owner
            if owner == RAYDIUM_AMM_V4:
                pool_type = PoolType.AMM_V4
                # AMM v4 account layout (simplified)
                # This is a simplified parsing - actual layout is more complex
                if len(data) < 400:
                    return None

                # Extract key fields from account data
                # Note: This is simplified, actual parsing requires proper deserialization
                return RaydiumPool(
                    pool_id=pool_id,
                    pool_type=pool_type,
                    base_mint="",  # Would need proper parsing
                    quote_mint="",
                    base_vault="",
                    quote_vault="",
                    lp_mint="",
                    base_reserve=0,
                    quote_reserve=0,
                    lp_supply=0,
                )

            elif owner == RAYDIUM_CLMM:
                pool_type = PoolType.CLMM
                return RaydiumPool(
                    pool_id=pool_id,
                    pool_type=pool_type,
                    base_mint="",
                    quote_mint="",
                    base_vault="",
                    quote_vault="",
                    lp_mint="",
                    base_reserve=0,
                    quote_reserve=0,
                    lp_supply=0,
                )

        except Exception as e:
            logger.debug(f"Error parsing pool account: {e}")

        return None


# Global instance
raydium_monitor = RaydiumMonitor()
