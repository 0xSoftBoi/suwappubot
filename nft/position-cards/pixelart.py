#!/usr/bin/env python3
"""The pixel-art engine behind Suwappu Positions.

The collection is drawn on a 64x80 logical pixel grid, one card, no
anti-aliasing anywhere. Every rule here exists to serve six constraints, which
are the whole brief:

  1. Clear silhouette, instant readability   — bull vs bear is legible as a
     SHAPE (horns vs round ears) before any colour or text is read.
  2. Tight palette, 4-16 colours             — build_palette() emits at most 15
     and the sweep fails a card that exceeds it.
  3. Intentional clusters, no stray pixels   — shapes are filled primitives with
     a traced outline; nothing is scattered. despeckle() removes any orphan a
     composite step leaves behind, and the sweep counts orphans.
  4. Consistent lighting, hue-shifted shading— one light, fixed upper-left, for
     every sprite on every card. ramp() shifts hue COOL into shadow and WARM
     into light rather than just darkening, which is what stops a ramp reading
     as muddy grey.
  5. Right detail for the resolution         — at 28x28 a bull is a silhouette,
     not an illustration. The return is rounded to whole percent because a
     decimal point costs 6 px and buys nothing at this size.
  6. Every pixel deliberate                  — no noise, no texture filters, no
     random dither. Backgrounds are authored patterns on a fixed grid.

Constraints are the strength: the grid is small enough that a wrong pixel is
visible, so the sweep can prove all 4,444 cards are clean rather than trusting a
contact sheet.
"""

# ── the grid ────────────────────────────────────────────────────────────────
# 64x80 logical pixels at 16 SVG units each = 1024x1280, a 4:5 card. 16 is an
# integer so no rect ever lands on a fractional coordinate and rasterizers
# cannot open hairline seams between neighbouring pixels.
GRID_W, GRID_H = 64, 80
PX = 16
CANVAS_W, CANVAS_H = GRID_W * PX, GRID_H * PX

TRANSPARENT = 0

# 8-connectivity for stray-pixel checks. A contour outline climbing a diagonal
# edge touches only at corners, and that is correct pixel art — judging strays
# by 4-neighbours would condemn every outline the engine draws.
_N8 = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1))


# ── colour ──────────────────────────────────────────────────────────────────


def _hsl_to_hex(h: float, s: float, ll: float) -> str:
    """h in degrees, s and ll in 0..1."""
    h = h % 360.0
    s = max(0.0, min(1.0, s))
    ll = max(0.0, min(1.0, ll))
    c = (1 - abs(2 * ll - 1)) * s
    x = c * (1 - abs((h / 60.0) % 2 - 1))
    m = ll - c / 2
    r, g, b = [
        (c, x, 0),
        (x, c, 0),
        (0, c, x),
        (0, x, c),
        (x, 0, c),
        (c, 0, x),
    ][int(h // 60) % 6]
    return "#" + "".join(f"{round((v + m) * 255):02x}" for v in (r, g, b))


def ramp(hue: float, sat: float, lo: float, hi: float, steps: int, shift: float = 26.0):
    """A shading ramp with HUE SHIFTING, not just lightness steps.

    Shadows rotate toward the cool side of the base hue and highlights toward
    the warm side. A ramp built by darkening one hue reads as dirt at this
    scale; shifting is what makes 4 colours look like light falling on a form.
    Saturation also drops at the light end, because a highlight approaching
    white cannot stay saturated without looking like plastic.
    """
    out = []
    for i in range(steps):
        t = i / max(1, steps - 1)  # 0 = deepest shadow, 1 = brightest light
        h = hue + shift * (t - 0.5) * 2.0
        s = sat * (1.0 - 0.34 * t)
        out.append(_hsl_to_hex(h, s, lo + (hi - lo) * t))
    return out


def hex_to_rgb(c: str):
    return tuple(int(c[i : i + 2], 16) for i in (1, 3, 5))


def mix(a: str, b: str, t: float) -> str:
    ca, cb = hex_to_rgb(a), hex_to_rgb(b)
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb))


