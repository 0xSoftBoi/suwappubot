"""
KMS client abstraction for wallet key encryption.

Supports multiple providers:
- dev: Local mock using settings.encryption_key (for development/testing)
- aws: AWS KMS
- gcp: Google Cloud KMS
"""

import os
import base64
import hashlib
import logging
import threading
import time
from abc import ABC, abstractmethod
from collections import deque
from typing import Tuple, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class _KmsDecryptAnomalyMonitor:
    """Anomaly detection for KMS DEK decryption (defense-in-depth).

    The KMS client exposes ``decrypt_data_key`` to the whole process. If the
    application is compromised via RCE, an attacker can iterate over every
    wrapped DEK stored in the DB and decrypt them all — envelope encryption
    provides no protection against code-level compromise. The real mitigation
    lives in KMS infrastructure (IAM key policies, CloudTrail / Cloud Audit
    Logs, Grants); this in-process monitor is a complementary detection layer
    that surfaces the exfiltration *pattern* so external alerting can fire.

    ``decrypt_data_key`` sits on the hot path of *every* signing operation
    (one decrypt per signed transaction; an EVM approve+swap is two, copy
    trading fans out across many followers, sniping fires rapidly on a single
    wallet). Because the legitimate worst-case burst cannot be tightly bounded,
    this monitor is intentionally **detection-only**: it logs loudly but never
    raises, so it can never throttle or break fund movement. It tracks two
    dimensions:

      * global rate — many decrypts across *distinct* wrapped DEKs in a short
        window is the signature of an RCE walking the key table (the stated
        threat); and
      * per-key rate — one wrapped DEK decrypted abnormally often.

    Wrapped DEKs are identified by a truncated SHA-256 of their bytes so the
    monitor never holds key material or ciphertext.
    """

    def __init__(
        self,
        window_seconds: float = 300.0,
        global_anomaly_threshold: int = 200,
        distinct_key_anomaly_threshold: int = 50,
        per_key_anomaly_threshold: int = 50,
    ):
        self.window_seconds = window_seconds
        self.global_anomaly_threshold = global_anomaly_threshold
        self.distinct_key_anomaly_threshold = distinct_key_anomaly_threshold
        self.per_key_anomaly_threshold = per_key_anomaly_threshold
        # (timestamp, key_fingerprint) pairs within the rolling window.
        self._events: deque = deque()
        self._lock = threading.Lock()
        # Throttle repeated anomaly logs so a sustained attack doesn't flood.
        # None means "no alert emitted yet" so the first anomaly always fires.
        self._last_global_alert: Optional[float] = None

    @staticmethod
    def _fingerprint(encrypted_key: bytes) -> str:
        try:
            return hashlib.sha256(bytes(encrypted_key)).hexdigest()[:16]
        except Exception:
            return "?"

    def record(self, encrypted_key: bytes) -> None:
        """Record one DEK decryption and log loudly on anomaly. Never raises."""
        try:
            fp = self._fingerprint(encrypted_key)
            now = time.monotonic()
            with self._lock:
                self._events.append((now, fp))
                window_start = now - self.window_seconds
                while self._events and self._events[0][0] < window_start:
                    self._events.popleft()

                total = len(self._events)
                distinct = len({f for _, f in self._events})
                per_key = sum(1 for _, f in self._events if f == fp)

                anomalous = (
                    total >= self.global_anomaly_threshold
                    or distinct >= self.distinct_key_anomaly_threshold
                    or per_key >= self.per_key_anomaly_threshold
                )
                should_alert = anomalous and (
                    self._last_global_alert is None
                    or (now - self._last_global_alert) > 5.0
                )
                if should_alert:
                    self._last_global_alert = now

            if should_alert:
                logger.error(
                    "ANOMALY: KMS DEK decrypt volume %d (%d distinct keys, "
                    "%d for key %s) within %.0fs — possible key exfiltration "
                    "via compromised application code. This is detection only; "
                    "enforce KMS-side access controls (IAM key policy, "
                    "CloudTrail/Cloud Audit Logs, Grants).",
                    total, distinct, per_key, fp, self.window_seconds,
                )
        except Exception:
            # Detection must never break a decrypt (and thus a signing flow).
            return


# Process-wide monitor for KMS DEK decryption (defense-in-depth, never raises).
_kms_decrypt_monitor = _KmsDecryptAnomalyMonitor()


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
        _kms_decrypt_monitor.record(encrypted_key)
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
        _kms_decrypt_monitor.record(encrypted_key)
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
        _kms_decrypt_monitor.record(encrypted_key)
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

