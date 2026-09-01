# AI Creative-Tool Marketing Sites — Design Research Report

**Bottom line:** Only two companies in this set have primary-source-confirmed design specs: **ElevenLabs** (in-house-commissioned rebrand by **basement.studio** — Waldenburg + Inter, off-white canvas, atmospheric gradient orbs) and **Runway** (abcNormal type, pure black canvas, cinema-wide 1600px hero). For the rest, live sites actively block scraping (Ideogram, Midjourney returned HTTP 403; Krea, Udio threw parser errors on repeated attempts), and no public teardown documents their exact fonts/hex values — those cells are marked `UNVERIFIED`. Structural facts (nav, footer, hero copy, pricing/logo-wall patterns) were confirmed by direct fetch for most sites and are reliable.

## Coverage caveat (read first)
- Confirmed via primary teardown (fonts+hex+motion): **ElevenLabs, Runway**.
- Confirmed via direct fetch (structure/copy/nav/footer only — no CSS access): Suno, Luma, Pika, Higgsfield, HeyGen, Synthesia, Photoroom, Hume, Sesame, Descript, Captions, Magnific/Freepik.
- Blocked/failed on all attempts (403 or TLS parse error), structural claims are `UNVERIFIED` from secondary mentions only: **Ideogram, Midjourney, Udio, Krea**.
- No usable data found at all for design specifics: none excluded entirely, but Wikipedia/comparison-blog noise dominated searches for Ideogram/Midjourney/Udio — genuine teardown articles for this specific cohort are sparse on the open web (Godly/Awwwards/Lapa did not surface individual write-ups in search).

---

## Per-company notes

