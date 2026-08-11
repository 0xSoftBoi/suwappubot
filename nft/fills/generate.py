#!/usr/bin/env python3
"""Suwappu Fills — 10,000 order tickets from the Robinhood Chain tape.

Every ticket is a filled order for one of the ~96 canonical tokenized equities
that trade as ordinary ERC-20s on Robinhood Chain (chain id 4663). The ticker
universe, contract addresses and display names are read straight out of
``bot/config/tokens.py::ROBINHOOD_EQUITIES`` — the repo's on-chain-verified
registry — so the collection can never drift from what is actually tradable.

Everything regenerates byte-for-byte from the seed committed in config.json.

Run:  python3 nft/fills/generate.py [--out nft/fills/output] [--limit N]
"""

import argparse
import ast
import hashlib
import json
import math
import os
import random
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TOKENS_PY = os.path.join(REPO, "bot", "config", "tokens.py")

W, H = 1000, 1250
IMAGE_URI = "ipfs://__IMAGES_CID__/{i}.svg"

# Card geometry
M = 44  # outer margin
CX0, CX1 = M, W - M  # card left/right
PAD = 38  # inner padding
IX0, IX1 = CX0 + PAD, CX1 - PAD


def load_registry() -> dict:
    """Parse ROBINHOOD_EQUITIES out of bot/config/tokens.py without importing it
    (importing bot.config pulls pydantic-settings and the whole bot config)."""
    src = open(TOKENS_PY).read()
    m = re.search(
        r"ROBINHOOD_EQUITIES: dict\[str, tuple\[str, int, str\]\] = (\{.*?\n\})", src, re.S
    )
    if not m:
        raise SystemExit("ROBINHOOD_EQUITIES not found in bot/config/tokens.py")
    return ast.literal_eval(m.group(1))


def load_config() -> dict:
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def pick(rng, options):
    total = sum(o["weight"] for o in options)
    r = rng.randrange(total)
    acc = 0
    for o in options:
        acc += o["weight"]
        if r < acc:
            return o
    return options[-1]


def build_ticker_pool(cfg):
    """ticker -> weight, and ticker -> sector, from the band/sector config."""
    weights, sectors = {}, {}
    for band, spec in cfg["ticker_bands"].items():
        if band == "_comment":
            continue
        for t in spec["tickers"]:
            weights[t] = spec["weight"]
    for sector, tickers in cfg["sectors"].items():
        for t in tickers:
            sectors[t] = sector
    return weights, sectors


# ------------------------------------------------------------------ trait roll


def roll(cfg, registry, supply, seed):
    rng = random.Random(seed)
    weights, sectors = build_ticker_pool(cfg)
    tickers = [{"name": t, "weight": w} for t, w in sorted(weights.items())]
    layers = cfg["layers"]
    desks = cfg["desks"]

    seen, rolls = set(), []
    while len(rolls) < supply:
        t = pick(rng, tickers)["name"]
        combo = {k: pick(rng, v)["name"] for k, v in layers.items()}
        combo["Ticker"] = t
        combo["Sector"] = sectors[t]
        combo["Desk"] = pick(rng, desks)["name"]
        key = tuple(combo[k] for k in sorted(combo))
        if key in seen:
            continue
        seen.add(key)
        rolls.append(combo)
    return rolls


# ------------------------------------------------------------------ the tape


def price_series(rng, n=56):
    """Deterministic OHLC random walk. Returns (candles, lo, hi)."""
    px = rng.uniform(18, 640)
    drift = rng.uniform(-0.004, 0.004)
    vol = rng.uniform(0.012, 0.045)
    out = []
    for _ in range(n):
        o = px
        c = max(0.5, o * (1 + drift + rng.gauss(0, vol)))
        hi = max(o, c) * (1 + abs(rng.gauss(0, vol * 0.45)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, vol * 0.45)))
        vsize = abs(rng.gauss(0, 1)) + 0.15
        out.append((o, hi, lo, c, vsize))
        px = c
    lo_all = min(c[2] for c in out)
    hi_all = max(c[1] for c in out)
    return out, lo_all, hi_all


def heikin(candles):
    out, po, pc = [], candles[0][0], candles[0][3]
    for o, h, l, c, v in candles:
        hc = (o + h + l + c) / 4
        ho = (po + pc) / 2
        out.append((ho, max(h, ho, hc), min(l, ho, hc), hc, v))
        po, pc = ho, hc
    return out


