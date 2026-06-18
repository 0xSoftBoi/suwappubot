"""Turnkey-enclave signing for Tempo type-0x76 transactions.

pytempo's ``TempoTransaction.sign()`` needs a raw private key, but production
wallets — both users AND the fee-payer hot wallet — are Turnkey-managed and expose
no raw key. This adapter signs the *pre-computed* Tempo signing hashes (sender
``0x76`` / fee-payer ``0x78``, from ``tx.get_signing_hash(...)``) inside the Turnkey
enclave via ``sign_raw_payload(HASH_FUNCTION_NO_OP)`` and returns a pytempo
``Signature``, which the caller attaches with ``attrs.evolve()`` instead of a
key-based ``.sign()``.

No raw key ever leaves Turnkey — strictly more secure than the local-key path.
"""

import logging

from pytempo.models import Signature, SECP256K1_N, SECP256K1_HALF_N

logger = logging.getLogger(__name__)


def _to_int(label: str, hex_val: str) -> int:
    if not hex_val:
        raise ValueError(f"Turnkey signRawPayload missing '{label}'")
    return int(hex_val[2:] if hex_val.startswith("0x") else hex_val, 16)


def normalize_vrs(r: int, s: int, v: int) -> Signature:
    """Turn raw secp256k1 (r, s, v) into a pytempo-canonical ``Signature``.

    pytempo's ``Signature`` enforces low-s (``0 < s <= n/2``) and ``v in
    {0,1,27,28}``. Turnkey returns ``v`` as a bare recovery id (0..3); we map it
    to 27/28 (matching pytempo's own eth_account-derived signatures), then apply
    low-s normalization (flip ``s`` and the recovery parity if ``s > n/2``).
    """
    if v < 27:
        v += 27
    if v not in (27, 28):
        raise ValueError(f"unexpected recovery v after mapping: {v}")

    if s > SECP256K1_HALF_N:
        s = SECP256K1_N - s
        v = 27 if v == 28 else 28  # flip parity to match the flipped s

    return Signature(r=r, s=s, v=v)


async def sign_tempo_hash(address: str, hash32: bytes) -> Signature:
    """Sign a 32-byte Tempo signing hash via Turnkey; return a pytempo Signature.

    Args:
        address: The signer's address (sender or fee payer) — Turnkey ``signWith``.
        hash32: The 32-byte keccak hash from ``tx.get_signing_hash(...)``.
    """
    if len(hash32) != 32:
        raise ValueError(f"hash must be 32 bytes, got {len(hash32)}")

    from bot.services.turnkey_client import get_turnkey_client

    client = get_turnkey_client()
    result = await client.sign_raw_payload(
        payload="0x" + hash32.hex(),
        sign_with=address,
        encoding="PAYLOAD_ENCODING_HEXADECIMAL",
        hash_function="HASH_FUNCTION_NO_OP",  # payload is already the final hash
        organization_id=None,  # main org — matches hot-wallet + user signing
    )

    r = _to_int("r", result.get("r", ""))
    s = _to_int("s", result.get("s", ""))
    v = _to_int("v", result.get("v", ""))
    return normalize_vrs(r, s, v)
