"""Regression tests for mandatory KMS envelope encryption on hot wallets.

Confirms that hot wallet creation/import refuses to fall back to the legacy
single-master-key Fernet scheme or to the 'dev' mock KMS provider, both of
which would leave real funds protected only by settings.encryption_key.
"""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-0123456789ab")
os.environ.setdefault("DATABASE_URL", "sqlite:///test-hot-wallet.db")

from bot.config.settings import settings
from bot.services.hot_wallet import HotWalletService
from bot.utils.envelope_crypto import (
    SCHEME_KMS_AESGCM_V2,
    SCHEME_LEGACY_FERNET_V1,
)


@pytest.fixture()
def restore_settings():
    saved = (settings.wallet_encryption_scheme, settings.kms_provider)
    yield
    settings.wallet_encryption_scheme, settings.kms_provider = saved


def test_guard_rejects_legacy_scheme(restore_settings):
    svc = HotWalletService()
    settings.wallet_encryption_scheme = SCHEME_LEGACY_FERNET_V1
    settings.kms_provider = "aws"
    with pytest.raises(ValueError):
        svc._require_secure_envelope_encryption()


def test_guard_rejects_dev_provider(restore_settings):
    svc = HotWalletService()
    settings.wallet_encryption_scheme = SCHEME_KMS_AESGCM_V2
    settings.kms_provider = "dev"
    with pytest.raises(ValueError):
        svc._require_secure_envelope_encryption()


def test_guard_allows_v2_with_real_provider(restore_settings):
    svc = HotWalletService()
    settings.wallet_encryption_scheme = SCHEME_KMS_AESGCM_V2
    for provider in ("aws", "gcp", "AWS", "GCP"):
        settings.kms_provider = provider
        # Must not raise.
        svc._require_secure_envelope_encryption()


def test_create_local_wallet_refuses_legacy(restore_settings):
    """Creating a local wallet under legacy/dev config must hard-fail before
    any key is persisted, rather than silently storing a Fernet-only key."""
    svc = HotWalletService()
    settings.wallet_encryption_scheme = SCHEME_LEGACY_FERNET_V1
    settings.kms_provider = "aws"
    with pytest.raises(ValueError):
        svc._create_local_hot_wallet(
            name="t", chain_type="evm",
            is_deposit_wallet=True, is_gas_payer=False,
        )


def test_import_wallet_refuses_dev_provider(restore_settings):
    svc = HotWalletService()
    settings.wallet_encryption_scheme = SCHEME_KMS_AESGCM_V2
    settings.kms_provider = "dev"
    with pytest.raises(ValueError):
        svc.import_hot_wallet(
            name="t", chain_type="evm",
            private_key="0x" + "11" * 32,
            is_deposit_wallet=True, is_gas_payer=False,
        )