def draw_tape(rng, combo, x0, y0, x1, y1, up, down):
    """Render the price panel in the given box. Returns (svg_parts, last_price)."""
    p = []
    candles, lo, hi = price_series(rng)
    style = combo["Tape"]
    if style == "Heikin-Ashi":
        candles = heikin(candles)
        lo = min(c[2] for c in candles)
        hi = max(c[1] for c in candles)
    span = (hi - lo) or 1.0
    vol_h = 54
    plot_y1 = y1 - vol_h - 14
    ph = plot_y1 - y0

    def py(v):
        return plot_y1 - (v - lo) / span * ph

    # grid
    for i in range(5):
        gy = y0 + ph * i / 4
        p.append(
            f'<line x1="{x0}" y1="{gy:.1f}" x2="{x1}" y2="{gy:.1f}" stroke="#ffffff" '
            f'stroke-opacity="0.055" stroke-width="1"/>'
        )
    n = len(candles)
    step = (x1 - x0) / n
    bw = max(2.6, step * 0.58)

    if style == "Line":
        pts = " ".join(f"{x0 + step * (i + 0.5):.1f},{py(c[3]):.1f}" for i, c in enumerate(candles))
        last_up = candles[-1][3] >= candles[0][0]
        col = up if last_up else down
        p.append(
            f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="3" '
            f'stroke-linejoin="round" stroke-linecap="round"/>'
        )
        p.append(
            f'<polygon points="{x0:.1f},{plot_y1:.1f} {pts} {x1:.1f},{plot_y1:.1f}" '
            f'fill="{col}" fill-opacity="0.10"/>'
        )
    elif style == "Depth Ladder":
        for i, c in enumerate(candles):
            x = x0 + step * i
            wdt = (x1 - x0) * (0.12 + 0.88 * (c[4] / 3.2)) * 0.5
            col = up if i % 2 == 0 else down
            side_x = x0 if i % 2 == 0 else x1 - wdt
            p.append(
                f'<rect x="{side_x:.1f}" y="{y0 + i * (ph / n):.1f}" width="{wdt:.1f}" '
                f'height="{max(1.5, ph / n - 1.6):.1f}" fill="{col}" fill-opacity="0.5"/>'
            )
    elif style == "Point & Figure":
        for i, c in enumerate(candles):
            x = x0 + step * (i + 0.5)
            y = py(c[3])
            if c[3] >= c[0]:
                p.append(
                    f'<text x="{x:.1f}" y="{y + 5:.1f}" text-anchor="middle" '
                    f'font-family="monospace" font-size="15" fill="{up}">X</text>'
                )
            else:
                p.append(
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="none" stroke="{down}" '
                    f'stroke-width="2"/>'
                )
    else:  # Candles / Heikin-Ashi
        for i, (o, h, l, c, _v) in enumerate(candles):
            x = x0 + step * (i + 0.5)
            col = up if c >= o else down
            p.append(
                f'<line x1="{x:.1f}" y1="{py(h):.1f}" x2="{x:.1f}" y2="{py(l):.1f}" '
                f'stroke="{col}" stroke-width="1.4" stroke-opacity="0.9"/>'
            )
            top, bot = py(max(o, c)), py(min(o, c))
            p.append(
                f'<rect x="{x - bw / 2:.1f}" y="{top:.1f}" width="{bw:.1f}" '
                f'height="{max(1.4, bot - top):.1f}" fill="{col}"/>'
            )

    # volume histogram
    vmax = max(c[4] for c in candles)
    for i, c in enumerate(candles):
        x = x0 + step * (i + 0.5)
        vh = (c[4] / vmax) * vol_h
        col = up if c[3] >= c[0] else down
        p.append(
            f'<rect x="{x - bw / 2:.1f}" y="{y1 - vh:.1f}" width="{bw:.1f}" '
            f'height="{vh:.1f}" fill="{col}" fill-opacity="0.30"/>'
        )

    # last price marker
    last = candles[-1][3]
    ly = py(last)
    p.append(
        f'<line x1="{x0}" y1="{ly:.1f}" x2="{x1}" y2="{ly:.1f}" stroke="#ffffff" '
        f'stroke-opacity="0.30" stroke-width="1" stroke-dasharray="4 4"/>'
    )
    return p, last, lo, hi


