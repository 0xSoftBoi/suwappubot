#!/usr/bin/env python3
"""Genesis Persimmon — Position No. 0001.  A 1/1.

The Suwappu mark, engine-turned, on Robinhood Chain.

Every value here is taken from the two live brands rather than invented:

  Suwappu (www.suwappu.bot, read from its served CSS + favicon.svg)
    the mark is an orchard persimmon; accent #e58d2b with bright #f6a93c,
    deep #c9731d; leaf #7ab85b -> #2f5e34; type EB Garamond / JetBrains Mono.
  Robinhood Chain (docs.robinhood.com/chain, read from its served CSS)
    ground #110e08 warm near-black, brand acid lime #ccff00.

The concept is the collection's own thesis made literal: THE FRUIT RIPENED.
The persimmon's silhouette is the actual bezier body from Suwappu's favicon,
sampled into a radial profile, then cut as concentric guilloche rings. The
ring at 42% of the extent is struck true and never drifts — that is the entry
price stamped on-chain at mint (92.40 of 219.98). Everything outside it is
growth since: the weave loosens, the gale takes it, threads fray into free
filaments. The live edge is marked in Robinhood lime, the only acid on the
plate, because that is the one number still moving.

  python3 art/genesis-persimmon/genesis.py
"""

import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1000, 1250

# ── palettes, both read from the live sites ─────────────────────────────────
RH_GROUND = "#110e08"   # Robinhood Chain warm near-black
RH_GROUND2 = "#1d1a14"
RH_LIME = "#ccff00"     # Robinhood Chain brand acid
SW_AMBER = "#e58d2b"    # Suwappu --sw-accent
SW_BRIGHT = "#f6a93c"   # --sw-accent-bright
SW_DEEP = "#c9731d"     # --sw-accent-deep
SW_DARK = "#7a4413"     # --sw-accent-dark
SW_CREAM = "#faf3e6"    # --sw-cream
SW_MUTED = "#93a5bc"    # --sw-cosmic-muted
LEAF_HI = "#7ab85b"
LEAF_LO = "#2f5e34"

SERIF = "'EB Garamond',Garamond,'Liberation Serif',Georgia,serif"
MONO = "'JetBrains Mono','Geist Mono','DejaVu Sans Mono',monospace"

# the real position, from the repo's own gallery data
TICKER, COMPANY = "NVDA", "NVIDIA"
ENTRY, NOW = 92.40, 219.98
RET = (NOW - ENTRY) / ENTRY
ENTRY_FRAC = ENTRY / NOW          # where the stamped ring sits: 0.420

# Suwappu favicon.svg — the persimmon body, verbatim
BODY = [
    ((500, 248), (670, 248), (770, 362), (770, 556)),
    ((770, 556), (770, 734), (648, 842), (500, 842)),
    ((500, 842), (352, 842), (230, 734), (230, 556)),
    ((230, 556), (230, 362), (330, 248), (500, 248)),
]
LEAF = "M 398 208 C 431.62 252.88 429.16 295.12 398 340 C 366.84 295.12 364.38 252.88 398 208 Z"


def rng(seed):
    s = seed & 0x7FFFFFFF or 1
    def nxt():
        nonlocal s
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        return s / 0x7FFFFFFF
    return nxt


def fbm(x, y, oct=3):
    """value noise, deterministic, no deps"""
    def h(i, j):
        n = math.sin(i * 127.1 + j * 311.7) * 43758.5453
        return n - math.floor(n)
    def vn(x, y):
        i, j = math.floor(x), math.floor(y)
        fx, fy = x - i, y - j
        ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        return (h(i, j) * (1 - ux) * (1 - uy) + h(i + 1, j) * ux * (1 - uy)
                + h(i, j + 1) * (1 - ux) * uy + h(i + 1, j + 1) * ux * uy)
    v, a, f, n = 0.0, 1.0, 1.0, 0.0
    for _ in range(oct):
        v += a * vn(x * f, y * f); n += a; a *= 0.5; f *= 2.07
    return v / n - 0.5


def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
            u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1])


