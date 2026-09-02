# AI-company front-end parity: where the bar is, where we are, what to do

Date 2026-09-01. Branch `claude/ai-company-design-research-lralmw`.
Three passes: labs/infra, then the application-layer "model wrapper" companies, then traditional finance and institutional crypto after the founder steered toward a finance register. The chosen direction is `docs/design/direction-2026-09-institutional.md`. Every sub-report cites URLs; UNVERIFIED means not confirmed from primary markup this session (many sites block fetches).

| File | Scope |
|---|---|
| `00-current-state.md` | Read-only inventory of showcase + webapp tokens, motion, layout, enterprise surfaces |
| `01-openai-anthropic-google.md` | Frontier labs: type, colour, layout, motion, trust portals |
| `02-vercel-linear-stripe-cursor-perplexity-mistral.md` | Premium-SaaS bar + Geist tokens to steal |
| `03-motion-graphics-techniques.md` | How effects are built: shaders, scroll, micro-interactions, motion tokens |
| `04-enterprise-checklist-and-crypto-peers.md` | 40-item enterprise checklist + DeFi/fintech/TG-bot peer table |
| `05-coding-agent-wrappers.md` | Lovable, Bolt, Replit, Cognition, Windsurf, Factory, Warp, Raycast, Manus, Genspark, Cluely, Dia. Best token-level data |
| `06-vertical-enterprise-wrappers.md` | Harvey, Hebbia, Sierra, Decagon, Glean, Clay, 11x, Granola, Superhuman, Notion, Fin, Sana, Legora. How trust is made premium |
| `07-creative-audio-video-wrappers.md` | ElevenLabs, Runway, Suno, Pika, Higgsfield, HeyGen, Synthesia, Photoroom, Hume, Sesame. Product output as hero |
| `08-who-builds-them-and-how.md` | Agencies, design engineers, Framer vs hand-coded, component vocabulary, type and colour trends |
| `09-traditional-finance-sites.md` | Banks, asset managers, private banks, quant firms, exchanges, Bloomberg: the institutional grammar, 12 moves to lift, 5 to avoid |
| `10-institutional-crypto-sites.md` | Anchorage, Clear Street, Fireblocks, Circle, FalconX, Talos and peers: negative disclosure, entity naming, honest footers for a non-licensed execution layer |

2026-09-02: the showcase was built and served locally (`bun run build && bun run start -- -p 3459`) and screenshotted at 1440 and 390. Several claims in `00-current-state.md` were wrong against the render and are corrected in a note at its top. The founder rejected both re-theme prototypes (`docs/design/direction-2026-09*.md`): the standing brief is to keep the existing theme and reach parity in place.

## 1. The bar, in one paragraph

Labs and infra converge on: one neutral canvas, one accent used as a tint ramp, a custom or near-custom sans plus a mono, hierarchy by size and negative tracking rather than bold, hairline borders instead of shadows, one big animated moment and restraint elsewhere, dense footers, mega-menu nav, a trust portal at its own URL. The wrapper companies take the same rules further and add what actually makes them beautiful (05, 08):

- **Single-typeface discipline.** Lovable (Camera Plain), Bolt (Inter), Raycast (Inter with ss03), Factory (Geist) use one family and let weight and tracking do hierarchy. Where a serif appears it is one role only: Cluely's EB Garamond is hero H1 and nothing else.
- **The marketing page is the product.** Raycast's stated rule. Bolt, Warp, Manus, Julius put the real command input or UI in the hero. Pika embeds a generated video as the hero. No stock illustration, no abstract AI blobs.
- **Zero drop shadows.** Factory bans shadows, glows and blurs outright. Warp, Raycast, Dia build depth from a grey ladder and 1px hairlines. Lovable uses inset shadows on buttons instead.
- **One accent, CTA and live-status only.** Raycast `#ff6363`, Factory `#ee6018` plus metric green `#a0ca92`, Cluely `#3c83f6`. Everything else achromatic.
- **Motion tied to the product's own speed.** Factory: 150–200ms, `cubic-bezier(0.4,0,0.2,1)`, modelled on CLI response. Dia forbids hover scale and translate, colour transitions only.
- **Warm, not pure, canvases.** Lovable `#f7f4ed`, Warp `#2b2622` (oklch 22% with a brown cast), ElevenLabs `#f5f5f5` with pastel orbs, Anthropic `#faf9f5`. Cool dark is Raycast `#07080a`, Factory `#101010`, Runway `#000000`.
- **Trust made premium, not dumped** (06). Glean names it "Glean Protect". Notion says "Trusted by 98% of the Forbes Cloud 100" instead of a logo wall. Sierra and Fin cite AI-specific assurance (EU AI Act, AIUC-1). Legora conveys institutional trust through warm photography and frosted glass, badges in the footer, deep detail on `security.legora.com`.
- **Who builds them** (08). A small cluster: Kimera, ABC Dinamo, basement.studio (Vercel, ElevenLabs, Harvey, Krea), Smith & Diction (Perplexity, Superhuman), Metalab (Windsurf), Bakken & Bæck (Sierra: Next.js + Framer Motion + Rive), E&W Studio (11x, Sana, Legora), Ragged Edge (Granola). Framer is confirmed for Cluely and Legora only; Webflow for Decagon, Glean, Clay, 11x, Sana; the rest are hand-coded Next.js. The look is not a Framer artefact, it is discipline plus a real type licence.

