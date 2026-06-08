"""Transaction status polling service."""

import asyncio
import logging
import time
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from bot.models.swap import SwapTransaction, SwapStatus
from bot.config.chains import get_chain_by_name, ChainType
from bot.utils.http_client import get_session
from database.db import get_session as get_db_session
from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
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
        from bot.utils.redis_cache import redis_cache
        while self._running:
            try:
                await self._check_pending_transactions()
                await redis_cache.set("service:tx_poller:heartbeat", time.time(), ttl_seconds=60)
            except Exception as e:
                logger.error(f"Transaction poll error: {e}")

            await asyncio.sleep(self._poll_interval)
    
    async def _check_pending_transactions(self):
        """Check all pending/submitted transactions using Phase 1/2/3 pattern.

        Phase 1: load rows to plain dicts and close the session immediately so
                 the connection is not held across async RPC calls.
        Phase 2: async RPC calls with no open DB session.
        Phase 3: write results back in short-lived per-row sessions.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self._max_age_hours)

        # Phase 1 — read to dicts, release connection
        with get_db_session() as session:
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
            tx_data = [
                {
                    'id': tx.id,
                    'tx_hash': tx.tx_hash,
                    'from_chain': tx.from_chain,
                    'to_chain': tx.to_chain,
                    'route_provider': getattr(tx, 'route_provider', None),
                    'status': tx.status,
                    'user_id': tx.user_id,
                    'from_token': tx.from_token,
                    'to_token': tx.to_token,
                    'from_amount': tx.from_amount,
                    'error_message': tx.error_message,
                }
                for tx in pending_txs
            ]

        # Phase 2 — async RPC calls, no session open
        updates = []
        for tx_dict in tx_data:
            try:
                new_status, dest_tx_hash = await self._check_tx_status_dict(tx_dict)
                if new_status and new_status != tx_dict['status']:
                    updates.append((tx_dict, new_status, dest_tx_hash))
            except Exception as e:
                logger.error(f"Error checking tx {tx_dict['id']}: {e}")

        # Phase 3 — write results back
        for tx_dict, new_status, dest_tx_hash in updates:
            old_status = tx_dict['status']
            try:
                with get_db_session() as session:
                    tx = session.query(SwapTransaction).filter(
                        SwapTransaction.id == tx_dict['id']
                    ).first()
                    if not tx:
                        continue
                    tx.status = new_status
                    if new_status == SwapStatus.COMPLETED.value:
                        tx.completed_at = datetime.now(timezone.utc)
                    if dest_tx_hash:
                        tx.destination_tx_hash = dest_tx_hash
                    session.commit()

                logger.info(f"Transaction {tx_dict['id']} status: {old_status} -> {new_status}")

                if new_status in (SwapStatus.COMPLETED.value, SwapStatus.FAILED.value):
                    await self._invalidate_balance_cache_dict(tx_dict)
                await self._notify_user_dict(tx_dict, old_status, new_status)
            except Exception as e:
                logger.error(f"Error writing tx {tx_dict['id']} result: {e}")
    
    async def _check_tx_status_dict(self, tx_dict: dict) -> tuple[Optional[str], Optional[str]]:
        """Check transaction status; return (new_status, dest_tx_hash)."""
        tx_hash = tx_dict.get('tx_hash')
        if not tx_hash:
            return None, None

        chain = get_chain_by_name(tx_dict['from_chain'])
        if not chain:
            return None, None

        if tx_dict.get('route_provider') == "lifi" and tx_dict['from_chain'] != tx_dict['to_chain']:
            return await self._check_lifi_status_dict(tx_dict)

        if chain.chain_type == ChainType.EVM:
            rpc_url = rpc_manager.get_rpc_url(chain.name)
            status = await self._check_evm_tx(tx_hash, rpc_url)
            return status, None
        elif chain.chain_type == ChainType.SOLANA:
            status = await self._check_solana_tx(tx_hash)
            return status, None

        return None, None

    async def _check_lifi_status_dict(self, tx_dict: dict) -> tuple[Optional[str], Optional[str]]:
        """Check cross-chain swap via Li.Fi; return (new_status, dest_tx_hash)."""
        try:
            status = await self._lifi.get_status(
                tx_hash=tx_dict['tx_hash'],
                from_chain=tx_dict['from_chain'],
                to_chain=tx_dict['to_chain'],
            )

            if status.status == "DONE":
                return SwapStatus.COMPLETED.value, status.receiving_tx_hash or None

            if status.status == "FAILED":
                return SwapStatus.FAILED.value, None

            return SwapStatus.CONFIRMING.value, None

        except Exception as e:
            logger.error(f"Li.Fi status check error: {e}")
            return None, None

    async def _check_tx_status(self, tx: SwapTransaction) -> Optional[str]:
        """Check transaction status on chain (legacy ORM-object interface)."""
        tx_dict = {
            'id': tx.id, 'tx_hash': tx.tx_hash, 'from_chain': tx.from_chain,
            'to_chain': tx.to_chain, 'route_provider': getattr(tx, 'route_provider', None),
        }
        status, _ = await self._check_tx_status_dict(tx_dict)
        return status
    
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
            
            async with http_session.post(rpc_manager.get_rpc_url("solana"), json=payload) as response:
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
    
    async def _notify_user_dict(self, tx_dict: dict, old_status: str, new_status: str):
        """Notify user of status change using a plain dict of tx data."""
        if not self._bot:
            return

        try:
            from bot.models.user import User

            with get_db_session() as session:
                user = session.query(User).filter(User.id == tx_dict['user_id']).first()
                if not user:
                    return
                telegram_id = user.telegram_id

            if new_status == SwapStatus.COMPLETED.value:
                from bot.config.tokens import get_token_decimals
                from bot.utils.formatters import format_amount
                decimals = get_token_decimals(tx_dict['from_token'], tx_dict['from_chain']) or 18
                raw_amount = tx_dict.get('from_amount')
                display_amount = format_amount(float(raw_amount) / (10 ** decimals)) if raw_amount else "?"
                explorer_link = self._get_explorer_link_dict(tx_dict)
                text = (
                    f"✅ *Swap Completed!*\n\n"
                    f"Swapped {display_amount} {tx_dict['from_token']} → {tx_dict['to_token']}\n"
                    f"Chain: {tx_dict['from_chain']} → {tx_dict['to_chain']}\n\n"
                    f"[View Transaction]({explorer_link})"
                )
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                    [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                ])
                await self._bot.send_message(
                    chat_id=telegram_id, text=text, parse_mode="Markdown",
                    disable_web_page_preview=True, reply_markup=keyboard,
                )
            elif new_status == SwapStatus.FAILED.value:
                text = (
                    f"❌ *Swap Failed*\n\n"
                    f"Your swap of {tx_dict['from_token']} → {tx_dict['to_token']} failed.\n"
                    f"Reason: {tx_dict.get('error_message') or 'Transaction reverted'}\n\n"
                    f"Your funds should remain in your wallet."
                )
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Retry Swap", callback_data="swap_start")],
                    [InlineKeyboardButton("📜 History", callback_data="history")],
                ])
                await self._bot.send_message(
                    chat_id=telegram_id, text=text, parse_mode="Markdown",
                    reply_markup=keyboard, disable_web_page_preview=True,
                )

        except Exception as e:
            logger.error(f"Failed to notify user: {e}")

    async def _notify_user(self, tx: SwapTransaction, old_status: str, new_status: str):
        """Legacy ORM-object interface — delegates to _notify_user_dict."""
        tx_dict = {
            'user_id': tx.user_id, 'from_token': tx.from_token, 'to_token': tx.to_token,
            'from_chain': tx.from_chain, 'to_chain': tx.to_chain,
            'from_amount': tx.from_amount, 'error_message': tx.error_message,
            'tx_hash': tx.tx_hash,
        }
        await self._notify_user_dict(tx_dict, old_status, new_status)

    async def _invalidate_balance_cache_dict(self, tx_dict: dict):
        """Invalidate balance cache for the wallet that executed a swap."""
        try:
            from bot.utils.cache import balance_cache
            from bot.models.user import Wallet

            with get_db_session() as session:
                wallet = session.query(Wallet).filter(
                    Wallet.user_id == tx_dict['user_id'],
                    Wallet.is_active == True,
                ).first()
                if wallet:
                    await balance_cache.delete(f"bal:{wallet.address}:{wallet.chain_type}")
        except Exception as e:
            logger.debug(f"Failed to invalidate balance cache: {e}")

    async def _invalidate_balance_cache(self, tx: SwapTransaction):
        """Legacy ORM-object interface — delegates to _invalidate_balance_cache_dict."""
        await self._invalidate_balance_cache_dict({'user_id': tx.user_id})

    def _get_explorer_link_dict(self, tx_dict: dict) -> str:
        """Get block explorer link from tx dict."""
        chain = get_chain_by_name(tx_dict.get('from_chain', ''))
        tx_hash = tx_dict.get('tx_hash')
        if chain and chain.explorer_url and tx_hash:
            return f"{chain.explorer_url}/tx/{tx_hash}"
        return "#"

    def _get_explorer_link(self, tx: SwapTransaction) -> str:
        """Get block explorer link for transaction."""
        chain = get_chain_by_name(tx.from_chain)
        if chain and chain.explorer_url and tx.tx_hash:
            return f"{chain.explorer_url}/tx/{tx.tx_hash}"
        return "#"


# Global instance
tx_poller = TransactionPoller()

