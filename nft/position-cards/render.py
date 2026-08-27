#!/usr/bin/env python3
"""Suwappu Positions — live position-card renderer, drawn as pixel art.

A card is drawn from REAL state only: the ticker you chose, the entry price
stamped on-chain when you minted, and the current oracle price. Nothing here
invents price history.

WHY PIXEL ART. Chain 4663's NFT market is a pixel-art market — StonkBrokers,
Robinhood Punks, Gremlin Cartel and Gogh Punks are all pixel PFPs, and they are
the collections with the volume (see docs/research/robinhood-chain-nft-*.md).
The previous engraved-plate design was a beautiful object that did not speak the
chain's language. This does, and the constraints of the medium do real work:

  * The position IS the animal. Up is a bull, down is a bear, flat is a bull
    with its eyes shut. Silhouette carries the whole story at thumbnail size,
    before a single digit is legible.
  * At most 15 colours per card, from one hue-shifted ramp system, so ten
    sector families sort by eye across a marketplace wall.
  * One light, upper-left, on every sprite in the collection.
  * The return is rounded to whole percent. A decimal point costs 6 px of a
    64 px card and tells a collector nothing they cannot read from the animal.

The ticker universe (symbol, ERC-20 address, decimals, company name) is parsed
from bot/config/tokens.py::ROBINHOOD_EQUITIES so the collection cannot drift
from what is tradable on chain 4663.

  python3 nft/position-cards/render.py --gallery        # sample cards -> preview/
  python3 nft/position-cards/render.py --ticker NVDA --entry 100 --price 168 --rank 42
"""

import argparse
import ast
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

