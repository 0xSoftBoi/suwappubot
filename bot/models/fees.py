"""Models for fee tracking and configuration."""

from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean
from datetime import datetime
from database.db import Base


class FeeConfig(Base):
    """Global fee configuration."""
    __tablename__ = "fee_config"
    
    id = Column(Integer, primary_key=True)
    
    # Fee settings
    swap_fee_percentage = Column(Float, default=1.0)  # 1% default
    min_fee_usd = Column(Float, default=0.0)  # Minimum fee in USD
    max_fee_usd = Column(Float, default=1000.0)  # Maximum fee in USD
    
    # Fee collection wallet
    fee_collector_chain = Column(String(50), default="ethereum")
    fee_collector_address = Column(String(100), nullable=True)
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FeeTransaction(Base):
    """Record of fees collected."""
    __tablename__ = "fee_transactions"
    
    id = Column(Integer, primary_key=True)
    
    # User and swap reference
    user_id = Column(Integer, nullable=False)
    swap_id = Column(Integer, nullable=True)  # Reference to swap transaction
    
    # Fee details
    chain = Column(String(50), nullable=False)
    token_symbol = Column(String(20), nullable=False)
    
    # Amounts
    swap_amount = Column(Float, nullable=False)  # Original swap amount
    fee_percentage = Column(Float, nullable=False)  # Fee % at time of swap
    fee_amount = Column(Float, nullable=False)  # Fee taken
    fee_amount_usd = Column(Float, nullable=True)
    
    # Status
    collected = Column(Boolean, default=False)  # Whether fee was transferred to collector
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)


class FeeSummary(Base):
    """Daily/monthly fee summaries."""
    __tablename__ = "fee_summaries"
    
    id = Column(Integer, primary_key=True)
    
    # Period
    period_type = Column(String(10), nullable=False)  # "daily" or "monthly"
    period_date = Column(String(10), nullable=False)  # YYYY-MM-DD or YYYY-MM
    
    # Totals
    total_swaps = Column(Integer, default=0)
    total_volume_usd = Column(Float, default=0.0)
    total_fees_usd = Column(Float, default=0.0)
    
    # By chain breakdown (stored as JSON string)
    chain_breakdown = Column(String(2000), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

