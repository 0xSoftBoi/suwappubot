"""Tests for bot/services/kms_client.py — envelope encryption abstraction.

Covers:
  * DevMockKmsClient / LocalKmsClient envelope roundtrips (generate_data_key ->
    decrypt_data_key, direct encrypt/decrypt), including the AES-256 (32-byte)
    plaintext-DEK assumption that the "kms_aesgcm_v2" scheme in
    bot/utils/envelope_crypto.py depends on.
  * LocalKmsClient's self-contained wrapped-DEK format: nonce(12) || ciphertext+tag.
  * AwsKmsClient with a fully mocked boto3 (boto3 is not installed in this repo's
    test env, so we inject a fake module into sys.modules).
  * KMS failures must RAISE, not silently return None/empty — verified for both
    the direct client and get_kms_client() provider dispatch.
"""

import base64
import os
import sys
import types

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from unittest.mock import MagicMock  # noqa: E402

import pytest  # noqa: E402

from bot.services.kms_client import (  # noqa: E402
    DevMockKmsClient,
    LocalKmsClient,
    AwsKmsClient,
    DataKeyResult,
    get_kms_client,
    reset_kms_client,
)

# ---------------------------------------------------------------------------
# DevMockKmsClient
# ---------------------------------------------------------------------------


def test_dev_mock_generate_and_decrypt_data_key_roundtrip():
    client = DevMockKmsClient("dev-master-key")
    result = client.generate_data_key()

    assert isinstance(result, DataKeyResult)
    assert len(result.plaintext_key) == 32  # AES-256 assumption (kms_aesgcm_v2)
    assert result.encrypted_key != result.plaintext_key

    recovered = client.decrypt_data_key(result.encrypted_key)
    assert recovered == result.plaintext_key


def test_dev_mock_direct_encrypt_decrypt_roundtrip():
    client = DevMockKmsClient("dev-master-key")
    plaintext = b"super-secret-private-key-material"

    ciphertext = client.encrypt(plaintext)
    assert ciphertext != plaintext
    assert client.decrypt(ciphertext) == plaintext


def test_dev_mock_key_id_is_stable():
    client = DevMockKmsClient("dev-master-key")
    assert client.key_id == "dev-local-key"


def test_dev_mock_decrypt_wrong_key_raises():
    client_a = DevMockKmsClient("master-key-a")
    client_b = DevMockKmsClient("master-key-b")
    ciphertext = client_a.encrypt(b"secret")

    with pytest.raises(Exception):
        client_b.decrypt(ciphertext)


# ---------------------------------------------------------------------------
# LocalKmsClient
# ---------------------------------------------------------------------------


def test_local_kms_requires_nonempty_kek():
    with pytest.raises(ValueError):
        LocalKmsClient("")


def test_local_kms_rejects_too_short_kek():
    # < 16 raw bytes after decode should be rejected.
    short_kek = base64.b64encode(os.urandom(8)).decode()
    with pytest.raises(ValueError):
        LocalKmsClient(short_kek)


def test_local_kms_accepts_base64_kek_and_roundtrips():
    kek = base64.b64encode(os.urandom(32)).decode()
    client = LocalKmsClient(kek)
    plaintext = b"hello wallet key"

    ciphertext = client.encrypt(plaintext)
    assert client.decrypt(ciphertext) == plaintext


def test_local_kms_accepts_hex_kek():
    kek = os.urandom(32).hex()
    client = LocalKmsClient(kek)
    plaintext = b"hex-kek-material"

    ciphertext = client.encrypt(plaintext)
    assert client.decrypt(ciphertext) == plaintext


def test_local_kms_wrapped_format_is_nonce_prefixed_and_nondeterministic():
    kek = base64.b64encode(os.urandom(32)).decode()
    client = LocalKmsClient(kek)
    plaintext = b"same-plaintext"

    ct1 = client.encrypt(plaintext)
    ct2 = client.encrypt(plaintext)

    # nonce (12 bytes) || ciphertext+tag (>= 16 bytes for the GCM tag alone)
    assert len(ct1) >= 12 + 16
    # Random nonce each call -> different ciphertexts for identical plaintext.
    assert ct1 != ct2
    # But both still decrypt to the same plaintext.
    assert client.decrypt(ct1) == plaintext
    assert client.decrypt(ct2) == plaintext


def test_local_kms_decrypt_rejects_too_short_ciphertext():
    kek = base64.b64encode(os.urandom(32)).decode()
    client = LocalKmsClient(kek)

    with pytest.raises(ValueError):
        client.decrypt(b"short")


