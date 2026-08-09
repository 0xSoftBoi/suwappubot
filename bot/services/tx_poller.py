"""Transaction status polling service."""

import asyncio
import json
import logging
import time
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import and_, or_

from bot.models.swap import SwapTransaction, SwapStatus
from bot.config.chains import get_chain_by_name, ChainType
from bot.utils.http_client import get_session
from database.db import get_session as get_db_session
from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.services.lifi_api import LiFiAPI
from bot.services.zerox_api import ZeroXAPI, ZEROX_CHAIN_IDS
from bot.utils import ws_confirm

logger = logging.getLogger(__name__)

# Solana websocket subscription timeout (seconds) before falling back to polling
SOLANA_WS_TIMEOUT = 90.0
# When recently-submitted txs are pending, poll faster for snappier feedback
FAST_POLL_INTERVAL = 3
FAST_POLL_AGE_SECONDS = 30


class TransactionPoller:
    """Background service to poll and update transaction statuses."""

    def __init__(self, poll_interval: int = 15, max_age_hours: int = 24):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._poll_interval = poll_interval  # seconds
        self._max_age_hours = max_age_hours
        self._bot = None
        self._lifi = LiFiAPI()
        self._zerox = ZeroXAPI()
        # Active Solana websocket watchers keyed by tx id (avoid duplicate subscriptions)
        self._ws_watchers: dict[int, asyncio.Task] = {}
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
        for watcher in list(self._ws_watchers.values()):
            watcher.cancel()
        self._ws_watchers.clear()
        logger.info("Transaction poller stopped")

    async def _poll_loop(self):
        """Main polling loop."""
        from bot.utils.redis_cache import redis_cache

        while self._running:
            has_recent_pending = False
            try:
                has_recent_pending = await self._check_pending_transactions()
                await redis_cache.set("service:tx_poller:heartbeat", time.time(), ttl_seconds=90)
            except Exception as e:
                logger.error(f"Transaction poll error: {e}")

            # Adaptive interval: poll faster while freshly-submitted txs are pending
            interval = (
                min(FAST_POLL_INTERVAL, self._poll_interval)
                if has_recent_pending
                else self._poll_interval
            )
            await asyncio.sleep(interval)

    async def _check_pending_transactions(self) -> bool:
        """Check all pending/submitted transactions using Phase 1/2/3 pattern.

        Phase 1: load rows to plain dicts and close the session immediately so
                 the connection is not held across async RPC calls.
        Phase 2: async RPC calls with no open DB session.
        Phase 3: write results back in short-lived per-row sessions.

        Returns True if any pending tx was created recently (fast-poll hint).
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self._max_age_hours)

        # Phase 1 — read to dicts, release connection
        with get_db_session() as session:
            pending_txs = (
                session.query(SwapTransaction)
                .filter(
                    or_(
                        SwapTransaction.status.in_(
                            [
                                SwapStatus.SUBMITTED.value,
                                SwapStatus.EXECUTING.value,
                                SwapStatus.PENDING.value,
                            ]
                        ),
                        # CONFIRMING only has a real cross-chain status check
                        # for the 0x Cross-Chain provider (destination fill
                        # tracking via get_cross_chain_status). Any other
                        # provider in CONFIRMING would fall through to the
                        # plain EVM origin-receipt check below and get
                        # falsely marked COMPLETED the moment the origin leg
                        # mines, before the bridge has actually settled.
                        and_(
                            SwapTransaction.status == SwapStatus.CONFIRMING.value,
                            SwapTransaction.route_provider == "0x_crosschain",
                        ),
                    ),
                    SwapTransaction.created_at >= cutoff,
                    SwapTransaction.tx_hash.isnot(None),
                )
                .all()
            )

            if not pending_txs:
                return False

            logger.info(f"Checking {len(pending_txs)} pending transactions")
            tx_data = [
                {
                    "id": tx.id,
                    "tx_hash": tx.tx_hash,
                    "from_chain": tx.from_chain,
                    "to_chain": tx.to_chain,
                    "route_provider": getattr(tx, "route_provider", None),
                    "route_data": getattr(tx, "route_data", None),
                    "status": tx.status,
                    "user_id": tx.user_id,
                    "from_token": tx.from_token,
                    "to_token": tx.to_token,
                    "from_amount": tx.from_amount,
                    "error_message": tx.error_message,
                    "created_at": tx.created_at,
                }
                for tx in pending_txs
            ]

        # Spawn websocket watchers for pending Solana txs (instant confirmation path)
        for tx_dict in tx_data:
            self._maybe_start_ws_watcher(tx_dict)

        # Phase 2 — async RPC calls, no session open
        updates = []
        for tx_dict in tx_data:
            try:
                new_status, dest_tx_hash = await self._check_tx_status_dict(tx_dict)
                if new_status and new_status != tx_dict["status"]:
                    updates.append((tx_dict, new_status, dest_tx_hash))
            except Exception as e:
                logger.error(f"Error checking tx {tx_dict['id']}: {e}")

        # Phase 3 — write results back
        for tx_dict, new_status, dest_tx_hash in updates:
            await self._apply_status_update(tx_dict, new_status, dest_tx_hash)

        # Fast-poll hint: any pending tx submitted within the last FAST_POLL_AGE_SECONDS
        now = datetime.now(timezone.utc)
        for tx_dict in tx_data:
            created_at = tx_dict.get("created_at")
            if created_at is None:
                continue
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            if (now - created_at).total_seconds() <= FAST_POLL_AGE_SECONDS:
                return True
        return False

    async def _apply_status_update(
        self, tx_dict: dict, new_status: str, dest_tx_hash: Optional[str] = None
    ):
        """Persist a status change and notify the user (idempotent).

        Shared by the polling loop and the websocket confirmation path. Re-reads
        the current DB status so a tx already moved to a terminal state (e.g. by
        the ws watcher racing the poller) is not double-updated or double-notified.
        """
        old_status = tx_dict["status"]
        try:
            with get_db_session() as session:
                tx = (
                    session.query(SwapTransaction)
                    .filter(SwapTransaction.id == tx_dict["id"])
                    .first()
                )
                if not tx:
                    return
                if tx.status == new_status or tx.status in (
                    SwapStatus.COMPLETED.value,
                    SwapStatus.FAILED.value,
                ):
                    # Already applied (or terminal) — skip to avoid duplicate notifications
                    return
                old_status = tx.status
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

    def _maybe_start_ws_watcher(self, tx_dict: dict):
        """Start a websocket confirmation watcher for a pending Solana tx.

        Best-effort only — any failure is logged and the polling backstop
        continues to handle the transaction as before.
        """
        try:
            tx_id = tx_dict["id"]
            if tx_id in self._ws_watchers:
                return
            if tx_dict["from_chain"] != tx_dict["to_chain"]:
                return  # cross-chain handled by Li.Fi status polling
            chain = get_chain_by_name(tx_dict["from_chain"])
            if not chain or chain.chain_type != ChainType.SOLANA:
                return

            ws_url = ws_confirm.derive_ws_url(rpc_manager.get_rpc_url("solana"))
            if not ws_url:
                return

            task = asyncio.create_task(self._ws_watch_solana(tx_dict, ws_url))
            self._ws_watchers[tx_id] = task
            task.add_done_callback(lambda _t, _id=tx_id: self._ws_watchers.pop(_id, None))
        except Exception as e:
            logger.warning(f"Failed to start ws watcher for tx {tx_dict.get('id')}: {e}")

    async def _ws_watch_solana(self, tx_dict: dict, ws_url: str):
        """Wait for a Solana signature over websocket and apply the result.

        On timeout or any ws failure this does nothing — the HTTP polling loop
        remains the backstop.
        """
        try:
            result = await ws_confirm.ws_wait_for_signature(
                ws_url, tx_dict["tx_hash"], timeout=SOLANA_WS_TIMEOUT
            )
            if result == ws_confirm.CONFIRMED:
                await self._apply_status_update(tx_dict, SwapStatus.COMPLETED.value)
            elif result == ws_confirm.FAILED:
                await self._apply_status_update(tx_dict, SwapStatus.FAILED.value)
            # timeout -> fall through to polling backstop
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"ws watcher error for tx {tx_dict.get('id')}: {e}")

    async def _check_tx_status_dict(self, tx_dict: dict) -> tuple[Optional[str], Optional[str]]:
        """Check transaction status; return (new_status, dest_tx_hash)."""
        tx_hash = tx_dict.get("tx_hash")
        if not tx_hash:
            return None, None

        chain = get_chain_by_name(tx_dict["from_chain"])
        if not chain:
            return None, None

        if tx_dict.get("route_provider") == "lifi" and tx_dict["from_chain"] != tx_dict["to_chain"]:
            return await self._check_lifi_status_dict(tx_dict)

        if tx_dict.get("route_provider") == "0x_crosschain":
            return await self._check_zerox_crosschain_status_dict(tx_dict)

        if chain.chain_type == ChainType.EVM:
            rpc_url = rpc_manager.get_rpc_url(chain.name)
            is_cross_chain = tx_dict["from_chain"] != tx_dict["to_chain"]
            status = await self._check_evm_tx(tx_hash, rpc_url, is_cross_chain=is_cross_chain)
            return status, None
        elif chain.chain_type == ChainType.SOLANA:
            status = await self._check_solana_tx(tx_hash)
            return status, None
        elif chain.chain_type == ChainType.STARKNET:
            status = await self._check_starknet_tx(tx_hash)
            return status, None

        return None, None

    async def _check_lifi_status_dict(self, tx_dict: dict) -> tuple[Optional[str], Optional[str]]:
        """Check cross-chain swap via Li.Fi; return (new_status, dest_tx_hash)."""
        try:
            status = await asyncio.wait_for(
                self._lifi.get_status(
                    tx_hash=tx_dict["tx_hash"],
                    from_chain=tx_dict["from_chain"],
                    to_chain=tx_dict["to_chain"],
                ),
                timeout=10,
            )

            if status.status == "DONE":
                return SwapStatus.COMPLETED.value, status.receiving_tx_hash or None

            if status.status == "FAILED":
                return SwapStatus.FAILED.value, None

            return SwapStatus.CONFIRMING.value, None

        except Exception as e:
            logger.error(f"Li.Fi status check error: {e}")
            return None, None

    # After this many consecutive polls where the 0x status API errors or
    # returns an unrecognized status, give up and mark the swap FAILED
    # rather than polling CONFIRMING forever with no path to resolution.
    ZEROX_MAX_CONSECUTIVE_UNKNOWN = 20

    async def _check_zerox_crosschain_status_dict(
        self, tx_dict: dict
    ) -> tuple[Optional[str], Optional[str]]:
        """Check 0x Cross-Chain through destination fill, not just origin mining."""
        origin_chain_id = ZEROX_CHAIN_IDS.get(tx_dict["from_chain"].lower())
        destination = get_chain_by_name(tx_dict["to_chain"])
        if not origin_chain_id or not destination:
            return None, None

        try:
            route_data = json.loads(tx_dict.get("route_data") or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            route_data = {}

        try:
            result = await asyncio.wait_for(
                self._zerox.get_cross_chain_status(
                    origin_chain_id=origin_chain_id,
                    origin_tx_hash=tx_dict["tx_hash"],
                    quote_id=route_data.get("quote_id"),
                ),
                timeout=10,
            )
            provider_status = result.get("status")

            if provider_status == "bridge_filled":
                destination_hash = None
                for transaction in result.get("transactions") or []:
                    try:
                        chain_id = int(transaction.get("chainId"))
                    except (TypeError, ValueError):
                        continue
                    if chain_id == destination.chain_id and transaction.get("txHash"):
                        destination_hash = transaction["txHash"]
                return SwapStatus.COMPLETED.value, destination_hash

            if provider_status in ("origin_tx_reverted", "bridge_failed"):
                return SwapStatus.FAILED.value, None

            if provider_status in ("origin_tx_pending", "origin_tx_confirmed", "bridge_pending"):
                # Known non-terminal states: the provider is actively
                # reporting progress, so reset the unknown-response counter.
                await self._reset_zerox_unknown_count(tx_dict, route_data)
                return SwapStatus.CONFIRMING.value, None

            # provider_status missing or not one of the recognized values
            # ("unknown" or anything new the API starts returning) — treat
            # the same as a hard error below rather than trusting a status
            # string we don't understand to mean "still going".
            return await self._handle_zerox_status_unresolved(tx_dict, route_data)
        except Exception as e:
            # A bare "keep CONFIRMING forever" here would let a persistent
            # 0x API outage silently strand a swap in limbo indefinitely,
            # with no way for the poller (or the user) to ever learn it
            # actually failed on-chain. Fall back to checking the origin
            # receipt directly, and eventually fail closed.
            logger.error(f"0x Cross-Chain status check error: {e}")
            return await self._handle_zerox_status_unresolved(tx_dict, route_data)

    async def _handle_zerox_status_unresolved(
        self, tx_dict: dict, route_data: dict
    ) -> tuple[Optional[str], Optional[str]]:
        """0x's status API errored or returned an unrecognized status.

        Falls back to an origin-chain receipt check: a reverted origin tx is
        a definitive FAILED regardless of what the status API says. If the
        origin tx is fine (or not yet mined), count the consecutive
        unresolved polls in route_data and fail the swap after too many in a
        row instead of polling CONFIRMING forever.
        """
        chain = get_chain_by_name(tx_dict["from_chain"])
        if chain and chain.chain_type == ChainType.EVM:
            rpc_url = rpc_manager.get_rpc_url(chain.name)
            receipt_status = await self._check_evm_tx(
                tx_dict["tx_hash"], rpc_url, is_cross_chain=True
            )
            if receipt_status == SwapStatus.FAILED.value:
                return SwapStatus.FAILED.value, None

        count = await self._bump_zerox_unknown_count(tx_dict, route_data)
        if count >= self.ZEROX_MAX_CONSECUTIVE_UNKNOWN:
            logger.warning(
                f"0x Cross-Chain tx {tx_dict.get('id')} exceeded "
                f"{self.ZEROX_MAX_CONSECUTIVE_UNKNOWN} consecutive unresolved status "
                "checks; marking FAILED."
            )
            return SwapStatus.FAILED.value, None
        return SwapStatus.CONFIRMING.value, None

    async def _bump_zerox_unknown_count(self, tx_dict: dict, route_data: dict) -> int:
        """Increment and persist the consecutive-unresolved-status counter."""
        try:
            with get_db_session() as session:
                tx = (
                    session.query(SwapTransaction)
                    .filter(SwapTransaction.id == tx_dict["id"])
                    .first()
                )
                if not tx:
                    return 0
                try:
                    data = json.loads(tx.route_data or "{}")
                except (TypeError, ValueError, json.JSONDecodeError):
                    data = dict(route_data)
                count = int(data.get("zerox_unknown_count", 0)) + 1
                data["zerox_unknown_count"] = count
                tx.route_data = json.dumps(data)
                session.commit()
                return count
        except Exception as e:
            logger.error(f"Failed to persist 0x unresolved-status counter: {e}")
            return 0

    async def _reset_zerox_unknown_count(self, tx_dict: dict, route_data: dict) -> None:
        """Clear the counter once the provider reports real progress again."""
        if not route_data.get("zerox_unknown_count"):
            return
        try:
            with get_db_session() as session:
                tx = (
                    session.query(SwapTransaction)
                    .filter(SwapTransaction.id == tx_dict["id"])
                    .first()
                )
                if not tx:
                    return
                try:
                    data = json.loads(tx.route_data or "{}")
                except (TypeError, ValueError, json.JSONDecodeError):
                    data = dict(route_data)
                if data.get("zerox_unknown_count"):
                    data["zerox_unknown_count"] = 0
                    tx.route_data = json.dumps(data)
                    session.commit()
        except Exception as e:
            logger.error(f"Failed to reset 0x unresolved-status counter: {e}")

    async def _check_tx_status(self, tx: SwapTransaction) -> Optional[str]:
        """Check transaction status on chain (legacy ORM-object interface)."""
        tx_dict = {
            "id": tx.id,
            "tx_hash": tx.tx_hash,
            "from_chain": tx.from_chain,
            "to_chain": tx.to_chain,
            "route_provider": getattr(tx, "route_provider", None),
            "route_data": getattr(tx, "route_data", None),
        }
        status, _ = await self._check_tx_status_dict(tx_dict)
        return status

    async def _check_evm_tx(
        self, tx_hash: str, rpc_url: str, is_cross_chain: bool = False
    ) -> Optional[str]:
        """Check EVM transaction status.

        `is_cross_chain` guards against treating a mined *origin* receipt as
        proof the whole route is done: a cross-chain swap is only COMPLETED
        once the destination-chain provider confirms the fill, so this plain
        origin-receipt check must never itself resolve to COMPLETED for a
        cross-chain route — only report it as still confirming (or FAILED if
        the origin leg itself reverted).
        """
        try:
            http_session = await get_session()

            payload = {
                "jsonrpc": "2.0",
                "method": "eth_getTransactionReceipt",
                "params": [tx_hash],
                "id": 1,
            }

            async def _do_evm():
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
                        if is_cross_chain:
                            # Origin leg mined but this generic check has no
                            # visibility into destination settlement — stay
                            # non-terminal rather than falsely completing.
                            return SwapStatus.CONFIRMING.value
                        return SwapStatus.COMPLETED.value
                    elif status == "0x0":
                        return SwapStatus.FAILED.value
                    return None

            return await asyncio.wait_for(_do_evm(), timeout=10)

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

            async def _do_solana():
                async with http_session.post(
                    rpc_manager.get_rpc_url("solana"), json=payload
                ) as response:
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

            return await asyncio.wait_for(_do_solana(), timeout=10)

        except Exception as e:
            logger.error(f"Solana tx check error: {e}")

        return None

    async def _check_starknet_tx(self, tx_hash: str) -> Optional[str]:
        """Check Starknet transaction status via starknet_getTransactionStatus.

        finality_status ACCEPTED_ON_L2/ACCEPTED_ON_L1 with execution_status
        SUCCEEDED → completed; execution_status REVERTED → failed; anything
        else (RECEIVED, pending, RPC hiccup) stays submitted/unknown.
        """
        try:
            http_session = await get_session()

            payload = {
                "jsonrpc": "2.0",
                "method": "starknet_getTransactionStatus",
                "params": [tx_hash],
                "id": 1,
            }
            rpc_url = settings.starknet_rpc_url or settings.starknet_rpc_fallback_url

            async def _do_starknet():
                async with http_session.post(rpc_url, json=payload) as response:
                    if response.status != 200:
                        return None
                    data = await response.json()
                    if "error" in data:
                        # Only TXN_HASH_NOT_FOUND (spec code 29) means "not yet
                        # in the mempool/blocks" → still submitted. Any other
                        # RPC error is indeterminate → None (re-check later).
                        err = data.get("error") or {}
                        if isinstance(err, dict) and err.get("code") == 29:
                            return SwapStatus.SUBMITTED.value
                        return None
                    result = data.get("result") or {}
                    finality = result.get("finality_status")
                    execution = result.get("execution_status")

                    if execution == "REVERTED":
                        return SwapStatus.FAILED.value
                    if (
                        finality in ("ACCEPTED_ON_L2", "ACCEPTED_ON_L1")
                        and execution == "SUCCEEDED"
                    ):
                        return SwapStatus.COMPLETED.value
                    return SwapStatus.SUBMITTED.value

            return await asyncio.wait_for(_do_starknet(), timeout=10)

        except Exception as e:
            logger.error(f"Starknet tx check error: {e}")

        return None

    async def _notify_user_dict(self, tx_dict: dict, old_status: str, new_status: str):
        """Notify user of status change using a plain dict of tx data."""
        if not self._bot:
            return

        try:
            from bot.models.user import User

            with get_db_session() as session:
                user = session.query(User).filter(User.id == tx_dict["user_id"]).first()
                if not user:
                    return
                telegram_id = user.telegram_id

            if new_status == SwapStatus.COMPLETED.value:
                from bot.config.tokens import get_token_decimals
                from bot.utils.formatters import format_amount

                decimals = get_token_decimals(tx_dict["from_token"], tx_dict["from_chain"]) or 18
                raw_amount = tx_dict.get("from_amount")
                display_amount = (
                    format_amount(float(raw_amount) / (10**decimals)) if raw_amount else "?"
                )
                explorer_link = self._get_explorer_link_dict(tx_dict)
                text = (
                    f"✅ *Swap Completed!*\n\n"
                    f"Swapped {display_amount} {tx_dict['from_token']} → {tx_dict['to_token']}\n"
                    f"Chain: {tx_dict['from_chain']} → {tx_dict['to_chain']}\n\n"
                    f"[View Transaction]({explorer_link})"
                )
                keyboard = InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("🔄 New Swap", callback_data="swap_start")],
                        [InlineKeyboardButton("« Main Menu", callback_data="main_menu")],
                    ]
                )
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
                    f"Your swap of {tx_dict['from_token']} → {tx_dict['to_token']} failed.\n"
                    f"Reason: {tx_dict.get('error_message') or 'Transaction reverted'}\n\n"
                    f"Your funds should remain in your wallet."
                )
                keyboard = InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("🔄 Retry Swap", callback_data="swap_start")],
                        [InlineKeyboardButton("📜 History", callback_data="history")],
                    ]
                )
                await self._bot.send_message(
                    chat_id=telegram_id,
                    text=text,
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                    disable_web_page_preview=True,
                )

        except Exception as e:
            logger.error(f"Failed to notify user: {e}")

    async def _notify_user(self, tx: SwapTransaction, old_status: str, new_status: str):
        """Legacy ORM-object interface — delegates to _notify_user_dict."""
        tx_dict = {
            "user_id": tx.user_id,
            "from_token": tx.from_token,
            "to_token": tx.to_token,
            "from_chain": tx.from_chain,
            "to_chain": tx.to_chain,
            "from_amount": tx.from_amount,
            "error_message": tx.error_message,
            "tx_hash": tx.tx_hash,
        }
        await self._notify_user_dict(tx_dict, old_status, new_status)

    async def _invalidate_balance_cache_dict(self, tx_dict: dict):
        """Invalidate balance cache for the wallet that executed a swap."""
        try:
            from bot.utils.cache import balance_cache
            from bot.models.user import Wallet

            with get_db_session() as session:
                wallet = (
                    session.query(Wallet)
                    .filter(
                        Wallet.user_id == tx_dict["user_id"],
                        Wallet.is_active == True,
                    )
                    .first()
                )
                if wallet:
                    await balance_cache.delete(f"bal:{wallet.address}:{wallet.chain_type}")
        except Exception as e:
            logger.debug(f"Failed to invalidate balance cache: {e}")

    async def _invalidate_balance_cache(self, tx: SwapTransaction):
        """Legacy ORM-object interface — delegates to _invalidate_balance_cache_dict."""
        await self._invalidate_balance_cache_dict({"user_id": tx.user_id})

    def _get_explorer_link_dict(self, tx_dict: dict) -> str:
        """Get block explorer link from tx dict."""
        chain = get_chain_by_name(tx_dict.get("from_chain", ""))
        tx_hash = tx_dict.get("tx_hash")
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
