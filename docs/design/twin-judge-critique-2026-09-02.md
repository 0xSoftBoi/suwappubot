# Twin-judge critique of the homepage (art-director, 2026-09-02)

Rendered 1440x900 frames of the current build judged for a Bloomberg-fluent trader and a Christie's-fluent collector at once. Theme fixed. Items on the cream band and the local QUOTE UNAVAILABLE ticket are capture and local-env artefacts, verified separately.

Looked at all 16 frames plus pixel-measured crops of the CTA pair, stats band, product plate edges, footer and the floating chips.

---

## 1. Per-frame notes (only where something fails)

**cur-00** — Hero container is `125→1316`; every body section below is `154→1285`. Two different page widths, visible as the hero plate hanging 30px proud of everything under it. Secondary button "Read the docs": border runs `305→442` on top and `297→434` on bottom — the 45° corners are **open notches with no diagonal stroke**, while the primary button has a real filled chamfer. Header right margin is 21px ("Explore all" ends at x1419) against the body's 155px.

**cur-01** — Stats band uses a *third* container (`130→1310`). The four link cells (Service status / OpenAPI / GitHub / Changelog) carry ~52px of trailing dead air below their captions because row height is driven by the stat cell; they read as unfinished boxes next to a dense one. Coverage caveat is set in **green**; the equivalent caveat on cur-08 is persimmon.

**cur-03** — The execution ticket renders **QUOTE UNAVAILABLE**. The copy ("No demo price is being substituted") is the most trustworthy sentence on the page — keep it verbatim. The *layout* is the failure: the panel is 736px wide inside an 1131px container, leaving a 395px void to its right, and the section's grid rules above run the full 1131. The one place a trader looks for live numbers is an error box floating in half a column.

**cur-04** — Kicker colour is arbitrary: row 1 (`CROSS-CHAIN`, `HYPERLIQUID`) green, row 2 (`TEMPO`, `CURVE FINANCE`) persimmon, with no semantic difference between the rows. For a terminal-fluent reader green is a *state*, not a decoration.

**cur-05** — The product plate crops **mid-data-row** at both edges: the top slices through the "Markets / Search" row leaving half-glyphs under the chrome bar, the bottom rounded corner cuts the AVAX row through its numerals. The window chrome shows **two** dots. The plate has ~10px rounded corners against 45° chamfers everywhere else. Caption sits only 12px below the plate at near body size.

**cur-06, cur-07** — Two-column feature lists with an odd item count leave a ~530px empty right cell ("Market data capture" alone; "Position-card NFTs" alone). Ragged, and it reads as content missing rather than air used.

**cur-09** — "Also live on": *Telegram Mini App* is underlined, *iOS app / Chrome extension / WhatsApp* are not. Inconsistent link affordance in a four-item row.

**cur-10** — Left column sets "The practical questions, answered plainly." across four short lines with "plainly." orphaned on its own line against a wide accordion.

**cur-12** — Footer rule spans `106→1333`, a **fourth** container. `PAUSE MOTION` / `SOUND OFF` pills sit on top of and occlude the legal line "You sign every swap by default…". They are fully-rounded pills in translucent mud-grey — off-palette and against the chamfer language. Footer column items fall out of row register once "Agent Desk (WebMCP)" wraps.

**cur-m-hero** — The same two pills overlay the hero CTA stack. **cur-m-research** — renders essentially blank; verify whether that is a capture artifact or a real empty section.

