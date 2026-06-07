"""EIP-712 signing for HyperLiquid L1 actions (order / cancel / updateLeverage).

HyperLiquid authenticates exchange requests with an EIP-712 signature over a
"phantom agent" whose ``connectionId`` is the keccak hash of the msgpack-encoded
action plus the nonce (and optional vault address / expiry). This mirrors the
canonical scheme in ``hyperliquid-python-sdk`` (hyperliquid.utils.signing); the
test suite asserts byte-for-byte parity against that SDK.

Implemented here (rather than depending on the SDK at runtime) to match the
project's hand-rolled HyperLiquid client and keep the dependency surface small.
"""

from typing import Optional

import msgpack
from eth_account import Account
from eth_utils import keccak, to_hex
from eth_account.messages import encode_typed_data


def _address_to_bytes(address: str) -> bytes:
    return bytes.fromhex(address[2:] if address.startswith("0x") else address)


def action_hash(
    action: dict,
    vault_address: Optional[str],
    nonce: int,
    expires_after: Optional[int] = None,
) -> bytes:
    """Compute the ``connectionId`` hash for an L1 action."""
    data = msgpack.packb(action)
    data += nonce.to_bytes(8, "big")
    if vault_address is None:
        data += b"\x00"
    else:
        data += b"\x01"
        data += _address_to_bytes(vault_address)
    if expires_after is not None:
        data += b"\x00"
        data += expires_after.to_bytes(8, "big")
    return keccak(data)


def _l1_payload(phantom_agent: dict) -> dict:
    return {
        "domain": {
            "chainId": 1337,
            "name": "Exchange",
            "verifyingContract": "0x0000000000000000000000000000000000000000",
            "version": "1",
        },
        "types": {
            "Agent": [
                {"name": "source", "type": "string"},
                {"name": "connectionId", "type": "bytes32"},
            ],
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
        },
        "primaryType": "Agent",
        "message": phantom_agent,
    }


def sign_l1_action(
    private_key: str,
    action: dict,
    vault_address: Optional[str],
    nonce: int,
    is_mainnet: bool = True,
    expires_after: Optional[int] = None,
) -> dict:
    """Sign an L1 action and return the ``{"r","s","v"}`` signature HyperLiquid expects.

    Args:
        private_key: The account's EVM private key (hex, with or without 0x).
        action: The action dict (already in the exact shape sent in the request body).
        vault_address: Vault/subaccount address, or None for the main account.
        nonce: Request nonce (milliseconds since epoch).
        is_mainnet: True for api.hyperliquid.xyz, False for testnet.
        expires_after: Optional action expiry (ms); None for standard actions.
    """
    account = Account.from_key(private_key)
    hash_ = action_hash(action, vault_address, nonce, expires_after)
    phantom_agent = {"source": "a" if is_mainnet else "b", "connectionId": hash_}
    structured_data = encode_typed_data(full_message=_l1_payload(phantom_agent))
    signed = account.sign_message(structured_data)
    return {"r": to_hex(signed["r"]), "s": to_hex(signed["s"]), "v": signed["v"]}
