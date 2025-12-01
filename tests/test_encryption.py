"""Tests for encryption utilities."""

import pytest
from bot.utils.encryption import encrypt_private_key, decrypt_private_key


class TestEncryption:
    """Tests for private key encryption/decryption."""
    
    @pytest.fixture
    def encryption_key(self):
        """Get test encryption key."""
        return "a" * 64  # 32 bytes as hex
    
    @pytest.fixture
    def sample_private_key(self):
        """Get sample private key."""
        return "1234567890abcdef" * 4  # 64 char hex string
    
    def test_encrypt_decrypt_roundtrip(self, encryption_key, sample_private_key):
        """Test encrypt then decrypt returns original."""
        encrypted = encrypt_private_key(sample_private_key, encryption_key)
        decrypted = decrypt_private_key(encrypted, encryption_key)
        
        assert decrypted == sample_private_key
    
    def test_encrypted_differs_from_original(self, encryption_key, sample_private_key):
        """Test encrypted value differs from original."""
        encrypted = encrypt_private_key(sample_private_key, encryption_key)
        
        assert encrypted != sample_private_key
    
    def test_different_keys_produce_different_output(self, sample_private_key):
        """Test different encryption keys produce different ciphertext."""
        key1 = "a" * 64
        key2 = "b" * 64
        
        encrypted1 = encrypt_private_key(sample_private_key, key1)
        encrypted2 = encrypt_private_key(sample_private_key, key2)
        
        assert encrypted1 != encrypted2
    
    def test_wrong_key_fails_decryption(self, sample_private_key):
        """Test decryption with wrong key fails."""
        key1 = "a" * 64
        key2 = "b" * 64
        
        encrypted = encrypt_private_key(sample_private_key, key1)
        
        with pytest.raises(Exception):
            decrypt_private_key(encrypted, key2)
    
    def test_same_key_produces_same_decryption(self, encryption_key, sample_private_key):
        """Test same key always decrypts correctly."""
        encrypted = encrypt_private_key(sample_private_key, encryption_key)
        
        # Decrypt multiple times
        for _ in range(5):
            decrypted = decrypt_private_key(encrypted, encryption_key)
            assert decrypted == sample_private_key

