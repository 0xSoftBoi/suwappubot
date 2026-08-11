#!/usr/bin/env python3
"""Build the SuwappuPositions constructor arguments.

Emits deploy_args.json containing, in ONE canonical order — the registry sorted
by symbol — the per-ticker supply caps and the ERC-20 address of each tokenized
equity on Robinhood Chain.

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


def build():
    cfg = json.load(open(os.path.join(HERE, "config.json")))
    registry = load_registry()
    tickers = sorted(registry)
    caps_cfg = cfg["ticker_caps"]

    missing = [t for t in tickers if t not in caps_cfg]
    extra = [t for t in caps_cfg if t not in registry]
    if missing or extra:
        raise SystemExit(f"config.json ticker_caps out of sync — missing {missing}, extra {extra}")

    caps = [caps_cfg[t] for t in tickers]
    tokens = [registry[t][0] for t in tickers]
    total = sum(caps)
    if total != cfg["collection"]["supply"]:
        raise SystemExit(f"caps sum to {total}, expected {cfg['collection']['supply']}")
    if len(tickers) != 96:
        raise SystemExit(f"expected 96 tickers, got {len(tickers)}")
    return tickers, caps, tokens, total


def main():
    tickers, caps, tokens, total = build()
    out = {
        "_comment": "Constructor args for SuwappuPositions. Order = registry sorted by symbol.",
        "ticker_order": tickers,
        "caps": caps,
        "tokens": tokens,
        "supply": total,
        "caps_solidity": "[" + ",".join(str(c) for c in caps) + "]",
        "tokens_solidity": "[" + ",".join(tokens) + "]",
    }
    with open(os.path.join(HERE, "deploy_args.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"{len(tickers)} tickers · caps sum {total} · deploy_args.json written")
    print(f"  first: {tickers[0]} cap={caps[0]} {tokens[0]}")
    print(f"  last:  {tickers[-1]} cap={caps[-1]} {tokens[-1]}")


if __name__ == "__main__":
    main()
