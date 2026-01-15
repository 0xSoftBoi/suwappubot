"""
Unit tests for KMS envelope encryption (v2).

Tests:
- Encrypt/decrypt roundtrip
- Dev mock KMS client
- Migration from legacy to v2
- Tamper detection (AES-GCM auth failure)
"""

import pytest
import base64
import os
from unittest.mock import patch, MagicMock

from bot.services.kms_client import (
    DevMockKmsClient,
    DataKeyResult,
    get_kms_client,
    reset_kms_client,
)
from bot.utils.envelope_crypto import (
    encrypt_private_key_v2,
    decrypt_private_key_v2,
    encode_for_db,
    decode_from_db,
    decrypt_wallet_key,
    migrate_to_v2,
    SCHEME_LEGACY_FERNET_V1,
    SCHEME_KMS_AESGCM_V2,
    EncryptedWalletKey,
    zeroize,
)
from bot.utils.encryption import encrypt_private_key


class TestDevMockKmsClient:
    """Tests for the local development KMS mock."""
    
    def setup_method(self):
        """Reset KMS client before each test."""
        reset_kms_client()
    
    def test_generate_data_key(self):
        """Test data key generation."""
        client = DevMockKmsClient("test-master-key-12345")
        result = client.generate_data_key()
        
        assert isinstance(result, DataKeyResult)
        assert len(result.plaintext_key) == 32  # 256-bit key
        assert len(result.encrypted_key) > 0
        assert result.key_id == "dev-local-key"
    
    def test_decrypt_data_key_roundtrip(self):
        """Test that we can decrypt generated data keys."""
        client = DevMockKmsClient("test-master-key-12345")
        result = client.generate_data_key()
        
        decrypted = client.decrypt_data_key(result.encrypted_key)
        assert decrypted == result.plaintext_key
    
    def test_encrypt_decrypt_direct(self):
        """Test direct encryption/decryption."""
        client = DevMockKmsClient("test-master-key-12345")
        plaintext = b"secret data"
        
        ciphertext = client.encrypt(plaintext)
        decrypted = client.decrypt(ciphertext)
        
        assert decrypted == plaintext
    
    def test_different_master_keys_produce_different_results(self):
        """Test that different master keys produce different results."""
        client1 = DevMockKmsClient("master-key-1")
        client2 = DevMockKmsClient("master-key-2")
        
        result1 = client1.generate_data_key()
        result2 = client2.generate_data_key()
        
        # DEKs should be different (random)
        assert result1.plaintext_key != result2.plaintext_key


class TestEnvelopeEncryption:
    """Tests for envelope encryption utilities."""
    
    def setup_method(self):
        """Reset KMS client before each test."""
        reset_kms_client()
    
    @patch("bot.services.kms_client.get_kms_client")
    def test_encrypt_decrypt_roundtrip(self, mock_get_client):
        """Test private key encryption and decryption roundtrip."""
        mock_client = DevMockKmsClient("test-key")
        mock_get_client.return_value = mock_client
        
        # Test with EVM-style private key
        private_key = "0x" + os.urandom(32).hex()
        
        encrypted = encrypt_private_key_v2(private_key, kms_client=mock_client)
        
        assert encrypted.scheme == SCHEME_KMS_AESGCM_V2
        assert len(encrypted.nonce) == 12
        assert len(encrypted.wrapped_dek) > 0
        assert encrypted.kms_key_id == "dev-local-key"
        
        decrypted = decrypt_private_key_v2(encrypted, kms_client=mock_client)
        assert decrypted == private_key
    
    @patch("bot.services.kms_client.get_kms_client")
    def test_encrypt_decrypt_solana_key(self, mock_get_client):
        """Test encryption of Solana-style private key (base58)."""
        mock_client = DevMockKmsClient("test-key")
        mock_get_client.return_value = mock_client
        
        # Base58-encoded key (like Solana)
        private_key = "5J3mBbAH58cERPLfr3nJPz8VTKsQ4rZaW9B1rEvWF8a3Bce3"
        
        encrypted = encrypt_private_key_v2(private_key, kms_client=mock_client)
        decrypted = decrypt_private_key_v2(encrypted, kms_client=mock_client)
        
        assert decrypted == private_key
    
    @patch("bot.services.kms_client.get_kms_client")
    def test_tamper_detection(self, mock_get_client):
        """Test that tampering with ciphertext is detected."""
        mock_client = DevMockKmsClient("test-key")
        mock_get_client.return_value = mock_client
        
        private_key = "0xdeadbeef" + "0" * 56
        encrypted = encrypt_private_key_v2(private_key, kms_client=mock_client)
        
        # Tamper with ciphertext
        tampered_ciphertext = bytearray(encrypted.ciphertext)
        tampered_ciphertext[0] ^= 0xFF  # Flip bits
        encrypted.ciphertext = bytes(tampered_ciphertext)
        
        # Should raise due to authentication failure
        with pytest.raises(Exception):
            decrypt_private_key_v2(encrypted, kms_client=mock_client)
    
    @patch("bot.services.kms_client.get_kms_client")
    def test_tamper_nonce_detection(self, mock_get_client):
        """Test that tampering with nonce is detected."""
        mock_client = DevMockKmsClient("test-key")
        mock_get_client.return_value = mock_client
        
        private_key = "0xdeadbeef" + "0" * 56
        encrypted = encrypt_private_key_v2(private_key, kms_client=mock_client)
        
        # Tamper with nonce
        tampered_nonce = bytearray(encrypted.nonce)
        tampered_nonce[0] ^= 0xFF
        encrypted.nonce = bytes(tampered_nonce)
        
        # Should raise due to authentication failure
        with pytest.raises(Exception):
            decrypt_private_key_v2(encrypted, kms_client=mock_client)


