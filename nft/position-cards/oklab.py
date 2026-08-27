#!/usr/bin/env python3
"""Perceptually uniform colour for the Positions palette engine.

WHY THIS EXISTS. The first palette engine built its ramps in HSL, which is not
a perceptual space: HSL "lightness" is a crude algebraic midpoint, not a measure
of how light a colour LOOKS. Two consequences, both visible in the rendered
cards and neither visible in the code:

  * Equal L does not mean equal perceived lightness. Pure yellow at HSL L=0.50
    reads far lighter than pure blue at L=0.50 — roughly 0.97 vs 0.32 in OKLab
    L. A ten-sector palette built on constant HSL L therefore had ten DIFFERENT
    perceived value structures, so some sector families read washed out and
    others read heavy, for no designed reason.
  * Rotating hue at constant HSL L swings perceived lightness underneath you, so
    a "hue-shifted" ramp does not hold its value steps — the shift contaminates
    the value structure it is supposed to sit on top of.

OKLab (Björn Ottosson, 2020) is a perceptual Lab space fitted so that equal
steps in L are equal perceived steps, hue lines stay straight (no Abney/
Bezold-Brücke swing), and blending does not pass through grey. OKLCH is its
cylindrical form: L (lightness), C (chroma), h (hue angle). Building ramps in
OKLCH means value, chroma and hue can finally be controlled INDEPENDENTLY,
which is the whole prerequisite for doing value structure deliberately.

  https://bottosson.github.io/posts/oklab/
  https://bottosson.github.io/posts/gamutclipping/

Everything here is plain float maths on 0..1 sRGB — no dependencies, and
deterministic, which the byte-identical render guarantee requires.
"""

import math

# ── sRGB transfer function ──────────────────────────────────────────────────
# sRGB is stored gamma-encoded. Mixing or measuring gamma-encoded values is a
# category error (it is why naive gradients go muddy in the middle), so every
# conversion linearises first.


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_rgb01(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def rgb01_to_hex(r: float, g: float, b: float) -> str:
    return "#" + "".join(
        f"{max(0, min(255, round(v * 255))):02x}" for v in (r, g, b)
    )


# ── OKLab ───────────────────────────────────────────────────────────────────
# Matrices are Ottosson's published values: linear sRGB -> LMS cone response,
# cube root (the compressive non-linearity the eye applies), then LMS -> Lab.


def linear_srgb_to_oklab(r: float, g: float, b: float):
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (
        math.copysign(abs(l) ** (1 / 3), l),
        math.copysign(abs(m) ** (1 / 3), m),
        math.copysign(abs(s) ** (1 / 3), s),
    )
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklab_to_linear_srgb(L: float, a: float, b: float):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    return (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def hex_to_oklch(h: str):
    r, g, b = (_srgb_to_linear(v) for v in hex_to_rgb01(h))
    L, a, bb = linear_srgb_to_oklab(r, g, b)
    return L, math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360.0


def oklch_to_hex(L: float, C: float, h_deg: float) -> str:
    """OKLCH -> sRGB hex, gamut-mapped by reducing CHROMA, never lightness.

    Out-of-gamut is the normal case for a saturated ramp: most (L, C, h) triples
    have no sRGB representation. Clipping the RGB channels is the naive fix and
    it shifts BOTH hue and lightness — a clipped highlight drifts off its own
    ramp. Ottosson's guidance is to preserve L and h and give up C, which keeps
    the ramp's value structure exactly intact and only makes the colour less
    colourful than requested. Value is what the composition is built on; chroma
    is negotiable.
    """
    lo, hi = 0.0, max(0.0, C)
    if _in_gamut(L, hi, h_deg):
        return _to_hex_unclamped(L, hi, h_deg)
    for _ in range(24):  # ~1e-7 of chroma; far below an 8-bit step
        mid = (lo + hi) / 2
        if _in_gamut(L, mid, h_deg):
            lo = mid
        else:
            hi = mid
    return _to_hex_unclamped(L, lo, h_deg)


def _rgb_of(L: float, C: float, h_deg: float):
    rad = math.radians(h_deg)
    return oklab_to_linear_srgb(L, C * math.cos(rad), C * math.sin(rad))


def _in_gamut(L: float, C: float, h_deg: float, eps: float = 1e-6) -> bool:
    return all(-eps <= v <= 1 + eps for v in _rgb_of(L, C, h_deg))


def _to_hex_unclamped(L: float, C: float, h_deg: float) -> str:
    r, g, b = _rgb_of(L, C, h_deg)
    return rgb01_to_hex(*(_linear_to_srgb(max(0.0, min(1.0, v))) for v in (r, g, b)))


def oklab_lightness(hexcol: str) -> float:
    """Perceived lightness, 0..1. This is the number a value structure is built
    on — WCAG relative luminance answers a different question (it is a physical
    light measure, deliberately blind to how the eye compresses it)."""
    return hex_to_oklch(hexcol)[0]


def delta_e(a: str, b: str) -> float:
    """Perceptual distance in OKLab. ~0.02 is a just-noticeable difference at
    typical viewing sizes, so two palette entries closer than that are one
    colour wearing two names."""
    la, ca, ha = hex_to_oklch(a)
    lb, cb, hb = hex_to_oklch(b)
    a1, b1 = ca * math.cos(math.radians(ha)), ca * math.sin(math.radians(ha))
    a2, b2 = cb * math.cos(math.radians(hb)), cb * math.sin(math.radians(hb))
    return math.sqrt((la - lb) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)
