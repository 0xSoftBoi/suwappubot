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
from database.db import run_in_db
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

# Bound on concurrently-live Solana websocket confirmation watchers. Entries
# already evict correctly via add_done_callback (see _maybe_start_ws_watcher)
# — this is not a leak fix, just a ceiling on peak concurrency. Past the cap,
# new watchers are skipped and the HTTP polling backstop (the designed
# fallback per _maybe_start_ws_watcher's docstring) picks up that tx instead.
MAX_WS_WATCHERS = 256


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

            # Separate pass, and separate try: the hashless rows are the ones
            # the main pass structurally cannot see (it filters on
            # tx_hash IS NOT NULL), and a failure resolving them must not stop
            # the ordinary polling above from reporting its heartbeat.
            try:
                await self._resolve_hashless_rows()
            except Exception as e:
                logger.error(f"Hashless swap resolution error: {e}")

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
                                # An UNKNOWN row with a hash is recoverable:
                                # swap_engine persists the hash when it loses
                                # the race between broadcasting and writing the
                                # result, so polling it resolves the swap to a
                                # real outcome instead of leaving it for a
                                # human. The tx_hash filter below keeps the
                                # hashless orphans out, since there is nothing
                                # to check for those.
                                SwapStatus.UNKNOWN.value,
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

    async def _resolve_hashless_rows(self) -> None:
        """Resolve swaps that have no tx_hash, from what was recorded before the send.

        These are the rows the main pass cannot touch. `_check_pending_transactions`
        filters on `tx_hash IS NOT NULL` because a hash is the only thing it
        can look a swap up by, so a row that lost its hash — the RPC call timed
        out, or the process died between `send_raw_transaction` and the hash
        write — was unresolvable from the database alone and sat UNKNOWN until
        a human read the chain. It also blocked `orders.resume_dca`, which
        refuses to advance while a tranche's swap is UNKNOWN.

        Two identities are recorded before every EVM broadcast, and this method
        tries them in order of how much they can prove.

        **`intended_tx_hash` first.** A transaction hash is keccak256 of the
        signed payload, so it is settled at signing — one step before the send
        that loses it — and it names exactly one transaction. One
        `eth_getTransactionReceipt` on it is therefore unambiguous, and this is
        the only path here that may conclude COMPLETED:

        - HASH_RESOLVED resolves the row to COMPLETED or FAILED from the
          receipt's own status. No explorer is involved and there is nothing to
          disambiguate: no other transaction, approval or nonce-reusing send
          could hash to this value.
        - HASH_UNMINED (no receipt) proves nothing by itself — the transaction
          may be in the mempool, or the broadcast may never have left — so it
          falls through to the nonce path, which is the half that can tell
          those apart.

        **`(sender_address, nonce)` second**, for rows written before
        `intended_tx_hash` existed (their hashes are not recoverable, which is
        why this path is kept rather than replaced) and to supply the negative
        proof the hash cannot. `swap_nonce.resolve_tx_by_sender_nonce`'s
        verdicts are deliberately asymmetric and this method preserves that
        exactly as it was — a nonce identifies a slot, not a transaction, so it
        still never concludes COMPLETED:

        - NOT_MINED is conclusive and the nonce was never spent, so the swap
          FAILED and no funds moved. This is the common case and the one worth
          having: it clears the row and unblocks the DCA schedule with no
          human and no explorer.
        - RESOLVED means a transaction was found AND verified over our own RPC
          as having this sender and this nonce. A REVERT resolves the row to
          FAILED. A SUCCESS does not resolve it to COMPLETED: a nonce cannot
          tell a swap's own transaction from the ERC20 approval most
          executors send first, so a successful receipt may belong to an
          approval whose swap never followed. The hash is recorded as an
          operator note and the row stays UNKNOWN.
        - CONSUMED_UNKNOWN means the nonce was spent but we cannot say on
          what. Left UNKNOWN on purpose — "something mined at that nonce" is
          not grounds to claim a swap succeeded, and a replacement or cancel
          at the same nonce looks identical from here.
        - PENDING_UNMINED means a transaction at that nonce is in the mempool,
          so the broadcast did happen and is simply waiting. Left alone.
        - INDETERMINATE means we could not reach the chain. Retried next pass.

        Only EVM rows are selected. Solana and Tron record neither identity —
        they have no account nonce, and their signatures are not derived the
        same way — so their rows carry nothing here and are excluded both by
        the query and by the EVM check in the loop.
        """
        from bot.services import swap_nonce

        cutoff = datetime.now(timezone.utc) - timedelta(hours=self._max_age_hours)

        # A swap records its nonce BEFORE it broadcasts, so for a short window
        # a perfectly healthy in-flight swap looks exactly like the thing this
        # method hunts: EXECUTING, no hash, nonce set. Resolving one of those
        # would read "nonce not yet consumed", call it NOT_MINED and mark a
        # swap FAILED while its broadcast was still on the wire — and FAILED
        # is what the engine's idempotency guard reads as "safe to retry".
        #
        # So ignore anything recent enough to still be executing. The rows
        # that matter here were stranded by a dead process or a timed-out RPC
        # and are not going to resolve themselves in the next few minutes.
        settle_after = datetime.now(timezone.utc) - timedelta(minutes=self.HASHLESS_MIN_AGE_MINUTES)

        with get_db_session() as session:
            rows = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.tx_hash.is_(None),
                    # Either identity qualifies a row. The nonce pair needs
                    # both halves to be usable at all, while a recorded hash
                    # stands alone — it is self-identifying, so a row carrying
                    # one is resolvable even if the nonce write did not land.
                    or_(
                        SwapTransaction.intended_tx_hash.isnot(None),
                        and_(
                            SwapTransaction.nonce.isnot(None),
                            SwapTransaction.sender_address.isnot(None),
                        ),
                    ),
                    SwapTransaction.status.in_(
                        [
                            SwapStatus.UNKNOWN.value,
                            SwapStatus.EXECUTING.value,
                        ]
                    ),
                    SwapTransaction.created_at >= cutoff,
                    SwapTransaction.created_at <= settle_after,
                )
                .limit(self.HASHLESS_RESOLVE_BATCH)
                .all()
            )
            candidates = [
                {
                    "id": r.id,
                    "user_id": r.user_id,
                    "status": r.status,
                    "from_chain": r.from_chain,
                    "to_chain": r.to_chain,
                    "from_token": r.from_token,
                    "to_token": r.to_token,
                    "route_provider": getattr(r, "route_provider", None),
                    "route_data": getattr(r, "route_data", None),
                    "from_amount": r.from_amount,
                    "error_message": r.error_message,
                    "created_at": r.created_at,
                    # Null by definition — these rows are selected BECAUSE
                    # they have no hash. Kept in the dict so the shape matches
                    # the main pass's, since both feed _apply_status_update.
                    "tx_hash": None,
                    "sender_address": r.sender_address,
                    "nonce": r.nonce,
                    "intended_tx_hash": r.intended_tx_hash,
                }
                for r in rows
            ]

        if not candidates:
            return

        logger.info(
            "Resolving %d hashless swap row(s) from pre-broadcast identity", len(candidates)
        )

        for tx_dict in candidates:
            chain = get_chain_by_name(tx_dict["from_chain"])
            if not chain or chain.chain_type != ChainType.EVM:
                continue

            # The recorded hash is tried first and is the only evidence here
            # strong enough to conclude COMPLETED. If it resolves, the row is
            # settled and the nonce path is not consulted at all.
            if tx_dict.get("intended_tx_hash") and await self._resolve_from_intended_hash(tx_dict):
                continue

            if tx_dict["nonce"] is None or not tx_dict["sender_address"]:
                # Selected on the hash alone, and the hash did not settle it.
                # There is no second identity to fall back to.
                continue

            try:
                result = await swap_nonce.resolve_tx_by_sender_nonce(
                    tx_dict["from_chain"], tx_dict["sender_address"], tx_dict["nonce"]
                )
            except Exception as e:
                logger.warning("Nonce resolution failed for swap %s: %s", tx_dict["id"], e)
                continue

            if result.verdict == swap_nonce.NOT_MINED:
                logger.info(
                    "Swap %s: nonce %s never consumed on %s (%s) — marking FAILED",
                    tx_dict["id"],
                    tx_dict["nonce"],
                    tx_dict["from_chain"],
                    result.detail,
                )
                tx_dict["error_message"] = self.NONCE_UNSPENT_REASON
                await self._apply_status_update(tx_dict, SwapStatus.FAILED.value)

            elif result.verdict == swap_nonce.RESOLVED:
                # A verified (sender, nonce) match is NOT by itself proof the
                # transaction is this swap's. If this swap's broadcast never
                # landed, the wallet's next send — very likely the user's next
                # swap — legitimately takes the same nonce, and that
                # transaction passes the sender and nonce checks identically.
                # Adopting it would mark this row COMPLETED on the strength of
                # a different swap's execution and duplicate its hash.
                #
                # So refuse any hash another row already owns. That is the
                # realistic shape of the collision: the send that reused the
                # nonce succeeded normally and recorded its own hash.
                if await self._hash_claimed_elsewhere(result.tx_hash, tx_dict["id"]):
                    logger.warning(
                        "Swap %s: nonce %s resolved to %s, but that hash belongs to "
                        "another swap — the nonce was almost certainly reused by a "
                        "later send, so leaving this row unresolved",
                        tx_dict["id"],
                        tx_dict["nonce"],
                        result.tx_hash,
                    )
                    continue

                # A nonce does not say WHICH of a swap's transactions it
                # belongs to. Most executors send an ERC20 approval first and
                # re-fetch the nonce for the swap itself, so the recorded
                # nonce is the approval's for as long as the swap tx has not
                # been built — and if the process dies in that window, the
                # approval is mined and successful while the swap never
                # happened at all. Concluding COMPLETED from that receipt
                # would tell the user a swap executed when only an allowance
                # was granted, and would release resume_dca on a tranche that
                # never traded.
                #
                # So success is never concluded here. A revert is, because it
                # is unambiguous: whichever of the two transactions occupied
                # the nonce, it reverted, so the swap did not complete.
                if result.status == SwapStatus.FAILED.value:
                    logger.info(
                        "Swap %s: the transaction at nonce %s reverted (%s) — marking FAILED",
                        tx_dict["id"],
                        tx_dict["nonce"],
                        result.tx_hash,
                    )
                    await self._adopt_resolved_hash(tx_dict["id"], result.tx_hash)
                    tx_dict["tx_hash"] = result.tx_hash
                    await self._apply_status_update(tx_dict, SwapStatus.FAILED.value)
                else:
                    # Left UNKNOWN deliberately. The hash is recorded on the
                    # row as an operator note rather than as tx_hash, because
                    # adopting it would hand the row to the ordinary polling
                    # pass, which reads a successful receipt as COMPLETED and
                    # would reintroduce exactly the false success this branch
                    # exists to avoid. What the operator needed — which
                    # transaction to go and look at — is now on the row
                    # instead of nowhere.
                    logger.warning(
                        "Swap %s: nonce %s was consumed by %s, which succeeded, but a "
                        "nonce cannot distinguish the swap from its approval — leaving "
                        "UNKNOWN for review rather than claiming COMPLETED",
                        tx_dict["id"],
                        tx_dict["nonce"],
                        result.tx_hash,
                    )
                    await self._note_resolution_evidence(tx_dict["id"], result.tx_hash)

            else:
                logger.info(
                    "Swap %s still unresolved by nonce %s: %s (%s)",
                    tx_dict["id"],
                    tx_dict["nonce"],
                    result.verdict,
                    result.detail,
                )

    async def _resolve_from_intended_hash(self, tx_dict: dict) -> bool:
        """Settle a hashless row from the hash recorded at signing.

        Returns True when the row no longer needs the nonce path — either
        because an outcome was applied, or because the hash was adopted and the
        ordinary polling pass now owns the row.

        This is the only place in this method that may conclude COMPLETED, and
        the reason is that a hash is proof of identity in a way a nonce is not:
        it is keccak256 of the signed payload, so a receipt returned for it is
        a receipt for the exact transaction this swap signed. An approval, a
        replacement, or a later send that recycled the nonce all hash
        elsewhere, so none of the confusions the nonce path has to guard
        against can arise here.

        Outcomes are still routed through the provider rules rather than read
        off the receipt directly:

        - A reverted origin transaction is FAILED for every provider. Nothing
          executed, so nothing bridged either.
        - A successful one is handed to `_check_tx_status_dict`, which already
          knows that a mined origin receipt completes a same-chain swap but
          does NOT complete a LiFi or 0x cross-chain route until the
          destination fill is confirmed. Concluding COMPLETED from the receipt
          here would tell a user their bridge landed when only the origin leg
          mined — the precise mistake `_PROVIDERS_WITH_DEST_FILL_CHECK` exists
          to prevent, and it is not re-litigated in this method.

        If that check has no verdict yet, the row keeps the adopted hash and is
        simply left: it is now selectable by the main pass (UNKNOWN and
        EXECUTING rows with a hash are both in its filter), so it resolves
        there on a later cycle with no further special-casing.
        """
        from bot.services import swap_nonce

        intended = tx_dict.get("intended_tx_hash")
        try:
            result = await swap_nonce.resolve_tx_by_intended_hash(
                tx_dict["from_chain"], intended, tx_dict.get("sender_address")
            )
        except Exception as e:
            logger.warning("Recorded-hash resolution failed for swap %s: %s", tx_dict["id"], e)
            return False

        if result.verdict != swap_nonce.HASH_RESOLVED:
            # HASH_UNMINED means no receipt, which is NOT evidence of failure:
            # the transaction may be in the mempool, or the broadcast may never
            # have left. Only the nonce path can tell those apart, so fall
            # through to it rather than concluding anything here.
            logger.info(
                "Swap %s not settled by its recorded hash %s: %s (%s)",
                tx_dict["id"],
                intended,
                result.verdict,
                result.detail,
            )
            return False

        # One on-chain transaction belongs to one swap. A duplicate here is far
        # less likely than on the nonce path — it needs a retry that rebuilt a
        # byte-identical payload, not merely a reused nonce — but if some other
        # row already owns this hash, two rows would be claiming one
        # transaction, so refuse rather than double-count it.
        if await self._hash_claimed_elsewhere(result.tx_hash, tx_dict["id"]):
            logger.warning(
                "Swap %s recorded hash %s, but another swap already owns that "
                "hash — refusing to claim one transaction for two swaps",
                tx_dict["id"],
                result.tx_hash,
            )
            return False

        await self._adopt_resolved_hash(tx_dict["id"], result.tx_hash)
        tx_dict["tx_hash"] = result.tx_hash

        if result.status == SwapStatus.FAILED.value:
            logger.info(
                "Swap %s: its recorded transaction %s reverted on %s — marking FAILED",
                tx_dict["id"],
                result.tx_hash,
                tx_dict["from_chain"],
            )
            await self._apply_status_update(tx_dict, SwapStatus.FAILED.value)
            return True

        new_status, dest_tx_hash = await self._check_tx_status_dict(tx_dict)
        if new_status:
            logger.info(
                "Swap %s resolved to %s from its recorded hash %s",
                tx_dict["id"],
                new_status,
                result.tx_hash,
            )
            await self._apply_status_update(tx_dict, new_status, dest_tx_hash)
        else:
            logger.info(
                "Swap %s: recorded transaction %s mined successfully; hash adopted and "
                "left to the ordinary polling pass (route not settled yet)",
                tx_dict["id"],
                result.tx_hash,
            )
        return True

    async def _adopt_resolved_hash(self, swap_id: int, tx_hash: str) -> None:
        """Write a nonce-resolved hash onto the row, if it still has none.

        Guarded on `tx_hash IS NULL` so this can never overwrite a hash the
        engine or another worker recorded in the meantime — that hash came
        from our own broadcast and outranks one reconstructed from an index.
        """

        def _work():
            with get_db_session() as session:
                db_tx = (
                    session.query(SwapTransaction)
                    .filter(
                        SwapTransaction.id == swap_id,
                        SwapTransaction.tx_hash.is_(None),
                    )
                    .first()
                )
                if db_tx:
                    db_tx.tx_hash = tx_hash
                    session.commit()

        try:
            await run_in_db(_work)
        except Exception as e:
            logger.warning("Could not adopt resolved hash for swap %s: %s", swap_id, e)

    async def _note_resolution_evidence(self, swap_id: int, tx_hash: str) -> None:
        """Record which transaction consumed the nonce, without claiming it.

        Writes to error_message, not tx_hash: the row stays UNKNOWN and out of
        the ordinary polling pass, but whoever reviews it no longer has to
        read the chain to find the candidate. Only ever written onto a row
        that is still UNKNOWN and still hashless, so this cannot overwrite a
        real outcome recorded in the meantime.
        """
        note = (
            f"Nonce consumed by {tx_hash}, which succeeded — but a nonce cannot "
            "distinguish this swap's transaction from its ERC20 approval, so the "
            "outcome is not asserted. Check that transaction to settle this row."
        )

        def _work():
            with get_db_session() as session:
                db_tx = (
                    session.query(SwapTransaction)
                    .filter(
                        SwapTransaction.id == swap_id,
                        SwapTransaction.tx_hash.is_(None),
                        SwapTransaction.status == SwapStatus.UNKNOWN.value,
                    )
                    .first()
                )
                if db_tx:
                    db_tx.error_message = note

        try:
            await run_in_db(_work)
        except Exception as e:
            logger.warning("Could not note resolution evidence for swap %s: %s", swap_id, e)

    async def _hash_claimed_elsewhere(self, tx_hash: str, swap_id: int) -> bool:
        """True if any OTHER swap row already carries `tx_hash`.

        The guard against nonce reuse. One on-chain transaction belongs to one
        swap; if a row already owns this hash, a nonce-based match to a second
        row means the nonce was recycled after the first row's broadcast was
        lost, not that both swaps executed.

        Fails CLOSED: an error here returns True and leaves the row
        unresolved, because the cost of a wrong False is a swap reported
        COMPLETED on another swap's transaction.

        Matched against BOTH spellings of the hash, which is load-bearing
        rather than defensive. The values compared here come from different
        producers and do not agree on the `0x` prefix: a resolved candidate is
        prefixed (Blockscout returns it that way, and `record_intended_hash`
        writes it that way because `eth_getTransactionReceipt` needs it), while
        the `tx_hash` column holds what an executor returned — and under the
        pinned hexbytes 1.3.1 `HexBytes.hex()` yields the digest with no
        prefix. A plain equality test therefore compares a prefixed string to
        a bare one and never matches, which would silently turn this guard into
        a no-op on exactly the money-path check it exists to perform.
        """
        from bot.services.swap_nonce import tx_hash_variants

        variants = tx_hash_variants(tx_hash)
        if not variants:
            # Not a hash we can look up. Fail closed, as above.
            return True

        def _work():
            with get_db_session() as session:
                return (
                    session.query(SwapTransaction.id)
                    .filter(
                        SwapTransaction.tx_hash.in_(variants),
                        SwapTransaction.id != swap_id,
                    )
                    .first()
                    is not None
                )

        try:
            return await run_in_db(_work)
        except Exception as e:
            logger.warning(
                "Could not check hash ownership for swap %s (treating as claimed): %s",
                swap_id,
                e,
            )
            return True

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
                if (
                    tx.status == SwapStatus.UNKNOWN.value
                    and new_status == SwapStatus.SUBMITTED.value
                ):
                    # Keep polling, but do not write. SUBMITTED is what the
                    # receipt check reports while a transaction has not mined
                    # yet, so this is not news — and it is a backwards step out
                    # of UNKNOWN that the canonical projection refuses
                    # (RECONCILING has no path to ACTIVE), which would roll the
                    # status write back with it on every single cycle. Holding
                    # UNKNOWN also keeps the "needs verification" marker the
                    # user sees instead of downgrading it to a plain pending.
                    return
                if (
                    tx.status == new_status
                    or tx.status
                    in (
                        SwapStatus.COMPLETED.value,
                        SwapStatus.FAILED.value,
                    )
                    # UNKNOWN is settled only while there is genuinely nothing
                    # to check. A swap that broadcast and then failed to
                    # persist its status still has its hash (swap_engine
                    # records it on the error path), and that row MUST stay
                    # pollable so it resolves itself instead of waiting on a
                    # human. Without the tx_hash condition this branch would
                    # strand it.
                    #
                    # The nonce condition is the same argument for the rows
                    # that have no hash at all: a recorded (sender, nonce) is
                    # a second way to ask the chain what happened, so such a
                    # row is NOT settled either, and _resolve_hashless_rows
                    # exists to move it. Treating it as settled here would
                    # reject that pass's own writes and leave the row exactly
                    # as stuck as before.
                    or (
                        tx.status == SwapStatus.UNKNOWN.value
                        and tx.tx_hash is None
                        and tx.nonce is None
                    )
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
                    and tx_dict.get("error_message") == self.NONCE_UNSPENT_REASON
                ):
                    # Set by _resolve_hashless_rows: the sending wallet's nonce
                    # was proven never consumed, so the swap definitively did
                    # not execute. Worth persisting verbatim — "no funds moved"
                    # is the single thing a user or an operator looking at this
                    # row needs to know, and it is not inferable from FAILED.
                    tx.error_message = self.NONCE_UNSPENT_REASON
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

            if new_status in (
                SwapStatus.COMPLETED.value,
                SwapStatus.FAILED.value,
            ):
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
            if len(self._ws_watchers) >= MAX_WS_WATCHERS:
                logger.debug(
                    "ws watcher cap (%s) reached, tx %s falls back to polling",
                    MAX_WS_WATCHERS,
                    tx_id,
                )
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

    # Written on rows whose broadcast outcome was never observed and whose
    # sending nonce is proven never to have been consumed. The exact opposite
    # of the reason above: there, the funds are in the bridge; here, they never
    # left the wallet. See _resolve_hashless_rows.
    NONCE_UNSPENT_REASON = (
        "Broadcast outcome was never observed, and the sending wallet's nonce was "
        "never used on-chain — this swap did not execute and no funds moved."
    )

    # Ceiling on hashless rows resolved per pass. Each one costs an
    # eth_getTransactionCount and possibly an explorer crawl, so a backlog
    # drains over several passes rather than stalling the poll loop.
    HASHLESS_RESOLVE_BATCH = 25

    # How old a hashless row must be before this pass will touch it. Covers
    # the window in which a healthy swap has recorded its nonce but not yet
    # returned a hash, so an in-flight broadcast is never mistaken for a
    # stranded one. Generous on purpose: these rows have waited for a human
    # until now, so minutes cost nothing, and a wrong FAILED costs a retry of
    # a swap that already executed.
    HASHLESS_MIN_AGE_MINUTES = 15

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
            urls = settings.starknet_rpc_urls()
            if not urls:
                logger.warning("No Starknet RPC configured; cannot check tx %s", tx_hash[:12])
                return None
            rpc_url = urls[0]

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
