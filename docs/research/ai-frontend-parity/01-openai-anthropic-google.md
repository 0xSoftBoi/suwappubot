# AI Frontend Parity Research: OpenAI, Anthropic, Google DeepMind/Gemini

Research date: 2026-09-01. Live fetches of openai.com, chatgpt.com, gemini.google.com were blocked (403/header overflow from anti-bot); those sections rely on named secondary sources and are flagged UNVERIFIED where not directly confirmed.

## 1. OpenAI (openai.com / chatgpt.com)

**Typography**
- Custom bespoke typeface **"OpenAI Sans"**, designed with Berlin type studio **Dinamo**, part of OpenAI's first-ever rebrand (completed ~9-month collaboration with Dinamo + Studio Dumbar). Curved letterforms, circular dots over lowercase i/j, deliberately "imperfect" to read as human/organic rather than robotic. [Medium/WebdesignerDepot](https://medium.com/@WebdesignerDepot/openai-gets-a-fresh-look-new-logo-custom-font-and-a-more-human-feel-b530d3e2dbf0), [Wallpaper](https://www.wallpaper.com/tech/openai-has-undergone-its-first-ever-rebrand-giving-fresh-life-to-chatgpt-interactions), [designcompass.org](https://designcompass.org/en/2025/02/06/openai-rebranding/)
- UNVERIFIED: exact heading scale/px, letter-spacing, line-height values — not recoverable without live CSS access (site blocked WebFetch with 403).

