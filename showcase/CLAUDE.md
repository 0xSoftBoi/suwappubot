# showcase/CLAUDE.md — design-system canon

Read this before touching ANY page in `showcase/`. The recurring failure this
file exists to stop: new or edited pages picking up components/styles from an
older design era, so they render with a different brand than the rest of the
site (wrong nav, wrong palette, "some old library" look).

## The canonical system ("summer")

Every page MUST use, unless it already deliberately doesn't:

- **Nav:** `@/components/SummerNav` — the ONLY header. Sticky glass bar:
  brand · four panels (Products / Solutions / Developers / Resources) ·
  Pricing · a globe language menu (`LanguageMenu`, `@ui-sdk/react` menu) · one
  orange "Launch Terminal" CTA. Behaviour is `@ui-sdk/react`
  (`navigation-menu`, `dialog`, `accordion`); styles are `src/app/nav.css`,
  keyed on `data-slot` + state attributes. Dark pages get the dark header from
  an ancestor `.sw-dark` / `.summer-page--cosmic` / `.summer-page--passport`,
  or `<SummerNav tone="dark" />` — never re-patch header colours per page.
  New routes go in `NavMenuData.ts` (+ `nav.menu.*` in all four locales), not
  in the top row. The four-pill `LanguageSwitcher` lives in the mobile sheet
  and the footer only.
- **Home hero is one idea:** a headline of seven words or fewer, one line of
  subhead, exactly two buttons (primary action + "For agents"), one product
  capture. No kicker, announcement bar, floating chips or ambient audio. Proof
  under it is the "ROUTES THROUGH" text row (real venues from generated stats,
  never third-party logos, never "trusted by") and dated real counts.
- **Interactive widgets:** build menus, dialogs, accordions, comboboxes, tabs
  and form fields on `@ui-sdk/react/<name>` (live examples: `SummerNav`,
  `docs/DocsSearch`, `EnterpriseContactForm`, `FooterNewsletterForm`) (version-matched docs in
  `node_modules/@ui-sdk/react/docs/`). Do not hand-roll `role=`/`aria-*` state.
- **Footer:** `@/components/SummerFooter` (goes dark automatically under the
  same dark ancestors as the header).
- **Shared rules:** `src/app/foundation.css` (loaded last) owns the top offset
  under the header (`--page-top`), hero gap, the button system, mobile gutters
  and interaction defaults. Use `var(--page-top)` for a new page's first
  padding; do not add header clearance by hand (the header is sticky, not fixed).
- **Tokens/classes:** the `summer-*` classes (`summer-page`, `summer-shell`,
  `summer-kicker`, `summer-button`, `summer-actions`, `summer-code`) defined in
  `src/app/summer-token-vars.css` / `site.css`, plus the `mkt-*` layout classes
  and `institutional-*` section classes (both belong to the current era and
  compose with summer tokens).
- **Display type:** use `--type-display-font` / `--type-d1…d4` /
  `--type-display-weight` / `--type-display-tracking`. The old `--font-display`
  alias (it resolved to sans) has been deleted; use `--font-sans` for UI text.
- **Type:** the site's existing stack (serif display = Newsreader via the
  summer tokens; Archivo for body/UI; mono for labels). Never add a new font
  without a brand decision (see docs/design/serif-decision.md).

## Legacy — do NOT use on new pages

- `/classic` and `/hero-a` … `/hero-e` are removed and permanently redirect to
  `/` (next.config.mjs). `src/app/hero-d/hero-d.css` stays: the live home
  imports it.

## Known traps

- **Reset is `foundation.css`, not Tailwind.** Global `box-sizing: border-box`
  lives there. The paragraph below is why Preflight is absent:
- **Tailwind Preflight does not emit.** `globals.css` uses Tailwind v3
  directives (`@tailwind base`) but the build runs the v4 PostCSS plugin, so
  Preflight never renders. UA defaults (body margin, etc.) are live on every
  route — set explicit margins/box-sizing; don't assume a reset. Repo-wide fix
  is a separate tracked task.
- `.home-section`/`.home-hero` are `border-box` now — keep any new section
  container `box-sizing: border-box` or its padding will overflow mobile and be
  silently clipped by `.hd { overflow: clip }`.
- `next.config.mjs` redirects `/engine /terminal /hyperliquid /tempo` to home
  anchors — those `id`s must keep existing on `/`.
- The hero's LiveQuote widget needs `SUWAPPU_DEMO_KEY` and demo-agent credits;
  without them it renders an honest "unavailable" state. Never mock it.

## Definition of done for any visual change

1. `bun run build` passes (bun only — never npm/npx/tsc).
2. Render locally (`bun run start`, localhost bypasses the sandbox proxy) and
   screenshot desktop 1440 + mobile 390. **Compare the nav and palette against
   `/` — if they differ, you imported the wrong era.**
3. Mobile `document.documentElement.scrollWidth` must equal the viewport width,
   AND spot-check right-edge text isn't clipped (overflow:clip can hide it).
4. Every link/CTA you add must be clicked or curl-verified — no dead buttons,
   no placeholder hrefs, no invented URLs.
5. All four locales (`messages/en|fr|es|zh.json`) updated together when copy
   changes.

## v3 kit (`src/components/v3/` + `src/app/v3.css`)

Reuse; do not fork a second motion/card system. Tone-aware via `--v3-*` vars
(dark under `.sw-dark`/`.v3-tone-dark`, cream/navy under `.v3-tone-light`).
Import from `@/components/v3`.

- `Reveal` (`stagger`, `delay`): scroll-entry rise; visible without JS/reduced motion.
- `CountUp`: real numbers only (final value in SSR HTML).
- `SpotlightCard` + `MiniViz kind`: bento card with pointer glow and pictogram slot (`.v3-bento`, `.v3-span-2`).
- `V3Section` / `SectionHead` / `Backdrop` (mesh, glow, grid, grain): section layouts and headers; `.v3-split` for text/visual.
- Graphics (all `aria-hidden`, paused off-screen via `Live`, static when reduced motion): `RouteMap`, `PipelineFlow`, `VenueRank`, `ChainRing`, `Sparkline`/`SparkCard`, `ToolOrbit`, `BoundaryRings`, `ProductFrame`.
- Traps: never name a class with "card" in it (globals.css `.sw-dark [class*='card']` flattens it); diagrams use real names only and show no invented numbers.

