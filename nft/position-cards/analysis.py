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

  harmony_score()     Cohen-Or et al., "Color Harmonization", SIGGRAPH 2006.
                      Scores a palette's hue distribution against the harmonic
                      templates (i, V, L, I, T, Y, X) — a formal, testable
                      definition of colour harmony rather than an opinion.
                      https://doi.org/10.1145/1179352.1141933

CAVEAT, stated up front: spectral-residual saliency was validated on natural
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
VALUE_TIERS = (("dark", 0.00, 0.32), ("shadow", 0.32, 0.52), ("light", 0.52, 0.74), ("bright", 0.74, 1.01))


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
