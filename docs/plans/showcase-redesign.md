# Showcase redesign — systematic pass

Started 2026-11-13. Working branch: `claude/sleepy-darwin-stwqqs`.

## Standards we are working to

| Source | What it gives us | How we use it |
|---|---|---|
| [`vercel-labs/ui`](https://github.com/vercel-labs/ui) (`@ui-sdk/react`, beta) | **Behaviour only** — keyboard, focus, dismissal, ARIA, top-layer popups. Ships no styles. | Every interactive widget: nav menu, mobile menu, accordions, docs search, language select, forms. No more hand-rolled `aria-*`. |
| [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) | The visual/UX rubric (focus rings, hit targets, motion, layout, forms, copy). | The checklist every page is graded against (see "Page rubric"). |
| `showcase/CLAUDE.md` | The "summer" token/brand canon. | Palette + type stay; we tighten how they are applied. |

Note: `vercel-labs/ui` is not a design system. Anything visual in this plan
comes from the Web Interface Guidelines + our own tokens.

## Baseline audit (26 routes, 1440 + 390, production build)

No route overflows horizontally; all return 200. What is actually wrong:

**Nav (every page)**
- 10 top-level items + language + CTA crammed in a bordered pill at ~11px. No hierarchy.
- Hand-rolled mega menu (hover state in React, no arrow keys, no focus return) and drawer (`role="dialog"` with no focus trap, portal hack for `backdrop-filter`).
- Dropdown panel is cream `rgba(255,250,242)` — a previous brand era — under a cool-white bar.
- Dark pages: `/products` nav pill renders as an opaque grey block with unreadable links; `/passport` triggers are near-invisible.
- Hard-coded English ("Signals", "Research", "Explore all") beside translated labels.
- Internal links are `<a>` → full document reloads.

**Page shell**
- Three different content widths (about/careers ≈ 560px column, agents ≈ 1150px, arbiter its own).
- 150–250px of dead space between nav and the first line on most interior pages; hero → first section gap is larger still on pricing/research/solutions.
- Four unrelated visual eras live at once: warm-cream serif (most pages), cool sans (`/arbiter`), navy dashboard (`/autopilot`), black (`/products`, `/passport`), orange CRT (`/next`).
- Three primary-button treatments (orange gradient, navy solid, white).

**Page-specific defects**
- `/products`: H1 wraps one word per line.
- `/next`: hydration error (React #418), no nav, zero `<h1>`.
- `/signals`: sign-in card with no nav and the wrong `<title>`.
- `/reserve`: title is "… | Suwappu | Suwappu".
- `/for-agents` duplicates `/agents` (same content, two URLs).
- `hero-a…e`, `classic`: dead experiments still shipping as public routes.
- No CSS reset is emitted (Tailwind v3 directives on a v4 build).

## Phases

Each phase ends with: `bun run build` → local render → 1440 + 390 screenshots → commit.

### Phase 1 — Nav + mobile menu  ✅ shipped 2026-11-13
- Rebuild `SummerNav` on `@ui-sdk/react/navigation-menu`: brand · Products / Developers / Why Suwappu (panels) · Pricing · Docs · language · one primary CTA.
- Everything removed from the top row stays one hover away inside a panel (Signals, Research, Passport, Arbiter, Telegram).
- Mobile: `@ui-sdk/react/dialog` full-height sheet + `accordion`; real focus trap, scroll lock, Esc, top layer.
- One set of nav colour variables with a dark variant, so dark pages stop hand-patching the nav.
- `next/link` for internal routes, `aria-current` on the active page, all labels in 4 locales.

### Phase 2 — Foundation  ← next
- Emit a real reset (fix the Tailwind v3/v4 mismatch) and re-verify every page.
- One container (`--page-max`, `--page-gutter`), one vertical rhythm scale, one hero top offset.
- One button system (primary / secondary / ghost, 3 sizes) with hover/active/focus-visible; 44px touch targets on mobile.
- Global: `:focus-visible` ring, `prefers-reduced-motion`, `text-wrap: balance` on headings, `tabular-nums` on stats, `scroll-margin-top` on anchors, skip-to-content link, `theme-color` + `color-scheme`.

### Phase 3 — Footer
- Same link map as the nav panels, newsletter form on `@ui-sdk/react/field`, status + legal row.

### Phase 4 — Sales pages, in funnel order
1. `/` home  2. `/pricing`  3. `/products`  4. `/enterprise`  5. `/contact`
6. `/agents` (+ redirect `/for-agents`)  7. `/solutions`  8. `/compare`  9. `/security`

### Phase 5 — Product pages
`/arbiter`, `/autopilot`, `/passport`, `/agent-terminal`, `/signals`, `/reserve` — bring onto the shared shell; keep each product's own content area.

### Phase 6 — Content pages
`/docs` (search → `combobox`/`command`, sidebar → `accordion`), `/research`, `/changelog`, `/status`, `/about`, `/careers`, `/architecture`, `/government`, `/legal/*`.

### Phase 7 — Cleanup
- Remove or `noindex` `hero-a…e`, `classic`, `next`.
- Delete dead CSS (globals.css is 8,383 lines across several eras).
- Update `showcase/CLAUDE.md` (it still describes a legacy `Navigation` that no longer exists).

## Page rubric (applied to every page in phases 4–6)

1. One `<h1>`, hierarchical headings, correct `<title>`.
2. Shared container + hero offset; no dead space above the fold.
3. One primary CTA above the fold, one secondary at most.
4. Every interactive element: visible `:focus-visible`, ≥24px target (44px mobile), real `<a>`/`<button>`.
5. Widgets use `@ui-sdk/react`, not hand-rolled ARIA.
6. Motion: transform/opacity only, honours reduced motion, no `transition: all`.
7. Forms: labels, `autocomplete`, correct `type`/`inputmode`, inline errors, submit never pre-disabled.
8. Numbers `tabular-nums`; `…` not `...`; non-breaking space between number and unit.
9. Works at 390 / 1440 / ultra-wide; no clipped text; empty/error states designed.
10. All four locales updated together.

## Log

- 2026-11-13 — Baseline audit; `@ui-sdk/react` + `@ui-sdk/core` 0.1.0-beta.2 added. Phase 1 started.
- 2026-11-13 — Phase 1 done: `SummerNav` rebuilt on `navigation-menu` + `dialog` + `accordion`; `ProductMenu`/`NavDrawer` deleted; `nav.css` added; language switcher made theme-agnostic. Verified locally at 1440/1100/950/390: hover, Tab/Enter/Esc with focus return, client-side routing, sheet focus trap, no overflow. Not yet verified on a deployed URL.
