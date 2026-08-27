# Computational Aesthetics & Pixel-Art Verification — Literature Reference

Compiled 2026-08-27 for the Suwappu Positions renderer (64x80 grid, <=16 colour
palette, must read at 190px thumbnail). Companion to
`card-art-baseline-measurements.md`, which applies several of these to the
current output.

**Read the "folklore vs validated" section at the end before quoting any number
in this file as evidence.** Several widely-repeated metrics here have weak or
contested empirical support, and at least one (rule-of-thirds as a quality
*predictor*) is undermined by the data in its own source paper.

## Reference (as compiled)

Compiled for: generative pixel-art trading cards, 64x80 grid, <=16 colour
palette, must read at 190px thumbnail. Priority: implementable in pure
Python/numpy, and must let us MEASURE something about a rendered card.

## 1. Pixel art / image abstraction algorithms

### Gerstner, DeCarlo, Alexa, Finkelstein, Gingold, Nealen —
"Pixelated Image Abstraction," NPAR 2012.
Journal version: "Pixelated Image Abstraction with Integrated User
Constraints," Computers & Graphics 37(5), 2013.
- Links: https://gfx.cs.princeton.edu/pubs/Gerstner_2012_PIA/index.php
  (project + PDF), https://cragl.cs.gmu.edu/pixelate/ (journal + code),
  https://dl.acm.org/doi/10.1016/j.cag.2012.12.007
- Algorithm: joint optimization over (a) a superpixel assignment mapping
  input pixels to an MxN output grid and (b) a shared colour palette.
  EM-style alternation: assign each input pixel to the output cell whose
  joint (position, CIELAB colour) is closest; recompute each output
  cell's colour as the mean of its assigned input pixels (Lloyd
  relaxation, like SLIC superpixels but snapped to a regular pixel-art
  grid). Palette size is not fixed a priori — colours are grown by
  "palette splitting": start from one colour, split the highest-error
  cluster into two, re-run Lloyd/E-M, and use simulated annealing to
  escape local minima from the discrete grid-assignment step. A control
  parameter trades off palette size against reconstruction error.
  Final post-process: boost chroma in CIELAB, because naive
  downsample+quantize looks washed out relative to hand-drawn pixel art
  — this saturation correction is their most portable, cheapest-to-steal
  finding.
- Implementable in pure numpy: partially. The Lloyd/E-M loop and the
  chroma-boost post-process are trivial numpy. The full palette-splitting
  + simulated annealing over discrete grid assignment is moderate effort
  (a few hundred lines); no official public reference implementation
  found (project page hosts a compiled tool, not source).
- Measures: nothing by itself — it's generative, not a metric. But it
  gives you (1) a principled palette-size-vs-error curve you can log per
  card, and (2) the saturation-correction heuristic as a testable
  before/after chroma delta.
- Limitation: NOT superseded, still the reference joint
  superpixel+palette method for pixel art; no widely-cited successor
  paper as of writing this. UNVERIFIED: exact chroma-boost multiplier
  value (not stated as a fixed constant in the accessible material;
  paper frames it as user-study-tuned, not a universal constant).

### Kopf & Lischinski — "Depixelizing Pixel Art," SIGGRAPH Asia /
ACM TOG 30(4), 2011.
- Link: https://johanneskopf.de/publications/pixelart/ (paper + video)
- This is a *vectorization* algorithm (pixel art -> smooth SVG curves),
  not a generator — but its diagnostic machinery is directly reusable
  as a pixel-art quality checker:
  - Builds a pixel-similarity graph; for every 2x2 block with a
    "diagonal" same-colour pattern (checkerboard ambiguity) it resolves
    which diagonal is the "real" edge using: (1) curve-heuristic —
    prefer the connection that lets a smooth curve continue without a
    sharp corner, (2) sparse-pixel/island heuristic — isolated
    single-colour pixels should not be treated as connected diagonally,
    (3) connectedness — prefer the diagonal that keeps a larger
    same-colour region connected.
  - Practical reuse: count unresolved/ambiguous diagonal blocks and
    orphan single pixels in a rendered card as a cheap, implementable
    numpy "does this look like clean, intentional pixel art vs.
    quantization noise" score — lower count is better formed.
