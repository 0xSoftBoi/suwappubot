# exa.ai confirmed tokens (extracted from live CSS 2026-08-04)

- Fonts: ABC Diatype (sans, body+UI), Iowan (serif — editorial/display accents), Geist Mono (technical text, forced !important in places)
- Base: warm paper — #faf9f8 / #fafafa bg, blog-card hover #f2f0e9 (cream); warm grays #c2bfbb, #c9c9c8 ("burnished-metal"), deep warm brown-gray #514837
- Brand: electric blue #1f40ed with FULL RAMP: dark #0d2189, darker #000a40, muted #4d87e7, subtle #a1aff7, faint #c6cfff, fainter #e7ebfd — tints used as structured system, not one flat accent
- Semantic accent pairs (light bg + dark text): green/maroon/pink/purple/skyblue/yellow — used for category labeling (like syntax highlighting), each as light/dark pair
- Text: near-black #111827 (Tailwind gray-900), grays from same cool ramp for body
- Shadows: rgb(0 0 0/0.1), rgba(0,0,0,0.08) — soft, low opacity
- Personality: "technical journal" — warm paper + serif editorial moments + electric blue + mono. Warmer and more human than Greptile's cool #eee; more editorial than pure dev-tool.

## Delta vs Greptile tokens
- Greptile: single flat accent. Exa: one brand hue but a disciplined tint RAMP (dark→fainter) giving depth without adding hues.
- Exa adds serif display accents against sans body — editorial contrast.
- Exa adds semantic light/dark accent pairs for categorization (result types, tags) — like syntax highlighting for content.

## Structural breakdown (researcher, 2026-08-04)
Section order: Nav → Hero claim → LIVE INTERACTIVE DEMO (proof-by-doing) → logo strip → benefit recap + 2nd CTA → technical deep-dive → OVERSIZED STAT VISUAL (giant numerals as design objects) → structured-output JSON artifact → BENCHMARK CHART vs named rivals → case studies with hard numbers → enterprise/security → SCALE BOAST (infra numbers as closing flex) → footer.
Escalation: works → who uses it → cheap/fast → accurate vs rivals → outcomes → safe → big.

Copy: subject-first noun headlines, no adjectives; literal section heads; second person; quantitative bias; no founder storytelling. All-caps ONLY for stat labels (mono), never headlines. Sentence case.

Proof staging (3 escalating forms): rendered product UI output (table) → raw JSON schema → before/after content diff visualizing an efficiency claim. Shows the PRODUCT's output, not just API signatures.

## DELTA vs Greptile (what to ADD to showcase)
1. Proof-by-doing above the fold: live query→result demo as first thing seen (we have LiveQuote in hero — elevate it; it currently 503s without backend, needs graceful build-time-captured fallback, honestly labeled).
2. Oversized-numeral stat modules: 2-3 giant typographic stats (mono, tabular) as standalone visual objects, each with all-caps mono label.
3. Scale-boast close: infrastructure numbers as final credibility flex before footer.
4. Before/after or comparison artifact: our analog = multi-venue quote race (best price proven by showing venue quotes side by side).
5. Brand tint RAMP (one hue, dark→fainter steps) instead of single flat accent — depth without new hues.
6. (Skip unless defensible: benchmark chart vs named competitors — no invented data.)
