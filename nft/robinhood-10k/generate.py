#!/usr/bin/env python3
"""Suwappu Feathers — deterministic 10k generative collection for Robinhood Chain.

Regenerates the ENTIRE collection byte-for-byte from traits.json (seed included).
Run:  python3 nft/robinhood-10k/generate.py [--out nft/robinhood-10k/output]

Outputs:
  output/images/<id>.svg      10,000 procedural feather images
  output/metadata/<id>        10,000 ERC-721 metadata JSON files (no extension,
                              matching tokenURI = baseURI + tokenId)
  collection.json             all 10k metadata rows in one committed file
  provenance.json             sha256 per image + BAYC-style provenance hash
"""

import argparse
import hashlib
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
W = H = 1000
IMAGE_URI = "ipfs://__COLLECTION_CID__/{i}.svg"  # rewritten after IPFS upload


def load_config():
    with open(os.path.join(HERE, "traits.json")) as f:
        return json.load(f)


def pick(rng, options):
    total = sum(o["weight"] for o in options)
    r = rng.randrange(total)
    acc = 0
    for o in options:
        acc += o["weight"]
        if r < acc:
            return o
    return options[-1]


def roll_traits(cfg, supply, seed):
    """Deterministically roll `supply` unique trait combos + 1/1 legendaries."""
    rng = random.Random(seed)
    layers = cfg["layers"]
    seen, rolls = set(), []
    while len(rolls) < supply:
        combo = {k: pick(rng, v) for k, v in layers.items()}
        key = tuple(combo[k]["name"] for k in sorted(combo))
        if key in seen:
            continue
        seen.add(key)
        rolls.append(combo)
    # Legendary 1/1s replace deterministic token ids spread across the range.
    legendary_ids = sorted(rng.sample(range(1, supply + 1), len(cfg["legendaries"])))
    return rolls, legendary_ids


# ---------------------------------------------------------------- SVG drawing


def shaft_points(rng, curve, n=90):
    """Quadratic bezier spine from quill tip (bottom) to feather tip (top)."""
    x0, y0 = 500.0, 930.0
    x2, y2 = 500.0 + rng.uniform(-30, 30), 90.0
    x1 = 500.0 + curve * rng.choice([-1, 1]) * 420.0
    y1 = 510.0
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t**2 * x2
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t**2 * y2
        pts.append((x, y))
    return pts


def vane_width(t, taper):
    """Half-width of the vane at spine position t in [0,1] (0 = quill)."""
    if t < 0.18:  # bare quill
        return 0.0
    u = (t - 0.18) / 0.82
    return 300.0 * taper * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.8


def draw_feather(rng, combo, palette):
    shape, barbs = combo["Shape"], combo["Barbs"]
    pts = shaft_points(rng, shape["curve"])
    n = len(pts) - 1
    parts = []
    gap = barbs["gap"]
    jitter = barbs["jitter"]
    step = max(1, round(gap / (840.0 / n)))
    for i in range(0, n, step):
        t = i / n
        w = vane_width(t, shape["taper"])
        if w < 4:
            continue
        (x, y), (x2, y2) = pts[i], pts[i + 1]
        dx, dy = x2 - x, y2 - y
        norm = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / norm, dx / norm
        for side in (-1, 1):
            jw = w * (1 + rng.uniform(-jitter, jitter * 0.4))
            sweep = 0.35 + rng.uniform(-0.1, 0.1) * (1 + jitter)
            ex = x + side * nx * jw + dx / norm * jw * sweep
            ey = y + side * ny * jw + dy / norm * jw * sweep
            cx = x + side * nx * jw * 0.45
            cy = y + side * ny * jw * 0.45 + jw * 0.12
            color = palette[rng.randrange(len(palette))]
            width = 2.2 + rng.uniform(0, 1.6)
            op = 0.75 + rng.uniform(0, 0.25)
            parts.append(
                f'<path d="M{x:.1f},{y:.1f} Q{cx:.1f},{cy:.1f} {ex:.1f},{ey:.1f}" '
                f'stroke="{color}" stroke-width="{width:.2f}" fill="none" '
                f'stroke-linecap="round" opacity="{op:.2f}"/>'
            )
    # shaft on top of barbs
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    shaft_color = combo["Shaft"]["color"]
    parts.append(
        f'<path d="{d}" stroke="{shaft_color}" stroke-width="9" fill="none" stroke-linecap="round"/>'
    )
    parts.append(
        f'<path d="{d}" stroke="{shaft_color}" stroke-width="3.5" fill="none" opacity="0.5" '
        f'transform="translate(2,0)"/>'
    )
    return parts, pts


