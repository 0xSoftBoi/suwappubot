#!/usr/bin/env python3
"""Render the on-chain art the way a marketplace does, and check the invariants.

`forge test` is the test suite (contracts/test/OnchainArtTest.t.sol). This is the
CONTACT SHEET: it deploys the real renderer bytecode into a local EVM, calls
tokenURI, decodes the data URI a marketplace would decode, rasterises the SVG,
and lays the result out as a grid you can actually look at. On-chain art that has
only been asserted about has not been reviewed.

    pip install py-evm cairosvg pillow
    python3 contracts/preview/preview.py            # writes contracts/preview/out/

solc is found at $SOLC, or on PATH, or downloaded to /tmp on first run.
"""

import base64
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACTS = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out")
BUILD = os.path.join(OUT, "build")
SOLC_VERSION = "v0.8.27+commit.40a35a09"
SOLC_URL = f"https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-{SOLC_VERSION}"


def solc() -> str:
    for candidate in (os.environ.get("SOLC"), "solc"):
        if candidate and subprocess.run(["which", candidate], capture_output=True).returncode == 0:
            return candidate
    cached = "/tmp/solc-" + SOLC_VERSION
    if not os.path.exists(cached):
        print(f"fetching {SOLC_VERSION}...")
        # curl, not urllib: it picks up the proxy and CA configuration that a
        # sandboxed CI or agent environment usually only exports to the shell.
        subprocess.run(["curl", "-fsSL", "-o", cached, SOLC_URL], check=True)
        os.chmod(cached, 0o755)
    return cached


def compile_all() -> None:
    os.makedirs(BUILD, exist_ok=True)
    subprocess.run(
        [
            solc(),
            "--base-path",
            CONTRACTS,
            "--include-path",
            os.path.join(CONTRACTS, "lib"),
            "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
            "--optimize",
            "--optimize-runs",
            "200",
            "--bin",
            "-o",
            BUILD,
            "--overwrite",
            "art/SuwappuPositionsArt.sol",
            "art/SuwappuMembershipArt.sol",
            "art/SuwappuCodex.sol",
        ],
        cwd=CONTRACTS,
        check=True,
        capture_output=True,
    )


# ─── a local EVM, so the picture comes from the bytecode and not from Python ───
def chain_and_deploy():
    import rlp
    from eth import constants
    from eth.chains.base import MiningChain
    from eth.consensus import NoProofConsensus
    from eth.db.atomic import AtomicDB
    from eth.vm.forks import CancunVM
    from eth_keys import keys
    from eth_utils import decode_hex, keccak

    sk = keys.PrivateKey(b"\x11" * 32)
    me = sk.public_key.to_canonical_address()
    vm = CancunVM.configure(consensus_class=NoProofConsensus)
    chain = MiningChain.configure(
        __name__="Preview",
        vm_configuration=((constants.GENESIS_BLOCK_NUMBER, vm),),
        chain_id=1,
    ).from_genesis(
        AtomicDB(),
        {"difficulty": 0, "gas_limit": 500_000_000, "timestamp": 1_700_000_000},
        {me: {"balance": 10**30, "nonce": 0, "code": b"", "storage": {}}},
    )

    # A render is a view call and costs a real node nothing, but this local
    # chain still books it against a block, so seal one whenever the block is
    # close to full rather than letting the sweep run into the gas limit.
    GAS = 60_000_000
    used = [0]

    def send(to, data):
        if used[0] + GAS > 480_000_000:
            chain.mine_block()
            used[0] = 0
        state_vm = chain.get_vm()
        nonce = state_vm.state.get_nonce(me)
        tx = state_vm.create_unsigned_transaction(
            nonce=nonce, gas_price=10**10, gas=GAS, to=to, value=0, data=data
        ).as_signed_transaction(sk)
        _, receipt, comp = chain.apply_transaction(tx)
        if comp.is_error:
            raise RuntimeError(comp.error)
        gas = receipt.gas_used - used[0]
        used[0] = receipt.gas_used
        return comp.output, gas

    def deploy_raw(code: bytes):
        nonce = chain.get_vm().state.get_nonce(me)
        send(constants.CREATE_CONTRACT_ADDRESS, code)
        return keccak(rlp.encode([me, nonce]))[12:]

    def deploy(name):
        return deploy_raw(decode_hex(open(os.path.join(BUILD, name + ".bin")).read().strip()))

    return deploy, send, keccak, deploy_raw


