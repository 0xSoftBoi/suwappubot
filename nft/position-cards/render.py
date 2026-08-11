#!/usr/bin/env python3
"""Suwappu Positions — live position-card renderer.

A card is drawn from REAL state only: the ticker you chose, the entry price
stamped on-chain when you minted, and the current oracle price. Nothing here
invents price history — the previous iteration of this collection drew a fake
random-walk chart, which is exactly the kind of decoration that makes a card
worthless. The hero element is the actual return between two real numbers.

The ticker universe (symbol, ERC-20 address, decimals, company name) is parsed
from bot/config/tokens.py::ROBINHOOD_EQUITIES so the collection cannot drift
from what is tradable on chain 4663.

  python3 nft/position-cards/render.py --gallery        # sample cards -> preview/
  python3 nft/position-cards/render.py --ticker NVDA --entry 100 --price 168 --rank 42
"""

import argparse
import ast
import json
import os
import re
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TOKENS_PY = os.path.join(REPO, "bot", "config", "tokens.py")

W, H = 1000, 1250
M = 44
CX0, CX1 = M, W - M
PAD = 38
IX0, IX1 = CX0 + PAD, CX1 - PAD


def load_registry() -> dict:
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


def sector_of(cfg, ticker):
    for sector, tickers in cfg["sectors"].items():
        if ticker in tickers:
            return sector
    return "Other"


def grade_for(cfg, return_bps):
    chosen = cfg["grades"][0]
    for g in cfg["grades"]:
        if return_bps >= g["min_return_bps"]:
            chosen = g
    return chosen


def badge_for(cfg, rank):
    ranks = cfg["economics"]["early_mint_badge_ranks"]
    for name, limit in sorted(ranks.items(), key=lambda kv: kv[1]):
        if rank <= limit:
            return name
    return None


def fmt_px(v):
    if v is None:
        return "—"
    return f"{v:,.2f}" if v >= 1 else f"{v:,.4f}"


