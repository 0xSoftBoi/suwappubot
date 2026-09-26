"""keccak-256, pure Python, no dependencies.

Ported from ~/Projects/flet-curve-demo/src/wallet/erc20.py, for the same reason
it was written there: `eth-hash`/`pycryptodome` drag in compiled dependencies
that make a Pyodide build either impossible or enormous.  This is ~70 lines and
runs identically on CPython and wasm32.

Note this is *original Keccak* padding (0x01), not SHA-3's (0x06).
`hashlib.sha3_256` is a different hash and cannot be substituted.
"""

from __future__ import annotations

_MASK = (1 << 64) - 1
_RATE = 136  # bytes absorbed per permutation for keccak-256

_ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)

# rho offsets, indexed [x][y]
_ROTATIONS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)


def _rotl(value: int, shift: int) -> int:
    return ((value << shift) | (value >> (64 - shift))) & _MASK if shift else value


def _keccak_f(a: list[list[int]]) -> None:
    for rc in _ROUND_CONSTANTS:
        # theta
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        # rho + pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl(a[x][y], _ROTATIONS[x][y])
        # chi
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ (~b[(x + 1) % 5][y] & _MASK & b[(x + 2) % 5][y])
        # iota
        a[0][0] ^= rc


def keccak256(data: bytes) -> bytes:
    """Ethereum's keccak-256 of `data`."""
    state = [[0] * 5 for _ in range(5)]
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % _RATE != 0:
        padded.append(0x00)
    padded[-1] |= 0x80

    for offset in range(0, len(padded), _RATE):
        block = padded[offset : offset + _RATE]
        for i in range(_RATE // 8):
            state[i % 5][i // 5] ^= int.from_bytes(block[i * 8 : i * 8 + 8], "little")
        _keccak_f(state)

    out = bytearray()
    for i in range(4):  # 32 bytes = 4 lanes off the top of the state
        out += state[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out)
