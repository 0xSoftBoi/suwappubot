# Creative direction: the institutional register, on the front door (2026-09-01)

Steer: "more traditional finance." Research grounding: `docs/research/ai-frontend-parity/` (labs, wrappers) plus `09-traditional-finance-sites.md` and `10-institutional-crypto-sites.md` once those land. Prototype: `docs/design/prototypes/hero-institutional.html`.

## Thesis

Suwappu already owns a credible finance-house register. `/research`, `/enterprise` and `/architecture` run `institutional.css`: paper canvas, navy ink, hairline rules, editorial serif, evidence-first hierarchy. The homepage does not. A bank's front door and its research library look the same; ours do not. The direction is to make the homepage the cover of the prospectus, not a launch page.

The register is **a prospectus, typeset**: paper, ink, rules, small caps, tabular figures, a document card where a startup would put a hero animation, disclosures in the footer that a compliance officer would recognise. Persimmon survives as the one heraldic accent: a thin rule, a seal, a single CTA. Never a wash.

## Tokens (all existing, from `institutional.css` and `globals.css`)

| Role | Token | Value |
|---|---|---|
| Canvas | `--institutional-canvas` | `#FBFAF5` |
| Panel | white | `#FFFFFF` |
| Ink | `--institutional-ink` | `#17324A` |
| Muted | `--institutional-muted` | `#587180` |
| Rule | `--institutional-line` / `-strong` | `rgba(23,50,74,.14)` / `.24` |
| Accent | `--sw-accent-deep` | `#C9731D` (the deeper step reads better on paper than `#E58D2B`) |
| Settled | `--sw-leaf-deep` | `#3E6B4F` |

Type: Newsreader (display, 400 and 500, optical size on), Archivo (body and small caps labels), JetBrains Mono (figures only). Max width 1240.

## What changes on the homepage

1. **Hero = an execution report, not an animation.** Right column is a trade-confirmation-style document: order, venues considered, selected venue, filled amount, price impact, network cost, fee disclosure, settlement receipt. Data from `/api/quote`, else `captured-quote.json`, always dated and labelled. This is the traditional-finance form of "the page is the product": a confirm, not a race.
2. **A regulatory strip above the nav.** One line: what we are and are not. Banks do this; it is the cheapest trust device there is.
3. **Tombstone figures.** 45 chains, 21 venues, 22 MCP tools, research-note count, set as Newsreader numerals between hairlines, like a deal tombstone. Footnoted.
4. **Research on the homepage.** Three real notes from `src/content/research.ts` in an Insights row. Asset managers lead with thought leadership; we already write it.
5. **Institutional band.** Custody / Execution / Reporting / Compliance in four ruled columns. Plain statements, including what we are not.
6. **Dense footer with a disclosure paragraph.** Six columns plus small-type disclosure. This single change moves the page from startup to institution.
7. **Motion nearly absent.** One 400 ms fade on load. Links underline on hover. Figures are tabular and still. Nothing pulses.
8. **The ocean loop and GL figures retire from the homepage.** They keep a home on the story page.

## Why this rather than the race board

- The buyer we want is a risk, treasury or trading desk. They trust documents, not choreography.
- It reuses a register that already exists in the repo and is already the strongest thing we have (the `institutional.css` header says so).
- It avoids every 2026 startup cliché in one move: no dark canvas, no hero shader, no bento, no marquee.

## Build notes

Prototype is dependency-free HTML/CSS. Port: `.institutional-page` on the home route, a `ExecutionReport` component fed by `LiveQuote`, the existing `institutional-section` blocks for the band, a new footer grid. Two showcase-dev PRs. Art-director gate before merge.
