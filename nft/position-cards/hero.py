#!/usr/bin/env python3
"""One flagship card, cut like a watch dial.

This is the quality target for the collection, built as a single piece:
NVDA · Founder · No. 0001 · +138.1%. True black, one metal, and a real
flinqué guilloché medallion — concentric sine rings whose alternating phase
weaves the classic basketwork moiré — at full opacity and machine precision.
No haze, no vignette soup, no half-opacity smudge.

  python3 nft/position-cards/hero.py   # -> preview/HERO-NVDA.svg
"""

import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1000, 1250

# ── the entire palette: black, one gold, one ivory ──────────────────────────
BLACK = "#08090a"
PLATE = "#0d0e10"
GOLD = "#d4af6e"
GOLD_HI = "#f3dda6"
GOLD_LO = "#7a5f33"
IVORY = "#f2ede3"
PINK = "#f472b6"
MONO = "'Geist Mono','SFMono-Regular',Menlo,Consolas,'DejaVu Sans Mono',monospace"
SANS = "Geist,'Inter',system-ui,-apple-system,'Liberation Sans',Arial,sans-serif"


def caps(text, x, y, size, fill, tracking=3.2, weight="normal", anchor="start", opacity=1.0):
    return (
        f'<text x="{x}" y="{y}" font-family="{MONO}" font-size="{size}" '
        f'font-weight="{weight}" letter-spacing="{tracking}" fill="{fill}" '
        f'fill-opacity="{opacity}" text-anchor="{anchor}">{text.upper()}</text>'
    )


def ring_wave(cx, cy, r, amp, k, phase, pts=360):
    """One flinqué ring: a circle whose radius carries a sine wave."""
    d = []
    for i in range(pts + 1):
        t = 2 * math.pi * i / pts
        rr = r + amp * math.sin(k * t + phase)
        d.append(f"{'M' if i == 0 else 'L'}{cx + rr * math.cos(t):.1f} {cy + rr * math.sin(t):.1f}")
    return "".join(d) + "Z"


