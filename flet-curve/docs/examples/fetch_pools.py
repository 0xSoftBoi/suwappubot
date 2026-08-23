#!/usr/bin/env python3
"""Fetch and rank Curve pools using the Prices API v2.

Dependency-free reference implementation of the approach described in
docs/curve-api.md. Run with:

    python3 docs/examples/fetch_pools.py [chain] [sort]

    sort: volume (default) | tvl | aggregate_apr | base_daily_apr

Two things this demonstrates that the v1 client did not have to:

  * `pagination` is capped at 50, so "all pools" is a paging loop;
  * ordering is done by the server, because a client cannot sort a list it
    has not fully loaded.
"""

import json
import sys
import urllib.request

API = "https://prices.curve.finance/v2"
HEADERS = {"User-Agent": "flet-curve/0.1"}

#: The v2 hard cap; larger values are rejected with a 422.
MAX_PAGE_SIZE = 50
#: Below this the list is mostly abandoned factory pools with no liquidity.
MIN_TVL = 10_000


def get(path, **params):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def chain_id(name):
    for entry in get("/pools/chains/")["data"]:
        if entry["name"] == name:
            return entry["chain_id"]
    raise SystemExit(f"v2 does not cover {name!r}; it has 12 chains, v1 has 21")


def pools(chain, sort_by="volume", limit=None):
    """Page through the list until `limit` rows, or everything matching."""
    cid = chain_id(chain)
    out, page, total = [], 1, None
    while total is None or len(out) < (limit or total):
        payload = get(
            "/pools/",
            chain_id=cid,
            page=page,
            pagination=MAX_PAGE_SIZE,
            sort_by=sort_by,
            sort_direction="desc",
            min_tvl=MIN_TVL,
        )
        total = payload["count"]
        batch = payload["pools"]
        if not batch:
            break
        out.extend(batch)
        page += 1
    return out[:limit] if limit else out, total


def compact(value):
    for cut, suffix in ((1e9, "b"), (1e6, "m"), (1e3, "k")):
        if abs(value) >= cut:
            return f"${value / cut:.2f}{suffix}"
    return f"${value:.2f}"


def main():
    chain = sys.argv[1] if len(sys.argv) > 1 else "ethereum"
    sort_by = sys.argv[2] if len(sys.argv) > 2 else "volume"

    rows, total = pools(chain, sort_by, limit=20)
    print(f"{chain}: {total} pools over ${MIN_TVL:,} TVL, sorted by {sort_by}\n")
    print(
        f'{"POOL":<30}{"COINS":<26}{"TVL":>13}{"VOL 24H":>13}'
        f'{"BASE%":>8}{"CRV% min-max":>17}  REWARDS'
    )
    for p in rows:
        coins = "/".join(c["symbol"] for c in p["coins"])
        rewards = [
            f'{r["apr"]:.1f}% {r["symbol"]}' for r in p.get("extra_rewards_apr") or []
        ]
        if p.get("merkle_apr"):
            rewards.append(f'{p["merkle_apr"]:.1f}% merkle')
        print(
            f'{p["name"][:29]:<30}{coins[:25]:<26}'
            f'{compact(p["tvl_usd"]):>13}{compact(p["trading_volume_24h"]):>13}'
            f'{p["base_weekly_apr"]:>8.2f}'
            f'{p["crv_apr"]:>8.2f}-{p["crv_apr_boosted"]:<8.2f}  {",".join(rewards)}'
        )


if __name__ == "__main__":
    import urllib.parse  # kept local so the imports above read top-down

    main()