# ── the 5x7 font ────────────────────────────────────────────────────────────
# One font, drawn once, scaled by whole numbers only. A pixel font resampled to
# a fractional size stops being pixel art, so display type here is the same
# glyphs at 2x — never a second, larger face.
_F = {
    "A": ".###.#...##...#######...##...##...#",
    "B": "####.#...##...#####.#...##...#####.",
    "C": ".#####....#....#....#....#.....####",
    "D": "####.#...##...##...##...##...#####.",
    "E": "######....#....####.#....#....#####",
    "F": "######....#....####.#....#....#....",
    "G": ".#####....#....#..###...##...#.####",
    "H": "#...##...##...#######...##...##...#",
    "I": "#####..#....#....#....#....#..#####",
    "J": "....#....#....#....##...##...#.###.",
    "K": "#...##..#.#.#..##...#.#..#..#.#...#",
    "L": "#....#....#....#....#....#....#####",
    "M": "#...###.###.#.##...##...##...##...#",
    "N": "#...###..##.#.##..###...##...##...#",
    "O": ".###.#...##...##...##...##...#.###.",
    "P": "####.#...##...#####.#....#....#....",
    "Q": ".###.#...##...##...##.#.##..#..##.#",
    "R": "####.#...##...#####.#.#..#..#.#...#",
    "S": ".#####....#.....###.....#....#####.",
    "T": "#####..#....#....#....#....#....#..",
    "U": "#...##...##...##...##...##...#.###.",
    "V": "#...##...##...##...##...#.#.#...#..",
    "W": "#...##...##...##.#.##.#.###.###...#",
    "X": "#...##...#.#.#...#...#.#.#...##...#",
    "Y": "#...##...#.#.#...#....#....#....#..",
    "Z": "#####....#...#...#...#...#....#####",
    "0": ".###.#...##..###.#.###..##...#.###.",
    "1": "..#...##....#....#....#....#...###.",
    "2": ".###.#...#....#...#...#...#...#####",
    "3": "####.....#....#.###.....#....#####.",
    "4": "#..#.#..#.#..#.#####...#....#....#.",
    "5": "######....#....####.....##...#.###.",
    "6": ".###.#....#....####.#...##...#.###.",
    "7": "#####....#...#...#...#....#....#...",
    "8": ".###.#...##...#.###.#...##...#.###.",
    "9": ".###.#...##...#.####....#....#.###.",
    "+": ".......#....#..#####..#....#.......",
    "-": "...............#####...............",
    "−": "...............#####...............",
    "%": "##..###..#...#...#...#...#..###..##",
    ".": "..........................##...##..",
    "·": "...........##...##.................",
    "#": ".#.#..#.#.#####.#.#.#####.#.#..#.#.",
    "$": "..#...#####.#...###...#.#####...#..",
    "/": "....#...#....#...#...#....#...#....",
    "'": "..#....#...........................",
    " ": "...................................",
    "!": "..#....#....#....#....#.........#..",
    ":": "......##...##........##...##.......",
}
FONT_W, FONT_H = 5, 7
# Every glyph must be exactly 35 cells; a short string would silently shear the
# rest of the row when blitted.
FONT = {k: v for k, v in _F.items() if len(v) == FONT_W * FONT_H}


def text_width(s: str, scale: int = 1, tracking: int = 1) -> int:
    if not s:
        return 0
    return len(s) * (FONT_W * scale + tracking) - tracking


# ── canvas ──────────────────────────────────────────────────────────────────


