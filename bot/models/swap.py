from sqlalchemy import (
    Boolean,
    Column,
    Integer,
    String,
    DateTime,
    Float,
    ForeignKey,
    Text,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from datetime import datetime
from database.db import Base
import enum


class SwapStatus(enum.Enum):
    """Status of a swap transaction."""

    PENDING = "pending"
    QUOTE_RECEIVED = "quote_received"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    SIGNED = "signed"  # Transaction signed, awaiting broadcast
    EXECUTING = "executing"
    SUBMITTED = "submitted"
    CONFIRMING = "confirming"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SwapTransaction(Base):
    """Swap transaction record."""

    __tablename__ = "swap_transactions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Source details
    from_chain = Column(String(50), nullable=False)
    from_token = Column(String(20), nullable=False)
    from_amount = Column(String(78), nullable=False)  # Store as string for precision
    from_amount_usd = Column(Float, nullable=True)

    # Destination details
    to_chain = Column(String(50), nullable=False)
    to_token = Column(String(20), nullable=False)
    to_amount = Column(String(78), nullable=True)  # Estimated/actual amount out
    to_amount_usd = Column(Float, nullable=True)

    # Transaction details
    status = Column(String(30), default=SwapStatus.PENDING.value)
    tx_hash = Column(String(255), nullable=True)  # Source chain tx hash
    bridge_tx_hash = Column(String(255), nullable=True)  # Bridge tx hash if cross-chain
    destination_tx_hash = Column(String(255), nullable=True)  # Destination chain tx hash

    # Idempotency (prevents duplicate submits on double-click/retry)
    # Enforced via a unique index created in `database/db.py` migrations helper.
    idempotency_key = Column(String(128), nullable=True, index=True)

    # Route info
    route_provider = Column(String(50), nullable=True)  # "lifi" or "jupiter"
    route_data = Column(Text, nullable=True)  # JSON route data

    # Fees
    gas_fee = Column(Float, nullable=True)
    bridge_fee = Column(Float, nullable=True)
    slippage = Column(Integer, default=50)  # In basis points

    # Timing
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Error handling
    error_message = Column(Text, nullable=True)
    # Classified failure cause for analytics (see error_guidance.classify_swap_failure).
    # One of: insufficient_gas, insufficient_balance, slippage_exceeded,
    # allowance_missing, rpc_timeout, bridge_timeout, simulation_revert,
    # user_rejected, no_route, unsupported, unknown.
    error_category = Column(String(40), nullable=True)

    # Relationships
    user = relationship("User", back_populates="swaps")

    def __repr__(self) -> str:
        return f"<SwapTransaction({self.from_chain}/{self.from_token} -> {self.to_chain}/{self.to_token}, status={self.status})>"

    @property
    def is_cross_chain(self) -> bool:
        """Check if this is a cross-chain swap."""
        return self.from_chain != self.to_chain

    @property
    def is_completed(self) -> bool:
        """Check if swap is completed."""
        return self.status == SwapStatus.COMPLETED.value

    @property
    def is_failed(self) -> bool:
        """Check if swap failed."""
        return self.status == SwapStatus.FAILED.value


class SwapRouteCandidate(Base):
    """One route option the aggregator returned for a quote — taken or not.

    EXECUTION INTELLIGENCE (the counterfactual): the swap path previously
    persisted only the route it executed (``swap_transactions.route_data``),
    so every alternative the aggregator offered was discarded at quote time.
    Without the rejected options there is no way to ask the only question that
    improves a routing decision — "should we have picked something else?" —
    because realized cost has nothing to be compared against.

    One row per candidate route per quote. ``was_selected`` marks the one that
    executed; ``swap_id`` is backfilled once a quote turns into a swap (a quote
    that is never executed keeps ``swap_id`` NULL and is still useful).

    Deliberately normalized rather than raw JSON blobs: at N routes per quote
    the raw payloads grow far faster than the columns anyone queries.

    NOTE: scores computed for routes that were NOT taken are *modeled*
    counterfactuals, not observations — nobody can know the slippage a
    route would actually have realized. Safe for ranking providers; never
    present as an observed outcome or a guarantee.
    """

    __tablename__ = "swap_route_candidates"

    id = Column(Integer, primary_key=True)

    # Quote correlation — set at quote time, before any swap exists.
    quote_id = Column(String(128), nullable=False, index=True)
    # Backfilled when the quote is executed. NULL = quote never executed.
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=True, index=True)

    # Principal. user_id is nullable so anonymous/public quotes still record.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # Set only for agent-originated quotes — the agent-vs-human split.
    agent_id = Column(Integer, nullable=True, index=True)

    # Trade shape (denormalized so cohort queries need no join).
    from_chain = Column(String(50), nullable=False)
    to_chain = Column(String(50), nullable=False)
    from_token = Column(String(40), nullable=False)
    to_token = Column(String(40), nullable=False)
    from_amount_usd = Column(Float, nullable=True)

    # The candidate itself.
    provider = Column(String(50), nullable=True)  # lifi, socket, jupiter
    tool = Column(String(80), nullable=True)  # underlying bridge/DEX
    quoted_to_amount = Column(String(78), nullable=True)
    quoted_to_amount_usd = Column(Float, nullable=True)
    quoted_gas_usd = Column(Float, nullable=True)
    quoted_fee_usd = Column(Float, nullable=True)
    quoted_duration_s = Column(Integer, nullable=True)

    # Rank as the aggregator returned it (0 = its own best).
    rank = Column(Integer, nullable=True)
    was_selected = Column(Boolean, default=False, nullable=False)
    # Stable identity for dedupe across repeated quotes of the same shape.
    route_hash = Column(String(64), nullable=True, index=True)

    # server_default is REQUIRED, not decoration: `default=` alone is applied
    # by SQLAlchemy in Python and produces NO database DEFAULT, so any other
    # writer (api-ts/Drizzle) inserting `default` for this column hits a NOT
    # NULL violation. This bit production — every capture insert failed.
    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return (
            f"<SwapRouteCandidate(quote={self.quote_id}, provider={self.provider}, "
            f"tool={self.tool}, selected={self.was_selected})>"
        )


