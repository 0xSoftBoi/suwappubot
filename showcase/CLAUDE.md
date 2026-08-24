# showcase/CLAUDE.md — design-system canon

Read this before touching ANY page in `showcase/`. The recurring failure this
file exists to stop: new or edited pages picking up components/styles from an
older design era, so they render with a different brand than the rest of the
site (wrong nav, wrong palette, "some old library" look).

## The canonical system ("summer")

Every page MUST use, unless it already deliberately doesn't:

- **Nav:** `@/components/SummerNav` — sticky glass bar (light `rgba(255,255,255,.78)`
  base that composes with dark pages), persimmon logo, "Launch Terminal" CTA.
  This is the ONLY nav for new pages.
- **Footer:** `@/components/SummerFooter`.
- **Tokens/classes:** the `summer-*` classes (`summer-page`, `summer-shell`,
  `summer-kicker`, `summer-button`, `summer-actions`, `summer-code`) defined in
  `src/app/summer-token-vars.css` / `site.css`, plus the `mkt-*` layout classes
  and `institutional-*` section classes (both belong to the current era and
  compose with summer tokens).
- **Type:** the site's existing stack (serif display = EB Garamond via the
  summer tokens; mono for labels). Never add a new font without a brand
  decision.

## Legacy — do NOT use on new pages

- **`@/components/Navigation`** (+ `NavDrawer`, `NavMenuData`) — the old light
  nav ("Sign in / Talk to sales / Open Bot"). ~20 older interior pages still
  import it (about, pricing, research, contact, legal, docs layout, …). Do not
  copy imports from those pages; migration to SummerNav is tracked separately —
  don't grow the legacy set.
- `src/app/classic/` — the archived previous home page. Reference only.
- `src/app/hero-a` … `hero-e` — hero experiments. The live home imports
  `hero-d/hero-d.css`; treat the others as dead.

## Known traps

- **No CSS reset is emitting anywhere.** `globals.css` uses Tailwind v3
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