class Canvas:
    """An indexed-colour bitmap. Cells hold palette KEYS, not colours.

    Indexed rather than RGB so the palette-size constraint is structural: a card
    physically cannot use a seventeenth colour, because there is nowhere to put
    it.
    """

    def __init__(self, w: int = GRID_W, h: int = GRID_H):
        self.w, self.h = w, h
        self.g = [[TRANSPARENT] * w for _ in range(h)]

    def put(self, x: int, y: int, v: int):
        if 0 <= x < self.w and 0 <= y < self.h and v != TRANSPARENT:
            self.g[y][x] = v

    def get(self, x: int, y: int) -> int:
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.g[y][x]
        return TRANSPARENT

    def rect(self, x: int, y: int, w: int, h: int, v: int):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, v)

    def frame(self, x: int, y: int, w: int, h: int, v: int, t: int = 1):
        for i in range(t):
            self.rect(x + i, y + i, w - 2 * i, t if h - 2 * i > 0 else 0, v)
            self.rect(x + i, y + h - 1 - i, w - 2 * i, t, v)
            self.rect(x + i, y + i, t, h - 2 * i, v)
            self.rect(x + w - 1 - i, y + i, t, h - 2 * i, v)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, v: int):
        for yy in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for xx in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0:
                    self.put(xx, yy, v)

    def disc(self, cx: float, cy: float, r: float, v: int):
        self.ellipse(cx, cy, r, r, v)

    def curve(self, pts, t0: float, t1: float, v: int):
        """A tapered stroke: discs along a polyline, radius lerped t0 -> t1.

        Discs rather than a line algorithm because a taper drawn from filled
        discs never produces a one-pixel spur at a bend — which is precisely the
        stray pixel the brief forbids.
        """
        n = len(pts)
        for i in range(n - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            steps = max(2, int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1)
            for s in range(steps + 1):
                f = (i + s / steps) / max(1, n - 1)
                self.disc(
                    x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, t0 + (t1 - t0) * f, v
                )

    def text(self, x: int, y: int, s: str, v: int, scale: int = 1, tracking: int = 1):
        cx = x
        for ch in s.upper():
            glyph = FONT.get(ch, FONT[" "])
            for gy in range(FONT_H):
                for gx in range(FONT_W):
                    if glyph[gy * FONT_W + gx] == "#":
                        self.rect(cx + gx * scale, y + gy * scale, scale, scale, v)
            cx += FONT_W * scale + tracking
        return cx

    def text_center(self, y: int, s: str, v: int, scale: int = 1, tracking: int = 1):
        x = (self.w - text_width(s, scale, tracking)) // 2
        return self.text(x, y, s, v, scale, tracking)

    # ── shape post-processing ───────────────────────────────────────────────

    def mask(self, vals):
        vals = set(vals)
        return [[self.g[y][x] in vals for x in range(self.w)] for y in range(self.h)]

    def outline(self, vals, ink: int, diagonal: bool = False):
        """Trace a 1px border AROUND a shape (outside it, never eating into it).

        Outlining outward keeps the interior at full size, so a 28px creature
        does not lose two pixels of face to its own border.
        """
        m = self.mask(vals)
        nb = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        if diagonal:
            nb += [(-1, -1), (1, -1), (-1, 1), (1, 1)]
        todo = []
        for y in range(self.h):
            for x in range(self.w):
                if m[y][x]:
                    continue
                if any(
                    0 <= x + dx < self.w and 0 <= y + dy < self.h and m[y + dy][x + dx]
                    for dx, dy in nb
                ):
                    todo.append((x, y))
        for x, y in todo:
            self.g[y][x] = ink

    def despeckle(self, protect=()):
        """Delete any pixel with no 4-neighbour of its own colour.

        A lone pixel is the classic tell of generated pixel art. Text is
        excluded — a 5x7 glyph legitimately contains single-pixel serifs.
        """
        protect = set(protect)
        killed = 0
        snapshot = [row[:] for row in self.g]
        for y in range(self.h):
            for x in range(self.w):
                v = snapshot[y][x]
                if v == TRANSPARENT or v in protect:
                    continue
                same = 0
                for dx, dy in _N8:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and snapshot[ny][nx] == v:
                        same += 1
                if same == 0:
                    # fall back to whatever the majority neighbour is
                    counts = {}
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < self.w and 0 <= ny < self.h:
                            counts[snapshot[ny][nx]] = counts.get(snapshot[ny][nx], 0) + 1
                    if counts:
                        self.g[y][x] = max(counts.items(), key=lambda kv: kv[1])[0]
                        killed += 1
        return killed

    def despeckle_within(self, vals, fallback: int, passes: int = 3):
        """Repair stray pixels of a GIVEN colour set, using only that set.

        A sprite blitted over a 1px pattern chops it into fragments, and some
        land as single pixels — strays the artwork did not intend. Repairing
        them within the background set only means the creature's silhouette can
        never be edited by a cleanup pass, which a general despeckle would do
        the moment an orphan sat next to an outline.
        """
        vals = set(vals)
        for _ in range(passes):
            snap = [row[:] for row in self.g]
            moved = 0
            for y in range(self.h):
                for x in range(self.w):
                    v = snap[y][x]
                    if v not in vals:
                        continue
                    if any(
                        0 <= x + dx < self.w and 0 <= y + dy < self.h and snap[y + dy][x + dx] == v
                        for dx, dy in _N8
                    ):
                        continue
                    counts = {}
                    for dx, dy in _N8:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < self.w and 0 <= ny < self.h and snap[ny][nx] in vals:
                            counts[snap[ny][nx]] = counts.get(snap[ny][nx], 0) + 1
                    self.g[y][x] = (
                        max(counts.items(), key=lambda kv: kv[1])[0] if counts else fallback
                    )
                    moved += 1
            if not moved:
                break

    def count_orphans(self, ignore=(), ignore_touching=()) -> int:
        """How many stray pixels remain in the ARTWORK. The sweep asserts 0.

        `ignore_touching` excludes pixels that neighbour typography — the hole
        inside a 0 or the waist of a # is a counter, not a stray, and counting
        it would make the constraint unsatisfiable for any card with text on it.
        """
        ignore = set(ignore)
        touching = set(ignore_touching)
        n = 0
        for y in range(self.h):
            for x in range(self.w):
                v = self.g[y][x]
                if v == TRANSPARENT or v in ignore:
                    continue
                nb = [
                    self.g[y + dy][x + dx]
                    for dx, dy in _N8
                    if 0 <= x + dx < self.w and 0 <= y + dy < self.h
                ]
                if touching and any(t in touching for t in nb):
                    continue
                if v not in nb:
                    n += 1
        return n

    def colors_used(self):
        return {v for row in self.g for v in row if v != TRANSPARENT}

    def blit(self, other: "Canvas", x0: int, y0: int, remap=None):
        for y in range(other.h):
            for x in range(other.w):
                v = other.g[y][x]
                if v != TRANSPARENT:
                    self.put(x0 + x, y0 + y, remap.get(v, v) if remap else v)

    # ── output ──────────────────────────────────────────────────────────────

    def to_svg(self, palette: dict, px: int = PX, background: str = None) -> str:
        """One <path> per colour, horizontal runs merged.

        A rect per pixel would be 5,120 elements and ~300 kB. Grouping by colour
        and merging runs keeps a card near 30 kB, which matters because every
        marketplace refetches this image.
        """
        runs = {}
        for y in range(self.h):
            x = 0
            while x < self.w:
                v = self.g[y][x]
                x2 = x
                while x2 + 1 < self.w and self.g[y][x2 + 1] == v:
                    x2 += 1
                if v != TRANSPARENT:
                    runs.setdefault(v, []).append((x, y, x2 - x + 1))
                x = x2 + 1
        parts = []
        if background:
            parts.append(
                f'<rect width="{self.w * px}" height="{self.h * px}" fill="{background}"/>'
            )
        for v in sorted(runs):
            d = "".join(f"M{x * px} {y * px}h{w * px}v{px}h-{w * px}z" for x, y, w in runs[v])
            parts.append(f'<path fill="{palette[v]}" d="{d}"/>')
        return "".join(parts)


# ── palette keys ────────────────────────────────────────────────────────────
# Named indices, so the composition code never handles a raw colour and the
# 16-colour ceiling is enforced by there being exactly this many slots.
INK_DEEP = 1  # outlines, the darkest note on the card
BG_0 = 2  # background, deepest
BG_1 = 3  # background, mid
BG_2 = 4  # background pattern accent
BODY_0 = 5  # creature shadow
BODY_1 = 6  # creature mid
BODY_2 = 7  # creature light
BODY_3 = 8  # creature highlight
HORN_0 = 9  # horns / ears / muzzle, shadow
HORN_1 = 10  # horns / ears / muzzle, light
EYE = 11  # eye + grade accent, the one saturated note
TEXT_DIM = 12
TEXT = 13
TEXT_HI = 14
EDITION = 15  # gold furniture; unused on a standard card

PALETTE_CEILING = 16


def build_palette(sector_hue: float, grade_hue: float, gold: bool, dark: bool = True) -> dict:
    """At most 15 colours, always built the same way.

    The sector sets the ground hue and the grade sets the single accent, so a
    wall of cards sorts by family at a glance while each card still says what
    the position did. Gold replaces the ground and the body ramp wholesale —
    the paid edition has to read as its own object, not a recolour.
    """
    if gold:
        bg = ramp(38, 0.46, 0.06, 0.18, 3, shift=16)
        body = ramp(41, 0.72, 0.22, 0.82, 4, shift=22)
        horn = ramp(45, 0.38, 0.46, 0.92, 2, shift=14)
        ink = "#140f06"
        txt = ramp(44, 0.35, 0.55, 0.96, 3, shift=12)
        edition = "#f2d27a"
    else:
        bg = ramp(sector_hue, 0.34, 0.07, 0.17, 3)
        body = ramp(sector_hue + 8, 0.44, 0.20, 0.80, 4)
        horn = ramp(sector_hue + 30, 0.24, 0.44, 0.88, 2)
        ink = _hsl_to_hex(sector_hue - 14, 0.45, 0.06)
        txt = ramp(sector_hue + 14, 0.14, 0.52, 0.97, 3)
        edition = horn[1]
    return {
        INK_DEEP: ink,
        BG_0: bg[0],
        BG_1: bg[1],
        BG_2: bg[2],
        BODY_0: body[0],
        BODY_1: body[1],
        BODY_2: body[2],
        BODY_3: body[3],
        HORN_0: horn[0],
        HORN_1: horn[1],
        EYE: _hsl_to_hex(grade_hue, 0.72, 0.58),
        TEXT_DIM: txt[0],
        TEXT: txt[1],
        TEXT_HI: txt[2],
        EDITION: edition,
    }


# ── creatures ───────────────────────────────────────────────────────────────
# The position IS the animal. Up is a bull, down is a bear, flat is a bull with
# its eyes shut. Nothing is rolled: you cannot mint your way to a bull.
#
# Silhouette does the work before colour does: horns read as horns and round
# ears read as a bear at 28 px, and still at the ~7 px they survive to in a
# marketplace thumbnail.

SPR = 38  # creature box. The animal is the card; type serves it, not the reverse.


def _u(v: float) -> float:
    """Sprite geometry is authored against a 28px box and scaled from there.

    Normalised so the creature can be resized without re-tuning thirty
    coordinates by hand — the first cut hardcoded 28 and a 38px sprite would
    have meant re-drawing both animals.
    """
    return v * SPR / 28.0


# One light for the whole collection, from the upper left. Shared by every
# sprite so a grid of cards looks lit by one lamp instead of thirty.
#
# This is a vector pointing FROM a surface cell TOWARD the lamp, in grid axes
# (+x right, +y DOWN). Upper-left is therefore negative in both. Shading is a
# plain dot product with it — no extra negation anywhere, because a sign slip
# here lights the heads from one corner and the horns from the other, and the
# collection stops looking like it was lit by one lamp.
LIGHT = (-0.72, -0.69)


def _depth(c: Canvas, val: int):
    """Distance (in pixels) from each filled cell to the edge of the shape.

    Shading by depth rather than by a straight gradient is what keeps the
    shadow ON the contour. The first cut lit the sprite with a plain diagonal
    ramp and the light/dark boundary cut a hard slash straight across the face.
    """
    d = [[0] * c.w for _ in range(c.h)]
    cur = [(x, y) for y in range(c.h) for x in range(c.w) if c.g[y][x] == val]
    inside = {(x, y) for x, y in cur}
    layer = 1
    while cur:
        nxt = []
        for x, y in cur:
            if any((x + dx, y + dy) not in inside for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1))):
                d[y][x] = layer
            else:
                nxt.append((x, y))
        if not nxt or len(nxt) == len(cur):
            for x, y in nxt:
                d[y][x] = layer + 1
            break
        inside = set(nxt)
        cur = nxt
        layer += 1
    return d


