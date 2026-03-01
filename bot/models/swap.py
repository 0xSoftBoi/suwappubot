from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey, Text, Enum
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
    
    from_token_price_usd = Column(Float, nullable=True)  # Price per token at execution

    # Destination details
    to_chain = Column(String(50), nullable=False)
    to_token = Column(String(20), nullable=False)
    to_amount = Column(String(78), nullable=True)  # Estimated/actual amount out
    to_amount_usd = Column(Float, nullable=True)
    to_token_price_usd = Column(Float, nullable=True)  # Price per token at execution
    
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

    # Agent linkage (nullable -- only set for agent-initiated swaps)
    agent_id = Column(Integer, nullable=True, index=True)
    agent_uuid = Column(String(36), nullable=True)

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

