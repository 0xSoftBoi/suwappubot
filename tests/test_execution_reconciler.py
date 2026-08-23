import asyncio
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from bot.models.execution import (
    ExecutionCandidatePlan,
    ExecutionChildPlacement,
    ExecutionEvent,
    ExecutionFill,
    ExecutionIntent,
    ExecutionOutbox,
    ExecutionParentOrder,
    ExecutionSettlement,
)
from bot.models.swap import SwapStatus, SwapTransaction
from bot.services.execution_lifecycle import ParentState
from bot.services.execution_reconciler import ExecutionReconciler
from bot.services.legacy_swap_execution_adapter import project_legacy_swap
from bot.services.lifi_api import LiFiStatus
from database.db import Base

TABLES = [
    SwapTransaction.__table__,
    ExecutionIntent.__table__,
    ExecutionCandidatePlan.__table__,
    ExecutionParentOrder.__table__,
    ExecutionChildPlacement.__table__,
    ExecutionFill.__table__,
    ExecutionSettlement.__table__,
    ExecutionEvent.__table__,
    ExecutionOutbox.__table__,
]


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=TABLES)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _scope(SessionLocal):
    @contextmanager
    def session_scope():
        session = SessionLocal()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    return session_scope


def _swap(*, swap_id=1, status=SwapStatus.COMPLETED.value):
    return SwapTransaction(
        id=swap_id,
        user_id=7,
        from_chain="ethereum",
        from_token="USDC",
        from_amount="100000000",
        from_amount_usd=100.0,
        to_chain="base",
        to_token="WETH",
        # Deliberately absurd quote output. Reconciliation must never use it.
        to_amount="999999999999999999999999",
        to_amount_usd=101.0,
        realized_to_amount=None,
        status=status,
        tx_hash=f"0xsource{swap_id}",
        idempotency_key=f"quote-{swap_id}",
        route_provider="lifi",
        slippage=50,
        created_at=datetime(2026, 8, 22, 12, 0, 0),
        updated_at=datetime(2026, 8, 22, 12, 0, 5),
        completed_at=(
            datetime(2026, 8, 22, 12, 0, 20)
            if status == SwapStatus.COMPLETED.value
            else None
        ),
    )


def _status(
    *,
    status="DONE",
    amount="47000000000000000",
    source="0xsource1",
    destination="0xdestination1",
):
    return LiFiStatus(
        status=status,
        substatus=None,
        receiving_chain_id=8453,
        receiving_tx_hash=destination,
        sending_tx_hash=source,
        tool="across",
        receiving_amount=amount,
        receiving_amount_usd=100.5 if amount is not None else None,
        raw_response={},
    )


class _FakeLiFi:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def get_status(self, tx_hash, from_chain, to_chain):
        self.calls.append((tx_hash, from_chain, to_chain))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _seed_reconciling(SessionLocal, *, swap_id=1, status=SwapStatus.COMPLETED.value):
    session = SessionLocal()
    swap = _swap(swap_id=swap_id, status=status)
    session.add(swap)
    session.flush()
    parent = project_legacy_swap(session, swap)
    parent_id = parent.id
    session.commit()
    session.close()
    return parent_id


def test_done_with_positive_received_amount_resolves_reconciling_atomically():
    SessionLocal = _session_factory()
    parent_id = _seed_reconciling(SessionLocal)
    lifi = _FakeLiFi(_status())
    reconciler = ExecutionReconciler(lifi=lifi, session_scope=_scope(SessionLocal))

    assert asyncio.run(reconciler._reconcile_once()) == 1

    session = SessionLocal()
    swap = session.get(SwapTransaction, 1)
    parent = session.get(ExecutionParentOrder, parent_id)
    fill = session.query(ExecutionFill).one()
    settlement = session.query(ExecutionSettlement).one()

    assert swap.status == SwapStatus.COMPLETED.value
    assert swap.realized_to_amount == "47000000000000000"
    assert swap.realized_to_amount != swap.to_amount
    assert swap.destination_tx_hash == "0xdestination1"
    assert parent.state == ParentState.FILLED.value
    assert fill.output_amount == "47000000000000000"
    assert settlement.state == "settled"
    assert settlement.amount == "47000000000000000"
    assert settlement.external_ref == "0xsource1"
    session.close()


def test_repeated_pass_is_idempotent_after_resolution():
    SessionLocal = _session_factory()
    _seed_reconciling(SessionLocal)
    lifi = _FakeLiFi(_status())
    reconciler = ExecutionReconciler(lifi=lifi, session_scope=_scope(SessionLocal))

    assert asyncio.run(reconciler._reconcile_once()) == 1

    session = SessionLocal()
    counts = (
        session.query(ExecutionFill).count(),
        session.query(ExecutionSettlement).count(),
        session.query(ExecutionEvent).count(),
        session.query(ExecutionOutbox).count(),
    )
    session.close()

    # FILLED parent is no longer a candidate, so a restart/pass cannot create
    # another fill, settlement, lifecycle event, or outbox row.
    assert asyncio.run(reconciler._reconcile_once()) == 0

    session = SessionLocal()
    assert (
        session.query(ExecutionFill).count(),
        session.query(ExecutionSettlement).count(),
        session.query(ExecutionEvent).count(),
        session.query(ExecutionOutbox).count(),
    ) == counts
    session.close()


