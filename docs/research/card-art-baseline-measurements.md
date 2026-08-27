# Card art: measured baseline before the theory-grounded rebuild

Date: 2026-08-27. Measured with `nft/position-cards/analysis.py` (spectral-residual
saliency, notan value histogram, Cohen-Or harmonic templates) and
`nft/position-cards/oklab.py` (OKLab/OKLCH, Ottosson 2020).

The point of writing these down: "the art could be better" is not actionable, and
on a 4,444-card generative collection nobody can inspect every output. These are
the specific, reproducible defects the rebuild has to fix, each with a number
attached so the fix can be proven rather than asserted.

## 1. The palette was built in a non-perceptual space

The first engine built ramps in HSL. HSL's "lightness" is an algebraic midpoint,
not a measure of perceived lightness. Measured:

- Pure yellow and pure blue, both at HSL L=0.50, measure **OKLab L 0.968 vs
  0.452** — a 2.1x difference in how light they actually look.
- The ten sector anchors, all authored at a constant HSL L=0.62, span
  **OKLab L 0.625 → 0.772** (a 0.147 spread, ~23%). So the ten sector families
  shipped with ten *different* value structures, unintentionally: Crypto,
  Space and Software read light; AI Infrastructure and Index read heavy.

Consequence: hue rotation was silently contaminating the value structure it was
supposed to sit on top of. Value and hue could not be controlled independently.

## 2. Roughly half the palette slots were perceptually redundant

Palette entries whose OKLab L differs by less than ~0.03 are one value wearing
two names — they cost a slot from a 16-colour budget and buy no readable step.

| Card | Near-duplicate L pairs | Palette size |
|---|---|---|
| NVDA (standard) | **7** — including an exact tie at L=0.899 | 14 |
| GME (gold) | **5** | 14 |

So a nominal 14-colour palette was delivering roughly 7 distinct values.

## 3. The value structure (notan) is bimodal, with no midtones

Share of canvas per value tier, measured in OKLab L:

| Card | dark | shadow | light | bright |
|---|---|---|---|---|
| NVDA | 77% | 3% | 8% | 11% |
| GME (gold) | 70% | 5% | 9% | 16% |
| SPY | 83% | 6% | 5% | 6% |
| IONQ (gold) | 71% | 3% | 9% | 17% |

A classic value study distributes mass roughly 60/30/10. This is bimodal — a
very dark ground and bright type with **3–6% in the entire shadow tier**, which
is where a form's halftone and core shadow live. The creature has almost no
internal value structure; it is a flat shape on a dark field.

## 4. The type beats the art for attention

Spectral-residual saliency (Hou & Zhang, CVPR 2007), reported as saliency share
divided by area share — 1.0 means "pulls no more attention than its size
predicts".

| Card | creature's eye band | hero number |
|---|---|---|
| NVDA | 1.31 | **1.88** |
| GME | 1.35 | **1.70** |
| SPY | 1.04 | **1.53** |
| IONQ | 1.22 | **1.50** |

The collection's stated design principle is "the position IS the animal" — the
silhouette is supposed to be the first read. Measurably, it is not: the number
wins on every card. Either the composition changes or the claim does.

Caveat, stated because it matters: this model was validated on natural
photographs, has no semantics (it does not know an eye is an eye), and flat
high-contrast vector art is out of its distribution. It is used as a coarse
relative check between regions of the *same* image, never as a quality score.

## 5. The harmony result was a false positive

The first run scored **0° deviation** against Cohen-Or harmonic templates and
looked like a pass. It is not: the winning templates were `X` and `T`, and `T`
spans a 180° arc — half the hue wheel. Fitting it proves nothing.

Re-scored against only the discriminating narrow templates (`i`, `V`, `L`, `I`):

- NVDA: `L` template, **11°** deviation — genuinely reasonable, with the green
  accent sitting opposite the blue ground as intended.
- GME (gold): `V` template, **0°** — but its hues span only 17–110°, i.e. it is
  monochrome-warm. Harmonious and monotonous are not the same thing.

Lesson for the rebuild: report the narrow-template fit, and never quote a metric
whose permissive mode makes failure impossible.

## Known-wrong by craft theory, independent of the above

- The darkest value sits on the **contour**. A core shadow (terminator) belongs
  *inside* the form, with reflected light between it and the shadow-side rim;
  putting the darkest note on the silhouette edge reads as an outline and
  flattens the form.
- There is **no reflected light** and **no cast shadow or occlusion** anywhere.
- The outline is a uniform dark key rather than selective (selout), so it does
  not modulate with the lighting.
- No dithering, so the palette cannot imply intermediate values.
