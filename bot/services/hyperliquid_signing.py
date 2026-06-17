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


# --- User-signed actions (approveBuilderFee, approveAgent, usdSend, …) -------
#
# Unlike L1 actions (which sign a phantom-agent hash on chainId 1337), user-signed
# actions sign the action fields directly under the "HyperliquidSignTransaction"
# EIP-712 domain. The reference SDK fixes ``signatureChainId`` to ``0x66eee``
# (421614) and derives the domain ``chainId`` from it; ``hyperliquidChain``
# ("Mainnet"/"Testnet") is what actually selects the environment. This mirrors
# ``hyperliquid.utils.signing.sign_user_signed_action`` in the reference SDK; the
# test suite asserts byte-for-byte parity.

# signatureChainId for user-signed actions, as a hex string (matches the SDK).
USER_SIGNED_CHAIN_ID = "0x66eee"

_USD_SEND_SIGN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "destination", "type": "string"},
    {"name": "amount", "type": "string"},
    {"name": "time", "type": "uint64"},
]

_APPROVE_BUILDER_FEE_SIGN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "maxFeeRate", "type": "string"},
    {"name": "builder", "type": "address"},
    {"name": "nonce", "type": "uint64"},
]


def _user_signed_payload(primary_type: str, payload_types: list[dict], action: dict) -> dict:
    return {
        "domain": {
            "name": "HyperliquidSignTransaction",
            "version": "1",
            # Derived from signatureChainId so the signed domain matches what the
            # backend reconstructs from the action body (reference-SDK behaviour).
            "chainId": int(action["signatureChainId"], 16),
            "verifyingContract": "0x0000000000000000000000000000000000000000",
        },
        "types": {
            primary_type: payload_types,
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
        },
        "primaryType": primary_type,
        "message": action,
    }


def sign_user_signed_action(
    private_key: str,
    action: dict,
    payload_types: list[dict],
    primary_type: str,
    is_mainnet: bool = True,
) -> dict:
    """Sign a user-signed action and return the ``{"r","s","v"}`` signature.

    ``action`` is mutated to include ``signatureChainId`` and ``hyperliquidChain``
    (as the reference SDK does), so the exact dict passed here is what must be sent
    in the request body alongside the returned signature.
    """
    account = Account.from_key(private_key)
    action["signatureChainId"] = USER_SIGNED_CHAIN_ID
    action["hyperliquidChain"] = "Mainnet" if is_mainnet else "Testnet"
    structured_data = encode_typed_data(
        full_message=_user_signed_payload(primary_type, payload_types, action)
    )
    signed = account.sign_message(structured_data)
    return {"r": to_hex(signed["r"]), "s": to_hex(signed["s"]), "v": signed["v"]}


def sign_approve_builder_fee(
    private_key: str,
    builder: str,
    max_fee_rate: str,
    nonce: int,
    is_mainnet: bool = True,
) -> tuple[dict, dict]:
    """Build and sign an ``approveBuilderFee`` action.

    A user must approve a builder (and a maximum fee rate) before that builder may
    attach fees to the user's orders. This is signed once per (user, builder) pair.

    Args:
        private_key: The user's EVM private key.
        builder: The builder's address (lowercased before signing).
        max_fee_rate: Max approved fee as a percent string, e.g. ``"0.1%"``.
        nonce: Request nonce (ms since epoch); reused as the top-level nonce.
        is_mainnet: True for api.hyperliquid.xyz, False for testnet.

    Returns:
        ``(action, signature)`` — send ``{"action": action, "nonce": nonce,
        "signature": signature}`` to the /exchange endpoint.
    """
    action = {
        "type": "approveBuilderFee",
        "maxFeeRate": max_fee_rate,
        "builder": builder.lower(),
        "nonce": nonce,
    }
    signature = sign_user_signed_action(
        private_key,
        action,
        _APPROVE_BUILDER_FEE_SIGN_TYPES,
        "HyperliquidTransaction:ApproveBuilderFee",
        is_mainnet,
    )
    return action, signature


# --- Staking actions (user-signed) -------------------------------------------
#
# Moving HYPE between the spot and staking balances (cDeposit / cWithdraw) and
# delegating it to a validator (tokenDelegate) are user-signed actions under the
# same HyperliquidTransaction domain as approveBuilderFee. Field order in the
# EIP-712 type lists below mirrors hyperliquid-python-sdk exactly.

_TOKEN_DELEGATE_SIGN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "validator", "type": "address"},
    {"name": "wei", "type": "uint64"},
    {"name": "isUndelegate", "type": "bool"},
    {"name": "nonce", "type": "uint64"},
]

_C_DEPOSIT_SIGN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "wei", "type": "uint64"},
    {"name": "nonce", "type": "uint64"},
]

_C_WITHDRAW_SIGN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "wei", "type": "uint64"},
    {"name": "nonce", "type": "uint64"},
]


def sign_token_delegate(
    private_key: str,
    validator: str,
    wei: int,
    is_undelegate: bool,
    nonce: int,
    is_mainnet: bool = True,
) -> tuple[dict, dict]:
    """Build and sign a ``tokenDelegate`` action (delegate/undelegate HYPE).

    Args:
        validator: Validator address (42-char hex).
        wei: Amount of HYPE in wei (1 HYPE = 1e8 wei on staking).
        is_undelegate: False to delegate, True to undelegate.
    """
    action = {
        "type": "tokenDelegate",
        "validator": validator,
        "wei": int(wei),
        "isUndelegate": is_undelegate,
        "nonce": nonce,
    }
    signature = sign_user_signed_action(
        private_key,
        action,
        _TOKEN_DELEGATE_SIGN_TYPES,
        "HyperliquidTransaction:TokenDelegate",
        is_mainnet,
    )
    return action, signature


def sign_staking_transfer(
    private_key: str,
    wei: int,
    nonce: int,
    is_deposit: bool,
    is_mainnet: bool = True,
) -> tuple[dict, dict]:
    """Build and sign a ``cDeposit`` (spot→staking) or ``cWithdraw`` (staking→spot) action.

    Args:
        wei: Amount of HYPE in wei (1 HYPE = 1e8 wei).
        is_deposit: True for cDeposit (into staking balance), False for cWithdraw.
    """
    action = {
        "type": "cDeposit" if is_deposit else "cWithdraw",
        "wei": int(wei),
        "nonce": nonce,
    }
    signature = sign_user_signed_action(
        private_key,
        action,
        _C_DEPOSIT_SIGN_TYPES if is_deposit else _C_WITHDRAW_SIGN_TYPES,
        "HyperliquidTransaction:CDeposit" if is_deposit else "HyperliquidTransaction:CWithdraw",
        is_mainnet,
    )
    return action, signature
