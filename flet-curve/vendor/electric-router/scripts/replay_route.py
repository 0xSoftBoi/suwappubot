#!/usr/bin/env python3
"""Quote an earlier block's chosen route at a later block, on chain.

"The quote is worse than half an hour ago" has two very different causes and
one appearance.  Either the pools moved, in which case there is nothing to fix,
or the router stopped finding a route it had already found, in which case there
is.  Comparing the two totals cannot tell them apart, because they are quoted
against different pool states.

Replaying does.  Take the legs the router chose at block A, quote them **at
block B through the same client as B's own answer**, and the market drops out of
the comparison: both numbers now price the same reserves.  If A's path pays more
at B, the router lost a route it had.

That is how the `crvUSD -> sDOLA` regression was found.  At block 25,800,460 the
router quoted 1,417,743.75 while its own answer from 360 blocks earlier,
re-quoted there, paid 1,419,115.19 -- 9.67 bp it had already known how to earn.
The cause was `ExactQuoterClient` zeroing any route that crossed a vault twice;
neither total alone would ever have shown it.

Routes come from the CLI rather than the library, for the same reason
`route_sweep.py` does it: the economics that pick a route -- gas, revert risk,
the leg limit -- live there, and a library call reproduces them only by
accident.  (Measured: calling `route()` directly with `dst_wei_per_eth` left at
its default makes gas free and returns a 17-leg route the CLI would never ship.)

    uv run python scripts/replay_route.py --from crvUSD --to sDOLA \
        --amount 2000000 --blocks 25797554,25797920,25800460

Every block's winner is replayed at the *last* block and ranked against what the
router chose there.  Exits non-zero if any earlier path wins by more than
`--tolerance`, so it can gate a change that costs route quality.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

TIMEOUT_S = 900


def route_at(chain: str, src: str, dst: str, amount: str, block: int,
             gas_price: str | None) -> dict | None:
    """Run the CLI at one block and hand back its JSON."""
    out = Path(tempfile.mkdtemp()) / "route.json"
    cmd = ["uv", "run", "erouter", "route", "--chain", chain,
           "--from", src, "--to", dst, "--amount", amount,
           "--block", str(block), "--json", str(out)]
    if gas_price is not None:
        cmd += ["--gas-price", gas_price]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None
    return json.loads(out.read_text()) if out.exists() else None


def legs_of(payload: dict):
    """`(legs, dst_slot, amount_in)` rebuilt from the JSON.

    A conversion leg carries no `i`/`j` -- there is no arc behind it -- and the
    quoter does not read them for a `previewDeposit`, so zero is faithful.
    """
    from erouter.core.types import ArcKind, Leg

    dst = payload["request"]["dst"].lower()
    slot = next(n["slot"] for n in payload["nodes"] if n["token"].lower() == dst)
    legs = [Leg(target=leg["target"], kind=ArcKind[leg["kind"]],
                i=leg.get("i") or 0, j=leg.get("j") or 0, n=2,
                src_slot=leg["src_slot"], dst_slot=leg["dst_slot"], bps=leg["bps"])
            for leg in payload["legs"]]
    return legs, slot, int(payload["request"]["amount_in"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chain", default="ethereum")
    parser.add_argument("--from", dest="src", required=True)
    parser.add_argument("--to", dest="dst", required=True)
    parser.add_argument("--amount", required=True)
    parser.add_argument("--blocks", required=True,
                        help="comma-separated; the last one is where all are quoted")
    parser.add_argument("--gas-price", default=None, help="gwei; live if omitted")
    parser.add_argument("--tolerance", type=float, default=1.0,
                        help="bp an earlier path may win by before this fails")
    args = parser.parse_args()

    blocks = [int(b) for b in args.blocks.split(",") if b.strip()]
    if len(blocks) < 2:
        print("  need at least two blocks: one to learn a route, one to test it")
        return 2
    target = blocks[-1]

    found = {}
    for block in blocks:
        payload = route_at(args.chain, args.src, args.dst, args.amount, block,
                           args.gas_price)
        if payload is None or not payload.get("legs"):
            print(f"  block {block:,}: no route")
            continue
        legs, slot, amount = legs_of(payload)
        chose = int(payload["result"].get("verified_out")
                    or payload["result"]["amount_out"])
        found[block] = (legs, slot, amount, chose)
        print(f"  block {block:,}: chose {chose / 1e18:>18,.6f} "
              f"({len(legs)} legs)")

    if target not in found:
        print(f"\n  the target block {target:,} did not route; nothing to compare")
        return 2

    from erouter.chain import chains as chain_table
    from erouter.core.quoter import QuoterClient
    from erouter.dev.cli import _rpc_url
    from erouter.dev.rpc import JsonRpcTransport

    chain = chain_table.CHAINS[args.chain]
    rpc = JsonRpcTransport(
        _rpc_url(chain, argparse.Namespace(rpc=None, block=None, private=True)),
        block=target, chain_id=chain.chain_id)
    client = QuoterClient(rpc, chain.quoter)

    order = list(found)
    amount = found[target][2]
    quoted = client.quote_routes([found[b][0] for b in order],
                                 [amount] * len(order),
                                 [found[b][1] for b in order])
    mine = int(quoted[order.index(target)] or 0)
    print(f"\n  every path, quoted on chain at block {target:,}:")
    worst = 0.0
    for block, value in zip(order, quoted, strict=True):
        value = int(value or 0)
        gap = (value / mine - 1) * 1e4 if mine else float("nan")
        tag = "  <- the router's own choice here" if block == target else ""
        if block != target:
            worst = max(worst, gap)
        print(f"    from block {block:,}: {value / 1e18:>18,.6f}"
              f"  {gap:+8.2f} bp{tag}")

    if worst > args.tolerance:
        print(f"\n  an earlier path beats this block's own choice by {worst:.2f} bp. "
              f"The market is not the explanation -- both were quoted against the "
              f"same reserves -- so a route that was reachable no longer is.")
        return 1
    print(f"\n  no earlier path beats this block's choice by more than "
          f"{args.tolerance:.2f} bp")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
