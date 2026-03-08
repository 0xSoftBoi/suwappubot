"""
Tests for wallet encryption key mismatch detection.

Pure crypto tests with no DB dependency. Validates the root cause of the
production incident where a user's encryption key was lost.
"""

import pytest
from cryptography.fernet import InvalidToken

from bot.services.kms_client import DevMockKmsClient
from bot.utils.envelope_crypto import (
    encrypt_private_key_v2,
    decrypt_private_key_v2,
    decrypt_wallet_key,
    encode_for_db,
    decode_from_db,
    EncryptedWalletKey,
    SCHEME_KMS_AESGCM_V2,
    SCHEME_LEGACY_FERNET_V1,
)


# Two different master keys to simulate mismatch
KMS_A = DevMockKmsClient(master_key="a" * 64)
KMS_B = DevMockKmsClient(master_key="b" * 64)

TEST_PRIVATE_KEY = "0x" + "ab" * 32


class TestV2EncryptDecryptRoundtrip:
    """encrypt -> decrypt with the same key works."""

    def test_roundtrip(self):
        encrypted = encrypt_private_key_v2(TEST_PRIVATE_KEY, kms_client=KMS_A)
        decrypted = decrypt_private_key_v2(encrypted, kms_client=KMS_A)
        assert decrypted == TEST_PRIVATE_KEY


class TestV2WrongKmsKeyRaises:
    """encrypt with key A, decrypt with key B -> InvalidToken."""

    def test_wrong_key(self):
        encrypted = encrypt_private_key_v2(TEST_PRIVATE_KEY, kms_client=KMS_A)
        with pytest.raises(InvalidToken):
            decrypt_private_key_v2(encrypted, kms_client=KMS_B)


class TestV2TamperedWrappedDekRaises:
    """Modified kms_wrapped_dek -> exception, not garbled data."""

    def test_tampered_dek(self):
        encrypted = encrypt_private_key_v2(TEST_PRIVATE_KEY, kms_client=KMS_A)

        # Tamper with the wrapped DEK
        tampered_dek = bytearray(encrypted.wrapped_dek)
        tampered_dek[0] ^= 0xFF
        encrypted_tampered = EncryptedWalletKey(
            scheme=encrypted.scheme,
            ciphertext=encrypted.ciphertext,
            nonce=encrypted.nonce,
            wrapped_dek=bytes(tampered_dek),
            kms_key_id=encrypted.kms_key_id,
            key_version=encrypted.key_version,
        )

        with pytest.raises(Exception):
            decrypt_private_key_v2(encrypted_tampered, kms_client=KMS_A)


class TestLegacyWrongKeyRaises:
    """Legacy Fernet encrypt/decrypt mismatch -> InvalidToken."""

    def test_legacy_mismatch(self):
        from bot.utils.encryption import encrypt_private_key, decrypt_private_key

        encrypted = encrypt_private_key(TEST_PRIVATE_KEY, "correct_key_here")
        with pytest.raises(Exception):
            decrypt_private_key(encrypted, "wrong_key_here")


class TestDecryptWalletKeyPropagatesError:
    """decrypt_wallet_key() does NOT swallow errors."""

    def test_v2_error_propagates(self):
        # Encrypt with KMS_A, then try to decrypt via decrypt_wallet_key with KMS_B as default
        encrypted = encrypt_private_key_v2(TEST_PRIVATE_KEY, kms_client=KMS_A)
        db_fields = encode_for_db(encrypted)

        from unittest.mock import patch
        from bot.services import kms_client as kms_mod

        # Patch the global KMS client to return KMS_B (wrong key)
        with patch.object(kms_mod, "_kms_client", KMS_B):
            with pytest.raises(InvalidToken):
                decrypt_wallet_key(
                    encrypted_private_key=db_fields["encrypted_private_key"],
                    encryption_scheme=db_fields["encryption_scheme"],
                    kms_wrapped_dek=db_fields["kms_wrapped_dek"],
                    aesgcm_nonce=db_fields["aesgcm_nonce"],
                    kms_key_id=db_fields["kms_key_id"],
                    key_version=db_fields["key_version"],
                )


class TestMissingV2FieldsRaisesValueError:
    """kms_wrapped_dek=None with v2 scheme -> ValueError."""

    def test_missing_dek(self):
        with pytest.raises(ValueError, match="Missing required fields"):
            decode_from_db(
                encrypted_private_key="somedata",
                encryption_scheme=SCHEME_KMS_AESGCM_V2,
                kms_wrapped_dek=None,
                aesgcm_nonce=None,
                kms_key_id=None,
            )

    def test_missing_nonce_only(self):
        with pytest.raises(ValueError, match="Missing required fields"):
            decode_from_db(
                encrypted_private_key="somedata",
                encryption_scheme=SCHEME_KMS_AESGCM_V2,
                kms_wrapped_dek="c29tZQ==",
                aesgcm_nonce=None,
                kms_key_id="dev-local-key",
            )
