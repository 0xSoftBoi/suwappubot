"""
KMS client abstraction for wallet key encryption.

Supports multiple providers:
- dev: Local mock using settings.encryption_key (for development/testing)
- local: Production env-var KEK (settings.wallet_master_kek) — no external service
- aws: AWS KMS
- gcp: Google Cloud KMS
"""

import os
import base64
import logging
from abc import ABC, abstractmethod
from typing import Tuple, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DataKeyResult:
    """Result of generating a data encryption key."""
    plaintext_key: bytes  # 32-byte AES key (clear this after use!)
    encrypted_key: bytes  # KMS-encrypted version of the key
    key_id: str  # Which KMS key was used


class KmsClientBase(ABC):
    """Abstract base class for KMS clients."""
    
    @abstractmethod
    def generate_data_key(self) -> DataKeyResult:
        """
        Generate a new data encryption key (DEK).
        
        Returns:
            DataKeyResult with plaintext and encrypted key bytes.
        """
        pass
    
    @abstractmethod
    def decrypt_data_key(self, encrypted_key: bytes) -> bytes:
        """
        Decrypt an encrypted data key.
        
        Args:
            encrypted_key: The KMS-encrypted DEK
            
        Returns:
            Plaintext DEK bytes (32 bytes for AES-256)
        """
        pass
    
    @abstractmethod
    def encrypt(self, plaintext: bytes) -> bytes:
        """
        Directly encrypt data with the KEK (for small payloads).
        
        Args:
            plaintext: Data to encrypt
            
        Returns:
            Ciphertext bytes
        """
        pass
    
    @abstractmethod
    def decrypt(self, ciphertext: bytes) -> bytes:
        """
        Directly decrypt data encrypted with the KEK.
        
        Args:
            ciphertext: Encrypted data
            
        Returns:
            Plaintext bytes
        """
        pass
    
    @property
    @abstractmethod
    def key_id(self) -> str:
        """Return the current KMS key identifier."""
        pass


class DevMockKmsClient(KmsClientBase):
    """
    Development/testing KMS client that uses local encryption.
    
    Uses PBKDF2 + Fernet under the hood, backed by settings.encryption_key.
    This provides the same interface as real KMS but runs locally.
    """
    
    def __init__(self, master_key: str):
        """
        Initialize with a master key (typically settings.encryption_key).
        
        Args:
            master_key: Base64-encoded or hex master key
        """
        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        
        self._master_key = master_key
        self._key_id_str = "dev-local-key"
        
        # Derive a Fernet key from the master key for DEK wrapping
        # Use a salt derived from the master key itself to avoid a hardcoded constant
        salt = hashes.Hash(hashes.SHA256())
        salt.update(b"suwappu-kms-salt:" + master_key.encode())
        salt = salt.finalize()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        derived = kdf.derive(master_key.encode())
        self._fernet = Fernet(base64.urlsafe_b64encode(derived))
    
    @property
    def key_id(self) -> str:
        return self._key_id_str
    
    def generate_data_key(self) -> DataKeyResult:
        """Generate a random DEK and encrypt it with our local Fernet key."""
        # Generate random 32-byte DEK
        plaintext_key = os.urandom(32)
        
        # Encrypt DEK with Fernet (acts as our "KMS")
        encrypted_key = self._fernet.encrypt(plaintext_key)
        
        return DataKeyResult(
            plaintext_key=plaintext_key,
            encrypted_key=encrypted_key,
            key_id=self._key_id_str,
        )
    
    def decrypt_data_key(self, encrypted_key: bytes) -> bytes:
        """Decrypt a DEK that was encrypted with our local Fernet key."""
        return self._fernet.decrypt(encrypted_key)
    
    def encrypt(self, plaintext: bytes) -> bytes:
        """Direct encryption with local Fernet."""
        return self._fernet.encrypt(plaintext)
    
    def decrypt(self, ciphertext: bytes) -> bytes:
        """Direct decryption with local Fernet."""
        return self._fernet.decrypt(ciphertext)