class TestDatabaseEncoding:
    """Tests for database field encoding/decoding."""
    
    def setup_method(self):
        """Reset KMS client before each test."""
        reset_kms_client()
    
    @patch("bot.services.kms_client.get_kms_client")
    def test_encode_decode_roundtrip(self, mock_get_client):
        """Test encoding to DB fields and back."""
        mock_client = DevMockKmsClient("test-key")
        mock_get_client.return_value = mock_client
        
        private_key = "0x" + "ab" * 32
        encrypted = encrypt_private_key_v2(private_key, kms_client=mock_client)
        
        # Encode to DB format
        db_fields = encode_for_db(encrypted)
        
        assert "encrypted_private_key" in db_fields
        assert db_fields["encryption_scheme"] == SCHEME_KMS_AESGCM_V2
        assert "kms_wrapped_dek" in db_fields
        assert "aesgcm_nonce" in db_fields
        assert "kms_key_id" in db_fields
        
        # All binary fields should be base64 encoded
        base64.b64decode(db_fields["encrypted_private_key"])  # Should not raise
        base64.b64decode(db_fields["kms_wrapped_dek"])
        base64.b64decode(db_fields["aesgcm_nonce"])
        
        # Decode back
        decoded = decode_from_db(
            encrypted_private_key=db_fields["encrypted_private_key"],
            encryption_scheme=db_fields["encryption_scheme"],
            kms_wrapped_dek=db_fields["kms_wrapped_dek"],
            aesgcm_nonce=db_fields["aesgcm_nonce"],
            kms_key_id=db_fields["kms_key_id"],
            key_version=db_fields["key_version"],
        )
        
        # Decrypt should work
        decrypted = decrypt_private_key_v2(decoded, kms_client=mock_client)
        assert decrypted == private_key


class TestMigration:
    """Tests for legacy to v2 migration."""
    
    def setup_method(self):
        """Reset KMS client before each test."""
        reset_kms_client()
    
    def test_decrypt_legacy_key(self):
        """Test decrypting a legacy Fernet-encrypted key."""
        # Use the actual settings encryption_key from conftest fixture
        from bot.config.settings import settings
        
        private_key = "0x" + "de" * 32
        
        # Encrypt with legacy method
        legacy_encrypted = encrypt_private_key(private_key, settings.encryption_key)
        
        # Should be able to decrypt with unified function
        decrypted = decrypt_wallet_key(
            encrypted_private_key=legacy_encrypted,
            encryption_scheme=SCHEME_LEGACY_FERNET_V1,
        )
        
        assert decrypted == private_key
    
    def test_migrate_legacy_to_v2(self):
        """Test migration from legacy to v2."""
        from bot.config.settings import settings
        
        reset_kms_client()
        mock_client = DevMockKmsClient(settings.encryption_key)
        
        private_key = "0x" + "ef" * 32
        
        # Encrypt with legacy method
        legacy_encrypted = encrypt_private_key(private_key, settings.encryption_key)
        
        # Patch get_kms_client at the source module
        with patch("bot.services.kms_client.get_kms_client", return_value=mock_client):
            # Migrate to v2 - since envelope_crypto imports from kms_client,
            # patching at kms_client module level is sufficient
            new_fields = migrate_to_v2(
                encrypted_private_key=legacy_encrypted,
                encryption_scheme=SCHEME_LEGACY_FERNET_V1,
            )
        
        assert new_fields is not None
        assert new_fields["encryption_scheme"] == SCHEME_KMS_AESGCM_V2
        assert new_fields["kms_wrapped_dek"] is not None
        assert new_fields["aesgcm_nonce"] is not None
        
        # Should be able to decrypt with v2 using the same mock client
        with patch("bot.services.kms_client.get_kms_client", return_value=mock_client):
            decrypted = decrypt_wallet_key(
                encrypted_private_key=new_fields["encrypted_private_key"],
                encryption_scheme=new_fields["encryption_scheme"],
                kms_wrapped_dek=new_fields["kms_wrapped_dek"],
                aesgcm_nonce=new_fields["aesgcm_nonce"],
                kms_key_id=new_fields["kms_key_id"],
                key_version=new_fields["key_version"],
            )
        
        assert decrypted == private_key
    
    @patch("bot.services.kms_client.get_kms_client")
    def test_migrate_v2_returns_none(self, mock_get_client):
        """Test that migrating an already v2 key returns None."""
        mock_client = DevMockKmsClient("test-key")
        mock_get_client.return_value = mock_client
        
        private_key = "0x" + "ab" * 32
        encrypted = encrypt_private_key_v2(private_key, kms_client=mock_client)
        db_fields = encode_for_db(encrypted)
        
        # Attempt migration
        result = migrate_to_v2(
            encrypted_private_key=db_fields["encrypted_private_key"],
            encryption_scheme=db_fields["encryption_scheme"],
            kms_wrapped_dek=db_fields["kms_wrapped_dek"],
            aesgcm_nonce=db_fields["aesgcm_nonce"],
            kms_key_id=db_fields["kms_key_id"],
        )
        
        # Should return None since already v2
        assert result is None


