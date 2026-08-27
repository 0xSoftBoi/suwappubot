#!/usr/bin/env python3
"""Measurable checks on a rendered card, from the literature.

The point of this file is that "it looks good" is not a claim anyone can check,
and on a 4,444-card generative collection nobody can look at every output. These
are published algorithms and metrics, implemented so the sweep can assert design
intent instead of asserting that a file parses.

Implemented here:

  saliency_map()      Hou & Zhang, "Saliency Detection: A Spectral Residual
                      Approach", CVPR 2007. Bottom-up attention from the FFT
                      log-amplitude residual. Lets us ask, objectively, whether
                      a viewer's eye lands where the composition intends.
                      https://doi.org/10.1109/CVPR.2007.383267

  value_histogram()   Notan / value massing (Arthur Wesley Dow). A composition
                      is built on its light-dark pattern; if that pattern is
                      mush when squinted, no amount of hue fixes it. Measured in
                      OKLab L, not WCAG luminance — see oklab.py for why.

  colorfulness()      Hasler & Süsstrunk, "Measuring Colorfulness in Natural
                      Images", SPIE HVEI VIII, 2003. Reported correlation
                      ~0.95 against human ratings — the best-validated simple
                      metric in this literature. Six lines, no assumptions
                      about photography (no blur/DOF terms), so it transfers
                      to flat art cleanly.

  harmony_score()     Cohen-Or et al., "Color Harmonization", SIGGRAPH 2006.
                      Scores a palette's hue distribution against the harmonic
                      templates (i, V, L, I, T, Y, X) — a formal, testable
                      definition of colour harmony rather than an opinion.
                      https://doi.org/10.1145/1179352.1141933

CAVEATS, stated up front, because a metric quoted without them is worse than
no metric. O'Donovan et al. (SIGGRAPH 2011) showed template-only harmony
underperforms a learned model, so harmony_score is a heuristic and not ground
truth. The Cohen-Or sector widths used below (18 deg / 93.6 deg) come from
consistent third-party reimplementations, NOT re-derived from the primary PDF —
treat them as unverified. And rule-of-thirds style position metrics are
deliberately absent: Datta et al.'s own 2006 data ranks them among the WEAKEST
predictors of rated quality, so enforcing thirds is a style choice here, never
evidence.

On saliency specifically: spectral-residual saliency was validated on natural
photographs. Flat, high-contrast, text-bearing vector art is out of its training
distribution, and it has no notion of semantics (it does not know an eye is an
eye). It is used here only as a coarse, relative check — "is the intended focal
region among the most salient" — never as an aesthetic score. Treating any of
these numbers as a quality verdict would be exactly the folklore-with-a-citation
failure they are meant to replace.
"""

import cmath
import math

import numpy as np

from oklab import hex_to_oklch, oklab_lightness

# ── Hou & Zhang 2007: spectral residual saliency ────────────────────────────


def saliency_map(gray: np.ndarray, blur_sigma: float = 3.0) -> np.ndarray:
    """Saliency from the spectral residual of the log-amplitude spectrum.

    The insight of the paper: the statistically AVERAGE log-spectrum of natural
    images is smooth and scale-invariant, so whatever a particular image's
    spectrum does that the average does not — the residual — is its novelty, and
    novelty is what attracts bottom-up attention. Reconstructing from the
    residual amplitude with the ORIGINAL phase puts that novelty back in the
    spatial domain.
    """
    f = np.fft.fft2(gray)
    log_amp = np.log(np.abs(f) + 1e-9)
    phase = np.angle(f)
    # 3x3 box average = the "expected" smooth spectrum of the paper
    kernel = np.ones((3, 3)) / 9.0
    avg = _convolve2d(log_amp, kernel)
    residual = log_amp - avg
    sal = np.abs(np.fft.ifft2(np.exp(residual + 1j * phase))) ** 2
    return _gaussian_blur(sal, blur_sigma)


def _convolve2d(a: np.ndarray, k: np.ndarray) -> np.ndarray:
    ph, pw = k.shape[0] // 2, k.shape[1] // 2
    padded = np.pad(a, ((ph, ph), (pw, pw)), mode="edge")
    out = np.zeros_like(a, dtype=float)
    for i in range(k.shape[0]):
        for j in range(k.shape[1]):
            out += k[i, j] * padded[i : i + a.shape[0], j : j + a.shape[1]]
    return out


def _gaussian_blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return a
    r = max(1, int(3 * sigma))
    x = np.arange(-r, r + 1)
    g = np.exp(-(x**2) / (2 * sigma**2))
    g /= g.sum()
    out = np.apply_along_axis(lambda m: np.convolve(m, g, mode="same"), 0, a)
    return np.apply_along_axis(lambda m: np.convolve(m, g, mode="same"), 1, out)


def salience_of_region(gray: np.ndarray, box) -> float:
    """Share of total saliency mass falling inside (x0, y0, x1, y1).

    Reported as a RATIO to the region's area share, so 1.0 means "no more
    attention than its size would predict" and >1 means the region genuinely
    pulls. An absolute saliency number is meaningless across different images.
    """
    sal = saliency_map(gray)
    total = sal.sum()
    if total <= 0:
        return 0.0
    x0, y0, x1, y1 = box
    inside = sal[y0:y1, x0:x1].sum() / total
    area = ((x1 - x0) * (y1 - y0)) / (gray.shape[0] * gray.shape[1])
    return inside / max(area, 1e-9)


