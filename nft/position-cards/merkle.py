#!/usr/bin/env python3
"""Keccak-256 + OpenZeppelin-compatible Merkle trees. Stdlib only.

Matches OpenZeppelin's `MerkleProof.verify` exactly:
  * leaves are DOUBLE-hashed — keccak256(keccak256(abi.encode(addr, maxQty))) —
    which is what @openzeppelin/merkle-tree does. Double hashing makes it
    impossible to pass an internal node off as a leaf (second-preimage attack).
  * internal nodes hash the SORTED pair: keccak256(min(a,b) || max(a,b)), so a
    proof needs no left/right flags.

Anything that changes here changes the root, which is verified on-chain, so
tests/test_position_cards.py pins both the keccak vectors and a known root.
"""

_RC = [
    0x0000000000000001,
    0x0000000000008082,
    0x800000000000808A,
    0x8000000080008000,
    0x000000000000808B,
    0x0000000080000001,
    0x8000000080008081,
    0x8000000000008009,
    0x000000000000008A,
    0x0000000000000088,
    0x0000000080008009,
    0x000000008000000A,
    0x000000008000808B,
    0x800000000000008B,
    0x8000000000008089,
    0x8000000000008003,
    0x8000000000008002,
    0x8000000000000080,
    0x000000000000800A,
    0x800000008000000A,
    0x8000000080008081,
    0x8000000000008080,
    0x0000000080000001,
    0x8000000080008008,
]
_ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]
_M = (1 << 64) - 1


def _rotl(x, n):
    return ((x << n) | (x >> (64 - n))) & _M


def _keccak_f(a):
    for rnd in range(24):
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl(a[x][y], _ROT[x][y])
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y] & _M) & b[(x + 2) % 5][y])
        a[0][0] ^= _RC[rnd]
    return a


def keccak256(data: bytes) -> bytes:
    """Ethereum keccak256 — pad byte 0x01, NOT SHA3-256's 0x06."""
    rate = 136
    a = [[0] * 5 for _ in range(5)]
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % rate != 0:
        padded.append(0x00)
    padded[-1] ^= 0x80
    for off in range(0, len(padded), rate):
        blk = padded[off : off + rate]
        for i in range(rate // 8):
            a[i % 5][i // 5] ^= int.from_bytes(blk[i * 8 : i * 8 + 8], "little")
        a = _keccak_f(a)
    out = bytearray()
    while len(out) < 32:
        for i in range(rate // 8):
            if len(out) >= 32:
                break
            out += a[i % 5][i // 5].to_bytes(8, "little")
        if len(out) < 32:
            a = _keccak_f(a)
    return bytes(out[:32])


assert (
    keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
), "keccak256 self-test failed"


def leaf_for(address: str, max_qty: int) -> bytes:
    """abi.encode(address, uint256 maxQty) then double-keccak — byte-identical to
    the contract's keccak256(bytes.concat(keccak256(abi.encode(msg.sender, maxQty))))."""
    addr = bytes.fromhex(address.lower().removeprefix("0x")).rjust(32, b"\x00")
    qty = max_qty.to_bytes(32, "big")
    return keccak256(keccak256(addr + qty))


def _hash_pair(a: bytes, b: bytes) -> bytes:
    return keccak256(a + b) if a <= b else keccak256(b + a)


def build_tree(leaves: list[bytes]) -> list[list[bytes]]:
    """Bottom-up layers. An odd node is promoted, never hashed with itself —
    hashing a node with itself lets a proof be forged from a duplicated leaf."""
    if not leaves:
        raise ValueError("empty allowlist")
    layers = [sorted(set(leaves))]
    while len(layers[-1]) > 1:
        cur = layers[-1]
        nxt = [_hash_pair(cur[i], cur[i + 1]) for i in range(0, len(cur) - 1, 2)]
        if len(cur) % 2:
            nxt.append(cur[-1])
        layers.append(nxt)
    return layers


def root_of(layers: list[list[bytes]]) -> bytes:
    return layers[-1][0]


def proof_for(layers: list[list[bytes]], leaf: bytes) -> list[bytes]:
    idx = layers[0].index(leaf)
    proof = []
    for layer in layers[:-1]:
        sibling = idx ^ 1
        if sibling < len(layer):
            proof.append(layer[sibling])
        idx //= 2
    return proof


def verify(proof: list[bytes], root: bytes, leaf: bytes) -> bool:
    """Mirror of OpenZeppelin MerkleProof.verify — used to self-check output."""
    h = leaf
    for p in proof:
        h = _hash_pair(h, p)
    return h == root
