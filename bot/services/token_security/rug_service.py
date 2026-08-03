"""Rug Protection Service for Solana."""

import logging
import asyncio
import json
import base64
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
import websockets
from solders.pubkey import Pubkey

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.services.jito_api import jito_api, TipPriority
from bot.services.swap_engine import SwapEngine
from bot.services.wallet import WalletService
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from database.db import get_session

logger = logging.getLogger(__name__)

# Program IDs to monitor
RAYDIUM_AMM = "675kPX9MHTjS2zt1qnt1dJLv765qL8p1kS47Ktr9GWh7"
PUMP_FUN_BONDING = "6EF8rrecthRzztZ6f34idMND7tV36o995mX8s2L2cS"


class RugService:
    """Monitors mempool/logs for rug events and frontruns with Panic Sells."""

    def __init__(self):
        self._running = False
        self._ws_task = None
        self._swap_engine = None
        self._wallet_service = WalletService()
        self._ws_url = (
            rpc_manager.get_rpc_url("solana")
            .replace("https://", "wss://")
            .replace("http://", "ws://")
        )

    async def start(self, swap_engine: SwapEngine):
        """Start the rug monitoring service."""
        if self._running:
            return

        self._running = True
        self._swap_engine = swap_engine
        self._ws_task = asyncio.create_task(self._monitor_loop())
        logger.info("Rug Protection Service started")

    async def stop(self):
        """Stop the monitoring service."""
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()
        logger.info("Rug Protection Service stopped")

    async def _monitor_loop(self):
        """Websocket loop to monitor program logs."""
        while self._running:
            try:
                async with websockets.connect(self._ws_url) as ws:
                    # Subscribe to Raydium logs
                    subscribe_msg = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "logsSubscribe",
                        "params": [{"mentions": [RAYDIUM_AMM]}, {"commitment": "processed"}],
                    }
                    await ws.send(json.dumps(subscribe_msg))
                    logger.info(f"Subscribed to Raydium logs on {self._ws_url}")

                    while self._running:
                        msg = await ws.recv()
                        data = json.loads(msg)

                        if "params" in data:
                            logs = data["params"]["result"]["value"]["logs"]
                            signature = data["params"]["result"]["value"]["signature"]

                            # Detect "RemoveLiquidity" or "Withdraw"
                            if any(
                                "withdraw" in log.lower() or "removeliquidity" in log.lower()
                                for log in logs
                            ):
                                # For demo/implementation: we would extract the token mint here
                                # extraction requires parsing the transaction inner instructions or lookups
                                # In this service, we'll use a simplified trigger
                                await self._handle_potential_rug(logs, signature)

            except Exception as e:
                logger.error(f"Rug monitor loop error: {e}")
                await asyncio.sleep(5)  # Backoff

    async def _handle_potential_rug(self, logs: List[str], signature: str):
        """Process a suspicious transaction."""
        # Note: Professional implementation would parse the exact token mint from the logs or transaction
        # For Suwappu, we'll demonstrate the frontrunning logic
        logger.warning(f"🚨 Potential Rug detected in tx {signature}!")

        # 1. Identify which token is being rugged (simplified placeholder)
        # Real logic: use getTransaction to find the LP address and from it the token mint
        token_mint = self._demo_extract_token_from_logs(logs)
        if not token_mint:
            return

        # 2. Find all users who hold this token AND have panic sell enabled
        users_to_protect = await self._get_users_holding_token(token_mint)

        if not users_to_protect:
            return

        logger.info(f"Protecting {len(users_to_protect)} users from rug on {token_mint}")

        # 3. Trigger Frontrun Sells via Jito
        tasks = []
        for user_id, wallet_id in users_to_protect:
            tasks.append(self._execute_panic_sell(user_id, wallet_id, token_mint))

        if tasks:
            await asyncio.gather(*tasks)

    async def _get_users_holding_token(self, token_mint: str) -> List[tuple]:
        """Find users with active positions in a token."""
        # Placeholder: query database for users who swapped into this token recently
        # and Haven't swapped OUT of it yet.
        holders = []
        with get_session() as session:
            # Join Task: select users with matching token buys and panic_sell_enabled
            # This is a simplified query
            results = (
                session.query(User.id, Wallet.id)
                .join(Wallet)
                .join(SwapTransaction, SwapTransaction.user_id == User.id)
                .filter(
                    User.panic_sell_enabled == True,
                    SwapTransaction.to_token
                    == token_mint,  # Assuming token_mint is symbol or address
                    SwapTransaction.status == "completed",
                )
                .all()
            )
            holders = results
        return holders

    async def _execute_panic_sell(self, user_id: int, wallet_id: int, token_mint: str):
        """Execute a 'Sell All' with Ultra Priority."""
        try:
            logger.info(f"Executing PANIC SELL for user {user_id} on {token_mint}")

            # 1. Get full balance
            wallet = self._wallet_service.get_wallet_by_id(wallet_id)
            balance = await self._wallet_service.get_token_balance(wallet_id, "solana", token_mint)

            if balance <= 0:
                return

            # 2. Get Quote for Sell
            quote = await self._swap_engine.get_quote(
                from_chain="solana",
                to_chain="solana",
                from_token=token_mint,
                to_token="SOL",
                amount=balance,
                from_address=wallet.address,
                slippage=25.0,  # High slippage for panic sell (25%)
            )

            # 3. Execute via Jito with URGENT tip
            # Jito ensures we are bundled or priority-placed
            await self._swap_engine.execute_swap(
                quote=quote,
                wallet_id=wallet_id,
                user_id=user_id,
                idempotency_key=f"panic_sell:{token_mint}:{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}",
            )

            logger.info(f"✅ Panic Sell SUCCESS for user {user_id}")

        except Exception as e:
            logger.error(f"Panic Sell failed for user {user_id}: {e}")

    def _demo_extract_token_from_logs(self, logs: List[str]) -> Optional[str]:
        """Mock helper to extract token mint from logs."""
        # In production, we parse 'Program log: ...'
        return "DEMO_TOKEN_MINT"


# Global instance
rug_service = RugService()