def draw_aura(aura, parts_pre):
    if aura == "Soft Glow":
        parts_pre.append('<circle cx="500" cy="500" r="380" fill="url(#glow)"/>')
    elif aura == "Ring":
        parts_pre.append(
            '<circle cx="500" cy="500" r="400" fill="none" stroke="#ffffff" '
            'stroke-opacity="0.25" stroke-width="3"/>'
        )
    elif aura == "Double Ring":
        for r in (390, 425):
            parts_pre.append(
                f'<circle cx="500" cy="500" r="{r}" fill="none" stroke="#ffffff" '
                f'stroke-opacity="0.22" stroke-width="2.5"/>'
            )
    elif aura == "Halo":
        parts_pre.append(
            '<circle cx="500" cy="180" r="90" fill="none" stroke="#ffd700" '
            'stroke-opacity="0.85" stroke-width="6"/>'
        )


def draw_charm(charm, pts, parts):
    ticker = charm.get("ticker")
    if not ticker:
        return
    x, y = pts[4]  # near the quill end
    parts.append(
        f'<g><circle cx="{x:.0f}" cy="{y + 28:.0f}" r="34" fill="#111522" '
        f'stroke="#e8b923" stroke-width="2.5"/>'
        f'<text x="{x:.0f}" y="{y + 33:.0f}" text-anchor="middle" font-family="monospace" '
        f'font-size="15" font-weight="bold" fill="#e8b923">{ticker}</text></g>'
    )


def render_svg(token_id, combo, legendary=None):
    rng = random.Random(f"art:{token_id}")
    bg = combo["Background"]["colors"]
    palette = combo["Palette"]["colors"]
    if legendary:
        palette = ["#ffd700", "#e8b923", "#fff2b0"] if "Gold" in legendary["name"] else palette
    pre = [
        "<defs>",
        f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{bg[0]}"/><stop offset="1" stop-color="{bg[1]}"/>'
        "</linearGradient>",
        '<radialGradient id="glow"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>'
        '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>',
        "</defs>",
        f'<rect width="{W}" height="{H}" fill="url(#bg)"/>',
    ]
    draw_aura(combo["Aura"]["name"], pre)
    parts, pts = draw_feather(rng, combo, palette)
    draw_charm(combo["Charm"], pts, parts)
    label = legendary["name"] if legendary else f"#{token_id:04d}"
    footer = (
        f'<text x="500" y="978" text-anchor="middle" font-family="monospace" font-size="17" '
        f'fill="#8a8fa3">SUWAPPU FEATHERS · {label} · CHAIN 4663</text>'
    )
    body = "".join(pre) + "".join(parts) + footer
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}">{body}</svg>'
    )


# ---------------------------------------------------------------- main


def build_metadata(cfg, token_id, combo, legendary):
    attrs = [{"trait_type": k, "value": v["name"]} for k, v in sorted(combo.items())]
    if legendary:
        attrs = [{"trait_type": "Legendary", "value": legendary["name"]}] + attrs
    name = legendary["name"] if legendary else f"Suwappu Feather #{token_id}"
    desc = legendary["desc"] if legendary else cfg["collection"]["description"]
    return {
        "name": name,
        "description": desc,
        "image": IMAGE_URI.format(i=token_id),
        "external_url": cfg["collection"]["external_url"],
        "attributes": attrs,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "output"))
    ap.add_argument("--limit", type=int, default=None, help="generate first N only (debug)")
    args = ap.parse_args()

    cfg = load_config()
    supply = cfg["collection"]["supply"]
    seed = cfg["collection"]["seed"]
    rolls, legendary_ids = roll_traits(cfg, supply, seed)
    legendaries = dict(zip(legendary_ids, cfg["legendaries"]))

    img_dir = os.path.join(args.out, "images")
    meta_dir = os.path.join(args.out, "metadata")
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(meta_dir, exist_ok=True)

    n = min(supply, args.limit) if args.limit else supply
    hashes, collection = [], []
    for token_id in range(1, n + 1):
        combo = rolls[token_id - 1]
        legendary = legendaries.get(token_id)
        svg = render_svg(token_id, combo, legendary)
        with open(os.path.join(img_dir, f"{token_id}.svg"), "w") as f:
            f.write(svg)
        meta = build_metadata(cfg, token_id, combo, legendary)
        with open(os.path.join(meta_dir, str(token_id)), "w") as f:
            json.dump(meta, f, separators=(",", ":"))
        hashes.append(hashlib.sha256(svg.encode()).hexdigest())
        collection.append(meta)
        if token_id % 1000 == 0:
            print(f"  {token_id}/{n}")

    provenance = hashlib.sha256("".join(hashes).encode()).hexdigest()
    # Partial (--limit) runs must never clobber the committed full-collection records.
    suffix = f".partial{n}" if n != supply else ""
    with open(os.path.join(HERE, f"provenance{suffix}.json"), "w") as f:
        json.dump(
            {
                "collection": cfg["collection"]["name"],
                "supply": n,
                "seed": seed,
                "provenance_hash": provenance,
                "algorithm": "sha256(concat(sha256(image_i) for i in 1..N))",
                "legendary_token_ids": legendary_ids,
                "image_hashes": hashes,
            },
            f,
            indent=1,
        )
    with open(os.path.join(HERE, f"collection{suffix}.json"), "w") as f:
        json.dump(collection, f, separators=(",", ":"))
    print(f"done: {n} tokens, provenance {provenance}")


if __name__ == "__main__":
    main()