## 2. Where Suwappu already meets it

From `00-current-state.md` and `docs/design/*`:

- Single accent (persimmon `#E58D2B`) with a stepped tint ramp, cool-neutral soil dark (`#0D0F12`). Same reasoning as Linear, Vercel, Factory.
- Serif display + sans body + mono numerals (Newsreader / Archivo / JetBrains Mono). Harvey and Legora use exactly this "serif = gravitas, sans = precision" grammar for institutional buyers.
- Fluid clamp() type scale, 4px grid, five radius tiers, a real easing token, 14+ `prefers-reduced-motion` guards.
- Signature 45° clipped-corner button silhouette. Identity carried by shape.
- Owned WebGL figures and hero video loop. The "one big moment" ingredient exists.
- Pricing, risk/legal, docs, changelog, status, contact-sales, OG cards, 4-locale i18n. More than any DeFi peer.
- Canonical `@suwappu/design-tokens` consumed by all surfaces.

Net: tokens are at parity. The gap is application depth, motion craft, mobile parity, product-as-hero, and trust presentation.

## 3. Gap analysis (ranked by buyer impact ÷ effort)

| # | Gap | Evidence | Bar exemplar | Fix |
|---|---|---|---|---|
| 1 | Hero is atmosphere (ocean video + GL) rather than the product. LiveQuote 503s without backend | 00 §4; docs/design/reference-breakdown-exa.md | Raycast "the page is the product"; Pika embeds real output; Bolt/Warp command-input hero (05, 07) | Put a real live route/quote card in the hero with a build-time-captured, honestly labelled fallback. CTA is "get this route", not "get started" |
| 2 | WebGL figures are desktop-only; mobile gets blank canvases | 00 §5, §9.2 | Vercel Ship: SVG placeholder, canvas swapped in after compile (03 §1) | Static/CSS fallback per GL component; lazy-init after first paint; gate on pointer and width |
| 3 | Motion is sparse and un-tokenised: fades only, no duration ladder | 00 §3, §9.4 | Factory 150–200ms CLI timing; Dia colour-only hovers; token set in 03 | Add `--sw-dur-*` / `--sw-ease-*` to design-tokens; stagger Reveal; 2–3 scroll moments max; no hover transforms on data cards |
| 4 | Shadows and glows used for depth in places | 00 §2 hairlines/shadows | Factory, Warp, Raycast, Dia: zero drop shadows, hairline + grey ladder | Audit and remove box-shadow on cards; keep shadow only on product screenshots (Dia rule) |
| 5 | ~~Nav is 3 links + CTA; footer is minimal~~ Withdrawn 2026-09-02: the rendered site has a mega-menu and a six-column footer with disclosure. Remaining: no venue strip anywhere on the page | render of 2026-09-02 | Fireblocks client wall; Hyperliquid custodian naming | Mono venue strip of the 21 real routers under the stat strip |
| 6 | No public trust centre; security lives under /legal/risk | 00 §6; 04 A#1–8; 06 bullets 1,5,10 | trust.sierra.ai, security.legora.com, "Glean Protect" | Named programme (e.g. "Suwappu Custody") on `/trust`: custody model, KMS envelope encryption, audits, incident policy, `security.txt`, status link. Compact badge strip near the fold, detail on the trust page. Name custodians and venues the way Hyperliquid does |
| 7 | No logo wall or quantified proof, and the live homepage currently shows a "Quote unavailable" ticket where the proof should be | render of 2026-09-02; 00 §6 | Notion percentile stat; Cognition enterprise wall; Suno press wall | Monochrome strip of chains, venues, integrations we route through; one quantified case study; a single percentile or volume stat under the headline |
| 8 | Light-only root, no theme toggle | 00 §9.1 | Vercel, Linear parity | Promote `.sw-dark` to `data-theme` on `<html>` with OS sync and a toggle |
| 9 | Hero video has no pause control | 00 §9.5 | WCAG 2.2 pause/stop (04 A#26–29) | Pause/play beside the sound toggle; poster under reduced-motion |
| 10 | Flat sections, boundaries are margins | docs/design/visual-study.md G1/G2 | SVG `feTurbulence` grain 2–4% (03 §6); Greptile rails | Grain on dark bands; hairline rails at column edges; ruled dividers |
| 11 | Tailwind v3 `@tailwind base` under v4 build: Preflight never renders | 00 §9.8 | — | Migrate to `@import "tailwindcss"` or add an explicit reset |
| 12 | Docs/changelog polish unaudited | 04 A#15–20 | docs.stripe.com, linear.app/changelog | Audit pass; search and code tabs if missing |

## 4. Recommended motion + texture token additions

```css
--sw-dur-1: 100ms;  /* state flip */
--sw-dur-2: 200ms;  /* hover, button (Factory: 150–200ms) */
--sw-dur-3: 300ms;  /* card, tooltip */
--sw-dur-4: 500ms;  /* panel, section reveal */
--sw-dur-5: 800ms;  /* hero stagger complete */
--sw-ease-ui: cubic-bezier(0.4, 0, 0.2, 1);           /* Factory, Dia */
--sw-ease-in-out: cubic-bezier(0.2, 0, 0.38, 0.9);    /* Carbon productive */
--sw-ease-expressive: cubic-bezier(0.4, 0.14, 0.3, 1); /* hero moments */
--sw-stagger: 60ms;
--sw-grain-opacity: 0.03;
```
Keep the existing `--sw-ease` as the entrance default. Springs for magnetic/tilt: stiffness 300, damping 20, mass 1. Reduced motion: opacity-only at same duration, JS parallax gated at init. Data cards: colour transitions only, no scale or translate.

Libraries: keep `framer-motion` (now `motion`) for React state motion; add GSAP + ScrollTrigger + SplitText only if we adopt scroll-scrubbed sections; Lenis only alongside GSAP; Rive if we want a Sierra-style animated mark; `postprocessing` if GL figures gain bloom/dither. Do not add Aceternity/Magic UI wholesale: cherry-pick BorderBeam, SpotlightCard and Terminal patterns as our own components. Do not move to Framer: our stack already is the hand-coded route the flagship sites use, and Legora shows Framer pays off for 30 editors, which we are not.

## 5. Reference set

- **Factory** for the trading surface: dark, mono-forward, signal-orange and metric-green semantics, zero shadows, CLI timing.
- **Raycast** for discipline: one accent, grey ladder, real UI as the only visual language.
- **Warp** for warmth: a dark canvas with a brown cast plus DM Mono for data.
- **Sierra** and **Harvey** for institutional trust: serif gravitas, compact badge strip, AI-specific assurance, trust centre subdomain.
- **Pika** and **ElevenLabs** for product-output-as-hero and neutral chrome that lets live data supply the colour.
- Admire but do not clone **Cluely** and **Dia**: consumer attention capture, not numeric legibility.

## 6. Suggested sequencing (each is one `/design-iterate` or one showcase-dev PR)

1. Gaps 2 + 9 + 11: mobile GL fallbacks, video pause, Tailwind reset. Correctness and a11y first.
2. Gap 1: live route card in the hero with honest fallback. Largest perceived-quality jump.
3. Gaps 3 + 4: motion tokens, stagger Reveal, shadow audit.
4. Gaps 5 + 7: nav dropdowns, footer grid, logo strip, one stat under the headline.
5. Gap 6: named trust programme, `/trust`, `security.txt`, custodian naming. Largest enterprise-parity delta vs crypto peers.
6. Gaps 8 + 10 + 12: theme toggle, grain and rails, docs audit.

## 7. What NOT to copy

- No second accent hue. The ramp discipline is what makes Exa, Geist and Raycast look expensive.
- No motion everywhere. One hero moment plus 200ms hovers beats parallax on every card.
- No stock illustration, 3D orbs or gradient blobs. Our proof is live routing data and real venues.
- No instrument-serif-as-hero cliché; 08 flags it as already tipping into template. Newsreader in one role only.
- No unverified compliance badges. Describe custody and KMS factually until SOC 2 exists.
