"""Find pools that cannot price themselves, on every chain, as blacklist lines.

A pool whose `get_virtual_price()` reverts *and* whose own `get_dy` reverts has
no `D` at the numbers it is holding.  Nothing downstream can quote it, the probe
grid discards its arcs every run, and it goes on being carried at whatever the
index thinks its coins are worth -- `WETH/yETH` at $2,123,962, against 43,294
wei of WETH.

Both calls are needed.  **Every LLAMMA reverts on `get_virtual_price` and every
LLAMMA quotes**, so the first call alone would drop $24M of crvUSD liquidity on
mainnet; the pool is asked for a quote before it is named.

`check_reserves_are_real` runs first, because it already catches most of this
family from the other direction -- a pool reporting balances its coins do not
hold -- and is on the route path already.  What survives it and still fails here
is what this prints.

Not on the route path: `get_virtual_price` solves the invariant, so asking 386
pools costs ~800 ms on the wire, against ~3.5 ms of probes to let the grid
discard the same arcs.  Run it when the universe has moved, paste what it finds
into the chain's `blacklist` in `dev/chains.py`, and say in the comment what was
measured.

    uv run python scripts/find_broken_pools.py [chain ...]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from erouter.chain import chains as chain_table
from erouter.dev.boa_host import quoter_client
from erouter.dev.cli import _rpc_url
from erouter.dev.rpc import JsonRpcTransport
from erouter.dev.universe import (
    check_reserves_are_real,
    check_the_invariant_answers,
    load_pools,
    read_balances,
    resolve_dialects,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*", help="default: every chain in the table")
    parser.add_argument("--block", default="latest")
    parser.add_argument("--min-tvl", type=float, default=10_000.0)
    parser.add_argument("--rpc-url", default=None)
    parser.add_argument("--private", action="store_true")
    args = parser.parse_args()

    found: list[tuple[str, str, str, float]] = []
    for name in args.chains or list(chain_table.CHAINS):
        try:
            chain = chain_table.get(name)
            load = load_pools(chain, min_tvl=args.min_tvl)
            rpc = JsonRpcTransport(_rpc_url(chain, args), block=args.block,
                                   chain_id=chain.chain_id)
            client = quoter_client(rpc, chain)
            resolve_dialects(load.pools, client, chain, use_cache=True)
            read_balances(load.pools, client, None, chain.chain_id, token_client=client)
        except Exception as exc:
            print(f"{name:<12} skipped: {str(exc)[:70]}")
            continue

        # The reserve check first, and its findings are not reported: it already
        # runs on every route, so a pool it drops needs no list.
        check_reserves_are_real(load.pools, client, rpc)
        broken = check_the_invariant_answers(load.pools, client)
        print(f"{name:<12} {len(load.pools):>4} pools, {len(broken)} broken")
        for line in broken:
            print(f"    {line}")
        by_name = {p.name: p for p in load.pools}
        for line in broken:
            pool = by_name.get(line.split(" dropped:")[0])
            if pool is not None:
                found.append((name, pool.address, pool.name, pool.tvl_usd))

    if not found:
        print("\nnothing to blacklist.")
        return 0
    print("\n--- for the chain's `blacklist` in dev/chains.py ---")
    for name, address, pool_name, tvl in found:
        print(f"  # {name}: {pool_name} -- neither its virtual price nor its own")
        print(f"  # get_dy can be computed from what it holds (listed at ${tvl:,.0f})")
        print(f'  "{address}",')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
