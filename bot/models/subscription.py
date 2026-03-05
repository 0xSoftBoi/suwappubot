"""Subscription and token-gating models for x402 integration."""

from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Enum as SQLEnum
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
    
    expires_at = Column(DateTime, nullable=True)  # Duration-based expiry
    
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

