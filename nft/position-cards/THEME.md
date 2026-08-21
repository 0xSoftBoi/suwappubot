# Centurion Noir

Custom theme (via theme-factory) for the Suwappu Positions 10k collection —
luxury matte-black metal card in the Amex Centurion / Robinhood Gold lineage:
Soho House meets web3, for adults. The card must read as a machined OBJECT —
brushed metal, embossed type, struck furniture — never as text on a rectangle.

## Color Palette

- **Obsidian**: `#0a0b0d` — the backdrop the card sits on
- **Charcoal**: `#0d0d10` — the matte card ground (sector colour anodised in,
  luminance-normalised)
- **Ivory**: `#f2ede3` — ink on the dark plate; ground of the rare Gilt proof
- **Champagne Gold**: `#e0bd76` (light `#f0d49a`, shadow `#8a6f3c`) — Founder metal
- **Platinum**: `#aab1b9` (light `#d6dade`, shadow `#6d747c`) — Early metal
- **Graphite**: `#6e7176` (light `#9ea1a6`, shadow `#3f4145`) — base metal
- **Jade → Champagne ramp**: `#5da97f` → `#59c19a` → `#c3bf95` → `#d4af6e` — gains
- **Oxblood**: `#c4767c` (deep `#8f3a44`) — losses; expensive, not alarming
- **Suwappu Pink**: `#f472b6` — brand mark, the single saturated element

## Typography

- **Display / numerals**: Geist → Inter → system grotesque (marketplace CSP
  forbids @font-face; the stack lands on the same skeleton everywhere)
- **Small caps / serials**: Geist Mono → SFMono → monospace, wide tracking

## Material Language

- Brushed-metal grain (fine horizontal hairlines) over the whole plate
- One diagonal light sheen, as on anodised aluminium under a lamp
- Metal furniture (frame, serial, seal, badge) filled with 3-stop metal
  gradients, not flat hex — gold must *turn* like gold
- Embossed ticker: highlight above-left, shadow below-right
- Rounded-corner card silhouette floating on obsidian with a soft shadow

## Best Used For

The position-card renderer (`render.py`), mint page, and any surface that
presents the collection.