def test_done_without_received_amount_never_falls_back_to_quote():
    SessionLocal = _session_factory()
    parent_id = _seed_reconciling(SessionLocal)
    reconciler = ExecutionReconciler(
        lifi=_FakeLiFi(_status(amount=None)),
        session_scope=_scope(SessionLocal),
    )

    assert asyncio.run(reconciler._reconcile_once()) == 0

    session = SessionLocal()
    swap = session.get(SwapTransaction, 1)
    parent = session.get(ExecutionParentOrder, parent_id)
    settlement = session.query(ExecutionSettlement).one()
    assert swap.realized_to_amount is None
    assert parent.state == ParentState.RECONCILING.value
    assert session.query(ExecutionFill).count() == 0
    assert settlement.state == "reconciling"
    assert settlement.amount is None
    session.close()


def test_zero_or_fractional_smallest_unit_amount_is_not_fill_evidence():
    for amount in ("0", "-1", "1.5"):
        SessionLocal = _session_factory()
        parent_id = _seed_reconciling(SessionLocal)
        reconciler = ExecutionReconciler(
            lifi=_FakeLiFi(_status(amount=amount)),
            session_scope=_scope(SessionLocal),
        )

        assert asyncio.run(reconciler._reconcile_once()) == 0
        session = SessionLocal()
        assert session.get(ExecutionParentOrder, parent_id).state == ParentState.RECONCILING.value
        assert session.get(SwapTransaction, 1).realized_to_amount is None
        assert session.query(ExecutionFill).count() == 0
        session.close()


def test_provider_failure_or_exception_does_not_invent_terminal_outcome():
    for result in (_status(status="FAILED", amount=None), RuntimeError("provider unavailable")):
        SessionLocal = _session_factory()
        parent_id = _seed_reconciling(SessionLocal)
        reconciler = ExecutionReconciler(lifi=_FakeLiFi(result), session_scope=_scope(SessionLocal))

        assert asyncio.run(reconciler._reconcile_once()) == 0
        session = SessionLocal()
        assert session.get(ExecutionParentOrder, parent_id).state == ParentState.RECONCILING.value
        assert session.get(SwapTransaction, 1).realized_to_amount is None
        assert session.query(ExecutionFill).count() == 0
        session.close()


def test_provider_source_identity_mismatch_fails_closed():
    SessionLocal = _session_factory()
    parent_id = _seed_reconciling(SessionLocal)
    reconciler = ExecutionReconciler(
        lifi=_FakeLiFi(_status(source="0xother")),
        session_scope=_scope(SessionLocal),
    )

    assert asyncio.run(reconciler._reconcile_once()) == 0
    session = SessionLocal()
    assert session.get(ExecutionParentOrder, parent_id).state == ParentState.RECONCILING.value
    assert session.get(SwapTransaction, 1).realized_to_amount is None
    session.close()


def test_authoritative_done_can_supersede_ambiguous_legacy_failure():
    SessionLocal = _session_factory()
    parent_id = _seed_reconciling(SessionLocal, status=SwapStatus.FAILED.value)
    reconciler = ExecutionReconciler(
        lifi=_FakeLiFi(_status()),
        session_scope=_scope(SessionLocal),
    )

    assert asyncio.run(reconciler._reconcile_once()) == 1
    session = SessionLocal()
    assert session.get(SwapTransaction, 1).status == SwapStatus.COMPLETED.value
    assert session.get(ExecutionParentOrder, parent_id).state == ParentState.FILLED.value
    assert session.query(ExecutionFill).count() == 1
    assert session.query(ExecutionSettlement).one().state == "settled"
    session.close()


def test_projection_failure_rolls_back_realized_amount_and_canonical_resolution(monkeypatch):
    SessionLocal = _session_factory()
    parent_id = _seed_reconciling(SessionLocal)
    reconciler = ExecutionReconciler(
        lifi=_FakeLiFi(_status()),
        session_scope=_scope(SessionLocal),
    )

    def _boom(*_args, **_kwargs):
        raise RuntimeError("projection failed")

    monkeypatch.setattr("bot.services.execution_reconciler.project_legacy_swap", _boom)
    assert asyncio.run(reconciler._reconcile_once()) == 0

    session = SessionLocal()
    assert session.get(SwapTransaction, 1).realized_to_amount is None
    assert session.get(SwapTransaction, 1).destination_tx_hash is None
    assert session.get(ExecutionParentOrder, parent_id).state == ParentState.RECONCILING.value
    assert session.query(ExecutionFill).count() == 0
    assert session.query(ExecutionSettlement).one().state == "reconciling"
    session.close()
