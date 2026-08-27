# W3.1 — The canonical correction, run on ourselves

Tool: `scripts/art/canonical_correction.py` · Data: `.audit/art-canonical.json`
Corpus: 29 SVGs across `art/` and `nft/` · Claimed identity: `nft/position-cards/THEME.md`

```bash
python3 scripts/art/canonical_correction.py art nft --claimed nft/position-cards/THEME.md --clusters 5
```

## Method, and one deliberate departure

Tektonic sampled 1,871 video frames, downsampled each to 64×64, built a 19-float vector
(5 dominant colours by k-means, Canny edge density, mean brightness, mean saturation,
colour variance) and clustered at k=40 to find 7 canonical techniques.

Our art is **vector**, so the measurement is taken one step earlier: over the authored
colours weighted by the area they paint, rather than over pixels recovered from a raster.
Rasterising would add an approximation and a heavy dependency to get a worse answer. The
19 floats map one-for-one; stroke density stands in for Canny edge density. Stdlib only,
deterministic seeding, so the same corpus always yields the same palette — a correction
nobody can reproduce is not a correction.

## Measured identity

| Colour | Share | Lum | Sat | Nearest claimed |
|---|---:|---:|---:|---|
| `#050606` | 66.8% | 0.02 | 0.07 | Obsidian `#0a0b0d` (d=10) |
| `#f5f3ed` | 20.3% | 0.95 | 0.29 | Ivory `#f2ede3` (d=12) |
| `#78523f` | 4.3% | 0.36 | 0.31 | near Oxblood `#8f3a44` (d=34) |
| `#a9ac9d` | 3.0% | 0.66 | 0.08 | Graphite `#9ea1a6` (d=18) |
| `#4e4c44` | 2.2% | 0.30 | 0.06 | Graphite `#3f4145` (d=18) |
| **`#d98b2c`** | **2.1%** | 0.59 | **0.70** | **not in the docs** (d=75) |
| `#1d5335` | 1.2% | 0.25 | 0.48 | — (d=41) |

Corpus means: stroke density 0.829, luminance 0.269, saturation 0.145, variance 0.648.

## The correction

**THEME.md describes a semantic colour system. The art is a near-monochrome dark study
carrying a single orange accent that the document never mentions.**

Two specific mismatches:

1. **`#d98b2c` is the most saturated colour in the corpus (sat 0.70) and appears in no
   design doc for this collection.** It is persimmon — `--sw-accent: #E58D2B` from the
   showcase's `globals.css`. The art has been quietly unified around the *site's* accent
   while the collection's own theme document describes something else.

2. **THEME.md names Suwappu Pink `#f472b6` as "the single saturated element". It measures
   98 away from anything in the corpus** — the largest gap of any claimed colour. The
   role it is assigned is real; the colour filling that role is not the one named.
   Champagne Gold (69), the Jade→Champagne gains ramp (63–83) and Oxblood (68) are all
   similarly distant.

This is the same shape as Tektonic's finding: the collaborator's stated identity ("Neon
Contour", edge detection) was not the measured one (bloom, diffusion, crushed black), and
clustering was what caught it.

**The honest caveat.** Area-weighting measures *visual weight*, not presence. A control
grep confirms the semantic colours are in the files — `#f472b6` appears in 12, `#e0bd76`
in 4, `#5da97f` in 2. They are painted onto small, semantically critical elements: the
return figure, the brand mark, the tier metal. So the finding is **not** "these colours
are missing"; it is "the document's palette describes a system whose colours carry almost
none of the visual weight, while an undocumented orange carries all of the saturation."
Both facts are true and neither is the whole story.

## Clusters

Five clusters over the 19-float vectors:

- **cluster 2 — 14 files (48.3%)** — membership Enterprise/Free tiers plus
  `genesis-persimmon`. lum 0.27, strokes 0.969.
- **cluster 0 — 6 files (20.7%)** — the position cards. lum 0.17, strokes 0.383: the
  darkest and by far the least stroked group.
- **cluster 1 — 5 files (17.2%)** and **cluster 3 — 3 files (10.3%)** — Premium and Pro
  membership variants, separated from cluster 2 only by luminance (0.27 vs 0.28) and
  stroke density. Three clusters split what is really one family.
- **cluster 4 — 1 file** — `QQQ-giltproof.svg`, lum 0.73. The inverted rare proof, and
  correctly its own thing.

The useful signal: position cards and membership cards are **measurably different
objects** — stroke density 0.383 against ~0.97 — not two expressions of one system.

## What to do with this

Per W3.2/W3.3, the answer is not to repaint anything. It is to decide which identity is
the real one — the documented semantic palette or the measured persimmon-on-obsidian —
and then make the other match. Whichever way that goes, `art-director` should be the one
holding the decision, because clustering finds what is *common* and cannot tell you what
is *good*. That is precisely the division Tektonic landed on: the human curates intent,
the machine executes with precision.

---

# W3.4 — The generated-asset validation gate

Tool: `scripts/art/validate_asset.py`. Exit 0 all-pass, 1 on any failure — this one *is*
a gate, unlike the money scanner, because it asserts facts about files rather than
heuristics.

Their four steps, mapped to SVG:

| Tektonic | Ours |
|---|---|
| `ast.parse()` | well-formed XML, root is `<svg>` |
| required exports present | `viewBox`/dimensions declared, within size budget |
| test run on mock + zero input | every `url(#id)` resolves, no scripts, no external fetches |
| output shape/dtype match | aspect, size and palette conform to the collection |

Step 3 carries the weight. A `fill="url(#grad-gain)"` pointing at a renamed gradient
renders black or invisible, raises nothing, and stays wrong until a human happens to look
— the generative analogue of the boot-import gate we already run on Python.

**Verified against deliberately broken fixtures**, each caught at the correct step:
malformed XML → `parses`; dangling `url(#grad-loss)` → `renders`; `<script>` plus a remote
`<image href>` → `renders` (both); wrong aspect ratio → `conforms`.

**Against the real corpus: 28 of 29 pass.** The one failure is
`art/genesis-persimmon/genesis-persimmon.svg` at **1,672,166 bytes — 3.3× the 512KB
budget**, with 5,736 elements. Two caveats stated plainly: that budget is a mint-asset
threshold, and if this piece is a poster rather than a mint asset the threshold is the
wrong one to judge it by — that is the owner's call, not the tool's. Its 24 out-of-palette
colours are flagged only because it was checked against *position-cards*' THEME.md; it
belongs to a different collection and the warning should be read as "no palette declared
for this piece" rather than as drift.

```bash
python3 scripts/art/validate_asset.py nft --collection nft/position-cards/THEME.md --aspect 0.8
python3 scripts/art/validate_asset.py nft art --quiet --json .audit/assets.json
```
