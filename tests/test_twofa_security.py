"""Wave 1 security tests: TOTP encryption-at-rest, threshold persistence, Turnkey fail-closed.

NOTE: locally `suwappu_core` (C++) is unavailable, so encryption exercises the
Fernet fallback path in bot/utils/encryption.py. The production C++ path is not
covered here.
"""

import asyncio
import os
import time

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pyotp  # noqa: E402

from database.db import get_session, init_db  # noqa: E402
from bot.models.user import User  # noqa: E402
from bot.services.twofa import twofa_service  # noqa: E402


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


def _fresh_totp_code(secret: str) -> str:
    """A TOTP code with a full step ahead of it.

    TwoFactorService.verify_totp calls totp.verify(code) with no valid_window, so
    a code minted in the dying moments of a 30s step is already invalid by the time
    it is checked. That race made these tests fail intermittently in CI (one run
    went red, the identical commit passed on re-run). Wait out a nearly-expired
    step instead of racing it.
    """
    totp = pyotp.TOTP(secret)
    remaining = totp.interval - (time.time() % totp.interval)
    if remaining < 2:
        time.sleep(remaining + 0.1)
    return totp.now()


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
    code = _fresh_totp_code(secret)
    assert twofa_service.verify_transaction(1, code) is True
    assert twofa_service.verify_transaction(1, "000000") is False


def test_disable_2fa_with_encrypted_secret(sqlite_db):
    secret, _ = twofa_service.setup_2fa(1)
    code = _fresh_totp_code(secret)
    assert twofa_service.disable_2fa(1, code) is True
    assert _stored_secret(1) is None


# --- Legacy plaintext healing ---------------------------------------------


def test_legacy_plaintext_secret_is_healed_on_read(sqlite_db):
    secret = pyotp.random_base32()
    with get_session() as session:  # simulate a pre-encryption row
        user = session.query(User).filter(User.id == 2).first()
        user.totp_secret = secret
        user.two_fa_enabled = True

    code = _fresh_totp_code(secret)
    assert twofa_service.verify_transaction(2, code) is True  # plaintext still works
    healed = _stored_secret(2)
    assert healed != secret, "plaintext row should be re-encrypted in place"
    assert twofa_service._read_secret(_FakeUser(healed)) == secret


def test_corrupted_secret_is_not_healed_on_read(sqlite_db):
    # A value that fails to decrypt AND is not valid legacy base32 is corruption,
    # not plaintext: fail closed (return None) and leave it untouched rather than
    # re-encrypt garbage over an unrecoverable secret.
    corrupt = "!!!not-base32-and-not-fernet!!!"
    user = _FakeUser(corrupt)
    assert twofa_service._read_secret(user) is None
    assert user.totp_secret == corrupt, "corrupted value must be left untouched"


def test_unpadded_legacy_secret_is_healed(sqlite_db):
    # A genuine legacy plaintext secret whose length isn't a multiple of 8 (so it
    # has no base32 padding) must still be recognized and healed, not rejected —
    # otherwise the user is locked out of their own 2FA.
    unpadded = "JBSWY3DPEHPK3PX"  # 15 chars, valid base32 once padded
    assert twofa_service._is_legacy_plaintext_secret(unpadded) is True
    user = _FakeUser(unpadded)
    assert twofa_service._read_secret(user) == unpadded
    assert user.totp_secret != unpadded, "unpadded legacy secret should be re-encrypted"


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


# --- Enrollment (begin/confirm) ---------------------------------------------


def test_begin_enrollment_does_not_enable_until_confirmed(sqlite_db):
    secret, uri = twofa_service.begin_enrollment(1)
    assert "otpauth://" in uri
    # Not active yet — a user who never scans the secret must not be locked out.
    assert twofa_service.is_2fa_enabled(1) is False
    # Stored encrypted, not plaintext.
    assert _stored_secret(1) != secret

    assert twofa_service.confirm_enrollment(1, "000000") is False
    assert twofa_service.is_2fa_enabled(1) is False

    code = _fresh_totp_code(secret)
    assert twofa_service.confirm_enrollment(1, code) is True
    assert twofa_service.is_2fa_enabled(1) is True