class SwapExecutionMark(Base):
    """Post-trade price mark for a completed swap, at a fixed horizon.

    EXECUTION INTELLIGENCE (phase 2): a fill can only be judged against what
    happened after it. This records the destination-token price at fixed
    horizons past completion so execution quality can be separated into:

      * ``realized_vs_quoted_bps`` — did we deliver what the quote promised?
        (our routing / slippage accuracy, known immediately)
      * ``markout_bps`` — did the price move against the taker after the fill?
        (adverse selection / toxicity, only knowable later)

    One row per (swap, horizon); the unique constraint makes the scorer
    idempotent, so a restart or an overlapping pass cannot double-write.

    Sign convention: markout is expressed from the TAKER's perspective —
    positive means the fill aged well (price moved in the taker's favour).
    """

    __tablename__ = "swap_execution_marks"

    id = Column(Integer, primary_key=True)
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=False, index=True)

    # Horizon label: '5m', '1h', '24h'.
    horizon = Column(String(8), nullable=False)

    # Destination-token USD price observed at the horizon.
    to_token_price_usd = Column(Float, nullable=True)
    # Reference price captured at completion, so the mark is self-contained.
    fill_price_usd = Column(Float, nullable=True)

    # Basis-point measures. Nullable — a horizon can be scored for price drift
    # even when the quote comparison is impossible (missing amounts).
    realized_vs_quoted_bps = Column(Float, nullable=True)
    markout_bps = Column(Float, nullable=True)

    scored_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("swap_id", "horizon", name="uq_swap_execution_marks_swap_horizon"),
    )

    def __repr__(self) -> str:
        return (
            f"<SwapExecutionMark(swap={self.swap_id}, horizon={self.horizon}, "
            f"markout_bps={self.markout_bps})>"
        )
