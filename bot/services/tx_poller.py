"""Transaction status polling service."""

import asyncio
import logging
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from bot.models.swap import SwapTransaction, SwapStatus
from bot.config.chains import get_chain_by_name, ChainType
from bot.utils.http_client import get_session
from database.db import get_session as get_db_session
from bot.config.settings import settings
from bot.services.lifi_api import LiFiAPI

logger = logging.getLogger(__name__)


class TransactionPoller:
    """Background service to poll and update transaction statuses."""
    
    def __init__(self, poll_interval: int = 15, max_age_hours: int = 24):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._poll_interval = poll_interval  # seconds
        self._max_age_hours = max_age_hours
        self._bot = None
        self._lifi = LiFiAPI()
        logger.info(f"Transaction poller initialized (interval: {poll_interval}s)")
    
    async def start(self, bot=None):
        """Start the transaction polling service."""
        if self._running:
            return
        
        self._running = True
        self._bot = bot
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("Transaction poller started")
    
    async def stop(self):
        """Stop the polling service."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Transaction poller stopped")
    
    async def _poll_loop(self):
        """Main polling loop."""
        while self._running:
            try:
                await self._check_pending_transactions()
            except Exception as e:
                logger.error(f"Transaction poll error: {e}")
            
            await asyncio.sleep(self._poll_interval)
    
    async def _check_pending_transactions(self):
        """Check all pending/submitted transactions."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self._max_age_hours)
        
        with get_db_session() as session:
            # Get pending/submitted transactions
            pending_txs = session.query(SwapTransaction).filter(
                SwapTransaction.status.in_([
                    SwapStatus.SUBMITTED.value,
                    SwapStatus.EXECUTING.value,
                    SwapStatus.PENDING.value,
                ]),
                SwapTransaction.created_at >= cutoff,
                SwapTransaction.tx_hash.isnot(None),
            ).all()
            
            if not pending_txs:
                return
            
            logger.info(f"Checking {len(pending_txs)} pending transactions")
            
            for tx in pending_txs:
                try:
                    new_status = await self._check_tx_status(tx)
                    
                    if new_status and new_status != tx.status:
                        old_status = tx.status
                        tx.status = new_status

                        if new_status == SwapStatus.COMPLETED.value:
                            tx.completed_at = datetime.now(timezone.utc)

                        logger.info(
                            f"Transaction {tx.id} status: {old_status} -> {new_status}"
                        )

                        # Invalidate balance cache on completion/failure
                        if new_status in (SwapStatus.COMPLETED.value, SwapStatus.FAILED.value):
                            await self._invalidate_balance_cache(tx)

                        # Notify user
                        await self._notify_user(tx, old_status, new_status)
                        
                except Exception as e:
                    logger.error(f"Error checking tx {tx.id}: {e}")
    
    async def _check_tx_status(self, tx: SwapTransaction) -> Optional[str]:
        """Check transaction status on chain."""
        if not tx.tx_hash:
            return None
        
        chain = get_chain_by_name(tx.from_chain)
        if not chain:
            return None
        
        # Cross-chain via Li.Fi should use Li.Fi status (source receipt != end-to-end completion)
        if tx.route_provider == "lifi" and tx.from_chain != tx.to_chain:
            return await self._check_lifi_status(tx)

        if chain.chain_type == ChainType.EVM:
            rpc_url = settings.get_rpc_url(chain.name)
            return await self._check_evm_tx(tx.tx_hash, rpc_url)
        elif chain.chain_type == ChainType.SOLANA:
            return await self._check_solana_tx(tx.tx_hash)
        
        return None

    async def _check_lifi_status(self, tx: SwapTransaction) -> Optional[str]:
        """Check cross-chain swap status via Li.Fi API and persist destination tx hash if present."""
        try:
            status = await self._lifi.get_status(
                tx_hash=tx.tx_hash,
                from_chain=tx.from_chain,
                to_chain=tx.to_chain,
            )

            if status.status == "DONE":
                if status.receiving_tx_hash:
                    with get_db_session() as session:
                        db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == tx.id).first()
                        if db_tx:
                            db_tx.destination_tx_hash = status.receiving_tx_hash
                return SwapStatus.COMPLETED.value

            if status.status == "FAILED":
                return SwapStatus.FAILED.value

            return SwapStatus.CONFIRMING.value

        except Exception as e:
            logger.error(f"Li.Fi status check error: {e}")
            return None
    
    async def _check_evm_tx(self, tx_hash: str, rpc_url: str) -> Optional[str]:
        """Check EVM transaction status."""
        try:
            http_session = await get_session()
            
            payload = {
                "jsonrpc": "2.0",
                "method": "eth_getTransactionReceipt",
                "params": [tx_hash],
                "id": 1,
            }
            
            async with http_session.post(rpc_url, json=payload) as response:
                if response.status != 200:
                    return None
                
                data = await response.json()
                result = data.get("result")
                
                if result is None:
                    # Transaction not yet mined
                    return SwapStatus.SUBMITTED.value
                
                status = result.get("status")
                if status == "0x1":
                    return SwapStatus.COMPLETED.value
                elif status == "0x0":
                    return SwapStatus.FAILED.value
                
        except Exception as e:
            logger.error(f"EVM tx check error: {e}")
        
        return None
    
    async def _check_solana_tx(self, tx_hash: str) -> Optional[str]:
        """Check Solana transaction status."""
        try:
            
            http_session = await get_session()
            
            payload = {
                "jsonrpc": "2.0",
                "method": "getSignatureStatuses",
                "params": [[tx_hash], {"searchTransactionHistory": True}],
                "id": 1,
            }
            
            async with http_session.post(settings.get_rpc_url("solana"), json=payload) as response:
                if response.status != 200:
                    return None
                
                data = await response.json()
                result = data.get("result", {}).get("value", [])
                
                if not result or result[0] is None:
                    return SwapStatus.SUBMITTED.value
                
                status = result[0]
                if status.get("err") is None:
                    # Check confirmations
                    confirmations = status.get("confirmations")
                    if confirmations is None or confirmations >= 32:
                        return SwapStatus.COMPLETED.value
                    return SwapStatus.SUBMITTED.value
                else:
                    return SwapStatus.FAILED.value
                    
        except Exception as e:
            logger.error(f"Solana tx check error: {e}")
        
        return None
    
    async def _notify_user(
        self,
        tx: SwapTransaction,
        old_status: str,
        new_status: str,
    ):
        """Notify user of status change."""
        if not self._bot:
            return
        
        try:
            from bot.models.user import User
            
            with get_db_session() as session:
                user = session.query(User).filter(User.id == tx.user_id).first()
                if not user:
                    return
                
                telegram_id = user.telegram_id
            
            if new_status == SwapStatus.COMPLETED.value:
                from bot.config.tokens import get_token_decimals
                from bot.utils.formatters import format_amount
                decimals = get_token_decimals(tx.from_token, tx.from_chain) or 18
                display_amount = format_amount(float(tx.from_amount) / (10 ** decimals)) if tx.from_amount else "?"
                text = (
                    f"✅ *Swap Completed!*\n\n"
                    f"Swapped {display_amount} {tx.from_token} → {tx.to_token}\n"
                    f"Chain: {tx.from_chain} → {tx.to_chain}\n\n"
                    f"[View Transaction]({self._get_explorer_link(tx)})"
                )
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                    [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                ])
                await self._bot.send_message(
                    chat_id=telegram_id,
                    text=text,
                    parse_mode="Markdown",
                    disable_web_page_preview=True,
                    reply_markup=keyboard,
                )
            elif new_status == SwapStatus.FAILED.value:
                text = (
                    f"❌ *Swap Failed*\n\n"
                    f"Your swap of {tx.from_token} → {tx.to_token} failed.\n"
                    f"Reason: {tx.error_message or 'Transaction reverted'}\n\n"
                    f"Your funds should remain in your wallet."
                )
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Retry Swap", callback_data="swap_start")],
                    [InlineKeyboardButton("📜 History", callback_data="history")],
                ])
                await self._bot.send_message(
                    chat_id=telegram_id,
                    text=text,
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                    disable_web_page_preview=True,
                )
            else:
                return  # Don't notify for other status changes
            
        except Exception as e:
            logger.error(f"Failed to notify user: {e}")
    
    async def _invalidate_balance_cache(self, tx: SwapTransaction):
        """Invalidate balance cache for the wallet that executed a swap."""
        try:
            from bot.utils.cache import balance_cache
            from bot.models.user import Wallet

            with get_db_session() as session:
                wallet = session.query(Wallet).filter(Wallet.user_id == tx.user_id, Wallet.is_active == True).first()
                if wallet:
                    await balance_cache.delete(f"bal:{wallet.address}:{wallet.chain_type}")
        except Exception as e:
            logger.debug(f"Failed to invalidate balance cache: {e}")

    def _get_explorer_link(self, tx: SwapTransaction) -> str:
        """Get block explorer link for transaction."""
        chain = get_chain_by_name(tx.from_chain)
        if chain and chain.explorer_url and tx.tx_hash:
            return f"{chain.explorer_url}/tx/{tx.tx_hash}"
        return "#"


# Global instance
tx_poller = TransactionPoller()

