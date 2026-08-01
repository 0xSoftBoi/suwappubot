"""Persistence for user-facing cross-chain bridge transfers.

Deliberately separate from bot/models/cctp.py. Those tables are *relayer
bookkeeping* — attempts, stall counts, claim leases, the machinery of getting a
CCTP message minted. This table is the *user's transfer*: one row per thing a
person started, in the vocabulary the UI speaks, for any provider.

Keeping them apart means each has one authority. For a CCTP transfer the
relayer row remains the truth about relay progress, and this row's state is
derived from it (see api/webapp.py's bridge transfer endpoint) rather than
duplicated — two independently-updated copies of "has it landed yet" is how
they drift.

The row is created at BUILD time, before anything is signed. That ordering is
the same lesson as bot/services/swap_engine.py's pre-broadcast recording: a
transaction that exists on chain with no row is invisible forever, whereas a
row whose transaction was never signed is harmless and expires on its own.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, Numeric, String

from database.db import Base


class BridgeTransfer(Base):
    """One cross-chain transfer a user started."""

    __tablename__ = "bridge_transfers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)

    provider = Column(String(40), nullable=False)
    from_chain = Column(String(40), nullable=False)
    to_chain = Column(String(40), nullable=False)
    token = Column(String(20), nullable=False)

    # Raw base units. Numeric, not Integer: 18-decimal amounts overflow int64.
    amount_raw = Column(Numeric(precision=40, scale=0), nullable=False)
    decimals = Column(Integer, nullable=False, default=6)

    sender_address = Column(String(120), nullable=False)
    recipient_address = Column(String(120), nullable=False)

    # Carried from the quote so the UI can describe the transfer the same way
    # after a reload, without re-quoting (a re-quote could disagree).
    settlement = Column(String(20), nullable=False, default="tx")
    trust_model = Column(String(20), nullable=False, default="liquidity")
    estimated_time = Column(Integer, nullable=False, default=0)

    # State machine, in the UI's vocabulary (see terminal/src/types/bridge.ts):
    #   pending_broadcast   -> row created at build; nothing signed yet
    #   awaiting_deposit    -> deposit-address rails; waiting on the user to send
    #   source_pending      -> source tx broadcast, not yet confirmed
    #   source_confirmed    -> funds have left the source chain
    #   attesting           -> waiting on the proof that releases the far side
    #   destination_pending -> delivery tx submitted
    #   complete            -> funds on the destination chain
    #   stalled             -> not progressing, still retryable
    #   failed              -> terminal; needs a human
    state = Column(String(24), nullable=False, default="pending_broadcast", index=True)
    # Plain-language, already safe to render. Never put an exception repr here.
    status_detail = Column(String(400), nullable=True)

    source_tx_hash = Column(String(90), nullable=True, index=True)
    destination_tx_hash = Column(String(90), nullable=True)
    deposit_address = Column(String(120), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # The two access patterns: a user's transfer list, and the sweep for
        # rows still in flight.
        Index("ix_bridge_transfers_user_created", "user_id", "created_at"),
        Index("ix_bridge_transfers_state_updated", "state", "updated_at"),
    )