- Implementable in pure numpy: yes, for the diagnostic subset (graph of
  2x2 diagonal ambiguities + heuristic scoring). The full spline-fitting
  vectorizer is unnecessary for your use case.
- Limitation: designed for existing, hand-authored 8/16-bit-era pixel
  art; the heuristics assume a human already made deliberate diagonal
  choices, so applying it to a naive-quantized photo-derived pixel-art
  render will just report "lots of ambiguity" — useful as a relative
  metric (compare card A vs B) not an absolute pass/fail threshold.

### Pixel-art-specific quality / dithering-aware quantization
- No further peer-reviewed papers specifically on "pixel-art quality
  scoring" were found; the field beyond Gerstner and Kopf-Lischinski is
  mostly community heuristics (Lospec palette conventions, aseprite
  forum lore), not academic literature. Flagging this gap explicitly —
  don't expect a third anchor paper here.

## 2. Color harmony and palette aesthetics

### Cohen-Or, Sorkine, Gal, Leyvand, Xu — "Color Harmonization,"
ACM TOG (SIGGRAPH) 25(3), 2006.
- Link: https://igl.ethz.ch/projects/color-harmonization/harmonization.pdf
- Defines 8 hue-wheel templates as one or two angular sectors in HSV hue
  space: **i** (one narrow sector, ~18 deg wide), **V** (one wide sector,
  ~93.6 deg), **L** (two sectors, 18 deg + 93.6 deg, offset 90 deg),
  **I** (two 18-deg sectors, 180 deg apart), **T** (one 180-deg sector —
  half the wheel), **Y** (93.6-deg + 18-deg sectors, 180 deg apart),
  **X** (two 93.6-deg sectors, 180 deg apart). (Sector widths per
  standard reimplementations of the paper's Fig. 2 template; treat exact
  degree values as UNVERIFIED against the primary PDF — I could not
  re-derive them from the fetched source text alone, only from
  consistent third-party reimplementations.)
- Harmony energy: for a given template + rotation, every pixel's hue is
  scored by its angular distance to the nearest included sector,
  weighted by that pixel's saturation (low-saturation/near-grey pixels
  contribute ~0, so achromatic art doesn't get penalized). Sum over all
  pixels = disharmony energy. The algorithm searches all 8 templates x
  discretized rotations (e.g. every 1-2 deg) for the minimum-energy fit
  — trivially a numpy operation over a saturation-weighted hue histogram,
  no need to touch every pixel individually.
  Optional second step (not needed for scoring, only for correction):
  shift out-of-sector hues toward the nearest sector boundary with a
  Gaussian-weighted falloff to avoid banding.
- Implementable in pure numpy: yes, fully, for scoring. Cost: build a
  360-bin hue histogram weighted by saturation (and optionally pixel
  count/coverage for your palette), then a small grid search over
  8 templates x 360 rotations = trivial.
- Measures: a single harmony score per palette/card; also tells you
  *which* template your palette most resembles, which is a nice
  human-readable diagnostic ("this card is a T-harmony, high contrast").
- Limitation: validated by a small user study (~subjective preference,
  not a large dataset); superseded in predictive power by O'Donovan et
  al. 2011 below, which found template-only harmony explains rating
  variance worse than a learned model. Treat as "plausible, testable
  heuristic," not ground truth.

### O'Donovan, Agarwala, Hertzmann — "Color Compatibility From Large
Datasets," ACM TOG (SIGGRAPH) 30(4), 2011.
- Links: https://www.dgp.toronto.edu/~donovan/color/ (data + code),
  https://dl.acm.org/doi/10.1145/2010324.1964958
