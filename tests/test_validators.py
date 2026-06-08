"""Tests for bot/utils/validators.py — enterprise security hardening."""
import os
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest
from bot.utils.validators import validate_evm_address, validate_solana_address, EVM_ZERO_ADDRESS


# ---------------------------------------------------------------------------
# EVM address validation
# ---------------------------------------------------------------------------

def test_valid_evm_address():
    assert validate_evm_address("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045") is True


def test_evm_zero_address_rejected():
    assert validate_evm_address(EVM_ZERO_ADDRESS) is False
    # Case-insensitive
    assert validate_evm_address("0x0000000000000000000000000000000000000000") is False
    assert validate_evm_address("0X0000000000000000000000000000000000000000") is False


def test_evm_missing_prefix_rejected():
    assert validate_evm_address("d8dA6BF26964aF9D7eEd9e03E53415D37aA96045") is False


def test_evm_short_address_rejected():
    assert validate_evm_address("0xdead") is False


def test_evm_garbage_rejected():
    assert validate_evm_address("not-an-address") is False
    assert validate_evm_address("") is False


# ---------------------------------------------------------------------------
# Solana address validation
# ---------------------------------------------------------------------------

# A known valid Solana public key (System Program)
VALID_SOLANA = "11111111111111111111111111111111"  # 32 chars — but must be 44 b58 chars
# Real Solana addresses are 44 base58 chars encoding 32 bytes
VALID_SOLANA_44 = "So11111111111111111111111111111111111111112"  # Wrapped SOL mint


def test_valid_solana_address():
    # Wrapped SOL mint — real, publicly known
    assert validate_solana_address("So11111111111111111111111111111111111111112") is True


def test_solana_too_short_rejected():
    # 32 chars is too short — valid b58 but decodes to fewer than 32 bytes
    assert validate_solana_address("11111111111111111111111111111112") is False


def test_solana_too_long_rejected():
    assert validate_solana_address("A" * 45) is False


def test_solana_invalid_base58_rejected():
    # Base58 excludes 0, O, I, l
    assert validate_solana_address("0" * 44) is False


def test_solana_garbage_rejected():
    assert validate_solana_address("") is False
    assert validate_solana_address("not-a-solana-address") is False
