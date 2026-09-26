#!/usr/bin/env python3
"""Quote what the Curve Router actually executed, at the block before it did.

Ground truth, and it needs nothing but the chain: the calldata says what was
asked -- `address[11] _route` first, `_amount` behind the swap params -- and the
receipt says what was paid, as the last Transfer out of the router in that
token.  We then quote the same trade at `block - 1` and compare.

This is what base and optimism have instead of a benchmark: the hosted solver
answers `no routes found` for every pair on those two chains, so there is
nothing to score against, while their Routers have been trading all along.

Two things the comparison is not.  The route was chosen by whatever front end
sent it, which is usually Curve's own and is not guaranteed to be; and `block-1`
misses whatever else landed in the trade's own block ahead of it.  Both are
stated on every row rather than corrected for.

    uv run python scripts/replay_router_trades.py base [--limit 12] [--span 200000]
"""

from __future__ import annotations

import argparse
import time

# `router_pairs` is a sibling script rather than a module: `scripts/` is not a
# package, and the directory of the script being run is already first on
# `sys.path`, so it needs no help to be found.
from router_pairs import AMOUNT_WORD, ROUTERS, _word, decode

from erouter.core.keccak import keccak256

TRANSFER = "0x" + keccak256(b"Transfer(address,address,uint256)").hex()

#: A fill within this of its own `_min_dy` was taken for everything its
#: slippage allowed.  Calibrated, not guessed: measured slack lands on the
#: front end's tolerance to the second decimal -- +2.00, +3.00, +10.01, +20.04,
#: +30.01, +60.36 bp across 21 trades -- because a healthy fill clears the floor
#: by exactly what the caller left it.  A threshold of 10 bp therefore flagged
#: every tight-tolerance stable trade as a victim; an extractor stops at the
#: floor, so a real one reads ~0.00.
FLOOR_SLACK_BP = 0.5

#: ...and being at the floor is not enough on its own.  A trade can bind on its
#: floor and still be the best available, which is what a row matching us to
#: +0.0 bp means.  A victim is at the floor **and** far below what was there.
VICTIM_GAP_BP = 50.0


def _paid(receipt: dict, router: str, token: str, wrapped: str) -> int:
    """What the router handed the caller, from the receipt's Transfer logs.

    A trade ending in the native token emits no Transfer for the payout -- the
    router unwraps and sends value -- so the wrapped leg into the router is the
    payout, and it is the last one because the unwrap immediately follows.
    """
    router, token, wrapped = router.lower(), token.lower(), wrapped.lower()
    native = token.startswith("0xeeee")
    out = []
    for log in receipt.get("logs", []):
        topics = [t.lower() for t in log.get("topics") or []]
        if len(topics) < 3 or topics[0] != TRANSFER:
            continue
        if log["address"].lower() != (wrapped if native else token):
            continue
        side = topics[2] if native else topics[1]      # to router, or from it
        if side[-40:] == router[2:]:
            out.append(int(log["data"], 16))
    return out[-1] if out else 0