- Learns a regression model scoring 5-colour "themes" scraped from
  COLOURlovers.com with real user ratings. Features include, per-pair
  and per-colour statistics over the 5 colours: hue/lightness/saturation
  differences between sorted-by-lightness pairs, mean saturation/
  lightness, hue histogram spread, and match to Cohen-Or-style harmonic
  templates as one input feature among many (they explicitly test and
  partially refute "template-only" theories).
- Implementable in pure numpy: the *feature extraction* yes; the learned
  model itself — exact algorithm/coefficients I could not verify from
  available sources (project page states code+data are released, but
  under CC BY-NC-SA, i.e. non-commercial). UNVERIFIED beyond "code/data
  exist and are non-commercially licensed" — do not treat this as a
  drop-in scorer for a commercial product without checking the license
  again and re-deriving/retraining rather than reusing their exact
  artifact.
- Measures: a learned 5-colour compatibility score, if you retrain your
  own model on their features using a compatible dataset/license.
- Follow-ups / critiques: their own paper is itself a critique of
  template-based harmony (shows templates alone underperform a learned
  model) — cite this when someone proposes "just implement Cohen-Or and
  call it done."

## 3. Computational aesthetics / general image quality

### Birkhoff aesthetic measure, M = O/C (1933) and descendants
- No stable modern DOI; widely cited via secondary sources. Modern
  information-theoretic descendants: Rigau, Feixas, Sbert, "Informational
  Aesthetics Measures," IEEE CG&A 28(2), 2008 (uses Shannon entropy /
  compression-ratio as a numeric stand-in for Birkhoff's "complexity" C).
- Implementable in pure numpy/stdlib: yes, trivially — approximate C via
  `len(zlib.compress(image_bytes)) / len(image_bytes)` (compressed size
  ratio as a Kolmogorov-complexity proxy) and O via a symmetry/edge-order
  measure of your choosing.
- Limitation: **folklore-with-a-citation, not empirically strong.** No
  large-scale validation against human aesthetic ratings for this exact
  formulation; treat as a cheap monitoring metric (e.g. "did generation
  produce degenerate near-solid-colour output" or "did it produce pure
  noise"), not a quality gate.

### Datta, Joshi, Li, Wang — "Studying Aesthetics in Photographic
Images Using a Computational Approach," ECCV 2006.
### Ke, Tang, Jing — "The Design of High-Level Features for Photo
Quality Assessment," CVPR 2006.
- Hand-crafted features: colourfulness, rule-of-thirds composition (via
  a low-frequency wavelet region check), saturation/hue spread, blur/
  depth-of-field indicators, edge-spatial-distribution "simplicity."
  Trained SVM / simple classifiers on curated photo-quality datasets.
- Implementable in pure numpy: most features yes (colourfulness, hue
  spread, edge-distribution simplicity); blur/depth-of-field features
  are meaningless for flat pixel art and should be dropped.
- Transfer to your use case: **colourfulness features transfer**
  (see Hasler & Süsstrunk below, which is the properly validated version
  of this idea); **rule-of-thirds and blur/DOF features do not** — flat,
  fixed-composition trading cards have no camera-derived depth cues, and
  Datta et al.'s own results show rule-of-thirds-style features are
  among their *weakest* predictors of rated quality, i.e. even the
  source paper doesn't strongly validate it.

### Hasler & Süsstrunk — "Measuring Colorfulness in Natural Images,"
SPIE Human Vision and Electronic Imaging VIII, 2003.
- Algorithm (fully implementable in ~6 lines numpy):
  `rg = R - G; yb = 0.5*(R+G) - B`
  `colorfulness = sqrt(std(rg)**2 + std(yb)**2) + 0.3*sqrt(mean(rg)**2 + mean(yb)**2)`
- Measures: a single scalar colourfulness score, validated against human
  ratings with reported correlation ~0.95 (one of the best-validated
  simple metrics in this entire literature).
- Limitation: validated on natural photographs, not tested by the
  authors on flat/limited-palette art — but the formula makes no
  photographic assumptions (no blur/DOF/lighting terms), so it should
  transfer cleanly. Good, cheap sanity check for "is this card vibrant
  enough to read at 190px" vs. a muddy/desaturated failure mode.

### AVA dataset — Murray, Marchesotti, Perronnin, CVPR 2012.
### NIMA — Talebi & Milanfar, IEEE TIP 27(8), 2018 (arXiv:1709.05424).
- AVA: 255,000+ photos from DPChallenge.com, each rated by ~200 people.
- NIMA: CNN backbone (Inception-v2/MobileNet/VGG variants exist),
  predicts a full 1-10 score distribution (not just a mean) via an
  Earth-Mover's-Distance loss, trained on AVA (+ TID2013 for technical
  quality).
