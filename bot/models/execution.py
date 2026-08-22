"""Canonical execution lifecycle persistence for Terminal money paths.

MONEY-PATH: these tables provide operational truth only. Economic truth belongs
in the separate ledger introduced by #908.
"""

from datetime import datetime
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.sql import func

from database.db import Base


def _new_uuid() -> str:
    return str(uuid.uuid4())


class ExecutionIntent(Base):
    """User/agent economic intent before an execution plan is selected."""

    __tablename__ = "execution_intents"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    principal_key = Column(String(160), nullable=False, index=True)
    idempotency_key = Column(String(128), nullable=True)

    intent_type = Column(String(40), nullable=False)
    side = Column(String(12), nullable=True)
    from_chain = Column(String(50), nullable=True)
    to_chain = Column(String(50), nullable=True)
    from_asset = Column(String(128), nullable=True)
    to_asset = Column(String(128), nullable=True)
    requested_quantity = Column(String(78), nullable=True)
    requested_notional = Column(String(78), nullable=True)
    constraints_json = Column(JSON, nullable=True)
    metadata_json = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "principal_key",
            "idempotency_key",
            name="uq_exec_intent_principal_idempotency",
        ),
    )


class ExecutionCandidatePlan(Base):
    """One feasible or rejected execution plan considered for an intent."""

    __tablename__ = "execution_candidate_plans"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    intent_id = Column(String(36), ForeignKey("execution_intents.id"), nullable=False, index=True)
    ordinal = Column(Integer, nullable=False)
    substrate = Column(String(40), nullable=False)
    provider = Column(String(80), nullable=True)
    strategy = Column(String(80), nullable=True)
    feasible = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    rejection_code = Column(String(80), nullable=True)
    expected_to_amount = Column(String(78), nullable=True)
    expected_cost_bps = Column(String(78), nullable=True)
    expected_duration_ms = Column(Integer, nullable=True)
    plan_json = Column(JSON, nullable=True)
    cost_json = Column(JSON, nullable=True)
    selected = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    quote_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("intent_id", "ordinal", name="uq_exec_candidate_intent_ordinal"),
        Index("ix_exec_candidate_intent_selected", "intent_id", "selected"),
    )


class ExecutionParentOrder(Base):
    """Lifecycle owner for one chosen execution plan."""

    __tablename__ = "execution_parent_orders"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    intent_id = Column(String(36), ForeignKey("execution_intents.id"), nullable=False, index=True)
    selected_candidate_id = Column(
        String(36), ForeignKey("execution_candidate_plans.id"), nullable=True, index=True
    )
    resubmission_of_parent_id = Column(
        String(36), ForeignKey("execution_parent_orders.id"), nullable=True, index=True
    )

    state = Column(String(24), nullable=False, default="draft", server_default=text("'draft'"))
    state_version = Column(Integer, nullable=False, default=0, server_default=text("0"))
    strategy = Column(String(80), nullable=True)
    authorization_method = Column(String(40), nullable=True)
    requested_quantity = Column(String(78), nullable=True)
    filled_quantity = Column(String(78), nullable=False, default="0", server_default=text("'0'"))
    average_fill_price = Column(String(78), nullable=True)

    submit_idempotency_key = Column(String(128), nullable=True)
    request_fingerprint = Column(String(128), nullable=True)

    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "intent_id",
            "submit_idempotency_key",
            name="uq_exec_parent_intent_submit_key",
        ),
        Index("ix_exec_parent_state_updated", "state", "updated_at"),
    )


class ExecutionChildPlacement(Base):
    """One external order, transaction, or solver child submitted by a parent."""

    __tablename__ = "execution_child_placements"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    parent_order_id = Column(
        String(36), ForeignKey("execution_parent_orders.id"), nullable=False, index=True
    )
    child_sequence = Column(Integer, nullable=False)
    substrate = Column(String(40), nullable=False)
    provider = Column(String(80), nullable=True)
    venue = Column(String(80), nullable=True)
    chain = Column(String(50), nullable=True)
    side = Column(String(12), nullable=True)
    requested_quantity = Column(String(78), nullable=True)
    limit_price = Column(String(78), nullable=True)
    state = Column(String(32), nullable=False, default="created", server_default=text("'created'"))

    idempotency_key = Column(String(128), nullable=True)
    request_fingerprint = Column(String(128), nullable=True)
    external_order_id = Column(String(255), nullable=True)
    external_tx_hash = Column(String(255), nullable=True)
    external_intent_id = Column(String(255), nullable=True)

    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "parent_order_id",
            "child_sequence",
            name="uq_exec_child_parent_sequence",
        ),
        UniqueConstraint("provider", "external_order_id", name="uq_exec_child_provider_order"),
        Index("ix_exec_child_parent_state", "parent_order_id", "state"),
    )