def trades(name: str, span: int, limit: int) -> list[dict]:
    from erouter.chain import chains as chain_table
    from erouter.dev import config
    from erouter.dev.rpc import JsonRpcTransport

    _, router = ROUTERS[name]
    chain = chain_table.get(name)
    rpc = JsonRpcTransport(config.rpc_url(chain.rpc_attr), block="latest",
                           chain_id=chain.chain_id)
    step = 10_000                                  # base caps a range there
    got = []
    for answer in rpc.fetch_multi([
        ("eth_getLogs", [{"fromBlock": hex(lo), "toBlock": hex(min(lo + step - 1, rpc.block)),
                          "topics": [TRANSFER, None,
                                     "0x" + "0" * 24 + router[2:].lower()]}])
        for lo in range(max(0, rpc.block - span), rpc.block, step)
    ]):
        if isinstance(answer, list):
            got += answer
    hashes = list(dict.fromkeys(log["transactionHash"] for log in got))[-limit * 3:]
    if not hashes:
        return []
    txs = rpc.fetch_multi([("eth_getTransactionByHash", [h]) for h in hashes])
    receipts = rpc.fetch_multi([("eth_getTransactionReceipt", [h]) for h in hashes])

    out = []
    for tx, receipt in zip(txs, receipts, strict=True):
        if not isinstance(tx, dict) or not isinstance(receipt, dict):
            continue
        if receipt.get("status") != "0x1":
            continue
        asked = decode(tx.get("input") or "")
        if asked is None:
            continue
        src, dst, amount = asked
        paid = _paid(receipt, router, dst, chain.wrapped or "")
        if paid <= 0:
            continue
        floor = int(_word(tx["input"], AMOUNT_WORD + 1), 16)   # `_min_dy`
        out.append({"hash": tx["hash"], "block": int(tx["blockNumber"], 16),
                    "src": src, "dst": dst, "amount": amount, "paid": paid,
                    "floor": floor,
                    "slack_bp": (paid / floor - 1) * 1e4 if floor else float("inf"),
                    "gas_price": int(tx.get("gasPrice") or "0x0", 16)})
    out.sort(key=lambda r: -r["block"])
    return out[:limit]