def build():
    cx, cy = W / 2, 560  # medallion centre
    R_OUT = 300  # outer edge of the engine-turned band
    R_IN = 152  # clean inner disc for the numeral

    p = []
    p.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-label="NVDA flagship position card">'
    )
    p.append("<defs>")
    # gold that turns — used for every stroke of the metalwork
    p.append(
        f'<linearGradient id="gold" x1="0" y1="0" x2="0.8" y2="1">'
        f'<stop offset="0" stop-color="{GOLD_HI}"/>'
        f'<stop offset="0.5" stop-color="{GOLD}"/>'
        f'<stop offset="1" stop-color="{GOLD_LO}"/></linearGradient>'
    )
    # radial gold for the medallion: brightest where the lamp hits, falling
    # to deep gold at the rim — this is what makes engine turning look lit
    p.append(
        f'<radialGradient id="dial" gradientUnits="userSpaceOnUse" '
        f'cx="{cx - 70}" cy="{cy - 90}" r="{R_OUT * 1.55}">'
        f'<stop offset="0" stop-color="{GOLD_HI}"/>'
        f'<stop offset="0.45" stop-color="{GOLD}"/>'
        f'<stop offset="1" stop-color="{GOLD_LO}"/></radialGradient>'
    )
    p.append(
        f'<linearGradient id="numeral" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{GOLD_HI}"/>'
        f'<stop offset="1" stop-color="{GOLD}"/></linearGradient>'
    )
    # one restrained sheen across the card, not a wash
    p.append(
        f'<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0.30" stop-color="#ffffff" stop-opacity="0"/>'
        f'<stop offset="0.50" stop-color="#ffffff" stop-opacity="0.045"/>'
        f'<stop offset="0.62" stop-color="#ffffff" stop-opacity="0"/></linearGradient>'
    )
    p.append(
        f'<clipPath id="card"><rect x="34" y="34" width="{W - 68}" height="{H - 68}" '
        f'rx="42"/></clipPath>'
    )
    p.append(
        '<filter id="drop" x="-6%" y="-6%" width="112%" height="112%">'
        '<feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#000000" '
        'flood-opacity="0.6"/></filter>'
    )
    p.append("</defs>")

    # ── slab and plate: true black, no tint ─────────────────────────────────
    p.append(f'<rect width="{W}" height="{H}" fill="{BLACK}"/>')
    p.append(
        f'<rect x="34" y="34" width="{W - 68}" height="{H - 68}" rx="42" '
        f'fill="{PLATE}" filter="url(#drop)"/>'
    )
    p.append('<g clip-path="url(#card)">')
    # brushed hairlines, horizontal, whisper-quiet — the only ground texture
    for yy in range(40, H - 40, 6):
        p.append(
            f'<line x1="34" y1="{yy}" x2="{W - 34}" y2="{yy}" stroke="#ffffff" '
            f'stroke-opacity="0.016" stroke-width="1"/>'
        )

    # ── the medallion: engine-turned flinqué in gold, full opacity ──────────
    # ground the band in deep gold so the cuts read as metal, not lines
    p.append(
        f'<circle cx="{cx}" cy="{cy}" r="{R_OUT + 14}" fill="none" '
        f'stroke="url(#dial)" stroke-opacity="0.28" stroke-width="2"/>'
    )
    # chapter ring: fine radial reeding between R_OUT and R_OUT+10
    p.append('<g stroke="url(#dial)" stroke-width="1.5" stroke-opacity="0.9">')
    for i in range(180):
        a = 2 * math.pi * i / 180
        r0, r1 = R_OUT + 2, R_OUT + 10
        p.append(
            f'<line x1="{cx + r0 * math.cos(a):.1f}" y1="{cy + r0 * math.sin(a):.1f}" '
            f'x2="{cx + r1 * math.cos(a):.1f}" y2="{cy + r1 * math.sin(a):.1f}"/>'
        )
    p.append("</g>")
    # flinqué basketweave: concentric sine rings, strictly alternating
    # half-wavelength phase so crests sit in troughs — the weave IS the moiré.
    # k=24 keeps the wave langorous, the way a rose engine actually cuts.
    k = 24
    n_rings = 24
    R_W0 = R_IN + 40  # the weave starts past the chapter ring
    p.append(f'<g fill="none" stroke="url(#dial)" stroke-width="1.6" stroke-opacity="0.95">')
    for i in range(n_rings):
        t = i / (n_rings - 1)
        r = R_W0 + (R_OUT - R_W0 - 8) * t
        amp = 4.6 + 2.0 * math.sin(math.pi * t)  # deepest cut mid-band
        phase = (i % 2) * math.pi / k
        p.append(f'<path d="{ring_wave(cx, cy, r, amp, k, phase)}"/>')
    p.append("</g>")
    # second pass, quarter-phase, hairline — the second cut on the lathe
    p.append(f'<g fill="none" stroke="{GOLD_LO}" stroke-width="0.8" stroke-opacity="0.8">')
    for i in range(n_rings - 1):
        t = (i + 0.5) / (n_rings - 1)
        r = R_W0 + (R_OUT - R_W0 - 8) * t
        amp = 4.6 + 2.0 * math.sin(math.pi * t)
        phase = (i % 2) * math.pi / k + math.pi / (2 * k)
        p.append(f'<path d="{ring_wave(cx, cy, r, amp, k, phase)}"/>')
    p.append("</g>")
    # chapter ring: a solid polished gold band between numeral and weave,
    # carrying the grade the way a dial carries its réserve de marche
    p.append(
        f'<circle cx="{cx}" cy="{cy}" r="{R_IN + 21}" fill="none" stroke="url(#dial)" '
        f'stroke-width="18"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{R_IN + 32}" fill="none" stroke="{GOLD_LO}" '
        f'stroke-width="1.2"/>'
    )
    # inner bezel: polished step down to the black numeral disc
    p.append(
        f'<circle cx="{cx}" cy="{cy}" r="{R_IN + 10}" fill="none" stroke="url(#dial)" '
        f'stroke-width="2"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{R_IN}" fill="{BLACK}" stroke="{GOLD_LO}" '
        f'stroke-width="1.2"/>'
    )

    # ── the numbers, in the dial ────────────────────────────────────────────
    p.append(
        f'<text x="{cx}" y="{cy + 8}" font-family="{SANS}" font-size="72" '
        f'font-weight="bold" letter-spacing="-2" fill="url(#numeral)" '
        f'text-anchor="middle">+138.1%</text>'
    )
    p.append(caps("since entry", cx, cy + 52, 13, GOLD, 5.0, anchor="middle", opacity=0.85))
    # grade engraved into the polished chapter ring, black on gold
    p.append(
        f'<path id="arc" d="M {cx - R_IN - 16} {cy} A {R_IN + 16} {R_IN + 16} 0 0 1 '
        f'{cx + R_IN + 16} {cy}" fill="none"/>'
    )
    p.append(
        f'<text font-family="{MONO}" font-size="13.5" letter-spacing="8" fill="{BLACK}" '
        f'font-weight="bold"><textPath href="#arc" startOffset="50%" '
        f'text-anchor="middle">· MULTIPLE ·</textPath></text>'
    )

    # ── head ────────────────────────────────────────────────────────────────
    p.append(caps("Suwappu", 96, 122, 17, PINK, 7.0, "bold"))
    p.append(
        f'<text x="{W - 96}" y="122" font-family="{SANS}" font-size="19" '
        f'fill="url(#gold)" text-anchor="end" letter-spacing="1.6">No. 0001</text>'
    )
    p.append(caps("Founder", W - 96, 154, 17, GOLD, 3.2, "bold", anchor="end"))

    # ── low third ───────────────────────────────────────────────────────────
    ty = 1024
    p.append(
        f'<text x="98.5" y="{ty + 3}" font-family="{SANS}" font-size="116" '
        f'font-weight="bold" letter-spacing="-2" fill="#000000" fill-opacity="0.6">NVDA</text>'
    )
    p.append(
        f'<text x="96" y="{ty}" font-family="{SANS}" font-size="116" font-weight="bold" '
        f'letter-spacing="-2" fill="{IVORY}">NVDA</text>'
    )
    p.append(caps("Nvidia · Semiconductors", 96, ty + 40, 13.5, IVORY, 3.2, opacity=0.6))
    p.append(caps("entry $92.40", W - 96, ty - 44, 13, GOLD, 3.0, anchor="end", opacity=0.7))
    p.append(caps("now $219.98", W - 96, ty - 12, 16, GOLD, 3.0, "bold", anchor="end"))

    # ── foot ────────────────────────────────────────────────────────────────
    p.append(caps("40% off every swap", 96, 1112, 14, IVORY, 4.5, "bold"))
    p.append(
        caps(
            "struck 02 aug 2026 · rank 1 of 4,444",
            W - 96,
            1112,
            11,
            GOLD,
            3.0,
            anchor="end",
            opacity=0.7,
        )
    )
    p.append(
        caps(
            "collectible · not equity · not a security · pays nothing · no claim on any issuer",
            96,
            1170,
            9.5,
            IVORY,
            2.2,
            opacity=0.32,
        )
    )
    p.append(caps("4663 · 1", W - 96, 1170, 9.5, IVORY, 2.2, anchor="end", opacity=0.32))

    # sheen, then the gold rim — last strokes of the machining
    p.append(f'<rect width="{W}" height="{H}" fill="url(#sheen)"/>')
    p.append("</g>")
    p.append(
        f'<rect x="34" y="34" width="{W - 68}" height="{H - 68}" rx="42" fill="none" '
        f'stroke="url(#gold)" stroke-width="3"/>'
    )
    p.append("</svg>")
    return "".join(p)


if __name__ == "__main__":
    out = os.path.join(HERE, "preview", "HERO-NVDA.svg")
    open(out, "w").write(build())
    print(out, f"{os.path.getsize(out) / 1024:.0f}KB")
