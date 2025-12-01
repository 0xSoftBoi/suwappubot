"""Models for custodial wallet and balance management."""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Float, Enum as SQLEnum, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
from database.db import Base


class TransactionType(Enum):
    """Types of custodial transactions."""
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    SWAP_IN = "swap_in"
    SWAP_OUT = "swap_out"
    GAS_SPONSORSHIP = "gas_sponsorship"
    FEE = "fee"
    REFUND = "refund"


class TransactionStatus(Enum):
    """Status of custodial transactions."""
    PENDING = "pending"
    CONFIRMING = "confirming"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CustodialBalance(Base):
    """User's custodial token balances managed by the bot."""
    __tablename__ = "custodial_balances"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Token identification
    chain = Column(String(50), nullable=False)
    token_symbol = Column(String(20), nullable=False)
    token_address = Column(String(100), nullable=False)
    
    # Balance (stored as string for precision)
    balance = Column(String(78), default="0")  # Max uint256 is 78 digits
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self) -> str:
        return f"<CustodialBalance({self.token_symbol} on {self.chain}: {self.balance})>"
    
    @property
    def balance_float(self) -> float:
        """Get balance as float."""
        try:
            return float(self.balance)
        except:
            return 0.0


class CustodialTransaction(Base):
    """Record of custodial transactions."""
    __tablename__ = "custodial_transactions"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Transaction type and status
    tx_type = Column(String(30), nullable=False)
    status = Column(String(20), default=TransactionStatus.PENDING.value)
    
    # Token details
    chain = Column(String(50), nullable=False)
    token_symbol = Column(String(20), nullable=False)
    token_address = Column(String(100), nullable=False)
    
    # Amount (stored as string for precision)
    amount = Column(String(78), nullable=False)
    amount_usd = Column(Float, nullable=True)
    
    # On-chain transaction (for deposits/withdrawals)
    tx_hash = Column(String(100), nullable=True)
    from_address = Column(String(100), nullable=True)
    to_address = Column(String(100), nullable=True)
    
    # Gas sponsorship details
    gas_sponsored = Column(Boolean, default=False)
    gas_cost = Column(String(78), nullable=True)
    gas_cost_usd = Column(Float, nullable=True)
    
    # Metadata
    notes = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    def __repr__(self) -> str:
        return f"<CustodialTx({self.tx_type}: {self.amount} {self.token_symbol})>"


class HotWallet(Base):
    """Hot wallet configuration for custodial operations."""
    __tablename__ = "hot_wallets"
    
    id = Column(Integer, primary_key=True)
    
    # Wallet details
    name = Column(String(100), nullable=False)
    chain_type = Column(String(20), nullable=False)  # "evm" or "solana"
    address = Column(String(100), nullable=False, unique=True)
    encrypted_private_key = Column(Text, nullable=False)
    
    # Wallet purpose
    is_deposit_wallet = Column(Boolean, default=True)
    is_gas_payer = Column(Boolean, default=False)
    
    # Balance tracking
    native_balance = Column(String(78), default="0")
    last_balance_check = Column(DateTime, nullable=True)
    
    # Thresholds
    min_native_balance = Column(String(78), default="0.1")  # Alert threshold
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self) -> str:
        return f"<HotWallet({self.name}: {self.address[:10]}...)>"


class GasSponsorshipConfig(Base):
    """Configuration for gas sponsorship."""
    __tablename__ = "gas_sponsorship_config"
    
    id = Column(Integer, primary_key=True)
    
    # Chain config
    chain = Column(String(50), nullable=False, unique=True)
    
    # Sponsorship enabled
    is_enabled = Column(Boolean, default=True)
    
    # Limits
    max_gas_per_tx_usd = Column(Float, default=5.0)  # Max gas to sponsor per transaction
    max_gas_per_user_daily_usd = Column(Float, default=20.0)  # Daily limit per user
    
    # Fee structure (optional fee to charge users)
    fee_percentage = Column(Float, default=0.0)  # % of swap amount
    min_fee_usd = Column(Float, default=0.0)
    
    # Total sponsored
    total_sponsored_usd = Column(Float, default=0.0)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserGasUsage(Base):
    """Track gas usage per user for limits."""
    __tablename__ = "user_gas_usage"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Daily tracking
    date = Column(String(10), nullable=False)  # YYYY-MM-DD
    chain = Column(String(50), nullable=False)
    
    # Usage
    gas_sponsored_usd = Column(Float, default=0.0)
    tx_count = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