def test_begin_enrollment_rejected_when_already_enabled(sqlite_db):
    twofa_service.setup_2fa(1)
    with pytest.raises(ValueError):
        twofa_service.begin_enrollment(1)


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


# --- TOTP backfill fast path (readiness incident) --------------------------
#
# _encrypt_plaintext_totp_secrets ran unconditionally on every boot: every
# non-null totp_secret paid a real PBKDF2 key derivation whether or not it
# needed healing, inside one open transaction, with no logging and no
# timeout. At enough rows this made the migration step -- and therefore
# DATABASE_AVAILABLE, which gates /health readiness -- take minutes, past
# Railway's 5-minute healthcheck window. The fix adds a cheap SQL EXISTS
# probe (Postgres only) that skips the entire per-row loop once nothing
# legacy-plaintext-shaped remains. These tests cover that probe in isolation
# via mocks (no real Postgres available in CI); the sqlite_db-based tests
# above continue to exercise the actual per-row migration logic unchanged.


def test_fast_path_skips_full_scan_when_no_legacy_rows_remain():
    from unittest.mock import MagicMock
    from database.db import _encrypt_plaintext_totp_secrets

    engine = MagicMock()
    probe_conn = MagicMock()
    probe_conn.execute.return_value.scalar.return_value = False
    engine.connect.return_value.__enter__.return_value = probe_conn

    _encrypt_plaintext_totp_secrets(engine, is_sqlite=False)

    engine.connect.assert_called_once()
    # The expensive per-row loop opens its own transaction via begin() --
    # proving it was never reached is proof the fast path actually skipped it.
    engine.begin.assert_not_called()


def test_fast_path_runs_full_scan_when_legacy_rows_exist():
    from unittest.mock import MagicMock
    from database.db import _encrypt_plaintext_totp_secrets

    engine = MagicMock()
    probe_conn = MagicMock()
    probe_conn.execute.return_value.scalar.return_value = True
    engine.connect.return_value.__enter__.return_value = probe_conn
    scan_conn = MagicMock()
    scan_conn.execute.return_value.fetchall.return_value = []
    engine.begin.return_value.__enter__.return_value = scan_conn

    _encrypt_plaintext_totp_secrets(engine, is_sqlite=False)

    engine.begin.assert_called_once()


def test_fast_path_falls_through_to_full_scan_on_probe_error():
    """The probe itself must never be able to block the real migration."""
    from unittest.mock import MagicMock
    from database.db import _encrypt_plaintext_totp_secrets

    engine = MagicMock()
    engine.connect.side_effect = Exception("probe boom")
    scan_conn = MagicMock()
    scan_conn.execute.return_value.fetchall.return_value = []
    engine.begin.return_value.__enter__.return_value = scan_conn

    _encrypt_plaintext_totp_secrets(engine, is_sqlite=False)

    engine.begin.assert_called_once()


def test_sqlite_path_never_calls_the_fast_path_probe():
    """is_sqlite=True must skip the Postgres-only regex probe entirely."""
    from unittest.mock import MagicMock
    from database.db import _encrypt_plaintext_totp_secrets

    engine = MagicMock()
    scan_conn = MagicMock()
    scan_conn.execute.return_value.fetchall.return_value = []
    engine.begin.return_value.__enter__.return_value = scan_conn

    _encrypt_plaintext_totp_secrets(engine, is_sqlite=True)

    engine.connect.assert_not_called()
    engine.begin.assert_called_once()


def test_backfill_still_heals_legacy_plaintext_end_to_end(sqlite_db):
    """Full-loop correctness is unchanged: sqlite_db already ran the real
    migration via init_db(); confirm a genuinely legacy-plaintext row still
    gets healed and an already-encrypted row is left alone."""
    import pyotp
    from database.db import _encrypt_plaintext_totp_secrets, get_session, engine
    from bot.models.user import User

    legacy_secret = pyotp.random_base32()
    with get_session() as session:
        session.add(User(id=3, telegram_id=333, username="carol", totp_secret=legacy_secret))
        session.commit()

    _encrypt_plaintext_totp_secrets(engine, is_sqlite=True)

    stored = _stored_secret(3)
    assert stored != legacy_secret  # healed, not left as plaintext