def render_card(
    cfg,
    registry,
    token_id: int,
    ticker: str,
    entry: float | None,
    price: float | None,
    rank: int,
    minted_at: datetime | None = None,
) -> str:
    """Render one position card. `entry`/`price` of None means unpriced."""
    addr, decimals, company = registry[ticker]
    sector = sector_of(cfg, ticker)
    sector_col = cfg["sector_colors"].get(sector, "#94a3b8")
    priced = bool(entry and price and entry > 0)
    ret_bps = int(round((price - entry) / entry * 10_000)) if priced else 0
    grade = grade_for(cfg, ret_bps) if priced else {"name": "Unpriced", "accent": "#94a3b8"}
    accent = grade["accent"]
    up = ret_bps >= 0
    badge = badge_for(cfg, rank)
    disc = cfg["economics"]["hold_discount_bps"]

    p = [
        "<defs>"
        '<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">'
        '<stop offset="0" stop-color="#0a0d16"/><stop offset="1" stop-color="#070910"/>'
        "</linearGradient>"
        '<linearGradient id="card" x1="0" y1="0" x2="0.3" y2="1">'
        '<stop offset="0" stop-color="#121724"/><stop offset="1" stop-color="#0d111b"/>'
        "</linearGradient>"
        f'<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{accent}" stop-opacity="0.9"/>'
        f'<stop offset="0.5" stop-color="{sector_col}" stop-opacity="0.4"/>'
        f'<stop offset="1" stop-color="{accent}" stop-opacity="0.9"/>'
        "</linearGradient>"
        f'<linearGradient id="delta" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{accent}" stop-opacity="0.55"/>'
        f'<stop offset="1" stop-color="{accent}" stop-opacity="0.05"/>'
        "</linearGradient>"
        '<pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">'
        '<path d="M26 0H0V26" fill="none" stroke="#ffffff" stroke-opacity="0.028"/>'
        "</pattern>"
        "</defs>",
        f'<rect width="{W}" height="{H}" fill="url(#bg)"/>',
        f'<rect x="{CX0}" y="{M}" width="{CX1 - CX0}" height="{H - 2 * M}" rx="22" '
        f'fill="url(#card)" stroke="url(#edge)" stroke-width="2"/>',
        f'<rect x="{CX0 + 1}" y="{M + 1}" width="{CX1 - CX0 - 2}" height="{H - 2 * M - 2}" '
        f'rx="21" fill="url(#grid)"/>',
    ]

    # ── header ───────────────────────────────────────────────────────────────
    y = M + 52
    rank_txt = f"#{rank:04d}" + (f" · {badge}" if badge else "")
    p.append(
        f'<text x="{IX0}" y="{y}" font-family="monospace" font-size="19" font-weight="bold" '
        f'letter-spacing="4" fill="#e8ecf4">SUWAPPU</text>'
        f'<text x="{IX0 + 128}" y="{y}" font-family="monospace" font-size="19" '
        f'letter-spacing="4" fill="{accent}">POSITION</text>'
        f'<text x="{IX1}" y="{y}" text-anchor="end" font-family="monospace" font-size="17" '
        f'fill="{"#fcd34d" if badge else "#6b7488"}">{esc(rank_txt)}</text>'
    )
    y += 16
    p.append(
        f'<line x1="{IX0}" y1="{y}" x2="{IX1}" y2="{y}" stroke="#ffffff" stroke-opacity="0.12"/>'
    )

    # ── ticker ───────────────────────────────────────────────────────────────
    y += 78
    size = 92 if len(ticker) <= 4 else 74
    p.append(
        f'<text x="{IX0}" y="{y}" font-family="monospace" font-size="{size}" '
        f'font-weight="bold" letter-spacing="2" fill="#f2f5fa">{esc(ticker)}</text>'
    )
    y += 34
    p.append(
        f'<text x="{IX0}" y="{y}" font-family="monospace" font-size="21" '
        f'fill="#98a2b8">{esc(company)}</text>'
    )
    y += 34
    chip_w = 13 * len(sector) + 30
    p.append(
        f'<rect x="{IX0}" y="{y - 21}" width="{chip_w}" height="30" rx="15" '
        f'fill="{sector_col}" fill-opacity="0.13" stroke="{sector_col}" stroke-opacity="0.4"/>'
        f'<text x="{IX0 + chip_w / 2:.0f}" y="{y}" text-anchor="middle" font-family="monospace" '
        f'font-size="15" fill="{sector_col}">{esc(sector)}</text>'
        f'<text x="{IX1}" y="{y}" text-anchor="end" font-family="monospace" font-size="13" '
        f'fill="#565e70">{esc(addr[:10])}…{esc(addr[-8:])} · {decimals}d</text>'
    )

    # ── the return: the hero, and the only "chart" — a real entry->now delta ──
    ry0 = y + 34
    ry1 = ry0 + 330
    p.append(
        f'<rect x="{IX0}" y="{ry0}" width="{IX1 - IX0}" height="{ry1 - ry0}" rx="10" '
        f'fill="#0a0e17" stroke="#ffffff" stroke-opacity="0.07"/>'
    )
    if priced:
        pct = ret_bps / 100.0
        sign = "+" if pct >= 0 else "−"
        p.append(
            f'<text x="{IX0 + 30}" y="{ry0 + 132}" font-family="monospace" font-size="104" '
            f'font-weight="bold" fill="{accent}">{sign}{abs(pct):,.1f}%</text>'
            f'<text x="{IX0 + 30}" y="{ry0 + 40}" font-family="monospace" font-size="14" '
            f'letter-spacing="2" fill="#6b7488">RETURN SINCE ENTRY</text>'
        )
        # entry -> now bar. Height of the shaded band IS the move, nothing invented.
        bx0, bx1 = IX0 + 30, IX1 - 30
        base_y = ry0 + 268
        top_y = ry0 + 192
        frac = max(-1.0, min(1.0, ret_bps / 10_000.0))
        band = abs(frac) * (base_y - top_y)
        y_entry = base_y if up else base_y - band
        y_now = base_y - band if up else base_y
        p.append(
            f'<rect x="{bx0}" y="{min(y_entry, y_now):.1f}" width="{bx1 - bx0}" '
            f'height="{max(2, band):.1f}" fill="url(#delta)"/>'
            f'<line x1="{bx0}" y1="{y_entry:.1f}" x2="{bx1}" y2="{y_entry:.1f}" '
            f'stroke="#6b7488" stroke-width="2" stroke-dasharray="5 5"/>'
            f'<line x1="{bx0}" y1="{y_now:.1f}" x2="{bx1}" y2="{y_now:.1f}" '
            f'stroke="{accent}" stroke-width="3"/>'
            f'<text x="{bx0}" y="{y_entry + (20 if up else -9):.1f}" font-family="monospace" '
            f'font-size="14" fill="#6b7488">ENTRY {fmt_px(entry)}</text>'
            f'<text x="{bx1}" y="{y_now + (-9 if up else 20):.1f}" text-anchor="end" '
            f'font-family="monospace" font-size="15" fill="{accent}">NOW {fmt_px(price)}</text>'
        )
    else:
        p.append(
            f'<text x="{(IX0 + IX1) / 2:.0f}" y="{ry0 + 150}" text-anchor="middle" '
            f'font-family="monospace" font-size="34" fill="#6b7488">UNPRICED</text>'
            f'<text x="{(IX0 + IX1) / 2:.0f}" y="{ry0 + 190}" text-anchor="middle" '
            f'font-family="monospace" font-size="16" fill="#4d5566">'
            f"no oracle price at mint — return not tracked</text>"
        )

    # ── facts ────────────────────────────────────────────────────────────────
    gy = ry1 + 62
    colw = (IX1 - IX0) / 3
    when = (minted_at or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    cells = [
        ("ENTRY", fmt_px(entry) if priced else "—"),
        ("CURRENT", fmt_px(price) if priced else "—"),
        ("GRADE", grade["name"]),
        ("HELD SINCE", when),
        ("MINT RANK", f"{rank} / 10000"),
        ("CHAIN", "4663"),
    ]
    for i, (label, value) in enumerate(cells):
        cxp = IX0 + colw * (i % 3)
        cyp = gy + (i // 3) * 78
        vc = accent if label == "GRADE" else "#e8ecf4"
        vs = 22 if len(value) > 12 else 25
        p.append(
            f'<text x="{int(cxp)}" y="{int(cyp)}" font-family="monospace" font-size="14" '
            f'letter-spacing="1.6" fill="#6b7488">{esc(label)}</text>'
            f'<text x="{int(cxp)}" y="{int(cyp) + 31}" font-family="monospace" font-size="{vs}" '
            f'font-weight="bold" fill="{vc}">{esc(value)}</text>'
        )

    # ── perk ─────────────────────────────────────────────────────────────────
    by = gy + 2 * 78 + 10
    p.append(
        f'<rect x="{IX0}" y="{by}" width="{IX1 - IX0}" height="76" rx="10" '
        f'fill="{accent}" fill-opacity="0.08" stroke="{accent}" stroke-opacity="0.42"/>'
        f'<text x="{IX0 + 22}" y="{by + 32}" font-family="monospace" font-size="14" '
        f'letter-spacing="2" fill="#6b7488">HOLDER PERK</text>'
        f'<text x="{IX0 + 22}" y="{by + 60}" font-family="monospace" font-size="25" '
        f'font-weight="bold" fill="{accent}">−{disc} bps on every swap</text>'
        f'<text x="{IX1 - 22}" y="{by + 32}" text-anchor="end" font-family="monospace" '
        f'font-size="14" letter-spacing="1.4" fill="#6b7488">SAVES</text>'
        f'<text x="{IX1 - 22}" y="{by + 60}" text-anchor="end" font-family="monospace" '
        f'font-size="25" font-weight="bold" fill="#e8ecf4">${disc / 10:.2f} per $1k</text>'
    )

    # ── footer ───────────────────────────────────────────────────────────────
    fy = H - M - 34
    p.append(
        f'<line x1="{IX0}" y1="{fy - 26}" x2="{IX1}" y2="{fy - 26}" stroke="#ffffff" '
        f'stroke-opacity="0.10"/>'
        f'<text x="{IX0}" y="{fy}" font-family="monospace" font-size="12" fill="#4d5566">'
        f"COLLECTIBLE · NOT EQUITY · NOT A SECURITY · PAYS NOTHING · NO CLAIM ON ANY ISSUER</text>"
        f'<text x="{IX1}" y="{fy}" text-anchor="end" font-family="monospace" font-size="12" '
        f'fill="#4d5566">ROBINHOOD CHAIN</text>'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" '
        f'height="{H}">{"".join(p)}</svg>'
    )


def build_metadata(cfg, registry, token_id, ticker, entry, price, rank, minted_at=None):
    """ERC-721 metadata for a live position. Regenerated on every fetch — the
    return and grade move with the market, so this is deliberately dynamic."""
    addr, decimals, company = registry[ticker]
    priced = bool(entry and price and entry > 0)
    ret_bps = int(round((price - entry) / entry * 10_000)) if priced else 0
    grade = grade_for(cfg, ret_bps) if priced else {"name": "Unpriced"}
    col = cfg["collection"]
    badge = badge_for(cfg, rank)

    attrs = [
        {"trait_type": "Ticker", "value": ticker},
        {"trait_type": "Company", "value": company},
        {"trait_type": "Sector", "value": sector_of(cfg, ticker)},
        {"trait_type": "Grade", "value": grade["name"]},
        {"trait_type": "Mint Rank", "value": rank, "display_type": "number"},
    ]
    if badge:
        attrs.append({"trait_type": "Badge", "value": badge})
    if priced:
        attrs += [
            {"trait_type": "Entry Price", "value": round(entry, 4)},
            {
                "trait_type": "Return %",
                "value": round(ret_bps / 100.0, 2),
                "display_type": "number",
            },
        ]
    if minted_at:
        attrs.append(
            {
                "trait_type": "Held Since",
                "value": int(minted_at.timestamp()),
                "display_type": "date",
            }
        )

    if priced:
        desc = (
            f"A position on {company} ({ticker}) opened on Robinhood Chain at "
            f"{fmt_px(entry)} USDG. Currently {fmt_px(price)} — "
            f"{'up' if ret_bps >= 0 else 'down'} {abs(ret_bps) / 100:.1f}%. "
            f"Mint rank {rank} of 10,000.\n\n"
            f"The entry price was stamped on-chain at mint and can never change; the "
            f"card re-renders against the live price, so what you see is the call you "
            f"actually made. Holding it takes "
            f"{cfg['economics']['hold_discount_bps']} bps off every Suwappu swap.\n\n"
            f"{col['compliance']}"
        )
    else:
        desc = (
            f"A position on {company} ({ticker}) on Robinhood Chain, minted while no "
            f"oracle price was available, so no entry basis was stamped and no return "
            f"is tracked. Mint rank {rank} of 10,000.\n\n{col['compliance']}"
        )

    return {
        "name": (f"{ticker} #{rank}" + (f" · {grade['name']}" if priced else " · Unpriced")),
        "description": desc,
        "image": f"{col['external_url']}/card/{token_id}.svg",
        "external_url": f"{col['external_url']}/{token_id}",
        "attributes": attrs,
        "properties": {
            "chain_id": col["chain"]["chain_id"],
            "underlying_erc20": addr,
            "underlying_decimals": decimals,
            "disclaimer": col["compliance"],
        },
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gallery", action="store_true")
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--entry", type=float, default=100.0)
    ap.add_argument("--price", type=float, default=137.0)
    ap.add_argument("--rank", type=int, default=42)
    ap.add_argument("--out", default=os.path.join(HERE, "preview"))
    args = ap.parse_args()

    cfg, registry = load_config(), load_registry()
    os.makedirs(args.out, exist_ok=True)

    if args.gallery:
        # Current prices are the REAL values read from the Chainlink feeds on
        # chain 4663 (see feeds.json / verify_feeds.py). Entries are illustrative
        # basis points in time, since nothing has been minted yet.
        feeds = json.load(open(os.path.join(HERE, "feeds.json")))["feeds"]
        samples = [
            ("NVDA", 0.42, 1),
            ("SPCX", 0.28, 318),
            ("AAPL", 1.06, 1804),
            ("IONQ", 1.19, 5522),
            ("GME", 1.55, 9310),
            ("TSLA", None, 7781),
        ]
        for i, (tk, ratio, rank) in enumerate(samples, start=1):
            price = feeds[tk]["verified_price_usd"]
            entry = round(price * ratio, 2) if ratio else None
            svg = render_card(cfg, registry, i, tk, entry, price if ratio else None, rank)
            open(os.path.join(args.out, f"{tk}.svg"), "w").write(svg)
        print(f"gallery -> {args.out} (current prices are live feed values)")
    else:
        svg = render_card(cfg, registry, 1, args.ticker, args.entry, args.price, args.rank)
        path = os.path.join(args.out, f"{args.ticker}.svg")
        open(path, "w").write(svg)
        print(path)