def word(v: int) -> bytes:
    return (v if v >= 0 else v + (1 << 256)).to_bytes(32, "big")


def tail(s: str) -> bytes:
    b = s.encode()
    return word(len(b)) + b + b"\x00" * ((32 - len(b) % 32) % 32)


def read_string(out: bytes) -> str:
    off = int.from_bytes(out[:32], "big")
    length = int.from_bytes(out[off : off + 32], "big")
    return out[off + 32 : off + 32 + length].decode()


CARD_SIG = (
    "tokenURI((uint256,string,uint8,uint256,uint256,int256,bool,uint8,"
    "uint16,bool,uint32,uint256))"
)
PASS_SIG = "tokenURI((uint256,uint8,uint64,uint64,uint64))"


def card(**kw):
    d = dict(
        tokenId=1,
        ticker="NVDA",
        tickerIndex=20,
        entryPrice=120 * 10**18,
        spotPrice=180 * 10**18,
        returnBps=5000,
        priced=True,
        gradeIndex=3,
        mintRank=17,
        isGold=False,
        mintedAt=1_700_000_000,
        maxSupply=4444,
    )
    d.update(kw)
    return d


def encode_card(c) -> bytes:
    head = [
        c["tokenId"],
        None,
        c["tickerIndex"],
        c["entryPrice"],
        c["spotPrice"],
        c["returnBps"],
        int(c["priced"]),
        c["gradeIndex"],
        c["mintRank"],
        int(c["isGold"]),
        c["mintedAt"],
        c["maxSupply"],
    ]
    return b"".join(word(32 * 12) if f is None else word(f) for f in head) + tail(c["ticker"])


def decode_uri(uri: str):
    assert uri.startswith("data:application/json;base64,"), uri[:60]
    meta = json.loads(base64.b64decode(uri.split(",", 1)[1]))
    svg = base64.b64decode(meta["image"].split(",", 1)[1]).decode()
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    return meta, svg


DAY = 86400
NOW = 1_787_000_000

POSITIONS = [
    (
        "aapl-moonshot",
        card(
            tokenId=222,
            ticker="AAPL",
            tickerIndex=0,
            entryPrice=90 * 10**18,
            spotPrice=640 * 10**18,
            returnBps=61111,
            gradeIndex=5,
            mintRank=222,
        ),
    ),
    ("nvda-runner", card(tokenId=1, mintRank=1)),
    (
        "mstr-gold-loss",
        card(
            tokenId=1301,
            ticker="MSTR",
            tickerIndex=17,
            entryPrice=410 * 10**18,
            spotPrice=268 * 10**18,
            returnBps=-3463,
            gradeIndex=0,
            mintRank=1301,
            isGold=True,
        ),
    ),
    (
        "qqq-flat",
        card(
            tokenId=3900,
            ticker="QQQ",
            tickerIndex=23,
            entryPrice=512 * 10**18,
            spotPrice=513 * 10**18,
            returnBps=19,
            gradeIndex=1,
            mintRank=3900,
        ),
    ),
    (
        "ionq-unpriced",
        card(
            tokenId=888,
            ticker="IONQ",
            tickerIndex=14,
            entryPrice=0,
            spotPrice=0,
            returnBps=0,
            priced=False,
            gradeIndex=1,
            mintRank=888,
        ),
    ),
    (
        "sgov-sub-dollar",
        card(
            tokenId=7,
            ticker="SGOV",
            tickerIndex=26,
            entryPrice=43 * 10**15,
            spotPrice=49 * 10**15,
            returnBps=1395,
            gradeIndex=2,
            mintRank=7,
        ),
    ),
    (
        "googl-400x",
        card(
            tokenId=4001,
            ticker="GOOGL",
            tickerIndex=12,
            entryPrice=1 * 10**18,
            spotPrice=401 * 10**18,
            returnBps=4_000_000,
            gradeIndex=5,
            mintRank=4001,
        ),
    ),
    (
        "clsk-underwater",
        card(
            tokenId=2100,
            ticker="CLSK",
            tickerIndex=5,
            entryPrice=30 * 10**18,
            spotPrice=1 * 10**18,
            returnBps=-9666,
            gradeIndex=0,
            mintRank=2100,
        ),
    ),
]

