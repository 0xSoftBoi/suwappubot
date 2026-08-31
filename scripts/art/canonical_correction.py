"""Canonical correction for our own visual identity (W3.1).

Tektonic's most valuable finding was not a shader. It was that the artist's own
collaborator, asked from memory what the visual identity was, named the wrong thing:
"Neon Contour", "edge detection", sharp delineation. Clustering 1,871 sampled frames
showed the identity actually lived in *diffusion* - chiaroscuro bloom, chromatic
aberration, crushed blacks - and the high edge-density signal they had read as contours
was really luminance boundaries between bloom and crushed black. Without the clustering
they would have shipped effects that were aesthetically wrong.

This runs the same check on Suwappu: measure what the collections actually look like,
then compare it against what our own design docs claim they look like. The expected
outcome is a correction. Record it when it comes.

**Why this reads SVG rather than pixels.** They sampled video frames because video was
what they had; the 64x64 downsample and k-means over pixels was a way to recover authored
intent from a raster. Our art is *already* vector - the authored colours and their areas
are stated exactly in the file. Rasterising to recover them would add an approximation
and a heavy dependency to get a worse answer. So the feature vector below is computed
over area-weighted authored colour, which is the same measurement taken one step earlier.

The 19-float vector mirrors theirs one-for-one:

    [0:15]  five dominant colours (RGB), k-means over area-weighted colour
    [15]    stroke density        <- their Canny edge density
    [16]    mean luminance        <- their mean brightness
    [17]    mean saturation       <- their mean saturation
    [18]    colour variance       <- their colour variance

Stdlib only.

    python3 scripts/art/canonical_correction.py nft/position-cards/preview
    python3 scripts/art/canonical_correction.py art nft --clusters 4 --json out.json
    python3 scripts/art/canonical_correction.py nft --claimed nft/position-cards/THEME.md
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

# --- Colour -----------------------------------------------------------------------

_HEX3 = re.compile(r"^#([0-9a-fA-F]{3})$")
_HEX6 = re.compile(r"^#([0-9a-fA-F]{6})$")
_RGB = re.compile(r"^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)")

NAMED = {
    "black": (0, 0, 0),
    "white": (255, 255, 255),
    "red": (255, 0, 0),
    "green": (0, 128, 0),
    "blue": (0, 0, 255),
    "gray": (128, 128, 128),
    "grey": (128, 128, 128),
    "silver": (192, 192, 192),
    "gold": (255, 215, 0),
}


def parse_color(value: Optional[str]) -> Optional[tuple[float, float, float]]:
    """Parse an SVG paint value to RGB 0-255. Returns None for none/url()/inherit."""
    if not value:
        return None
    v = value.strip().lower()
    if v in ("none", "transparent", "inherit", "currentcolor") or v.startswith("url("):
        return None
    m = _HEX6.match(v)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    m = _HEX3.match(v)
    if m:
        h = m.group(1)
        return (int(h[0] * 2, 16), int(h[1] * 2, 16), int(h[2] * 2, 16))
    m = _RGB.match(v)
    if m:
        return tuple(min(255.0, max(0.0, float(g))) for g in m.groups())  # type: ignore
    return NAMED.get(v)


def luminance(rgb: Sequence[float]) -> float:
    """Rec. 601 luma, 0-1. The same coefficients Tektonic used for their glyph ramp."""
    r, g, b = rgb
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def saturation(rgb: Sequence[float]) -> float:
    r, g, b = (c / 255.0 for c in rgb)
    return colorsys.rgb_to_hls(r, g, b)[2]


def hue_degrees(rgb: Sequence[float]) -> float:
    r, g, b = (c / 255.0 for c in rgb)
    return colorsys.rgb_to_hls(r, g, b)[0] * 360.0


# --- Geometry -------------------------------------------------------------------------

_NUM = re.compile(r"-?\d*\.?\d+(?:e-?\d+)?")


def _f(value: Optional[str], default: float = 0.0) -> float:
    if value is None:
        return default
    m = _NUM.search(value)
    return float(m.group()) if m else default


def element_area(tag: str, attrib: dict) -> float:
    """Approximate painted area in user units.

    Rough by design. The weighting only has to rank a full-bleed background above a
    hairline rule; a path's bounding box overstating its ink does not change which
    colours dominate, and pretending otherwise would mean writing a path rasteriser.
    """
    t = tag.rsplit("}", 1)[-1]
    if t == "rect":
        return max(0.0, _f(attrib.get("width"))) * max(0.0, _f(attrib.get("height")))
    if t == "circle":
        r = _f(attrib.get("r"))
        return math.pi * r * r
    if t == "ellipse":
        return math.pi * _f(attrib.get("rx")) * _f(attrib.get("ry"))
    if t in ("path", "polygon", "polyline"):
        coords = [float(n) for n in _NUM.findall(attrib.get("d") or attrib.get("points") or "")]
        if len(coords) < 4:
            return 0.0
        xs, ys = coords[0::2], coords[1::2]
        # Bounding box of the control points, halved: most paths fill well under their box.
        return max(0.0, (max(xs) - min(xs)) * (max(ys) - min(ys))) * 0.5
    if t == "text":
        # Glyph ink, crudely: characters times an em box at a third coverage.
        size = _f(attrib.get("font-size"), 12.0)
        return size * size * 0.33
    if t == "line":
        dx = _f(attrib.get("x2")) - _f(attrib.get("x1"))
        dy = _f(attrib.get("y2")) - _f(attrib.get("y1"))
        return math.hypot(dx, dy) * max(_f(attrib.get("stroke-width"), 1.0), 0.5)
    return 0.0


def stroke_length(tag: str, attrib: dict) -> float:
    """Perimeter-ish length of a stroked element - the edge-density numerator."""
    if not parse_color(attrib.get("stroke")):
        return 0.0
    t = tag.rsplit("}", 1)[-1]
    if t == "line":
        return math.hypot(
            _f(attrib.get("x2")) - _f(attrib.get("x1")),
            _f(attrib.get("y2")) - _f(attrib.get("y1")),
        )
    if t == "rect":
        return 2 * (_f(attrib.get("width")) + _f(attrib.get("height")))
    if t == "circle":
        return 2 * math.pi * _f(attrib.get("r"))
    if t in ("path", "polygon", "polyline"):
        coords = [float(n) for n in _NUM.findall(attrib.get("d") or attrib.get("points") or "")]
        # Path data carries plenty of numbers that are not coordinate pairs (arc flags,
        # radii), so the two axes can come out uneven. Walk only complete pairs.
        pairs = min(len(coords[0::2]), len(coords[1::2]))
        xs, ys = coords[0::2][:pairs], coords[1::2][:pairs]
        return (
            sum(math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) for i in range(pairs - 1))
            if pairs > 1
            else 0.0
        )
    return 0.0


# --- Feature extraction ---------------------------------------------------------------


@dataclass
class Sample:
    path: str
    vector: list[float]
    dominant: list[tuple[tuple[float, float, float], float]] = field(default_factory=list)
    canvas_area: float = 0.0

    @property
    def stroke_density(self) -> float:
        return self.vector[15]

    @property
    def mean_luminance(self) -> float:
        return self.vector[16]

    @property
    def mean_saturation(self) -> float:
        return self.vector[17]

    @property
    def colour_variance(self) -> float:
        return self.vector[18]


def extract(path: str) -> Optional[Sample]:
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return None

    vb = root.get("viewBox")
    if vb:
        parts = [float(n) for n in _NUM.findall(vb)]
        canvas = (parts[2] * parts[3]) if len(parts) >= 4 else 0.0
    else:
        canvas = _f(root.get("width"), 1000.0) * _f(root.get("height"), 1000.0)
    canvas = canvas or 1.0

    weighted: list[tuple[tuple[float, float, float], float]] = []
    total_stroke = 0.0

    for el in root.iter():
        attrib = el.attrib
        # Presentation attributes and the common inline-style spelling.
        style = attrib.get("style", "")
        if style:
            for prop in ("fill", "stroke", "stop-color"):
                m = re.search(rf"(?:^|;)\s*{prop}\s*:\s*([^;]+)", style)
                if m and prop not in attrib:
                    attrib = {**attrib, prop: m.group(1)}

        fill = parse_color(attrib.get("fill")) or parse_color(attrib.get("stop-color"))
        if fill is not None:
            area = element_area(el.tag, attrib)
            # A gradient stop paints no geometry of its own; give it a nominal weight so
            # the palette it defines is still represented.
            if el.tag.rsplit("}", 1)[-1] == "stop":
                area = canvas * 0.02
            if area > 0:
                weighted.append((fill, area))

        stroke = parse_color(attrib.get("stroke"))
        if stroke is not None:
            length = stroke_length(el.tag, attrib)
            width = _f(attrib.get("stroke-width"), 1.0)
            total_stroke += length
            if length * width > 0:
                weighted.append((stroke, length * width))

    if not weighted:
        return None

    total_weight = sum(w for _, w in weighted)
    dominant = kmeans_colors(weighted, k=5)

    mean_lum = sum(luminance(c) * w for c, w in weighted) / total_weight
    mean_sat = sum(saturation(c) * w for c, w in weighted) / total_weight
    mean_rgb = tuple(sum(c[i] * w for c, w in weighted) / total_weight for i in range(3))
    variance = (
        math.sqrt(
            sum(w * sum((c[i] - mean_rgb[i]) ** 2 for i in range(3)) for c, w in weighted)
            / total_weight
        )
        / 255.0
    )

    vector: list[float] = []
    for colour, _share in dominant:
        vector.extend(v / 255.0 for v in colour)
    while len(vector) < 15:
        vector.append(0.0)

    vector.append(min(total_stroke / math.sqrt(canvas), 10.0) / 10.0)  # stroke density
    vector.append(mean_lum)
    vector.append(mean_sat)
    vector.append(variance)

    return Sample(path=path, vector=vector[:19], dominant=dominant, canvas_area=canvas)


# --- k-means (stdlib) -----------------------------------------------------------------


def kmeans_colors(
    weighted: Sequence[tuple[tuple[float, float, float], float]],
    k: int = 5,
    iterations: int = 24,
) -> list[tuple[tuple[float, float, float], float]]:
    """Weighted k-means over RGB. Returns (centroid, share of total weight), largest first.

    Seeded deterministically by luminance spread rather than randomly: the same input
    must always produce the same palette, or the "correction" is not reproducible and
    cannot be argued with.
    """
    if not weighted:
        return []
    unique = sorted({c for c, _ in weighted}, key=luminance)
    k = min(k, len(unique))
    centroids = [list(unique[round(i * (len(unique) - 1) / max(k - 1, 1))]) for i in range(k)]

    for _ in range(iterations):
        buckets: list[list[tuple[tuple[float, float, float], float]]] = [[] for _ in range(k)]
        for colour, weight in weighted:
            best = min(
                range(k),
                key=lambda i: sum((colour[j] - centroids[i][j]) ** 2 for j in range(3)),
            )
            buckets[best].append((colour, weight))
        moved = False
        for i, bucket in enumerate(buckets):
            if not bucket:
                continue
            total = sum(w for _, w in bucket)
            new = [sum(c[j] * w for c, w in bucket) / total for j in range(3)]
            if any(abs(new[j] - centroids[i][j]) > 0.5 for j in range(3)):
                moved = True
            centroids[i] = new
        if not moved:
            break

    total_weight = sum(w for _, w in weighted)
    out: list[tuple[tuple[float, float, float], float]] = []
    for i, bucket in enumerate(buckets):
        share = sum(w for _, w in bucket) / total_weight if total_weight else 0.0
        if share > 0:
            out.append((tuple(centroids[i]), share))  # type: ignore
    out.sort(key=lambda cs: -cs[1])
    return out


def kmeans_vectors(samples: Sequence[Sample], k: int, iterations: int = 40) -> list[list[int]]:
    """Cluster sample feature vectors. Returns lists of sample indices."""
    if not samples:
        return []
    k = min(k, len(samples))
    ordered = sorted(range(len(samples)), key=lambda i: samples[i].mean_luminance)
    centroids = [
        list(samples[ordered[round(i * (len(ordered) - 1) / max(k - 1, 1))]].vector)
        for i in range(k)
    ]

    assignment = [0] * len(samples)
    for _ in range(iterations):
        changed = False
        for idx, sample in enumerate(samples):
            best = min(
                range(k),
                key=lambda c: sum(
                    (sample.vector[d] - centroids[c][d]) ** 2 for d in range(len(sample.vector))
                ),
            )
            if assignment[idx] != best:
                assignment[idx] = best
                changed = True
        for c in range(k):
            members = [samples[i] for i in range(len(samples)) if assignment[i] == c]
            if members:
                centroids[c] = [
                    sum(m.vector[d] for m in members) / len(members)
                    for d in range(len(members[0].vector))
                ]
        if not changed:
            break

    return [[i for i in range(len(samples)) if assignment[i] == c] for c in range(k)]


# --- Claimed-palette comparison -------------------------------------------------------

_DOC_HEX = re.compile(r"`?(#[0-9a-fA-F]{6})`?")


def read_claimed(paths: Iterable[str]) -> list[tuple[str, tuple[float, float, float]]]:
    """Pull the hex colours a design doc claims are the identity."""
    claimed: list[tuple[str, tuple[float, float, float]]] = []
    for path in paths:
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for line in text.splitlines():
            for hexcode in _DOC_HEX.findall(line):
                rgb = parse_color(hexcode)
                if rgb:
                    name = line.strip().lstrip("-*# ").split("`")[0].strip(" :*-") or hexcode
                    claimed.append((f"{name[:34]} {hexcode}", rgb))
    return claimed


def nearest(colour: Sequence[float], palette: Sequence[tuple[str, tuple[float, float, float]]]):
    if not palette:
        return None, float("inf")
    name, rgb = min(palette, key=lambda nc: sum((colour[i] - nc[1][i]) ** 2 for i in range(3)))
    return name, math.sqrt(sum((colour[i] - rgb[i]) ** 2 for i in range(3)))


# --- Driver ---------------------------------------------------------------------------


def collect_svgs(roots: Sequence[str], limit: int = 400) -> list[str]:
    found: list[str] = []
    for root in roots:
        if os.path.isfile(root) and root.endswith(".svg"):
            found.append(root)
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
            for name in sorted(filenames):
                if name.endswith(".svg"):
                    found.append(os.path.join(dirpath, name))
    return sorted(found)[:limit]


def _hex(rgb: Sequence[float]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, int(round(c)))) for c in rgb))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("roots", nargs="+", help="directories or .svg files to sample")
    p.add_argument("--clusters", type=int, default=4)
    p.add_argument("--claimed", nargs="*", default=[], help="design docs stating the palette")
    p.add_argument("--json", dest="json_path")
    p.add_argument("--limit", type=int, default=400)
    args = p.parse_args(argv)

    paths = collect_svgs(args.roots, limit=args.limit)
    samples = [s for s in (extract(path) for path in paths) if s is not None]
    if not samples:
        print("no parseable SVG found", file=sys.stderr)
        return 2

    print(f"sampled {len(samples)} of {len(paths)} SVG files\n")

    # Corpus-wide palette: every sample's dominants, re-clustered.
    corpus: list[tuple[tuple[float, float, float], float]] = []
    for s in samples:
        for colour, share in s.dominant:
            corpus.append((colour, share * s.canvas_area))
    measured = kmeans_colors(corpus, k=7)

    print("MEASURED identity - area-weighted dominant colours across the corpus")
    claimed = read_claimed(args.claimed)
    for colour, share in measured:
        line = (
            f"  {_hex(colour):>8}  {share * 100:5.1f}%  "
            f"lum {luminance(colour):.2f}  sat {saturation(colour):.2f}  "
            f"hue {hue_degrees(colour):5.0f}deg"
        )
        if claimed:
            name, distance = nearest(colour, claimed)
            verdict = "matches" if distance < 24 else "NOT IN DOCS" if distance > 60 else "near"
            line += f"   {verdict}: {name} (d={distance:.0f})"
        print(line)

    print(
        f"\n  stroke density  mean {sum(s.stroke_density for s in samples) / len(samples):.3f}"
        f"   luminance {sum(s.mean_luminance for s in samples) / len(samples):.3f}"
        f"   saturation {sum(s.mean_saturation for s in samples) / len(samples):.3f}"
        f"   variance {sum(s.colour_variance for s in samples) / len(samples):.3f}"
    )

    clusters = kmeans_vectors(samples, k=args.clusters)
    print(f"\nCLUSTERS - {args.clusters} requested, by 19-float feature vector")
    for i, members in enumerate(clusters):
        if not members:
            continue
        lum = sum(samples[m].mean_luminance for m in members) / len(members)
        sat = sum(samples[m].mean_saturation for m in members) / len(members)
        dens = sum(samples[m].stroke_density for m in members) / len(members)
        share = len(members) / len(samples) * 100
        names = ", ".join(os.path.basename(samples[m].path) for m in members[:4])
        more = f" +{len(members) - 4}" if len(members) > 4 else ""
        print(
            f"  cluster {i}  {len(members):3d} files ({share:4.1f}%)  "
            f"lum {lum:.2f} sat {sat:.2f} strokes {dens:.3f}"
        )
        print(f"             {names}{more}")

    if claimed:
        print("\nCLAIMED but not measured - colours the docs name that the art barely uses")
        for name, rgb in claimed:
            _, distance = nearest(rgb, [("m", c) for c, _ in measured])
            if distance > 60:
                print(f"  {_hex(rgb)}  {name}  (nearest measured is {distance:.0f} away)")

    if args.json_path:
        with open(args.json_path, "w") as fh:
            json.dump(
                {
                    "samples": len(samples),
                    "measured_palette": [
                        {"hex": _hex(c), "share": s, "luminance": luminance(c)} for c, s in measured
                    ],
                    "clusters": [
                        [os.path.relpath(samples[m].path) for m in members]
                        for members in clusters
                        if members
                    ],
                    "vectors": {os.path.relpath(s.path): s.vector for s in samples},
                },
                fh,
                indent=2,
            )
        print(f"\nwritten to {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
