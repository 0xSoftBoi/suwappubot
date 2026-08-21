# Figma design system

**File:** https://www.figma.com/design/QtSrQwTUkQl3sXfRPXAwT0 ("Suwappu Design System")
Owner: Prometheus team. Created 2026-08-04.

## What is in it

**Page: Foundations**
- **Color** — a real Figma variable collection (13 variables, mode "Dark"). Values are
  copied verbatim from `showcase/src/app/globals.css`; each swatch's fill is *bound* to
  its variable, and scopes are set explicitly (surfaces -> frame fills, text -> text
  fills). Grouped by the role rule: soil grounds, persimmon primary/swap/live, leaf
  secondary/bridge/success, cream inverted/sign.
- **Type** — the three roles at production sizes with real specimens, each labelled with
  its actual CSS clamp: EB Garamond display + pull-quote italic, Geist body, JetBrains
  Mono eyebrows and numerals.
- **Components** — button weights, venue chips carrying the classes proven from
  `bot/services` (6 bridge / 8 aggregator / 5 dex), the SWAP/BRIDGE/SIGN route coding,
  and the oversized stat blocks.

**Page: Layouts** — 1440-wide frames of Hero, Engine (three steps) and Security (split
panel), built from the same tokens and the real page copy.

## Rules for keeping it honest
- `globals.css` is the source of truth. If a token changes in code, update the Figma
  variable to match — never let Figma drift and never "fix" code to match a stale frame.
- Numbers shown in frames (41 chains, 19 venues, 23 MCP tools) must keep tracing to
  `docs/design/proof-material.md`. Do not invent figures for a mock.
- All three production faces (EB Garamond, Geist, JetBrains Mono) exist in Figma, so
  specimens use the real type rather than a substitute.

## Known gap
The clipped-corner button silhouette (`--btn-cut` in site.css) is documented as a spec
line rather than drawn: the rotated-square mask rendered inconsistently across the three
specimens, and an inconsistent silhouette is worse than none. Draw it properly with a
vector path if the component library is ever published.
