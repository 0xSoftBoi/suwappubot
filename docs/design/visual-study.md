# Visual study: why greptile/exa still look better than our page (2026-08-04)
Screenshots: study-greptile-*.png / study-exa-*.png in this directory. PATTERNS ONLY — never copy their assets, copy, logos, or exact artwork.

## The honest gap
Our page has the right structure and copy but a FLAT, UNIFORM canvas: untextured near-black, every section = headline + content + gap, default rounded buttons, one typeface voice (Geist everywhere), section boundaries are just margins. Theirs are ART-DIRECTED: every surface, boundary, and button carries identity.

## Observed moves (greptile — "engineering blueprint" craft)
G1. TEXTURED CANVAS: fine dot-grid/graph-paper across light sections; hairline vertical rules run FULL HEIGHT framing the content column; small + registration marks at rule intersections.
G2. RULED SECTION BOUNDARIES: dark sections open with a stack of tight horizontal rules (ruler edge) + tick marks; boundaries are designed objects, not margin gaps.
G3. BUTTON SHAPE IDENTITY: every button is an angular clipped shape (arrow/hexagon ends via clip-path), including nav CTAs. Instantly recognizable silhouette.
G4. PROOF CARDS AS PRODUCT OUTPUT: dashed-border frames, mono file-path header, real red/green diff bars, footer link row. GIANT real-entity names (NVIDIA / Meta PyTorch / Solana) sit above the columns as headers.
G5. GIANT ITALIC PULL-QUOTE: testimonial as near-full-width italic display text + avatar + mono attribution + CTA. A full "moment" section.
G6. MONO NAV: all-caps mono nav labels with tiny icons; mono all-caps social-proof strip at hero base.

## Observed moves (exa — editorial restraint)
E1. SERIF DISPLAY vs SANS BODY: big serif headlines over sans body — instant sophistication. Serif also used mid-page ("Wikipedia - Boeing" artifact titles).
E2. EXTREME HERO WHITESPACE: headline + one-line subhead + ONE black button + demo card. ~65% empty. No competing elements.
E3. HERO DEMO CARD: interactive product demo directly under CTA with mono-labeled controls (EFFORT / OUTPUT + segmented options) and an output table with mono column headers.
E4. LABELED ARTIFACT: mono all-caps stat chip ("90% TOKEN REDUCTION") + REAL content sample shown as the artifact + tiny black mode chip ("HIGHLIGHTS: OFF").
E5. SPLIT-PANEL SECTION: full-bleed half-black/half-white section — black panel: mono eyebrow + serif headline; white panel: real chart with real axes.
E6. PARTNER ONE-LINERS: flat warm-gray cards, logo + single sentence containing one giant verified number. No borders, no icons.
E7. TRUE-BLACK CODE BLOCKS floated on white — syntax colors pop.

## Adaptation directives for our page (dark + persimmon, our assets only)
D1 (from G1/G2): Add subtle dot-grid texture to the dark canvas (1px dots, ~4-6% opacity warm gray) + full-height hairline vertical rules at the content-column edges + ruled divider objects (4-6 tight hairlines + tick marks) between major sections + corner registration marks on proof cards.
D2 (from G3): Give buttons a consistent clipped-corner shape identity (CSS clip-path, one corner or two opposite corners cut at 45°) across nav + hero + sections. Subtle, not cartoonish.
D3 (from E1): Introduce a display serif for hero + section headlines via next/font (self-hosted; e.g. Instrument Serif or Source Serif 4). Body/UI stays Geist; stats stay JetBrains Mono. THE biggest single upgrade.
D4 (from E2): Cut hero clutter: serif headline, one-line subhead, ONE primary CTA + one text link. LiveQuote card becomes the exa-style demo card with mono-labeled control row.
D5 (from G4): Restyle the three proof cards as product output: dashed frames, mono GET-path headers (already have), corner marks; giant real chain names (Base / Solana / Tron — real, ours) as oversized headers tied to real routes.
D6 (from G5): Turn the A2A registry section into our "pull-quote moment": near-full-width italic serif statement + the agent-card JSON as artifact.
D7 (from E5): Security section → split panel: left dark textured panel (mono eyebrow + serif headline), right lighter panel (the 4 fact rows).
D8 (from E6): HyperLiquid / Tempo / Jupiter as flat one-line cards, each with ONE giant verified number.
D9 (from E7): Any JSON/code sample on the page gets a true-black block with syntax color, floated against the section bg.

## COLOR STUDY ADDENDUM (frames 06/08 greptile, 05/07 exa) — user wants more color + unique identity
Correction to earlier "one accent" doctrine: both sites use a TINTED base + 2-3 saturated pops with strict ROLES.
- Greptile: warm paper + deep violet-slate dark sections (#3d3b4f — tinted, never black) + mint green (primary CTA only) + pink (secondary CTAs only) + lavender-blue (micro-text strips "TEST · RUN · EXECUTE", rules on dark) + colored company chips on testimonials.
- Exa: cream + electric blue + tint ramp + semantic light/dark accent pairs + gradient-photo case-study covers + giant numerals on flat cream cards.
- Lesson: color count isn't the risk — role bleed is. One job per color.

## SUWAPPU "PERSIMMON ORCHARD" PALETTE (unique identity, derived from our persimmon logo — not from theirs)
- Base dark: deepen to warm aubergine-brown tint (soil): #1C1310 family (replace near-neutral black; sections vary #1C1310 / #241A15)
- P1 persimmon #E58D2B: PRIMARY CTAs + live indicators ONLY (existing ramp stays)
- P2 leaf green (new): desaturated jade ~#5E9C6F / deep #3E6B4F ramp: secondary CTAs, success/"live" chips, micro-text strips, syntax strings
- P3 cream #FAF3E6 (fruit flesh): light chips, inverted buttons, footer band (already cream), stat-card washes
- Semantic route coding (like exa's pairs): SWAP=persimmon, BRIDGE=leaf, SIGN=cream — apply to quote-race stages + step numbers
- Micro-text strips: mono all-caps "QUOTE · SIMULATE · SIGN" repeating band in muted leaf between major sections (our version of their lavender strips)
- Rules: each color exactly ONE role; never two saturated colors adjacent at equal weight; contrast >= 4.5:1 for text

## Serif justification (taste-skill 4.1 compliance note, 2026-08-04)
Instrument Serif is on the taste-skill banned-as-DEFAULT list. It is retained here as a
JUSTIFIED choice, not a default reach: the direction came from an explicit user brief to
adopt the editorial-serif register of a named reference (exa.ai), the brand voice of the
page is deliberately editorial ("proof, not promises" evidence-journal), and the face is
already shipped across hero/sections/pull-quote with tuned tracking. Backlog item: evaluate
a rotation-pool alternative (e.g. Tiempos Headline, Saol Display class) in a later loop
iteration and compare screenshots before any swap.