class TestZeroization:
    """Tests for memory zeroization helpers."""
    
    def test_zeroize_bytearray(self):
        """Test zeroizing a bytearray."""
        data = bytearray(b"secret data")
        zeroize(data)
        
        assert all(b == 0 for b in data)
    
    def test_zeroize_none(self):
        """Test that zeroize handles None gracefully."""
        zeroize(None)  # Should not raise
    
    def test_zeroize_empty(self):
        """Test that zeroize handles empty bytearray."""
        data = bytearray()
        zeroize(data)  # Should not raise


class TestKmsClientFactory:
    """Tests for KMS client factory function."""
    
    def setup_method(self):
        """Reset KMS client before each test."""
        reset_kms_client()
    
    def test_get_dev_client(self):
        """Test getting dev mock client with default settings."""
        # Default settings use "dev" provider
        from bot.config.settings import settings
        reset_kms_client()
        
        # Our test env uses dev provider by default
        if settings.kms_provider == "dev":
            client = get_kms_client()
            assert isinstance(client, DevMockKmsClient)
    
    def test_invalid_provider(self):
        """Test invalid KMS provider raises error."""
        from bot.config.settings import settings
        reset_kms_client()
        
        # Temporarily modify settings (patch at object level)
        original = settings.kms_provider
        try:
            object.__setattr__(settings, "kms_provider", "invalid")
            with pytest.raises(ValueError, match="Unknown KMS provider"):
                get_kms_client()
        finally:
            object.__setattr__(settings, "kms_provider", original)
            reset_kms_client()
    
    def test_aws_without_key_id_raises(self):
        """Test AWS KMS without key_id raises error."""
        from bot.config.settings import settings
        reset_kms_client()
        
        original_provider = settings.kms_provider
        original_key_id = settings.kms_key_id
        try:
            object.__setattr__(settings, "kms_provider", "aws")
            object.__setattr__(settings, "kms_key_id", None)
            with pytest.raises(ValueError, match="kms_key_id"):
                get_kms_client()
        finally:
            object.__setattr__(settings, "kms_provider", original_provider)
            object.__setattr__(settings, "kms_key_id", original_key_id)
            reset_kms_client()
    
    def test_gcp_without_project_raises(self):
        """Test GCP KMS without project_id raises error."""
        from bot.config.settings import settings
        reset_kms_client()
        
        original_provider = settings.kms_provider
        original_project = settings.gcp_project_id
        original_keyring = settings.gcp_kms_keyring
        original_key_id = settings.kms_key_id
        try:
            object.__setattr__(settings, "kms_provider", "gcp")
            object.__setattr__(settings, "gcp_project_id", None)
            object.__setattr__(settings, "gcp_kms_keyring", "ring")
            object.__setattr__(settings, "kms_key_id", "key")
            with pytest.raises(ValueError, match="gcp_project_id"):
                get_kms_client()
        finally:
            object.__setattr__(settings, "kms_provider", original_provider)
            object.__setattr__(settings, "gcp_project_id", original_project)
            object.__setattr__(settings, "gcp_kms_keyring", original_keyring)
            object.__setattr__(settings, "kms_key_id", original_key_id)
            reset_kms_client()

