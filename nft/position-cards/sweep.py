#!/usr/bin/env python3
"""Drive all 10,000 position cards through render + metadata + validation.

    python3 nft/position-cards/sweep.py --plan        # show the graph
    python3 nft/position-cards/sweep.py               # advance ONE shard, then stop
    python3 nft/position-cards/sweep.py --all         # run every remaining shard
    python3 nft/position-cards/sweep.py --reset       # start over

One invocation advances one shard and exits, so `/loop` can chew through the
collection a shard at a time and each tick reports real progress. State lives in
`.sweep/state.json`; killing a run mid-shard costs that shard, not the sweep.

WHAT THIS IS NOT: a pre-rendered art drop. Token -> ticker is chosen by the
minter and the entry price is stamped on-chain at mint, so token #4,213's card
cannot be known before someone mints it — and freezing an image would freeze the
P&L, which is the exact failure this collection was redesigned away from. What
CAN be settled ahead of the mint is that the renderer is correct and total: the
sweep walks a deterministic corpus covering every ticker, every grade boundary,
every badge edge and the unpriced path, and proves each card is well-formed,
deterministic, and compliant. That is the part a 10k mint can actually fail on.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from graph import Graph  # noqa: E402
from render import (  # noqa: E402
    COMPOSITIONS,
    ENGRAVINGS,
    INKS,
    badge_for,
    build_metadata,
    card_traits,
    grade_for,
    load_config,
    load_registry,
    render_card,
    sector_of,
)

SUPPLY = 4_444
SHARD = 500
STATE_DIR = os.path.join(HERE, ".sweep")
STATE = os.path.join(STATE_DIR, "state.json")
MANIFEST = os.path.join(STATE_DIR, "manifest.jsonl")

# Language that would turn a collectible into a claim on a real security. The
# compliance line in config.json says these cards are NOT equity and confer no
# rights; if the renderer ever emits one of these next to a ticker, the artwork
# is making a promise the project cannot keep.
FORBIDDEN = re.compile(
    r"\b(shares? of|shareholder|equity stake|dividend[s]? paid to you|"
    r"ownership (?:of|in) (?:the )?compan|your stock|redeemable for)\b",
    re.I,
)


# ── nodes ────────────────────────────────────────────────────────────────────


def n_config(_):
    return load_config()


def n_registry(_):
    return load_registry()


def n_allocation(inp):
    """Token id -> ticker, honouring the per-ticker caps the contract enforces.

    Deliberately deterministic and cap-exact: `tickerCap[i]` is a hard on-chain
    limit, so a corpus that oversells a ticker would be testing a state the
    contract can never reach. Interleaved rather than blocked, so any shard of
    500 sees many tickers instead of one.
    """
    args = json.load(open(os.path.join(HERE, "deploy_args.json")))
    order, caps = args["ticker_order"], args["caps"]
    if sum(caps) != SUPPLY:
        raise SystemExit(f"caps sum to {sum(caps)}, not {SUPPLY}")
    remaining = dict(zip(order, caps))
    out = []
    while len(out) < SUPPLY:
        placed = False
        for tk in order:
            if remaining[tk] > 0:
                out.append(tk)
                remaining[tk] -= 1
                placed = True
                if len(out) == SUPPLY:
                    break
        if not placed:  # unreachable while caps sum to SUPPLY; loud, not silent
            raise SystemExit("allocation stalled")
    return out


def n_corpus(inp):
    """Per-token synthetic state, chosen to cover the whole rendering space.

    Rotating through the grade ladder plus explicit boundary values means every
    shard exercises several grades and the sweep as a whole hits each grade's
    exact `min_return_bps` edge — where an off-by-one in `grade_for` lives — as
    well as the unpriced path and both mint-badge cut-offs.
    """
    cfg, alloc = inp["config"], inp["allocation"]
    edges = [g["min_return_bps"] for g in cfg["grades"] if g["min_return_bps"] > -1_000_000]
    ladder = [-9_000, -201, -200, 0, 199, 200, 2_499, 2_500, 9_999, 10_000, 49_999, 50_000]
    ladder += edges + [e - 1 for e in edges]
    rows = []
    for token_id in range(1, SUPPLY + 1):
        ticker = alloc[token_id - 1]
        # Gold is a mint-time fact (Phase.Gold), not derivable from the id, so
        # the corpus assigns it deterministically at the real edition density —
        # every 8th card, ~555 of 4,444 — crossing every grade, the unpriced
        # path and both badge cut-offs, so gold legibility is proven across the
        # whole state space rather than on a hero shot.
        gold = token_id % 8 == 3
        # every 37th card is unpriced: the oracle-outage path is a real state
        # (priceOf returns 0 and the card must render UNPRICED, not blow up)
        if token_id % 37 == 0:
            rows.append({"token_id": token_id, "ticker": ticker, "ret_bps": None, "gold": gold})
            continue
        rows.append(
            {
                "token_id": token_id,
                "ticker": ticker,
                "ret_bps": ladder[token_id % len(ladder)],
                "gold": gold,
            }
        )
    return rows


def _entry_and_price(ret_bps):
    """A stable (entry, price) pair for a target return. Entry is fixed at 100
    so the price carries the whole signal and float error cannot drift the
    grade across its boundary."""
    entry = 100.0
    return entry, round(entry * (1 + ret_bps / 10_000.0), 6)


def render_one(cfg, registry, row):
    """Render + describe one token. Returns (svg, metadata)."""
    tid, ticker = row["token_id"], row["ticker"]
    minted_at = datetime.fromtimestamp(1_700_000_000 + tid * 61, tz=timezone.utc)
    if row["ret_bps"] is None:
        entry = price = None
    else:
        entry, price = _entry_and_price(row["ret_bps"])
    gold = row.get("gold", False)
    svg = render_card(cfg, registry, tid, ticker, entry, price, tid, minted_at, gold=gold)
    meta = build_metadata(cfg, registry, tid, ticker, entry, price, tid, minted_at, gold=gold)
    return svg, meta


# ── validation ───────────────────────────────────────────────────────────────


# Legibility floor, enforced on every plate rather than spot-checked on a
# contact sheet. Long-form generative work has nowhere to hide — a collector
# sees the whole output space, so "95% good, 5% garbage" is not a shipping
# state. 3:1 is the WCAG floor for large text; a hero numeral gets 4:1.
MIN_HERO_CONTRAST = 4.0
MIN_BODY_CONTRAST = 4.5


def validate(cfg, registry, row, svg, meta) -> list:
    """Every way a card can be broken. Returns a list of problem strings."""
    bad = []
    tid, ticker = row["token_id"], row["ticker"]

    # 1. the SVG must actually be XML. An unescaped & in a company name is the
    #    classic way a whole collection renders as a broken-image icon.
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as e:
        return [f"#{tid} svg is not well-formed: {e}"]
    if not root.tag.endswith("svg"):
        bad.append(f"#{tid} root element is {root.tag}, not svg")
    if root.get("viewBox") is None:
        bad.append(f"#{tid} no viewBox — the card will not scale in a wallet")

    # 2. the ticker and company have to be the ones the token actually holds
    company = registry[ticker][2]
    if ticker not in svg:
        bad.append(f"#{tid} ticker {ticker} missing from the card")

    # 3. metadata shape marketplaces rely on
    for key in ("name", "description", "image", "external_url", "attributes"):
        if not meta.get(key):
            bad.append(f"#{tid} metadata missing {key}")
    for url in (meta.get("image", ""), meta.get("external_url", "")):
        if not url.startswith("https://"):
            bad.append(f"#{tid} non-absolute url: {url!r}")
    traits = {a["trait_type"]: a["value"] for a in meta.get("attributes", [])}
    if traits.get("Ticker") != ticker:
        bad.append(f"#{tid} Ticker trait is {traits.get('Ticker')!r}, expected {ticker!r}")
    if traits.get("Company") != company:
        bad.append(f"#{tid} Company trait is {traits.get('Company')!r}, expected {company!r}")
    if traits.get("Sector") != sector_of(cfg, ticker):
        bad.append(f"#{tid} Sector trait disagrees with config.json")
    if traits.get("Mint Rank") != tid:
        bad.append(f"#{tid} Mint Rank trait is {traits.get('Mint Rank')!r}")

    # 4. grade and badge must follow the rules, not the renderer's mood
    if row["ret_bps"] is None:
        if traits.get("Grade") != "Unpriced":
            bad.append(f"#{tid} unpriced card graded {traits.get('Grade')!r}")
        if "Return %" in traits:
            bad.append(f"#{tid} unpriced card reports a return")
    else:
        want = grade_for(cfg, row["ret_bps"])["name"]
        if traits.get("Grade") != want:
            bad.append(f"#{tid} grade {traits.get('Grade')!r} != {want!r} at {row['ret_bps']}bps")
    want_badge = badge_for(cfg, tid)
    if traits.get("Badge") != want_badge:
        bad.append(f"#{tid} badge {traits.get('Badge')!r} != {want_badge!r}")
    want_edition = "Founders' Gold" if row.get("gold") else "Standard"
    if traits.get("Edition") != want_edition:
        bad.append(f"#{tid} edition {traits.get('Edition')!r} != {want_edition!r}")

    # 5. quality floor: every plate must be legible, whatever structural mode
    #    it resolved to. A proof plate struck in a light accent fell to 2.93:1
    #    before this check existed.
    entry, price = (None, None) if row["ret_bps"] is None else _entry_and_price(row["ret_bps"])
    tr = card_traits(cfg, registry, tid, ticker, entry, price, tid, gold=row.get("gold", False))
    if tr["hero_contrast"] < MIN_HERO_CONTRAST:
        bad.append(f"#{tid} hero contrast {tr['hero_contrast']} < {MIN_HERO_CONTRAST}")
    if tr["body_contrast"] < MIN_BODY_CONTRAST:
        bad.append(f"#{tid} body contrast {tr['body_contrast']} < {MIN_BODY_CONTRAST}")
    if tr["engraving"] not in ENGRAVINGS or tr["composition"] not in COMPOSITIONS:
        bad.append(f"#{tid} resolved to an unknown structural mode: {tr}")
    # A losing position must not be able to buy the loudest composition.
    if row["ret_bps"] is not None and row["ret_bps"] < 1000 and tr["composition"] == "field":
        bad.append(f"#{tid} full-bleed on a {row['ret_bps']}bps position")

    # 6. compliance: a collectible must never read as a claim on a real security
    disclaimer = cfg["collection"]["compliance"]
    if disclaimer not in meta["description"]:
        bad.append(f"#{tid} disclaimer missing from description")
    # Scan everything EXCEPT the disclaimer itself — it is the negation of these
    # phrases ("confers no shareholder or voting rights"), so leaving it in makes
    # the check fire on every single card and hide a real hit in the noise.
    blob = f"{meta['name']}\n{meta['description']}\n{svg}".replace(disclaimer, " ")
    hit = FORBIDDEN.search(blob)
    if hit:
        bad.append(f"#{tid} compliance: card says {hit.group(0)!r}")

    return bad


# ── shard driver ─────────────────────────────────────────────────────────────


def load_state():
    if os.path.exists(STATE):
        with open(STATE) as f:
            return json.load(f)
    return {"done": [], "problems": [], "traits": {}, "rendered": 0}


def save_state(st):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, STATE)


def build_graph(workers=4):
    g = Graph(cache_dir=os.path.join(STATE_DIR, "cache"), workers=workers)
    g.node("config", deps=[], fn=n_config)
    g.node("registry", deps=[], fn=n_registry)
    g.node("allocation", deps=[], fn=n_allocation)
    g.node("corpus", deps=["config", "allocation"], fn=n_corpus)
    # Terminal node so `run` materialises the registry too — asking for "corpus"
    # alone would leave it unresolved, since corpus does not depend on it.
    g.node(
        "inputs",
        deps=["config", "registry", "corpus"],
        fn=lambda inp: {"tickers": len(inp["registry"]), "tokens": len(inp["corpus"])},
    )
    return g


def run_shard(cfg, registry, corpus, index: int, st: dict) -> dict:
    lo, hi = index * SHARD, min((index + 1) * SHARD, SUPPLY)
    rows = corpus[lo:hi]
    problems, seen_hashes = [], {}
    traits = st.setdefault("traits", {})
    lines = []
    for row in rows:
        svg, meta = render_one(cfg, registry, row)
        problems += validate(cfg, registry, row, svg, meta)
        # determinism: the same inputs must produce byte-identical output, or the
        # image a marketplace cached will not match the one the next fetch serves
        svg2, _ = render_one(cfg, registry, row)
        if svg != svg2:
            problems.append(f"#{row['token_id']} render is not deterministic")
        digest = hashlib.sha256(svg.encode()).hexdigest()[:16]
        seen_hashes[digest] = seen_hashes.get(digest, 0) + 1
        for a in meta["attributes"]:
            if a["trait_type"] in ("Ticker", "Sector", "Grade", "Badge"):
                key = f"{a['trait_type']}:{a['value']}"
                traits[key] = traits.get(key, 0) + 1
        e, pr = (None, None) if row["ret_bps"] is None else _entry_and_price(row["ret_bps"])
        tr = card_traits(cfg, registry, row["token_id"], row["ticker"], e, pr, row["token_id"])
        for k in ("engraving", "composition", "ink"):
            traits[f"{k}:{tr[k]}"] = traits.get(f"{k}:{tr[k]}", 0) + 1
        if tr["proof"]:
            traits["proof:yes"] = traits.get("proof:yes", 0) + 1
        lines.append(
            json.dumps(
                {
                    "token_id": row["token_id"],
                    "ticker": row["ticker"],
                    "ret_bps": row["ret_bps"],
                    "grade": next(
                        a["value"] for a in meta["attributes"] if a["trait_type"] == "Grade"
                    ),
                    "svg_sha256_16": digest,
                    "svg_bytes": len(svg),
                }
            )
        )
    # identical bytes for two different tokens means the id/rank never reached
    # the canvas — every card carries its own rank, so collisions are a bug
    dupes = sum(c - 1 for c in seen_hashes.values() if c > 1)
    if dupes:
        problems.append(f"shard {index}: {dupes} cards are byte-identical to another")

    os.makedirs(STATE_DIR, exist_ok=True)
    with open(MANIFEST, "a") as f:
        f.write("\n".join(lines) + "\n")
    return {"index": index, "range": [lo + 1, hi], "problems": problems, "count": len(rows)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="print the graph and exit")
    ap.add_argument("--all", action="store_true", help="run every remaining shard")
    ap.add_argument("--reset", action="store_true", help="discard progress")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    if args.reset:
        for p in (STATE, MANIFEST):
            if os.path.exists(p):
                os.remove(p)
        print("sweep state cleared")

    g = build_graph(args.workers)
    if args.plan:
        for name, deps, depth in g.describe("inputs"):
            print(f"  {'  ' * depth}{name}" + (f"  <- {', '.join(deps)}" if deps else ""))
        print(f"\n  shards: {SUPPLY // SHARD} x {SHARD} tokens")
        return 0

    out = g.run("inputs")
    cfg, registry, corpus = out["config"], out["registry"], out["corpus"]
    print(f"graph: {g.stats['ran']} ran, {g.stats['cached']} cached, {g.stats['seconds']}s")

    st = load_state()
    total_shards = (SUPPLY + SHARD - 1) // SHARD
    pending = [i for i in range(total_shards) if i not in st["done"]]
    if not pending:
        print(f"sweep complete — {st['rendered']}/{SUPPLY} cards, {len(st['problems'])} problems")
        return 1 if st["problems"] else 0

    todo = pending if args.all else pending[:1]
    for index in todo:
        res = run_shard(cfg, registry, corpus, index, st)
        st["done"].append(index)
        st["rendered"] += res["count"]
        st["problems"] += res["problems"]
        save_state(st)
        mark = "ok" if not res["problems"] else f"{len(res['problems'])} PROBLEMS"
        print(f"shard {index:>2} tokens {res['range'][0]:>5}-{res['range'][1]:<5} {mark}")
        for p in res["problems"][:10]:
            print(f"    ! {p}")

    left = total_shards - len(st["done"])
    print(f"\n{st['rendered']}/{SUPPLY} cards rendered, {left} shard(s) left")
    if st["problems"]:
        print(f"{len(st['problems'])} problems so far")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
