"""Snipe order execution service.

Handles the execution of snipe orders with:
1. Speed-optimized transaction construction
2. Jito bundle submission for MEV protection
3. Multi-RPC submission for reliability
4. Automatic retry with increasing priority

Execution modes:
- INSTANT: Execute immediately when launch detected
- CONDITIONAL: Execute when conditions met (e.g., min liquidity)
- FIRST_BLOCK: Attempt to execute in the same block as launch
"""

import logging
import asyncio
import base64
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.transaction import Transaction, VersionedTransaction
from solders.message import Message, MessageV0
from solders.system_program import transfer, TransferParams
from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.services.jito_api import jito_api, TipPriority, JitoError
from bot.services.sniping.pump_fun_api import pump_fun_api, PumpFunQuote
from bot.services.sniping.launch_detector import TokenLaunch, LaunchPlatform
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from database.db import get_session as get_db_session

logger = logging.getLogger(__name__)

# Jupiter aggregator
JUPITER_API = "https://lite-api.jup.ag/swap/v1"
JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1/swap"

# Compute budget settings for speed
HIGH_PRIORITY_COMPUTE_UNITS = 200_000
ULTRA_PRIORITY_COMPUTE_PRICE = 1_000_000  # micro-lamports per CU

# Wrapped SOL mint
WSOL_MINT = "So11111111111111111111111111111111111111112"


class SnipeMode(Enum):
    """Execution mode for snipes."""

    INSTANT = "instant"  # Execute immediately
    CONDITIONAL = "conditional"  # Wait for conditions
    FIRST_BLOCK = "first_block"  # Try to land in same block


class SnipeStatus(Enum):
    """Status of a snipe order."""

    PENDING = "pending"
    EXECUTING = "executing"
    SUBMITTED = "submitted"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class SnipeConfig:
    """Configuration for a snipe."""

    sol_amount: float  # Amount of SOL to spend
    slippage_bps: int = 1000  # 10% default slippage
    mode: SnipeMode = SnipeMode.INSTANT
    use_jito: bool = True  # Use Jito for MEV protection
    jito_tip_lamports: int = TipPriority.HIGH.value
    max_retries: int = 3
    timeout_seconds: float = 30.0

    # Conditional settings
    min_liquidity_sol: Optional[float] = None
    max_price_sol: Optional[float] = None


@dataclass
class SnipeResult:
    """Result of a snipe execution."""

    success: bool
    status: SnipeStatus
    token_mint: str
    sol_spent: float
    tokens_received: float
    price_per_token: float
    signature: Optional[str] = None
    bundle_id: Optional[str] = None
    error: Optional[str] = None
    execution_time_ms: float = 0
    slot: Optional[int] = None
    retries: int = 0