def test_local_kms_generate_data_key_roundtrip_and_length():
    kek = base64.b64encode(os.urandom(32)).decode()
    client = LocalKmsClient(kek)

    result = client.generate_data_key()
    assert len(result.plaintext_key) == 32
    assert client.decrypt_data_key(result.encrypted_key) == result.plaintext_key
    assert result.key_id == "local-v1" == client.key_id


# ---------------------------------------------------------------------------
# AwsKmsClient — boto3 is fully mocked (not installed in this test env)
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_boto3(monkeypatch):
    """Inject a fake `boto3` module with a mock KMS client."""
    fake_kms_client = MagicMock()
    fake_module = types.ModuleType("boto3")
    fake_module.client = MagicMock(return_value=fake_kms_client)
    monkeypatch.setitem(sys.modules, "boto3", fake_module)
    return fake_module, fake_kms_client


def test_aws_kms_generate_data_key_success(fake_boto3):
    _, fake_client = fake_boto3
    fake_client.generate_data_key.return_value = {
        "Plaintext": b"0" * 32,
        "CiphertextBlob": b"wrapped-dek-blob",
    }

    client = AwsKmsClient(key_id="alias/suwappu-wallet-key", region="us-east-1")
    result = client.generate_data_key()

    assert result.plaintext_key == b"0" * 32
    assert result.encrypted_key == b"wrapped-dek-blob"
    assert result.key_id == "alias/suwappu-wallet-key"
    fake_client.generate_data_key.assert_called_once_with(
        KeyId="alias/suwappu-wallet-key", KeySpec="AES_256"
    )


def test_aws_kms_decrypt_data_key_success(fake_boto3):
    _, fake_client = fake_boto3
    fake_client.decrypt.return_value = {"Plaintext": b"1" * 32}

    client = AwsKmsClient(key_id="alias/suwappu-wallet-key")
    plaintext = client.decrypt_data_key(b"wrapped-dek-blob")

    assert plaintext == b"1" * 32
    fake_client.decrypt.assert_called_once_with(
        CiphertextBlob=b"wrapped-dek-blob", KeyId="alias/suwappu-wallet-key"
    )


def test_aws_kms_generate_data_key_failure_propagates(fake_boto3):
    """A KMS outage/failure must RAISE up to the caller, not be swallowed."""
    _, fake_client = fake_boto3
    fake_client.generate_data_key.side_effect = RuntimeError("KMS unavailable")

    client = AwsKmsClient(key_id="alias/suwappu-wallet-key")

    with pytest.raises(RuntimeError, match="KMS unavailable"):
        client.generate_data_key()


def test_aws_kms_decrypt_data_key_failure_propagates(fake_boto3):
    """Decrypt failures (e.g. wrong key, KMS down) must RAISE, not return None."""
    _, fake_client = fake_boto3
    fake_client.decrypt.side_effect = RuntimeError("AccessDeniedException")

    client = AwsKmsClient(key_id="alias/suwappu-wallet-key")

    with pytest.raises(RuntimeError, match="AccessDeniedException"):
        client.decrypt_data_key(b"some-ciphertext")


def test_aws_kms_client_missing_boto3_raises_import_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "boto3", None)  # force ImportError on `import boto3`
    with pytest.raises(ImportError, match="boto3 is required"):
        AwsKmsClient(key_id="alias/whatever")


# ---------------------------------------------------------------------------
# get_kms_client() provider dispatch
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_kms_singleton():
    reset_kms_client()
    yield
    reset_kms_client()


def test_get_kms_client_dev_provider_returns_dev_mock(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "kms_provider", "dev")
    client = get_kms_client()
    assert isinstance(client, DevMockKmsClient)
    # Cached — second call returns the same instance.
    assert get_kms_client() is client


def test_get_kms_client_local_provider_missing_kek_raises(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "kms_provider", "local")
    monkeypatch.setattr(settings, "wallet_master_kek", "")

    with pytest.raises(ValueError, match="wallet_master_kek"):
        get_kms_client()


def test_get_kms_client_unknown_provider_raises(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "kms_provider", "not-a-real-provider")

    with pytest.raises(ValueError, match="Unknown KMS provider"):
        get_kms_client()


def test_reset_kms_client_clears_singleton(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "kms_provider", "dev")
    first = get_kms_client()
    reset_kms_client()
    second = get_kms_client()
    assert first is not second
