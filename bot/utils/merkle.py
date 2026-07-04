"""Merkle tree for the on-chain rewards distributor (Uniswap MerkleDistributor convention).

MONEY-PATH: the root produced here is what gets published to the audited
``SuwappuRewardsDistributor`` contract, and the stored proofs are what users
submit to claim USDC. Leaf/pair hashing MUST stay byte-compatible with the
contract's verification:

    leaf   = keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))
    parent = keccak256(abi.encodePacked(min(a, b), max(a, b)))   # sorted pairs
    odd node at a level is promoted unchanged (no self-pairing)

Amounts are token base units (USDC = 6 decimals). Proofs are verified with
OpenZeppelin ``MerkleProof.verify`` semantics (sorted-pair hashing).

Kept dependency-light on purpose: only eth_abi/eth_utils (already required by
web3), no imports from bot.* — safe to import from services, scripts, and tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import List, Sequence, Tuple

from eth_abi.packed import encode_packed
from eth_utils import keccak, to_checksum_address

USDC_DECIMALS = 6


def usd_to_base_units(amount_usd: float, decimals: int = USDC_DECIMALS) -> int:
    """Convert a USD float to integer token base units, rounding DOWN.

    Decimal(str(x)) is exact for the decimal literal the float displays as, so
    1.23 → 1_230_000 (no float noise) and truncation always rounds down —
    guaranteeing the sum of leaves never exceeds the funded total.
    """
    if amount_usd < 0:
        raise ValueError("reward amounts must be non-negative")
    return int(Decimal(str(amount_usd)) * (10**decimals))


def leaf_hash(index: int, account: str, amount_base_units: int) -> bytes:
    """keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))."""
    return keccak(
        encode_packed(
            ["uint256", "address", "uint256"],
            [index, to_checksum_address(account), amount_base_units],
        )
    )


def _hash_pair(a: bytes, b: bytes) -> bytes:
    """Sorted-pair keccak — matches OpenZeppelin MerkleProof.verify."""
    return keccak(a + b) if a <= b else keccak(b + a)


@dataclass(frozen=True)
class MerkleDistribution:
    """Immutable result of building a distribution tree."""

    root: bytes
    leaves: Tuple[bytes, ...]  # leaf hash per index
    proofs: Tuple[Tuple[bytes, ...], ...]  # proof per index

    @property
    def root_hex(self) -> str:
        return "0x" + self.root.hex()

    def proof_hex(self, index: int) -> List[str]:
        return ["0x" + h.hex() for h in self.proofs[index]]


def build_distribution(entries: Sequence[Tuple[str, int]]) -> MerkleDistribution:
    """Build the epoch tree from ``[(account, amount_base_units), ...]``.

    The caller fixes ordering BEFORE calling (we sort by checksummed address for
    determinism) — the position in the returned tuples is the on-chain ``index``
    each claimer must submit.
    """
    if not entries:
        raise ValueError("cannot build a distribution with no entries")

    normalized = sorted((to_checksum_address(acct), int(amt)) for acct, amt in entries)
    if len({acct for acct, _ in normalized}) != len(normalized):
        raise ValueError("duplicate account in distribution")
    for _, amt in normalized:
        if amt <= 0:
            raise ValueError("all leaf amounts must be positive")

    leaves = [leaf_hash(i, acct, amt) for i, (acct, amt) in enumerate(normalized)]

    # Build levels bottom-up; odd nodes promote unchanged.
    levels: List[List[bytes]] = [list(leaves)]
    while len(levels[-1]) > 1:
        prev = levels[-1]
        nxt = [
            _hash_pair(prev[i], prev[i + 1]) if i + 1 < len(prev) else prev[i]
            for i in range(0, len(prev), 2)
        ]
        levels.append(nxt)

    proofs: List[Tuple[bytes, ...]] = []
    for index in range(len(leaves)):
        proof: List[bytes] = []
        pos = index
        for level in levels[:-1]:
            sibling = pos ^ 1
            if sibling < len(level):
                proof.append(level[sibling])
            pos //= 2
        proofs.append(tuple(proof))

    return MerkleDistribution(root=levels[-1][0], leaves=tuple(leaves), proofs=tuple(proofs))


def sorted_entries(entries: Sequence[Tuple[str, int]]) -> List[Tuple[str, int]]:
    """The canonical (index-ordered) entry list for a distribution.

    Exposed so the service layer can persist each user's on-chain ``index``
    identically to how ``build_distribution`` assigned it.
    """
    return sorted((to_checksum_address(acct), int(amt)) for acct, amt in entries)


def verify_proof(
    root: bytes, index: int, account: str, amount_base_units: int, proof: Sequence[bytes]
) -> bool:
    """Local mirror of the contract's MerkleProof.verify — used in tests/reconciliation."""
    node = leaf_hash(index, account, amount_base_units)
    for sibling in proof:
        node = _hash_pair(node, sibling)
    return node == root
