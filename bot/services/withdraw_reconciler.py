"""Reconciles PENDING custodial withdrawal placeholders.

reserve_custodial_balance debits the ledger BEFORE the on-chain send is
attempted, and send_token/send_native_token's broadcast call can fail
ambiguously (PostBroadcastAmbiguous — see bot/services/hot_wallet.py) without
telling us whether the transfer actually landed. On top of that, the process
itself can crash between the reserve committing and the send/refund running.
Both cases leave a CustodialTransaction row in status=PENDING with the ledger
already debited and no way to know, from the request path alone, whether the
user should get their balance back.

This background service periodically scans those PENDING withdrawal rows and
resolves each one against real chain state:

  - No tx_hash was ever recorded and the row is older than
    ``never_broadcast_after_minutes`` -> the send call never even reached a
    broadcast attempt (or a PostBroadcastAmbiguous crash happened before a
    hash could be captured upstream — we treat "old enough + genuinely no
    hash" as never-broadcast; see caveat in _resolve_one). Refund + mark
    FAILED.
  - A tx_hash was recorded -> look up the real transaction on-chain.
      * Confirmed/mined -> mark COMPLETED. Never refund.
      * Definitively failed/reverted on-chain -> refund + mark FAILED (no
        value moved, so this is safe).
      * Not found yet / RPC error / unknown -> leave PENDING; try again next
        cycle. We never refund a row with an unresolved tx_hash purely due to
        age, because doing so risks a double-spend if the tx later confirms.

This mirrors the fee_sweeper / tx_poller background-task pattern already used
in api/main.py's lifespan.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from bot.models.custodial import CustodialTransaction, TransactionStatus, TransactionType
from bot.services.hot_wallet import hot_wallet_service
from database.db import get_session as get_db_session

logger = logging.getLogger(__name__)


class WithdrawReconciler:
    """Periodic background task that resolves stuck PENDING withdrawals."""

    def __init__(
        self,
        poll_interval_seconds: int = 60,
        stale_after_minutes: int = 3,
        never_broadcast_after_minutes: int = 30,
    ):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._poll_interval = poll_interval_seconds
        self._stale_after = timedelta(minutes=stale_after_minutes)
        self._never_broadcast_after = timedelta(minutes=never_broadcast_after_minutes)
        logger.info(
            "Withdraw reconciler initialized (interval=%ss, stale_after=%sm, refund_after=%sm)",
            poll_interval_seconds,
            stale_after_minutes,
            never_broadcast_after_minutes,
        )

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Withdraw reconciler started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Withdraw reconciler stopped")

    async def _loop(self) -> None:
        from bot.utils.redis_cache import redis_cache

        while self._running:
            try:
                await self._reconcile_once()
                await redis_cache.set(
                    "service:withdraw_reconciler:heartbeat", time.time(), ttl_seconds=180
                )
            except Exception:
                logger.exception("Withdraw reconciler loop error")
            await asyncio.sleep(self._poll_interval)

    async def _reconcile_once(self) -> None:
        """One reconciliation pass. Idempotent and safe to call repeatedly —
        every branch either no-ops (still ambiguous) or moves a row from
        PENDING to a terminal status (COMPLETED/FAILED), so re-running never
        double-refunds or double-finalizes a row already resolved."""
        cutoff = datetime.now(timezone.utc) - self._stale_after

        # Phase 1: read to plain dicts, close the session before any RPC call.
        rows: list[dict] = []
        with get_db_session() as session:
            candidates = (
                session.query(CustodialTransaction)
                .filter(
                    CustodialTransaction.tx_type == TransactionType.WITHDRAWAL.value,
                    CustodialTransaction.status == TransactionStatus.PENDING.value,
                    CustodialTransaction.created_at < cutoff,
                )
                .all()
            )
            for row in candidates:
                rows.append(
                    {
                        "id": row.id,
                        "user_id": row.user_id,
                        "chain": row.chain,
                        "token_symbol": row.token_symbol,
                        "amount": row.amount,
                        "tx_hash": row.tx_hash,
                        "created_at": row.created_at,
                    }
                )

        for row in rows:
            try:
                await self._resolve_one(row)
            except Exception:
                logger.exception("Withdraw reconciler failed to resolve tx_id=%s", row["id"])

    async def _resolve_one(self, row: dict) -> None:
        created_at = row["created_at"]
        if created_at is not None and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - created_at if created_at is not None else timedelta(0)

        if row["tx_hash"]:
            # Every ambiguous send now stamps a deterministic hash onto the
            # placeholder BEFORE broadcasting (see hot_wallet._broadcast_evm_raw_tx
            # / _send_sol_native / _send_spl_token, plus the request-path
            # record_pending_tx_hash backstop). So any row that reaches here
            # with a hash is resolved purely via chain lookup — never by age.
            confirmed = await self._check_chain_status(row["chain"], row["tx_hash"])
            if confirmed is True:
                # CAS: only transition PENDING -> COMPLETED. If a concurrent
                # request-path finalize() already moved this row (or a prior
                # reconciler pass already did), this is a no-op — never
                # re-finalize or clobber a different terminal status.
                hot_wallet_service.cas_transaction_status(
                    row["id"],
                    expected_status=TransactionStatus.PENDING,
                    new_status=TransactionStatus.COMPLETED,
                    tx_hash=row["tx_hash"],
                )
                return
            if confirmed is False:
                # Definitively reverted/failed on-chain — no value moved, safe
                # to refund.
                self._refund_and_fail(row)
                return
            # Unknown/still pending/RPC error — never refund a row with a
            # recorded hash purely on age; leave it for the next cycle.
            return

        # No tx_hash was ever recorded. With the pre-broadcast stamping above,
        # this should be essentially unreachable except for a genuine crash
        # before the hash could ever be stamped (e.g. between claiming the
        # idempotency key and the broadcast call). Only treat as
        # never-broadcast once it's old enough that any in-flight request
        # would have long since finished one way or the other.
        if age >= self._never_broadcast_after:
            self._refund_and_fail(row)

    def _refund_and_fail(self, row: dict) -> None:
        """Refund + mark FAILED, guarded by a compare-and-swap on status.

        The balance credit is only applied if the CAS actually won
        (rowcount == 1) — i.e. the row was still PENDING at the moment of the
        UPDATE. If a concurrent request-path finalize() (or a racing
        reconciler pass) already moved it to COMPLETED/FAILED, the CAS loses,
        we skip the credit entirely, and log. This closes the TOCTOU between
        the Phase-1 read (which saw PENDING) and this mutation.
        """
        transitioned = hot_wallet_service.cas_transaction_status(
            row["id"],
            expected_status=TransactionStatus.PENDING,
            new_status=TransactionStatus.FAILED,
        )
        if not transitioned:
            logger.info(
                "Withdraw reconciler skipped refund for tx_id=%s — row was no longer PENDING "
                "(already resolved by a concurrent finalize or reconciler pass)",
                row["id"],
            )
            return

        hot_wallet_service.update_custodial_balance(
            user_id=row["user_id"],
            chain=row["chain"],
            token_symbol=row["token_symbol"],
            amount=Decimal(row["amount"]),
            operation="add",
        )
        logger.warning(
            "Withdraw reconciler refunded tx_id=%s user=%s %s %s (never confirmed on-chain)",
            row["id"],
            row["user_id"],
            row["amount"],
            row["token_symbol"],
        )

    async def _check_chain_status(self, chain: str, tx_hash: str) -> Optional[bool]:
        """Returns True if confirmed/mined successfully, False if
        definitively failed/reverted, None if unknown/still pending/error."""
        try:
            if (chain or "").lower() in ("solana", "sol"):
                return await self._check_solana_status(tx_hash)
            return self._check_evm_status(chain, tx_hash)
        except Exception:
            logger.debug(
                "Withdraw reconciler chain-status check failed for %s", tx_hash, exc_info=True
            )
            return None

    def _check_evm_status(self, chain: str, tx_hash: str) -> Optional[bool]:
        web3 = hot_wallet_service._get_web3(chain)
        try:
            receipt = web3.eth.get_transaction_receipt(tx_hash)
        except Exception:
            # Not found yet (still propagating / dropped) — unknown.
            return None
        if receipt is None:
            return None
        status = (
            receipt.get("status") if isinstance(receipt, dict) else getattr(receipt, "status", None)
        )
        if status == 1:
            return True
        if status == 0:
            return False
        return None

    async def _check_solana_status(self, signature: str) -> Optional[bool]:
        from bot.config.settings import settings

        rpc_url = getattr(settings, "solana_rpc_url", None)
        if not rpc_url:
            return None

        from solana.rpc.async_api import AsyncClient

        try:
            async with AsyncClient(rpc_url) as client:
                resp = await client.get_signature_statuses([signature])
        except Exception:
            return None

        try:
            value = resp.value[0]
        except (AttributeError, IndexError, TypeError):
            return None
        if value is None:
            return None
        err = getattr(value, "err", None)
        if err is not None:
            return False
        confirmation_status = getattr(value, "confirmation_status", None)
        if confirmation_status is not None:
            # confirmed/finalized with no error -> success
            return True
        return None


withdraw_reconciler = WithdrawReconciler()
