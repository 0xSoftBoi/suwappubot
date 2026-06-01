"""Regression tests for wallet.py key-handling hardening.

Covers two confirmed vulnerabilities:
  1. Private key plaintext left in memory after signing (no zeroization).
  2. No rate limiting / anomaly detection on backup key decryption.
"""

import os
import sys

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services import wallet as wallet_module
from bot.services.wallet import (
    WalletService,
    _BackupKeyAccessGuard,
    _zeroize_str,
)
from bot.utils.rate_limiter import RateLimitExceeded


# ---------------------------------------------------------------------------
# Vuln 1: secure zeroization of decrypted private keys
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    sys.implementation.name != "cpython",
    reason="ctypes string zeroization relies on CPython memory layout",
)
def test_zeroize_wipes_unique_ascii_string():
    # Build a fresh, uniquely-owned ASCII secret (avoid interning).
    secret = "".join(chr(0x30 + (i % 10)) for i in range(64))
    assert secret.isascii()
    assert any(c != "\x00" for c in secret)

    _zeroize_str(secret)

    # The backing buffer must now be all NUL bytes.
    assert all(c == "\x00" for c in secret), "private key buffer was not wiped"


def test_zeroize_is_noop_and_safe_on_edge_inputs():
    # Must never raise on None / empty / non-str / non-ascii.
    _zeroize_str(None)
    _zeroize_str("")
    _zeroize_str(b"bytes")  # type: ignore[arg-type]
    _zeroize_str("nón-ascii-key")  # left untouched, no crash


def test_sign_evm_local_zeroizes_key(monkeypatch):
    """_sign_evm_local must wipe the plaintext key it pulled from get_private_key."""
    svc = WalletService()

    # A real, freshly generated EVM key so eth_account signing succeeds.
    from eth_account import Account

    acct = Account.create()
    plaintext = acct.key.hex()  # 0x-prefixed hex, ASCII, uniquely owned here

    captured = {}

    def fake_get_private_key(wallet, auto_migrate=True):
        # Return a *new* string object the signer owns exclusively.
        s = "".join(plaintext)
        captured["key_obj"] = s
        return s

    monkeypatch.setattr(svc, "get_private_key", fake_get_private_key)

    class FakeWallet:
        is_turnkey_wallet = False

    tx = {
        "to": acct.address,
        "value": 0,
        "gas": 21000,
        "maxFeePerGas": 10**9,
        "maxPriorityFeePerGas": 10**9,
        "nonce": 0,
        "chainId": 1,
    }

    raw = svc._sign_evm_local(FakeWallet(), tx)
    assert raw  # signing still works (behavior preserved)

    wiped = captured["key_obj"]
    assert all(c == "\x00" for c in wiped), "decrypted key not zeroized after signing"


# ---------------------------------------------------------------------------
# Vuln 2: rate limiting + anomaly detection on backup key decryption
# ---------------------------------------------------------------------------

def test_backup_guard_blocks_rapid_repeat():
    guard = _BackupKeyAccessGuard(min_interval_seconds=60.0)
    guard.check(wallet_id=1)  # first access OK
    with pytest.raises(RateLimitExceeded):
        guard.check(wallet_id=1)  # immediate second access blocked


def test_backup_guard_isolated_per_wallet():
    guard = _BackupKeyAccessGuard(min_interval_seconds=60.0)
    guard.check(wallet_id=1)
    guard.check(wallet_id=2)  # different wallet not affected


def test_backup_guard_burst_anomaly():
    # No per-access interval, but cap total accesses in the window.
    guard = _BackupKeyAccessGuard(
        min_interval_seconds=0.0, max_burst=3, burst_window_seconds=600.0
    )
    guard.check(1)
    guard.check(1)
    guard.check(1)
    with pytest.raises(RateLimitExceeded):
        guard.check(1)  # 4th within window -> anomaly block


def test_get_backup_private_key_enforces_guard(monkeypatch):
    svc = WalletService()

    # Fresh guard so test order does not matter.
    monkeypatch.setattr(
        wallet_module,
        "_backup_key_guard",
        _BackupKeyAccessGuard(min_interval_seconds=60.0),
    )
    monkeypatch.setattr(
        wallet_module,
        "get_private_key_with_auto_migrate",
        lambda wallet, auto_migrate=False: "deadbeef" * 8,
    )

    class FakeWallet:
        id = 42
        encrypted_private_key = "some-encrypted-blob"

    assert svc.get_backup_private_key(FakeWallet()) == "deadbeef" * 8
    with pytest.raises(RateLimitExceeded):
        svc.get_backup_private_key(FakeWallet())