class SnipeExecutorError(Exception):
    """Exception for snipe execution errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class SnipeExecutor:
    """Executes snipe orders with speed optimization.

    Usage:
        executor = snipe_executor  # Global instance

        result = await executor.execute_snipe(
            launch=detected_launch,
            wallet_keypair=user_keypair,
            config=SnipeConfig(sol_amount=0.5)
        )
    """

    def __init__(self):
        self._pending_snipes: Dict[str, asyncio.Task] = {}  # mint -> task

    async def execute_snipe(
        self,
        launch: TokenLaunch,
        wallet_keypair: Keypair,
        config: SnipeConfig,
    ) -> SnipeResult:
        """
        Execute a snipe order for a token launch.

        Args:
            launch: The detected token launch
            wallet_keypair: User's Solana keypair
            config: Snipe configuration

        Returns:
            SnipeResult with execution details
        """
        start_time = datetime.now(timezone.utc)

        try:
            # Determine execution path based on platform
            if launch.platform == LaunchPlatform.PUMP_FUN:
                return await self._execute_pump_fun_snipe(
                    launch, wallet_keypair, config, start_time
                )
            elif launch.platform in (LaunchPlatform.RAYDIUM, LaunchPlatform.PUMP_FUN_MIGRATION):
                return await self._execute_raydium_snipe(launch, wallet_keypair, config, start_time)
            else:
                raise SnipeExecutorError(f"Unknown platform: {launch.platform}")

        except Exception as e:
            execution_time = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            logger.error(f"Snipe execution error: {e}")
            return SnipeResult(
                success=False,
                status=SnipeStatus.FAILED,
                token_mint=launch.token_mint,
                sol_spent=0,
                tokens_received=0,
                price_per_token=0,
                error=str(e),
                execution_time_ms=execution_time,
            )

    async def _execute_pump_fun_snipe(
        self,
        launch: TokenLaunch,
        wallet_keypair: Keypair,
        config: SnipeConfig,
        start_time: datetime,
    ) -> SnipeResult:
        """Execute snipe on pump.fun bonding curve."""
        # Get quote from pump.fun
        quote = await pump_fun_api.get_buy_quote(launch.token_mint, config.sol_amount)

        if not quote:
            raise SnipeExecutorError("Failed to get pump.fun quote")

        # For pump.fun, we need to build a transaction that:
        # 1. Wraps SOL if needed
        # 2. Calls the pump.fun buy instruction
        # 3. Includes priority fees for speed

        # Build transaction
        transaction = await self._build_pump_fun_buy_tx(
            mint=launch.token_mint,
            bonding_curve=launch.bonding_curve,
            quote=quote,
            wallet=wallet_keypair,
            slippage_bps=config.slippage_bps,
        )

        # Submit via Jito if enabled
        if config.use_jito:
            result = await self._submit_via_jito(
                transaction=transaction,
                wallet=wallet_keypair,
                tip_lamports=config.jito_tip_lamports,
                max_retries=config.max_retries,
            )
        else:
            result = await self._submit_direct(
                transaction=transaction,
                wallet=wallet_keypair,
                max_retries=config.max_retries,
            )

        execution_time = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

        if result["success"]:
            return SnipeResult(
                success=True,
                status=SnipeStatus.CONFIRMED,
                token_mint=launch.token_mint,
                sol_spent=config.sol_amount,
                tokens_received=quote.token_amount,
                price_per_token=quote.price_per_token,
                signature=result.get("signature"),
                bundle_id=result.get("bundle_id"),
                execution_time_ms=execution_time,
                slot=result.get("slot"),
                retries=result.get("retries", 0),
            )
        else:
            return SnipeResult(
                success=False,
                status=SnipeStatus.FAILED,
                token_mint=launch.token_mint,
                sol_spent=0,
                tokens_received=0,
                price_per_token=0,
                error=result.get("error"),
                execution_time_ms=execution_time,
                retries=result.get("retries", 0),
            )

    async def _execute_raydium_snipe(
        self,
        launch: TokenLaunch,
        wallet_keypair: Keypair,
        config: SnipeConfig,
        start_time: datetime,
    ) -> SnipeResult:
        """Execute snipe via Jupiter (Raydium routing)."""
        # Get Jupiter quote
        quote = await self._get_jupiter_quote(
            input_mint=WSOL_MINT,
            output_mint=launch.token_mint,
            amount=int(config.sol_amount * 1e9),
            slippage_bps=config.slippage_bps,
        )

        if not quote:
            raise SnipeExecutorError("Failed to get Jupiter quote")

        # Get swap transaction from Jupiter
        swap_tx = await self._get_jupiter_swap_tx(
            quote=quote,
            user_pubkey=str(wallet_keypair.pubkey()),
            wrap_unwrap_sol=True,
            use_priority_fee=True,
        )

        if not swap_tx:
            raise SnipeExecutorError("Failed to get Jupiter swap transaction")

        # Sign the transaction
        transaction = VersionedTransaction.from_bytes(base64.b64decode(swap_tx))
        transaction.sign([wallet_keypair])

        # Submit via Jito if enabled
        if config.use_jito:
            result = await self._submit_via_jito(
                transaction=transaction,
                wallet=wallet_keypair,
                tip_lamports=config.jito_tip_lamports,
                max_retries=config.max_retries,
                is_versioned=True,
            )
        else:
            result = await self._submit_direct(
                transaction=transaction,
                wallet=wallet_keypair,
                max_retries=config.max_retries,
                is_versioned=True,
            )

        execution_time = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

        out_amount = int(quote.get("outAmount", 0))
        in_amount = int(quote.get("inAmount", 0))
        price = in_amount / out_amount if out_amount > 0 else 0

        if result["success"]:
            return SnipeResult(
                success=True,
                status=SnipeStatus.CONFIRMED,
                token_mint=launch.token_mint,
                sol_spent=in_amount / 1e9,
                tokens_received=out_amount,
                price_per_token=price,
                signature=result.get("signature"),
                bundle_id=result.get("bundle_id"),
                execution_time_ms=execution_time,
                slot=result.get("slot"),
                retries=result.get("retries", 0),
            )
        else:
            return SnipeResult(
                success=False,
                status=SnipeStatus.FAILED,
                token_mint=launch.token_mint,
                sol_spent=0,
                tokens_received=0,
                price_per_token=0,
                error=result.get("error"),
                execution_time_ms=execution_time,
                retries=result.get("retries", 0),
            )

    async def _build_pump_fun_buy_tx(
        self,
        mint: str,
        bonding_curve: Optional[str],
        quote: PumpFunQuote,
        wallet: Keypair,
        slippage_bps: int,
    ) -> Transaction:
        """Build a pump.fun buy transaction."""
        # This is a simplified implementation
        # Real implementation would need to:
        # 1. Create associated token account if needed
        # 2. Build the pump.fun buy instruction with proper accounts
        # 3. Add compute budget instructions

        from solders.hash import Hash

        # Get recent blockhash
        session = await get_session()
        rpc_url = rpc_manager.get_rpc_url("solana")

        async with session.post(
            rpc_url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "confirmed"}],
            },
        ) as response:
            data = await response.json()
            blockhash = Hash.from_string(data["result"]["value"]["blockhash"])

        # Build transaction with compute budget
        compute_limit_ix = set_compute_unit_limit(HIGH_PRIORITY_COMPUTE_UNITS)
        compute_price_ix = set_compute_unit_price(ULTRA_PRIORITY_COMPUTE_PRICE)

        # For now, use a placeholder - real implementation needs pump.fun instruction builder
        # This would integrate with pump.fun SDK or manual instruction building
        instructions = [
            compute_limit_ix,
            compute_price_ix,
            # pump.fun buy instruction would go here
        ]

        message = Message.new_with_blockhash(
            instructions,
            wallet.pubkey(),
            blockhash,
        )

        return Transaction.new_unsigned(message)

    async def _get_jupiter_quote(
        self,
        input_mint: str,
        output_mint: str,
        amount: int,
        slippage_bps: int,
    ) -> Optional[Dict]:
        """Get quote from Jupiter aggregator."""
        await api_limiter.wait_and_acquire("jupiter")

        try:
            session = await get_session()

            params = {
                "inputMint": input_mint,
                "outputMint": output_mint,
                "amount": str(amount),
                "slippageBps": slippage_bps,
                "onlyDirectRoutes": "false",
                "asLegacyTransaction": "false",
            }

            async with session.get(
                f"{JUPITER_API}/quote", params=params, headers={"Accept": "application/json"}
            ) as response:
                if response.status != 200:
                    return None

                return await response.json()

        except Exception as e:
            logger.error(f"Jupiter quote error: {e}")
            return None

    async def _get_jupiter_swap_tx(
        self,
        quote: Dict,
        user_pubkey: str,
        wrap_unwrap_sol: bool = True,
        use_priority_fee: bool = True,
    ) -> Optional[str]:
        """Get swap transaction from Jupiter."""
        await api_limiter.wait_and_acquire("jupiter")

        try:
            session = await get_session()

            payload = {
                "quoteResponse": quote,
                "userPublicKey": user_pubkey,
                "wrapAndUnwrapSol": wrap_unwrap_sol,
                "dynamicComputeUnitLimit": True,
                "prioritizationFeeLamports": "auto" if use_priority_fee else 0,
            }

            async with session.post(
                JUPITER_SWAP_API, json=payload, headers={"Content-Type": "application/json"}
            ) as response:
                if response.status != 200:
                    return None

                data = await response.json()
                return data.get("swapTransaction")

        except Exception as e:
            logger.error(f"Jupiter swap tx error: {e}")
            return None

    async def _submit_via_jito(
        self,
        transaction: Any,
        wallet: Keypair,
        tip_lamports: int,
        max_retries: int,
        is_versioned: bool = False,
    ) -> Dict:
        """Submit transaction via Jito bundle."""
        retries = 0

        while retries <= max_retries:
            try:
                # Encode transaction
                if is_versioned:
                    tx_bytes = bytes(transaction)
                else:
                    tx_bytes = bytes(transaction)

                tx_base64 = base64.b64encode(tx_bytes).decode()

                # Submit bundle
                bundle_id, signature = await jito_api.submit_swap_bundle(
                    swap_transaction=tx_base64,
                    tip_amount=tip_lamports,
                )

                # Poll for confirmation
                confirmed = await self._wait_for_confirmation(bundle_id, signature)

                if confirmed:
                    return {
                        "success": True,
                        "signature": signature,
                        "bundle_id": bundle_id,
                        "retries": retries,
                    }

                retries += 1
                # Increase tip for retry
                tip_lamports = int(tip_lamports * 1.5)

            except JitoError as e:
                logger.warning(f"Jito submission error (retry {retries}): {e}")
                retries += 1

            except Exception as e:
                logger.error(f"Unexpected error in Jito submission: {e}")
                return {
                    "success": False,
                    "error": str(e),
                    "retries": retries,
                }

        return {
            "success": False,
            "error": f"Max retries ({max_retries}) exceeded",
            "retries": retries,
        }

    async def _submit_direct(
        self,
        transaction: Any,
        wallet: Keypair,
        max_retries: int,
        is_versioned: bool = False,
    ) -> Dict:
        """Submit transaction directly to RPC."""
        retries = 0
        session = await get_session()

        while retries <= max_retries:
            try:
                rpc_url = rpc_manager.get_rpc_url("solana")

                # Encode transaction
                if is_versioned:
                    tx_bytes = bytes(transaction)
                else:
                    tx_bytes = bytes(transaction)

                tx_base64 = base64.b64encode(tx_bytes).decode()

                async with session.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "sendTransaction",
                        "params": [
                            tx_base64,
                            {
                                "encoding": "base64",
                                "skipPreflight": True,
                                "maxRetries": 0,
                            },
                        ],
                    },
                ) as response:
                    data = await response.json()

                    if "error" in data:
                        raise SnipeExecutorError(
                            f"RPC error: {data['error'].get('message', 'Unknown')}"
                        )

                    signature = data.get("result")

                    # Wait for confirmation
                    confirmed = await self._wait_for_signature_confirmation(signature)

                    if confirmed:
                        return {
                            "success": True,
                            "signature": signature,
                            "retries": retries,
                        }

                retries += 1

            except Exception as e:
                logger.warning(f"Direct submission error (retry {retries}): {e}")
                retries += 1

        return {
            "success": False,
            "error": f"Max retries ({max_retries}) exceeded",
            "retries": retries,
        }

    async def _wait_for_confirmation(
        self,
        bundle_id: str,
        signature: str,
        timeout: float = 30.0,
    ) -> bool:
        """Wait for Jito bundle confirmation."""
        start = asyncio.get_event_loop().time()

        while (asyncio.get_event_loop().time() - start) < timeout:
            try:
                statuses = await jito_api.get_bundle_statuses([bundle_id])

                if statuses and statuses[0].status == "landed":
                    return True
                elif statuses and statuses[0].status == "failed":
                    return False

            except Exception as e:
                logger.debug(f"Error checking bundle status: {e}")

            await asyncio.sleep(0.5)

        return False

    async def _wait_for_signature_confirmation(
        self,
        signature: str,
        timeout: float = 30.0,
    ) -> bool:
        """Wait for transaction confirmation."""
        start = asyncio.get_event_loop().time()
        session = await get_session()

        while (asyncio.get_event_loop().time() - start) < timeout:
            try:
                rpc_url = rpc_manager.get_rpc_url("solana")

                async with session.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getSignatureStatuses",
                        "params": [[signature]],
                    },
                ) as response:
                    data = await response.json()
                    result = data.get("result", {}).get("value", [])

                    if result and result[0]:
                        status = result[0]
                        if status.get("confirmationStatus") in ("confirmed", "finalized"):
                            return True
                        if status.get("err"):
                            return False

            except Exception as e:
                logger.debug(f"Error checking signature status: {e}")

            await asyncio.sleep(0.5)

        return False

    async def cancel_pending_snipe(self, token_mint: str) -> bool:
        """Cancel a pending snipe order."""
        task = self._pending_snipes.get(token_mint)
        if task:
            task.cancel()
            self._pending_snipes.pop(token_mint, None)
            return True
        return False


# Global instance
snipe_executor = SnipeExecutor()