- Pretrained, runnable offline: **yes** — multiple public checkpoints
  exist, e.g. https://github.com/yunxiaoshi/Neural-IMage-Assessment
  (PyTorch, VGG16 backbone) and idealo/image-quality-assessment
  (TensorFlow, MobileNet). Small enough to run on CPU for a 64x80-derived
  thumbnail in well under a second.
- Limitation: **significant domain mismatch.** Trained entirely on
  photography-contest images; has no exposure to flat, limited-palette,
  pixel-grid art during training. Treat any NIMA score on your cards as
  a weak, possibly-misleading signal, not ground truth — good as a
  "did generation catastrophically break" tripwire, bad as a fine-grained
  quality gate.

### Graphic-design-specific aesthetics (as opposed to photos)
- Most directly relevant: O'Donovan et al. TVCG 2014 (section 5 below)
  and Bylinskii et al. UIST 2017 (section 4 below) — both trained on
  real graphic-design corpora rather than photographs. There is no
  widely-cited "NIMA for graphic design" equivalent as of writing; this
  is a genuine literature gap, not something I failed to find.

## 4. Saliency / visual attention

### Itti, Koch, Niebur — "A Model of Saliency-Based Visual Attention
for Rapid Scene Analysis," IEEE PAMI 20(11), 1998.
- Algorithm: builds Gaussian pyramids for intensity, colour (R-G, B-Y
  opponency), and orientation (Gabor filters at 4 angles) across ~9
  scales; computes center-surround differences (across-scale pyramid
  subtraction) per feature; normalizes each feature map to promote maps
  with few strong peaks; sums into 3 conspicuity maps (intensity, colour,
  orientation), then averages into one saliency map.
- Implementable in pure numpy/scipy: yes, but substantial (multi-scale
  pyramids x 3 feature channels x normalization step), roughly
  200-400 lines. Meaningfully more effort than spectral residual for a
  similar practical payoff at your canvas size.

### Hou & Zhang — "Saliency Detection: A Spectral Residual Approach,"
CVPR 2007.
- Link: https://www.researchgate.net/publication/221364530 ; reference
  code: https://github.com/uoip/SpectralResidualSaliency
- Exact algorithm (~20 lines numpy):
  1. Convert to grayscale, resize to a small fixed size (e.g. 64x64).
  2. `F = fft2(img)`; amplitude `A = abs(F)`, phase `P = angle(F)`.
  3. Log amplitude `L = log(A)`.
  4. Smooth `L` with a small local-average filter (e.g. 3x3 box/avg
     conv) to get `A_L` — the "expected," redundant part of the
     spectrum.
  5. Spectral residual `R = L - A_L`.
  6. Reconstruct: `S = ifft2(exp(R + 1j*P))`.
  7. Saliency map = `abs(S)**2`, then Gaussian-blur (sigma~3) and
     normalize to [0,1].
- Measures: a per-pixel saliency map you can threshold or reduce to a
  scalar "focal concentration" score — e.g. fraction of total saliency
  mass inside the card's intended subject bounding box vs. background/
  border. This directly answers "does the card read as having one focal
  subject, or is attention scattered across ornamentation."