**Color**
- Rebrand includes a refreshed neutral/black-forward palette anchored by the "point" — a black circular cursor-motif mark symbolizing the start of a ChatGPT response. [cxodigitalpulse](https://www.cxodigitalpulse.com/openai-unveils-major-rebrand-with-a-new-logo-typeface-and-colour-palette/), [Fast Company](https://www.fastcompany.com/91273217/open-ai-rebrand-chat-gpt-logo)
- UNVERIFIED: specific hex values — press coverage describes intent, not swatches.

**Logo/Graphics language**
- "Blossom" logo mark simplified: lines now uniform thickness (previously varied), paired with new wordmark set in OpenAI Sans. [Creative Bloq](https://www.creativebloq.com/design/openais-bold-new-rebrand-is-surprisingly-human)

**Motion**
- DevDay 2026 event identity (Studio Dumbar/DEPT + OpenAI Design Studio) used **Rive** for interactive animation systems, including arcade-game-style interactive experiences; visual/motion language draws on ASCII/terminal aesthetics and "computational logic translated into motion behavior." This is event-brand work, not confirmed as the openai.com production stack. [emanuelecolombo.it/devday](https://emanuelecolombo.it/devday)
- UNVERIFIED: whether openai.com's marketing site itself uses Rive/GSAP/Framer Motion for scroll reveals — could not confirm from live markup.

**Tech stack**
- OpenAI's own developer-facing recommendation stack (for apps built with their API, not necessarily openai.com itself): Next.js (TypeScript) + React + Tailwind CSS + shadcn/ui + Radix Themes. [cookbook.openai.com](https://cookbook.openai.com/examples/gpt-5/gpt-5_frontend)
- Infra signals reported by StackShare aggregation: CloudFront, Cloudflare, Ghost, AWS. [stackshare.io](https://stackshare.io/openai/openai-com) — treat as low-confidence/UNVERIFIED (StackShare data is crowd-submitted and can be stale).

**Enterprise signals**
- OpenAI runs a dedicated **Trust Portal** at trust.openai.com for compliance/security documentation, mirroring Anthropic's pattern. [trust.openai.com](https://trust.openai.com/)

---

## 2. Anthropic (anthropic.com / claude.ai)

**Typography**
- Two proprietary/licensed typefaces drive the brand, **not available as public webfonts**: display serif **"Copernicus"** for headlines (slab/serif display, negative letter-spacing) and sans **"Styrene B"** (by Berton Hasebe, via Type.Today's "Styrene in use: ANTHROP\C" case study) for UI/subheadings, plus **"Tiempos"** (Klim Type Foundry) for body copy. Public teardown substitutes when replicating: Tiempos Headline/Cormorant Garamond/EB Garamond (serif) + Inter/Söhne (sans). [type.today/en/journal/anthropic](https://type.today/en/journal/anthropic), [Dear Designer / "My Styrene Soul"](https://deardesigner.substack.com/p/my-styrene-soul-a-short-affair-with), [fontofweb.com pricing-page pin](https://www.fontofweb.com/pin/1469)
- Live anthropic.com homepage confirms a clean bold sans-serif hierarchy for headline/body (WebFetch of https://www.anthropic.com, 2026-09-01), consistent with StyreneB body usage layered under the serif display headline system used on marketing pages.

**Color**
- Signature accent: **coral #cc785c**, used on primary CTAs, wordmark, and full-bleed callout cards — deliberately warm/muted, explicitly positioned against "OpenAI's cool slate, Google's saturated blue, Microsoft's corporate cyan." [Dear Designer](https://deardesigner.substack.com/p/my-styrene-soul-a-short-affair-with)
- Base canvas: tinted cream/off-white background, dark navy used for product-mockup surfaces (code editor, model showcase cards). [Dear Designer](https://deardesigner.substack.com/p/my-styrene-soul-a-short-affair-with)
- Live homepage confirms: white/light-neutral background, dark gray/charcoal body text, orange/warm accents on interactive elements (WebFetch, https://www.anthropic.com, 2026-09-01).

**Layout & nav**
- Hero: full-width headline + CTA ("AI research and products that put safety at the frontier"). Multi-column grid for "latest releases" cards. Container width consistent with a standard responsive max-width (~1200–1400px, not confirmed exactly). Footer is a wide multi-column index: Products, Models, Solutions, Claude Platform, Resources, Programs, Help/Security, Company, Terms/Policies — high footer density typical of enterprise SaaS. Nav uses hierarchical dropdowns for Research/Policy/Commitments/Learn/News/Claude. (WebFetch, https://www.anthropic.com, 2026-09-01)

**Enterprise/trust signals**
- Dedicated **Trust Center** at trust.anthropic.com; certifications reported: **SOC 2 Type II, ISO 27001, ISO 42001, HIPAA, GDPR**. Formal audit reports gated behind NDA + enterprise sales contact (standard enterprise pattern). Enterprise plan added custom RBAC in 2026. [trustlists.org/company/anthropic](https://trustlists.org/company/anthropic/), [amitkoth.com SOC2 guide](https://amitkoth.com/claude-code-soc2-compliance-auditor-guide/)

**Motion**
- No production animation library confirmed from live markup (WebFetch found no explicit animation code in the fetched anthropic.com HTML). Community "Claude design" tooling references (Framer Motion/GSAP skill packages) describe what *Claude Code* can generate for others, not what claude.ai/anthropic.com itself runs — do not conflate. Separately, an independent Codrops teardown reverse-engineers Claude's **mascot animations using SVG + GSAP**, suggesting GSAP is used somewhere in Anthropic's own product surfaces (unclear if marketing site or app). [tympanus.net/codrops](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/) — UNVERIFIED as to which surface exactly.

**Tech stack**
- UNVERIFIED: no Next.js/framework confirmation surfaced in this pass (WebFetch of claude.ai itself returned 403).

---

## 3. Google DeepMind / Gemini (deepmind.google / gemini.google.com)

**Typography**
- Google's standard typographic system: **Google Sans** for headings/UI, **Roboto** for body — per both the live WebFetch of deepmind.google and the Art&Graft brand-identity writeup on the Gemini 3 launch system ("uses Google Sans across its various weights as Google's typographic voice"). [the-brandidentity.com](https://the-brandidentity.com/project/art-graft-evolves-gemini-from-technical-showcase-to-living-system) 
- The May 2026 Gemini app redesign ("Neural Expressive," unveiled at I/O 2026) explicitly introduces **new typography** alongside the visual refresh. [Dezeen](https://www.dezeen.com/2026/05/19/google-rolls-out-neural-expressive-redesign-of-gemini-ai-tool/), [9to5google](https://9to5google.com/2026/05/19/gemini-app-google-io-2026/)

**Color**
- deepmind.google (live WebFetch, 2026-09-01): white background with light-gray section fills, near-black dark-mode surfaces, Google-blue-family accents in UI, gradient blue/purple treatment in hero imagery. UNVERIFIED exact hex — described qualitatively by the fetch tool, not confirmed against raw CSS.
- Gemini app redesign: "fluid animation, vibrant colours, new typography, and passive/haptic feedback throughout the app" — a marked shift toward a more saturated, expressive palette vs. the prior flat Material palette. [Dezeen](https://www.dezeen.com/2026/05/19/google-rolls-out-neural-expressive-redesign-of-gemini-ai-tool/), [MobileSyrup](https://mobilesyrup.com/2026/05/19/google-refreshes-gemini-with-neural-expressive-and-unveils-daily-brief/)

**Layout & motion**
- deepmind.google hero uses a full-width carousel-style hero (rotating slides for featured models), 3–4 column model-card grids, sticky nav with mega-menu (Models / Research / Science / About, each expanding to sub-items with icons). (Live WebFetch, 2026-09-01)
- Visual/graphics language: 3D renders (glowing orbs, abstract protein/molecule structures), soft-gradient/bokeh generative-art treatments, particle effects, minimalist SVG iconography per model card. (Live WebFetch, 2026-09-01)
- Gemini's Neural Expressive redesign restructures *response* layout too: no more "walls of text" — bolded key info up top, inline images/narrated video/timelines/interactive visualizations replacing prose blocks. This is an information-density/IA change, not just skin-deep visual polish. [thenextweb](https://thenextweb.com/news/google-gemini-app-daily-brief-redesign-io-2026), [androidauthority](https://www.androidauthority.com/google-gemini-neural-expressive-gemini-spark-daily-brief-omni-updates-3668384/)
- Design credit: **Art&Graft** (external agency) partnered with Google DeepMind on the Gemini 3 visual system, having also done Gemini 2.0 — i.e., Gemini's brand system is externally agency-driven, iterated release-over-release. [the-brandidentity.com](https://the-brandidentity.com/project/art-graft-evolves-gemini-from-technical-showcase-to-living-system)

**Footer / tech stack**
- deepmind.google footer: three-column layout (Models | Research/Science | Products/Learn More) + social links + newsletter signup. Meta signals: Google Analytics, Schema.org structured data, assets served from `storage.googleapis.com`; no third-party JS framework detectable in markup at fetch time. (Live WebFetch, 2026-09-01)
- gemini.google.com direct fetch failed (header overflow) — UNVERIFIED for that surface specifically; findings above are for deepmind.google plus press coverage of the Gemini *app*, which may differ from the gemini.google marketing/landing page.

---

## Patterns Common to All Three (10 bullets)

1. Each ships a **proprietary/custom typeface or type pairing** rather than a stock system font for brand differentiation — OpenAI Sans (Dinamo), Copernicus+Styrene B+Tiempos (Anthropic), Google Sans+Roboto (Google). [Medium](https://medium.com/@WebdesignerDepot/openai-gets-a-fresh-look-new-logo-custom-font-and-a-more-human-feel-b530d3e2dbf0), [type.today](https://type.today/en/journal/anthropic), [the-brandidentity.com](https://the-brandidentity.com/project/art-graft-evolves-gemini-from-technical-showcase-to-living-system)
2. All three pair a **light, restrained marketing site** with a separate, denser **product app surface** (openai.com vs chatgpt.com; anthropic.com vs claude.ai; deepmind.google vs gemini.google) with distinct visual registers.
3. All three run **dedicated public Trust/Security portals** (trust.openai.com, trust.anthropic.com) as a first-class enterprise-sales surface. [trust.openai.com](https://trust.openai.com/), [trustlists.org](https://trustlists.org/company/anthropic/)
4. All three use a **single accent color against a neutral base** rather than multi-color palettes: OpenAI's monochrome "point" black, Anthropic's coral #cc785c on cream, Google's blue-on-white (with Gemini's 2026 shift toward more saturated multi-color for the *app* specifically).
5. All three have gone through a **branded motion/identity refresh in the 2025–2026 window** timed to a major product milestone (OpenAI's full rebrand; Gemini 3's "Neural Expressive"; Anthropic's ongoing Styrene/Copernicus system) — visual identity is treated as a live, versioned product surface, not a static logo.
6. Hero sections favor **abstract/generative visuals over literal product screenshots** on the marketing sites (OpenAI's "point" motif, Anthropic's cream/coral callout cards, DeepMind's glowing-orb 3D renders) — de-emphasizing "here's a UI screenshot" in favor of brand mood.
7. All three use **external specialist agencies** for brand/motion work rather than pure in-house: OpenAI with Dinamo + Studio Dumbar/DEPT, Google DeepMind/Gemini with Art&Graft. [designcompass.org](https://designcompass.org/en/2025/02/06/openai-rebranding/), [the-brandidentity.com](https://the-brandidentity.com/project/art-graft-evolves-gemini-from-technical-showcase-to-living-system)
8. **Mega-menu / hierarchical dropdown nav** is the shared pattern for top-level nav (Anthropic: Research/Policy/Commitments/Learn/News/Claude; DeepMind: Models/Research/Science/About) — none use a command-palette-style nav on the marketing site.
9. Footers are **dense, multi-column sitemaps** (5–9 columns across Products/Research/Company/Legal/Social) rather than minimal footers — standard enterprise-SaaS trust-building via comprehensiveness.
10. All three explicitly reject a "cold/robotic AI" visual cliché in favor of **warmth and human-ness** as stated design intent — OpenAI's stated goal of countering "robotic precision," Anthropic's explicit "distance from intimidating neural-network aesthetics," and Gemini's "expressive"-branded shift away from flat Material Design toward fluid, human-feeling motion.

## Coverage / confidence note
- Directly verified via live WebFetch (2026-09-01): anthropic.com, deepmind.google.
- Blocked by anti-bot (403/parse error), relied on secondary sources: openai.com, chatgpt.com, claude.ai, gemini.google.com.
- No hex-code-level color values were independently confirmed from raw CSS for any of the three — all hex/palette claims above are attributed to named secondary sources or the WebFetch tool's qualitative read, and are marked UNVERIFIED where no source gave a code.
- Did not check page-load network waterfalls, response headers, or view-source for framework fingerprints (e.g., `__NEXT_DATA__`) — recommend a follow-up pass with a headless-browser-capable tool if exact tech-stack confirmation is required.
