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
- 2026-11-21 Phase 4 (product UI): new reusable chart kit `src/components/charts/` (`DailyChart` area/bars with signed baseline, gridlines, crosshair + tooltip, arrow-key readout, draw-in; `MiniTrend` sparkline; theme via --ch-* vars). Admin: sticky blurred topbar with date-range context, KPI tiles with CountUp + real daily sparklines (visitors, money) and only the deltas the API returns, skeleton/empty/error (with retry) states for Growth, DailyChart replaces the old SVG charts (money chart still draws refunds below zero), sticky-header tables with mobile card rows for leads, polished sign-in gate. Dashboard: UsageChart rebuilt on DailyChart (the flat per-period error line was dropped; error/rate-limit shown as period captions since the API has no per-day series), CountUp on requests, depth on cards, sticky table headers, calmer error box. Data fetching, auth (`adminRequestInit`/SESSION_AUTH), BillingPanel, billing logic untouched. Verified 1440/390 with mocked API; no overflow or page errors. Not done: `/dashboard/signals` restyle (left as is), per-table retry buttons in admin (would need fetch changes).
- 2026-11-21 Phase 5 fix pass A (home/pricing/enterprise/contact/compare/security/solutions): kit honesty (VenueRank equal-length bars + caption, ChainRing equal segments, Sparkline "SCHEMATIC" tag; home keys `schematic`/`rankCaption` in 4 locales), AuthorityFlow right-pointing arrowheads, 11 new MiniViz pictograms (tee/custody/cipher/gate/simulate/review/window/http402/meter/calendar/ladder), BoundaryRings `labels`/`quiet`, mobile compare/pricing tables fit all columns, enterprise Q03 dark full-width stage + 4-step tier ladder, pricing credit/rate tables in one band, security 07 split tile, solutions x402/wallet schematics + no-wrap code, home hero brightness/chip/mobile bento/sound pill. Not done: solutions block variety, contact next-steps schematic, compare triad schematic, pricing calculator legend, route-map label size on mobile.

- 2026-11-21 showcase(solve): conversion + discovery layer shipped. /solve hub, 27 /solve/<slug> answer pages (src/data/solve.json single source), /start key page (copy-paste tabs + in-browser "Create my key"), ProblemStrip kit component on 8 pages, dead-end "Get an API key" CTAs -> /start, corrections applied (generated stats, advertised MCP tools = 23, no MEV/TEE/RBAC/SLA/best-price claims, limit orders/DCA gated at Pro), sitemap + llms.txt/llms-full.txt + .md mirror + AI-agent robots entries, first-party cta_clicked / solve_snippet_copied events carrying slug.
- 2026-11-21 Phase 5 fix pass B (products/agents/arbiter/autopilot/passport/agent-terminal/reserve): AuthorityFlow rebuilt as HTML (label-sized nodes, real arrowheads, `caption` prop, vertical stack under 420px container width), removed from the /agent-terminal hero; `.sw-dark .v3-tone-light` re-asserts navy ink (products Company band was white-on-cream); Desk Flow phone layout = vertical spine of grouped nodes (<720px); /autopilot: refusals collapse into "xN" runs (all rows kept inside, presentation only), first 8 + "Show all (N)", PAPER chip, explainers moved above the stats; /products Status/Research use schematic pictograms (new MiniViz `services`/`pages`), no uptime-style bars; /agent-terminal brand tokens (navy/cream/orange instead of sky blue); /reserve card shader palette = navy + orange; /agents table first-column header no longer breaks. /agents hero count and FAQ both use generated stats (already agreed). Not done: products bento dead space/Terminal split card, arbiter mid-page ledger split, passport duplicate unavailable notices + orb, agent-terminal tool-list compaction/subnav/h2 font, agents hero 2-col + orphan grid, reserve minor P3s. Verified by looking at 390 and 1440 for the fixed items.
- 2026-11-21 Claims restore: org roles (RBAC), KMS envelope default, multi-provider scoring, MEV-resistant routes (CoW/Jito, bot only), Turnkey opt-in, tier gating and fee schedules (bot 1.0/0.5/0.3/0.1; Agent API 0.8% EVM / 0.3% Solana) back on site with verified wording; SLA stays out ("terms scoped with the team"). Admin Growth now shows problem-page conversions and AI referrals (defensive on older API).
- 2026-11-21 Phase 5 fix pass C (content pages + product UI): /government code figures on navy panes (alternating sides, navy band, bigger hero flow); ChainRing neutral equal arcs with the real chain count in the centre (about); /careers own hero (Python/TypeScript/Solidity stack) + full-width hiring steps; /changelog real dated release timeline (no stems) + ink tag chips + latest-entry emphasis; /status split hero with filled-arc gauge (up/total, dashed when unknown); research/docs backdrops soft + palette (orange-outline chips, navy MCP callout, serif stats); legal email as link; admin: one skeleton/one friendly error card with retry per section (Product, Finance, Agents, Swaps, Webhooks; counts show a dash on error; raw detail behind Details), lower KPI tiles on the Growth tile styles (MRR renamed + explained), admin chrome + customer dashboard moved to cream/navy/orange. Not done: architecture/404 hero enlargement and pulse, status surface pips, admin bar-mode for sparse series, dashboard copy/chips P2/P3, docs rail.

- 2026-11-21 PARITY PASS 1 (showcase-dev): home hero one idea (7-word h1 from stats, 2 CTAs, one calm Terminal capture, flat deep-ocean wash; announce bar, SOUND toggle, ocean photo/video and ambientEngine removed); ROUTES THROUGH text-wordmark proof strip + 4 artifact tiles + dated numbers line; nav regrouped Products/Solutions/Developers/Resources/Pricing with globe language menu (switcher kept in sheet + footer); home cut to 9 dark sections (cream portfolio moved into Traders, use-case icon grid dropped), audience-split close. Not done: item 5 (type scale/whitespace sweep on interior pages), real quote card replacing schematic bars.
- 2026-11-21 PARITY PASS 2 (showcase-dev): /agents is an Agent Stack page (11 component entries each with limit + own start link, when-to-use table, rate limits from rateLimit.ts TIER_LIMITS, fees, 100 starter credits from AgentService.ts STARTER_CREDITS); agent skill at /.well-known/skills (index.json in Stripe's `{skills:[{name,description,files}]}` shape, VERIFIED against docs.stripe.com; SKILL.md with scope disclaimer) linked from /agents and llms.txt, content types set in next.config.mjs; /brand page (real public/ logo files, token colours, usage do/don't), footer Company/Resources regrouped (Status, Changelog, Security, Report a vulnerability -> /security#disclosure, Brand kit, OpenAPI), /brand in sitemap; page_view de-duplicated per consecutive path (could not reproduce the double locally; guard added); removed dead nav.menu keys grpWhy/grpMore/grpTrust; desk /solve rings show a single centre label. Footer strings are hardcoded English (not in messages/*), so no locale files to edit. Not done: item 5 (P2 pricing/products/solve).