*(Every scrolled desktop frame shows a ~35px cream band above the sticky header. Almost certainly a scroll-capture artifact, but confirm on a live scroll — if it's real it outranks everything here.)*

---

## 2. Ranked changes

**1. Rehome and restyle the motion/sound controls.**
They currently occlude the footer legal text and the mobile hero CTA. Both eyes: the trader is being told the disclaimer doesn't matter, the collector sees browser debris on a catalogue page.
`position: fixed; right: 24px; bottom: 24px` → keep fixed, but add `padding-bottom: 96px` to the footer's bottom bar so nothing ever sits under them; change `border-radius: 9999px` → `0` with the shared chamfer utility (`clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))`); background `rgba(20,18,16,0.88)`, `border: 1px solid rgba(255,255,255,0.14)`, label colour `#F5EFE6`. **Mobile risk: yes** — on the 390px frames they overlap the hero buttons; give them `bottom: 16px` and shrink to `font-size: 10px; padding: 6px 10px` under `@media (max-width: 640px)`.

**2. Collapse four page containers into one.**
Measured: hero `125→1316`, stats band `130→1310`, body `154→1285`, footer rule `106→1333`. Auction eye: the frame isn't square, and misregistration is the one thing a print-trained eye cannot unsee. Trader eye: a grid that doesn't hold is a system that doesn't hold.
Define one container — `max-width: 1132px; margin-inline: auto; padding-inline: 24px` — and apply it to the hero block, the stats/venues band, every section body, the footer grid **and** the footer hairline. Remove the bespoke widths on the hero and stats wrappers. The header's inner row must use the same container so "Explore all" ends at 1286, not 1419. **Mobile risk: low**, but re-check cur-m-mid where card rules currently run edge-to-edge.

**3. Give the outlined button a real chamfer.**
Its top border stops 8px short on the left and its bottom border stops 8px short on the right, leaving two open notches next to a primary button that has genuine filled diagonals. Trader eye: unfinished. Collector eye: a broken frame.
Replace the border-based cut on `.btn--secondary` with the same `clip-path` polygon as the primary, rendered as a 1px inset pseudo-element: `position: relative; background: currentColor-free transparent;` `&::before { content:''; position:absolute; inset:0; clip-path: <same polygon>; background: #6FCF97; } &::after { content:''; position:absolute; inset:1px; clip-path: <same polygon inset 1px>; background: var(--soil); }`. Keep box height at 40px to match the primary (`124→284` × `504→543`). **No mobile risk.**

**4. Stop the product plates cutting through data rows, and chamfer them.**
The perps plate slices the header row at the top and the AVAX numerals at the bottom; the rounded corners fight the chamfer language.
On the plate wrapper: replace `border-radius: 10px` with the shared 12px chamfer `clip-path`. Set the inner capture to `object-fit: cover; object-position: top center` and adjust the wrapper's `aspect-ratio` to `1131 / 640` so the crop lands **between** table rows — the bottom edge must fall in the 8px gutter under the SUI row, not through AVAX. Fix the window chrome to three dots or remove it entirely (three-dot chrome is the more literal, more honest reading). **No mobile risk.**

**5. Make green mean one thing.**
Green currently marks the secondary button, two of four kickers, and a coverage caveat; persimmon marks the other two kickers, card numbers, and a different caveat. The Wall Street eye reads green as *up/live* and will misread the page.
Rule: `--accent-green: #6FCF97` reserved for live/positive/up state only (service-status dot, positive deltas, "looks safe"). All section kickers → `--persimmon` uniformly (`.kicker { color: var(--persimmon); }`, remove per-section overrides on cur-04's `CROSS-CHAIN` and `HYPERLIQUID`). All caveat/limitation notes → one neutral: `color: #A79C90` with a `2px solid var(--persimmon)` left rule and `padding-left: 12px`. The green secondary button becomes cream-outline (`border-color: rgba(245,239,230,0.45); color: #F5EFE6`). **No mobile risk.**

**6. Bottom-align the stats-band captions and kill the trailing air.**
Four link cells hold 52px of dead space under their captions while the neighbouring stat cell is packed. Density should live where data lives; right now it's inverted.
On each cell: `display: flex; flex-direction: column;` and on the caption `margin-top: auto;` so "Live health / Machine-readable schema / Source / What shipped" sit on a shared baseline with the last line of the green coverage note (y≈411). Set cell `padding-block: 20px 20px`. Also give the three numerals a fixed data column — `grid-template-columns: repeat(3, 112px)` — and `font-variant-numeric: tabular-nums` on the numeral class. **No mobile risk** (stack at ≤640px).

**7. Treat the plate caption like a museum label.**
Currently 12px below the plate at near body size, it competes with the plate instead of serving it.
`.plate__caption { margin-top: 20px; padding-top: 12px; border-top: 1px solid rgba(245,239,230,0.10); font-family: 'JetBrains Mono'; font-size: 11px; line-height: 1.5; letter-spacing: 0.06em; color: #8C8178; max-width: 44ch; }` Keep the `HyperLiquid perps inside Suwappu · product capture · 31 Jul 2026` construction exactly — dated, attributed, unhyped. It is the best-judged element on the page and every plate should carry one. **Mobile risk: mild** — hold 11px, do not go below.

**8. Optically align and tighten the display serif.**
The h1 "T" sits at x125 while the body sans "E" sits at x126, so the serif reads *indented* against its own paragraph, and 64px Newsreader at default tracking is loose for display size.
`.display, h1, h2 { letter-spacing: -0.018em; text-indent: -0.02em; }` (the negative indent optically hangs T/V/W/Y and the quote marks). Keep `line-height: 1.14`. On the FAQ heading, widen the left column from its current ~460px to `520px` so "answered plainly." sets on one line and loses the orphan. **Mobile risk: yes** — on the 390px hero the h1 already breaks to "for cross-/chain markets."; apply the tracking change but scope `text-indent` to `@media (min-width: 768px)` and verify the mobile hero doesn't gain a fifth line.

---

## 3. If only one change were allowed

**#2 — one container width.**

The chips are uglier and the broken quote is scarier, but both are single objects a viewer can dismiss. Four different page widths is a defect that repeats on every screen of the scroll, and it is precisely the flaw both of your target eyes are trained to catch: the trader reads it as a grid that doesn't hold, and the auction-fluent eye reads it as a plate that isn't square in its mount. The typography, the mono kickers, the dated plate captions and the honest error copy are all genuinely good work — good enough that the misregistration is what's holding this page below the line, not the taste.
