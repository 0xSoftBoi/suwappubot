"""Two-factor authentication service for large swaps."""

import base64
import re
import pyotp
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

from bot.models.user import User
from database.db import get_session
from bot.config.settings import settings
from bot.utils.encryption import encrypt_private_key, decrypt_private_key

logger = logging.getLogger(__name__)


class TwoFactorService:
    """Service for managing 2FA for large transactions."""
    
    # Threshold for requiring 2FA (in USD)
    DEFAULT_THRESHOLD = 1000.0
    
    # How long a verification code is valid
    CODE_VALIDITY_MINUTES = 5
    
    def __init__(self):
        self._pending_verifications = {}  # user_id -> {code, expires_at, action_data}
    
    def generate_secret(self) -> str:
        """Generate a new TOTP secret for a user."""
        return pyotp.random_base32()
    
    def get_totp_uri(self, secret: str, username: str) -> str:
        """Get the TOTP URI for QR code generation."""
        totp = pyotp.TOTP(secret)
        return totp.provisioning_uri(name=username, issuer_name="Suwappu Bot")
    
    def verify_totp(self, secret: str, code: str) -> bool:
        """Verify a TOTP code."""
        totp = pyotp.TOTP(secret)
        return totp.verify(code)

    def encrypt_secret(self, secret: str) -> str:
        """Encrypt a TOTP secret for storage at rest."""
        return encrypt_private_key(secret, settings.encryption_key)

    @staticmethod
    def _is_legacy_plaintext_secret(value: str) -> bool:
        """True only if ``value`` looks like a real (legacy plaintext) TOTP
        secret rather than corrupted ciphertext.

        A genuine secret is RFC 3548 base32 (chars A-Z2-7, optional ``=``
        padding) that decodes cleanly and constructs a ``pyotp.TOTP``. This
        guard prevents healing from re-encrypting garbage in place and thereby
        destroying an unrecoverable secret.
        """
        if not value or not re.fullmatch(r"[A-Z2-7]+=*", value):
            return False
        try:
            base64.b32decode(value, casefold=False)
            pyotp.TOTP(value)
        except Exception:
            return False
        return True

    def _read_secret(self, user) -> Optional[str]:
        """Return a user's plaintext TOTP secret, healing legacy rows.

        Secrets are stored encrypted (see ``encrypt_secret``). Rows enrolled
        before encryption-at-rest was added are plaintext: decryption fails, so
        we treat the stored value as the secret and re-encrypt it in place. The
        surrounding ``get_session()`` commits on clean exit, so the plaintext
        exposure is remediated the first time the secret is read.

        Only values that actually look like a legacy base32 TOTP secret are
        healed; a decrypt failure on anything else is treated as corruption and
        raised, so we never overwrite an unrecoverable secret with garbage.
        """
        stored = user.totp_secret
        if not stored:
            return None
        try:
            return decrypt_private_key(stored, settings.encryption_key)
        except Exception as decrypt_error:
            if not self._is_legacy_plaintext_secret(stored):
                logger.error(
                    "TOTP secret for user %s failed to decrypt and is not valid "
                    "legacy base32; refusing to heal (manual recovery needed).",
                    getattr(user, "id", "?"),
                )
                raise ValueError(
                    "Stored TOTP secret is corrupted (decrypt failed and value "
                    "is not a valid legacy secret)."
                ) from decrypt_error
            # Genuine legacy plaintext secret — re-encrypt in place.
            user.totp_secret = self.encrypt_secret(stored)
            return stored

    def setup_2fa(self, user_id: int) -> Tuple[str, str]:
        """Set up 2FA for a user. Returns (secret, uri)."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if not user:
                raise ValueError("User not found")
            
            # Generate new secret
            secret = self.generate_secret()

            # Store the secret encrypted at rest — never persist the raw seed.
            user.totp_secret = self.encrypt_secret(secret)
            user.two_fa_enabled = True
            
            uri = self.get_totp_uri(secret, user.username or f"user_{user_id}")
            
            return secret, uri
    
    def disable_2fa(self, user_id: int, code: str) -> bool:
        """Disable 2FA for a user (requires valid code)."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if not user or not user.totp_secret:
                return False

            secret = self._read_secret(user)
            if not secret or not self.verify_totp(secret, code):
                return False

            user.totp_secret = None
            user.two_fa_enabled = False
            return True
    
    def is_2fa_enabled(self, user_id: int) -> bool:
        """Check if user has 2FA enabled."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            return user and user.two_fa_enabled and user.totp_secret is not None
    
    def requires_2fa(self, user_id: int, amount_usd: float, threshold: float = None) -> bool:
        """Check if a transaction requires 2FA."""
        if threshold is None:
            threshold = self.get_2fa_threshold(user_id)

        if amount_usd < threshold:
            return False
        
        return self.is_2fa_enabled(user_id)
    
    def verify_transaction(self, user_id: int, code: str) -> bool:
        """Verify 2FA code for a transaction."""
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if not user or not user.totp_secret:
                return False

            secret = self._read_secret(user)
            return bool(secret) and self.verify_totp(secret, code)
    
    # === Simple Code Verification (no TOTP app required) ===
    
    def generate_simple_code(self, user_id: int, action_data: dict = None) -> str:
        """Generate a simple 6-digit verification code."""
        code = str(secrets.randbelow(900000) + 100000)  # 6 digits
        
        self._pending_verifications[user_id] = {
            "code": code,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=self.CODE_VALIDITY_MINUTES),
            "action_data": action_data,
        }
        
        return code
    
    def verify_simple_code(self, user_id: int, code: str) -> Tuple[bool, Optional[dict]]:
        """Verify a simple code. Returns (success, action_data)."""
        pending = self._pending_verifications.get(user_id)
        
        if not pending:
            return False, None
        
        if datetime.now(timezone.utc) > pending["expires_at"]:
            del self._pending_verifications[user_id]
            return False, None
        
        if pending["code"] != code:
            return False, None
        
        action_data = pending["action_data"]
        del self._pending_verifications[user_id]
        
        return True, action_data
    
    def get_2fa_threshold(self, user_id: int) -> float:
        """Get the 2FA threshold for a user."""
        # Could be user-configurable in the future
        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if user and user.two_fa_threshold is not None:
                return float(user.two_fa_threshold)
            return self.DEFAULT_THRESHOLD

    def set_2fa_threshold(self, user_id: int, threshold: float) -> bool:
        """Set custom 2FA threshold for a user. Returns True if persisted."""
        if threshold < 0:
            return False

        with get_session() as session:
            user = session.query(User).filter(User.id == user_id).first()
            if not user:
                return False
            user.two_fa_threshold = int(threshold)
            return True


# Global instance
twofa_service = TwoFactorService()

