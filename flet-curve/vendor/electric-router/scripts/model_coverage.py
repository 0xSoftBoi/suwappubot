#!/usr/bin/env python3
"""What each chain cannot price locally, and what that costs.

Every latency defect found so far showed up here first, and each was found by
accident instead:

  * a wrap leg with no model sent whole routes to the chain, which cost gnosis
    a 172 ms confirmation on every quote
  * lending pools skipped before the exact-model gate, so their probes went to
    the wire
  * an API coin list that invented arcs, which quoted REVERTED and were dropped

The signal for all of them is one number.  `sent_routes` counts candidate routes
the exact models could not walk, and a single unpriceable leg sends the whole
route -- so it goes to the chain, `_chain_was_used` flips, and the quote pays a
round trip it did not need.  `stats.holes` says which leg.

    python scripts/model_coverage.py                 # every chain
    python scripts/model_coverage.py gnosis base     # some of them

Read-only.  Nothing here executes or broadcasts.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from itertools import pairwise

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

from erouter.chain import chains as chain_table  # noqa: E402
from erouter.chain.crypto_lp_params import build_exact_crypto_lp  # noqa: E402
from erouter.chain.exact_probe import ExactQuoterClient  # noqa: E402
from erouter.chain.facts import FactsCache, apply_broken_facts  # noqa: E402
from erouter.chain.lp_params import build_exact_lp  # noqa: E402
from erouter.chain.probe_cache import CachedQuoterClient  # noqa: E402
from erouter.chain.stable_params import build_exact_pools  # noqa: E402
from erouter.chain.tricrypto_params import build_exact_tricrypto  # noqa: E402
from erouter.chain.twocrypto_params import build_exact_twocrypto  # noqa: E402
from erouter.chain.vault_params import build_exact_vaults  # noqa: E402
from erouter.chain.wrappers import build_node_map, build_stake_arcs  # noqa: E402
from erouter.core.pipeline import RoutingError, build_arcs, route  # noqa: E402
from erouter.core.types import ArcKind  # noqa: E402
from erouter.dev import config  # noqa: E402
from erouter.dev.boa_host import override_client  # noqa: E402
from erouter.dev.curve_api import CurveApiError  # noqa: E402
from erouter.dev.rpc import JsonRpcTransport, RpcError  # noqa: E402
from erouter.dev.universe import (  # noqa: E402
    check_reserves_are_real,
    load_pools,
    read_balances,
    resolve_coin_counts,
    resolve_dialects,
    resolve_lp_tokens,
)

VAULTY = (ArcKind.ERC4626_DEPOSIT, ArcKind.ERC4626_REDEEM)


def pairs_for(name: str, specs, limit: int):
    """The Router's own pairs where there are any, else the deepest tokens."""
    path = REPO / "data" / "router-pairs.json"
    decimals = {c.address.lower(): c.decimals for p in specs for c in p.coins}
    rows = []
    if path.exists():
        for row in json.loads(path.read_text()):
            if row.get("chain") != name:
                continue
            src, dst = row["src"].lower(), row["dst"].lower()
            if src in decimals and dst in decimals:
                rows.append((src, dst, int(row["median_amount"] * 10**decimals[src]),
                             f"{row['src_symbol']}->{row['dst_symbol']}"))
    if rows:
        return rows[:limit]

    held: dict[str, tuple] = {}
    for pool in specs:
        for k, coin in enumerate(pool.coins):
            bal = pool.balances[k] if k < len(pool.balances) else 0
            sym = coin.symbol.upper()
            if bal and (sym not in held or bal > held[sym][1]):
                held[sym] = (coin.address.lower(), bal, coin.decimals)
    deep = sorted(held.items(), key=lambda kv: -kv[1][1])[:limit + 1]
    return [(a[0], b[0], max(1, a[1] // 5_000), f"{sa}->{sb}")
            for (sa, a), (sb, b) in pairwise(deep)]


def audit(name: str, limit: int) -> dict:
    chain = chain_table.get(name)
    rpc = JsonRpcTransport(config.rpc_url(chain.rpc_attr), block="latest",
                           chain_id=chain.chain_id)
    base = CachedQuoterClient(override_client(rpc), chain.chain_id, rpc.block)
    specs = load_pools(chain, min_tvl=10_000.0, pool_filters=True).pools
    if not specs:
        print(f"  {name}: no pools above the floor\n")
        return {}

    resolve_coin_counts(specs, base)
    resolve_dialects(specs, base, chain)
    read_balances(specs, base, None, chain.chain_id, token_client=base)
    resolve_lp_tokens(specs, base, chain.chain_id, token_client=base)
    list(check_reserves_are_real(specs, base, rpc))
    facts = FactsCache.load(chain.chain_id, name)
    apply_broken_facts(specs, facts)
    nodes, wrappers = build_node_map(specs, chain, base, facts=facts)
    stake = build_stake_arcs(nodes, chain, base)

    stable = build_exact_pools(specs, base)
    two = build_exact_twocrypto(specs, base)
    tri = build_exact_tricrypto(specs, base)
    with_lp = [p for p in specs if p.lp_token]
    vaults = {a.pool for a in stake if a.kind in VAULTY}
    vaults |= {v.token for v in wrappers.merged_vaults}
    client = ExactQuoterClient(base, stable, two, tri,
                               build_exact_vaults(vaults, base),
                               build_exact_lp(with_lp, stable, base),
                               crypto_lp=build_exact_crypto_lp(with_lp, tri, base))

    arcs, _ = build_arcs(specs, nodes)
    unmodelled = [p for p in specs
                  if any(p.balances)
                  and not (stable.get(p.address.lower()) or two.get(p.address.lower())
                           or tri.get(p.address.lower()))
                  and any(a.pool.lower() == p.address.lower() for a in arcs)]

    routed = failed = 0
    for src, dst, amount, _label in pairs_for(name, specs, limit):
        try:
            route(specs, nodes, client, src_token=src, dst_token=dst,
                  amount_in=amount, extra_arcs=stake)
            routed += 1
        except (RoutingError, Exception):
            failed += 1

    stats = client.stats
    print(f"  {name} @ {rpc.block:,}: {len(specs)} pools, {routed} routed"
          f"{f', {failed} refused' if failed else ''}")
    note = "   <-- every quote pays a confirmation" if stats.sent_routes else ""
    print(f"    routes walked locally {stats.walked}, "
          f"sent to the chain {stats.sent_routes}{note}")
    if stats.holes:
        print("    legs no model could price:")
        for (kind, pool), n in sorted(stats.holes.items(), key=lambda kv: -kv[1]):
            spec = next((p for p in specs if p.address.lower() == pool), None)
            print(f"      {kind:<20}{(spec.name[:26] if spec else pool[:26]):<28}"
                  f"{n:>5} leg(s)")
    if unmodelled:
        print(f"    pools carrying arcs but no exact model: {len(unmodelled)}")
        for p in sorted(unmodelled, key=lambda p: -p.tvl_usd)[:6]:
            print(f"      {p.name[:30]:<32}{p.key:<16}tvl {p.tvl_usd:>12,.0f}")
    print()
    return {"chain": name, "sent_routes": stats.sent_routes,
            "holes": len(stats.holes), "unmodelled": len(unmodelled)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*")
    parser.add_argument("--pairs", type=int, default=6,
                        help="how many pairs to route per chain")
    args = parser.parse_args()

    names = args.chains or [n for n in chain_table.CHAINS if n != "etherlink"]
    rows = []
    for name in names:
        try:
            got = audit(name, args.pairs)
        except (RpcError, CurveApiError, KeyError, OSError) as exc:
            print(f"  {name}: unreachable -- {str(exc)[:60]}\n")
            continue
        if got:
            rows.append(got)

    print("  " + "-" * 58)
    print(f"  {'chain':<12}{'sent to chain':>15}{'hole kinds':>12}{'unmodelled':>12}")
    for row in sorted(rows, key=lambda r: -r["sent_routes"]):
        flag = "  <--" if row["sent_routes"] else ""
        print(f"  {row['chain']:<12}{row['sent_routes']:>15}{row['holes']:>12}"
              f"{row['unmodelled']:>12}{flag}")
    worst = [r["chain"] for r in rows if r["sent_routes"]]
    print(f"\n  {len(worst)} chain(s) pay a confirmation round trip: "
          f"{', '.join(worst) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
