"""Subscription and token-gating models for x402 integration."""

from datetime import datetime
from enum import Enum
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    Text,
    Enum as SQLEnum,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database.db import Base


class SubscriptionTier(str, Enum):
    """Subscription tiers for the bot."""

    FREE = "free"
    PRO = "pro"
    PREMIUM = "premium"
    ENTERPRISE = "enterprise"


class PaymentStatus(str, Enum):
    """Payment status for x402 transactions."""

    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"


class Subscription(Base):
    """User subscription record."""

    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    tier = Column(SQLEnum(SubscriptionTier), default=SubscriptionTier.FREE)

    started_at = Column(DateTime, nullable=True)  # When subscription was activated
    expires_at = Column(DateTime, nullable=True)  # Duration-based expiry

    # Stripe customer handle — captured from checkout.session.completed so the
    # web dashboard can open the Stripe billing portal (invoices, payment
    # methods, cancellation) without re-running checkout.
    stripe_customer_id = Column(String(64), nullable=True, index=True)

    # Usage tracking
    api_calls_today = Column(Integer, default=0)
    api_calls_total = Column(Integer, default=0)
    last_reset_date = Column(DateTime, default=datetime.utcnow)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", back_populates="subscription")


class X402Payment(Base):
    """x402 payment transaction record."""

    __tablename__ = "x402_payments"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Payment details
    payment_id = Column(String(128), unique=True, nullable=False)  # x402 payment ID
    amount = Column(Float, nullable=False)
    token_symbol = Column(String(16), default="USDC")
    token_address = Column(String(64), nullable=True)
    chain = Column(String(32), default="base")

    # Transaction
    tx_hash = Column(String(128), nullable=True)
    status = Column(SQLEnum(PaymentStatus), default=PaymentStatus.PENDING)

    # What was purchased
    product_type = Column(String(32), nullable=False)  # "subscription", "api_credits", "feature"
    product_id = Column(String(64), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # x402 specific
    receipt = Column(Text, nullable=True)  # x402 payment receipt

    # Relationship
    user = relationship("User", backref="x402_payments")


class ConsumedPayment(Base):
    """SHARED global (chain, tx_hash) consumed-payments ledger.

    SECURITY (payment replay / cross-surface double-redeem): this is the SAME
    Postgres table the api-ts service writes to via Drizzle (migration
    ``drizzle/0006_*.sql`` + ``api-ts/src/lib/paymentConsumption.ts``). The
    database is shared between the python bot and api-ts (see
    ``database/db.py`` — "This database is SHARED with the python-api"), so
    consuming ``(chain, tx_hash)`` HERE means a given on-chain payment is
    redeemable exactly ONCE across BOTH the Telegram-bot subscription/credit
    path (``X402Service.verify_payment``) AND the api-ts agent/webapp/MPP paths.

    Column shape MUST stay byte-compatible with the Drizzle migration:
    ``chain varchar(32)``, ``tx_hash varchar(128)``, ``purpose varchar(32)``,
    ``consumed_by varchar(64)`` nullable, ``UNIQUE(chain, tx_hash)``. api-ts
    owns creation in prod; ``create_all`` here only creates it when missing
    (e.g. sqlite tests / bot-first boot) with the identical shape.
    """

    __tablename__ = "consumed_payments"

    id = Column(Integer, primary_key=True)
    chain = Column(String(32), nullable=False)
    tx_hash = Column(String(128), nullable=False)
    purpose = Column(String(32), nullable=False)
    consumed_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("chain", "tx_hash", name="uq_consumed_payments_chain_tx"),)


class MPPSessionRecord(Base):
    """Persisted MPP streaming payment session."""

    __tablename__ = "mpp_sessions"

    id = Column(Integer, primary_key=True)
    session_id = Column(String(128), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    service_url = Column(String(512), nullable=False)
    service_name = Column(String(256), nullable=True)
    fee_token = Column(String(32), default="pathUSD")
    deposit_amount = Column(Float, default=0)
    spent_amount = Column(Float, default=0)
    status = Column(String(32), default="active")  # active, paused, closed, expired
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)

    user = relationship("User", backref="mpp_sessions")


class APICredit(Base):
    """API credits for pay-per-use features."""

    __tablename__ = "api_credits"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    # Credits
    balance = Column(Float, default=0)  # Credits in USD value
    lifetime_purchased = Column(Float, default=0)
    lifetime_used = Column(Float, default=0)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = relationship("User", backref="api_credits")