# ── notan / value structure ─────────────────────────────────────────────────

# Four tiers, the classic value study. Boundaries in OKLab L, which is
# perceptually uniform, so these are equal perceptual steps — the same
# boundaries in WCAG luminance would be badly bunched at the dark end.
VALUE_TIERS = (
    ("dark", 0.00, 0.32),
    ("shadow", 0.32, 0.52),
    ("light", 0.52, 0.74),
    ("bright", 0.74, 1.01),
)


def value_histogram(grid, palette: dict) -> dict:
    """Share of the canvas in each value tier."""
    Ls = {k: oklab_lightness(v) for k, v in palette.items()}
    counts = {name: 0 for name, _, _ in VALUE_TIERS}
    total = 0
    for row in grid:
        for v in row:
            if not v:
                continue
            total += 1
            L = Ls[v]
            for name, lo, hi in VALUE_TIERS:
                if lo <= L < hi:
                    counts[name] += 1
                    break
    return {k: (n / total if total else 0.0) for k, n in counts.items()}


def value_separation(palette: dict) -> float:
    """Smallest OKLab-L gap between any two palette entries.

    Two entries closer than roughly 0.03 are one colour wearing two names: they
    cost a palette slot and buy no readable step, which is the definition of a
    wasted colour in a 16-colour budget.
    """
    Ls = sorted(oklab_lightness(v) for v in palette.values())
    return min((b - a for a, b in zip(Ls, Ls[1:])), default=1.0)


# ── Cohen-Or et al. 2006: harmonic hue templates ────────────────────────────
# Each template is a set of (centre offset, arc width) sectors on the hue wheel.
# A palette is harmonic if its hues fit inside some rotation of some template.
# Widths are the paper's: narrow sectors 18 degrees, wide 80, opposite pairs at
# 180. Template Y and X are included for completeness though they rarely win on
# a palette this small.
HARMONIC_TEMPLATES = {
    "i": ((0.0, 18.0),),
    "V": ((0.0, 93.6),),
    "L": ((0.0, 18.0), (90.0, 80.0)),
    "I": ((0.0, 18.0), (180.0, 18.0)),
    "T": ((0.0, 180.0),),
    "Y": ((0.0, 93.6), (180.0, 18.0)),
    "X": ((0.0, 93.6), (180.0, 93.6)),
}


def _arc_distance(h: float, centre: float, width: float) -> float:
    """Degrees from hue h to the nearest edge of a sector; 0 if inside."""
    d = abs(((h - centre + 180.0) % 360.0) - 180.0)
    return max(0.0, d - width / 2.0)


def harmony_score(palette: dict, weight_by_chroma: bool = True):
    """(best template, mean angular deviation in degrees).

    Lower deviation is more harmonic. Hues are weighted by chroma because a
    near-grey has no meaningful hue and should not drag the fit — the paper
    weights by saturation for the same reason.
    """
    hues, weights = [], []
    for hexcol in palette.values():
        L, C, h = hex_to_oklch(hexcol)
        if C < 0.02:  # achromatic: no hue to harmonise
            continue
        hues.append(h)
        weights.append(C if weight_by_chroma else 1.0)
    if not hues:
        return ("achromatic", 0.0)
    best = (None, float("inf"))
    for name, sectors in HARMONIC_TEMPLATES.items():
        for alpha in range(0, 360, 2):  # template rotation
            dev = sum(
                w * min(_arc_distance(h, alpha + c, wd) for c, wd in sectors)
                for h, w in zip(hues, weights)
            ) / sum(weights)
            if dev < best[1]:
                best = (name, dev)
    return best


# ── rasterising a Canvas for analysis ───────────────────────────────────────


def canvas_to_gray(grid, palette: dict) -> np.ndarray:
    """Perceived-lightness image of a card, for saliency and notan.

    OKLab L rather than the usual 0.299R+0.587G+0.114B: that classic weighting
    is a broadcast-engineering artefact operating on gamma-encoded values, and
    it misreports how light a saturated colour looks.
    """
    Ls = {k: oklab_lightness(v) for k, v in palette.items()}
    Ls[0] = 0.0
    return np.array([[Ls.get(v, 0.0) for v in row] for row in grid], dtype=float)


# ── Hasler & Süsstrunk 2003: colourfulness ──────────────────────────────────