def _shade(c: Canvas, cx: float, cy: float, rx: float, ry: float, body, lit_bias: float = 0.0):
    """Four tones banded by how far each cell faces the lamp, not by depth.

    Depth-first banding was the first cut and it failed: giving the whole
    one-pixel rim the brightest tone drew a pale wire around 60% of the
    silhouette and left the entire interior on one flat mid tone. A ramp that
    only shows up as an outline is not shading, it is a second outline.

    So `lit` — the dot product with the one lamp — picks the band, and depth
    does the two jobs a dot product cannot: keep the core shadow ON the contour
    by pulling the unlit rim one step darker, and stop the highlight from
    leaking to the edge. That is what makes four colours read as a sphere.
    """
    lo, mid, hi, top = body
    d = _depth(c, lo)
    cells = [(x, y) for y in range(c.h) for x in range(c.w) if c.g[y][x] == lo]
    for x, y in cells:
        nx = (x + 0.5 - cx) / rx
        ny = (y + 0.5 - cy) / ry
        lit = (nx * LIGHT[0] + ny * LIGHT[1]) / 1.4 + lit_bias
        if d[y][x] <= 2:
            # the shell: darkest tone lives here and only here, as a crescent
            # hugging the unlit contour. That crescent IS the turn of the form.
            v = hi if lit > 0.30 else lo if lit < -0.14 else mid
        else:
            # the interior never reaches the darkest tone, so the terminator is
            # a one-step change instead of a hard diagonal slash across a face
            v = top if lit > 0.46 else hi if lit > 0.02 else mid
        c.g[y][x] = v