# ------------------------------------------------------------------ the card


def kv_block(x, y, label, value, vcolor="#e8ecf4", vsize=25):
    return (
        f'<text x="{x}" y="{y}" font-family="monospace" font-size="14" letter-spacing="1.6" '
        f'fill="#6b7488">{esc(label)}</text>'
        f'<text x="{x}" y="{y + 31}" font-family="monospace" font-size="{vsize}" '
        f'font-weight="bold" fill="{vcolor}">{esc(value)}</text>'
    )


def render(token_id, combo, cfg, registry, desk_map):
    rng = random.Random(f"suwappu-fill:{cfg['collection']['seed']}:{token_id}")
    ticker = combo["Ticker"]
    addr, decimals, company = registry[ticker]
    sector_col = cfg["sector_colors"][combo["Sector"]]
    desk = desk_map[combo["Desk"]]
    accent = desk["accent"]
    buy = combo["Side"] == "BUY"
    up, down = "#3ddc97", "#ff6b6b"
    side_col = up if buy else down
    halted = combo["Session"] == "Halted"

    p = []
    p.append(
        "<defs>"
        '<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">'
        '<stop offset="0" stop-color="#0a0d16"/><stop offset="1" stop-color="#070910"/>'
        "</linearGradient>"
        '<linearGradient id="card" x1="0" y1="0" x2="0.3" y2="1">'
        '<stop offset="0" stop-color="#121724"/><stop offset="1" stop-color="#0d111b"/>'
        "</linearGradient>"
        f'<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{accent}" stop-opacity="0.85"/>'
        f'<stop offset="0.5" stop-color="{sector_col}" stop-opacity="0.45"/>'
        f'<stop offset="1" stop-color="{accent}" stop-opacity="0.85"/>'
        "</linearGradient>"
        '<pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">'
        '<path d="M26 0H0V26" fill="none" stroke="#ffffff" stroke-opacity="0.028"/>'
        "</pattern>"
        "</defs>"
    )
    p.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    p.append(
        f'<rect x="{CX0}" y="{M}" width="{CX1 - CX0}" height="{H - 2 * M}" rx="22" '
        f'fill="url(#card)" stroke="url(#edge)" stroke-width="2"/>'
    )
    p.append(
        f'<rect x="{CX0 + 1}" y="{M + 1}" width="{CX1 - CX0 - 2}" height="{H - 2 * M - 2}" '
        f'rx="21" fill="url(#grid)"/>'
    )

    # ── header ────────────────────────────────────────────────────────────────
    y = M + 52
    p.append(
        f'<text x="{IX0}" y="{y}" font-family="monospace" font-size="19" font-weight="bold" '
        f'letter-spacing="4" fill="#e8ecf4">SUWAPPU</text>'
        f'<text x="{IX0 + 128}" y="{y}" font-family="monospace" font-size="19" '
        f'letter-spacing="4" fill="{accent}">FILL</text>'
        f'<text x="{IX1}" y="{y}" text-anchor="end" font-family="monospace" font-size="17" '
        f'fill="#6b7488">No. {token_id:05d} / 10000</text>'
    )
    y += 16
    p.append(
        f'<line x1="{IX0}" y1="{y}" x2="{IX1}" y2="{y}" stroke="#ffffff" stroke-opacity="0.12"/>'
    )

    # ── ticker block ──────────────────────────────────────────────────────────
    y += 76
    size = 92 if len(ticker) <= 4 else 74
    p.append(
        f'<text x="{IX0}" y="{y}" font-family="monospace" font-size="{size}" '
        f'font-weight="bold" letter-spacing="2" fill="#f2f5fa">{esc(ticker)}</text>'
    )
    # side tag
    p.append(
        f'<rect x="{IX1 - 132}" y="{y - 54}" width="132" height="54" rx="8" fill="{side_col}" '
        f'fill-opacity="0.14" stroke="{side_col}" stroke-opacity="0.55"/>'
        f'<text x="{IX1 - 66}" y="{y - 17}" text-anchor="middle" font-family="monospace" '
        f'font-size="27" font-weight="bold" fill="{side_col}">{combo["Side"]}</text>'
    )
    y += 34
    p.append(
        f'<text x="{IX0}" y="{y}" font-family="monospace" font-size="21" '
        f'fill="#98a2b8">{esc(company)}</text>'
    )
    y += 34
    chip_w = 13 * len(combo["Sector"]) + 30
    p.append(
        f'<rect x="{IX0}" y="{y - 21}" width="{chip_w}" height="30" rx="15" '
        f'fill="{sector_col}" fill-opacity="0.13" stroke="{sector_col}" stroke-opacity="0.4"/>'
        f'<text x="{IX0 + chip_w / 2:.0f}" y="{y}" text-anchor="middle" font-family="monospace" '
        f'font-size="15" fill="{sector_col}">{esc(combo["Sector"])}</text>'
    )
    p.append(
        f'<text x="{IX1}" y="{y}" text-anchor="end" font-family="monospace" font-size="13" '
        f'fill="#565e70">{esc(addr[:10])}…{esc(addr[-8:])} · {decimals}d</text>'
    )

    # ── tape ──────────────────────────────────────────────────────────────────
    ty0 = y + 30
    ty1 = ty0 + 316
    p.append(
        f'<rect x="{IX0}" y="{ty0}" width="{IX1 - IX0}" height="{ty1 - ty0}" rx="10" '
        f'fill="#0a0e17" stroke="#ffffff" stroke-opacity="0.07"/>'
    )
    tape, last, lo, hi = draw_tape(rng, combo, IX0 + 16, ty0 + 20, IX1 - 16, ty1 - 16, up, down)
    p.extend(tape)
    p.append(
        f'<text x="{IX0 + 16}" y="{ty0 - 10}" font-family="monospace" font-size="13" '
        f'letter-spacing="1.5" fill="#6b7488">{esc(combo["Tape"].upper())} · 56 PERIODS</text>'
        f'<text x="{IX1 - 16}" y="{ty0 - 10}" text-anchor="end" font-family="monospace" '
        f'font-size="13" fill="#6b7488">H {hi:,.2f}  L {lo:,.2f}</text>'
    )

    # ── fill detail grid ──────────────────────────────────────────────────────
    qty = round(rng.uniform(0.4, 480), 3)
    notional = qty * last
    gy = ty1 + 62
    colw = (IX1 - IX0) / 3
    cells = [
        ("QUANTITY", f"{qty:,.3f}"),
        ("AVG PRICE", f"{last:,.2f}"),
        ("NOTIONAL", f"{notional:,.0f}"),
        ("SETTLEMENT", combo["Settlement"]),
        ("SESSION", combo["Session"]),
        ("ORDER TYPE", combo["Order Type"]),
        ("ROUTE", combo["Route"]),
        ("FILL QUALITY", combo["Fill Quality"]),
        ("CHAIN", "4663"),
    ]
    for i, (label, value) in enumerate(cells):
        cxp = IX0 + colw * (i % 3)
        cyp = gy + (i // 3) * 78
        vc = "#e8ecf4"
        vs = 22 if len(value) > 13 else 25
        if label == "SETTLEMENT" and value == "USDG":
            vc = "#fcd34d"
        if label == "FILL QUALITY" and value in ("Price Improvement", "Perfect Fill"):
            vc = up
        if label == "SESSION" and value == "Halted":
            vc = down
        p.append(kv_block(int(cxp), int(cyp), label, value, vc, vs))

    # ── desk badge + utility ──────────────────────────────────────────────────
    by = gy + 3 * 78 + 6
    p.append(
        f'<rect x="{IX0}" y="{by}" width="{IX1 - IX0}" height="76" rx="10" '
        f'fill="{accent}" fill-opacity="0.08" stroke="{accent}" stroke-opacity="0.42"/>'
        f'<text x="{IX0 + 22}" y="{by + 32}" font-family="monospace" font-size="14" '
        f'letter-spacing="2" fill="#6b7488">DESK</text>'
        f'<text x="{IX0 + 22}" y="{by + 60}" font-family="monospace" font-size="27" '
        f'font-weight="bold" fill="{accent}">{esc(desk["name"].upper())}</text>'
        f'<text x="{IX1 - 22}" y="{by + 32}" text-anchor="end" font-family="monospace" '
        f'font-size="14" letter-spacing="1.4" fill="#6b7488">SWAP FEE / TICKER XP</text>'
        f'<text x="{IX1 - 22}" y="{by + 60}" text-anchor="end" font-family="monospace" '
        f'font-size="24" font-weight="bold" fill="#e8ecf4">'
        f'−{desk["discount_bps"]} bps · +{desk["xp_boost_bps"] / 100:.0f}% XP</text>'
    )

    # ── stub: perforation + trait-hash barcode ────────────────────────────────
    sy = by + 100
    p.append(
        f'<line x1="{CX0 + 10}" y1="{sy}" x2="{CX1 - 10}" y2="{sy}" stroke="#ffffff" '
        f'stroke-opacity="0.16" stroke-width="2" stroke-dasharray="2 9"/>'
        f'<circle cx="{CX0}" cy="{sy}" r="9" fill="url(#bg)"/>'
        f'<circle cx="{CX1}" cy="{sy}" r="9" fill="url(#bg)"/>'
    )
    digest = hashlib.sha256(
        ("|".join(f"{k}={combo[k]}" for k in sorted(combo)) + f"|{token_id}").encode()
    ).hexdigest()
    bx = IX0
    bar_w = (IX1 - IX0) / 64.0
    for i in range(64):
        nib = int(digest[i % len(digest)], 16)
        bh = 12 + nib * 2.6
        p.append(
            f'<rect x="{bx + i * bar_w:.1f}" y="{sy + 74 - bh:.1f}" '
            f'width="{bar_w * 0.55:.1f}" height="{bh:.1f}" fill="#ffffff" '
            f'fill-opacity="{0.16 + (nib / 15.0) * 0.34:.2f}"/>'
        )
    p.append(
        f'<text x="{IX0}" y="{sy + 34}" font-family="monospace" font-size="14" '
        f'letter-spacing="1.6" fill="#6b7488">TICKET HASH</text>'
        f'<text x="{IX1}" y="{sy + 34}" text-anchor="end" font-family="monospace" '
        f'font-size="15" fill="#8b93a6">{digest[:24]}</text>'
    )

    # ── footer / compliance ───────────────────────────────────────────────────
    fy = H - M - 34
    p.append(
        f'<line x1="{IX0}" y1="{fy - 26}" x2="{IX1}" y2="{fy - 26}" stroke="#ffffff" '
        f'stroke-opacity="0.10"/>'
        f'<text x="{IX0}" y="{fy}" font-family="monospace" font-size="12" fill="#4d5566">'
        f"COLLECTIBLE TICKET · NOT EQUITY · NO SHAREHOLDER RIGHTS · NO CLAIM ON ANY ISSUER</text>"
        f'<text x="{IX1}" y="{fy}" text-anchor="end" font-family="monospace" font-size="12" '
        f'fill="#4d5566">ROBINHOOD CHAIN</text>'
    )

    # ── overlays ──────────────────────────────────────────────────────────────
    if halted:
        p.append(
            f'<g transform="rotate(-14 500 {ty0 + 150})" opacity="0.85">'
            f'<rect x="250" y="{ty0 + 108}" width="500" height="92" rx="8" fill="none" '
            f'stroke="{down}" stroke-width="5"/>'
            f'<text x="500" y="{ty0 + 172}" text-anchor="middle" font-family="monospace" '
            f'font-size="58" font-weight="bold" letter-spacing="8" fill="{down}">HALTED</text></g>'
        )
    if combo["Fill Quality"] == "Perfect Fill":
        p.append(
            f'<g opacity="0.9"><circle cx="{IX1 - 54}" cy="{ty1 + 4}" r="40" fill="none" '
            f'stroke="{up}" stroke-width="2"/>'
            f'<text x="{IX1 - 54}" y="{ty1 - 2}" text-anchor="middle" font-family="monospace" '
            f'font-size="12" letter-spacing="1" fill="{up}">PERFECT</text>'
            f'<text x="{IX1 - 54}" y="{ty1 + 16}" text-anchor="middle" font-family="monospace" '
            f'font-size="12" letter-spacing="1" fill="{up}">FILL</text></g>'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" '
        f'height="{H}">{"".join(p)}</svg>'
    )


# ------------------------------------------------------------------ metadata


def metadata(cfg, registry, desk_map, token_id, combo):
    addr, decimals, company = registry[combo["Ticker"]]
    desk = desk_map[combo["Desk"]]
    col = cfg["collection"]
    attrs = [
        {"trait_type": "Ticker", "value": combo["Ticker"]},
        {"trait_type": "Company", "value": company},
        {"trait_type": "Sector", "value": combo["Sector"]},
        {"trait_type": "Side", "value": combo["Side"]},
        {"trait_type": "Session", "value": combo["Session"]},
        {"trait_type": "Order Type", "value": combo["Order Type"]},
        {"trait_type": "Settlement", "value": combo["Settlement"]},
        {"trait_type": "Route", "value": combo["Route"]},
        {"trait_type": "Tape", "value": combo["Tape"]},
        {"trait_type": "Fill Quality", "value": combo["Fill Quality"]},
        {"trait_type": "Desk", "value": combo["Desk"]},
        {
            "trait_type": "Fee Discount (bps)",
            "value": desk["discount_bps"],
            "display_type": "number",
        },
        {
            "trait_type": "Ticker XP Boost (bps)",
            "value": desk["xp_boost_bps"],
            "display_type": "number",
        },
    ]
    return {
        "name": f"Fill #{token_id} · {combo['Ticker']} {combo['Side']}",
        "description": (
            f"A filled {combo['Order Type'].lower()} order ticket for {company} "
            f"({combo['Ticker']}) on Robinhood Chain, settled in {combo['Settlement']} "
            f"during {combo['Session'].lower()}. Held in a wallet linked to Suwappu, this "
            f"ticket runs a {combo['Desk']} desk: −{desk['discount_bps']} bps on swap fees "
            f"and +{desk['xp_boost_bps'] / 100:.0f}% XP on {combo['Ticker']} swaps.\n\n"
            f"{col['compliance']}"
        ),
        "image": IMAGE_URI.format(i=token_id),
        "external_url": col["external_url"],
        "attributes": attrs,
        "properties": {
            "chain_id": col["chain"]["chain_id"],
            "underlying_erc20": addr,
            "underlying_decimals": decimals,
            "disclaimer": col["compliance"],
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "output"))
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    cfg = load_config()
    registry = load_registry()
    desk_map = {d["name"]: d for d in cfg["desks"]}
    supply = cfg["collection"]["supply"]
    seed = cfg["collection"]["seed"]

    mapped = {x for v in cfg["sectors"].values() for x in v}
    missing = [t for t in registry if t not in mapped]
    if missing:
        raise SystemExit(f"config.json sectors missing registry tickers: {sorted(missing)}")

    rolls = roll(cfg, registry, supply, seed)
    img_dir = os.path.join(args.out, "images")
    meta_dir = os.path.join(args.out, "metadata")
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(meta_dir, exist_ok=True)

    n = min(supply, args.limit) if args.limit else supply
    hashes, collection = [], []
    for tid in range(1, n + 1):
        combo = rolls[tid - 1]
        svg = render(tid, combo, cfg, registry, desk_map)
        with open(os.path.join(img_dir, f"{tid}.svg"), "w") as f:
            f.write(svg)
        meta = metadata(cfg, registry, desk_map, tid, combo)
        with open(os.path.join(meta_dir, str(tid)), "w") as f:
            json.dump(meta, f, separators=(",", ":"))
        hashes.append(hashlib.sha256(svg.encode()).hexdigest())
        collection.append(meta)
        if tid % 1000 == 0:
            print(f"  {tid}/{n}")

    prov = hashlib.sha256("".join(hashes).encode()).hexdigest()
    suffix = f".partial{n}" if n != supply else ""
    with open(os.path.join(HERE, f"provenance{suffix}.json"), "w") as f:
        json.dump(
            {
                "collection": cfg["collection"]["name"],
                "supply": n,
                "seed": seed,
                "provenance_hash": prov,
                "algorithm": "sha256(concat(sha256(image_i) for i in 1..N))",
                "registry_source": "bot/config/tokens.py::ROBINHOOD_EQUITIES",
                "registry_tickers": len(registry),
                "image_hashes": hashes,
            },
            f,
            indent=1,
        )
    with open(os.path.join(HERE, f"collection{suffix}.json"), "w") as f:
        json.dump(collection, f, separators=(",", ":"))

    # desk distribution -> used by the bot's boost table and the README
    dist = {}
    for c in rolls[:n]:
        dist[c["Desk"]] = dist.get(c["Desk"], 0) + 1
    print(f"done: {n} tickets · desks {dist} · provenance {prov}")


if __name__ == "__main__":
    main()