def main() -> int:
    from erouter.chain import chains as chain_table
    from erouter.chain.facts import FactsCache, apply_broken_facts
    from erouter.chain.probe_cache import CachedQuoterClient
    from erouter.chain.wrappers import (
        build_node_map,
        build_stake_arcs,
        build_transmuter_arcs,
    )
    from erouter.core.pipeline import RoutingError, prepare, route
    from erouter.core.quoter import QuoterClient
    from erouter.dev.cli import _local_quoter, _rpc_url
    from erouter.dev.rpc import JsonRpcTransport
    from erouter.dev.universe import (
        check_reserves_are_real,
        check_the_invariant_answers,
        load_pools,
        read_balances,
        resolve_deposit_gates,
        resolve_dialects,
        resolve_lp_tokens,
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*", choices=list(ROUTERS))
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--span", type=int, default=200_000)
    args = parser.parse_args()

    rows: list[dict] = []
    for name in args.chains or ["base", "optimism"]:
        chain = chain_table.get(name)
        found = trades(name, args.span, args.limit)
        print(f"  {name}: {len(found)} executed router trade(s) to replay")
        if not found:
            continue
        load = load_pools(chain, min_tvl=1_000.0 if chain.lite else 10_000.0)
        facts = FactsCache.load(chain.chain_id, name)
        symbols = {c.address.lower(): (c.symbol, c.decimals)
                   for p in load.pools for c in p.coins}
        wrapped = (chain.wrapped or "").lower()

        for trade in found:
            src = wrapped if trade["src"].startswith("0xeeee") else trade["src"]
            dst = wrapped if trade["dst"].startswith("0xeeee") else trade["dst"]
            if src not in symbols or dst not in symbols or src == dst:
                continue          # a wrap: both sides fold to the same token
            src_symbol, src_decimals = symbols[src]
            dst_symbol, dst_decimals = symbols[dst]
            shown = trade["amount"] / 10**src_decimals
            row = {"chain": name, "block": trade["block"],
                   "slack_bp": trade["slack_bp"],
                   "case": f"{src_symbol}->{dst_symbol} {shown:,.6g}"}
            # Their block minus one: the state the trade was quoted against,
            # less whatever else landed in the same block ahead of it.
            at = trade["block"] - 1
            try:
                args_ns = argparse.Namespace(rpc=None, block=at, private=True)
                rpc = JsonRpcTransport(_rpc_url(chain, args_ns), block=at,
                                       chain_id=chain.chain_id)
                client = QuoterClient(rpc, chain.quoter)
                resolve_dialects(load.pools, client, chain)
                read_balances(load.pools, client, None, chain.chain_id)
                resolve_lp_tokens(load.pools, client, chain.chain_id)
                list(check_reserves_are_real(load.pools, client, rpc))
                check_the_invariant_answers(load.pools, client)
                resolve_deposit_gates(load.pools, client)
                apply_broken_facts(load.pools, facts)
                nodes, _ = build_node_map(load.pools, chain, client, facts=facts)
                stake = (build_stake_arcs(nodes, chain, client)
                         + build_transmuter_arcs(nodes, chain, client))
                local = _local_quoter(rpc, chain, load, nodes, quiet=True)
                quoter = CachedQuoterClient(local or client, chain.chain_id, at)
                prepare(load.pools, nodes, quoter, src_token=src, dst_token=dst,
                        extra_arcs=stake)
                started = time.perf_counter()
                # At the price the trade itself paid.  Quoting with gas free
                # lets our side spend legs nobody would buy: a $2,200 LBTC->USDT
                # came back over 31 of them.
                result = route(load.pools, nodes, quoter, src_token=src, dst_token=dst,
                               amount_in=trade["amount"], extra_arcs=stake,
                               gas_price_wei=trade["gas_price"])
            except (RoutingError, Exception) as exc:
                rows.append(row | {"note": f"ours: {str(exc)[:44]}"})
                continue
            ours = result.verified_out or 0
            rows.append(row | {
                "theirs": trade["paid"] / 10**dst_decimals,
                "ours": ours / 10**dst_decimals,
                "bp": (ours / trade["paid"] - 1) * 1e4,
                "legs": len(result.route.legs),
                "ms": (time.perf_counter() - started) * 1000,
            })

    header = (f"\n  {'chain':<10}{'block':>12}  {'case':<30}{'executed':>17}"
              f"{'electric':>17}{'diff':>10}{'slack':>9}{'legs':>6}{'ms':>7}")
    print(header)
    print("  " + "-" * (len(header) - 3))
    rows.sort(key=lambda r: (r["chain"], -r["block"]))
    for row in rows:
        if "note" in row:
            print(f"  {row['chain']:<10}{row['block']:>12,}  {row['case']:<30}"
                  f"{row['note']:>50}")
            continue
        slack = row["slack_bp"]
        print(f"  {row['chain']:<10}{row['block']:>12,}  {row['case']:<30}"
              f"{row['theirs']:>17,.8g}{row['ours']:>17,.8g}{row['bp']:>+9.1f}bp"
              f"{slack:>+9.2f}bp"
              f"{row['legs']:>6}{row['ms']:>7,.0f}")
    def suspect(row) -> bool:
        return row["slack_bp"] < FLOOR_SLACK_BP and row["bp"] > VICTIM_GAP_BP

    victims = [r for r in rows if "bp" in r and suspect(r)]
    if victims:
        print(f"\n  {len(victims)} row(s) both bound on their own `_min_dy` and came "
              f"in over {VICTIM_GAP_BP:.0f} bp\n  below what was available -- taken for "
              f"what their slippage allowed, so what they paid\n  is a victim's number "
              f"and not a baseline.  Excluded below:")
        for row in victims:
            print(f"    {row['chain']:<10}{row['case']:<30}{row['theirs']:>17,.8g}"
                  f"{row['ours']:>17,.8g}{row['bp']:>+11.0f}bp")
    scored = [r["bp"] for r in rows if "bp" in r and not suspect(r)]
    if scored:
        better = sum(1 for bp in scored if bp > 1)
        tied = sum(1 for bp in scored if -1 <= bp <= 1)
        print(f"\n  {len(scored)} replayed: {better} better, {tied} within 1 bp, "
              f"{len(scored) - better - tied} worse   "
              f"median {sorted(scored)[len(scored) // 2]:+.1f} bp")
    print("\n  The executed side is whatever route the caller's front end chose, and"
          "\n  `block-1` misses anything that landed in the trade's own block first.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
