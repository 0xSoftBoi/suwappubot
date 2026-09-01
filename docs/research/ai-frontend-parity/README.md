# AI-company front-end parity: where the bar is, where we are, what to do

Date 2026-09-01. Branch `claude/ai-company-design-research-lralmw`.
Sub-reports (each cites URLs; UNVERIFIED flags mean not confirmed from primary markup this session):

| File | Scope |
|---|---|
| `00-current-state.md` | Read-only inventory of showcase + webapp tokens, motion, layout, enterprise surfaces |
| `01-openai-anthropic-google.md` | Frontier labs: type, colour, layout, motion, trust portals |
| `02-vercel-linear-stripe-cursor-perplexity-mistral.md` | The premium-SaaS bar + Geist tokens to steal |
| `03-motion-graphics-techniques.md` | How the effects are built: shaders, scroll, micro-interactions, motion tokens |
| `04-enterprise-checklist-and-crypto-peers.md` | 40-item enterprise checklist + DeFi/fintech/TG-bot peer table |

Live-site screenshots were attempted (Playwright via the session proxy) but suwappu.bot reset the connection for headless Chromium, so the current-state section is from source, not pixels. Re-run `/design-iterate` locally for pixel judgement.

## 1. The bar, in one paragraph

Every top AI / AI-infra site in 2025-26 converges on the same recipe: one neutral canvas (near-black `#08090a`–`#171717` or warm paper `#f2f1ed`/`#faf9f5`), exactly one saturated accent used as a disciplined tint ramp, a custom or near-custom sans paired with a mono for anything technical, hierarchy carried by size and negative tracking rather than bold weight, hairline 1px borders instead of shadows, ONE big animated moment (WebGL/canvas gradient or particle hero) and restraint everywhere else, dense multi-column footers, mega-menu nav, and a dedicated trust portal (SOC 2 Type II, ISO 27001) that lives at its own URL. Anthropic is the deliberate counter-example (cream, serif-for-body, zero shadow, no motion), which proves the rule: the bar is coherence and craft, not any single effect.

## 2. Where Suwappu already meets it

From `00-current-state.md` and `docs/design/*`:

- Single accent (persimmon `#E58D2B`) with a stepped tint ramp, cool-neutral soil dark (`#0D0F12`) chosen for the same reason Linear/Vercel chose theirs. This is the Exa/Geist ramp pattern, already done.
- Serif display + sans body + mono numerals (Newsreader / Archivo / JetBrains Mono). Editorial contrast is the Exa/Cursor/Anthropic move. Done.
- Fluid clamp() type scale, 4px grid, five radius tiers, a real easing token (`cubic-bezier(0.22,1,0.36,1)`), 14+ `prefers-reduced-motion` guards. Better than most peers.
- A signature button silhouette (45° clipped corners), like Greptile's. Brand identity carried by shape, not just colour.
- Real WebGL figures (DepthSurfaceGL, ToolConstellationGL) and an owned, encoded hero video loop. We have the "one big moment" ingredient.
- Enterprise surfaces exist: pricing (/compare), risk/legal, docs, changelog, status, contact-sales form, OG/Twitter cards, robots, 4-locale i18n. Most DeFi peers have none of this (see 04, Thread B).
- Canonical `@suwappu/design-tokens` package consumed by all surfaces. Vercel-style single-sourcing.

Net: the token layer is at parity. The gap is in application depth, motion craft, mobile parity, and trust presentation.

## 3. Gap analysis (ranked by buyer impact ÷ effort)

