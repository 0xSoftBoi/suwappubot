#!/usr/bin/env python3
"""Pack Suwappu Fills traits for on-chain storage.

Produces the 20,000-byte blob the contract seals against:
    2 bytes per asset id, ordered by asset id -> [tickerIndex, deskIndex]

  tickerIndex : index into ROBINHOOD_EQUITIES sorted by symbol (0..95)
  deskIndex   : 0=Retail 1=Desk 2=Prime 3=Whale 4=House

Emits:
  traits.bin            raw blob
  traits_commitment.txt keccak256(blob)  -> constructor arg + sealTraits() check
  traits_calldata.json  appendTraits() chunks ready to broadcast

Stdlib only — keccak256 is implemented here rather than pulled from web3/pycryptodome
so the collection tooling has no install step. Cross-checked against js-sha3 in CI
(tests/test_fills_collection.py) and against the standard empty-string vector below.

Run:  python3 nft/fills/pack_traits.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from generate import load_config, load_registry  # noqa: E402

CHUNK_ASSETS = 1000  # 2,000 bytes per appendTraits() call

# ── keccak256 (Keccak-f[1600], rate 1088, pad 0x01 — NOT SHA3-256's 0x06) ──────
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
            lane = int.from_bytes(blk[i * 8 : i * 8 + 8], "little")
            a[i % 5][i // 5] ^= lane
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


def build_blob():
    cfg = load_config()
    registry = load_registry()
    tickers = sorted(registry)
    ticker_idx = {t: i for i, t in enumerate(tickers)}
    desks = [d["name"] for d in cfg["desks"]]
    desk_idx = {d: i for i, d in enumerate(desks)}

    with open(os.path.join(HERE, "collection.json")) as f:
        collection = json.load(f)
    if len(collection) != cfg["collection"]["supply"]:
        raise SystemExit(
            f"collection.json has {len(collection)} entries, expected "
            f"{cfg['collection']['supply']} — run generate.py first"
        )

    blob = bytearray()
    for meta in collection:
        attrs = {a["trait_type"]: a["value"] for a in meta["attributes"]}
        blob.append(ticker_idx[attrs["Ticker"]])
        blob.append(desk_idx[attrs["Desk"]])
    return cfg, tickers, desks, bytes(blob)


def main():
    cfg, tickers, desks, blob = build_blob()
    expected = cfg["collection"]["supply"] * 2
    if len(blob) != expected:
        raise SystemExit(f"blob is {len(blob)} bytes, expected {expected}")

    commitment = "0x" + keccak256(blob).hex()
    with open(os.path.join(HERE, "traits.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(HERE, "traits_commitment.txt"), "w") as f:
        f.write(commitment + "\n")

    chunks = [
        "0x" + blob[i * 2 : (i + CHUNK_ASSETS) * 2].hex()
        for i in range(0, cfg["collection"]["supply"], CHUNK_ASSETS)
    ]
    with open(os.path.join(HERE, "traits_calldata.json"), "w") as f:
        json.dump(
            {
                "commitment": commitment,
                "total_bytes": len(blob),
                "chunk_assets": CHUNK_ASSETS,
                "ticker_index": {t: i for i, t in enumerate(tickers)},
                "desk_index": {d: i for i, d in enumerate(desks)},
                "append_chunks": chunks,
            },
            f,
            indent=1,
        )
    print(f"blob {len(blob)} bytes · {len(chunks)} appendTraits() chunks")
    print(f"traitsCommitment {commitment}")


if __name__ == "__main__":
    main()
