"""Tests for the backup-key access guard (R4)."""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest

from bot.services.wallet import _BackupKeyAccessGuard, _key_fingerprint
from bot.utils.rate_limiter import RateLimitExceeded


def test_allows_up_to_burst_then_blocks():
    guard = _BackupKeyAccessGuard(max_burst=3, burst_window_seconds=60.0)
    for _ in range(3):
        guard.check("key-a")  # ok
    with pytest.raises(RateLimitExceeded):
        guard.check("key-a")  # 4th in window → blocked (exfiltration loop)


def test_keys_are_independent():
    guard = _BackupKeyAccessGuard(max_burst=2, burst_window_seconds=60.0)
    guard.check("key-a")
    guard.check("key-a")
    # a different key has its own budget
    guard.check("key-b")
    guard.check("key-b")
    with pytest.raises(RateLimitExceeded):
        guard.check("key-a")


def test_fingerprint_is_stable_and_not_the_key():
    enc = "some-encrypted-ciphertext-blob"
    fp = _key_fingerprint(enc)
    assert fp == _key_fingerprint(enc)  # stable
    assert len(fp) == 16 and enc not in fp  # short hash, not the ciphertext
    assert _key_fingerprint(enc) != _key_fingerprint(enc + "x")
