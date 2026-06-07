"""Wave 1 security tests: TOTP encryption-at-rest, threshold persistence, Turnkey fail-closed.

NOTE: locally `suwappu_core` (C++) is unavailable, so encryption exercises the
Fernet fallback path in bot/utils/encryption.py. The production C++ path is not
covered here.
"""

import asyncio
import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pyotp

from database.db import get_session, init_db
from bot.models.user import User
from bot.services.twofa import twofa_service


@pytest.fixture()
def sqlite_db(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'twofa.db'}")
    with get_session() as session:
        session.add(User(id=1, telegram_id=111, username="alice"))
        session.add(User(id=2, telegram_id=222, username="bob"))
    yield


def _stored_secret(user_id: int) -> str:
    with get_session() as session:
        return session.query(User).filter(User.id == user_id).first().totp_secret


# --- Encryption at rest ---------------------------------------------------

def test_setup_2fa_stores_ciphertext_not_plaintext(sqlite_db):
    secret, _uri = twofa_service.setup_2fa(1)
    stored = _stored_secret(1)
    assert stored != secret, "raw TOTP seed must never be persisted"
    assert len(stored) > len(secret)
    # The stored value must decrypt back to the original secret.
    assert twofa_service._read_secret(_FakeUser(stored)) == secret


def test_verify_transaction_roundtrip(sqlite_db):
    secret, _ = twofa_service.setup_2fa(1)
    code = pyotp.TOTP(secret).now()
    assert twofa_service.verify_transaction(1, code) is True
    assert twofa_service.verify_transaction(1, "000000") is False


def test_disable_2fa_with_encrypted_secret(sqlite_db):
    secret, _ = twofa_service.setup_2fa(1)
    code = pyotp.TOTP(secret).now()
    assert twofa_service.disable_2fa(1, code) is True
    assert _stored_secret(1) is None


# --- Legacy plaintext healing ---------------------------------------------

def test_legacy_plaintext_secret_is_healed_on_read(sqlite_db):
    secret = pyotp.random_base32()
    with get_session() as session:  # simulate a pre-encryption row
        user = session.query(User).filter(User.id == 2).first()
        user.totp_secret = secret
        user.two_fa_enabled = True

    code = pyotp.TOTP(secret).now()
    assert twofa_service.verify_transaction(2, code) is True  # plaintext still works
    healed = _stored_secret(2)
    assert healed != secret, "plaintext row should be re-encrypted in place"
    assert twofa_service._read_secret(_FakeUser(healed)) == secret


def test_corrupted_secret_is_not_healed_on_read(sqlite_db):
    # A value that fails to decrypt AND is not valid legacy base32 is corruption,
    # not plaintext: it must raise rather than be re-encrypted (which would
    # overwrite an unrecoverable secret with garbage).
    corrupt = "!!!not-base32-and-not-fernet!!!"
    user = _FakeUser(corrupt)
    with pytest.raises(ValueError):
        twofa_service._read_secret(user)
    assert user.totp_secret == corrupt, "corrupted value must be left untouched"


# --- Threshold persistence + enforcement ----------------------------------

def test_threshold_set_get_roundtrip(sqlite_db):
    assert twofa_service.set_2fa_threshold(1, 250) is True
    assert twofa_service.get_2fa_threshold(1) == 250.0


def test_set_threshold_rejects_negative_and_missing_user(sqlite_db):
    assert twofa_service.set_2fa_threshold(1, -5) is False
    assert twofa_service.set_2fa_threshold(999, 100) is False


def test_requires_2fa_uses_persisted_threshold(sqlite_db):
    # Enable 2FA and set a custom $250 threshold.
    twofa_service.setup_2fa(1)
    twofa_service.set_2fa_threshold(1, 250)
    # Below custom threshold -> no 2FA; at/above -> required.
    assert twofa_service.requires_2fa(1, amount_usd=100) is False
    assert twofa_service.requires_2fa(1, amount_usd=300) is True


# --- DB backfill migration -------------------------------------------------

def test_backfill_encrypts_plaintext_rows(sqlite_db):
    import database.db as db
    from database.db import _encrypt_plaintext_totp_secrets
    from bot.utils.encryption import decrypt_private_key

    plain = pyotp.random_base32()
    with get_session() as session:
        session.query(User).filter(User.id == 1).first().totp_secret = plain

    _encrypt_plaintext_totp_secrets(db.engine, is_sqlite=True)

    stored = _stored_secret(1)
    assert stored != plain
    assert decrypt_private_key(stored, os.environ["ENCRYPTION_KEY"]) == plain

    # Idempotent: a second run leaves the already-encrypted value untouched.
    _encrypt_plaintext_totp_secrets(db.engine, is_sqlite=True)
    assert _stored_secret(1) == stored


def test_backfill_skips_corrupted_rows(sqlite_db):
    import database.db as db
    from database.db import _encrypt_plaintext_totp_secrets

    corrupt = "!!!corrupted-ciphertext!!!"
    with get_session() as session:
        session.query(User).filter(User.id == 1).first().totp_secret = corrupt

    # Backfill must not re-encrypt a value that isn't valid legacy base32.
    _encrypt_plaintext_totp_secrets(db.engine, is_sqlite=True)
    assert _stored_secret(1) == corrupt, "corrupted row must be skipped, not mangled"


# --- Turnkey fail-closed ---------------------------------------------------

def test_turnkey_import_private_key_fails_closed():
    from bot.services.turnkey_client import TurnkeyClient
    client = TurnkeyClient.__new__(TurnkeyClient)  # avoid __init__ creds
    with pytest.raises(NotImplementedError):
        asyncio.run(client.import_private_key("0xabc", "k", "CURVE_SECP256K1"))


class _FakeUser:
    """Minimal stand-in so _read_secret can decrypt without a DB write-back."""
    def __init__(self, totp_secret):
        self.totp_secret = totp_secret