def persimmon_profile(samples=1440):
    """The mark's own silhouette, as r(theta) about its centroid.

    The rings are not 'a shape like the logo' — they are the logo, resampled.
    """
    pts = []
    for seg in BODY:
        for i in range(300):
            pts.append(bez(*seg, i / 300))
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    polar = sorted(((math.atan2(p[1] - cy, p[0] - cx) % (2 * math.pi),
                     math.hypot(p[0] - cx, p[1] - cy)) for p in pts))
    prof = []
    for i in range(samples):
        th = 2 * math.pi * i / samples
        lo, hi = 0, len(polar) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if polar[mid][0] < th: lo = mid + 1
            else: hi = mid
        a0, r0 = polar[lo - 1]; a1, r1 = polar[lo % len(polar)]
        span = (a1 - a0) % (2 * math.pi) or 1e-6
        f = ((th - a0) % (2 * math.pi)) / span
        prof.append(r0 + (r1 - r0) * min(max(f, 0), 1))
    m = max(prof)
    prof = [p / m for p in prof]
    # The mark's raw body is a near-squircle; a persimmon in the hand is
    # broader at the shoulder and flattened where the calyx seats. Push the
    # profile that way — the DNA stays the favicon's, the read becomes fruit.
    out = []
    for i in range(len(prof)):
        th = 2 * math.pi * i / len(prof)
        c = math.cos(th)          # -1 at the crown (theta = pi), +1 at the base
        shoulder = 1 + 0.135 * math.sin(th) ** 2          # wider at the waist
        crown = 1 - 0.170 * max(0.0, -math.sin(th)) ** 1.25  # seat for the calyx
        base = 1 + 0.045 * max(0.0, math.sin(th)) ** 2      # heavier bottom
        out.append(prof[i] * shoulder * crown * base)
    m2 = max(out)
    return [p / m2 for p in out]


PROF = persimmon_profile()


def prof_at(th):
    x = (th % (2 * math.pi)) / (2 * math.pi) * len(PROF)
    i = int(x) % len(PROF)
    f = x - int(x)
    return PROF[i] * (1 - f) + PROF[(i + 1) % len(PROF)] * f


def mix(a, b, t):
    ca = tuple(int(a[i:i+2], 16) for i in (1, 3, 5))
    cb = tuple(int(b[i:i+2], 16) for i in (1, 3, 5))
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb))


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def caps(t, x, y, size, fill, tr=3.2, w="normal", anchor="start", op=1.0, fam=None):
    return (f'<text x="{x}" y="{y}" font-family="{fam or MONO}" font-size="{size}" '
            f'font-weight="{w}" letter-spacing="{tr}" fill="{fill}" fill-opacity="{op}" '
            f'text-anchor="{anchor}">{esc(t.upper())}</text>')


def style(key, i):
    """Colour, opacity and weight for a light bucket. The locked past is one
    quiet amber; the growth burns from deep to bright as the field works it."""
    if key is None:
        return (SW_AMBER, 0.0, 0.0)
    under, q, sh = key
    lit = 0.34 + 0.86 * (sh / 5.0)
    if q == 0:                       # inside the stamp: machined, patient
        return (mix(SW_DARK, mix(SW_AMBER, SW_BRIGHT, lit * 0.5), 0.40 + 0.40 * lit),
                0.34 + 0.30 * lit, 0.85)
    d = q / 7.0
    return (mix(mix(SW_DARK, SW_DEEP, lit), SW_BRIGHT, min(1.0, d * 1.5 * (0.45 + 0.7 * lit))),
            (30 + 180 * (d ** 1.30)) / 255.0 * (0.62 + 0.52 * lit),
            0.5 + 1.15 * d)