class LocalKmsClient(KmsClientBase):
    """
    Production-grade local KMS client using an env-var KEK (no external service).

    Wraps/unwraps the 32-byte DEK with AES-256-GCM. The wrapping key is derived
    from a dedicated high-entropy master KEK (settings.wallet_master_kek) via
    HKDF-SHA256 with a fixed salt + info, so wraps are reproducible across deploys.

    Trust model: the KEK lives in process memory + the platform secret store
    (e.g. Railway), NOT an HSM. This is an accepted trade for the lower-sensitivity
    tier (fallback/backup keys + OAuth tokens) because primary wallet custody is
    Turnkey's TEE. Do NOT reuse the KEK across environments.

    Wrapped-DEK format is self-contained: nonce(12 bytes) || AES-GCM ciphertext+tag.
    """

    # Fixed derivation parameters — changing these invalidates all existing wraps.
    _HKDF_SALT = b"suwappu-local-kms-salt:v1"
    _HKDF_INFO = b"suwappu-local-kms-kek-v1"

    def __init__(self, master_kek: str):
        """
        Initialize with a high-entropy master KEK.

        Args:
            master_kek: base64- (preferred) or hex-encoded key material (>= 32 bytes).
        """
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF

        if not master_kek:
            raise ValueError("LocalKmsClient requires a non-empty master_kek")

        raw = self._decode_kek(master_kek)
        if len(raw) < 16:
            raise ValueError(
                "wallet_master_kek is too short; expected >= 32 bytes of entropy "
                "(generate with: python3 -c \"import os,base64;print(base64.b64encode(os.urandom(32)).decode())\")"
            )

        # Derive a stable 32-byte AES-256 wrapping key from the master KEK.
        self._wrapping_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=self._HKDF_SALT,
            info=self._HKDF_INFO,
        ).derive(raw)
        self._key_id_str = "local-v1"

    @staticmethod
    def _decode_kek(master_kek: str) -> bytes:
        """Decode a base64 or hex KEK string into raw bytes."""
        s = master_kek.strip()
        # Try base64 (standard + urlsafe) first, then hex.
        for decoder in (base64.b64decode, base64.urlsafe_b64decode):
            try:
                decoded = decoder(s + "=" * (-len(s) % 4))
                if len(decoded) >= 16:
                    return decoded
            except Exception:
                pass
        try:
            return bytes.fromhex(s)
        except ValueError:
            # Last resort: use the raw UTF-8 bytes (still HKDF-stretched).
            return s.encode("utf-8")

    @property
    def key_id(self) -> str:
        return self._key_id_str

    def encrypt(self, plaintext: bytes) -> bytes:
        """Wrap: AES-256-GCM with a random nonce; output is nonce || ciphertext+tag."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce = os.urandom(12)
        ciphertext = AESGCM(self._wrapping_key).encrypt(nonce, plaintext, None)
        return nonce + ciphertext

    def decrypt(self, ciphertext: bytes) -> bytes:
        """Unwrap: split the 12-byte nonce prefix, then AES-256-GCM decrypt."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if len(ciphertext) < 13:
            raise ValueError("Local KMS ciphertext too short to contain nonce + tag")
        nonce, ct = ciphertext[:12], ciphertext[12:]
        return AESGCM(self._wrapping_key).decrypt(nonce, ct, None)

    def generate_data_key(self) -> DataKeyResult:
        """Generate a random 32-byte DEK and wrap it with the local KEK."""
        plaintext_key = os.urandom(32)
        encrypted_key = self.encrypt(plaintext_key)
        return DataKeyResult(
            plaintext_key=plaintext_key,
            encrypted_key=encrypted_key,
            key_id=self._key_id_str,
        )

    def decrypt_data_key(self, encrypted_key: bytes) -> bytes:
        """Unwrap a DEK previously wrapped with this KEK."""
        return self.decrypt(encrypted_key)


class AwsKmsClient(KmsClientBase):
    """
    AWS KMS client for production envelope encryption.

    Requires boto3 and appropriate IAM permissions.
    """
    
    def __init__(self, key_id: str, region: Optional[str] = None):
        """
        Initialize AWS KMS client.
        
        Args:
            key_id: KMS key ARN or alias (e.g., 'alias/suwappu-wallet-key')
            region: AWS region (defaults to AWS_DEFAULT_REGION or us-east-1)
        """
        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 is required for AWS KMS. Install with: pip install boto3")
        
        self._key_id_str = key_id
        self._region = region or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        self._client = boto3.client("kms", region_name=self._region)
    
    @property
    def key_id(self) -> str:
        return self._key_id_str
    
    def generate_data_key(self) -> DataKeyResult:
        """Generate a DEK using AWS KMS GenerateDataKey."""
        response = self._client.generate_data_key(
            KeyId=self._key_id_str,
            KeySpec="AES_256",
        )
        
        return DataKeyResult(
            plaintext_key=response["Plaintext"],
            encrypted_key=response["CiphertextBlob"],
            key_id=self._key_id_str,
        )
    
    def decrypt_data_key(self, encrypted_key: bytes) -> bytes:
        """Decrypt a DEK using AWS KMS Decrypt."""
        response = self._client.decrypt(
            CiphertextBlob=encrypted_key,
            KeyId=self._key_id_str,
        )
        return response["Plaintext"]
    
    def encrypt(self, plaintext: bytes) -> bytes:
        """Direct encryption with AWS KMS (for small payloads only)."""
        response = self._client.encrypt(
            KeyId=self._key_id_str,
            Plaintext=plaintext,
        )
        return response["CiphertextBlob"]
    
    def decrypt(self, ciphertext: bytes) -> bytes:
        """Direct decryption with AWS KMS."""
        response = self._client.decrypt(
            CiphertextBlob=ciphertext,
            KeyId=self._key_id_str,
        )
        return response["Plaintext"]


