# Contact sheet

```
pip install py-evm cairosvg pillow
python3 contracts/preview/preview.py
```

Compiles `contracts/art/`, deploys the real bytecode into a local Cancun EVM,
calls `tokenURI`, decodes the base64 JSON and the base64 SVG inside it exactly as
a marketplace would, and writes to `out/`:

| file | what it is |
|---|---|
| `positions.png` | eight position plates: moonshot, runner, gold loss, flat, unpriced, sub-dollar, 400x, near-zero |
| `memberships.png` | every tier, plus one expiring and one lapsed |
| `codex.png` | the contracts themselves, drawn from their own deployed code |
| `thumbnails.png` | the same plates at 190px — the size a wall of them is judged at |
| `*.svg` | each plate as it came off the chain |

It also checks the invariants before drawing anything: the SVG reaches nothing
off-chain, a `symbol()` read from another contract can never become markup, no
state a real token can be in reverts the render, the plate moves with the price,
and two reads at the same price are byte-identical. Then the Codex's one factual
claim: that it reads instructions and not bytes (`PUSH32 <32 x 0x55>` must come
back as one PUSH and thirty-two bytes of data, not thirty-two `SSTORE`s), that the
compiler's metadata block is data, that every way out of a contract is counted,
and that the renderers in this directory provably write nothing and call nobody.

`out/` is not committed — regenerate it. `forge test` is the test suite; this is
the part you look at.

Uses `$SOLC`, or `solc` on PATH, or downloads pinned 0.8.27 to /tmp on first run.
