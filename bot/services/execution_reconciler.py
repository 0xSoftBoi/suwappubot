"""Authoritatively resolve canonical executions stuck in ``reconciling``.

The legacy swap poller can observe a terminal provider status without an actual
received amount. In that case ``project_legacy_swap`` deliberately places the
canonical parent in ``reconciling`` instead of manufacturing a fill from the
quote. This worker closes that loop for Li.Fi cross-chain swaps by asking the
provider again for destination-settlement evidence.

Safety invariants:
- never use quote-time ``to_amount`` as realized output;
- never hold a database transaction open across provider I/O;
- revalidate parent/swap/child transaction identity under row locks before a
  money-path mutation;
- only a positive, integral Li.Fi ``receiving.amount`` can resolve a swap;
- provider PENDING/FAILED/INVALID/malformed observations remain ambiguous and
  therefore remain ``reconciling``;
- legacy realized output + destination hash + canonical fill/outbox commit in
  one database transaction via ``project_legacy_swap``;
- repeated passes are idempotent because FILLED parents leave the candidate set
  and canonical fill/event identities are stable.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Callable, ContextManager, Optional

from sqlalchemy import String, cast, func

from bot.models.execution import ExecutionChildPlacement, ExecutionParentOrder
from bot.models.swap import SwapStatus, SwapTransaction
from bot.services.legacy_swap_execution_adapter import project_legacy_swap
from bot.services.lifi_api import LiFiAPI, LiFiStatus
from database.db import get_session as get_db_session

logger = logging.getLogger(__name__)


class ExecutionReconciler:
    """Periodic resolver for canonical legacy-swap parents in ``reconciling``."""

    def __init__(
        self,
        *,
        lifi: Optional[LiFiAPI] = None,
        poll_interval_seconds: int = 30,
        provider_timeout_seconds: int = 10,
        batch_size: int = 50,
        session_scope: Callable[[], ContextManager] = get_db_session,
    ) -> None:
        self._lifi = lifi or LiFiAPI()
        self._poll_interval = poll_interval_seconds
        self._provider_timeout = provider_timeout_seconds
        self._batch_size = batch_size
        self._session_scope = session_scope
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "Execution reconciler started (interval=%ss, batch=%s)",
            self._poll_interval,
            self._batch_size,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("Execution reconciler stopped")

    async def _loop(self) -> None:
        from bot.utils.redis_cache import redis_cache

        while self._running:
            try:
                await self._reconcile_once()
                await redis_cache.set(
                    "service:execution_reconciler:heartbeat",
                    time.time(),
                    ttl_seconds=max(180, self._poll_interval * 4),
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Execution reconciler loop error")
            await asyncio.sleep(self._poll_interval)

    async def _reconcile_once(self) -> int:
        """Run one pass and return the number of parents resolved to FILLED."""

        # Phase 1: select only provider rows this worker can actually resolve,
        # copy immutable lookup identity, then close the session before network
        # I/O. Filtering before LIMIT prevents unsupported reconciling rows from
        # starving Li.Fi work at the front of the queue.
        candidates: list[dict] = []
        with self._session_scope() as session:
            rows = (
                session.query(ExecutionParentOrder, SwapTransaction)
                .join(
                    SwapTransaction,
                    ExecutionParentOrder.source_ref == cast(SwapTransaction.id, String),
                )
                .filter(
                    ExecutionParentOrder.state == "reconciling",
                    ExecutionParentOrder.source_type == "swap",
                    func.lower(SwapTransaction.route_provider) == "lifi",
                    SwapTransaction.tx_hash.isnot(None),
                    SwapTransaction.from_chain != SwapTransaction.to_chain,
                    SwapTransaction.status.in_(
                        [SwapStatus.COMPLETED.value, SwapStatus.FAILED.value]
                    ),
                )
                .order_by(ExecutionParentOrder.updated_at.asc(), ExecutionParentOrder.id.asc())
                .limit(self._batch_size)
                .all()
            )
            for parent, swap in rows:
                candidates.append(
                    {
                        "parent_id": parent.id,
                        "swap_id": swap.id,
                        "tx_hash": swap.tx_hash,
                        "from_chain": swap.from_chain,
                        "to_chain": swap.to_chain,
                    }
                )

        resolved = 0
        for candidate in candidates:
            try:
                status = await asyncio.wait_for(
                    self._lifi.get_status(
                        tx_hash=candidate["tx_hash"],
                        from_chain=candidate["from_chain"],
                        to_chain=candidate["to_chain"],
                    ),
                    timeout=self._provider_timeout,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning(
                    "Execution reconciliation provider lookup failed parent=%s swap=%s",
                    candidate["parent_id"],
                    candidate["swap_id"],
                    exc_info=True,
                )
                continue

            amount = self._authoritative_amount(status)
            if status.status != "DONE" or amount is None:
                # A provider failure after the legacy row already reached a
                # terminal/ambiguous state is not enough evidence to invent a
                # different economic outcome. Keep reconciling until positive
                # destination settlement evidence exists (or a future recovery
                # adapter proves a definitive refund/revert).
                logger.info(
                    "Execution remains reconciling parent=%s swap=%s provider_status=%s "
                    "substatus=%s realized_output=%s",
                    candidate["parent_id"],
                    candidate["swap_id"],
                    status.status,
                    status.substatus,
                    "present" if status.receiving_amount is not None else "missing",
                )
                continue

            if not self._provider_sending_identity_matches(
                candidate["tx_hash"], status.sending_tx_hash
            ):
                logger.error(
                    "Execution reconciler rejected LiFi sending tx identity mismatch "
                    "parent=%s swap=%s expected=%s observed=%s",
                    candidate["parent_id"],
                    candidate["swap_id"],
                    candidate["tx_hash"],
                    status.sending_tx_hash,
                )
                continue

            if self._commit_resolution(candidate, status, amount):
                resolved += 1

        return resolved

    @staticmethod
    def _eligible_swap(swap: Optional[SwapTransaction]) -> bool:
        if swap is None:
            return False
        if not swap.tx_hash:
            return False
        if (swap.route_provider or "").lower() != "lifi":
            return False
        # The existing Li.Fi status path is authoritative for cross-chain
        # destination settlement. Same-chain completion must be proven by its
        # chain/provider-specific adapter instead of opportunistically reused.
        if swap.from_chain == swap.to_chain:
            return False
        return swap.status in {SwapStatus.COMPLETED.value, SwapStatus.FAILED.value}

    @staticmethod
    def _authoritative_amount(status: LiFiStatus) -> Optional[str]:
        """Return normalized smallest-unit output only when unquestionably valid."""

        if status.status != "DONE" or status.receiving_amount in (None, ""):
            return None
        try:
            amount = Decimal(str(status.receiving_amount))
        except (InvalidOperation, TypeError, ValueError):
            return None
        # Li.Fi receiving.amount is a smallest-unit integer. Fractional,
        # non-finite, zero, or negative values are not safe fill evidence.
        if not amount.is_finite() or amount <= 0 or amount != amount.to_integral_value():
            return None
        return format(amount, "f")

    @staticmethod
    def _normalize_tx_identity(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = str(value).strip()
        if not value:
            return None
        # EVM hashes are case-insensitive hex; Solana/base58 identities are not.
        return value.lower() if value.startswith(("0x", "0X")) else value

    @classmethod
    def _same_persisted_tx_identity(cls, left: Optional[str], right: Optional[str]) -> bool:
        """Strict comparison for identities we own in the database."""

        normalized_left = cls._normalize_tx_identity(left)
        normalized_right = cls._normalize_tx_identity(right)
        return (
            normalized_left is not None
            and normalized_right is not None
            and normalized_left == normalized_right
        )

    @classmethod
    def _provider_sending_identity_matches(cls, expected: str, observed: Optional[str]) -> bool:
        """Li.Fi may omit sending.txHash; a present value must match exactly."""

        if observed in (None, ""):
            # The status request itself was keyed by expected tx_hash. Omission
            # is therefore weaker evidence, not contradictory evidence.
            return True
        return cls._same_persisted_tx_identity(expected, observed)

    def _commit_resolution(self, candidate: dict, status: LiFiStatus, amount: str) -> bool:
        """CAS-like revalidation + canonical projection in one transaction."""

        try:
            with self._session_scope() as session:
                parent = (
                    session.query(ExecutionParentOrder)
                    .filter(ExecutionParentOrder.id == candidate["parent_id"])
                    .with_for_update()
                    .first()
                )
                if parent is None or parent.state != "reconciling":
                    return False
                if parent.source_type != "swap" or parent.source_ref != str(candidate["swap_id"]):
                    logger.error(
                        "Execution reconciler source identity changed parent=%s",
                        candidate["parent_id"],
                    )
                    return False

                swap = (
                    session.query(SwapTransaction)
                    .filter(SwapTransaction.id == candidate["swap_id"])
                    .with_for_update()
                    .first()
                )
                if not self._eligible_swap(swap):
                    return False
                if not self._same_persisted_tx_identity(candidate["tx_hash"], swap.tx_hash):
                    logger.error(
                        "Execution reconciler legacy tx identity changed parent=%s swap=%s",
                        candidate["parent_id"],
                        candidate["swap_id"],
                    )
                    return False

                child = (
                    session.query(ExecutionChildPlacement)
                    .filter(
                        ExecutionChildPlacement.parent_order_id == parent.id,
                        ExecutionChildPlacement.child_sequence == 0,
                    )
                    .with_for_update()
                    .first()
                )
                if child is None or not self._same_persisted_tx_identity(
                    swap.tx_hash, child.external_tx_hash
                ):
                    logger.error(
                        "Execution reconciler canonical child identity mismatch parent=%s swap=%s",
                        parent.id,
                        swap.id,
                    )
                    return False

                existing_amount = swap.realized_to_amount
                if existing_amount not in (None, ""):
                    try:
                        existing_normalized = format(Decimal(str(existing_amount)), "f")
                    except (InvalidOperation, TypeError, ValueError):
                        existing_normalized = str(existing_amount)
                    if existing_normalized != amount:
                        logger.error(
                            "Execution reconciler refused realized-output overwrite parent=%s swap=%s "
                            "existing=%s observed=%s",
                            parent.id,
                            swap.id,
                            existing_amount,
                            amount,
                        )
                        return False

                destination_hash = status.receiving_tx_hash or None
                if (
                    destination_hash
                    and swap.destination_tx_hash
                    and not self._same_persisted_tx_identity(
                        swap.destination_tx_hash, destination_hash
                    )
                ):
                    logger.error(
                        "Execution reconciler refused destination tx overwrite parent=%s swap=%s "
                        "existing=%s observed=%s",
                        parent.id,
                        swap.id,
                        swap.destination_tx_hash,
                        destination_hash,
                    )
                    return False

                # These are authoritative provider observations. Do not touch
                # quote-time swap.to_amount / to_amount_usd.
                swap.realized_to_amount = amount
                swap.realized_to_amount_usd = status.receiving_amount_usd
                if destination_hash and not swap.destination_tx_hash:
                    swap.destination_tx_hash = destination_hash
                if swap.status == SwapStatus.FAILED.value:
                    # A prior timeout/ambiguous failure is superseded only by
                    # stronger positive settlement evidence from the same tx.
                    swap.status = SwapStatus.COMPLETED.value
                    swap.completed_at = swap.completed_at or datetime.now(timezone.utc)

                project_legacy_swap(session, swap)
                session.commit()
                return True
        except Exception:
            # The context manager/session rollback keeps the legacy realized
            # amount and canonical projection atomic if anything fails.
            logger.exception(
                "Execution reconciliation commit failed parent=%s swap=%s",
                candidate["parent_id"],
                candidate["swap_id"],
            )
            return False


execution_reconciler = ExecutionReconciler()
