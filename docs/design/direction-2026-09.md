# Creative direction: "The Quote Race" (2026-09-01)

Companion to `docs/research/ai-frontend-parity/`. That folder says what the bar is. This says what Suwappu should *be*. Prototype: `docs/design/prototypes/hero-quote-race.html` (open it, or see the published artifact link in the PR).

## Thesis

Every wrapper site we admire has one idea: the page is the product. Ours is not yet. The homepage opens on atmosphere (ocean loop, GL ridge) and *tells* the visitor we route well. The direction flips that: the first thing anyone sees is a real quote being raced across venues and settling, in the time it takes to read the headline. Nothing on the page is decoration; every mark is an instrument reading.

The register is **a trading floor's timing board rendered as a broadsheet**: mono numerals, ruled rails, one warm accent for the live thing, and a serif headline that reads like a masthead. Not a SaaS template, not a crypto neon dashboard.

## What stays

- Tokens: soil `#0D0F12` / `#15181C`, persimmon ramp, leaf for settled/success only, cream for inverted chips and oversized numerals.
- Type: Newsreader display, Archivo body, JetBrains Mono rationed to numerals, kickers, code.
- The 45° cut-corner button. It is the one silhouette that is already ours.
- The headline: "The execution layer between intent and markets."

## What changes

1. **Hero = the race.** Right column is a live board: venue rows, output bars, mono amounts, elapsed time. The winning row locks in persimmon, the output numeral counts up to the real amount, a `settled` chip turns leaf. Data source order: live `/api/quote`, else `captured-quote.json` (2026-08-04), always labelled. The competing rows are labelled *simulated field* until we capture a real multi-venue race; we never imply all 21 venues raced (chain-gated, per `stats.generated.json` notes).
2. **Motion tied to execution speed.** Bars run 300–900 ms with `--sw-ease`; row stagger 40 ms; numeral count-up 800 ms; everything else 200 ms colour-only. No hover scale or translate on any data element. `prefers-reduced-motion` renders the settled board.
3. **Zero drop shadows.** Depth from hairlines (`rgba(255,255,255,.08)`) and a two-step soil ladder. Shadows only under product screenshots, if ever.
4. **Texture as instrument, not mood.** Full-height hairline rails at the content-column edges, corner registration marks on the board, a five-line ruled divider between sections, `feTurbulence` grain at 3 % on dark bands. The ocean loop moves to the story/about page.
5. **Trust stated plainly, near the fold.** A three-column band: custody (your keys, KMS envelope encryption `kms_aesgcm_v2`), routing (best output wins, fee shown before you sign), verification (every fill links to the block explorer). No badges we do not hold. `/trust` gets the depth.
6. **Venue strip, not logo wall.** The 21 real router names as a monochrome mono marquee. When we have named customers, they replace it.
7. **Nav and footer grow up.** Platform / Developers / Trust / Pricing in mono caps; footer grid Product · Chains · Developers · Trust · Company · Legal.

## Motion script (hero, cold load)

| t (ms) | Event |
|---|---|
| 0 | Board frame, rails and kicker visible at rest. Headline words at 0.6 opacity |
| 0–360 | Headline words rise to full, 60 ms stagger |
| 200 | Rows appear, 40 ms stagger |
| 300–1200 | Bars fill to output-proportional width, each with its own duration |
| 1200 | Winner locks: persimmon bar, cream numeral, leaf `settled` chip |
| 1200–2000 | Output numeral counts to 0.053066 ETH, tabular nums |
| 2000 | `replay` becomes available. Nothing else moves again |

## Why this beats the alternatives

- A WebGL gradient hero would put us level with 2024 Stripe clones. A race board is *only* ours.
- Cluely/Dia editorial drama optimises attention capture; our buyer needs numeric legibility (Factory, Raycast, Warp reference set).
- It answers the enterprise question ("does it actually route well?") in the first second without a single claim.

## Build notes

Prototype is dependency-free HTML/CSS/JS on Google-hosted Newsreader/Archivo/JetBrains Mono so it can be judged in a browser today; port is straightforward into `showcase/src/app/page.tsx` with `LiveQuote` supplying the winner row. Estimated port: one showcase-dev PR for the board component, one for nav/footer/trust band. Art-director gate before merge.