class ExecutionFill(Base):
    """Authoritative external fill observed for a parent/child."""

    __tablename__ = "execution_fills"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    parent_order_id = Column(
        String(36), ForeignKey("execution_parent_orders.id"), nullable=False, index=True
    )
    child_placement_id = Column(
        String(36), ForeignKey("execution_child_placements.id"), nullable=True, index=True
    )
    external_source = Column(String(80), nullable=False)
    external_fill_id = Column(String(255), nullable=True)
    quantity = Column(String(78), nullable=False)
    price = Column(String(78), nullable=False)
    fee_amount = Column(String(78), nullable=True)
    fee_asset = Column(String(128), nullable=True)
    liquidity_role = Column(String(16), nullable=True)
    metadata_json = Column(JSON, nullable=True)
    occurred_at = Column(DateTime, nullable=False)
    observed_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "external_source",
            "external_fill_id",
            name="uq_exec_fill_source_external",
        ),
        Index("ix_exec_fill_parent_occurred", "parent_order_id", "occurred_at"),
    )


class ExecutionSettlement(Base):
    """Confirmation/finality/recovery state associated with execution value movement."""

    __tablename__ = "execution_settlements"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    parent_order_id = Column(
        String(36), ForeignKey("execution_parent_orders.id"), nullable=False, index=True
    )
    child_placement_id = Column(
        String(36), ForeignKey("execution_child_placements.id"), nullable=True, index=True
    )
    settlement_type = Column(String(40), nullable=False)
    external_source = Column(String(80), nullable=False)
    external_ref = Column(String(255), nullable=False)
    state = Column(String(32), nullable=False, default="pending", server_default=text("'pending'"))
    chain = Column(String(50), nullable=True)
    asset = Column(String(128), nullable=True)
    amount = Column(String(78), nullable=True)
    confirmations = Column(Integer, nullable=True)
    finality_target = Column(Integer, nullable=True)
    recovery_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "external_source",
            "external_ref",
            "settlement_type",
            name="uq_exec_settlement_external",
        ),
        Index("ix_exec_settlement_parent_state", "parent_order_id", "state"),
    )


class ExecutionEvent(Base):
    """Immutable event used to replay one parent order's operational state."""

    __tablename__ = "execution_events"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    parent_order_id = Column(
        String(36), ForeignKey("execution_parent_orders.id"), nullable=False, index=True
    )
    sequence = Column(Integer, nullable=False)
    event_type = Column(String(64), nullable=False)
    from_state = Column(String(24), nullable=True)
    to_state = Column(String(24), nullable=True)
    payload_json = Column(JSON, nullable=True)
    actor_type = Column(String(24), nullable=True)
    actor_id = Column(String(160), nullable=True)
    correlation_id = Column(String(128), nullable=True, index=True)
    causation_id = Column(String(128), nullable=True)
    occurred_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("parent_order_id", "sequence", name="uq_exec_event_parent_sequence"),
        Index("ix_exec_event_parent_occurred", "parent_order_id", "occurred_at"),
    )


class ExecutionOutbox(Base):
    """Transactional outbox row for at-least-once lifecycle event publication."""

    __tablename__ = "execution_outbox"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    event_id = Column(String(36), ForeignKey("execution_events.id"), nullable=False)
    topic = Column(String(128), nullable=False)
    payload_json = Column(JSON, nullable=True)
    attempts = Column(Integer, nullable=False, default=0, server_default=text("0"))
    published_at = Column(DateTime, nullable=True)
    next_attempt_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("event_id", name="uq_execution_outbox_event_id"),
        Index("ix_exec_outbox_publish", "published_at", "next_attempt_at"),
    )