def colorfulness(palette: dict, weights: dict = None) -> float:
    """Hasler & Süsstrunk colourfulness, optionally weighted by pixel coverage.

    rg = R - G, yb = 0.5(R + G) - B, then
        sqrt(std(rg)^2 + std(yb)^2) + 0.3 * sqrt(mean(rg)^2 + mean(yb)^2)

    Reported r ~ 0.95 against human ratings. Used here as a floor check, not a
    target: a card that measures muddy will read muddy at 190px, but a high
    score is not a claim that the card is good.

    Hasler & Süsstrunk's own interpretation scale, for reading the number:
    <15 not colourful, 15-33 slightly, 33-45 moderately, 45-59 averagely,
    59-82 quite, 82-109 highly, >109 extremely.

    Weighting by coverage matters — an unweighted palette score would treat a
    two-pixel accent as equal to the ground, which is exactly the mistake that
    lets a card look drab while its palette measures vivid.
    """
    import numpy as _np

    from oklab import hex_to_rgb01

    cols, ws = [], []
    for k, hexcol in palette.items():
        w = 1.0 if weights is None else float(weights.get(k, 0.0))
        if w <= 0:
            continue
        cols.append([c * 255.0 for c in hex_to_rgb01(hexcol)])
        ws.append(w)
    if not cols:
        return 0.0
    arr = _np.array(cols)
    w = _np.array(ws, dtype=float)
    w /= w.sum()
    R, G, B = arr[:, 0], arr[:, 1], arr[:, 2]
    rg = R - G
    yb = 0.5 * (R + G) - B

    def _m(x):
        return float((x * w).sum())

    def _sd(x):
        return float(_np.sqrt(((x - _m(x)) ** 2 * w).sum()))

    return _sd(rg) ** 2 + _sd(yb) ** 2 and (
        math.sqrt(_sd(rg) ** 2 + _sd(yb) ** 2) + 0.3 * math.sqrt(_m(rg) ** 2 + _m(yb) ** 2)
    )


def coverage(grid) -> dict:
    """How many cells each palette key actually occupies."""
    out = {}
    for row in grid:
        for v in row:
            if v:
                out[v] = out.get(v, 0) + 1
    return out


# ── Ulichney 1993: void-and-cluster blue-noise dither matrix ────────────────


def void_and_cluster(size: int = 16, sigma: float = 1.5, seed: int = 1) -> np.ndarray:
    """A tileable blue-noise threshold matrix, ranks 0..size*size-1.

    Why blue noise rather than Bayer: the human contrast-sensitivity function
    is low-pass, so it is far more sensitive to low and mid spatial frequencies
    than high ones. Blue noise pushes the dither pattern's energy ABOVE that
    sensitive band, so it reads as smooth tone. Bayer/ordered dithering puts
    strong periodic energy squarely inside the sensitive band, which is why it
    reads as a visible crosshatch. This part of Ulichney is uncontested.

    Toroidal (wrap-around) filtering throughout, so the tile repeats seamlessly
    across a card with no seam at the join.
    """
    rng = np.random.default_rng(seed)
    n = size * size
    binary = np.zeros((size, size), dtype=bool)
    for idx in rng.permutation(n)[: max(1, int(0.1 * n))]:
        binary.flat[idx] = True

    def density(b):
        return _wrap_gaussian(b.astype(float), sigma)

    # phase 1: break up the random seed into an even (blue-noise) prototype
    while True:
        d = density(binary)
        tight = np.where(binary, d, -np.inf).argmax()
        binary.flat[tight] = False
        d = density(binary)
        void = np.where(~binary, d, np.inf).argmin()
        if void == tight:
            binary.flat[tight] = True
            break
        binary.flat[void] = True

    prototype = binary.copy()
    rank = np.full((size, size), -1, dtype=int)

    # phase 2: rank DOWN from the prototype — repeatedly remove the tightest
    # cluster, so the earliest-removed pixel gets the lowest threshold
    work = prototype.copy()
    for r in range(int(work.sum()) - 1, -1, -1):
        d = density(work)
        tight = np.where(work, d, -np.inf).argmax()
        work.flat[tight] = False
        rank.flat[tight] = r

    # phase 3: rank UP — repeatedly fill the largest void
    work = prototype.copy()
    for r in range(int(prototype.sum()), n):
        d = density(work)
        void = np.where(~work, d, np.inf).argmin()
        work.flat[void] = True
        rank.flat[void] = r
    return rank


def _wrap_gaussian(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian filter with toroidal wrap, via the FFT (exact and fast)."""
    size = a.shape[0]
    y, x = np.mgrid[0:size, 0:size]
    y = np.minimum(y, size - y)
    x = np.minimum(x, size - x)
    k = np.exp(-(x**2 + y**2) / (2 * sigma**2))
    k /= k.sum()
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.fft.fft2(k)))


def blue_noise_quality(matrix: np.ndarray) -> float:
    """Mean nearest-neighbour distance between the first 10% of ranks.

    A blue-noise matrix spaces its early ranks evenly; white noise clumps them.
    Higher is better, and it is the cheapest way to prove the generator did not
    silently produce white noise.
    """
    size = matrix.shape[0]
    pts = np.argwhere(matrix < max(2, int(0.1 * matrix.size)))
    if len(pts) < 2:
        return 0.0
    ds = []
    for i, p in enumerate(pts):
        d = np.abs(pts - p)
        d = np.minimum(d, size - d)  # toroidal
        dist = np.hypot(d[:, 0], d[:, 1])
        dist[i] = np.inf
        ds.append(dist.min())
    return float(np.mean(ds))
