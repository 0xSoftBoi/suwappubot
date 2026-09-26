#!/usr/bin/env python3
"""Which pairs the Curve Router has actually been asked for, per chain.

A benchmark is only worth reading if it asks the questions users ask.  So the
pairs come from the deployed Router's own transaction history rather than from
whatever the universe happens to make convenient: every `exchange` puts
`address[11] _route` first, so `_route[0]` is the token in and the last non-zero
entry is the token out, whichever of the three overloads was called.

Sizes come from the same place.  `_amount` sits after the route and the swap
params, at a fixed offset, so each pair carries the median amount it was really
traded at -- which is a better benchmark size than a round number somebody
picked, and it is denominated in the right token for free.

    uv run python scripts/router_pairs.py [chain ...] [--pages 4] [--top 6]

Writes `data/router-pairs.json` for `compare_curve.py --from-router` to read.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

#: From the router's own README.  Only the chains the hosted solver serves are
#: listed, because those are the only ones `compare_curve.py` can score against.
ROUTERS = {
    "ethereum": (1, "0x45312ea0eFf7E09C83CBE249fa1d7598c4C8cd4e"),
    "optimism": (10, "0x0DCDED3545D565bA3B19E683431381007245d983"),
    "gnosis": (100, "0x0DCDED3545D565bA3B19E683431381007245d983"),
    "base": (8453, "0x4f37A9d177470499A2dD084621020b023fcffc1F"),
    "arbitrum": (42161, "0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D"),
}
#: `address[11] _route`, then `uint256[5][5] _swap_params`, then `_amount`.
ROUTE_WORDS = 11
AMOUNT_WORD = ROUTE_WORDS + 25
OUT = REPO / "data" / "router-pairs.json"


def _api(chain_id: int, key: str, **params) -> dict:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"https://api.etherscan.io/v2/api?chainid={chain_id}&{query}&apikey={key}"
    request = urllib.request.Request(url, headers={"User-Agent": "erouter/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    return {}


def _word(data: str, index: int) -> str:
    start = 2 + 8 + index * 64
    return data[start : start + 64]


def decode(data: str) -> tuple[str, str, int] | None:
    """`(token_in, token_out, amount)` from one `exchange` calldata."""
    if len(data) < 2 + 8 + (AMOUNT_WORD + 1) * 64:
        return None
    route = [_word(data, k) for k in range(ROUTE_WORDS)]
    hops = [w for w in route if int(w, 16)]
    if len(hops) < 2:
        return None
    return ("0x" + hops[0][-40:], "0x" + hops[-1][-40:],
            int(_word(data, AMOUNT_WORD), 16))


def _from_explorer(chain_id: int, router: str, key: str, pages: int):
    """`(input, block)` per router call, or `None` if this chain is not free."""
    out = []
    for page in range(1, pages + 1):
        payload = _api(chain_id, key, module="account", action="txlist",
                       address=router, page=page, offset=1000, sort="desc")
        rows = payload.get("result")
        if not isinstance(rows, list):
            return None                    # "not supported for this chain"
        if not rows:
            break
        out += [(tx.get("input") or "", int(tx["blockNumber"]))
                for tx in rows if tx.get("isError") != "1"]
    return out


def _from_chain(name: str, router: str, span: int):
    """The same, from `eth_getLogs`, for chains the free explorer tier omits.

    Every `exchange` pulls the input token in with a `transferFrom`, so a
    Transfer whose `to` is the router names a call; the calldata behind it is
    then read for the route.  Slower and shallower than the explorer, and the
    only way to see optimism and base at all.
    """
    from erouter.chain import chains as chain_table
    from erouter.core.keccak import keccak256
    from erouter.dev import config
    from erouter.dev.rpc import JsonRpcTransport

    chain = chain_table.get(name)
    rpc = JsonRpcTransport(config.rpc_url(chain.rpc_attr), block="latest",
                           chain_id=chain.chain_id)
    topic = "0x" + keccak256(b"Transfer(address,address,uint256)").hex()
    # Base caps a range at 10,000 blocks, so the window is walked rather than
    # asked for whole; the others answer the same request either way.
    step = 10_000
    windows = [(lo, min(lo + step - 1, rpc.block))
               for lo in range(max(0, rpc.block - span), rpc.block, step)]
    logs = []
    for answer in rpc.fetch_multi([
        ("eth_getLogs", [{"fromBlock": hex(lo), "toBlock": hex(hi),
                          "topics": [topic, None,
                                     "0x" + "0" * 24 + router[2:].lower()]}])
        for lo, hi in windows
    ]):
        if isinstance(answer, list):
            logs += answer
    seen: dict[str, int] = {}
    for log in logs:
        seen.setdefault(log["transactionHash"], int(log["blockNumber"], 16))
    answers = rpc.fetch_multi([("eth_getTransactionByHash", [h]) for h in seen])
    return [(tx.get("input") or "", seen[tx["hash"]])
            for tx in answers if isinstance(tx, dict) and tx.get("hash")]


def survey(name: str, key: str, pages: int, top: int, span: int) -> list[dict]:
    from erouter.chain import chains as chain_table
    from erouter.dev.universe import load_pools

    chain_id, router = ROUTERS[name]
    calls = _from_explorer(chain_id, router, key, pages)
    source = "explorer"
    if calls is None:
        calls, source = _from_chain(name, router, span), "eth_getLogs"

    seen: dict[tuple[str, str], list[int]] = defaultdict(list)
    blocks: list[int] = []
    for data, block in calls:
        got = decode(data)
        if got is None:
            continue
        src, dst, amount = got
        if src.lower() == dst.lower() or amount <= 0:
            continue
        seen[(src.lower(), dst.lower())].append(amount)
        blocks.append(block)

    chain = chain_table.get(name)
    load = load_pools(chain, min_tvl=1_000.0 if chain.lite else 10_000.0)
    known: dict[str, tuple[str, int]] = {}
    for pool in load.pools:
        for coin in pool.coins:
            known.setdefault(coin.address.lower(), (coin.symbol, coin.decimals))
    # The native sentinel is a coin of eight mainnet pools and never an ERC20 a
    # route can start from; the router spells it that way and we do not.
    wrapped = (chain.wrapped or "").lower()
    sentinel = chain_table.NATIVE_SENTINEL.lower()

    out = []
    for (src, dst), amounts in sorted(seen.items(), key=lambda kv: -len(kv[1])):
        src = wrapped if src == sentinel else src
        dst = wrapped if dst == sentinel else dst
        if src not in known or dst not in known or src == dst:
            continue
        symbol, decimals = known[src]
        out.append({
            "chain": name, "src": src, "dst": dst,
            "src_symbol": symbol, "dst_symbol": known[dst][0],
            "trades": len(amounts),
            "median_amount": statistics.median(amounts) / 10**decimals,
        })
        if len(out) >= top:
            break
    window = f"blocks {min(blocks):,}-{max(blocks):,}" if blocks else "no history"
    print(f"  {name:<10} {len(seen):>4} pairs in {len(blocks):>5} router trades "
          f"via {source} ({window}); {len(out)} routable here")
    return out


def main() -> int:
    from erouter.dev import config

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*", choices=list(ROUTERS))
    parser.add_argument("--pages", type=int, default=4, help="1,000 txs each")
    parser.add_argument("--top", type=int, default=6, help="pairs kept per chain")
    parser.add_argument("--span", type=int, default=2_000_000,
                        help="blocks of history for the eth_getLogs fallback")
    args = parser.parse_args()

    key = getattr(config.networks(), "ETHERSCAN_API_KEY", "")
    if not key:
        print("ETHERSCAN_API_KEY missing from networks.py")
        return 4

    found: list[dict] = []
    for name in args.chains or list(ROUTERS):
        try:
            found += survey(name, key, args.pages, args.top, args.span)
        except Exception as exc:
            print(f"  {name:<10} skipped: {str(exc)[:70]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(found, indent=1) + "\n")
    print(f"\n  {len(found)} pair(s) -> {OUT}")
    for row in found:
        print(f"    {row['chain']:<10} {row['src_symbol']:>10} -> "
              f"{row['dst_symbol']:<10} {row['trades']:>5} trades   "
              f"median {row['median_amount']:,.4g} {row['src_symbol']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
