"""Regression tests for custodial withdrawal hardening.

Covers:
- Strict EIP-55 address validation (rejects typos / bad checksum / bad format).
- Whitelist enforcement (opt-in per chain).

These tests import the handler module, which depends on python-telegram-bot.
If that dependency is unavailable the whole module is skipped.
"""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

custodial = pytest.importorskip("bot.handlers.custodial")
from datetime import datetime, timedelta  # noqa: E402

from database.db import get_session, init_db  # noqa: E402
from bot.models.security import WithdrawalWhitelist  # noqa: E402


# A real, correctly-checksummed EVM address (vitalik.eth).
VALID_CHECKSUMMED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"


@pytest.fixture()
def sqlite_db(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'custodial-sec.db'}"
    assert init_db(database_url)
    yield


def test_normalize_accepts_checksummed():
    assert custodial._normalize_evm_address(VALID_CHECKSUMMED) == VALID_CHECKSUMMED


def test_normalize_accepts_all_lowercase_and_checksums_it():
    out = custodial._normalize_evm_address(VALID_CHECKSUMMED.lower())
    assert out == VALID_CHECKSUMMED


def test_normalize_rejects_bad_checksum_mixed_case():
    # Flip the case of a single character to break the EIP-55 checksum.
    addr = list(VALID_CHECKSUMMED)
    for i, ch in enumerate(addr):
        if ch.isalpha():
            addr[i] = ch.lower() if ch.isupper() else ch.upper()
            break
    typo = "".join(addr)
    assert typo != VALID_CHECKSUMMED
    with pytest.raises(ValueError):
        custodial._normalize_evm_address(typo)


def test_normalize_rejects_bad_length():
    with pytest.raises(ValueError):
        custodial._normalize_evm_address("0x1234")


def test_normalize_rejects_non_hex():
    with pytest.raises(ValueError):
        custodial._normalize_evm_address("0x" + "z" * 40)


def test_normalize_rejects_missing_prefix():
    with pytest.raises(ValueError):
        custodial._normalize_evm_address(VALID_CHECKSUMMED[2:])


def test_whitelist_allows_when_not_configured(sqlite_db):
    allowed, _ = custodial._check_withdrawal_whitelist(1, "ethereum", VALID_CHECKSUMMED)
    assert allowed is True


def test_whitelist_blocks_non_whitelisted_address(sqlite_db):
    with get_session() as session:
        session.add(WithdrawalWhitelist(
            user_id=1, chain="ethereum",
            address="0x000000000000000000000000000000000000dEaD",
            is_active=True, cooldown_until=None,
        ))
    allowed, err = custodial._check_withdrawal_whitelist(1, "ethereum", VALID_CHECKSUMMED)
    assert allowed is False
    assert "whitelist" in err.lower()


def test_whitelist_allows_whitelisted_address(sqlite_db):
    with get_session() as session:
        session.add(WithdrawalWhitelist(
            user_id=1, chain="ethereum",
            address=VALID_CHECKSUMMED, is_active=True, cooldown_until=None,
        ))
    allowed, _ = custodial._check_withdrawal_whitelist(1, "ethereum", VALID_CHECKSUMMED)
    assert allowed is True


def test_whitelist_blocks_during_cooldown(sqlite_db):
    with get_session() as session:
        session.add(WithdrawalWhitelist(
            user_id=1, chain="ethereum",
            address=VALID_CHECKSUMMED, is_active=True,
            cooldown_until=datetime.utcnow() + timedelta(hours=1),
        ))
    allowed, err = custodial._check_withdrawal_whitelist(1, "ethereum", VALID_CHECKSUMMED)
    assert allowed is False
    assert "cooldown" in err.lower()