### ElevenLabs (elevenlabs.io)
Rebrand by **basement.studio** (confirmed) — kept the logotype, rebuilt color/motion/composition, built a custom Chladni-pattern sound-wave generator for remixable imagery. [basement.studio/showcase/elevenlabs-visual-rebrand-for-the-voice-of-ai](https://basement.studio/showcase/elevenlabs-visual-rebrand-for-the-voice-of-ai)
Type: **Waldenburg** (display, weight 300, editorial) + **Inter** (body/nav/captions, 400/500) + Geist Mono. Canvas `#f5f5f5`/`#fafafa`, ink `#292524`/`#0c0a09`, five pastel gradient orbs (mint `#a7e5d3`, peach `#f4c5a8`, lavender `#c8b8e0`, sky `#a8c8e8`, rose `#e8b8c4`). ~1200px max-width, 12-col grid, 96px section rhythm, mega hero at 64px/-1.92px tracking. [github.com/VoltAgent/awesome-design-md — elevenlabs/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/elevenlabs/DESIGN.md)
Motion timings/easing: **UNVERIFIED** — the source doc explicitly excludes them ("orb drift, waveform pulse, hero entrance out of scope").

### Runway (runwayml.com)
Type: custom **abcNormal** geometric sans (400–600, 450 intermediate), fallback Inter/DM Sans. Pure black `#000000` canvas, white text, dark card `#1a1a1a`, slate greys for secondary text. Cinema-wide max-width up to **1600px**, 8px base unit, full-bleed video/image hero with overlay headline, minimal transparent nav. [github.com/VoltAgent/awesome-design-md — runwayml/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/runwayml/DESIGN.md)
Agency/motion library: `UNVERIFIED` — not documented in source.

### Suno (suno.com)
Brand identity (post-July-2024 relaunch) by **Feels Like Studio**: "S" wonk-mark doubling as sine-wave/note/egg; pairs **Neue Montreal** across UI, plus a Displaay moog-inspired display face. Brand tokens: primary yellow `#f5d907`, surface `#f7f4ef`, white bg/text. [feelslike.studio/projects/the-new-generation-of-music-making](https://www.feelslike.studio/projects/the-new-generation-of-music-making), [designmd.co/d/suno-com](https://www.designmd.co/d/suno-com)
Live site (fetched): dark-mode hero image + "Make any song you can imagine," press logo wall (Billboard/Forbes/Rolling Stone/Wired/Variety), user-track showcase carousel, monthly/yearly pricing (Free/Pro/Premier), footer split Brand/Support, © 2026 Suno, Inc. No agency credit shown on-page. [suno.com](https://suno.com)

### Udio (udio.com)
`UNVERIFIED` — site returned only a title tag on fetch (bot mitigation); no teardown found in search beyond generic comparison articles ([interconnects.ai](https://www.interconnects.ai/p/midjourney-vs-ideogram)). Cannot confirm fonts, hex, motion, or agency.

### Krea (krea.ai)
`UNVERIFIED` for fonts/colors/motion — repeated fetches threw "Header overflow" parse errors. One corroborated fact: Krea appears in **basement.studio's** public client roster alongside Vercel, Cursor, Linear, Black Forest Labs. [tympanus.net/codrops — "From Basement to Breakthroughs"](https://tympanus.net/codrops/2025/12/15/from-basement-to-breakthroughs-inside-the-studio-powering-the-internets-boldest-brands/) The specific showcase case-study page for Krea (`basement.studio/showcase/krea`) 404'd, so scope of that engagement (brand vs. site vs. product) is unconfirmed.

### Luma (lumalabs.ai)
Live fetch confirmed: hero "You have the idea. Luma helps make it real," logo wall of agency partners (Serviceplan, Dentsu, Mazda, Publicis Groupe), Ray 3.2 / Uni‑1 API mentions, no pricing table on homepage. [lumalabs.ai](https://lumalabs.ai) Fonts/hex/motion: `UNVERIFIED`.

### Pika (pika.art)
Live fetch confirmed: nav includes a dedicated **API** link and "Experiments" (Pika Agent, Pika MCP, Pikaffects, AI Trendmaker); hero literally embeds a **5-second generated video player** ("Pika 2.5") as the primary visual — a strong example of product-output-as-hero. Dark mode, © 2026 Pika. [pika.art](https://pika.art) Fonts/hex/motion timings: `UNVERIFIED`.

### Higgsfield (higgsfield.ai)
Live fetch confirmed: hero literally stacks multiple **generated video demo reels** as content blocks (Genjutsu, "The Trigger" short film, Flux 3.0 4K upscale, Recraft V4). Dark mode throughout; nav references Enterprise/Team Plan tiers. [higgsfield.ai](https://higgsfield.ai) Fonts/hex/agency: `UNVERIFIED`.

### Ideogram (ideogram.ai)
Site blocked fetch (HTTP 403). No independent teardown found; only product-feature pages (text-layer, text-rendering) surfaced in search — none describe the marketing site's type/color/motion. All structural/visual claims here: `UNVERIFIED`.

### Midjourney (midjourney.com)
Site blocked fetch (HTTP 403). One agency signal surfaced — **Metalab** lists Midjourney "Rooms" (in-app multiplayer feature) as client work — but this is product-UI work, not confirmed as the marketing homepage. [metalab.com/work/midjourney](https://www.metalab.com/work/midjourney) — flag as `UNVERIFIED` for marketing-site attribution specifically. Fonts/hex/motion: `UNVERIFIED`.

### HeyGen (heygen.com)
Live fetch confirmed: enterprise-grade nav (Platform/Developers/Enterprise/Research), compliance badge row (SOC2/GDPR/CCPA/AI Act/DPF), 39+ logo wall, G2 rating badge, dedicated API pricing page. Design theme: `UNVERIFIED` (fetch reported "modern dark/light" without certainty). [heygen.com](https://www.heygen.com)

### Synthesia (synthesia.io)
Live fetch confirmed: deep mega-nav (Create/Localize/Manage/Publish/Engage), light-mode with blue CTA accent, 50,000+ company logo wall (Reuters, Zoom, SAP), Content Authenticity Initiative + SOC2 badges. [synthesia.io](https://www.synthesia.io) Fonts/hex: `UNVERIFIED`.

### Photoroom (photoroom.com)
Live fetch confirmed: light mode, e-commerce logo wall (Naver, Mercari, Depop, Decathlon), case-study block ("99% cost reduction per image" — Decathlon), Image API + Enterprise sections, SOC2/GDPR badges. Notably the fetched hero did **not** show a live before/after generation despite that being Photoroom's signature product surface — may be A/B'd or JS-rendered and invisible to markdown fetch. [photoroom.com](https://www.photoroom.com) Fonts/hex: `UNVERIFIED`.

### Hume (hume.ai)
Live fetch confirmed: dark mode, research-forward nav (Platform/Leaderboards/Resources/Research), no visible pricing or logo wall — B2B/API-only positioning via "Contact research" CTA. Headline: "The data and evaluation layer for emotionally intelligent voice AI." [hume.ai](https://www.hume.ai) Fonts/hex/motion/agency: `UNVERIFIED`.

### Sesame (sesame.com)
Live fetch confirmed: dark mode, minimal nav (Blog/Team/Mobile Preview/Research Preview), headline "Curiosity, met." Notably the live voice demo now lives at a separate route (`/mobile-preview` / previously `/voicedemo`), not embedded in the homepage hero at fetch time. [sesame.com](https://www.sesame.com), [BGR on the Maya/Miles demo](https://www.bgr.com/tech/this-new-ai-voice-demo-will-blow-your-mind/) No Awwwards/Godly teardown of the WebGL/voice-widget implementation was found — motion/tech-stack: `UNVERIFIED`.

### Descript (descript.com)
Live fetch confirmed: light mode, deep feature mega-nav, five-step workflow narrative (Record→Edit→Refine→Share→Multiply), enterprise logo wall (Spotify, Vox, CBS, NYT, Microsoft), SOC2/SAML badges. [descript.com](https://www.descript.com) Fonts/hex/agency: `UNVERIFIED`.

### Captions (captions.ai)
Live fetch confirmed: light mode, press logo wall (Bloomberg, TechCrunch, Forbes, NYSE), editing-style preset grid (Prism Pro, Paper II, Prime) in hero rather than a finished generated video, footer copyright under "NOCAP, Inc. d/b/a Captions." [captions.ai](https://www.captions.ai) Fonts/hex/motion: `UNVERIFIED`.

### Freepik AI / Magnific (magnific.ai → redirects to magnific.com)
Live fetch confirmed: `magnific.ai` 301-redirects to **magnific.com**; light mode, enterprise logo wall (Coca-Cola, Ogilvy, R/GA, Guess), copyright reads "© 2010-2026 **Freepik Company S.L.U.**" confirming Magnific is now folded into Freepik's corporate umbrella rather than an independent brand. [magnific.com](https://www.magnific.com/) Hero did not show the signature before/after upscale comparison at fetch time. Fonts/hex/motion/agency: `UNVERIFIED`.

---

## Comparison table

| Company | Fonts | Canvas hex | Accent hex | Hero tech | Motion lib/tool | Built on | Agency |
|---|---|---|---|---|---|---|---|
| ElevenLabs | Waldenburg (display, 300) + Inter + Geist Mono | `#f5f5f5`/`#fafafa` | mint `#a7e5d3`/peach `#f4c5a8`/lavender `#c8b8e0` | Static gradient-orb backdrop | UNVERIFIED | UNVERIFIED (no Framer/Webflow signal detected) | **basement.studio** [source](https://basement.studio/showcase/elevenlabs-visual-rebrand-for-the-voice-of-ai) |
| Runway | abcNormal (400–600) | `#000000` | white `#ffffff` on dark, slate greys | Full-bleed cinematic photo/video | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Suno | Neue Montreal + Displaay (moog display) | `#f7f4ef` / white | `#f5d907` (brand yellow) | Static hero banner image + user-track carousel | UNVERIFIED | UNVERIFIED | **Feels Like Studio** (brand/launch) [source](https://www.feelslike.studio/projects/the-new-generation-of-music-making) |
| Udio | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Krea | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED (basement.studio lists Krea as a client, scope unconfirmed) [source](https://tympanus.net/codrops/2025/12/15/from-basement-to-breakthroughs-inside-the-studio-powering-the-internets-boldest-brands/) |
| Luma | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Pika | UNVERIFIED | dark | UNVERIFIED | **Embedded generated video player as hero** [source](https://pika.art) | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Higgsfield | UNVERIFIED | dark | UNVERIFIED | Stacked generated-video demo reels [source](https://higgsfield.ai) | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Ideogram | UNVERIFIED (site blocked) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Midjourney | UNVERIFIED (site blocked) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED (Metalab did in-app "Rooms," not confirmed for marketing site) [source](https://www.metalab.com/work/midjourney) |
| HeyGen | UNVERIFIED | UNVERIFIED | UNVERIFIED | Static hero graphic, no live avatar demo | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Synthesia | UNVERIFIED | white | blue CTA | Static, video-player affordance | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Photoroom | UNVERIFIED | white | UNVERIFIED | Static text/CTA (no visible before/after in fetch) | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Hume | UNVERIFIED | dark | UNVERIFIED | Static, research-copy led | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Sesame | UNVERIFIED | dark | UNVERIFIED | Static hero; voice demo moved off-homepage | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Descript | UNVERIFIED | white | UNVERIFIED | Static, 5-step workflow narrative | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Captions | UNVERIFIED | white | UNVERIFIED | Style-preset grid, no finished output shown | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Magnific/Freepik | UNVERIFIED | white | UNVERIFIED | Static hero, logo wall (no before/after shown) | UNVERIFIED | UNVERIFIED | UNVERIFIED (owned by Freepik Company S.L.U.) [source](https://www.magnific.com/) |

---

## Techniques for making live product output the hero (transferable to live swap-routing data)

1. **Embed the real artifact, not a screenshot of it** — Pika's homepage hero is a literal generated video player, not a marketing render; the equivalent for Suwappu is a live route/quote card, not a static illustration. [pika.art](https://pika.art)
2. **Stack multiple real outputs as proof, not one hero shot** — Higgsfield chains several distinct generated demos (Genjutsu, upscale, style-transfer) in sequence so the page argues by volume of real evidence. Suwappu could stream several recent real swaps/routes in a rotating feed.
3. **Use a rotating community/social-proof carousel of real generations** — Suno's "user-generated tracks with play counts and likes" turns other users' real output into the hero's supporting evidence; a Suwappu analog is a feed of recent real trades with amounts/chains (privacy-safe, aggregated).
4. **Pair the live artifact with press/partner logo walls for instant trust** — Suno (Billboard/Forbes/Rolling Stone), HeyGen (39+ logos + G2 badge), Synthesia (50,000+ logos) all put credibility furniture directly beside the generated content, not on a separate page.
5. **Show compliance/trust badges next to the live data on money-adjacent products** — HeyGen and Synthesia surface SOC2/GDPR/compliance badges right at the point of "trust the output"; for a swap router this maps to visibly showing audited-contract or route-verification signals next to the live quote.
6. **Neutral, near-monochrome canvas so the generated content supplies all the color** — ElevenLabs deliberately keeps the frame off-white/near-black so its own colorful signal-wave visuals are the only saturation in the layout — directly transferable: keep chrome neutral so live token/route colors (chain badges, price deltas) read as the "generated" signal.
7. **Cinema-wide, edge-to-edge canvas for the artifact itself** — Runway's ~1600px max-width and full-bleed hero exist specifically so video/image output isn't boxed in by marketing-site chrome; a live swap-route visualization benefits from the same wide, uncontained treatment rather than being caged in a card.
8. **Make the "try it live" affordance the primary CTA, not secondary** — Pika/Higgsfield lead with "start creating" tied directly to the visible output; Suwappu's hero CTA should be "get this route now" tied to the literal live quote shown, not a generic "get started."
9. **Turn real usage stats into ambient design elements** — Suno shows play counts/likes inline on the track carousel; a swap-router equivalent is inline realized-slippage/fill-time numbers stamped directly on the live route card, not buried in a stats page.
10. **When the live artifact can't be embedded (blocked by auth/latency), fall back to workflow narrative, not a stock illustration** — Descript's five-step Record→Edit→Refine→Share→Multiply narrative is the honest fallback pattern several sites (Captions, HeyGen at fetch time) use when a real generated result isn't shown; better than a decorative hero if live route data is temporarily unavailable.

---

## Top 3 to study in detail

1. **ElevenLabs** — the only site in this set with a fully documented, primary-sourced design system (exact typefaces, hex values, spacing, agency attribution to basement.studio). Highest-leverage single reference for both visual language and the "neutral canvas + colorful generated signal" pattern directly applicable to Suwappu's swap-data hero. [elevenlabs/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/elevenlabs/DESIGN.md), [basement.studio case study](https://basement.studio/showcase/elevenlabs-visual-rebrand-for-the-voice-of-ai)
2. **Runway** — the cleanest documented example of "cinema-wide canvas, product-output-is-the-hero" at a large brand scale (1600px, full-bleed video hero), and the closest analog for a data/output-forward financial UI that still wants to feel premium. [runwayml/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/runwayml/DESIGN.md)
3. **Pika** — the single confirmed case in this set of a marketing hero literally embedding a live-generated artifact as the interactive centerpiece rather than a static render; directly maps to "put a real, live swap quote in the hero" as the core recommendation. [pika.art](https://pika.art)

**Suggested next steps:** if any of this needs to become an implemented Suwappu homepage pattern (live-route hero, neutral canvas + colorful data), route to `showcase-dev` for the marketing site or `webapp-dev` for the Mini App; consult `brand-guardian` before locking a canvas/accent palette across surfaces. This response is research-only — no code was touched.

```