def _horn(c: Canvas, pts, t0, t1):
    """A horn: one solid dark stroke, lit afterwards by _light_horns.

    Drawn dark-first and lit as a separate pass so the light lands on the same
    side of BOTH horns — mirroring the stroke would mirror the lighting too,
    which is the fastest way to make a sprite look wrong.
    """
    c.curve(pts, t0, t1, HORN_0)


def _light_horns(c: Canvas):
    hits = [
        (x, y)
        for y in range(c.h)
        for x in range(c.w)
        if c.g[y][x] == HORN_0 and c.get(x - 1, y - 1) != HORN_0
    ]
    for x, y in hits:
        c.g[y][x] = HORN_1


def bull(eyes_open: bool = True) -> Canvas:
    """Horns wide and heavy: at 28 px they are the entire identity.

    The first cut drew them as thin tapered sticks and the animal read as a
    mouse. Mass, curve and a lit upper edge are what make a horn a horn.
    """
    c = Canvas(SPR, SPR)
    cx = SPR / 2.0
    for s in (-1, 1):
        _horn(
            c,
            [
                (cx + s * _u(5.6), _u(13.4)),
                (cx + s * _u(9.6), _u(10.4)),
                (cx + s * _u(12.4), _u(6.4)),
                (cx + s * _u(13.0), _u(1.9)),
            ],
            _u(3.3),
            _u(1.0),
        )
    _light_horns(c)
    # ears sit under the horn roots and read as two small wedges
    for s in (-1, 1):
        c.ellipse(cx + s * _u(8.6), _u(13.2), _u(2.3), _u(1.5), BODY_0)
    # skull broad at the brow, tapering into a long muzzle
    c.ellipse(cx, _u(15.4), _u(7.3), _u(6.3), BODY_0)
    c.ellipse(cx, _u(20.4), _u(5.5), _u(4.9), BODY_0)
    _shade(c, cx, _u(15.2), _u(8.4), _u(8.2), (BODY_0, BODY_1, BODY_2, BODY_3))
    # brow band: one dark row above the eyes does all the scowling
    for x in range(int(cx - _u(6)), int(cx + _u(7))):
        if c.g[int(_u(12))][x] in (BODY_1, BODY_2, BODY_3):
            c.g[int(_u(12))][x] = BODY_0
    # muzzle plate, mid-tone so it does not blow out to a white beard
    c.ellipse(cx, _u(21.2), _u(4.0), _u(3.0), HORN_0)
    for s in (-1, 1):
        c.rect(int(cx + s * _u(2)) - 1, int(_u(20.4)), 2, 3, INK_DEEP)
    _eyes(c, cx, int(_u(15)), eyes_open)
    c.outline([BODY_0, BODY_1, BODY_2, BODY_3, HORN_0, HORN_1], INK_DEEP)
    c.despeckle(protect=(INK_DEEP, EYE))
    return c