def build(seed=4663):
    r = rng(seed)
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
         f'viewBox="0 0 {W} {H}" role="img" aria-label="Genesis Persimmon, position No. 0001">']

    # ── defs ───────────────────────────────────────────────────────────────
    p.append("<defs>")
    p.append(f'<linearGradient id="ground" x1="0" y1="0" x2="0.4" y2="1">'
             f'<stop offset="0" stop-color="{mix(RH_GROUND2, RH_GROUND, 0.35)}"/>'
             f'<stop offset="0.55" stop-color="{RH_GROUND}"/>'
             f'<stop offset="1" stop-color="#0a0805"/></linearGradient>')
    # the persimmon's own light: warm, from upper-left, as on the mark
    p.append(f'<radialGradient id="flesh" gradientUnits="userSpaceOnUse" '
             f'cx="{W*0.40}" cy="600" r="520">'
             f'<stop offset="0" stop-color="{SW_BRIGHT}"/>'
             f'<stop offset="0.45" stop-color="{SW_AMBER}"/>'
             f'<stop offset="0.8" stop-color="{SW_DEEP}"/>'
             f'<stop offset="1" stop-color="{SW_DARK}"/></radialGradient>')
    p.append(f'<linearGradient id="leafg" x1="0" y1="0" x2="1" y2="1">'
             f'<stop offset="0" stop-color="{LEAF_HI}"/>'
             f'<stop offset="1" stop-color="{LEAF_LO}"/></linearGradient>')
    p.append(f'<radialGradient id="halo" gradientUnits="userSpaceOnUse" '
             f'cx="{W/2}" cy="640" r="540">'
             f'<stop offset="0.35" stop-color="{SW_DEEP}" stop-opacity="0.16"/>'
             f'<stop offset="0.75" stop-color="{SW_DARK}" stop-opacity="0.06"/>'
             f'<stop offset="1" stop-color="{SW_DARK}" stop-opacity="0"/></radialGradient>')
    p.append('<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" '
             'numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="matrix" '
             'values="0 0 0 0 0.55 0 0 0 0 0.5 0 0 0 0 0.4 0 0 0 0.05 0"/></filter>')
    p.append(f'<radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5">'
             f'<stop offset="0" stop-color="#000000" stop-opacity="0.62"/>'
             f'<stop offset="0.55" stop-color="#000000" stop-opacity="0.26"/>'
             f'<stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>')
    p.append(f'<radialGradient id="sheen2" cx="0.5" cy="0.5" r="0.5">'
             f'<stop offset="0" stop-color="{SW_BRIGHT}" stop-opacity="0.20"/>'
             f'<stop offset="1" stop-color="{SW_BRIGHT}" stop-opacity="0"/></radialGradient>')
    p.append("</defs>")

    p.append(f'<rect width="{W}" height="{H}" fill="url(#ground)"/>')
    p.append(f'<ellipse cx="{W/2}" cy="640" rx="540" ry="540" fill="url(#halo)"/>')

    def fruit_path(scale=1.0, seg=720):
        d = []
        for j in range(seg + 1):
            th = 2 * math.pi * j / seg - math.pi / 2
            rr = R * scale * prof_at(th)
            d.append(f"{'M' if j == 0 else 'L'}{CX + rr*math.cos(th):.1f} "
                     f"{CY + rr*RY*math.sin(th):.1f}")
        return "".join(d) + "Z"

    CX, CY, R = W / 2, 648, 366          # the fruit
    RY = 0.88                             # a persimmon is wider than it is tall
    N = 150                               # rings
    gale = -0.70                          # the storm lands lower-right

    # ── the fruit is a SOLID, as it is on the mark ─────────────────────────
    # The weave is its engine-turned skin, clipped to the silhouette, so the
    # form always reads. Only at the gale shore is growth allowed to break it.
    p.append(f'<clipPath id="skin"><path d="{fruit_path(1.0)}"/></clipPath>')
    p.append(f'<path d="{fruit_path(1.0)}" fill="url(#flesh)" fill-opacity="0.30"/>')
    p.append(f'<path d="{fruit_path(1.0)}" fill="{RH_GROUND}" fill-opacity="0.55"/>')
    # the flesh under the stamp is sealed — the past is not a hole
    p.append(f'<path d="{fruit_path(0.46)}" fill="url(#flesh)" fill-opacity="0.16"/>')

    # ── the calyx: four leaves, engine-turned, above the fruit ─────────────
    for i, (ang, dx, sc) in enumerate(
            ((-52, -150, 1.0), (-22, -52, 1.16), (6, 52, 1.16), (34, 150, 1.0))):
        p.append(f'<g transform="translate({CX+dx} {CY-R*RY*0.80}) rotate({ang}) '
                 f'scale({sc*0.92})" fill="none">')
        p.append(f'<path d="{LEAF}" transform="translate(-398 -274)" '
                 f'fill="url(#leafg)" fill-opacity="0.55"/>')
        for k in range(7):
            f = 1 - k * 0.125
            op = 0.95 - k * 0.085
            p.append(f'<path d="{LEAF}" transform="translate(-398 -274) '
                     f'translate(398 274) scale({f:.3f}) translate(-398 -274)" '
                     f'stroke="url(#leafg)" stroke-opacity="{op:.2f}" '
                     f'stroke-width="{3.0 - k*0.19:.2f}"/>')
        p.append("</g>")
    # stem
    p.append(f'<path d="M {CX-10} {CY-R*RY*0.80} q 10 -46 20 0" fill="none" stroke="#5a3f22" '
             f'stroke-width="11" stroke-linecap="round"/>')
    p.append(f'<circle cx="{CX}" cy="{CY-R*RY*0.80}" r="17" fill="none" stroke="url(#leafg)" '
             f'stroke-width="2.4" stroke-opacity="0.9"/>')

    # ── the fruit, cut as concentric guilloche of the mark's own profile ───
    SEG = 600
    shine = []
    frays = 0
    # Runs of segments that share a light bucket are emitted as one polyline.
    # Per-segment <line>s gave the same picture in 12 MB; this gives it in a
    # fraction, and a marketplace has to parse what we ship.
    def flush(run, col, op, lw):
        if len(run) < 2:
            return
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in run)
        p.append(f'<polyline points="{pts}" fill="none" stroke="{col}" '
                 f'stroke-opacity="{op:.3f}" stroke-width="{lw:.2f}"/>')

    p.append('<g clip-path="url(#skin)">')
    for i in range(N):
        t = (i + 1) / N                        # 0 core .. 1 skin
        rad = R * (0.055 + 0.945 * pow(t, 0.88))  # no starburst nucleus
        past = t <= ENTRY_FRAC                 # inside the stamp: locked, calm
        k = (24, 15, 32, 19, 27)[i % 5]
        phase = (i % 2) * math.pi / k * 0.92 + i * 0.021
        wave = (2.6 + 2.6 * math.sin(math.pi * t)) * R / 190
        g = 0.0 if past else (t - ENTRY_FRAC) / (1 - ENTRY_FRAC)
        bloom = (g ** 1.9) * rad * 0.115

        run, cur, pxy, dprev = [], None, None, 0.0
        for s_ in range(SEG + 1):
            th = 2 * math.pi * s_ / SEG - math.pi / 2      # start at the crown
            gain = 0.55 + 0.95 * math.exp(1.9 * (math.cos(th - gale) - 1))
            drift = fbm(2.0 + math.cos(th) * 1.25, 2.0 + math.sin(th) * 1.25 + i * 0.31) * 2
            rr = (rad * prof_at(th)
                  + wave * math.sin(k * th + phase)
                  + bloom * gain * drift
                  + (fbm(th * 3.4 + i * 7.7, 5.5) * 1.5))
            x, y = CX + rr * math.cos(th), CY + rr * RY * math.sin(th)
            under = (not past) and math.sin(k * th + phase) * (1 if i % 2 else -1) < -0.93
            d = min(1.0, abs(drift - dprev) * 9 * (0.5 + 0.5 * gain)
                    + (bloom * gain) / (rad * 0.3 + 1) * 1.05)
            # lambert-ish: the lamp sits upper-left, as on the mark itself
            lam = 0.5 + 0.5 * math.cos(th - (-2.30))
            shade = 0.30 + 0.85 * (lam ** 1.5)
            q = 0 if past else min(7, int(d * 8))          # light bucket
            sh = min(5, int(shade * 5.0))                  # shading bucket
            key = (under, q, sh)
            if key != cur:
                flush(run, *style(cur, i)) if cur is not None else None
                run = [pxy] if pxy else []
                cur = key
            if not under:
                run.append((x, y))
                if d > 0.74 and not past and pxy:
                    shine.append((pxy[0], pxy[1], x, y, 0.5 + 1.15 * d))
                # skin fuzz: short, dense, only on the ripened outside
                if (frays < 130 and (not past) and d > 0.90 and gain > 1.30
                        and t > 0.72 and r() < 0.05):
                    frays += 1
                    fx, fy = x, y
                    vx, vy = math.cos(th), math.sin(th)
                    seg = []
                    for qq in range(2 + int(r() * 2)):
                        cu = (r() - 0.5) * 0.9
                        vx, vy = vx*math.cos(cu) - vy*math.sin(cu), vx*math.sin(cu) + vy*math.cos(cu)
                        L = 2.5 + r() * 4
                        fx, fy = fx + vx * L, fy + vy * L
                        seg.append((fx, fy))
                    pts = " ".join(f"{px:.1f},{py:.1f}" for px, py in [(x, y)] + seg)
                    p.append(f'<polyline points="{pts}" fill="none" stroke="{SW_BRIGHT}" '
                             f'stroke-opacity="0.26" stroke-width="0.55"/>')
            else:
                flush(run, *style(cur, i)) if run else None
                run = []
            pxy = (x, y); dprev = drift
        if run:
            flush(run, *style(cur, i))

    # the lamp: shadow falls to the lower-right, terminator soft
    p.append(f'<ellipse cx="{CX+R*0.62:.0f}" cy="{CY+R*RY*0.52:.0f}" rx="{R*1.30:.0f}" '
             f'ry="{R*1.30*RY:.0f}" fill="url(#shadow)"/>')
    p.append(f'<ellipse cx="{CX-R*0.34:.0f}" cy="{CY-R*RY*0.40:.0f}" rx="{R*0.62:.0f}" '
             f'ry="{R*0.52*RY:.0f}" fill="url(#sheen2)" style="mix-blend-mode:screen"/>')
    p.append('</g>')

    # light is a substance: the worked threads struck again, screened
    p.append('<g style="mix-blend-mode:screen">')
    for sx, sy, ex, ey, lw in shine:
        p.append(f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" '
                 f'stroke="{SW_BRIGHT}" stroke-opacity="0.05" stroke-width="{lw*3.4:.2f}"/>')
    p.append("</g>")

    p.append(f'<path d="{fruit_path(1.0)}" fill="none" stroke="{SW_BRIGHT}" '
             f'stroke-opacity="0.30" stroke-width="1.6"/>')
    p.append(f'<path d="{fruit_path(0.994)}" fill="none" stroke="{SW_DARK}" '
             f'stroke-opacity="0.55" stroke-width="2.2"/>')

    # ── the stamp: the one ring cut true, never revisited ──────────────────
    dd = []
    for s in range(SEG + 1):
        th = 2 * math.pi * s / SEG - math.pi / 2
        rr = R * pow(ENTRY_FRAC, 0.82) * prof_at(th)
        dd.append(f"{'M' if s == 0 else 'L'}{CX + rr*math.cos(th):.1f} {CY + rr*RY*math.sin(th):.1f}")
    stamp = "".join(dd) + "Z"
    p.append(f'<path d="{stamp}" fill="none" stroke="{SW_CREAM}" stroke-opacity="0.10" '
             f'stroke-width="2.4"/>')
    p.append(f'<path d="{stamp}" fill="none" stroke="{mix(SW_CREAM, SW_AMBER, 0.30)}" stroke-opacity="0.72" '
             f'stroke-width="1.15"/>')

    for tk in range(72):
        ta = 2 * math.pi * tk / 72 - math.pi / 2
        rb = R * pow(ENTRY_FRAC, 0.82) * prof_at(ta)
        ln = -8 if tk % 6 == 0 else -3.6
        p.append(f'<line x1="{CX + rb*math.cos(ta):.1f}" y1="{CY + rb*RY*math.sin(ta):.1f}" '
                 f'x2="{CX + (rb+ln)*math.cos(ta):.1f}" y2="{CY + (rb+ln)*RY*math.sin(ta):.1f}" '
                 f'stroke="{mix(SW_CREAM, SW_AMBER, 0.35)}" stroke-opacity="0.42" stroke-width="0.9"/>')

    # ── the live edge, in Robinhood lime: the only acid on the plate ───────
    lth = -math.pi / 2 + 2.05
    lr = R * prof_at(lth) * 1.012
    lx, ly = CX + lr * math.cos(lth), CY + lr * RY * math.sin(lth)
    p.append(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="16" fill="{RH_LIME}" fill-opacity="0.10"/>')
    p.append(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="4.6" fill="{RH_LIME}"/>')
    LY = 322
    p.append(f'<line x1="{lx:.1f}" y1="{ly:.1f}" x2="{W-150:.0f}" y2="{LY+34}" '
             f'stroke="{RH_LIME}" stroke-opacity="0.45" stroke-width="1"/>')
    p.append(f'<line x1="{W-150:.0f}" y1="{LY+34}" x2="{W-96}" y2="{LY+34}" '
             f'stroke="{RH_LIME}" stroke-opacity="0.45" stroke-width="1"/>')
    p.append(caps("live · chainlink oracle", W - 96, LY + 22, 10, RH_LIME, 3.2, anchor="end", op=0.9))
    p.append(f'<text x="{W-96}" y="{LY}" font-family="{MONO}" font-size="30" '
             f'font-weight="bold" fill="{RH_LIME}" text-anchor="end">${NOW:,.2f}</text>')

    # ── the stamp's label, tied to the true ring ───────────────────────────
    sr = R * pow(ENTRY_FRAC, 0.82) * prof_at(math.pi * 0.5)
    p.append(f'<line x1="{CX-sr*0.70:.0f}" y1="{CY+sr*RY*0.70:.0f}" x2="120" y2="{CY+238:.0f}" '
             f'stroke="{SW_CREAM}" stroke-opacity="0.34" stroke-width="1"/>')
    p.append(f'<line x1="120" y1="{CY+238:.0f}" x2="264" y2="{CY+238:.0f}" '
             f'stroke="{SW_CREAM}" stroke-opacity="0.34" stroke-width="1"/>')
    p.append(caps("stamped at mint · immutable", 120, CY + 228, 10, SW_CREAM, 3.4, op=0.6))
    p.append(f'<text x="120" y="{CY+272:.0f}" font-family="{MONO}" font-size="27" '
             f'fill="{SW_CREAM}" fill-opacity="0.92">${ENTRY:,.2f}</text>')

    # ── head ───────────────────────────────────────────────────────────────
    p.append(caps("Suwappu", 96, 118, 15, SW_AMBER, 7.0, "bold"))
    p.append(caps("Robinhood Chain · 4663", W - 96, 118, 11, SW_MUTED, 3.2, anchor="end", op=0.85))

    # ── the fruit's name, in the site's serif ──────────────────────────────
    p.append(f'<text x="96" y="1074" font-family="{SERIF}" font-size="126" '
             f'fill="{SW_CREAM}" letter-spacing="-1">{TICKER}</text>')
    p.append(caps(f"{COMPANY} · genesis position", 96, 1112, 12, SW_MUTED, 3.4, op=0.9))
    p.append(f'<text x="{W-96}" y="1058" font-family="{SERIF}" font-size="76" '
             f'fill="url(#flesh)" text-anchor="end">+{RET*100:,.1f}%</text>')
    p.append(caps("the fruit ripened", W - 96, 1094, 11, SW_AMBER, 4.2, anchor="end", op=0.75))
    p.append(caps("no. 0001 · founder · 1 of 1", W - 96, 1114, 10, SW_MUTED, 3.2,
                  anchor="end", op=0.7))

    p.append(f'<line x1="96" y1="1152" x2="{W-96}" y2="1152" stroke="{SW_CREAM}" '
             f'stroke-opacity="0.10" stroke-width="1"/>')
    p.append(caps("usdg anchored · entry stamped on-chain · collectible, not equity, "
                  "not a security", 96, 1180, 9, SW_MUTED, 2.0, op=0.5))

    p.append(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity="0.5"/>')
    p.append("</svg>")
    return "".join(p)


if __name__ == "__main__":
    out = os.path.join(HERE, "genesis-persimmon.svg")
    open(out, "w").write(build())
    print(out, f"{os.path.getsize(out)/1024:.0f}KB")
