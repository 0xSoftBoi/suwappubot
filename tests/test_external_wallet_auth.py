"""Regression coverage for browser EVM + Phantom authentication."""

import re

import base58
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from eth_account import Account
from eth_account.messages import encode_defunct

from bot.services.turnkey_client import (
    generate_auth_challenge,
    generate_solana_auth_challenge,
    verify_auth_signature,
    verify_solana_auth_signature,
)


def test_evm_challenge_is_origin_bound_and_one_time():
    account = Account.create()
    challenge = generate_auth_challenge(
        account.address,
        domain="terminal.suwappu.bot",
        uri="https://terminal.suwappu.bot",
    )

    assert challenge["challenge"].startswith(
        f"terminal.suwappu.bot wants you to sign in with your Ethereum account:\n{account.address}"
    )
    assert "URI: https://terminal.suwappu.bot" in challenge["challenge"]
    assert re.fullmatch(r"[A-Za-z0-9]{8,}", challenge["nonce"])
    assert "+00:00Z" not in challenge["challenge"]

    signed = Account.sign_message(
        encode_defunct(text=challenge["challenge"]),
        account.key,
    )
    assert verify_auth_signature(account.address, signed.signature.hex(), challenge["nonce"])
    assert not verify_auth_signature(account.address, signed.signature.hex(), challenge["nonce"])


def test_phantom_ed25519_challenge_verifies_without_pynacl():
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    address = base58.b58encode(public_key).decode("ascii")
    challenge = generate_solana_auth_challenge(
        address,
        domain="terminal.suwappu.bot",
        uri="https://terminal.suwappu.bot",
    )

    assert re.fullmatch(r"[A-Za-z0-9]{8,}", challenge["nonce"])
    assert "+00:00Z" not in challenge["challenge"]
    signature = private_key.sign(challenge["challenge"].encode("utf-8"))
    signature_b58 = base58.b58encode(signature).decode("ascii")

    assert verify_solana_auth_signature(address, signature_b58, challenge["nonce"])
    assert not verify_solana_auth_signature(address, signature_b58, challenge["nonce"])