- Limitation: validated on natural-image eye-tracking data and synthetic
  pop-out search arrays — **not** validated on flat vector/pixel-art or
  UI/graphic-design imagery. Known caveat (see Bylinskii et al. below):
  natural-image saliency models are tuned to photographic contrast/
  texture statistics and transfer poorly to flat, large-solid-colour-
  region graphics; expect it to be a rough proxy, not ground truth, for
  pixel art.

### Saliency validated on graphic design / UI
- Bylinskii, Kim, O'Donovan, Alsheikh, Madan, Pfister, Durand, Russell,
  Hertzmann — "Learning Visual Importance for Graphic Designs and Data
  Visualizations," UIST 2017 (arXiv:1708.02660).
- Introduces a real "importance" dataset for ads/designs (not photos)
  and trains an FCN specifically on it; the paper's own comparisons show
  natural-image saliency models (Itti-Koch-style, spectral-residual-
  style) underperform models trained on design-specific importance data
  — i.e. this is the primary citation for "don't trust natural-image
  saliency on flat graphics without caveats," which directly supports
  treating spectral residual above as a rough heuristic only.
- Implementable in pure numpy: no (it's a trained CNN); useful mainly as
  the citation backing the caveat, and as a target if you ever want to
  train your own small importance model on your own card corpus.

## 5. Layout and composition

### O'Donovan, Agarwala, Hertzmann — "Learning Layouts for Single-Page
Graphic Designs," IEEE TVCG 20(8), 2014.
- Links: https://www.dgp.toronto.edu/~donovan/layout/ ,
  https://research.adobe.com/publication/learning-layouts-for-single-page-graphic-designs/
- Energy-based layout model with terms including: alignment (elements
  sharing edges/centers score lower energy), overlap (penalized unless
  hierarchy specifies deliberate layering), white-space/balance
  distribution, importance-consistent visual flow (higher-importance
  elements should occupy positions consistent with predicted gaze
  order), and hierarchical grouping consistency. Per-design weights are
  fit via Nonlinear Inverse Optimization (NIO) from a small set of
  example layouts, rather than a single universal weight vector —
  meaning **there is no one canonical numeric weight table to copy**;
  weights are genre/example-dependent by design. UNVERIFIED: I could not
  confirm any published fixed weight values usable as constants.
- Implementable in pure numpy: the *term definitions* (alignment score,
  overlap penalty, white-space variance) yes; the *learned relative
  weighting* no, without their example-layout corpus and an inverse-
  optimization solver.
- Fit for your use case: partial. Your cards are a fixed template (not
  free single-page layout), so alignment/overlap terms are less relevant
  than for flyers/posters; the white-space and importance-flow ideas are
  still usable as hand-tuned (not learned) sanity checks.
- Follow-up: "Aesthetics++: Refining Graphic Designs by Exploring Design
  Principles and Human Preference," IEEE TVCG 2022 — a more recent
  learned-preference model in the same lineage; not evaluated in depth
  here, flagging for awareness only.

### Rule of thirds / visual balance detection
- Computationally testable (saliency-peak or edge-energy location
  relative to a 3x3 grid), but empirical support is **contested**: even
  Datta et al. 2006 (section 3) found rule-of-thirds-style features
  among their weakest predictors on real rated-photo data. Treat
  rule-of-thirds compliance as a stylistic choice to enforce by design
  (e.g. "put the subject at a thirds intersection because it looks
  balanced to us"), not as something with strong independent empirical
  backing as a *predictor* of perceived quality.

## 6. Dithering and halftoning

### Ulichney — "Void-and-cluster method for dither array generation,"
Proc. SPIE 1913, 1993.
- Algorithm (exact, implementable in pure numpy for tile sizes like
  32x32 or 64x64; naive O(n^2)-per-step version is fine at that scale):
  1. Seed a binary pattern with ~10% of pixels set to 1 (initial
     "prototype"), rest 0.
  2. Convolve the binary pattern with a Gaussian filter (toroidal /
     wrap-around, so the tile is seamlessly tileable) to get a density
     map.
  3. Find the "tightest cluster": the currently-1 pixel with the highest
     density value; set it to 0, update the density map. Repeat until
     the prototype stabilizes (an initial cleanup pass).
  4. Rank-order construction, two passes from the stabilized prototype:
     - Going down: repeatedly remove the tightest cluster (highest
       density among current 1s), assigning decreasing rank values —
       fills in the dither array's lower half of threshold ranks.
     - Going up from the same prototype: repeatedly fill the largest
       void (lowest density among current 0s), assigning increasing
       ranks — fills the upper half.
  5. The resulting rank matrix, normalized to [0,255], is the blue-noise
     dither threshold matrix; precompute once, reuse for every card.
- Measures/enables: a proper blue-noise ordered-dither matrix for your
  16-color quantization step — directly reduces visible banding at low
  color counts, which is the most common visible defect at 190px.
- Limitation: not superseded — still the standard reference algorithm
  for blue-noise dither masks; naive implementation is slow for large
  images but your tile sizes (<=64px) make that a non-issue since you
  precompute once and reuse.

### Ostromoukhov — "A Simple and Efficient Error-Diffusion Algorithm,"
SIGGRAPH 2001.
- Variable-coefficient error diffusion: instead of Floyd-Steinberg's
  fixed 7/16, 3/16, 5/16, 1/16 kernel, uses a lookup table of
  (a, b, c) diffusion-coefficient triplets — one triplet per input
  intensity level (0-255) — diffused to the same 3 neighbors (right,
  bottom-left, bottom) but with intensity-dependent weights, chosen to
  avoid Floyd-Steinberg's characteristic diagonal "worm" artifacts.
- Implementable in pure numpy: yes, given the published 256-entry
  coefficient table from the paper/SIGGRAPH course notes (not
  re-derived here — pull the table directly from the paper if
  implementing).
- Why blue noise beats Bayer/ordered dithering perceptually (Ulichney's
  own analysis, uncontested): the human contrast-sensitivity function
  (CSF) is low-pass — it's much more sensitive to low/mid spatial
  frequencies than high ones. Blue noise concentrates dither-pattern
  energy at high spatial frequencies, above the CSF's sensitive range,
  so the pattern reads as smooth tone rather than visible texture.
  Bayer/ordered dithering instead produces strong periodic energy at
  low/mid frequencies (the visible crosshatch/grid), which sits squarely
  in the CSF's sensitive band and is perceived as structured texture,
  not smooth gradation. This is well-established, not contested.

## Summary of what is folklore vs. validated
- **Well validated, safe to trust as a metric**: Hasler & Süsstrunk
  colourfulness (r~0.95 vs human ratings); Ulichney's blue-noise-vs-CSF
  argument for why blue noise beats ordered dithering.
- **Plausible, testable, but only moderately validated**: Cohen-Or
  harmony templates (small user study; explicitly shown to underperform
  a learned model in O'Donovan et al. 2011); Kopf-Lischinski
  well-formedness heuristics (designed for a different task, repurposed
  here as a diagnostic).
- **Contested / weak support despite being commonly repeated**:
  rule-of-thirds as a quality predictor (weak in Datta et al.'s own
  data); Birkhoff M=O/C and its compression-based descendants (cheap to
  compute, not strongly validated against human ratings).
- **Real domain mismatch, use with caution**: NIMA/AVA and natural-image
  saliency (Itti-Koch, spectral residual) applied to flat pixel art —
  both trained/validated on photographs, and Bylinskii et al. 2017
  explicitly shows natural-image saliency underperforms on graphic
  design.
- **Not independently reusable as a drop-in scorer**: O'Donovan et al.
  2011 color-compatibility model (non-commercial license; exact
  coefficients not confirmed) and O'Donovan et al. 2014 layout weights
  (example-dependent, not published as universal constants).
</content>
