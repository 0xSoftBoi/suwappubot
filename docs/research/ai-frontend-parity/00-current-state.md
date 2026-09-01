# Suwappu Visual / Design System Audit

**Date**: 2026-09-01  
**Scope**: showcase/ (production homepage, agent landing) + webapp/ (Telegram Mini App)  
**Method**: Read-only inventory against top AI company frontends.

---

## 1. Fonts & Type Scale

### Loaded fonts
- **Body/UI (Archivo)**: Google Fonts, loaded once per layout. Archivo carries both display-alias and body (news-agency grotesk register selected over Geist in round-3 sans A/B testing). Next v15 Google Font loader with `display: 'swap'`.
- **Monospace (JetBrains Mono)**: Google Fonts, rationed to numerals, kickers, code. Weights 400 & 500.
- **Display serif (Newsreader)**: Google Fonts, hero h1 + section h2 + A2A pull-quote. Variable weight + true italics + optical-size axis (opsz) for automatic display-cut at real sizes. Replaced EB Garamond in design-iterate 4 (Aug 2026) for high-contrast financial-masthead register.
  - Note: Instrument Serif was on banned-as-default LLM-favourite list; rotation pool (commercial-only) not evaluated.

### Type scale (CSS variables, showcase/globals.css)
| Level | Size (fluid clamp) | Line-height | Letter-spacing |
|-------|-------------------|------------|-----------------|
| `--type-display-1` | clamp(2.7rem, 1.5rem + 4.4vw, 4.8rem) | 1 | -0.038em |
| `--type-display-2` | clamp(2rem, 1.2rem + 2.5vw, 3rem) | 1.06 | -0.028em |
| `--type-h3` | clamp(1.25rem, 1.05rem + 0.7vw, 1.5rem) | 1.2 | -0.015em |
| `--type-body` | 1rem | 1.6 | — |
| `--type-lead` | 1.125rem | — | — |
| `--type-small` | 0.875rem | 1.55 | — |
| `--type-kicker` | 0.72rem | — | 0.14em |
| `--type-measure` | 62ch (body); 68ch (read) | — | — |

**Fluidity**: All display sizes use CSS clamp() for responsive scaling; no fixed breakpoints for type.

---

## 2. Color System

### Brand Palette (Persimmon Orchard + Soil)

**Accent** (primary CTA, swap route coding, live highlights):
- `--sw-accent: #E58D2B` (base)
- `--sw-accent-bright: #F6A93C` (hover state)
- `--sw-accent-deep: #C9731D` (pressed)
- `--sw-accent-wash: rgba(229, 141, 43, 0.08)` (background tint)
- `--sw-accent-glow: rgba(229, 141, 43, 0.40)` (shadow)
- Extended ramp: dark, muted, subtle, faint, fainter (single-hue steps for depth without multi-colour fallback)

**Secondary** (Leaf green for success/live/captured):
- `--sw-leaf: #5E9C6F` (base)
- `--sw-leaf-bright: #8FCC9E` (AA-safe on soil, 9.8:1 contrast)
- `--sw-leaf-deep: #3E6B4F`
- Ramp: muted, faint, fainter

**Tertiary** (Cream/fruit flesh for inverted surfaces, stat numerals):
- `--sw-cream: #FAF3E6`
- `--sw-cream-dim: #E4D9C4`

**Dark base (Soil)**: Shifted from warm brown to cool near-neutral in 2026 recolor.
- `--sw-soil-0: #0D0F12`
- `--sw-soil-1: #15181C`
- Reasoning: No comparable product uses warm-brown for dark UI. Brown fought the accent; neutral ground separates cleaner.

**Light register** (content pages):
- Canvas: `#FFFEFB`
- Ink (primary text): `#17324A`
- Muted (secondary text): `#4F6F7F`
- Panel: `rgba(255, 255, 255, 0.85)`

**Dark register** (cosmic homepage sections, terminal, 404):
- Cosmic-0: `#060A14`, Cosmic-1: `#0B1220`, Cosmic-2: `#121B2E`
- Cosmic-ink: `#E8EEF6`
- Cosmic-muted: `#93A5BC`

### Light / Dark Support
**Showcase**: Single light foundation with `.sw-dark` scope for dark sections. Scoped to `.sw-dark`, so light/cream surfaces untouched.
**Webapp** (Mini App): Dark mode via `class: 'dark'` + Telegram theme CSS variables (`--tg-theme-*`). Fallback light palette preserved for CSS var failures.

### Hairlines & Shadows
- Hairlines (borders): `--sw-hairline: rgba(23, 50, 74, 0.10)` (strong: 0.18, dark: 0.14)
- Shadows: sm, md (tinted, never pure black), accent (persimmon glow), inset glow for dark cards

