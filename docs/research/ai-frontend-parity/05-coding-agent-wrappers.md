# AI Application-Layer (Coding/Agent) Marketing Site Design Audit — 2025-2026

**Coverage caveat up front:** Evidence density varies sharply across this list. Lovable, Cluely, Raycast, Factory, Warp, and Windsurf(via Metalab) have strong primary-source design-token data (via CSS-scraping databases cross-checked against live pages). **Genspark and Manus have essentially no design-press/teardown coverage** — despite being named in the brief, neither shows up on Awwwards/Godly/Lapa/refero/characterquilt, which is itself a finding (see below). Cognition/Devin and Bolt/Replit sit in between. Every fact below is cited; anything I could not confirm from a primary source is marked `UNVERIFIED`.

---

## 1. Lovable (lovable.dev)

- **Fonts:** Camera Plain Variable (variable-weight geometric sans by **Dinamo type foundry**, designers Fabian Harb/Sascha Bente/Johannes Breyer/Robert Janes/Fabiola Mejía), used for literally everything — hero, headings, body, buttons, nav — with weight (400/480/600) doing the hierarchy work instead of a second typeface. [design.withfudge.com/fonts-used-on/lovable.dev](https://design.withfudge.com/fonts-used-on/lovable.dev), [awesome-design-md (Lovable)](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/lovable/DESIGN.md)
- **Canvas:** `#f7f4ed`/`#fcfbf8` warm cream, not pure white. **Text:** `#1c1c1c` charcoal. [characterquilt.com/branding/lovable](https://www.characterquilt.com/branding/lovable), [awesome-design-md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/lovable/DESIGN.md)
- **Accent:** no single chromatic brand color — small multi-color gradient washes (pink/orange/blue) appear only in hero atmosphere; buttons are pure `#1c1c1c`/`#fcfbf8`. Signature detail: an **inset (pressed-into-surface) button shadow** — `inset 0 0.5px 0 rgba(255,255,255,.2), inset 0 0 0 0.5px rgba(0,0,0,.2)` — instead of drop shadows. [awesome-design-md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/lovable/DESIGN.md)
- **Hero tech:** `UNVERIFIED` — a third-party open-source reproduction project describes "a full-viewport WebGL hero driven by a CoreRenderer runtime, glass navbar, animated typewriter prompt input, and 3D trusted-by logo carousel," but this is a reverse-engineered clone repo, not Lovable's own disclosure — treat as plausible, not confirmed. [GitHub - claude-directory](https://github.com/pulkitxm/claude-directory)
- **Layout:** ~1200px max-width, 8px base spacing scale running 8–208px, 96px+ hero vertical padding ("editorial breathing room"). [awesome-design-md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/lovable/DESIGN.md)
- **Built on:** shadcn/ui + Radix + Tailwind (per the design-md extract), i.e. custom React, **not** Framer/Webflow — notable irony since Lovable's own comparison pages pitch itself against Framer/Webflow. [awesome-design-md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/lovable/DESIGN.md), [Lovable vs Framer](https://lovable.dev/guides/framer-vs-lovable-app-builder-comparison)
- **Agency:** none credited; the type license is the only outside vendor found (Dinamo). `UNVERIFIED` beyond that.
- **Enterprise signals:** Pro $25/mo, Business $50/mo with SSO, Enterprise custom — classic self-serve→enterprise SaaS ladder. [Lovable vs Framer comparison](https://lovableseo.ai/lovable-vs-framer-seo)

## 2. Bolt (bolt.new)

- **Fonts:** Inter, exclusively, restrained to a max 18px hero size — hierarchy via weight/spacing, not scale. [design.withfudge.com/fonts-used-on/bolt.new](https://design.withfudge.com/fonts-used-on/bolt.new)
- **Colors:** not confirmed at hex level; page references a "glow" SVG asset suggesting neon/gradient accent lighting behind product mockups. `UNVERIFIED` for exact hex. [WebFetch bolt.new]
- **Visual language:** hero copy "What will you build today?" with Plan/Build-now CTAs and Figma/GitHub import — product-UI-as-hero pattern (chat input mimicking the actual app). [bolt.new]
- **Agency:** search results surface **Koto** as designer of "Bolt's" new identity, but the case study (creativeboom.com, YouTube) is almost certainly for **Bolt (the checkout/fraud-prevention platform, formerly Bolt Financial)** — a name collision, **not** StackBlitz's Bolt.new. Do not conflate; I could not find an agency credit specific to bolt.new/StackBlitz. [Creativeboom — Koto x Bolt](https://www.creativeboom.com/inspiration/bolt-gets-a-striking-new-identity-by-koto/) — `UNVERIFIED` for bolt.new specifically.
- **Built on:** Next.js-style client routing signals observed; no Framer/Webflow evidence. `UNVERIFIED`.

## 3. Replit (replit.com)

- **Fonts:** ABC Diatype Plus (display/headline/body/UI) with ABC Diatype-Regular Pixel Beta for "expressive display moments"; IBM Plex Sans at 14px as workspace-chrome fallback. [design.withfudge.com/fonts-used-on/replit.com](https://design.withfudge.com/fonts-used-on/replit.com)
- **Descriptive palette:** described elsewhere as "a warm workshop with coral sparks" (refero.design summary) — consistent with Replit's known coral/orange three-dot brand mark. `UNVERIFIED` at hex level. [styles.refero.design search result]
- **Brand history/agency:** logo by **Mackey Saturday** with Replit's internal team (Oct 2022); full brand system refresh in **Aug 2024 led in-house by Haya Odeh (VP of Design)** — no external agency for the site itself. [designyourway.net — Replit logo history](https://www.designyourway.net/blog/replit-logo/)
- **2025 marketing update:** Replit's own blog documents an internal marketing-page revamp ("Bringing Repl.it's Marketing to the Modern Age") plus a December 2025 Learn/Docs UI refresh. [blog.replit.com/new_marketing](https://blog.replit.com/new_marketing)
- **Built on:** `UNVERIFIED` — no Framer/Webflow signal found; Next.js image optimization patterns observed elsewhere in Replit's product but not confirmed for the marketing site.

## 4. Cognition / Devin (cognition.ai → cognition.com, devin.ai)

- **Note:** cognition.ai now 301-redirects to **cognition.com**. [WebFetch cognition.ai]
- **Fonts:** IBM Plex Sans Condensed (headings), IBM Plex Sans (body) — confirmed via CSS/network-request extraction. [characterquilt.com/branding/cognition](https://www.characterquilt.com/branding/cognition)
- **Colors:** Canvas `#F2F5FA` (light, not dark — notable since most of this cohort is dark), Primary `#4B69D6` (medium blue), Accent `#5ECFB1` (mint/teal), Text `#0F131C`. [characterquilt.com/branding/cognition](https://www.characterquilt.com/branding/cognition)
- **Layout:** numbered section structure — 01 hero ("Cognition operates Devin, the first autonomous software engineer"), 02 enterprise logo wall (Mercedes-Benz, Goldman Sachs), 03 careers CTA, 04 blog grid. [WebFetch cognition.com]
- **Motion/hero tech:** `UNVERIFIED` — no script/animation-library evidence surfaced in either fetch or search.
- **Enterprise signals:** enterprise-logo wall is front-and-center in section 02, consistent with Cognition's enterprise-sales motion (contrasts with Lovable/Bolt/Replit's self-serve-first hero). [WebFetch cognition.com]
- **Agency:** `UNVERIFIED` — no credit found.

## 5. Windsurf (windsurf.com)

- **Critical fact:** windsurf.com now 308-redirects to **devin.ai/desktop** — Windsurf's standalone marketing site no longer exists as a distinct property; it was folded into Cognition/Devin after Cognition's July 2025 acquisition. [WebFetch windsurf.com], [Cognition's acquisition of Windsurf](https://cognition.com/blog/windsurf), [Silicon Republic](https://www.siliconrepublic.com/start-ups/cognition-windsurf-acquisition-ai-coding-google-licensing)
- **Rebrand (pre-acquisition, ~Nov 2025):** designed by **Metalab**, documented in a Codrops case study. Typefaces: **Tomato Grotesk** (primary display) paired with **DM Sans** and **DM Mono**. Visual system: a "W" logomark built from wave-motion curves, mono-line/dashed iconography, a coastal "sunsets, surf, coastal light" color story of "grounded neutrals + neon accents." Metalab's own framing: "doesn't just showcase the product, it makes you feel it." [Tympanus/Codrops — Windsurf x Metalab](https://tympanus.net/codrops/2025/11/17/windsurf-x-metalab-building-a-new-brand-for-the-future-of-ai-coding/)
- **Colors/motion:** exact hex values and animation implementation **not disclosed** in the case study — described only conceptually. `UNVERIFIED` at token level.
- **This is the one entry in the set where the "beautiful marketing site" no longer exists as a live artifact** — worth flagging to whoever requested this research.

## 6. Factory (factory.ai)

The best-documented site in this set (full design-token extract available).

- **Fonts:** Geist (display/body, weights 400/500) + Geist Mono (code/labels, uppercase, tight tracking) — explicit house rule: **no serif or display typefaces, ever.** [styles.refero.design — Factory](https://styles.refero.design/style/13d6fc89-eba2-4724-ac37-20f4f2e5efec)
- **Canvas:** Obsidian Canvas `#101010`. **Raised surface:** Carbon Lift `#1d1a18`. **Accent:** Signal Orange `#ee6018` (live status/data), Metric Green `#a0ca92` (positive trends). [styles.refero.design](https://styles.refero.design/style/13d6fc89-eba2-4724-ac37-20f4f2e5efec)
- **Type scale:** 72px display down to 12px caption, minor-third-from-14px scale, tight negative tracking (up to -2.88px at display size).
- **Layout:** 1200px max-width, 8px base unit, 96px section gaps, 3–20px radius vocabulary (buttons 3px → large panels 20px).
- **Motion:** "short and mechanical" — 0.15–0.2s transitions, `cubic-bezier(0.4,0,0.2,1)`, explicitly modeled on **CLI behavior, not marketing-site polish**. **No shadows, glows, or blurs are permitted** — depth is built entirely from figure/ground contrast (a `#eeeeee` card on `#101010` canvas). This is a deliberately anti-glossy, engineering-tool aesthetic. [styles.refero.design](https://styles.refero.design/style/13d6fc89-eba2-4724-ac37-20f4f2e5efec)
- **Positioning:** hero copy "THE INDUSTRIAL REVOLUTION FOR SOFTWARE DEVELOPMENT" / "THE AUTONOMY STACK FOR ENTERPRISE TEAMS," dual Log-in/Contact-Sales CTAs, enterprise logo wall — pure enterprise-sales framing, not self-serve. [WebFetch factory.ai]
- **Built on:** Next.js signals (`/_next/image`). No Framer/Webflow evidence. [WebFetch factory.ai]
- **Agency:** `UNVERIFIED` — no credit found despite targeted search.

## 7. Warp (warp.dev)

- **IMPORTANT DISAMBIGUATION:** characterquilt.com's "Warp" brand entry, and several "Warp rebrand agency" search hits (rebrand.gallery, itsnicethat.com Warp-Records article) are for **different companies entirely** — joinwarp.com (HR/payroll) and Warp Records (Aphex Twin's label) respectively. I explicitly verified this and excluded that data. [characterquilt.com/branding/warp confirms this is joinwarp.com, not warp.dev]
- **Fonts (warp.dev, verified via design-token extract):** Inter (400/500) for all UI text; DM Mono for terminal mockups/command snippets/code; Instrument Serif for occasional italic tagline moments (Abel as fallback). [styles.refero.design — Warp](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/warp/DESIGN.md) — cross-checked, same figures repeated independently in search summary. `UNVERIFIED` at high confidence but internally consistent across two pulls.
- **Colors:** warm off-white `#f7f5f0` (buttons/text/wordmark) on a warm-dark canvas `#2b2622` (`oklch(22% 0.004 84.6)` — "browner than pure black, warmer than neutral gray"), softer card tone `#383330`.
- **Layout:** 4px base unit, 96px section padding, ~1200px container.
- **Motion:** no drop-shadows anywhere — elevation via hairline borders (1px, `#3f3a36`) only, three flat elevation levels.
- **Positioning:** "Infrastructure to build, measure, and interact with agents across your SDLC," stats-heavy social proof (718K developers, 51% of Fortune 500), Build-your-factory/Download-Warp dual CTA — enterprise + prosumer hybrid. [WebFetch warp.dev]
- **Tech stack:** Next.js image pipeline confirmed (`/_next/image`); a Warp company blog post says their **app** (not necessarily marketing site) is built with React/TypeScript/Emotion. [WebFetch warp.dev], [Warp — World of Warp blog](https://www.warp.dev/blog/world-of-warp)
- **Agency:** `UNVERIFIED` — no credible external credit found; some low-confidence chatter suggests in-house.

## 8. Raycast (raycast.com)

Second-best-documented site, with two independent sources agreeing on the accent color.

- **Fonts:** Inter with `font-feature-settings: "calt","kern","liga","ss03"` **enabled site-wide** — ss03 swaps Inter's default double-story `g` for a single-story geometric one, described as "the brand's signature typographic detail." GeistMono for technical/monospace labels; SF Pro Text (500/700) for icon glyphs and numeric callouts, reinforcing "this is a Mac app." [styles.refero.design — Raycast](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/raycast/DESIGN.md)
- **Colors — cross-verified by two independent extraction tools:** Canvas near-black `#07080a`, single coral/red accent **`#ff6363`** used everywhere as the *only* chromatic CTA color, white (`#ffffff`) as the sole interactive-text color. Category-only accents (never chrome): blue `#57c1ff`, red `#ff6161`, green `#59d499`, yellow `#ffc533`. A once-per-page hero gradient (`#ff5757`→`#a1131a`, three diagonal stripes) is the single exception. [refero DESIGN.md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/raycast/DESIGN.md), [characterquilt.com/branding/raycast](https://www.characterquilt.com/branding/raycast)
- **Layout:** 8px base unit, ~1240px max-width, radius vocabulary from 4px (keycaps) to 9999px (pills), **no drop-shadow elevation anywhere** — surfaces read via a 4-step gray ladder instead.
- **Visual language / house rule:** "the marketing page is the product" — the site reuses actual command-palette UI screenshots as decoration instead of illustration or stock photography, maintaining edge-to-edge dark-mode tonal continuity. [refero DESIGN.md]
- **Branding history:** an earlier Raycast logo/brand project is documented on Behance (client briefing → research → sketching → color/type exploration → guideline doc), but the agency/individual is not named in the surfaced excerpt. `UNVERIFIED` for named agency. [Behance — Raycast Branding](https://www.behance.net/gallery/94878995/Raycast-Branding?locale=en_US)
- **Built on:** `UNVERIFIED` — no Framer/Webflow confirmation; Next.js referenced only in comparative/generic search results, not confirmed against raycast.com directly.

## 9. Manus (manus.im)

- **Fonts (from manus.im's own brand-guidelines page, primary source):** **Libre Baskerville** (serif, for titles/promotional material) + **DM Sans** (sans, for product/modern applications); Noto Serif/Noto Sans for CJK. [manus.im/brand](https://manus.im/brand)
- **Colors (primary source):** core triad is white/gray/black — `#FFFFFF`, `#F8F8F8`, `#34322D` — deliberately restrained ("clean, minimal, timeless"); a single **Medium Purple `#A63BD7`** appears as the brand accent. [manus.im/brand](https://manus.im/brand), cross-referenced [brandfetch.com/manus.ai]
- **Layout:** hero is a single input box ("What can I do for you?") with task-category chips (Create slides / Build website / Design / Create games) — a ChatGPT/Perplexity-style command-first hero rather than a marketing-narrative hero. [WebFetch manus.im]
- **Design-press visibility:** **none found** — Manus does not appear on Awwwards, Godly, Lapa, siteinspire, refero, or characterquilt in any of my searches. This is a genuine finding: despite strong product traction, Manus's marketing site has not registered with the Western design-critique press the way Lovable/Cluely/Raycast/Windsurf have.
- **Motion/hero tech, agency, tech stack:** all `UNVERIFIED` — no evidence surfaced.

## 10. Genspark (genspark.ai)

- **Design-press visibility: effectively zero.** Across every search angle tried (teardown, agency, font, hero motion, Awwwards/Godly), no design-community coverage exists. Search results return only Genspark's own product-feature pages (AI Designer, AI Slides).
- I recommend **flagging this to whoever compiled the original list** — Genspark does not currently belong in a "most beautiful sites in tech" cohort by any external design-critique signal I could find, in contrast to the other 11.
- Fonts, colors, hero tech, agency, tech stack: all `UNVERIFIED` for the marketing site specifically.

## 11. Cluely (cluely.com)

Strong data, and the clearest **confirmed Framer build** in this set.

- **Built on Framer** — corroborated by web search (design-service listings referencing Cluely as a Framer project) and consistent with the fast, animation-forward pattern typical of Framer-built wrapper-startup sites named in the brief. [search corroboration]
- **Fonts:** signature pairing = **EB Garamond** (serif, 500 weight, 80px, **hero H1 only, never section headings**) + **Geist** (everything functional — nav, body, buttons, cards) + ui-monospace for code. The serif/sans contrast IS the identity. [styles.refero.design — Cluely](https://styles.refero.design/style/72da35d5-1cfd-41a3-94f6-cb6b8c07a670)
- **Colors:** Chalk `#ffffff` canvas, Carbon `#18181b` primary text, **Signal Blue `#3c83f6`** primary CTA, gradient anchors Deep Dusk `#022c70` → Azure Crest `#0544a5` for the hero's "sky-to-mountain" gradient, plus decorative-only Neon `#00ff26`. [styles.refero.design](https://styles.refero.design/style/72da35d5-1cfd-41a3-94f6-cb6b8c07a670)
- **Hero technique:** "dramatic sky-to-mountain blue gradient hero" (linear/radial gradient) behind the 80px serif headline, with a product-mockup laptop frame floating below at 16px radius — cinematic-gradient hero, not WebGL/video. [styles.refero.design], [Lapa.ninja — Cluely](https://www.lapa.ninja/post/cluely/)
- **Elevation:** layered glassy ring+inset shadows on the primary CTA button only (`0 0 0 0.5px #0544a9, inset 0 -1px 0 0 #022c70, inset 0 0.5px 0 0 #81b6ff`) — otherwise flat/borderless cards.
- **Layout:** 1200px max-width, 64px section gaps, 4/8/12/16/24px radius ladder.
- **Positioning/trust:** App Store + desktop-download CTAs, no visible SOC2/enterprise page in the excerpts surfaced — this reads as consumer/prosumer, not enterprise. `UNVERIFIED` beyond that.
- **Agency:** `UNVERIFIED` — no named credit found.

## 12. Dia / The Browser Company (diabrowser.com, thebrowser.company)

- **Fonts:** **Exposure Variable** (display, fallback Playfair Display) — used at an extreme **112px / 0.85 line-height / -3.36px tracking** for the hero; **ABC Oracle** (headings/body, fallback Inter Tight/Söhne); **ABC Favorit Mono** (fallback JetBrains Mono). [styles.refero.design — Dia](https://styles.refero.design/style/b458ca1a-70f0-4f85-b745-f879a4d08457)
- **Colors:** 96%-achromatic system — Void Black `#020204` (dramatic hero sections), Paper White `#ffffff`/Bone `#f8f8f8` (calm editorial sections), with two "surgical" accent colors: Lime Wash `#f2fcb3` and Saffron `#ffdc5c`. A named gradient asset, **"Spectrum Marquee"** — a 6-stop rainbow linear-gradient (`#FD02F5→#FA3D1D→#FFB005→#E1E1FE→#0358F7→#340B05`) animated as a continuous left-to-right marquee — is the brand's signature motion element. [styles.refero.design](https://styles.refero.design/style/b458ca1a-70f0-4f85-b745-f879a4d08457)
- **Visual language (explicit, quoted):** "**blackroom gallery meets editorial broadsheet**" — "a pitch-black hero that erupts into a screaming human face gives way to a calm, magazine-like expanse of white space, serif display headlines." This is the most editorial/gallery-like visual language in the entire cohort — closer to a fashion/culture magazine than a SaaS product page. [styles.refero.design]
- **Motion:** deliberately restrained — 0.2s ease color-only transitions, `cubic-bezier(0.4,0,0.2,1)`; **explicit house rule against hover scale/translate transforms** (no product-y "lift on hover" — color transitions only), which is a notable contrast to the more product-forward transform-heavy hover patterns typical of the coding-tool sites in this set.
- **Layout:** 1200px max-width, 80px section gaps, 12–24px card radius, 9999px pill buttons; 3-layer drop-shadow stack reserved *only* for product screenshots (never on regular cards).
- **Parent site (thebrowser.company):** minimal corporate shell — nav to Dia/Arc product sites, mission statement, careers — functions as a holding-company page rather than a design showcase in its own right. [WebFetch thebrowser.company]
- **Corporate context:** The Browser Company (Dia, formerly Arc) was acquired by **Atlassian** (Oct 2025) — worth noting as this is the second company in the set (after Windsurf/Cognition) whose "beautiful indie site" now sits inside a much larger acquirer. [en.wikipedia.org/wiki/Dia_(web_browser)]
- **Agency:** `UNVERIFIED` — no external credit found; The Browser Company is well known for a strong in-house design team (Substack post "The strategy behind Dia's design" implies in-house authorship). [browsercompany.substack.com/p/the-strategy-behind-dias-design]

---

## Summary Table

| Company | Fonts | Canvas hex | Accent hex | Hero tech | Motion lib/tool | Built on | Agency |
|---|---|---|---|---|---|---|---|
| Lovable | Camera Plain Variable (Dinamo) | `#f7f4ed`/`#fcfbf8` | none (multicolor gradient wash only) | `UNVERIFIED` (claimed WebGL, unconfirmed) | `UNVERIFIED` | shadcn/Radix/Tailwind (custom React) | none credited |
| Bolt | Inter | `UNVERIFIED` | `UNVERIFIED` (glow SVG) | product-UI-as-hero | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` (Koto credit likely wrong company) |
| Replit | ABC Diatype Plus | `UNVERIFIED` | coral ("warm workshop," unconfirmed hex) | product-UI-as-hero | `UNVERIFIED` | `UNVERIFIED` | in-house (Haya Odeh, 2024 refresh) |
| Cognition/Devin | IBM Plex Sans / Condensed | `#F2F5FA` (light!) | `#4B69D6` / `#5ECFB1` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| Windsurf | Tomato Grotesk + DM Sans/DM Mono | `UNVERIFIED` | neutrals+neon (unconfirmed hex) | site now redirects into devin.ai/desktop | `UNVERIFIED` | `UNVERIFIED` | **Metalab** (confirmed) |
| Factory | Geist / Geist Mono | `#101010` | `#ee6018` | flat, no shadows/glows | 0.15–0.2s CLI-style cubic-bezier | Next.js | `UNVERIFIED` |
| Warp | Inter, DM Mono, Instrument Serif | `#2b2622` | `#f7f5f0` off-white | product-UI-as-hero, stats band | hairline-only elevation, no shadows | Next.js image pipeline | `UNVERIFIED` (in-house likely) |
| Raycast | Inter (ss03 feature), GeistMono, SF Pro | `#07080a` | `#ff6363` | product-screenshot-as-decoration | no shadows, gray-ladder elevation | `UNVERIFIED` | `UNVERIFIED` |
| Manus | Libre Baskerville + DM Sans | `#FFFFFF`/`#F8F8F8` | `#A63BD7` | command-input hero | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| Genspark | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| Cluely | EB Garamond + Geist | `#ffffff` | `#3c83f6` | gradient sky-to-mountain hero | glassy inset-shadow CTA only | **Framer (confirmed)** | `UNVERIFIED` |
| Dia / Browser Co. | Exposure Variable + ABC Oracle | `#020204`/`#ffffff` | Lime `#f2fcb3` / Saffron `#ffdc5c` | full-black photographic hero → white editorial body | animated "Spectrum Marquee" gradient; no hover transforms | `UNVERIFIED` | in-house (implied) |

---

## What makes these sites specifically beautiful — that lab/infra sites don't do

1. **Single-typeface discipline.** Lovable, Bolt, Raycast, Factory each commit to one typeface family for everything and build hierarchy from weight/size/tracking alone, rather than mixing 3+ fonts the way enterprise/infra sites do. [design.withfudge.com, refero.design tokens above]
2. **A custom/licensed display face as brand signature**, not a default system font — Lovable's Camera Plain (Dinamo), Windsurf's Tomato Grotesk, Dia's Exposure Variable, Cluely's EB Garamond-as-hero-only. Infra/lab sites (cloud, model-API docs) almost universally default to Inter/system-ui with no bespoke type story.
3. **Product screenshots ARE the hero, not stock photography or abstract "AI" art.** Raycast's explicit rule ("the marketing page is the product") and Bolt/Replit/Warp's command-input hero pattern replace the generic neural-network/circuit-board imagery typical of infra marketing.
4. **Near-zero drop-shadow vocabulary; elevation via color/contrast instead.** Factory ("no shadows, glows, or blurs — depth from figure/ground contrast"), Warp, Raycast, and Dia (shadows reserved only for screenshots) all reject the soft-glow SaaS-card look that infra dashboards default to.
5. **A single restrained accent color used exclusively for CTAs**, everywhere else achromatic — Raycast's `#ff6363`, Cluely's `#3c83f6`, Factory's `#ee6018`. Enterprise/infra sites tend to spray a whole palette across feature icons.
6. **Deliberately mechanical/fast motion timing (0.15–0.2s) mimicking the product's own responsiveness** — Factory explicitly ties easing to "CLI behavior, not marketing aesthetics." This ties motion *semantically* to the product category, which infra sites (long fade-ins, generic AOS scroll-reveals) don't attempt.
7. **Editorial/magazine layout moves borrowed from culture publishing, not SaaS** — Dia's "blackroom gallery meets editorial broadsheet," huge negative-tracking display type, generous 80–96px whitespace bands — a register most infra sites never reach for.
8. **In-house design leadership treated as a headline hire/credit** (Replit's Haya Odeh, Metalab's public Windsurf case study) — the design work is marketed as part of the product story, not hidden.
9. **Typography micro-details as brand IP** — Raycast's ss03 single-story `g` OpenType feature is a deliberate, named "signature typographic detail" — the kind of craft investment infra/API docs sites never make since their type is functional-only.
10. **Willingness to break "SaaS grid" conventions for a single dramatic full-bleed moment** (Dia's black hero with a screaming face; Cluely's sky-to-mountain gradient) before immediately returning to restrained, information-dense sections — a tension infra sites avoid because they optimize purely for scannability.

---

## Top 3 to study in detail for a DeFi execution product

1. **Factory (factory.ai)** — closest analog to a trading/execution surface: dark canvas, monospace-forward, data-indicator accent colors (`#ee6018` signal orange, `#a0ca92` metric green — literally "live status" and "trend" semantics), zero decorative shadows, mechanical 0.15–0.2s timing tied to the tool's own speed. A DeFi swap terminal needs exactly this vocabulary: numbers/status as the hero, not illustration. [styles.refero.design/style/13d6fc89](https://styles.refero.design/style/13d6fc89-eba2-4724-ac37-20f4f2e5efec)
2. **Raycast (raycast.com)** — the "marketing page is the product" principle and the single-accent-color-on-black discipline (`#ff6363` only) is the most directly transferable lesson for a trading UI: use real UI screenshots/mockups as the entire visual language, ruthlessly restrict chromatic accent to CTA-only, and lean on a gray elevation ladder instead of shadows to keep a dense, numeric interface legible. [refero DESIGN.md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/raycast/DESIGN.md)
3. **Warp (warp.dev)** — the warm-dark-not-pure-black canvas (`oklch(22%)`) plus DM Mono for all code/command/data snippets is a strong template for a swap-execution product that needs to feel technical and fast without feeling cold; its zero-drop-shadow, hairline-border elevation system is lightweight enough to not compete visually with live price/route data. [refero DESIGN.md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/warp/DESIGN.md)

Cluely and Dia are the most *visually* dazzling of the twelve, but their editorial/gradient-hero/serif-display language is optimized for consumer-attention capture, not for the dense, trust-critical, numeric legibility a DeFi execution product needs — worth admiring, not directly cloning.

**Suggested next steps (build work, not this agent's job):**
- If the showcase/webapp team wants to act on this, route to `showcase-dev` for homepage visual-language work and/or `brand-guardian` for a design-token single-sourcing pass, using Factory/Raycast/Warp as the reference set above.
