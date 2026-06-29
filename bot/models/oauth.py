"""
OAuth identity and token models for social authentication.

Supports Google and Twitter OAuth providers, linking external identities
to Suwappu user accounts.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database.db import Base


def _as_utc(dt):
    """Normalize a possibly timezone-naive datetime to aware UTC.

    Stored DateTime columns are UTC but come back naive (SQLite/older rows),
    which raises TypeError when compared to an aware ``datetime.now(timezone.utc)``.
    """
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class OAuthIdentity(Base):
    """
    Links OAuth accounts (Google, Twitter) to Suwappu users.

    A user can have multiple OAuth identities (e.g., both Google and Twitter).
    Each identity stores the provider-specific user ID and profile info.
    """

    __tablename__ = "oauth_identities"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Provider info
    provider = Column(String(50), nullable=False)  # "google", "twitter"
    provider_user_id = Column(String(255), nullable=False)  # External user ID

    # Profile info (cached from provider)
    email = Column(String(255), nullable=True)
    name = Column(String(255), nullable=True)
    profile_image = Column(Text, nullable=True)  # URL

    # Turnkey integration
    turnkey_authenticator_id = Column(String(255), nullable=True)

    # Status
    is_primary = Column(Boolean, default=False)  # Primary login method
    is_verified = Column(Boolean, default=True)  # Email verified by provider

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # Relationships
    user = relationship("User", backref="oauth_identities")
    tokens = relationship("OAuthToken", back_populates="identity", cascade="all, delete-orphan")

    # Composite unique constraint: one identity per provider per user
    __table_args__ = (Index("ix_oauth_provider_user", "provider", "provider_user_id", unique=True),)

    def __repr__(self) -> str:
        return f"<OAuthIdentity(provider={self.provider}, user_id={self.user_id})>"


class OAuthToken(Base):
    """
    Stores encrypted OAuth tokens for each identity.

    Tokens are KMS-encrypted before storage for security.
    Refresh tokens allow automatic token renewal.
    """

    __tablename__ = "oauth_tokens"

    id = Column(Integer, primary_key=True)
    identity_id = Column(Integer, ForeignKey("oauth_identities.id"), nullable=False, index=True)

    # Encrypted tokens (use KMS envelope encryption)
    access_token_encrypted = Column(Text, nullable=False)
    refresh_token_encrypted = Column(Text, nullable=True)

    # Token metadata
    token_type = Column(String(50), default="Bearer")
    scope = Column(Text, nullable=True)  # Space-separated scopes

    # Expiration
    expires_at = Column(DateTime, nullable=True)
    refresh_expires_at = Column(DateTime, nullable=True)

    # Encryption metadata (for envelope encryption)
    encryption_scheme = Column(String(50), default="kms_aesgcm_v2")
    kms_wrapped_dek = Column(Text, nullable=True)
    aesgcm_nonce = Column(String(32), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    identity = relationship("OAuthIdentity", back_populates="tokens")

    def __repr__(self) -> str:
        return f"<OAuthToken(identity_id={self.identity_id}, expires_at={self.expires_at})>"

    @property
    def is_expired(self) -> bool:
        """Check if access token is expired."""
        if not self.expires_at:
            return False
        return datetime.now(timezone.utc) >= _as_utc(self.expires_at)

    @property
    def needs_refresh(self) -> bool:
        """Check if token should be refreshed (within 5 min of expiry)."""
        if not self.expires_at:
            return False
        from datetime import timedelta

        return datetime.now(timezone.utc) >= (_as_utc(self.expires_at) - timedelta(minutes=5))


class OAuthState(Base):
    """
    Temporary storage for OAuth state parameters (CSRF protection).

    Stored in database to support distributed deployments.
    Automatically cleaned up after use or expiration.
    """

    __tablename__ = "oauth_states"

    id = Column(Integer, primary_key=True)
    state = Column(String(64), nullable=False, unique=True, index=True)

    # OAuth flow data
    provider = Column(String(50), nullable=False)
    redirect_uri = Column(Text, nullable=True)
    code_verifier = Column(String(128), nullable=True)  # PKCE

    # Link to existing user (for account linking flows)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Context
    action = Column(String(50), default="login")  # "login", "link", "register"

    # Expiration
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self) -> str:
        return f"<OAuthState(provider={self.provider}, action={self.action})>"

    @property
    def is_expired(self) -> bool:
        """Check if state has expired."""
        return datetime.now(timezone.utc) >= _as_utc(self.expires_at)
