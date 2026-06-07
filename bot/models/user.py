from sqlalchemy import Column, Integer, BigInteger, String, DateTime, Boolean, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from database.db import Base


class User(Base):
    """Telegram user model."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    # Telegram user IDs routinely exceed 2^31 (INT4 max) as of 2024-2026; must be BIGINT.
    telegram_id = Column(BigInteger, unique=True, nullable=True, index=True)
    whatsapp_id = Column(String(255), unique=True, nullable=True, index=True)
    discord_id = Column(String(100), unique=True, nullable=True, index=True)
    discord_username = Column(String(255), nullable=True)
    username = Column(String(255), nullable=True)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    
    # Settings
    default_slippage = Column(Integer, default=50)  # In basis points (50 = 0.5%)
    notifications_enabled = Column(Boolean, default=True)
    panic_sell_enabled = Column(Boolean, default=False)
    
    # Terms of Service
    tos_accepted = Column(Boolean, default=False)
    tos_accepted_at = Column(DateTime, nullable=True)
    
    # Referral tracking (denormalized for performance)
    referred_by_user_id = Column(Integer, nullable=True, index=True)  # Who referred this user
    total_referral_rewards = Column(Float, default=0.0)  # Total USD earned from referrals
    referral_count = Column(Integer, default=0)  # Number of users referred
    
    # 2FA
    two_fa_enabled = Column(Boolean, default=False)
    totp_secret = Column(String(64), nullable=True)  # TOTP secret for 2FA
    two_fa_threshold = Column(Integer, default=1000)  # USD threshold for 2FA
    
    # Push notifications (Expo push token for iOS/Android app)
    push_token = Column(String(255), nullable=True, default=None)

    # Terminal passkey auth
    passkey_credential_id = Column(String(512), nullable=True, index=True)
    passkey_user_handle = Column(String(255), nullable=True, index=True)

    # Wallet recovery
    recovery_email = Column(String(255), nullable=True)
    recovery_setup_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_active_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    wallets = relationship("Wallet", back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    swaps = relationship("SwapTransaction", back_populates="user", cascade="all, delete-orphan", lazy="select")
    subscription = relationship("Subscription", back_populates="user", uselist=False, lazy="selectin")
    
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
    encrypted_private_key = Column(Text, nullable=True)  # Encrypted private key (NULL for Turnkey wallets)
    
    # Envelope encryption metadata (KMS + AES-GCM)
    encryption_scheme = Column(String(50), default="legacy_fernet_v1")  # "legacy_fernet_v1" or "kms_aesgcm_v2"
    kms_wrapped_dek = Column(Text, nullable=True)  # Base64 KMS-encrypted DEK
    aesgcm_nonce = Column(String(32), nullable=True)  # Base64 nonce/IV for AES-GCM
    kms_key_id = Column(String(255), nullable=True)  # Which KMS key was used
    key_version = Column(Integer, default=1)  # For rotation tracking
    
    # Turnkey wallet infrastructure
    wallet_provider = Column(String(20), default="local")  # "local" or "turnkey"
    turnkey_sub_org_id = Column(String(100), nullable=True)  # User's Turnkey sub-organization
    turnkey_wallet_id = Column(String(100), nullable=True)  # Turnkey wallet ID
    turnkey_account_id = Column(String(100), nullable=True)  # Turnkey account ID (for signing)
    
    # Chain type: "evm" or "solana"
    chain_type = Column(String(20), nullable=False)
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    
    # Backup key export tracking
    backup_key_exported_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="wallets")
    
    def __repr__(self) -> str:
        return f"<Wallet(address={self.address[:10]}..., chain_type={self.chain_type}, provider={self.wallet_provider})>"
    
    @property
    def is_legacy_encryption(self) -> bool:
        """Check if wallet uses legacy encryption scheme."""
        return self.encryption_scheme != "kms_aesgcm_v2"
    
    @property
    def is_turnkey_wallet(self) -> bool:
        """Check if wallet is backed by Turnkey."""
        return self.wallet_provider == "turnkey"
    
    @property
    def is_local_wallet(self) -> bool:
        """Check if wallet is stored locally."""
        return self.wallet_provider == "local"