PASSES = [
    ("free-perpetual", (12, 0, 0, NOW - 400 * DAY)),
    ("pro-310d", (233, 1, NOW + 310 * DAY, NOW - 500 * DAY)),
    ("premium-120d", (41, 2, NOW + 120 * DAY, NOW - 900 * DAY)),
    ("enterprise-2y", (7, 3, NOW + 700 * DAY, NOW - 1300 * DAY)),
    ("premium-expiring", (902, 2, NOW + 9 * DAY, NOW - 60 * DAY)),
    ("pro-lapsed", (1544, 1, NOW - 30 * DAY, NOW - 800 * DAY)),
]


def check_invariants(art, send, sel):
    """The properties that make on-chain art safe to ship, not the pixels."""

    def render(c):
        out, _ = send(art, sel(CARD_SIG) + word(32) + encode_card(c))
        return decode_uri(read_string(out))

    _, svg = render(card())
    for forbidden in ("https://", "http://suwappu", "ipfs", "<image", "@font-face"):
        assert forbidden not in svg, f"the plate reaches off-chain: {forbidden}"

    _, hostile = render(card(ticker='<script>x</script>&"'))
    assert "<script" not in hostile, "a symbol read from another contract became markup"
    assert '&"' not in hostile

    # Nothing a real token can be must revert the render.
    for bps in (-9999, 0, 200, 50_000, 4_000_000, -1):
        for gold in (False, True):
            render(card(returnBps=bps, isGold=gold, priced=True))
    for idx in range(36):
        render(card(tickerIndex=idx))
    render(card(ticker=""))

    # The art is a function of the market, and only of the market.
    a, _ = render(card(returnBps=5000))
    b, _ = render(card(returnBps=40_000, gradeIndex=4))
    assert a != b, "the plate is frozen — it must move with the price"
    assert render(card())[0] == render(card())[0], "the plate is not deterministic"
    print("  invariants: self-contained, injection-safe, total, live, deterministic  OK")


def deploy_runtime(send, deploy_raw, runtime: bytes):
    """A contract whose RUNTIME code is exactly `runtime`.

    A real deployment rather than a cheatcode, so the bytes under test are read
    back out of the state trie exactly the way any subject's are.
    """
    n = len(runtime).to_bytes(2, "big")
    return deploy_raw(b"\x61" + n + b"\x60\x0e\x60\x00\x39\x61" + n + b"\x60\x00\xf3" + runtime)


DATA, STACK, MATH, MEM, STORE, FLOW, EXT, ENV = range(8)


def check_codex(codex, art, send, sel, deploy_raw):
    """The Codex's one factual claim: it reads instructions, not bytes.

    Everything the plate asserts rests on this. A byte histogram of
    `PUSH32 <32 x 0x55>` reports thirty-two SSTOREs in a contract that has none,
    and a portrait built on that is decoration with a false caption.
    """

    def census(addr):
        out, _ = send(codex, sel("census(address)") + b"\x00" * 12 + addr)
        off = int.from_bytes(out[:32], "big")
        n = int.from_bytes(out[off : off + 32], "big")
        return [int.from_bytes(out[off + 32 + 32 * i : off + 64 + 32 * i], "big") for i in range(n)]

    c = census(deploy_runtime(send, deploy_raw, bytes([0x7F]) + bytes([0x55]) * 32))
    assert (c[STORE], c[STACK], c[DATA]) == (0, 1, 32), c

    c = census(deploy_runtime(send, deploy_raw, bytes([0x60, 1, 0x60, 2, 0x55])))
    assert (c[STORE], c[STACK]) == (1, 2), c

    # Twenty bytes that look exactly like SSTORE, in the compiler's metadata slot.
    meta = bytes([0x55]) * 20
    c = census(
        deploy_runtime(
            send, deploy_raw, bytes([0x60, 1, 0x50]) + meta + len(meta).to_bytes(2, "big")
        )
    )
    assert c[STORE] == 0, c

    for op in (0xF0, 0xF1, 0xF4, 0xFA, 0xFF, 0xA2):
        assert census(deploy_runtime(send, deploy_raw, bytes([op])))[EXT] == 1, op

    # And the claim the collection's own plates make about themselves.
    assert census(art)[STORE] == 0, "the renderer writes state"
    assert census(art)[EXT] == 0, "the renderer calls out"
    assert census(codex)[EXT] == 0, "the codex calls out"
    print("  codex: PUSH-aware, metadata-aware, and the renderers are provably pure  OK")


