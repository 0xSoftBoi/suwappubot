"""SLIP-0010 ed25519 key derivation (hardened-only), used to turn an exported
Turnkey wallet mnemonic into the Solana account key at m/44'/501'/0'/0'.

Turnkey derives Solana accounts with this path (see turnkey_client.create_wallet);
eth_account only knows secp256k1/BIP-32, so a backup taken with it would be the
wrong key for a Solana wallet. Pure-stdlib: HMAC-SHA512 per SLIP-0010.
"""

from __future__ import annotations

import hmac
import hashlib
import re
from typing import Iterable, Tuple

_ED25519_SEED_KEY = b"ed25519 seed"
_HARDENED = 0x80000000


def master_key(seed: bytes) -> Tuple[bytes, bytes]:
    digest = hmac.new(_ED25519_SEED_KEY, seed, hashlib.sha512).digest()
    return digest[:32], digest[32:]


def derive_child(parent_key: bytes, parent_chain: bytes, index: int) -> Tuple[bytes, bytes]:
    if index < _HARDENED:
        # ed25519 SLIP-0010 supports hardened derivation only.
        index += _HARDENED
    data = b"\x00" + parent_key + index.to_bytes(4, "big")
    digest = hmac.new(parent_chain, data, hashlib.sha512).digest()
    return digest[:32], digest[32:]


def parse_path(path: str) -> Iterable[int]:
    parts = path.strip().split("/")
    if not parts or parts[0] != "m":
        raise ValueError(f"derivation path must start with m: {path}")
    for part in parts[1:]:
        m = re.fullmatch(r"(\d+)(['hH]?)", part)
        if not m:
            raise ValueError(f"bad path segment {part!r} in {path}")
        idx = int(m.group(1))
        yield idx + _HARDENED if m.group(2) else idx


def derive_ed25519_seed(seed: bytes, path: str = "m/44'/501'/0'/0'") -> bytes:
    """Return the 32-byte ed25519 private seed at ``path`` for a BIP-39 seed."""
    key, chain = master_key(seed)
    for index in parse_path(path):
        key, chain = derive_child(key, chain, index)
    return key