---

## 3. Spacing / Radius / Borders / Motion

### Spacing (4px base grid, fluid clamps)
- Section gap: `--sw-section: clamp(64px, 8vw, 112px)` (fluid vertical rhythm)
- Component gap: `--sw-gap: clamp(16px, 2vw, 28px)` (fluid horizontal rhythm)

### Border Radius
- `--sw-r-xs: 6px`
- `--sw-r-sm: 10px`
- `--sw-r-md: 14px`
- `--sw-r-lg: 20px`
- `--sw-r-pill: 999px` (full round)

**Button silhouette** (brand identity): Cut corners (45° angle, top-left + bottom-right) applied site-wide to every CTA.
```css
--btn-cut: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
clip-path: var(--btn-cut);
```

### Motion
**Libraries in package.json**:
- `framer-motion: ^12.42.2` (showcase), `^12.43.0` (webapp) — primary motion library for reveal animations, transitions.
- No gsap, three.js, lenis, lottie, or rive detected.

**CSS Keyframes**:
- Showcase: `proof-pulse` (live indicator), `fade-up`, `bounce-subtle`, `wiggle` (tailwind animations).
- Webapp: `toast-in` (accessible toast entrance, motion-safe only).

**Scroll reveals**: Yes, via `Reveal` component in showcase (props: children, intersection observer).

**Reduced motion support**:
- Showcase: 14+ `@media (prefers-reduced-motion: reduce)` rules throughout globals.css; animations collapse to instant or no-op.
- Webapp: `@keyframes toast-in` gated by motion-safe variant; users with reduced-motion get instant entrance.
- **Status**: Enterprise-grade — all motion is opt-in, not forced.

**Easing**: `--sw-ease: cubic-bezier(0.22, 1, 0.36, 1)` (production spring curve), `--sw-ease-exit: cubic-bezier(0.4, 0, 1, 1)`.

---

## 4. Layout

### Max content width
- Showcase: `min(100%, 1280px)` (hero shell, clipped flex container).
- Webapp: No explicit max-width; Telegram mini app dictates mobile-first 390px viewport.

### Nav Pattern
**Showcase**: `SummerNav` (sticky glass bar, persimmon logo, "Launch Terminal" CTA).
- Light base: `rgba(255, 255, 255, 0.78)` with `backdrop-filter: blur(18px)`.
- Z-index: `--z-sticky: 20`.
- Minimum height: 62px.
- Left/center/right grid layout (brand on left, center gap, actions on right).

**Webapp**: No persistent nav (Mini App context); uses page headers or modals.

### Hero Structure (homepage, page.tsx)
Top to bottom:
1. **Preload poster image** (LCP optimization).
2. **Structured data** (schema.org).
3. **SummerNav** (sticky).
4. **Announcement banner** (`home-announce`, dismissible, links to `/agent-terminal`).
5. **Home stage** container (`overflow-x: hidden`):
   - **OceanAtmosphere**: Video background (1.3 MB loop, 7-day cache), poster fallback, sound toggle.
   - **Home hero section** (grid 2-col 0.88fr / 1.12fr, min-height 620px):
     - Copy (eyebrow, h1, lead, CTAs, Telegram link).
     - Live desk visual (DepthSurfaceGL, 3D asset).