def _eyes(c: Canvas, cx: float, y: int, open_: bool):
    """2x2 sockets with a single accent glint, mirrored.

    The glint is the only saturated pixel on the animal, so it is where the eye
    lands first — which is the point of spending a palette slot on it.
    """
    for s in (-1, 1):
        ex = int(cx + s * _u(4)) - 1
        if open_:
            c.rect(ex - 1, y - 1, 5, 5, INK_DEEP)
            c.rect(ex, y, 3, 3, EYE)
        else:
            c.rect(ex - 1, y + 1, 5, 2, INK_DEEP)


def bear() -> Canvas:
    """Heavy square jaw, small ears CUT INTO the skull line. The silhouette
    argument against the bull.

    Two things separate a bear from a mouse at this size, and the first cut had
    both wrong. Ear SIZE: big discs set high and wide are Mickey, so they are
    small, sunk into the top corners of the skull and overlapped by it, leaving
    a bump rather than a balloon. And VALUE: a near-white muzzle plate reads as a
    beard and swallows the lower half of the face, so the muzzle is mid-tone with
    a single lit upper edge, like everything else on the card.
    """
    c = Canvas(SPR, SPR)
    cx = SPR / 2.0
    # ears first and the skull over them, so the skull eats their inner half and
    # they leave a bump on the silhouette instead of two floating balloons
    for s in (-1, 1):
        c.disc(cx + s * _u(7.2), _u(7.6), _u(3.2), BODY_0)
    # skull: wider than tall, jaw squared off below the brow. A bear is mass.
    c.ellipse(cx, _u(14.0), _u(9.0), _u(7.4), BODY_0)
    c.rect(int(cx - _u(7.4)), int(_u(13.0)), int(_u(14.8)), int(_u(7.0)), BODY_0)
    c.ellipse(cx, _u(19.6), _u(7.4), _u(4.2), BODY_0)
    _shade(c, cx, _u(13.6), _u(9.6), _u(9.0), (BODY_0, BODY_1, BODY_2, BODY_3))
    # Ears are re-stated AFTER shading. Shaded as part of the head mass they
    # sit far enough up-left to catch the full highlight, and the left one then
    # reads as a pale disc floating off the silhouette. Two fixed tones plus one
    # lit edge makes them read as the same pair of ears on every card.
    for s in (-1, 1):
        c.disc(cx + s * _u(7.2), _u(7.6), _u(2.9), BODY_1)
        c.disc(cx + s * _u(7.2), _u(7.8), _u(1.5), HORN_0)
        c.disc(cx + s * _u(7.2) - 1, _u(7.6) - 1, _u(1.1), BODY_2)
    # brow: angled DOWN toward the nose, which is the whole scowl. A level band
    # run ear to ear is not a brow, it is a visor — that was the first cut.
    for i in range(int(_u(5.6))):
        for s in (-1, 1):
            x = int(cx + s * (i + 1))
            for dy in (0, 1):
                yy = int(_u(11.8)) + dy + (1 if i > _u(3.4) else 0)
                if c.g[yy][x] in (BODY_1, BODY_2, BODY_3):
                    c.g[yy][x] = BODY_0
    _eyes(c, cx, int(_u(13.8)), True)
    # muzzle: one light wedge carrying one dark nose. Any bigger and it is a
    # beard — that pale blob was what made the first bear read as a mouse.
    c.ellipse(cx, _u(20.6), _u(3.4), _u(2.4), HORN_0)
    c.ellipse(cx - 1, _u(20.0), _u(2.4), _u(1.5), HORN_1)
    c.rect(int(cx - _u(1.8)), int(_u(18.9)), int(_u(3.6)), 2, INK_DEEP)
    c.outline([BODY_0, BODY_1, BODY_2, BODY_3, HORN_0, HORN_1], INK_DEEP)
    c.despeckle(protect=(INK_DEEP, EYE))
    # A hornless head is shorter than a horned one, so left where it was drawn
    # the bear sat with four empty rows above it and the bull had none. On a
    # wall that reads as two different sprite sizes. Lift it onto the bull's
    # optical centre; the two animals have to look like one collection.
    _lift(c, 2)
    return c


