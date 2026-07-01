"""Regression tests for the withdraw reconciler's fund-safety guards.

Covers the two money-path races the reconciler must never lose:

1. A PENDING withdrawal whose tx_hash is confirmed on-chain must be
   finalized (COMPLETED), never refunded — this is what protects against
   double-spending the omnibus wallet for a transfer that actually landed.
2. A refund attempt on a row that was concurrently finalized by another
   writer (simulated by flipping its status before the reconciler's CAS
   fires) must be skipped entirely — no double-credit, no status flip back.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from bot.models.custodial import CustodialTransaction, TransactionStatus, TransactionType
from bot.services.withdraw_reconciler import WithdrawReconciler
from database.db import get_session


def _make_pending_withdrawal(user_id: int, amount: str = "1.5", tx_hash: str | None = None):
    with get_session() as session:
        tx = CustodialTransaction(
            user_id=user_id,
            tx_type=TransactionType.WITHDRAWAL.value,
            status=TransactionStatus.PENDING.value,
            chain="base",
            token_symbol="USDC",
            token_address="0x0000000000000000000000000000000000000000",
            amount=amount,
            tx_hash=tx_hash,
            created_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
        session.add(tx)
        session.commit()
        return tx.id


def test_confirmed_onchain_tx_is_finalized_not_refunded(tmp_db):
    """A PENDING row whose hash is confirmed on-chain must move to COMPLETED
    and must NEVER trigger a balance credit (that would double-spend)."""
    tx_id = _make_pending_withdrawal(user_id=1, amount="2.0", tx_hash="0xdeadbeef")

    reconciler = WithdrawReconciler()

    with (
        patch.object(reconciler, "_check_chain_status", new=AsyncMock(return_value=True)),
        patch(
            "bot.services.withdraw_reconciler.hot_wallet_service.update_custodial_balance"
        ) as mock_credit,
    ):
        row = {
            "id": tx_id,
            "user_id": 1,
            "chain": "base",
            "token_symbol": "USDC",
            "amount": "2.0",
            "tx_hash": "0xdeadbeef",
            "created_at": datetime.now(timezone.utc) - timedelta(minutes=10),
        }
        import asyncio

        asyncio.run(reconciler._resolve_one(row))

        # Never refunded — that would double-credit a transfer that landed.
        mock_credit.assert_not_called()

    with get_session() as session:
        refreshed = (
            session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
        )
        assert refreshed.status == TransactionStatus.COMPLETED.value


def test_refund_skipped_when_row_already_finalized_concurrently(tmp_db):
    """If another writer (a live request finalize(), or a prior reconciler
    pass) already moved the row out of PENDING before the refund CAS fires,
    the refund must be skipped entirely — no double-credit."""
    tx_id = _make_pending_withdrawal(user_id=2, amount="3.0")

    # Simulate the race: the row is already COMPLETED by the time the
    # reconciler's CAS runs.
    with get_session() as session:
        tx = session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
        tx.status = TransactionStatus.COMPLETED.value
        session.commit()

    reconciler = WithdrawReconciler()
    row = {
        "id": tx_id,
        "user_id": 2,
        "chain": "base",
        "token_symbol": "USDC",
        "amount": "3.0",
        "tx_hash": None,
        "created_at": datetime.now(timezone.utc) - timedelta(minutes=10),
    }

    with patch(
        "bot.services.withdraw_reconciler.hot_wallet_service.update_custodial_balance"
    ) as mock_credit:
        reconciler._refund_and_fail(row)
        # CAS lost (row was COMPLETED, not PENDING) -> no credit issued.
        mock_credit.assert_not_called()

    with get_session() as session:
        refreshed = (
            session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
        )
        # Status must remain COMPLETED — the reconciler must not flip it
        # back to FAILED after losing the CAS.
        assert refreshed.status == TransactionStatus.COMPLETED.value