class GcpKmsClient(KmsClientBase):
    """
    Google Cloud KMS client for production envelope encryption.
    
    Requires google-cloud-kms and appropriate IAM permissions.
    """
    
    def __init__(
        self,
        project_id: str,
        location: str,
        keyring: str,
        key_id: str,
    ):
        """
        Initialize GCP KMS client.
        
        Args:
            project_id: GCP project ID
            location: KMS location (e.g., 'global', 'us-east1')
            keyring: KMS keyring name
            key_id: Key name within the keyring
        """
        try:
            from google.cloud import kms
        except ImportError:
            raise ImportError(
                "google-cloud-kms is required for GCP KMS. "
                "Install with: pip install google-cloud-kms"
            )
        
        self._client = kms.KeyManagementServiceClient()
        self._key_name = self._client.crypto_key_path(
            project_id, location, keyring, key_id
        )
        self._key_id_str = self._key_name
    
    @property
    def key_id(self) -> str:
        return self._key_id_str
    
    def generate_data_key(self) -> DataKeyResult:
        """
        GCP KMS doesn't have GenerateDataKey, so we generate locally
        and encrypt with the KEK.
        """
        # Generate random 32-byte DEK locally
        plaintext_key = os.urandom(32)
        
        # Encrypt with GCP KMS
        encrypted_key = self.encrypt(plaintext_key)
        
        return DataKeyResult(
            plaintext_key=plaintext_key,
            encrypted_key=encrypted_key,
            key_id=self._key_id_str,
        )
    
    def decrypt_data_key(self, encrypted_key: bytes) -> bytes:
        """Decrypt a DEK using GCP KMS."""
        return self.decrypt(encrypted_key)
    
    def encrypt(self, plaintext: bytes) -> bytes:
        """Encrypt with GCP KMS."""
        from google.cloud import kms
        
        response = self._client.encrypt(
            request={"name": self._key_name, "plaintext": plaintext}
        )
        return response.ciphertext
    
    def decrypt(self, ciphertext: bytes) -> bytes:
        """Decrypt with GCP KMS."""
        response = self._client.decrypt(
            request={"name": self._key_name, "ciphertext": ciphertext}
        )
        return response.plaintext


# Global KMS client instance (initialized lazily)
_kms_client: Optional[KmsClientBase] = None


def get_kms_client() -> KmsClientBase:
    """
    Get the configured KMS client instance.
    
    Uses settings to determine which provider to use.
    """
    global _kms_client
    
    if _kms_client is not None:
        return _kms_client
    
    from bot.config.settings import settings
    
    provider = settings.kms_provider.lower()
    
    if provider == "dev":
        logger.info("Using DevMockKmsClient (local encryption)")
        _kms_client = DevMockKmsClient(settings.encryption_key)

    elif provider == "local":
        if not settings.wallet_master_kek:
            raise ValueError(
                "Local KMS requires wallet_master_kek (env WALLET_MASTER_KEK) to be set"
            )
        logger.info("Using LocalKmsClient (env-var KEK)")
        _kms_client = LocalKmsClient(settings.wallet_master_kek)

    elif provider == "aws":
        if not settings.kms_key_id:
            raise ValueError("AWS KMS requires kms_key_id to be set")
        logger.info(f"Using AwsKmsClient with key {settings.kms_key_id}")
        _kms_client = AwsKmsClient(
            key_id=settings.kms_key_id,
            region=settings.kms_region,
        )
    
    elif provider == "gcp":
        if not all([settings.gcp_project_id, settings.gcp_kms_keyring, settings.kms_key_id]):
            raise ValueError(
                "GCP KMS requires gcp_project_id, gcp_kms_keyring, and kms_key_id"
            )
        logger.info(f"Using GcpKmsClient with key {settings.kms_key_id}")
        _kms_client = GcpKmsClient(
            project_id=settings.gcp_project_id,
            location=settings.gcp_kms_location,
            keyring=settings.gcp_kms_keyring,
            key_id=settings.kms_key_id,
        )
    
    else:
        raise ValueError(f"Unknown KMS provider: {provider}")
    
    return _kms_client


def reset_kms_client() -> None:
    """Reset the KMS client (useful for testing)."""
    global _kms_client
    _kms_client = None

