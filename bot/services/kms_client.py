"""
KMS client abstraction for wallet key encryption.

Supports multiple providers:
- dev: Local mock using settings.encryption_key (for development/testing)
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
        
        # Derive a stable Fernet key from the master key for DEK wrapping
        salt = b"suwappu-dev-kms-salt"  # Fixed salt for dev (ok for local only)
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

