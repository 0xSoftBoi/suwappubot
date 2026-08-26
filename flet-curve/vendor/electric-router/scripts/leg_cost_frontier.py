"""What each value of `LEG_COST_BP` gives up, and what it buys.

Gas is already a per-leg price and at any ordinary gas price it settles the
question by itself -- USDC->WETH $10k takes 9 legs at 0.045 gwei, 3 at 5 and 1
at 30.  So this sweeps at a deliberately low gas price, where gas stops
arbitrating and the relaxation is free to take a long tail of branches for a
fraction of a basis point each.  That is the only regime in which the knob
does anything.

Read it as a frontier: for each charge, how many legs the router ends up
taking and how much output it gave up against charging nothing.  A charge is
too high the moment it costs real basis points on the large trades, where extra
legs are worth tens of them.

    uv run python scripts/leg_cost_frontier.py [--gwei 0.045]
"""

from __future__ import annotations

import argparse

from erouter.chain import chains, config
from erouter.chain.facts import FactsCache
from erouter.chain.probe_cache import CachedQuoterClient
from erouter.chain.wrappers import build_node_map, build_stake_arcs
from erouter.core.pipeline import RoutingError, prepare, route
from erouter.dev.boa_host import quoter_client
from erouter.dev.cli import _local_quoter
from erouter.dev.rpc import JsonRpcTransport
from erouter.dev.universe import load_pools, read_balances, resolve_dialects

TOKENS = {
    "USDC": ("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6),
    "USDT": ("0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
    "crvUSD": ("0xf939e0a03fb07f59a73314e73794be0e57ac1b4e", 18),
    "WETH": ("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18),
}
CASES = [
    ("USDC", "WETH", 10_000),
    ("USDC", "WETH", 100_000),
    ("USDC", "WETH", 1_000_000),
    ("USDC", "USDT", 1_000_000),
    ("USDC", "USDT", 20_000_000),
    ("crvUSD", "WETH", 1_000_000),
]
CHARGES = (0.0, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gwei", type=float, default=0.045)
    parser.add_argument("--chain", default="ethereum")
    args = parser.parse_args()

    chain = chains.get(args.chain)
    rpc = JsonRpcTransport(config.rpc_url(chain.rpc_attr), block="latest",
                           chain_id=chain.chain_id)
    setup = CachedQuoterClient(quoter_client(rpc, chain), chain.chain_id, rpc.block)
    load = load_pools(chain, min_tvl=10_000.0)
    resolve_dialects(load.pools, setup, chain)
    read_balances(load.pools, setup)
    nodes, _ = build_node_map(load.pools, chain, setup)
    stake = build_stake_arcs(nodes, chain, setup)
    facts = FactsCache.load(chain.chain_id, chain.name.lower())
    client = _local_quoter(rpc, chain, load, nodes) or setup

    print(f"\nblock {rpc.block:,}   gas {args.gwei} gwei   "
          f"{len(load.pools)} pools")
    header = f"{'case':<24}" + "".join(f"{c:>13}" for c in CHARGES)
    print(f"\n{header}\n{'-' * len(header)}")

    prepared: dict[tuple[str, str], object] = {}
    for src, dst, amount in CASES:
        pair = (src, dst)
        if pair not in prepared:
            prepared[pair] = prepare(
                load.pools, nodes, client, src_token=TOKENS[src][0],
                dst_token=TOKENS[dst][0], extra_arcs=stake,
            )
        cells, baseline = [], None
        for charge in CHARGES:
            try:
                result = route(
                    load.pools, nodes, client,
                    src_token=TOKENS[src][0], dst_token=TOKENS[dst][0],
                    amount_in=int(amount * 10 ** TOKENS[src][1]),
                    prepared=prepared[pair], extra_arcs=stake,
                    gas_price_wei=int(args.gwei * 1e9),
                    gas_table=facts.table(load.pools),
                    risk_table=facts.risk_table(),
                    leg_cost_bp=charge,
                )
            except RoutingError:
                cells.append("     -    ")
                continue
            out = result.verified_out or 0
            if baseline is None:
                baseline = out
            given_up = (1 - out / baseline) * 1e4 if baseline else 0.0
            cells.append(f"{len(result.route.legs):>3}L {given_up:+7.2f}")
        print(f"{f'{src}->{dst} {amount:,}':<24}" + "".join(f"{c:>13}" for c in cells))

    print("\n   `NL -x.xx` = legs taken, and basis points given up against "
          "charging nothing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
