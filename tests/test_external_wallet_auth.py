"""Regression coverage for browser EVM + Phantom authentication."""

import re

import base58
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from eth_account import Account
from eth_account.messages import encode_defunct

from bot.services.turnkey_client import (
    _encode_is_valid_signature_call,
    _unwrap_erc6492_signature,
    generate_auth_challenge,
    generate_solana_auth_challenge,
    verify_auth_signature,
    verify_solana_auth_signature,
    verify_wallet_auth_signature,
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


# --- Smart-contract accounts (EIP-1271 / ERC-6492) -------------------------
#
# Coinbase Smart Wallet, Safe, and every passkey/4337 account return a
# signature that is NOT a 65-byte ECDSA tuple, so `Account.recover_message`
# raises "Unexpected recoverable signature length" and the old code 401'd every
# connect attempt with "Invalid signature or expired challenge".

EIP1271_MAGIC = "0x1626ba7e" + "0" * 56
SMART_WALLET = "0x1234567890AbcdEF1234567890aBcdef12345678"
# Shape of a real Coinbase Smart Wallet passkey signature: 608 bytes, not 65.
SMART_WALLET_SIG = "0x" + ("ab" * 608)


def _challenge_for(address: str, chain_id: int = 8453) -> dict:
    return generate_auth_challenge(
        address,
        domain="terminal.suwappu.bot",
        uri="https://terminal.suwappu.bot",
        chain_id=chain_id,
    )


def test_challenge_binds_the_connected_chain_id():
    challenge = _challenge_for(SMART_WALLET, chain_id=8453)
    assert "Chain ID: 8453" in challenge["challenge"]
    # A bogus chain id must not land in the signed message.
    assert "Chain ID: 1\n" in _challenge_for(SMART_WALLET, chain_id="nonsense")["challenge"]


async def test_eoa_still_verifies_through_the_async_entrypoint():
    account = Account.create()
    challenge = _challenge_for(account.address, chain_id=1)
    signed = Account.sign_message(encode_defunct(text=challenge["challenge"]), account.key)

    assert await verify_wallet_auth_signature(
        account.address, signed.signature.hex(), challenge["nonce"]
    )
    # Single use: the challenge is consumed.
    assert not await verify_wallet_auth_signature(
        account.address, signed.signature.hex(), challenge["nonce"]
    )


async def test_smart_account_signature_verifies_via_eip1271(monkeypatch):
    """A 608-byte smart-account signature is accepted when the account says so."""
    calls = []

    async def fake_eth_call(rpc_url, to, data):
        calls.append((rpc_url, to, data))
        return EIP1271_MAGIC

    monkeypatch.setattr("bot.services.turnkey_client._eth_call", fake_eth_call)
    monkeypatch.setattr(
        "bot.services.rpc_manager.rpc_manager.get_rpc_url",
        lambda chain: f"https://rpc.test/{chain}",
    )

    challenge = _challenge_for(SMART_WALLET, chain_id=8453)
    assert await verify_wallet_auth_signature(SMART_WALLET, SMART_WALLET_SIG, challenge["nonce"])
    # Verified on the chain the wallet said it was connected to, not mainnet.
    assert calls and calls[0][0] == "https://rpc.test/base"
    from eth_utils import to_checksum_address

    assert calls[0][1] == to_checksum_address(SMART_WALLET)
    assert calls[0][2].startswith("0x1626ba7e")

    # Consumed — a replay of the same signature is rejected.
    assert not await verify_wallet_auth_signature(
        SMART_WALLET, SMART_WALLET_SIG, challenge["nonce"]
    )


async def test_smart_account_signature_rejected_when_contract_declines(monkeypatch):
    async def fake_eth_call(rpc_url, to, data):
        return "0x" + "00" * 32

    monkeypatch.setattr("bot.services.turnkey_client._eth_call", fake_eth_call)
    monkeypatch.setattr(
        "bot.services.rpc_manager.rpc_manager.get_rpc_url",
        lambda chain: f"https://rpc.test/{chain}",
    )

    challenge = _challenge_for(SMART_WALLET, chain_id=8453)
    assert not await verify_wallet_auth_signature(
        SMART_WALLET, SMART_WALLET_SIG, challenge["nonce"]
    )


async def test_smart_account_probes_fallback_chains_without_a_chain_id(monkeypatch):
    """Legacy clients send no chainId — probe the majors until one validates."""
    seen = []

    async def fake_eth_call(rpc_url, to, data):
        seen.append(rpc_url)
        return EIP1271_MAGIC if rpc_url.endswith("/optimism") else "0x"

    monkeypatch.setattr("bot.services.turnkey_client._eth_call", fake_eth_call)
    monkeypatch.setattr(
        "bot.services.rpc_manager.rpc_manager.get_rpc_url",
        lambda chain: f"https://rpc.test/{chain}",
    )

    challenge = generate_auth_challenge(SMART_WALLET, domain="terminal.suwappu.bot")
    assert await verify_wallet_auth_signature(SMART_WALLET, SMART_WALLET_SIG, challenge["nonce"])
    assert any(url.endswith("/optimism") for url in seen)


async def test_smart_account_cannot_borrow_another_addresss_challenge(monkeypatch):
    async def fake_eth_call(rpc_url, to, data):
        return EIP1271_MAGIC

    monkeypatch.setattr("bot.services.turnkey_client._eth_call", fake_eth_call)
    monkeypatch.setattr(
        "bot.services.rpc_manager.rpc_manager.get_rpc_url",
        lambda chain: f"https://rpc.test/{chain}",
    )

    challenge = _challenge_for(SMART_WALLET, chain_id=8453)
    attacker = "0x000000000000000000000000000000000000dEaD"
    assert not await verify_wallet_auth_signature(attacker, SMART_WALLET_SIG, challenge["nonce"])


def test_is_valid_signature_calldata_matches_abi_encoding():
    from eth_abi import encode as abi_encode

    message_hash = bytes(range(32))
    signature = bytes(range(70))  # not a multiple of 32 — exercises the padding
    expected = "0x1626ba7e" + abi_encode(["bytes32", "bytes"], [message_hash, signature]).hex()
    assert _encode_is_valid_signature_call(message_hash, signature) == expected


def test_erc6492_wrapper_is_unwrapped_to_the_inner_signature():
    from eth_abi import encode as abi_encode

    inner = bytes(range(65))
    wrapped = abi_encode(
        ["address", "bytes", "bytes"],
        ["0x1234567890AbcdEF1234567890aBcdef12345678", b"\x01\x02", inner],
    ) + bytes.fromhex("6492" * 16)
    assert _unwrap_erc6492_signature(wrapped) == inner
    # A plain signature passes through untouched.
    assert _unwrap_erc6492_signature(inner) == inner
