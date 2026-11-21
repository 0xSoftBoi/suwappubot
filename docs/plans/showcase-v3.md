# Showcase v3 — visual brief

Started 2026-11-20. Branch `claude/sleepy-darwin-stwqqs`. Builds on
`docs/plans/showcase-redesign.md` (structure, header, forms, reset — done).
v2 made the site correct and consistent. v3 makes it *beautiful*: every section
should show the product, not describe it in a grid of text cards.

## What is wrong with v2 (from full-page captures of production)

- Text walls. Almost every section is "heading + 3–8 text cards". No section
  has its own picture.
- Zero motion. Nothing reveals, counts, draws or responds beyond hover colour.
- The hero product shot is cropped, low-contrast and static.
- Sections are visually identical (same dark slab, same hairline grid), so the
  page has no rhythm and no memorable moment.
- Admin and customer dashboards are functional but plain: flat tiles, bare
  empty states, no loading skeletons.

## Direction

Keep the brand: deep-ocean dark home, cream/navy interior pages, Newsreader
display serif, Archivo UI, mono labels, one orange accent. Do not add fonts or a
new palette. Add **craft**:

1. **Every major section gets a bespoke visual** built in code (inline SVG, CSS,
   small `<canvas>` only where needed). Schematic and precise, like a technical
   instrument — thin strokes, mono labels, the orange accent used sparingly.
   Examples:
   - cross-chain route map: chain nodes with a path drawing between them;
   - intent → quote → simulate → authorize as a connected flow with a travelling pulse;
   - venue ranking as bars settling into order;
   - portfolio across chains as a stacked/ring composition;
   - signals as live-looking sparklines (clearly illustrative, see Honesty).
2. **A motion system**, small and consistent: reveal-on-scroll (opacity +
   8–16px translate, 400–600ms, staggered), SVG stroke draw-on, count-up for
   real numbers, a slow ambient loop where it earns it (hero), pointer-reactive
   glow on cards. Transform/opacity only. Nothing loops faster than ~6s. All of
   it off under `prefers-reduced-motion` (final state shown, no animation).
3. **Rhythm**: alternate section treatments (full-bleed visual, split
   text/visual, bento grid, quiet text band) so no two neighbours look alike.
   Bento cards carry a mini-visual each, not just copy.
4. **Depth and light**: layered gradients, soft glows behind key objects, fine
   grain/noise, 1px inner highlights on glass surfaces, real shadows. Subtle.
5. **Product UI polish** (admin + dashboard): skeleton loaders, designed empty
   and error states, better charts (axis, hover readout, area fill), clearer
   hierarchy, consistent cards.

## Hard rules

- **Honesty.** No invented metrics, logos, testimonials, customers, prices or
  live-looking data presented as real. Numbers on the page must already exist in
  the codebase/messages. Illustrative visuals must read as diagrams (schematic,
  labelled with real chain/venue names the product supports), never as fake
  screenshots of real activity. The hero LiveQuote stays honest ("unavailable"
  when it is) — never mock it.
- **Copy.** Prefer zero new copy. Reuse existing message keys. Any new visible
  string goes into all four locales (`messages/en|fr|es|zh.json`) together.
  Labels inside diagrams that are proper nouns/tickers (Base, Solana, USDC,
  HyperLiquid) need no translation.
- **Canon.** Read `showcase/CLAUDE.md` first. Header/footer/forms/search are
  done — do not restyle the header. Widgets use `@ui-sdk/react`. Buttons use the
  shared button system in `foundation.css`.
- **Shared kit lives in `showcase/src/components/v3/`** (+ `src/app/v3.css`,
  imported in `layout.tsx` before `foundation.css`). Later phases reuse the kit;
  do not fork a second motion or card system.
- **Performance.** No new dependencies. No heavy canvas loops off-screen (pause
  with IntersectionObserver). Decorative graphics are `aria-hidden`. No layout
  shift from late-mounting visuals: reserve space.
