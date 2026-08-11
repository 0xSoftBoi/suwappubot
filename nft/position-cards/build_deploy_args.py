#!/usr/bin/env python3
"""Build the SuwappuPositions constructor arguments.

Emits deploy_args.json containing, in ONE canonical order — the PRICED tickers
sorted by symbol — the per-ticker supply caps, the ERC-20 address of each
tokenized equity, and its Chainlink aggregator on Robinhood Chain.

Only the 35 tickers with a live Chainlink feed are included (see feeds.json); a
position on an unpriced ticker could never show a return.

That ordering is load-bearing: the contract stores traits as a ticker INDEX, and
positions_service.ticker_index() resolves a symbol the same way. If the two ever
disagree, every card points at the wrong company. tests/test_positions_collection.py
asserts they match.

Run:  python3 nft/position-cards/build_deploy_args.py
"""

import ast
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))


def load_registry() -> dict:
    src = open(os.path.join(REPO, "bot", "config", "tokens.py")).read()
    m = re.search(
        r"ROBINHOOD_EQUITIES: dict\[str, tuple\[str, int, str\]\] = (\{.*?\n\})", src, re.S
    )
    if not m:
        raise SystemExit("ROBINHOOD_EQUITIES not found in bot/config/tokens.py")
    return ast.literal_eval(m.group(1))


def load_feeds() -> dict:
    with open(os.path.join(HERE, "feeds.json")) as f:
        return json.load(f)["feeds"]


def build():
    """Canonical order = the PRICED tickers, sorted by symbol.

    Only tickers with a live Chainlink feed are included: a position on an
    unpriced ticker could never show a return.
    """
    cfg = json.load(open(os.path.join(HERE, "config.json")))
    registry = load_registry()
    feeds = load_feeds()
    caps_cfg = cfg["ticker_caps"]

    tickers = sorted(feeds)
    for t in tickers:
        if t not in registry:
            raise SystemExit(f"{t} has a feed but is not in ROBINHOOD_EQUITIES")
        if feeds[t]["token"].lower() != registry[t][0].lower():
            raise SystemExit(f"{t} feed token {feeds[t]['token']} != registry {registry[t][0]}")
    if sorted(caps_cfg) != tickers:
        missing = [t for t in tickers if t not in caps_cfg]
        extra = [t for t in caps_cfg if t not in feeds]
        raise SystemExit(f"config ticker_caps out of sync — missing {missing}, extra {extra}")

    caps = [caps_cfg[t] for t in tickers]
    tokens = [registry[t][0] for t in tickers]
    aggregators = [feeds[t]["aggregator"] for t in tickers]
    total = sum(caps)
    if total != cfg["collection"]["supply"]:
        raise SystemExit(f"caps sum to {total}, expected {cfg['collection']['supply']}")
    if len(tickers) != 35:
        raise SystemExit(f"expected 35 priced tickers, got {len(tickers)}")
    return tickers, caps, tokens, total, aggregators


def main():
    tickers, caps, tokens, total, aggregators = build()
    out = {
        "_comment": (
            "Constructor args for SuwappuPositions plus setFeeds() args for "
            "RobinhoodChainlinkOracle. Order = PRICED tickers sorted by symbol, and it is "
            "load-bearing: the contract stores a ticker INDEX and "
            "position_cards_service.ticker_index() must resolve identically."
        ),
        "ticker_order": tickers,
        "caps": caps,
        "tokens": tokens,
        "aggregators": aggregators,
        "supply": total,
    }
    with open(os.path.join(HERE, "deploy_args.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"{len(tickers)} priced tickers · caps sum {total} · deploy_args.json written")
    print(f"  first: {tickers[0]} cap={caps[0]} token={tokens[0]} feed={aggregators[0]}")
    print(f"  last:  {tickers[-1]} cap={caps[-1]} token={tokens[-1]} feed={aggregators[-1]}")


if __name__ == "__main__":
    main()
