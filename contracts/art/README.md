# The art is the contract

`SuwappuPositionsArt` and `SuwappuMembershipArt` draw the collections. Not a
render server that draws them, not an IPFS directory that stores what was drawn
once — the plate is computed, from arithmetic, inside the `eth_call` that asks
for it. There is no URL in the metadata and nothing to keep paying for.

```
SuwappuArt.sol              Trig · Hue · Ink · Root — the instruments
SuwappuPositionsArt.sol     the position plate  (600 x 840, portrait)
SuwappuMembershipArt.sol    the member's plate  (860 x 540, landscape)
SuwappuCodex.sol            the contract as its own subject
```

## Why bother

Positions' whole claim is that a card is bound to a live equity price with
nothing in between. A renderer behind a domain makes that claim false the first
time the domain lapses, and a pinned JPEG makes it false immediately — a frozen
picture of a live position is just a lie with a timestamp. So the card is a pure
function of `(what was stamped at mint, what the oracle says now)` and the chain
is obliged to run it.

## What is fixed and what is alive

**Struck at mint, forever**: ticker, entry price, mint rank, edition. From those,
a keccak seed; from the seed, the plate's engraving — how many petals its rosette
turns, the pitch of the brushed grain, which way the light falls. Two cards on
the same ticker minted a block apart are different objects and always will be.

**Alive**: the rosette's depth of cut tracks the position's return. Up 4x is cut
deep and turns hard in the light; underwater flattens toward a plain turned
circle. The hero numeral, the grade caption and the metal of the ornament all
move with the oracle. On a membership, the bezel is lit for as much of the coming
year as the member has paid for and goes dark one tick at a time, and the seal
wears smooth as the term runs out.

## How it is drawn

- **Coordinates** are integers on a 6000 x 8400 viewBox — a tenth of a unit is a
  quarter of a pixel on a phone, and decimal formatting in a loop is the single
  most expensive thing an on-chain renderer does.
- **Trigonometry** is Bhaskara I's sine approximation (c. 600 CE): four
  multiplications, ~0.0016 absolute error, no lookup table. A table is stored
  art; a formula is made art.
- **The rosette** is cut ONCE at unit radius and every concentric pass is the
  same path re-chucked — `<use>` under `scale()` and `rotate()`, which is exactly
  what a rose engine does. Emitting nine independent paths gave a byte-identical
  picture for ~4x the SVG and several million gas of string copying.
- **The grain** is a tiled two-line `<pattern>`, one light scratch and one dark,
  not forty `<line>` elements.
- **Colour** is arithmetic: sector tints are anodised into the charcoal ground at
  a strength normalised by their own luminance, so ten families sort a wall by
  HUE and never by one of them being brighter.

Theme: Centurion Noir — see [`nft/position-cards/THEME.md`](../../nft/position-cards/THEME.md).

## Wiring

Both collections hold an optional renderer address. `setRenderer(0)` falls back
to the base URI, so a mis-set renderer is recoverable rather than terminal.

```solidity
positions.setRenderer(address(new SuwappuPositionsArt()));
membership.setRenderer(address(new SuwappuMembershipArt()));
```

The renderer is deliberately mutable: the art is a live function of an oracle, so
the thing computing it is code that may need fixing, and a frozen renderer with a
bug freezes the bug into 4,444 tokens. What a renderer swap **cannot** do is
change what a card says — ticker, entry price, mint rank and edition are stamped
in the collection's own storage and every renderer reads the same stamped values.

## Looking at it

```
pip install py-evm cairosvg pillow
python3 contracts/preview/preview.py     # -> contracts/preview/out/
forge test --match-path contracts/test/OnchainArtTest.t.sol
```

`forge test` asserts the properties. `preview.py` deploys the real bytecode into
a local EVM, decodes the data URI the way a marketplace does, rasterises it and
lays out a contact sheet — including a 190px thumbnail grid, which is the size
this work is actually judged at. On-chain art that has only been asserted about
has not been reviewed.


---

# SuwappuCodex — the contract as its own subject

The plates above are art a contract **makes**. `SuwappuCodex` is art a contract
**is**.

There is one way a smart contract can be the artwork rather than the vending
machine in front of it, and it is not decoration: the thing on the wall has to be
the machine. So the Codex reads deployed bytecode — its own, or any address's —
walks it as instructions, and strikes the result as a plate. `selfPortrait()` is
the piece: the engraver reads its own body out of the state trie and draws it,
and every byte in the drawing is a byte you can fetch with `eth_getCode` and
compare. Change one line of the source and the portrait changes, because the
portrait *is* the compilation.

### The reduction rule

A cell covers a few dozen bytes — call it fifteen instructions. Reduce that by
simple majority and every cell of every contract comes back STACK or DATA,
because that is what bytecode is mostly made of. The first cut did exactly that:
`SuwappuPositions`, which writes state in a couple of hundred places and hands
control outward in twenty-one, rendered without one gold or oxblood cell on it.

So: **majority for the texture, promotion for the two things worth finding.** If
anything in a slice hands control outside the contract it is drawn oxblood; else
if anything in it touches storage it is drawn gold; else it is drawn as whatever
it is mostly doing. Rarity is the subject — a single `SSTORE` in forty bytes of
stack shuffling is the fact about those forty bytes.

The census rule under the field is **not** promoted. It is the plain proportions,
unedited, so the plate carries both truths at once: a field composed for
significance, and a bar showing what the contract is actually made of. The legend
prints instruction counts, not percentages, because "STORE 0.0%" for the one
thing a reader most wants to count is the wrong unit, not a rounding problem.

### What it turns out to show

Run `contracts/preview/preview.py` and put the three renderers next to
`SuwappuPositions`. The renderers have **zero** gold and **zero** oxblood: they
write nothing and call nobody, visibly, at a glance. `SuwappuPositions` is
covered in both. A pure function and a custodian do not look remotely alike, and
you do not have to read either one to tell them apart.

That is also why the position card now carries an engraver's mark — `STRUCK BY`
plus the first eight hex of the renderer's own codehash. The renderer is
swappable by design, so the plate should say which machine struck it, and anyone
can check the claim with one `EXTCODEHASH`.

### What it is not

**Not a disassembler, and honest about it.** This is a linear sweep: it starts at
byte zero and walks forward, PUSH-aware — which is what a disassembler does
before it knows the jump graph. That gets right the thing a naive byte histogram
gets wrong (`PUSH32 <32 x 0x55>` is one instruction and thirty-two bytes of data,
not thirty-two `SSTORE`s, and that single fact is why most bytecode art is
noise). But a linear sweep cannot know which regions are never executed. Solidity
stores long string constants inside the runtime code and reaches them with
`CODECOPY`; swept linearly those bytes decode as plausible instructions, so a
contract carrying a lot of text shows a scatter of phantom ones. Recursive
descent would fix it and does not fit in a view call.

`census(address)` is public so the reading can be checked without decoding a
picture. If a plate says a contract never writes state, that is the number to
verify it against.