- **Quality bar.** 1440 and 390, no horizontal overflow, one `<h1>`, visible
  focus rings, AA contrast for text. `bun run build` passes (bun only).
- **Process.** No tests. No push. Commit at the end of the phase with a clear
  message and the trailer
  `Claude-Session: https://claude.ai/code/session_01Q6t8ezxDB3RqjtL7NKg6xG`
  (no Co-Authored-By; `HUSKY=0`). Do not commit `.claude/harness/journal`.

## Phases

1. Kit + home page.
2. Sales pages: pricing, enterprise, contact, compare, security, solutions.
3. Product & content pages: products, agents, arbiter, autopilot, passport,
   agent-terminal, signals, reserve, research, about, careers, changelog,
   status, architecture, government, docs landing, 404.
4. Product UI: `/admin` and `/dashboard`.
5. Art-direction review of rendered output, then fixes.

## Log

- 2026-11-20 Phase 1: v3 kit (`showcase/src/components/v3/`, `src/app/v3.css`) + home page rebuilt on it (framed hero desk, bento use cases, animated intent->authorize flow, venue-rank + route-map stage, signal sparklines, cream portfolio interlude with ring, MCP tool orbit, quiet gov band, mesh close). Verified at 1440/390 incl. reduced motion; no overflow, one h1, no console errors. Gotcha: globals.css `.sw-dark [class*='card']` flattens any class containing "card" (hence `v3-tile`).
- 2026-11-21 Phase 2: sales pages rebuilt on the kit (pricing, enterprise, solutions, compare, security, contact). New kit `Schematics` (AuthorityFlow, EvidenceStack, TierLadder) + shared `src/app/sales-v3.css` (sv3- prefix). Pricing: depth cards with dominant Premium + fee meters, instrument fee calculator (scaleX bars, ticks, lit winner), slab visual, table rhythm. Enterprise: CountUp stats, one schematic per question. Compare: derived score meters, glass matrix. Security: custody diagrams + bento with pictograms. Contact: form beside dark "next" panel. Verified 1440/390, no overflow/errors. Gotcha: building while `next start` runs serves unstyled pages (stop server first). Compare sticky thead was dropped (collided with category rows).
- 2026-11-21 Phase 3a (product pages): shared `src/app/product-v3.css` (pv3- prefix). /products: bento gallery (MiniViz per Trade item, Sparkline bento for Intelligence, ToolOrbit + link rows for Build, light tone for Company), RouteMap hero. /passport: AuthorityFlow concept schematic (human proof -> hook check) and a calm dashed "not live in this environment" state (no raw error strings, no red). /agents, /agent-terminal: ToolOrbit / AuthorityFlow hero, Reveal on sections. /arbiter, /autopilot: AuthorityFlow stage + Reveal, data views untouched. /reserve: mesh/grid backdrop only (hero card already a visual). /signals is a redirect to /dashboard/signals (phase 4). Gotcha: `pkill -f next-server` is needed before a build (plain `next start` pkill misses it); view.js on /autopilot hangs on live polling.
- 2026-11-21 Phase 3b (content pages): shared `src/app/content-v3.css` (cv3- prefix). Kit additions: `ExecutionPlane` (system schematic, wide + stacked layouts) and `DeadEnd` (404 route graphic). /about (ChainRing hero, stat strip, numbered principles, RouteMap + surface rows), /architecture (ExecutionPlane drawn from the page's own pipeline/surfaces/custody copy, numbered boundaries on a dark band), /changelog (rail + dated nodes + tag chips), /status (gauge + instrument rows with honest unknown/skeleton states; only the current latency reading, no history), /careers (designed empty-roles state, TierLadder for the hiring steps), /government (AuthorityFlow Commit/Lattice/Materialize in hero; body unchanged), /research (backdrop only; page already had real figures), /docs landing (backdrop + tile depth, layout unchanged), 404 (DeadEnd), /legal/* (typography/rhythm only). Verified 1440/390 no overflow/errors.
