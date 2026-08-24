"""Transaction status polling service."""

import asyncio
import json
import logging
import time
from typing import Optional
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
from bot.services.legacy_swap_execution_adapter import project_legacy_swap
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
        """Stop the transaction polling service."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                logger.debug("Transaction poller task cancelled during stop()")
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

            # Shadow-project every currently pending legacy row before the RPC
            # phase so a worker restart reconstructs the canonical parent/child
            # identity even when the original submitter process died. A single
            # malformed historical row must not block status monitoring for all
            # other users, so isolate each projection in a savepoint. Final
            # status writes below are stricter: legacy + canonical truth commit
            # atomically or neither does.
            for tx in pending_txs:
                try:
                    with session.begin_nested():
                        project_legacy_swap(session, tx)
                except Exception as e:
                    logger.error(
                        "Canonical projection failed for pending swap %s: %s",
                        tx.id,
                        e,
                    )
            session.commit()

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
                    # The legacy status may already have been written by the
                    # websocket path or an older worker. Projection is
                    # idempotent, so use this race/restart path to repair any
                    # missing canonical state without duplicating user notices.
                    project_legacy_swap(session, tx)
                    session.commit()
                    return
                old_status = tx.status
                tx.status = new_status
                if new_status == SwapStatus.COMPLETED.value:
                    tx.completed_at = datetime.now(timezone.utc)
                    # Only write realized amounts when the provider actually
                    # reported one. Absent stays NULL, which downstream reads
                    # as "not observed" — writing 0 here would look like the
                    # user received nothing and would poison fill-vs-quote.
                    realized = tx_dict.get("_realized_to_amount")
                    if realized is not None:
                        tx.realized_to_amount = str(realized)[:78]
                        tx.realized_to_amount_usd = tx_dict.get("_realized_to_amount_usd")
                if dest_tx_hash:
                    tx.destination_tx_hash = dest_tx_hash
                if (
                    new_status == SwapStatus.FAILED.value
                    and tx_dict.get("error_message") == self.BRIDGE_UNSETTLED_TIMEOUT_REASON
                ):
                    # Set by _handle_zerox_status_unresolved / the
                    # bridge_pending wall-clock bound: a mined origin
                    # receipt with no bridge settlement, NOT a revert.
                    tx.error_message = self.BRIDGE_UNSETTLED_TIMEOUT_REASON

                # MONEY-PATH invariant: authoritative legacy status, realized
                # receive amount, canonical lifecycle event/fill, and outbox
                # must commit together. If projection fails, this session rolls
                # back the legacy terminal transition too and the poller retries
                # the same external identity on the next pass.
                project_legacy_swap(session, tx)
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

    # Side-channel keys a provider check may set on tx_dict for
    # _apply_status_update to persist, beyond the (status, dest_tx_hash) return
    # contract every provider shares. Declared here so the next provider author
    # extends this list rather than inventing a third convention:
    #   error_message           — distinct FAILED reason (bridge timeout vs revert)
    #   _realized_to_amount     — settled output amount, when the provider reports one
    #   _realized_to_amount_usd — its USD value at settlement
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
            # The "stay CONFIRMING on a mined origin receipt" refusal below
            # only applies to the 0x Cross-Chain provider (handled via its
            # own get_cross_chain_status path elsewhere, or its unresolved-
            # status fallback). This generic branch never sees provider ==
            # "0x_crosschain" (that's routed away above), so a mined receipt
            # here means a real same-provider completion -- restoring the
            # legacy pre-PR behavior for providers like "across" that have
            # no dedicated destination-fill check and would otherwise get
            # stuck in CONFIRMING forever (excluded from re-polling once
            # there, since the poller only re-queries CONFIRMING rows for
            # route_provider == "0x_crosschain").
            status = await self._check_evm_tx(
                tx_hash, rpc_url, provider=tx_dict.get("route_provider")
            )
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
                # Realized output — the amount that actually settled on the
                # destination chain, as reported once Li.Fi sees the receive
                # leg. Stashed on tx_dict rather than widened into the return
                # tuple because that (status, dest_hash) contract is shared by
                # every provider path; only Li.Fi reports a settled amount.
                # _apply_status_update persists it under the same lock that
                # writes the terminal status.
                realized_amount = getattr(status, "receiving_amount", None)
                if realized_amount is not None:
                    tx_dict["_realized_to_amount"] = realized_amount
                    tx_dict["_realized_to_amount_usd"] = getattr(
                        status, "receiving_amount_usd", None
                    )
                return SwapStatus.COMPLETED.value, status.receiving_tx_hash or None

            if status.status == "FAILED":
                return SwapStatus.FAILED.value, None

            return SwapStatus.CONFIRMING.value, None

        except Exception as e:
            logger.error(f"Li.Fi status check error: {e}")
            return None, None

    # A consecutive-poll counter is too aggressive and irreversible -- a
    # short 0x API blip could burn through it in minutes at the poller's
    # interval and permanently FAIL a swap that was actually fine. Instead,
    # only give up on a genuinely stuck 0x Cross-Chain swap once it has been
    # unresolved (no destination fill, no revert) for this long in wall-clock
    # time, bounded by the row's created_at.
    ZEROX_UNRESOLVED_FAIL_AFTER = timedelta(hours=2)

    # A provider-reported "bridge_pending" is real progress (origin mined,
    # bridge actively working), so it does NOT count against
    # ZEROX_UNRESOLVED_FAIL_AFTER above. But it must still have its own,
    # longer wall-clock ceiling -- otherwise a bridge that never settles
    # would leave the row CONFIRMING forever with no path to a terminal
    # state. Bridges can legitimately take longer than the 2h "unresolved
    # status" bound, so this is a separate, wider allowance.
    BRIDGE_PENDING_MAX_AGE = timedelta(hours=12)

    # Distinct error_message reason persisted on the row (and used to select
    # the notification copy) when a FAILED verdict comes from a wall-clock
    # timeout while the origin leg is known to have mined successfully --
    # i.e. the funds already left the wallet and are in the bridge, as
    # opposed to a genuine origin-tx revert where the funds never moved.
    BRIDGE_UNSETTLED_TIMEOUT_REASON = "bridge_unsettled_timeout"

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
                # reporting progress, so clear any recorded first-unknown
                # timestamp (only relevant as a fallback when created_at is
                # unavailable -- see _handle_zerox_status_unresolved).
                await self._reset_zerox_first_unknown_at(tx_dict, route_data)

                if provider_status == "bridge_pending":
                    # The origin leg is confirmed and the bridge is actively
                    # working, so this does NOT fall under
                    # ZEROX_UNRESOLVED_FAIL_AFTER -- but it still needs its
                    # own (wider) wall-clock ceiling so a bridge that never
                    # settles doesn't strand the row in CONFIRMING forever.
                    created_at = tx_dict.get("created_at")
                    if created_at is not None:
                        if created_at.tzinfo is None:
                            created_at = created_at.replace(tzinfo=timezone.utc)
                        elapsed = datetime.now(timezone.utc) - created_at
                        if elapsed >= self.BRIDGE_PENDING_MAX_AGE:
                            logger.warning(
                                f"0x Cross-Chain tx {tx_dict.get('id')} stuck in "
                                f"bridge_pending for {elapsed} (bound "
                                f"{self.BRIDGE_PENDING_MAX_AGE}); marking FAILED "
                                "as bridge-unsettled timeout."
                            )
                            tx_dict["error_message"] = self.BRIDGE_UNSETTLED_TIMEOUT_REASON
                            return SwapStatus.FAILED.value, None

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
        a definitive FAILED regardless of what the status API says. Otherwise
        this must NOT fail closed on a short run of unresolved polls -- a
        brief 0x API blip could burn through a consecutive-poll counter in
        minutes and irreversibly FAIL a swap that was actually fine. Instead,
        only mark FAILED once the row has been unresolved for longer than
        ZEROX_UNRESOLVED_FAIL_AFTER in wall-clock time, bounded by the row's
        created_at (or a first-unknown-at fallback if created_at is somehow
        unavailable).
        """
        chain = get_chain_by_name(tx_dict["from_chain"])
        # CONFIRMING here (not COMPLETED) is exactly the "origin mined but
        # this generic check has no destination visibility" case for
        # is_cross_chain providers (see _check_evm_tx) -- i.e. a real mined
        # (status 0x1) origin receipt. Track it so a later timeout FAILED
        # can be told apart from a genuine origin-tx revert.
        origin_receipt_mined = False
        receipt_read_definite = True
        if chain and chain.chain_type == ChainType.EVM:
            rpc_url = rpc_manager.get_rpc_url(chain.name)
            receipt_status = await self._check_evm_tx(
                tx_dict["tx_hash"], rpc_url, provider="0x_crosschain"
            )
            if receipt_status == SwapStatus.FAILED.value:
                return SwapStatus.FAILED.value, None
            origin_receipt_mined = receipt_status == SwapStatus.CONFIRMING.value
            # None means the RPC read itself failed -- we have no evidence
            # either way, and the timeout verdict below picks the user-facing
            # copy ("retry" vs "funds in transit") off this answer.
            receipt_read_definite = receipt_status is not None

        started_at = tx_dict.get("created_at")
        if started_at is not None:
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
        else:
            started_at = await self._get_or_set_zerox_first_unknown_at(tx_dict, route_data)

        if started_at is None:
            # No timing evidence at all -- stay CONFIRMING rather than
            # failing a swap we can't actually measure the age of.
            return SwapStatus.CONFIRMING.value, None

        elapsed = datetime.now(timezone.utc) - started_at
        if elapsed >= self.ZEROX_UNRESOLVED_FAIL_AFTER:
            if not receipt_read_definite:
                # The receipt read failed on the very poll that would go
                # terminal. A FAILED verdict here would carry the "retry"
                # copy even though the origin leg may have mined -- the
                # double-send this path exists to prevent. Wait for a poll
                # with a definite receipt answer.
                return SwapStatus.CONFIRMING.value, None
            logger.warning(
                f"0x Cross-Chain tx {tx_dict.get('id')} unresolved for {elapsed} "
                f"(bound {self.ZEROX_UNRESOLVED_FAIL_AFTER}); marking FAILED."
            )
            if origin_receipt_mined:
                # The user's funds already left the wallet and mined on the
                # origin chain -- this is NOT a revert. Flag it distinctly
                # so the notification tells the user their funds are in
                # transit with the bridge instead of implying the swap
                # never happened.
                tx_dict["error_message"] = self.BRIDGE_UNSETTLED_TIMEOUT_REASON
            return SwapStatus.FAILED.value, None
        return SwapStatus.CONFIRMING.value, None

    async def _get_or_set_zerox_first_unknown_at(
        self, tx_dict: dict, route_data: dict
    ) -> Optional[datetime]:
        """Read (or lazily persist) the first-unresolved timestamp.

        Only used as a fallback when the row's created_at is unavailable.
        """
        raw = route_data.get("zerox_first_unknown_at")
        if raw:
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                pass

        now = datetime.now(timezone.utc)
        try:
            with get_db_session() as session:
                tx = (
                    session.query(SwapTransaction)
                    .filter(SwapTransaction.id == tx_dict["id"])
                    .first()
                )
                if not tx:
                    return now
                try:
                    data = json.loads(tx.route_data or "{}")
                except (TypeError, ValueError, json.JSONDecodeError):
                    data = dict(route_data)
                if data.get("zerox_first_unknown_at"):
                    try:
                        return datetime.fromisoformat(data["zerox_first_unknown_at"])
                    except ValueError:
                        pass
                data["zerox_first_unknown_at"] = now.isoformat()
                tx.route_data = json.dumps(data)
                session.commit()
                return now
        except Exception as e:
            logger.error(f"Failed to persist 0x first-unknown-at fallback: {e}")
            return now

    async def _reset_zerox_first_unknown_at(self, tx_dict: dict, route_data: dict) -> None:
        """Clear the first-unknown-at fallback once the provider reports real progress again."""
        if not route_data.get("zerox_first_unknown_at"):
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
                if data.get("zerox_first_unknown_at"):
                    data.pop("zerox_first_unknown_at", None)
                    tx.route_data = json.dumps(data)
                    session.commit()
        except Exception as e:
            logger.error(f"Failed to reset 0x first-unknown-at fallback: {e}")

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

    # Providers with their own destination-fill status check (i.e. a mined
    # origin receipt is NOT proof the whole route is done). Only these
    # providers get the "stay CONFIRMING on 0x1" refusal below; every other
    # provider (including ones with no dedicated cross-chain status check,
    # e.g. "across") keeps the legacy behavior of completing on a mined
    # receipt, since there is no other path that will ever resolve them.
    _PROVIDERS_WITH_DEST_FILL_CHECK = frozenset({"0x_crosschain"})

    async def _check_evm_tx(
        self, tx_hash: str, rpc_url: str, provider: Optional[str] = None
    ) -> Optional[str]:
        """Check EVM transaction status.

        `provider` guards against treating a mined *origin* receipt as proof
        the whole route is done for providers that have their own
        destination-fill status check: those providers are only COMPLETED
        once that check confirms the fill, so this plain origin-receipt
        check must never itself resolve them to COMPLETED — only report
        them as still confirming (or FAILED if the origin leg itself
        reverted). Providers with no such check complete on a mined receipt
        as before.
        """
        is_cross_chain = provider in self._PROVIDERS_WITH_DEST_FILL_CHECK
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
                if tx_dict.get("error_message") == self.BRIDGE_UNSETTLED_TIMEOUT_REASON:
                    # The origin leg mined and the funds already left the
                    # wallet -- this is NOT a revert, so no Retry button
                    # (retrying would risk a double-send) and no "funds
                    # remain in your wallet" claim.
                    text = (
                        f"⚠️ *Swap Not Confirmed*\n\n"
                        f"Your swap of {tx_dict['from_token']} → {tx_dict['to_token']} "
                        f"could not be confirmed.\n\n"
                        f"The bridge has not yet confirmed settlement. "
                        f"Your funds are in transit with the bridge — do NOT retry "
                        f"this swap. Support has been flagged."
                    )
                    keyboard = InlineKeyboardMarkup(
                        [
                            [InlineKeyboardButton("📜 History", callback_data="history")],
                        ]
                    )
                else:
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
                        Wallet.is_active == True,  # noqa: E712
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
