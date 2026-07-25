"""Community payment-tool models — Bucket 2.

Tables:
  tips              — in-chat tipping ledger
  lucky_boxes       — red-packet / gift-packet pools
  lucky_box_claims  — one row per claimer per box
  split_bills       — group bill-splitting records
  split_bill_shares — individual shares per debtor
  airdrop_campaigns — token-airdrop campaigns
  airdrop_claims    — one row per claimer per campaign

All fund-amount columns use Numeric(18, 6) to match the existing
money-path tables (staking, p2p, morpho, predict).
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database.db import Base

# ---------------------------------------------------------------------------
# tips
# ---------------------------------------------------------------------------


class Tip(Base):
    """In-chat tipping ledger.

    recipient_id is NULL for unclaimed tips (recipient_username was given but
    has not yet registered).  Once the recipient registers, the service layer
    sets recipient_id and transitions status -> 'claimed'.

    Status values: pending | claimed | refunded
    """

    __tablename__ = "tips"

    id = Column(Integer, primary_key=True, autoincrement=True)

    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # NULL while tip is unclaimed (recipient not yet registered)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    recipient_username = Column(String(128), nullable=True)

    chat_id = Column(String(64), nullable=False, index=True)
    token = Column(String(20), nullable=False)
    chain = Column(String(50), nullable=False)
    amount = Column(Numeric(18, 6), nullable=False)

    tx_hash = Column(String(128), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending | claimed | refunded

    created_at = Column(DateTime, default=datetime.utcnow)
    claimed_at = Column(DateTime, nullable=True)

    # Relationships
    sender = relationship("User", foreign_keys=[sender_id], backref="tips_sent")
    recipient = relationship("User", foreign_keys=[recipient_id], backref="tips_received")

    __table_args__ = (
        Index("ix_tips_status", "status"),
        Index("ix_tips_sender_status", "sender_id", "status"),
    )


# ---------------------------------------------------------------------------
# lucky_boxes
# ---------------------------------------------------------------------------


class LuckyBox(Base):
    """Red-packet / gift-packet pool.

    split_mode:
      'random' — each claimer receives a random share of remaining_amount
      'even'   — each claimer receives total_amount / total_count

    Status values: active | exhausted | expired | refunded
    """

    __tablename__ = "lucky_boxes"

    id = Column(Integer, primary_key=True, autoincrement=True)

    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    chat_id = Column(String(64), nullable=False, index=True)
    token = Column(String(20), nullable=False)
    chain = Column(String(50), nullable=False)

    total_amount = Column(Numeric(18, 6), nullable=False)
    remaining_amount = Column(Numeric(18, 6), nullable=False)
    total_count = Column(Integer, nullable=False)
    claimed_count = Column(Integer, nullable=False, default=0)

    split_mode = Column(String(20), nullable=False, default="random")  # random | even
    status = Column(
        String(20), nullable=False, default="active"
    )  # active | exhausted | expired | refunded

    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    creator = relationship("User", foreign_keys=[creator_id], backref="lucky_boxes_created")
    claims = relationship("LuckyBoxClaim", back_populates="lucky_box", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_lucky_boxes_status", "status"),
        Index("ix_lucky_boxes_creator_status", "creator_id", "status"),
    )


# ---------------------------------------------------------------------------
# lucky_box_claims
# ---------------------------------------------------------------------------


class LuckyBoxClaim(Base):
    """Records each user's claim on a lucky box.

    The UNIQUE constraint on (lucky_box_id, claimer_id) prevents double-claiming.
    """

    __tablename__ = "lucky_box_claims"

    id = Column(Integer, primary_key=True, autoincrement=True)

    lucky_box_id = Column(Integer, ForeignKey("lucky_boxes.id"), nullable=False, index=True)
    claimer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 6), nullable=False)
    tx_hash = Column(String(128), nullable=True)
    claimed_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    lucky_box = relationship("LuckyBox", back_populates="claims")
    claimer = relationship("User", foreign_keys=[claimer_id], backref="lucky_box_claims")

    __table_args__ = (
        UniqueConstraint("lucky_box_id", "claimer_id", name="uq_lucky_box_claims_box_claimer"),
    )


# ---------------------------------------------------------------------------
# split_bills
# ---------------------------------------------------------------------------


class SplitBill(Base):
    """Group bill-splitting header record.

    Status values: pending | settled | cancelled
    """

    __tablename__ = "split_bills"

    id = Column(Integer, primary_key=True, autoincrement=True)

    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    chat_id = Column(String(64), nullable=False, index=True)
    token = Column(String(20), nullable=False)
    chain = Column(String(50), nullable=False)
    total_amount = Column(Numeric(18, 6), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending | settled | cancelled

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    creator = relationship("User", foreign_keys=[creator_id], backref="split_bills_created")
    shares = relationship(
        "SplitBillShare", back_populates="split_bill", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_split_bills_creator_status", "creator_id", "status"),)


# ---------------------------------------------------------------------------
# split_bill_shares
# ---------------------------------------------------------------------------


class SplitBillShare(Base):
    """Individual share per debtor for a split bill.

    Status values: pending | paid
    """

    __tablename__ = "split_bill_shares"

    id = Column(Integer, primary_key=True, autoincrement=True)

    split_bill_id = Column(Integer, ForeignKey("split_bills.id"), nullable=False, index=True)
    debtor_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 6), nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending | paid
    paid_at = Column(DateTime, nullable=True)

    # Relationships
    split_bill = relationship("SplitBill", back_populates="shares")
    debtor = relationship("User", foreign_keys=[debtor_id], backref="split_bill_shares")

    __table_args__ = (
        Index("ix_split_bill_shares_debtor_status", "debtor_id", "status"),
        UniqueConstraint("split_bill_id", "debtor_id", name="uq_split_bill_shares_bill_debtor"),
    )


# ---------------------------------------------------------------------------
# airdrop_campaigns
# ---------------------------------------------------------------------------


class AirdropCampaign(Base):
    """Token-airdrop campaign definition.

    criteria is a free-form TEXT/JSON field allowing the service layer to store
    eligibility rules (e.g. {"min_swaps": 3, "chain": "base"}).

    per_user_amount is NULL for campaigns where amounts differ per user
    (service layer computes the amount at claim time from criteria).

    Status values: active | exhausted | expired | cancelled
    """

    __tablename__ = "airdrop_campaigns"

    id = Column(Integer, primary_key=True, autoincrement=True)

    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    chat_id = Column(String(64), nullable=False, index=True)
    token = Column(String(20), nullable=False)
    chain = Column(String(50), nullable=False)
    total_amount = Column(Numeric(18, 6), nullable=False)
    per_user_amount = Column(Numeric(18, 6), nullable=True)  # NULL = variable
    criteria = Column(Text, nullable=True)  # JSON eligibility rules
    status = Column(
        String(20), nullable=False, default="active"
    )  # active | exhausted | expired | cancelled

    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    creator = relationship("User", foreign_keys=[creator_id], backref="airdrop_campaigns_created")
    claims = relationship("AirdropClaim", back_populates="campaign", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_airdrop_campaigns_status", "status"),
        Index("ix_airdrop_campaigns_creator", "creator_id"),
    )


# ---------------------------------------------------------------------------
# airdrop_claims
# ---------------------------------------------------------------------------


class AirdropClaim(Base):
    """Records each user's claim on an airdrop campaign.

    The UNIQUE constraint on (campaign_id, claimer_id) prevents double-claiming.
    """

    __tablename__ = "airdrop_claims"

    id = Column(Integer, primary_key=True, autoincrement=True)

    campaign_id = Column(Integer, ForeignKey("airdrop_campaigns.id"), nullable=False, index=True)
    claimer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 6), nullable=False)
    tx_hash = Column(String(128), nullable=True)
    claimed_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    campaign = relationship("AirdropCampaign", back_populates="claims")
    claimer = relationship("User", foreign_keys=[claimer_id], backref="airdrop_claims")

    __table_args__ = (
        UniqueConstraint("campaign_id", "claimer_id", name="uq_airdrop_claims_campaign_claimer"),
    )
