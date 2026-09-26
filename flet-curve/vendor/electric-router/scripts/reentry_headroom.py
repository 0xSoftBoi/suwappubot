#!/usr/bin/env python3
"""How much does one-arc-per-pool cost, and where?

Decision 3 forbids a route from touching a pool twice, because a view-only
chained quoter cannot see its own earlier leg.  Relaxing it -- per pool *per
pair*, with the pool's state advanced between legs -- is only worth building if
the rule is actually binding and the flow it forbids is worth something, so this
measures both before anything is built.

The solver's own optimum ignores the rule.  Its modelled loss is therefore a
lower bound on achievable loss, i.e. **an upper bound on the prize**: whatever
the repaired winner gives up against it is the most a stateful double-entry
router could recover, and the true figure is strictly below it because the model
prices two arcs of one pool as though they did not interact.

Sizes are swept as a fraction of the source coin's reserve, because that -- not a
dollar amount -- is what decides whether a split is worth taking.

    uv run python scripts/reentry_headroom.py [chain ...]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

#: How many of the chain's deepest tokens to pair up.
TOP_TOKENS = 6

#: Of the source coin's reserve.  The rule cannot bind on a trade too small to
#: want a second pool, and past ~100% every route is catastrophic anyway.
FRACTIONS = (0.01, 0.05, 0.20, 0.50, 1.00)


def study(name: str, rows: list[dict]) -> None:
    from erouter.chain import chains as chain_table
    from erouter.chain.facts import FactsCache
    from erouter.chain.wrappers import build_node_map, build_stake_arcs, build_transmuter_arcs
    from erouter.core.pipeline import prepare
    from erouter.core.quoter import QuoterClient
    from erouter.dev.cli import _local_quoter, _rpc_url
    from erouter.dev.lite import LITE_MIN_TVL
    from erouter.dev.rpc import JsonRpcTransport
    from erouter.dev.universe import load_pools, read_balances, resolve_dialects, resolve_lp_tokens

    chain = chain_table.CHAINS[name]
    args = argparse.Namespace(rpc=None, block=None, private=False)
    floor = LITE_MIN_TVL if chain.lite else 10_000.0
    load = load_pools(chain, min_tvl=floor)
    rpc = JsonRpcTransport(_rpc_url(chain, args), chain_id=chain.chain_id)
    client = QuoterClient(rpc, chain.quoter)
    resolve_dialects(load.pools, client, chain)
    read_balances(load.pools, client, None, chain.chain_id, token_client=client)
    resolve_lp_tokens(load.pools, client, chain.chain_id)
    nodes, _ = build_node_map(load.pools, chain, client,
                              facts=FactsCache.load(chain.chain_id, name))
    stake = (build_stake_arcs(nodes, chain, client)
             + build_transmuter_arcs(nodes, chain, client))
    local = _local_quoter(rpc, chain, load, nodes, quiet=True)
    client = local or client

    # Sweep pairs rather than pick one.  A single auto-picked pair says
    # almost nothing: two coins of one pool trade directly and can never
    # collide, and the first attempt reported the rule binding on 0 of 15
    # cases while it was demonstrably binding on gnosis WXDAI->EURe.  So take
    # the deepest tokens on the chain and route every ordered pair.
    holders: dict[str, tuple] = {}
    for pool in load.pools:
        # Ragged on purpose: `balances` is empty until something reads it.
        for coin, bal in zip(pool.coins, pool.balances, strict=False):
            key = coin.address.lower()
            symbol, decimals, tvl = holders.get(key, (coin.symbol, coin.decimals, 0.0))
            holders[key] = (symbol, decimals, tvl + (pool.tvl_usd if bal else 0.0))
    top = sorted((a for a in holders if holders[a][2] > 0),
                 key=lambda a: -holders[a][2])[:TOP_TOKENS]
    by_address = {c.address.lower(): (c, b)
                  for pool in load.pools
                  for c, b in zip(pool.coins, pool.balances, strict=False)
                  if b}
    print(f"  {name}: {len(load.pools)} pools, {len(top)} tokens, "
          f"{len(top) * (len(top) - 1)} ordered pairs", flush=True)

    for src_addr in top:
        for dst_addr in top:
            if src_addr == dst_addr:
                continue
            src, reserve = by_address[src_addr]
            dst = by_address[dst_addr][0]
            try:
                prepare(load.pools, nodes, client, src_token=src.address,
                        dst_token=dst.address, extra_arcs=stake)
            except Exception:  # an unroutable pair is not a case
                continue
            sweep(name, load, nodes, client, stake, src, dst, reserve, rows)


def sweep(name, load, nodes, client, stake, src, dst, reserve, rows) -> None:
    from erouter.core.candidates import conflicting_pools
    from erouter.core.pipeline import RoutingError, route
    for fraction in FRACTIONS:
        wei = max(1, int(reserve * fraction))
        row = {"chain": name,
               "case": f"{src.symbol}->{dst.symbol} {fraction:.0%}"}
        try:
            result = route(load.pools, nodes, client, src_token=src.address,
                           dst_token=dst.address, amount_in=wei, extra_arcs=stake)
        except RoutingError as exc:
            rows.append(row | {"note": str(exc)[:46]})
            continue
        pool_set = result.candidates
        cands = list(pool_set.candidates) if pool_set else []
        base = next((c for c in cands if c.label == "C0"), None)
        winner = next((c for c in cands if c.rank == 1), None)
        # Which pools the *unrestricted* optimum wanted twice.
        clash = {}
        if base is not None and result.arcs:
            clash = conflicting_pools(result.arcs, base.psi)
        gap = 0.0
        if base is not None and winner is not None:
            gap = (winner.modelled_loss - base.modelled_loss) * 1e4
        rows.append(row | {
            "pools_twice": len(clash),
            "reason": result.certificate_reason or "",
            "ceiling_bp": gap,
            "out": result.verified_out or 0,
            "dec": dst.decimals,
        })


def main(argv: list[str]) -> int:
    from erouter.chain import chains as chain_table
    names = argv or list(chain_table.CHAINS)
    rows: list[dict] = []
    for name in names:
        try:
            study(name, rows)
        except Exception as exc:  # a chain failing is a row
            print(f"  {name}: failed: {str(exc)[:70]}", flush=True)
    header = (f"\n  {'chain':<10}{'case':<34}{'pools 2x':>9}{'certificate':>14}"
              f"{'ceiling':>11}")
    print(header)
    print("  " + "-" * (len(header) - 3))
    binding = 0
    worst = 0.0
    for row in rows:
        if "note" in row:
            print(f"  {row['chain']:<10}{row['case']:<34}{row['note']:>34}")
            continue
        binding += row["pools_twice"] > 0
        worst = max(worst, row["ceiling_bp"])
        print(f"  {row['chain']:<10}{row['case']:<34}{row['pools_twice']:>9}"
              f"{row['reason'][:13]:>14}{row['ceiling_bp']:>9.1f}bp")
    print(f"\n  the rule bound on {binding} of {len([r for r in rows if 'note' not in r])} "
          f"cases; the largest ceiling on relaxing it is {worst:.1f} bp")
    print("  'ceiling' is an upper bound: the unrestricted optimum prices two arcs of\n"
          "  one pool as if they did not interact, so the real prize is below it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
