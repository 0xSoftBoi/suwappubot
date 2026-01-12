from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from database.db import Base


class User(Base):
    """Telegram user model."""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True)
    telegram_id = Column(Integer, unique=True, nullable=True, index=True)
    whatsapp_id = Column(String(255), unique=True, nullable=True, index=True)
    username = Column(String(255), nullable=True)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    
    # Settings
    default_slippage = Column(Integer, default=50)  # In basis points (50 = 0.5%)
    notifications_enabled = Column(Boolean, default=True)
    
    # 2FA
    two_fa_enabled = Column(Boolean, default=False)
    totp_secret = Column(String(64), nullable=True)  # TOTP secret for 2FA
    two_fa_threshold = Column(Integer, default=1000)  # USD threshold for 2FA
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_active_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    wallets = relationship("Wallet", back_populates="user", cascade="all, delete-orphan")
    swaps = relationship("SwapTransaction", back_populates="user", cascade="all, delete-orphan")
    subscription = relationship("Subscription", back_populates="user", uselist=False)
    
    def __repr__(self) -> str:
        return f"<User(telegram_id={self.telegram_id}, username={self.username})>"


class Wallet(Base):
    """User wallet model. Supports both EVM and Solana wallets."""
    __tablename__ = "wallets"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Wallet details
    name = Column(String(100), default="Default Wallet")
    address = Column(String(255), nullable=False)  # Wallet address (EVM or Solana)
    encrypted_private_key = Column(Text, nullable=False)  # Encrypted private key
    
    # Chain type: "evm" or "solana"
    chain_type = Column(String(20), nullable=False)
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="wallets")
    
    def __repr__(self) -> str:
        return f"<Wallet(address={self.address[:10]}..., chain_type={self.chain_type})>"