# The engine lives beside this file. Insert explicitly: render.py is imported by
# the sweep, by tests and as a script, and only the script case would otherwise
# have this directory on the path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pixelart as pa  # noqa: E402
from pixelart import (
    BG_0,
    BG_1,
    BG_2,
    EDITION,
    GRID_H,
    GRID_W,
    INK_DEEP,
    PATTERNS,
    PX,
    TEXT,
    TEXT_DIM,
    TEXT_HI,
    Canvas,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TOKENS_PY = os.path.join(REPO, "bot", "config", "tokens.py")

W, H = pa.CANVAS_W, pa.CANVAS_H

# Structural axes. A card is one of these creatures, on one of these patterns,
# in one of ten sector palettes, in one of two editions — combinatorial variety
# from a fixed vocabulary rather than a noise field.
CREATURES = ("Bull", "Bear", "Flat", "Dormant")


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


def _seed(ticker: str, token_id: int, entry) -> int:
    """A stable integer derived from what the token actually IS.

    The pattern is not a random trait roll — it is a function of the ticker you
    chose, the rank you minted at, and the basis stamped on-chain. Two cards can
    only share a background if they share all three, and nothing here can be
    rerolled after the fact.
    """
    key = f"{ticker}|{token_id}|{entry if entry else 0}"
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big")


# ── colour measurement (kept: the sweep enforces a legibility floor) ─────────


def _lum(hexcol: str) -> float:
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = pa.hex_to_rgb(hexcol)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    """WCAG contrast ratio between two #rrggbb colours (1.0 to 21.0)."""
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _hue_of(hexcol: str) -> float:
    """The hue of a config colour, so config.json stays the single source.

    Sector and grade colours are authored as hex in config; the palette engine
    wants hues. Deriving rather than duplicating means a designer retunes one
    file and every card follows.
    """
    r, g, b = (v / 255.0 for v in pa.hex_to_rgb(hexcol))
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        return 210.0
    if mx == r:
        h = 60 * (((g - b) / d) % 6)
    elif mx == g:
        h = 60 * ((b - r) / d + 2)
    else:
        h = 60 * ((r - g) / d + 4)
    return h % 360


def _return_text(ret_bps: int, priced: bool) -> str:
    """Whole percent. A decimal point is 6 px of a 64 px card for no gain."""
    if not priced:
        return "NULL"
    pct = ret_bps / 100.0
    sign = "+" if ret_bps >= 0 else "−"
    a = abs(pct)
    if a >= 1000:
        return f"{sign}{round(a / 1000)}K%"
    return f"{sign}{round(a)}%"


# ── the card ────────────────────────────────────────────────────────────────
# 64x80 rows, spent deliberately:
#   0        frame
#   2-39     creature, 38x38 — the card IS the animal
#   42-55    return, 2x
#   57-70    ticker, 2x
#   72-78    serial + chain (1x)
#   79       frame
# The first cut spent 35% of the card on two lines of type and left the animal
# a third of the height; it read as a label with a mascot. The wordmark came off
# the face entirely — it survives in <title> and in the metadata, and at 64px
# the brand is the ART, not five pixels of word. Nor is there room for the grade
# name, which is the right call: the animal, the accent hue and the sign of the
# number already carry it, and the metadata carries it exactly.

ROW_SPRITE = 2
ROW_RETURN = 42
ROW_TICKER = 57
ROW_FOOTER = 72


def _compose(cfg, ticker, entry, price, rank, gold, minted_at=None):
    """Build the bitmap and its palette. Shared by the renderer and the traits
    reader, so the quality gate can never measure a palette the card stopped
    using — that two-implementations-of-one-rule bug keeps recurring here."""
    priced = bool(entry and price and entry > 0)
    ret_bps = int(round((price - entry) / entry * 10_000)) if priced else 0
    grade = grade_for(cfg, ret_bps) if priced else {"name": "Unpriced", "accent": "#8d8577"}
    sector = sector_of(cfg, ticker)
    sector_hue = _hue_of(cfg["sector_colors"].get(sector, "#94a3b8"))
    grade_hue = _hue_of(grade["accent"])
    seed = _seed(ticker, rank, entry)

    palette = pa.build_palette(sector_hue, grade_hue, gold)
    c = Canvas(GRID_W, GRID_H)

    pattern = PATTERNS[(seed >> 24) % len(PATTERNS)]
    pa.paint_background(c, pattern, seed)

    sprite, creature = pa.creature_for(ret_bps, priced)
    c.blit(sprite, (GRID_W - pa.SPR) // 2, ROW_SPRITE)

    # The data half is a solid plate. Type at 1px sitting directly on a 1px
    # pattern shreds both — the pattern into stray fragments, the type into
    # noise — so the card splits cleanly: patterned field with the animal above,
    # a plate carrying the numbers below.
    c.rect(0, ROW_RETURN - 3, GRID_W, GRID_H - (ROW_RETURN - 3), BG_0)
    # inset to clear both frames: a full-width rule had its ends clipped by
    # the gold inner frame, stranding one pixel on each side
    c.rect(2, ROW_RETURN - 3, GRID_W - 4, 1, BG_2)

    # the two things that must survive a 190px thumbnail
    c.text_center(ROW_RETURN, _return_text(ret_bps, priced), TEXT_HI, scale=2, tracking=1)
    c.text_center(ROW_TICKER, ticker, TEXT, scale=2, tracking=1)

    c.text(2, ROW_FOOTER, f"#{rank:04d}", TEXT_DIM)
    chain = f"{cfg['collection']['chain']['chain_id']}"
    c.text(GRID_W - 2 - pa.text_width(chain), ROW_FOOTER, chain, TEXT_DIM)

    # The sprite chops the 1px background patterns into fragments and a few land
    # as single pixels. Repair them inside the background set only — the
    # creature's outline must never be edited by a cleanup pass.
    c.despeckle_within((BG_0, BG_1, BG_2), BG_0)

    # frame last, so nothing can spill past the card edge
    c.frame(0, 0, GRID_W, GRID_H, INK_DEEP, 1)
    if gold:
        c.frame(2, 2, GRID_W - 4, GRID_H - 4, EDITION, 1)

    return (
        c,
        palette,
        {
            "priced": priced,
            "ret_bps": ret_bps,
            "grade": grade,
            "sector": sector,
            "creature": creature,
            "pattern": pattern,
            "seed": seed,
        },
    )


def card_traits(cfg, registry, token_id, ticker, entry, price, rank, gold=False):
    """The structural choices a card resolves to, plus its measured numbers.

    Long-form generative work cannot rely on the artist culling weak outputs — a
    collector sees the entire space. So the sweep enforces a floor on every one
    of the 4,444 rather than trusting a spot check of a contact sheet.
    """
    c, palette, st = _compose(cfg, ticker, entry, price, rank, gold)
    used = c.colors_used()
    return {
        "creature": st["creature"],
        "pattern": st["pattern"],
        "sector": st["sector"],
        "grade": st["grade"]["name"],
        "gold": gold,
        "colors_used": len(used),
        # Typography is excluded: a 5x7 bitmap font legitimately contains
        # single pixels (the waist of a %, the serif of a 1). The constraint is
        # about stray pixels in the ARTWORK, which is what this measures.
        "orphan_pixels": c.count_orphans(
            ignore=(TEXT, TEXT_DIM, TEXT_HI, EDITION),
            ignore_touching=(TEXT, TEXT_DIM, TEXT_HI, EDITION),
        ),
        "hero_contrast": round(contrast(palette[TEXT_HI], palette[BG_0]), 2),
        "body_contrast": round(contrast(palette[TEXT], palette[BG_0]), 2),
    }


def render_card(
    cfg,
    registry,
    token_id: int,
    ticker: str,
    entry: float | None,
    price: float | None,
    rank: int,
    minted_at: datetime | None = None,
    gold: bool = False,
) -> str:
    """Render one position card as pixel art.

    Everything is answerable to the GRID. Almost nobody meets an NFT at full
    size; they meet forty of them at 190px in a marketplace wall. At that size a
    28px creature is about 7px tall, which is exactly why the silhouette — horns
    versus round ears — has to do the work that colour and type cannot.
    """
    _addr, _decimals, company = registry[ticker]
    c, palette, st = _compose(cfg, ticker, entry, price, rank, gold, minted_at)

    # `ticker in svg` is asserted by the sweep and the label is what a screen
    # reader gets; the compliance line rides along as <desc> so the SVG carries
    # the disclaimer even though no 64px card could legibly print it.
    label = f"{ticker} position card"
    body = c.to_svg(palette, PX)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" shape-rendering="crispEdges" role="img" '
        f'aria-label="{esc(label)}">'
        f"<title>{esc(f'{ticker} · {company}')}</title>"
        f"<desc>{esc(cfg['collection']['compliance'])}</desc>"
        f"{body}</svg>"
    )


def build_metadata(cfg, registry, token_id, ticker, entry, price, rank, minted_at=None, gold=False):
    """ERC-721 metadata for a live position. Regenerated on every fetch — the
    return and grade move with the market, so this is deliberately dynamic."""
    addr, decimals, company = registry[ticker]
    priced = bool(entry and price and entry > 0)
    ret_bps = int(round((price - entry) / entry * 10_000)) if priced else 0
    grade = grade_for(cfg, ret_bps) if priced else {"name": "Unpriced"}
    col = cfg["collection"]
    badge = badge_for(cfg, rank)
    _sprite, creature = pa.creature_for(ret_bps, priced)
    seed = _seed(ticker, rank, entry)
    pattern = PATTERNS[(seed >> 24) % len(PATTERNS)]

    attrs = [
        {"trait_type": "Ticker", "value": ticker},
        {"trait_type": "Company", "value": company},
        {"trait_type": "Sector", "value": sector_of(cfg, ticker)},
        {"trait_type": "Grade", "value": grade["name"]},
        {"trait_type": "Creature", "value": creature},
        {"trait_type": "Pattern", "value": pattern.title()},
        {"trait_type": "Mint Rank", "value": rank, "display_type": "number"},
    ]
    if badge:
        attrs.append({"trait_type": "Badge", "value": badge})
    attrs.append({"trait_type": "Edition", "value": "Founders' Gold" if gold else "Standard"})
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

    supply_s = f"{col['supply']:,}"
    disc_key = "gold_discount_fraction" if gold else "hold_discount_fraction"
    disc_pct = int(round(cfg["economics"][disc_key] * 100))
    edition_s = " Struck in the Founders' Gold edition." if gold else ""
    if priced:
        desc = (
            f"A position on {company} ({ticker}) opened on Robinhood Chain at "
            f"${fmt_px(entry)}. Currently ${fmt_px(price)} — "
            f"{'up' if ret_bps >= 0 else 'down'} {abs(ret_bps) / 100:.1f}%. "
            f"The card is drawn as a {creature.lower()}. "
            f"Mint rank {rank} of {supply_s}.{edition_s}\n\n"
            f"The entry price was stamped on-chain at mint and can never change; the "
            f"card re-renders against the live price, so what you see is the call you "
            f"actually made. Holding it takes {disc_pct}% off your "
            f"Suwappu swap fee on the Free, Pro and Premium plans (Enterprise pricing "
            f"is contracted separately).\n\n"
            f"{col['compliance']}"
        )
    else:
        desc = (
            f"A position on {company} ({ticker}) on Robinhood Chain, minted while no "
            f"oracle price was available, so no entry basis was stamped and no return "
            f"is tracked. Mint rank {rank} of {supply_s}.{edition_s}\n\n{col['compliance']}"
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
    ap.add_argument("--gold", action="store_true")
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
            ("NVDA", 0.42, 1, True),
            ("SPCX", 0.28, 318, False),
            ("AAPL", 1.06, 1804, False),
            ("IONQ", 1.19, 3522, False),
            ("GME", 1.55, 4310, True),
            ("TSLA", None, 3781, False),
        ]
        for i, (tk, ratio, rank, gold) in enumerate(samples, start=1):
            price = feeds[tk]["verified_price_usd"]
            entry = round(price * ratio, 2) if ratio else None
            minted = datetime(2026, 8, 1 + (i % 12), 9, 0, tzinfo=timezone.utc)
            svg = render_card(
                cfg, registry, i, tk, entry, price if ratio else None, rank, minted, gold=gold
            )
            open(os.path.join(args.out, f"{tk}.svg"), "w").write(svg)
        print(f"gallery -> {args.out} (current prices are live feed values)")
    else:
        svg = render_card(
            cfg, registry, 1, args.ticker, args.entry, args.price, args.rank, gold=args.gold
        )
        path = os.path.join(args.out, f"{args.ticker}.svg")
        open(path, "w").write(svg)
        print(path)