def _lift(c: Canvas, rows: int):
    c.g = c.g[rows:] + [[TRANSPARENT] * c.w for _ in range(rows)]


def creature_for(ret_bps, priced: bool) -> tuple:
    """(sprite, name). Earned by the position, never rolled."""
    if not priced:
        return bull(eyes_open=False), "Dormant"
    if ret_bps >= 200:
        return bull(True), "Bull"
    if ret_bps <= -200:
        return bear(), "Bear"
    return bull(eyes_open=False), "Flat"


# ── backgrounds ─────────────────────────────────────────────────────────────
# Authored patterns on a fixed grid — no noise function, no random dither. Each
# is a different STRUCTURE rather than the same field at another opacity.

PATTERNS = ("grid", "scanline", "brick", "checker", "starfield")


def paint_background(c: Canvas, kind: str, seed: int):
    c.rect(0, 0, c.w, c.h, BG_0)
    if kind == "grid":
        for y in range(0, c.h, 8):
            c.rect(0, y, c.w, 1, BG_1)
        for x in range(0, c.w, 8):
            c.rect(x, 0, 1, c.h, BG_1)
        for y in range(0, c.h, 8):
            for x in range(0, c.w, 8):
                c.put(x, y, BG_2)
    elif kind == "scanline":
        for y in range(0, c.h, 3):
            c.rect(0, y, c.w, 1, BG_1)
        for y in range(0, c.h, 12):
            c.rect(0, y, c.w, 1, BG_2)
    elif kind == "brick":
        for y in range(0, c.h, 6):
            c.rect(0, y, c.w, 1, BG_1)
            off = 0 if (y // 6) % 2 == 0 else 6
            for x in range(off, c.w, 12):
                c.rect(x, y, 1, 6, BG_1)
    elif kind == "checker":
        for y in range(0, c.h, 4):
            for x in range(0, c.w, 4):
                if ((x // 4) + (y // 4)) % 2 == 0:
                    c.rect(x, y, 4, 4, BG_1)
    elif kind == "starfield":
        # deterministic, and every star is a 2x2 cluster — a 1px star would be
        # exactly the stray pixel the brief bans
        s = seed | 1
        for _ in range(26):
            s = (1103515245 * s + 12345) & 0x7FFFFFFF
            x = 2 + (s >> 7) % (c.w - 5)
            s = (1103515245 * s + 12345) & 0x7FFFFFFF
            y = 2 + (s >> 7) % (c.h - 5)
            c.rect(x, y, 2, 2, BG_1 if (s >> 3) % 3 else BG_2)