| # | Gap | Evidence | Bar exemplar | Fix |
|---|---|---|---|---|
| 1 | WebGL figures are desktop-only; mobile gets blank/broken canvases | 00 §5, §9.2 | Vercel Ship: SVG placeholder first, canvas swapped in after compile (03 §1) | Ship a static/CSS fallback per GL component; lazy-init WebGL after first paint; gate on `matchMedia('(pointer:fine)')` + width |
| 2 | Motion is sparse and un-tokenised: framer-motion fades only, no stagger/scroll choreography, no duration ladder | 00 §3, §9.4 | Motion token set in 03 (100/200/300/500/800ms, Carbon eases, 40–80ms stagger) | Add `--sw-dur-*`/`--sw-ease-*` tokens to design-tokens; one Reveal variant with word/char stagger; 2–3 scroll-scrubbed moments max |
| 3 | Nav is 3 links + CTA; footer is minimal | 00 §4, §9.6, §9.10 | Anthropic/DeepMind mega-menu, 5–9 column footers (01 §common 8–9) | Product / Developers / Company dropdowns; footer grid: Product, Chains, Developers, Trust, Company, Legal |
| 4 | No public trust centre; security lives under /legal/risk | 00 §6; 04 Thread A #1–8 | trust.openai.com, trust.anthropic.com, linear.app/security | `/trust` page: custody model, KMS envelope encryption, audits, incident policy, `security.txt`, status link. Name custodians/partners the way Hyperliquid does |
| 5 | No logo wall / named customer proof | 00 §6 | Stripe customers, Polymarket media logos (04) | Monochrome logo strip of chains, venues, integrations we actually route through; one quantified case study |
| 6 | Light-only root, no theme toggle | 00 §9.1 | Vercel, Linear light/dark parity (02, 04 #32) | `.sw-dark` already exists; promote to `data-theme` on `<html>` with OS sync and a toggle in nav |
| 7 | Hero video has no pause control | 00 §9.5 | WCAG 2.2 pause/stop for auto-playing media (04 #26–29) | Pause/play button beside the sound toggle; respect reduced-motion by showing poster |
| 8 | Texture and depth: flat sections, no grain, boundaries are margins | docs/design/visual-study.md G1/G2 | SVG `feTurbulence` grain at 2–4% (03 §6), hairline rules | Grain overlay on dark bands; full-height hairline rails at column edges; ruled dividers |
| 9 | Tailwind v3 `@tailwind base` under v4 build: Preflight never renders | 00 §9.8 | — | Migrate `globals.css` to `@import "tailwindcss"` or add an explicit reset. Hidden CLS/consistency risk |
| 10 | Docs/changelog polish unaudited vs Mintlify-tier (search, code tabs, dark mode) | 04 Thread A #15–20 | docs.stripe.com, linear.app/changelog | Audit pass; add search and code-tab component if missing |

## 4. Recommended motion + texture token additions

```css
--sw-dur-1: 100ms;  /* state flip */
--sw-dur-2: 200ms;  /* hover, button */
--sw-dur-3: 300ms;  /* card, tooltip */
--sw-dur-4: 500ms;  /* panel, section reveal */
--sw-dur-5: 800ms;  /* hero stagger complete */
--sw-ease-in-out: cubic-bezier(0.2, 0, 0.38, 0.9);   /* Carbon productive */
--sw-ease-expressive: cubic-bezier(0.4, 0.14, 0.3, 1); /* hero moments */
--sw-stagger: 60ms;
--sw-grain-opacity: 0.03;
```
Keep the existing `--sw-ease` as the entrance default. Springs for magnetic/tilt: stiffness 300, damping 20, mass 1. Reduced motion: opacity-only at same duration, JS parallax/tilt gated at init.

Libraries (all free, all fit Next 15 + Tailwind v4): keep `framer-motion` (now `motion`) for React state motion; add GSAP + ScrollTrigger + SplitText only if we adopt scroll-scrubbed sections; Lenis only alongside GSAP; `postprocessing` if GL figures gain bloom/dither. Do not add Aceternity/Magic UI wholesale: cherry-pick BorderBeam and SpotlightCard patterns as our own components under `@suwappu/design-tokens` rules.

## 5. Suggested sequencing (each is one `/design-iterate` or one showcase-dev PR)

1. Gaps 1 + 7 + 9: mobile GL fallbacks, video pause, Tailwind reset. Correctness and a11y first, zero design debate.
2. Gap 2: motion tokens into design-tokens, stagger Reveal, apply to hero + one section.
3. Gaps 3 + 5: nav dropdowns, footer grid, logo/integration strip.
4. Gap 4: `/trust` page + `security.txt` + custodian/partner naming. This is the single largest enterprise-parity delta vs. crypto peers.
5. Gaps 6 + 8: theme toggle, grain and hairline rails.
6. Gap 10: docs/changelog audit.

## 6. What NOT to copy

- No second accent hue. The ramp discipline is what makes Exa/Geist look expensive.
- No motion everywhere. One hero moment plus 200ms hovers beats a parallax on every card.
- No stock illustration or generic 3D orbs. Our proof is live routing data and real venues; show product output (Exa E3/E4, Greptile G4).
- No unverified compliance badges. Only claim what is audited; describe the custody/KMS model factually until SOC 2 exists.
