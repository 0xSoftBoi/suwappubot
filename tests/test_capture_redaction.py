"""Tests for bot/utils/capture_redaction.py — the fail-closed secret screen
that gates whether raw user text is persisted to the data-capture tables.
"""

from bot.utils.capture_redaction import screen_for_secrets

# Real, well-known test vectors (never used on any real chain).
MNEMONIC_12 = (
    "abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon about"
)
MNEMONIC_24 = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon abandon abandon abandon abandon art"
)


def test_12_word_mnemonic_is_unsafe():
    is_unsafe, reason = screen_for_secrets(MNEMONIC_12)
    assert is_unsafe is True
    assert reason is not None


def test_24_word_mnemonic_is_unsafe():
    is_unsafe, reason = screen_for_secrets(MNEMONIC_24)
    assert is_unsafe is True
    assert reason is not None


def test_0x_prefixed_private_key_is_unsafe():
    key = "0x" + "a1b2c3d4" * 8  # 64 hex chars
    is_unsafe, reason = screen_for_secrets(f"here is my key {key} keep it safe")
    assert is_unsafe is True
    assert reason is not None


def test_bare_64_hex_private_key_is_unsafe():
    key = "f" * 64
    is_unsafe, reason = screen_for_secrets(key)
    assert is_unsafe is True
    assert reason is not None


def test_normal_trading_sentence_is_safe():
    is_unsafe, reason = screen_for_secrets("swap 0.5 eth to usdc on base")
    assert is_unsafe is False
    assert reason is None


def test_address_containing_sentence_is_safe():
    # A 40-hex-char EVM address is NOT a secret — must not be flagged.
    is_unsafe, reason = screen_for_secrets(
        "send 1 eth to 0x71C7656EC7ab88b098defB751B7401B5f6d8976 please"
    )
    assert is_unsafe is False
    assert reason is None


def test_solana_style_base58_secret_key_is_unsafe():
    # 88-char base58 blob, shaped like an exported Solana secret key.
    blob = "3" * 88
    is_unsafe, reason = screen_for_secrets(f"my key {blob}")
    assert is_unsafe is True
    assert reason is not None


def test_high_entropy_blob_is_unsafe():
    blob = "aZ9kQ2mN7pR4sT8vW1xY6bC3dF5gH0jL2nP4qS7uV9wX"
    is_unsafe, reason = screen_for_secrets(blob)
    assert is_unsafe is True
    assert reason is not None


def test_empty_string_is_safe():
    is_unsafe, reason = screen_for_secrets("")
    assert is_unsafe is False
    assert reason is None


def test_none_input_is_safe():
    is_unsafe, reason = screen_for_secrets(None)
    assert is_unsafe is False
    assert reason is None


def test_non_string_input_is_unsafe():
    is_unsafe, reason = screen_for_secrets(12345)  # type: ignore[arg-type]
    assert is_unsafe is True
    assert reason is not None


def test_128_hex_solana_keypair_is_unsafe():
    # A hex-encoded ed25519/Solana keypair (128 hex chars) is longer than the
    # \b-bounded 64-char pattern could match mid-run; must still be caught.
    key = "a1b2c3d4" * 16  # 128 hex chars
    is_unsafe, reason = screen_for_secrets(f"here is my keypair {key} keep it safe")
    assert is_unsafe is True
    assert reason is not None


def test_bare_128_hex_key_is_unsafe():
    key = "f" * 128
    is_unsafe, reason = screen_for_secrets(key)
    assert is_unsafe is True
    assert reason is not None


def test_40_hex_evm_address_is_safe():
    # A bare 40-hex-char EVM/Tron address must NOT be flagged as a private key
    # (below the 64-char floor).
    address = "71C7656EC7ab88b098defB751B7401B5f6d89761"
    assert len(address) == 40
    is_unsafe, reason = screen_for_secrets(address)
    assert is_unsafe is False
    assert reason is None
