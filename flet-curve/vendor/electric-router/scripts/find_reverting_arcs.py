#!/usr/bin/env python
"""Execute every arc the router offers, and record the ones that refuse.

`get_dy` and `calc_token_amount` are views.  They run a pool's invariant over
its own accounting and never ask whether the coins can move -- so a quote can be
a faithful reading of something nobody can trade.  Nothing short of executing
finds those, and `verify_execution.py` cannot: it measures one arc per pool per
kind and folds every failure into a single "would not run" count, which mixes a
pool that refused with a token the harness could not conjure.

This separates them, because only one of the five is a defect:

    OK          executed, and the output is compared against the view
    REVERT      the view quoted and execution refused        <-- the finding
    NO_QUOTE    the view returned 0; the router never offers it
    UNFUNDED    the harness could not obtain the input token; untested
    NODE_ERROR  the endpoint could not serve the state; untested

The last one earns its place.  Avalanche answered `-32000: missing trie node`
for six arcs of a healthy pool, and counting those as reverts would have banned
it outright.

Every *directed* arc, not one per pool: sBTC is a suspended synth, so
`renBTC/wBTC/sBTC` refuses the three arcs that pay it out and honours the rest.
Banning by pool would throw away six working arcs to stop three.

The universe is the one the router actually offers -- reserves checked, deposit
gates applied -- or the sweep reports arcs nobody is ever given.

    uv run python scripts/find_reverting_arcs.py [chain ...] [--size 0.01]
    uv run python scripts/find_reverting_arcs.py ethereum --out /tmp/eth.json
    uv run python scripts/find_reverting_arcs.py --record        # write facts
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from erouter.core.pools import Dialect
from erouter.core.types import ArcKind, Leg

#: `Error(string)` -- the selector every Vyper `assert ... , "reason"` emits.
ERROR_SELECTOR = "08c379a0"
#: Answers that mean the endpoint failed, not that the pool refused.  Matched
#: only when the EVM never ran -- a boa trace contains gas figures and hex, so
#: a bare "503" matches inside one and mis-filed a real optimism revert.
TRANSPORT_NOISE = ("-32000", "missing trie node", "ConnectionError",
                   "timed out", "Too Many Requests", "HTTP Error 50")
#: What boa puts in the message when the EVM did run and something reverted.
EVM_MARKERS = ("BoaError", "[E]", "user revert", "execution reverted")
#: Our own executor's outer assert; the pool's own reason sits inside it.
OUTER_ASSERT = "leg reverted"


def revert_text(message: str) -> str:
    """The reason string a pool reverted with, dug out of boa's error text.

    boa prints raw returndata as a Python bytes literal, so the reason is
    recoverable without re-running under a tracer.
    """
    found: list[str] = []
    for literal in re.findall(r"b'(?:[^'\\]|\\.)*'", message):
        try:
            raw = ast.literal_eval(literal)
        except Exception:
            continue
        if raw[:4].hex() == ERROR_SELECTOR and len(raw) >= 68:
            length = int.from_bytes(raw[36:68], "big")
            reason = raw[68:68 + length].decode("utf-8", "replace")
            reason = reason.replace("\x00", "").strip()
            if reason:
                found.append(reason)
    # `RouteExecutor` wraps a failed leg in its own assert, so the pool's reason
    # is whichever one is not ours.  Reporting the wrapper would label every
    # finding "leg reverted" and say nothing about why.
    inner = [r for r in found if r != OUTER_ASSERT]
    if inner:
        return inner[0]
    # A custom error carries no string; name its selector so it can be looked up
    # (`0xe450d38c` is ERC20InsufficientBalance, which is how pumpBTC surfaced).
    custom = re.search(r"<(0x[0-9a-fA-F]{8})[0-9a-fA-F]*>", message)
    if custom:
        return f"custom error {custom.group(1)}"
    return OUTER_ASSERT if found else "reverted without a reason"


def arcs_of(pool):
    """Every directed arc this pool offers, as `(kind, i, j)`."""
    n = pool.n_coins
    swap = ArcKind.SWAP_STABLE if pool.dialect is Dialect.STABLE else ArcKind.SWAP_CRYPTO
    out = [(swap, i, j) for i in range(n) for j in range(n) if i != j]
    if pool.lp_token:
        deposit = ArcKind.DEPOSIT_DYN if pool.dynamic_arrays else ArcKind.DEPOSIT_FIXED
        withdraw = (ArcKind.WITHDRAW_STABLE if pool.dialect is Dialect.STABLE
                    else ArcKind.WITHDRAW_CRYPTO)
        if not pool.deposit_gated:
            out += [(deposit, i, i) for i in range(n)]
        out += [(withdraw, j, j) for j in range(n)]
    return out


def sweep(chain_name: str, size: float, quiet: bool,
          only: set[str] | None = None) -> list[dict]:
    import boa

    from erouter.chain import chains as chain_table
    from erouter.chain.facts import FactsCache
    from erouter.dev import config
    from erouter.dev import executor as ex
    from erouter.dev.boa_host import CONTRACT as QUOTER_SRC
    from erouter.dev.boa_host import quoter_client
    from erouter.dev.rpc import JsonRpcTransport
    from erouter.dev.universe import (
        check_reserves_are_real,
        load_pools,
        read_balances,
        resolve_deposit_gates,
        resolve_dialects,
        resolve_lp_tokens,
    )

    chain = chain_table.CHAINS[chain_name]
    rpc = JsonRpcTransport(chain.public_rpc, chain_id=chain.chain_id)
    client = quoter_client(rpc, chain)
    specs = load_pools(chain, min_tvl=10_000.0).pools
    if not specs:
        raise LookupError(f"{chain_name}: empty universe -- nothing was measured")
    resolve_dialects(specs, client, chain)
    read_balances(specs, client, None, chain.chain_id, token_client=client)
    resolve_lp_tokens(specs, client, chain.chain_id, token_client=client)
    list(check_reserves_are_real(specs, client, rpc))
    resolve_deposit_gates(specs, client)
    specs = [p for p in specs if p.balances and any(p.balances)]
    if only:
        specs = [p for p in specs if p.address.lower() in only]
    specs.sort(key=lambda p: -p.tvl_usd)     # so a truncated run still covers value

    facts = FactsCache.load(chain.chain_id, chain.name.lower())
    holders: dict[str, list[str]] = {}
    for pool in specs:
        for coin in pool.coins:
            holders.setdefault(coin.address.lower(), []).append(pool.address)

    ex.fork(config.rpc_url(chain.rpc_attr), rpc.block)
    executor = ex.deploy()
    quoter = boa.loads(QUOTER_SRC.read_text(), name="RouteQuoter")
    print(f"\n=== {chain.name} · block {rpc.block:,} · {len(specs)} pools "
          f"· size {size:.2%} ===", flush=True)

    rows: list[dict] = []
    started = time.perf_counter()
    for pool in specs:
        for kind, i, j in arcs_of(pool):
            if kind.name.startswith("WITHDRAW"):
                token_in, token_out = pool.lp_token, pool.coins[j].address
                dx, li, lj = int(pool.lp_supply * size), 0, j
            elif kind.name.startswith("DEPOSIT"):
                token_in, token_out = pool.coins[i].address, pool.lp_token
                dx, li, lj = int(pool.balances[i] * size), i, 0
            else:
                token_in, token_out = pool.coins[i].address, pool.coins[j].address
                dx, li, lj = int(pool.balances[i] * size), i, j
            if dx <= 0 or not token_in or not token_out:
                continue
            leg = Leg(target=pool.address, kind=kind, i=li, j=lj, n=pool.n_coins,
                      src_slot=0, dst_slot=1, bps=0)
            row = {"chain": chain_name, "pool": pool.address.lower(),
                   "name": (pool.name or "")[:40], "tvl": pool.tvl_usd,
                   "kind": kind.name, "i": li, "j": lj, "dx": dx,
                   "token_in": token_in.lower(), "token_out": token_out.lower(),
                   "known_broken": facts.is_broken(pool.address, kind, li, lj)}
            try:
                view = quoter.quote_route([leg.as_tuple()], dx, 1)
            except Exception as exc:
                row.update(outcome="NO_QUOTE", detail=f"view raised: {str(exc)[:60]}")
                rows.append(row)
                continue
            if not view:
                row.update(outcome="NO_QUOTE", detail="view returned 0")
                rows.append(row)
                continue
            row["view"] = str(view)
            try:
                with boa.env.anchor():
                    who = boa.env.generate_address()
                    boa.env.set_balance(who, 10**20)
                    token = boa.loads_abi(ex.ERC20_ABI).at(token_in)
                    funding = ex.Execution()
                    try:
                        ex._fund(boa, token, who, dx, funding, chain.wrapped,
                                 holders=holders.get(token_in.lower(), []))
                    except Exception as exc:
                        row.update(outcome="UNFUNDED", detail=str(exc)[:90])
                        rows.append(row)
                        continue
                    with boa.env.prank(who):
                        token.approve(executor.address, dx)
                        got = executor.execute_route(
                            [leg.as_tuple()], [token_in, token_out], dx, 1, 0)
            except Exception as exc:
                text = str(exc)
                ran = any(marker in text for marker in EVM_MARKERS)
                if not ran and any(noise in text for noise in TRANSPORT_NOISE):
                    row.update(outcome="NODE_ERROR",
                               detail=" ".join(text.split())[:110])
                else:
                    row.update(outcome="REVERT", detail=revert_text(text)[:110])
                    if not quiet:
                        print(f"  REVERT  {kind.name:16} {li}>{lj} {pool.address} "
                              f"{(pool.name or '')[:24]:26} ${pool.tvl_usd:>12,.0f}  "
                              f"{row['detail'][:52]}", flush=True)
                rows.append(row)
                continue
            row.update(outcome="OK", got=str(got),
                       funded_by_transfer=bool(funding.warnings))
            rows.append(row)
    print(f"  {chain_name}: {len(rows)} arcs in {time.perf_counter() - started:.0f}s",
          flush=True)
    return rows


def record(rows: list[dict], apply: bool) -> int:
    """Write what reverted into `data/facts`, and clear what recovered."""
    from erouter.chain import chains as chain_table
    from erouter.chain.facts import FactsCache

    by_chain: dict[str, list[dict]] = {}
    for row in rows:
        by_chain.setdefault(row["chain"], []).append(row)
    marked_total = 0
    for name, chain_rows in sorted(by_chain.items()):
        chain = chain_table.CHAINS[name]
        cache = FactsCache.load(chain.chain_id, chain.name.lower())

        def key(row, cache=cache):
            return cache.key(row["pool"], int(ArcKind[row["kind"]]), row["i"], row["j"])

        broken = {key(r): (r.get("detail") or "reverted")[:80]
                  for r in chain_rows if r["outcome"] == "REVERT"}
        healthy = {key(r) for r in chain_rows if r["outcome"] == "OK"}
        marked = cache.learn_broken(broken)
        cleared = cache.forget_broken([k for k in list(cache.broken) if k in healthy])
        marked_total += marked
        print(f"  {name:11s} {len(broken):3d} reverting -> {marked} newly broken, "
              f"{cleared} recovered")
        if apply:
            cache.save()
    return marked_total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*", help="chain names (default: all)")
    parser.add_argument("--size", type=float, default=0.01,
                        help="fraction of reserve (or LP supply) to trade")
    parser.add_argument("--out", default="", help="write the raw rows here")
    parser.add_argument("--record", action="store_true",
                        help="write the reverting arcs into data/facts")
    parser.add_argument("--pool", default="",
                        help="comma-separated addresses, to re-test just those")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    from erouter.chain import chains as chain_table

    # Etherlink serves no state overrides and no access lists, so it has no
    # quoter and nothing here can run against it.
    wanted = args.chains or [n for n in chain_table.CHAINS if n != "etherlink"]
    only = {a.strip().lower() for a in args.pool.split(",") if a.strip()} or None
    rows: list[dict] = []
    for name in wanted:
        try:
            rows += sweep(name, args.size, args.quiet, only)
        except Exception as exc:
            print(f"\n  {name}: {type(exc).__name__}: {str(exc)[:140]}", flush=True)

    from collections import Counter
    counts = Counter(r["outcome"] for r in rows)
    print("\n  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=1))
        print(f"  wrote {args.out}")
    if rows:
        print()
        record(rows, args.record)
        if not args.record:
            print("  (dry run -- pass --record to write data/facts)")
    return 1 if counts.get("REVERT") else 0


if __name__ == "__main__":
    raise SystemExit(main())
