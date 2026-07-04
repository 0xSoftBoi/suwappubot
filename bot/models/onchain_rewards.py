"""On-chain rewards (fee cashback) models — Rewards v1.

Weekly epochs accrue 10% of each user's own paid swap fees. At finalize time the
epoch's per-user totals are aggregated from ``fee_transactions`` (idempotent read-
side aggregation — no per-swap write hooks), a Merkle distribution is built, and
each entry stores its proof so the api-ts read API never has to re-derive trees.

Settlement is EITHER on-chain (audited SuwappuRewardsDistributor, USDC on Base)
OR a custodial-balance credit — never both. The ``status`` state machine is the
double-pay guard:

    pending   epoch still accruing (row not yet created in practice)
    carryover finalized below the $1 minimum — no leaf; rolls into next epoch
    rolled    carryover consumed by a later epoch's entry (terminal)
    claimable finalized, epoch NOT published on-chain → custodial credit allowed
    onchain   epoch published on-chain → ONLY the contract can settle it until
              claim_deadline passes; afterwards it reverts to custodial-claimable
              (the contract enforces the deadline, so no double pay is possible)
    claimed_onchain  Claimed event / isClaimed confirmed (terminal)
    credited  custodial balance credited (terminal)
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from database.db import Base

# Epoch lifecycle: accruing -> finalized -> published (on-chain) -> closed
EPOCH_STATUS_ACCRUING = "accruing"
EPOCH_STATUS_FINALIZED = "finalized"
EPOCH_STATUS_PUBLISHED = "published"
EPOCH_STATUS_CLOSED = "closed"

ENTRY_STATUS_CARRYOVER = "carryover"
ENTRY_STATUS_ROLLED = "rolled"
ENTRY_STATUS_CLAIMABLE = "claimable"
ENTRY_STATUS_ONCHAIN = "onchain"
ENTRY_STATUS_CLAIMED_ONCHAIN = "claimed_onchain"
ENTRY_STATUS_CREDITED = "credited"


class RewardEpoch(Base):
    """One weekly cashback epoch."""

    __tablename__ = "reward_epochs"

    id = Column(Integer, primary_key=True)
    epoch_index = Column(Integer, nullable=False, unique=True)  # weeks since anchor
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    status = Column(String(20), nullable=False, default=EPOCH_STATUS_ACCRUING)

    # Set at finalize
    total_amount_usd = Column(Float, nullable=False, default=0.0)
    entry_count = Column(Integer, nullable=False, default=0)
    merkle_root = Column(String(66), nullable=True)  # 0x + 64 hex

    # Set at publish (ops submits setEpoch to the audited distributor)
    published_tx_hash = Column(String(80), nullable=True)
    claim_deadline = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    finalized_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_reward_epochs_status", "status"),)


class RewardEntry(Base):
    """One user's cashback for one epoch (leaf of the epoch's Merkle tree)."""

    __tablename__ = "reward_entries"

    id = Column(Integer, primary_key=True)
    epoch_id = Column(Integer, ForeignKey("reward_epochs.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Amount breakdown (USD). amount_usd = cashback_usd + carryover_usd.
    cashback_usd = Column(Float, nullable=False, default=0.0)
    carryover_usd = Column(Float, nullable=False, default=0.0)
    amount_usd = Column(Float, nullable=False, default=0.0)
    fee_basis_usd = Column(Float, nullable=False, default=0.0)  # fees the 10% was taken of

    # On-chain leaf data (NULL when the user has no EVM address → custodial only)
    claim_address = Column(String(64), nullable=True)
    leaf_index = Column(Integer, nullable=True)
    amount_base_units = Column(String(40), nullable=True)  # uint256 as string
    merkle_proof = Column(Text, nullable=True)  # JSON list of 0x-hex hashes

    status = Column(String(20), nullable=False, default=ENTRY_STATUS_CLAIMABLE)
    claimed_tx_hash = Column(String(80), nullable=True)
    settled_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("epoch_id", "user_id", name="uq_reward_entries_epoch_user"),
        Index("ix_reward_entries_user_id", "user_id"),
        Index("ix_reward_entries_status", "status"),
    )