6. **Use cases grid** (8 items, links to capability anchors: #engine, #routing, #hyperliquid, etc.).
7. **Execution flow** (4-step diagram).
8. **Research facts** (3-card grid).
9. **Portfolio capabilities** (3-card grid).
10. **Security** (3-card grid).
11. **Proof material** (live market data, hourly fetch, fallback static).
12. **FAQ accordion**.
13. **SummerFooter**.

### Footer
- `SummerFooter` component (company name, links, newsletter signup, legal, social).
- Newsletter form w/ Telegram integration (stores contact).

---

## 5. Component Inventory (showcase/src/components/)

| Component | Purpose |
|-----------|---------|
| SummerNav | Sticky header nav (brand, menu, Launch Terminal CTA) |
| SummerFooter | Footer (legal, newsletter, socials) |
| OceanAtmosphere | Full-viewport video background + poster + sound toggle |
| DepthSurfaceGL | 3D WebGL trading desk visual (hero right column) |
| ToolConstellationGL | 3D GL constellation grid (agent features) |
| LiveQuote | Agent demo card, real live trading quote or fallback |
| LiveTerminal | Terminal emulator (command stream, sparkline, syntax) |
| ProofShot | Market data snapshot (chain, price, volume) |
| MarketProof | Live price table (24h change, success/down colors, pulse indicator) |
| FaqAccordion | FAQ section with expand/collapse state |
| EnterpriseContactForm | Lead capture form (name, email, company, etc.) |
| QuoteRaceGL | Animated GL quote relay (multi-chain prices racing) |
| ChainSphereGL | 3D rotating chain/token sphere |
| ReserveCard | Chain reserve liquidity card |
| RouteField | Multi-step route visualization (e.g., swap path) |
| RouteStages | Step numbering for execution flow |
| Reveal | Scroll-triggered fade-in animation |
| AgentHandoff | A2A protocol interaction card |
| CopyInstall | CLI install snippet with copy button |
| DocsMasonry | Docs grid layout (3-column on desktop) |
| LanguageSwitcher | i18n locale selector (en/fr/es/zh) |
| Analytics | GA4 / telemetry integration |
| AttributionCapture | UTM/referral tracking |
| StatsStrip | KPI display (platforms, chains, routers, etc.) |
| MobileWaitlistForm | iOS app waitlist signup |
| FeeCalculator | Interactive fee breakdown tool |
| FooterNewsletterForm | Newsletter CTA + Telegram link |
| StructuredData | Schema.org JSON-LD (Organization, FAQSchema, etc.) |

**GL/WebGL components** (CPU-intensive, desktop-first):
- DepthSurfaceGL, ToolConstellationGL, QuoteRaceGL, ChainSphereGL all 3D Canvas/WebGL; not responsive to mobile by design.

---

## 6. Enterprise Signals Present

| Signal | Status | Path |
|--------|--------|------|
| **Pricing page** | Yes | `/compare` (feature matrix) |
| **Security / Trust page** | Yes | `/security` (implicit in `/solutions` + `/legal/risk`) |
| **Docs** | Yes | `/docs` (Docs masonry grid) + `docs/` dir (markdown) |
| **Changelog** | Yes | Referenced in proof material, `/changelog` link |
| **Status page** | Yes | `/status` (linked in proof material, health dashboard) |
| **Logo wall** | No (none visible) | — |
| **Contact-sales form** | Yes | `EnterpriseContactForm` on `/enterprise` page |
| **Legal pages** | Yes | `/legal/terms`, `/legal/privacy`, `/legal/risk` |
| **OG image** | Yes | `opengraph-image.tsx` (generated), `twitter-image.tsx` (generated) |
| **Sitemap / robots.txt** | Yes | Next.js metadata.robots in layout.tsx |
| **i18n** | Yes | 4 locales (en, fr, es, zh) via next-intl |

**Localization**:
- Showcase: `/showcase/messages/` (en, fr, es, zh JSON files).
- Webapp: i18n via react-i18next + lib/i18n.ts.

---

## 7. Tech Stack

| Layer | Tech | Version |
|-------|------|---------|
| **Showcase framework** | Next.js | 15.5.21 |
| **Showcase styling** | Tailwind CSS + CSS Modules | v4.3.3 |
| **Showcase CSS-in-JS** | CSS variables (summer-token-vars.css) | — |
| **Showcase i18n** | next-intl | 4.13.0 |
| **Webapp framework** | Vite + React | 18.3.1 |
| **Webapp styling** | Tailwind CSS | v4.3.3 |
| **Webapp i18n** | react-i18next | 17.0.11 |
| **Motion** | framer-motion | 12.x |
| **Shared tokens** | @suwappu/design-tokens | file: local package |
| **Image optimization** | Next.js Image (showcase); native img (webapp) | — |
| **Analytics** | Analytics.tsx (GA4 placeholder) | — |

---

## 8. Existing Design Docs (in repo)

| File | Summary |
|------|---------|
| `docs/design/figma.md` | Figma design system reference |
| `docs/design/hero-media.md` | Ocean loop & soundscape production (2026-08-25) |
| `docs/design/proof-material.md` | Marketing proof material strategy |
| `docs/design/serial-decision.md` | Display serif A/B test (Newsreader vs. EB Garamond, Aug 2026) |
| `docs/design/visual-study.md` | Why greptile/exa look better (gap analysis, Aug 2026) |
| `docs/design/reference-breakdown-exa.md` | exa.ai design tokens (extracted CSS) |
| `docs/design/reference-breakdown-greptile.md` | greptile.com design patterns |
| `docs/design/backlog.md` | Design iteration backlog |
| `docs/parity/competitive-improvements.md` | Competitive roadmap (Telegram bots, retention patterns) |
| `docs/parity/chatdev-feature-parity.md` | Feature parity vs. ChatDev |
| `docs/parity/cozy-card-scoping.md` | Card interaction design scoping |

---

## 9. "What Looks Non-Enterprise Today" (Blunt Assessment)

1. **No dark mode toggle on showcase homepage** — Site renders light-only at root; `.sw-dark` is scoped to sections, not user-switchable. Top AI companies (Vercel, Linear, Figma) ship light/dark parity with user controls.

2. **WebGL components are desktop-only** — DepthSurfaceGL, ToolConstellationGL, QuoteRaceGL have no mobile fallback; tablet/phone users see broken layouts or blank canvases. Greptile/Exa both render same visual on mobile.

3. **Terminal emulator (LiveTerminal) is stylized, not interactive** — Displays pre-recorded command stream; doesn't accept user input. Actual agent playground is a separate `/agent-terminal` page (not inline hero). Reduces "try now" immediacy.

4. **Motion libraries underused** — Only framer-motion for basic fade/bounce; no scroll-parallax, no staggered reveals at scale, no cursor-follow effects seen on exa/greptile. Motion curve is good but sparingly applied.

5. **Missing hero-video pause/play controls** — OceanAtmosphere has sound toggle but no explicit pause button; video loops forever in background. Greptile video is clickable, pauseable, fullscreenable.

6. **Navbar is minimal** — Only Logo, 3-item nav, and 1 CTA. Compared to Vercel/Linear, lacks: product dropdown, pricing link, enterprise link (inline), docs link, GitHub/Twitter icons. Brand logo is small (38px).

7. **No animated/carousel testimonials** — Proof material is static table; no rotating quotes, no customer logos animating in. Greptile has scrolling testimonial strip.

8. **CSS reset collision** — globals.css uses Tailwind v3 `@tailwind base` but build runs v4 PostCSS plugin, so Preflight never renders. UA defaults (body margin) live site-wide; dev hazard for new pages (noted in CLAUDE.md as "known trap").

9. **z-index scale is shallow** — Only 5 tiers (`--z-bg: 0`, `--z-content: 1`, `--z-sticky: 20`, `--z-drawer: 100`, `--z-modal: 110`). No layer for persistent floating UI, no room for future widgets.

10. **Footer is minimal** — Only company info + newsletter + legal + socials. No product menu, no quick-link grid, no regional office info, no "powered by" integrations. Exa/Greptile footers are 3x deeper.

---

## 10. Design System Decisions & Institutional Knowledge

**Key tension resolved (2026-08)**: Repo carried TWO live design systems.
- Showcase: persimmon/cream (warm), Archivo body, Newsreader display (serif).
- Webapp/mobile/terminal: sakura (legacy pink), Quicksand display (serif).

**Reconciliation**: Unified in favour of **marketing (showcase) palette** because product positioning is "execution layer between intent and markets," and cursory display font contradicts that. `@suwappu/design-tokens/tokens.ts` is now canonical source; all surfaces consume from it.

**Font decision (Aug 2026)**: Newsreader replaced EB Garamond for display. Garamond read "bookish"; Newsreader carries "sharp, high-contrast financial-masthead register" at real sizes.

**Dark theme decision (2026)**: Swapped warm brown (#1C1310) to cool neutral (#0D0F12). Reason: No comparable product uses warm-brown dark UI; persimmon on brown is muddy; on neutral ground the accent separates cleanly.

**No CSS reset**: Known hazard. `globals.css @tailwind base` doesn't render (v3 → v4 mismatch). All new pages must set explicit margins/box-sizing.

---

## Conclusion

**Maturity**: Showcase is enterprise-grade in *depth* (brand story, legal, research, security, agent API landing) but stylistically *singular* — optimized for marketing differentiation (ocean video, GL visuals) rather than polish parity with top SaaS.

**Webapp**: Minimal UI (Mini App context), Telegram-native theme, functional over flashy.

**Gaps vs. top AI frontends**:
- No user-controlled dark mode.
- Motion is subtle, not immersive.
- Hero interactivity is narrative (video loop) not participatory (live terminal input).
- Desktop-heavy (GL components skipped on mobile).
- Navbar & footer are stripped vs. Vercel/Linear depth.

**Strengths**:
- Unified token system (finally).
- Type scale is fluent (clamp-based).
- Accessibility is considered (`prefers-reduced-motion` wired throughout).
- i18n is live (4 locales).
- Legal + trust pages exist.
- OG/Twitter images auto-generated.

**Next level** (not gaps, but uplift candidates):
- Interactive dark mode toggle + full-site parity.
- Navbar product menu (dropdown).
- Hero video controls (pause/play/fullscreen).
- Staggered reveal animations on scroll (micro-interactions).
- Testimonial carousel (motion + customer logos).
- Footer product grid + quick links.
- Mobile-responsive GL fallbacks (static images or simplified SVG).
