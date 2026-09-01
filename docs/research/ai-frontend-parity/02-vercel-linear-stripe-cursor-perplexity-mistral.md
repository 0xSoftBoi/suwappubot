# Vercel Linear Stripe Cursor Perplexity Mistral

Research date 2026-09-01. Sourced by the researcher agent; live fetches of several sites were bot-blocked so hex/px values are flagged UNVERIFIED where not confirmed from primary markup.

I could not write the requested file — I'm the read-only researcher (no Write/Edit tool), and my own operating rules explicitly bar writing report `.md` files; findings must be returned as a message so the conductor's context stays intact. Below is the full synthesis. If a persisted doc at `docs/research/ai-frontend-parity/02-vercel-linear-stripe-cursor-perplexity-mistral.md` is actually needed, the conductor or `showcase-dev` should save this output there.

**Bottom line:** the 2025-26 "enterprise premium" bar = dark-first monochrome canvas + one saturated brand accent + a single custom/near-custom sans (often paired with a mono for code) + hairline 1px borders instead of shadows + WebGL/canvas gradient hero as the one big motion moment + otherwise restrained, fast micro-interactions. Vercel's Geist is the most steal-able because it's an open, documented token system, not just a vibe.

## Vercel (vercel.com / v0.dev)
- Typography: custom **Geist Sans** + **Geist Mono** (own foundry font, replaced Inter in 2023); newer **Geist Pixel** for bitmap/pixel contexts. Hero ~64px/400, section heads 56px/450, strong negative tracking; 30px feature copy; 14px dense UI text. [vercel.com/font](https://vercel.com/font), [vercel.com/blog/introducing-geist-pixel](https://vercel.com/blog/introducing-geist-pixel)
- Color: monochrome base **#171717** (near-black "Ink") / **#ffffff**; Geist color system is 10 scales (background/gray/gray-alpha/blue/red/amber/green/teal/purple/pink), each a 100–1000 step ramp (100-300 bg, 400-600 border, 700-800 high-contrast bg, 900-1000 text), exposed as `var(--ds-gray-400)` etc., P3-aware, no hex published in docs. [vercel.com/geist/colors](https://vercel.com/geist/colors). Signature decorative gradient trio: Develop `#007cf0→#00dfd8`, Preview `#7928ca→#ff0080`, Ship `#ff4d4d→#f9cb28`, fused into a mesh behind hero/feature bands. [designmd.cc/benchmarks/vercel](https://designmd.cc/benchmarks/vercel)
- Layout/grid: Geist ships an explicit grid foundation (`/geist/grid`) plus radii/fills-strokes/shadow presets under `/geist/materials`. [vercel.com/geist](https://vercel.com/geist)
- Motion: no confirmed named library on the marketing site (docs don't disclose); v0.dev output stack is Tailwind + shadcn/ui, commonly paired with Framer Motion for component transitions and GSAP/WebGL for hero-level scenes — UNVERIFIED which vercel.com itself uses in production.
- Graphics/icons: Geist ships its own component kit `@vercel/geistcn` (Button/Modal/Toggle) and its own icon set `@vercel/geistcn-assets` — i.e. Vercel does NOT rely on Lucide/Phosphor, it has a proprietary icon library. [vercel.com/geist](https://vercel.com/geist)
- Enterprise: SOC 2 Type 2, PCI DSS, ISO 27001, HIPAA BAA ($350/mo add-on), EU-U.S. DPF, TISAX, custom security questionnaire — laid out as literal compliance line-items with prices on the enterprise/security pages. [vercel.com/docs/security/compliance](https://vercel.com/docs/security/compliance), [vercel.com/enterprise](https://vercel.com/enterprise)

## Linear (linear.app)
- Typography: **Inter Variable** for UI/marketing text, **Berkeley Mono** for code; crisp white text at tight **-0.022em** tracking; weights confined to a narrow **400–510** band — deliberately never bold. [designmd.cc/benchmarks/linear](https://designmd.cc/benchmarks/linear)
- Color: near-black canvas **#010102** (blue-cast black), light-gray text **#f7f8f8**, single chromatic accent lavender-blue **#5e6ad2**. 2025 refresh *reduced* color further (monochrome black/white, fewer bold accents vs. earlier blue-heavy look). Depth via a hairline-border "surface ladder," shadows on dark are avoided almost entirely. [blog.logrocket.com/ux-design/linear-design](https://blog.logrocket.com/ux-design/linear-design/), [github.com/voltagent/awesome-design-md — linear.app/DESIGN.md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- Layout/nav: sticky dark top nav, 56px height, canvas bg color, wordmark left / links center / auth CTAs right. [github.com/voltagent/awesome-design-md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- Icons: Lucide-style single-weight outline stroke icon set (de facto shadcn/ecosystem standard); UNVERIFIED whether Linear literally imports Lucide vs. a lookalike custom set. [wmtips.com comparison](https://www.wmtips.com/technologies/compare/lucide-vs-phosphor-icons/)
- Enterprise: SOC 2 Type I **and** Type II complete, HIPAA compliant, Vanta-automated trust portal at linear.app/security, IP restriction for Enterprise tier, passkeys. Dedicated public changelog with security-feature entries (e.g. the original SOC 2 changelog post). [newsletter.linear.app — SOC 2 changelog](https://newsletter.linear.app/issues/linear-changelog-soc-2-faster-initial-app-launches-802583), [thirdproof.ai/vendors/linear](https://thirdproof.ai/vendors/linear)
- Motion/bento/grain/command-K specifics: could not confirm from primary source in this pass — flag as **UNVERIFIED**, would need a direct WebFetch of linear.app (blocked by search-only results this round).

## Stripe (stripe.com)
- Typography: proprietary **Söhne** variable sans at light weights (300/400) for an airy feel; display sizes 26–56px at weight 300, negative tracking from -0.26px(26px) to -1.4px(56px). [designmd.cc/benchmarks/stripe](https://designmd.cc/benchmarks/stripe)
- Color: primary indigo **#533afd** — used as the *only* filled CTA color per band, link emphasis, and gradient mid-stop; broader gradient mesh spans orange **#ff6118** → pink **#ffe0ef** → purple **#533afd**. [shadcn.io/design/stripe](https://www.shadcn.io/design/stripe), [uwux.medium.com/behind-the-gradient-design-at-stripe](https://uwux.medium.com/behind-the-gradient-design-at-stripe-476dcf61a51a)
- Motion: the famous animated mesh-gradient hero runs on **WebGL + Canvas** (confirmed via reverse-engineered CodePen/Gist recreations, not an official Stripe disclosure). [gist.github.com/oaluna](https://gist.github.com/oaluna/3cc459a57259583464ee305f6153ba46), [kevinhufnagl.com/how-to-stripe-website-gradient-effect](https://kevinhufnagl.com/how-to-stripe-website-gradient-effect/)
- Layout: generous whitespace around UI chrome vs. tightly packed financial data tables/charts — density is used as a hierarchy signal, not just spacing. [designmd.cc/benchmarks/stripe](https://designmd.cc/benchmarks/stripe)
- Tech stack for GSAP/Three.js: **UNVERIFIED** — no primary confirmation Stripe.com itself runs GSAP or Three.js in production; only that WebGL/Canvas power the gradient, and that GSAP+Three.js is a common *general* pairing for this effect elsewhere.

## Cursor (cursor.com)
- Typography: custom **CursorGothic** (by Kimera studio) for display — weight 400 only, tracking tightens progressively from -0.005em(22px) to -0.03em(72px), i.e. never bold, letting negative tracking carry weight; **jjannon** serif as an editorial/body counterpoint; **Berkeley Mono** for code voice, tying the marketing site back to the editor identity. Notably, the typeface includes "logo ligatures" — optical logotype substitution baked into the font itself. [the-brandidentity.com — Kimera/Cursor project](https://the-brandidentity.com/project/how-kimera-built-cursors-identity-around-a-custom-typeface-system), [designmd.co/d/cursor](https://www.designmd.co/d/cursor)
- Color: warm off-white canvas **#f2f1ed**, warm near-black text **#26251e** ("Cursor Dark," yellow undertone, evokes paper/ink), primary accent **#f54e00** (orange-red). This is the one outlier among the six — everyone else is cool-neutral dark-mode-first; Cursor is warm-paper light-mode-first. [characterquilt.com/branding/cursor](https://www.characterquilt.com/branding/cursor)
- Grid: 16px spacing increment system. [characterquilt.com/branding/cursor](https://www.characterquilt.com/branding/cursor)
- Tech/enterprise: editor itself is Electron/TS/Rust (VS Code fork) — not relevant to the marketing site's stack, which is UNVERIFIED for framework. cursor.com/enterprise markets "trusted by 64% of Fortune 500," SOC 2 Type II compliant AWS infra, no on-prem option. [cursor.com/enterprise](https://cursor.com/enterprise)

## Perplexity (perplexity.ai)
- Typography: proprietary **pplxSans**; weights restricted to 400–500 only — hierarchy is carried by color/spacing, not weight (same discipline as Linear/Cursor). [dembrandt.com/explorer/perplexity](https://www.dembrandt.com/explorer/perplexity)
- Color: signature deep teal **#016a71** as the single accent (sign-in pill, focus rings, links, active tonal states); off-white canvas; secondary reference to **#27251e** as a possible dark-text token — sources disagree, flag as **UNVERIFIED** which is canonical. [shadcn.io/design/perplexity](https://www.shadcn.io/design/perplexity), [fontofweb.com/tokens/perplexity.ai](https://fontofweb.com/tokens/perplexity.ai)
- Radii system (unusually explicit for a product this size): 16px cards, 12px inputs/filled buttons, 6px ghost buttons, 9999px (full pill) chips/badges. [shadcn.io/design/perplexity](https://www.shadcn.io/design/perplexity)
- Hero/motion/enterprise signals: **UNVERIFIED** in this pass — no primary-source confirmation found for hero animation tech or a dedicated trust/SOC2 page; would need a direct WebFetch of perplexity.ai and perplexity.ai/enterprise to confirm.

## Mistral (mistral.ai)
- Brand identity: Feb 2025 rebrand by Sylvain Boyer Studio (Paris) — logo is a pixelated "M" built from modular rectangular blocks. [underconsideration.com/brandnew](https://www.underconsideration.com/brandnew/archives/new_logo_and_identity_for_mistral_ai_by_sylvain_boyer_studio.php)
- Color: **Mistral Orange #fa520f** as primary CTA/brand color, part of a warm gradient system running yellow **#ffd900** → amber **#ffa110** → burnt orange **#fa520f**; overall warm spectrum (ivory/cream/amber/gold/orange) — the only company of the six not built on a cool neutral/dark base.
- Signature device: atmospheric "sunset" gradient photography (mountains) plus a horizontal gradient "stripe" bar that recurs as a page-closing motif.
- Typography: near-serif display voice at 82px+, -2.05px tracking for hero — the most editorial/least "SaaS-generic" of the six.
- Tech stack / enterprise trust page: **UNVERIFIED** — not confirmed in this research pass; would need direct fetch of mistral.ai and mistral.ai/security or equivalent.

## Ten shared "enterprise premium" patterns (2025-26)
1. Dark-or-neutral monochrome canvas (near-black or off-white) + exactly **one** saturated brand accent color — never a busy multi-color UI.
2. Custom or semi-custom typeface over generic system fonts (Geist, Söhne, CursorGothic, pplxSans) as a primary differentiation lever.
3. Weight discipline: hierarchy via size/tracking/color, not bold — most brands cap regular UI weight at ~400–510.
4. Negative letter-spacing at large display sizes as the universal "premium" typographic tell.
5. Hairline 1px borders replace drop shadows for depth on dark surfaces.
6. One big animated moment (WebGL/Canvas gradient mesh hero) rather than motion everywhere — restraint elsewhere.
7. A dedicated, often-priced compliance/security page (SOC 2 Type 2, ISO 27001, HIPAA) is table stakes for anyone selling to enterprise.
8. Mono typeface for code/technical contexts (Geist Mono, Berkeley Mono) signals developer-native credibility.
9. Icon systems trend to single-weight minimal outline strokes (Lucide-style) or fully proprietary icon sets (Vercel) — never mixed-style stock icon packs.
10. A public, well-designed changelog doubles as both product-marketing and trust signal (Linear is the reference implementation).

## Geist design system — what to steal
- **Tokens**: adopt a 10-scale, 100–1000-step color ramp per hue (bg/border/high-contrast-bg/text bands) instead of ad hoc hex — gives dark/light parity for free. [vercel.com/geist/colors](https://vercel.com/geist/colors)
- **Base neutrals**: `#171717` / `#ffffff` as the ink/paper pair — high contrast, accessible by construction.
- **Radii/shadows/fills-strokes**: Geist documents these as separate token families (`/geist/materials`) rather than baking them into components — worth mirroring as independent CSS custom properties so a future rebrand only touches tokens.
- **Motion durations**: not disclosed in Geist docs directly (UNVERIFIED exact ms values) — recommend defaulting to the common Vercel/shadcn convention of **150–200ms ease-out** for micro-interactions and **300–500ms** for panel/hero transitions until a primary source is found.
- **Typography**: pairing a geometric sans (Geist Sans-equivalent) with a matching mono (Geist Mono-equivalent) for any code/hash/address display in Suwappu's own UI is the single highest-leverage steal.