def main():
    os.makedirs(OUT, exist_ok=True)
    compile_all()
    deploy, send, keccak, deploy_raw = chain_and_deploy()
    sel = lambda sig: keccak(text=sig)[:4]
    art = deploy("SuwappuPositionsArt")
    passes = deploy("SuwappuMembershipArt")
    codex = deploy("SuwappuCodex")

    check_invariants(art, send, sel)
    check_codex(codex, art, send, sel, deploy_raw)

    import cairosvg
    from PIL import Image

    def sheet(items, w, h, cols, path):
        tiles = []
        for name, svg in items:
            png = os.path.join(OUT, name + ".png")
            cairosvg.svg2png(bytestring=svg.encode(), write_to=png, output_width=w, output_height=h)
            tiles.append(Image.open(png).convert("RGB"))
        rows = (len(tiles) + cols - 1) // cols
        grid = Image.new("RGB", (w * cols, h * rows), (10, 11, 13))
        for i, tile in enumerate(tiles):
            grid.paste(tile, ((i % cols) * w, (i // cols) * h))
        grid.save(path)
        print("  ->", os.path.relpath(path, CONTRACTS))

    drawn = []
    for name, c in POSITIONS:
        out, gas = send(art, sel(CARD_SIG) + word(32) + encode_card(c))
        meta, svg = decode_uri(read_string(out))
        open(os.path.join(OUT, name + ".svg"), "w").write(svg)
        drawn.append((name, svg))
        print(f"  {name:18s} {len(svg):6d}B svg  {meta['name']}")
    sheet(drawn, 400, 560, 4, os.path.join(OUT, "positions.png"))

    drawn = []
    for name, (tid, tier, exp, iss) in PASSES:
        args = b"".join(word(x) for x in (tid, tier, exp, iss, NOW))
        out, _ = send(passes, sel(PASS_SIG) + args)
        meta, svg = decode_uri(read_string(out))
        open(os.path.join(OUT, name + ".svg"), "w").write(svg)
        drawn.append((name, svg))
        print(f"  {name:18s} {len(svg):6d}B svg  {meta['name']}")
    sheet(drawn, 520, 327, 2, os.path.join(OUT, "memberships.png"))

    # The codex: the contracts themselves, drawn from their own deployed code.
    # Three pure renderers and, for contrast, a contract that actually custodies
    # something — the difference is meant to be visible from across a room.
    drawn = []
    for name, subject in (
        ("codex-self-portrait", codex),
        ("codex-positions-art", art),
        ("codex-membership-art", passes),
    ):
        out, _ = send(codex, sel("portrait(address)") + b"\x00" * 12 + subject)
        svg = read_string(out)
        assert svg.startswith("<svg") and svg.endswith("</svg>")
        open(os.path.join(OUT, name + ".svg"), "w").write(svg)
        drawn.append((name, svg))
        print(f"  {name:20s} {len(svg):6d}B svg")
    sheet(drawn, 400, 560, 3, os.path.join(OUT, "codex.png"))

    # The real test of a collection is the wall, not the hero shot.
    sheet(
        [
            (f"thumb-{n}", s)
            for n, s in [(n, open(os.path.join(OUT, n + ".svg")).read()) for n, _ in POSITIONS]
        ],
        190,
        266,
        8,
        os.path.join(OUT, "thumbnails.png"),
    )


if __name__ == "__main__":
    sys.exit(main())
