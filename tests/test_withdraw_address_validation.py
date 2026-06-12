"""Tests for custodial.validate_withdraw_address — per-chain destination format.

The audit added this guard so an EVM 0x address pasted as a Solana/TRON
destination (or vice versa) is rejected before the irreversible send, rather
than burning funds to a wrong-format address.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.handlers.custodial import validate_withdraw_address

EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # vitalik.eth, EIP-55
SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"  # 44-char base58 pubkey
TRON = "TJRyWwFs9wTFGZg3JbrVriizg4ZGN59LLM"  # 34-char base58check, starts 'T'


@pytest.mark.parametrize("chain", ["base", "ethereum", "arbitrum", "BASE", ""])
def test_evm_accepts_valid_0x(chain):
    assert validate_withdraw_address(chain, EVM) is True


def test_evm_rejects_wrong_length():
    assert validate_withdraw_address("base", "0x1234") is False
    assert validate_withdraw_address("base", "0x" + "d" * 41) is False


def test_evm_rejects_non_hex():
    assert validate_withdraw_address("base", "0x" + "z" * 40) is False


def test_evm_rejects_missing_prefix():
    assert validate_withdraw_address("base", "d" * 42) is False


def test_solana_accepts_valid():
    assert validate_withdraw_address("solana", SOL) is True


def test_solana_rejects_evm_address():
    # The exact cross-chain mistake this guard exists to stop.
    assert validate_withdraw_address("solana", EVM) is False


def test_solana_rejects_short():
    assert validate_withdraw_address("solana", "abc") is False


def test_solana_rejects_non_base58():
    # '0' and 'O' and 'l' are not in the base58 alphabet.
    assert validate_withdraw_address("solana", "0" * 40) is False


@pytest.mark.parametrize("chain", ["tron", "trx", "TRON"])
def test_tron_accepts_valid(chain):
    assert validate_withdraw_address(chain, TRON) is True


def test_tron_rejects_non_t_prefix():
    # Strip the leading 'T' -> still base58 but wrong prefix/length.
    assert validate_withdraw_address("tron", TRON[1:]) is False


def test_tron_rejects_evm_address():
    assert validate_withdraw_address("tron", EVM) is False


def test_empty_and_none_rejected():
    assert validate_withdraw_address("base", "") is False
    assert validate_withdraw_address("base", None) is False
    assert validate_withdraw_address("solana", None) is False


def test_whitespace_is_trimmed():
    assert validate_withdraw_address("base", f"  {EVM}  ") is True
