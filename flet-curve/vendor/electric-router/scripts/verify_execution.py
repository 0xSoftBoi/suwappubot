#!/usr/bin/env python3
"""Every view method, against the state-changing twin that will really run.

Quoting asks pools questions with `staticcall`.  Executing moves value.  Where
the two disagree, we publish a number nobody can get -- and Curve has two such
places, both found by this script and neither visible any other way:

* **Legacy `calc_token_amount` is fee-free.**  `add_liquidity` charges
  `fee*n/(4(n-1))` on each coin's imbalance; the view does not.  Up to 22 bp.
* **`remove_liquidity_one_coin` claims admin fees first.**  It runs
  `_claim_admin_fees()` before pricing `dy`, which dilutes or shrinks the pool;
  `calc_withdraw_one_coin` prices against the pool as it stands.  Up to 264 bp.

Both paths run **on the same fork, inside one anchor, after funding**, so they
see byte-identical state.  That matters most for withdrawals: dealing LP tokens
moves `totalSupply`.  The quoter compiled here is the one production
verification uses, so a gap this prints is a gap in the number we publish.

    uv run python scripts/verify_execution.py                    # every chain
    uv run python scripts/verify_execution.py ethereum gnosis
    uv run python scripts/verify_execution.py ethereum --size 0.05
    uv run python scripts/verify_execution.py ethereum --pool 0xbEbc...

Exits non-zero when anything exceeds `--tolerance`.  Forking needs an
unrestricted endpoint, so this reads `networks.py` rather than the committed
scoped one -- the scoped key serves only whitelisted contracts.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from erouter.core.pools import Dialect
from erouter.core.types import ArcKind, Leg

#: Anything below this is integer rounding, not a defect.  Measured: the worst
#: honest rounding across 1,084 mainnet comparisons was 1 wei on an 8-decimal
#: BTC pool, which is 0.0007 bp.
ROUNDING_BP = 0.001


def measure(chain_name: str, size: float, only: set[str] | None, quiet: bool):
    """Every (pool, kind) on one chain: what the view says, what execution pays."""
    import boa

    from erouter.chain import chains as chain_table
    from erouter.dev import config
    from erouter.dev import executor as ex
    from erouter.dev.boa_host import CONTRACT as QUOTER_SRC
    from erouter.dev.boa_host import quoter_client
    from erouter.dev.rpc import JsonRpcTransport
    from erouter.dev.universe import load_pools, read_balances, resolve_dialects, resolve_lp_tokens

    chain = chain_table.CHAINS[chain_name]
    rpc = JsonRpcTransport(chain.public_rpc, chain_id=chain.chain_id)
    client = quoter_client(rpc, chain)
    # Cache-backed, exactly like the CLI.  A raw API call returns *nothing* for
    # several chains at any given moment, and a sweep that prints "0 pools"
    # reads as clean when it means unmeasured -- which is how six chains were
    # first reported as passing when they had not been looked at.
    specs = load_pools(chain, min_tvl=10_000.0).pools
    if only:
        specs = [p for p in specs if p.address.lower() in only]
    if not specs:
        raise LookupError(
            f"{chain_name}: no pools in the universe -- nothing was measured. "
            "The Curve API returns empty for some chains; a cached universe is "
            "what normally covers that, so this means the cache is empty too")
    resolve_dialects(specs, client, chain)
    read_balances(specs, client, None, chain.chain_id, token_client=client)
    resolve_lp_tokens(specs, client, chain.chain_id, token_client=client)
    specs.sort(key=lambda p: -p.tvl_usd)   # so a truncated run still covers value

    ex.fork(config.rpc_url(chain.rpc_attr), rpc.block)
    executor = ex.deploy()
    quoter = boa.loads(QUOTER_SRC.read_text(), name="RouteQuoter")
    if not quiet:
        print(f"\n=== {chain.name} · block {rpc.block:,} · {len(specs)} pools · "
              f"size {size:.2%} of reserve ===", flush=True)

    rows = []
    for _index, pool in enumerate(specs, 1):
        if not pool.balances or not any(pool.balances):
            continue
        swap = (ArcKind.SWAP_STABLE if pool.dialect is Dialect.STABLE
                else ArcKind.SWAP_CRYPTO)
        deposit = ArcKind.DEPOSIT_DYN if pool.dynamic_arrays else ArcKind.DEPOSIT_FIXED
        withdraw = (ArcKind.WITHDRAW_STABLE if pool.dialect is Dialect.STABLE
                    else ArcKind.WITHDRAW_CRYPTO)
        for kind, i, j in ((swap, 0, 1), (deposit, 0, 0), (withdraw, 0, 0)):
            if kind is not swap and not pool.lp_token:
                continue
            if kind is withdraw:
                token_in, token_out = pool.lp_token, pool.coins[j].address
                dx = int(pool.lp_supply * size)
            elif kind is deposit:
                token_in, token_out = pool.coins[i].address, pool.lp_token
                dx = int(pool.balances[i] * size)
            else:
                token_in, token_out = pool.coins[i].address, pool.coins[j].address
                dx = int(pool.balances[i] * size)
            if dx <= 0:
                continue
            leg = Leg(target=pool.address, kind=kind, i=i, j=j, n=pool.n_coins,
                      src_slot=0, dst_slot=1, bps=0)
            try:
                with boa.env.anchor():
                    who = boa.env.generate_address()
                    boa.env.set_balance(who, 10**20)
                    token = boa.loads_abi(ex.ERC20_ABI).at(token_in)
                    ex._fund(boa, token, who, dx, ex.Execution(), chain.wrapped)
                    view = quoter.quote_route([leg.as_tuple()], dx, 1)
                    with boa.env.prank(who):
                        token.approve(executor.address, dx)
                        got = executor.execute_route(
                            [leg.as_tuple()], [token_in, token_out], dx, 1, 0)
            except Exception as exc:
                # Keep the revert reason, not just the exception class.  A
                # third of these are pools that genuinely cannot be traded and
                # the rest are worth looking at, and "23 would not run" cannot
                # tell you which is which.
                detail = " ".join(str(exc).split())
                for marker in ("user revert with reason", "<"):
                    if marker in detail:
                        detail = detail.split(marker)[-1]
                rows.append((pool, kind.name, None, None,
                             f"{type(exc).__name__}: {detail.strip()[:70]}"))
                continue
            if not view or not got:
                continue
            rows.append((pool, kind.name, view, got, None))
            bp = (view / got - 1) * 1e4
            if not quiet and abs(bp) > ROUNDING_BP:
                print(f"  {bp:>+10.4f} bp  {kind.name:17} "
                      f"{(pool.name or pool.address)[:38]:40} "
                      f"${pool.tvl_usd:,.0f}", flush=True)
    return rows


def report(chain_name: str, rows, tolerance: float) -> int:
    """Per-kind summary.  Returns how many measurements exceeded `tolerance`."""
    by_kind: dict[str, list[float]] = {}
    failures: dict[str, int] = {}
    failed = 0
    for _pool, kind, view, got, error in rows:
        if error is not None:
            failed += 1
            failures[f"{kind}: {error}"] = failures.get(f"{kind}: {error}", 0) + 1
            continue
        by_kind.setdefault(kind, []).append((view / got - 1) * 1e4)
    over = []
    print(f"\n  {chain_name}: {sum(len(v) for v in by_kind.values())} measured, "
          f"{failed} would not run")
    print(f"  {'kind':18} {'n':>4} {'wrong':>6} {'worst bp':>11}")
    for kind, values in sorted(by_kind.items()):
        wrong = [v for v in values if abs(v) > ROUNDING_BP]
        worst = max(values, key=abs, default=0.0)
        print(f"  {kind:18} {len(values):>4} {len(wrong):>6} {worst:>+11.4f}")
        over += [v for v in values if abs(v) > tolerance]
    if failures:
        # Not a breach -- a pool that cannot be traded is a fact about the pool
        # -- but an unmeasured surface, and worth naming rather than counting.
        print(f"  {'':18} {'why it would not run':>44}")
        for why, n in sorted(failures.items(), key=lambda kv: -kv[1])[:6]:
            print(f"    {n:>4}x  {why[:80]}")
    return len(over)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*", help="chain names (default: all)")
    parser.add_argument("--size", type=float, default=0.01,
                        help="fraction of reserve (or LP supply) to trade")
    parser.add_argument("--pool", default="",
                        help="comma-separated addresses, to check just those")
    parser.add_argument("--tolerance", type=float, default=1.0,
                        help="exit non-zero if any gap exceeds this many bp")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    from erouter.chain import chains as chain_table

    # Etherlink rejects state overrides and access lists, so it has no quoter
    # and nothing here can run against it.
    wanted = args.chains or [n for n in chain_table.CHAINS if n != "etherlink"]
    only = {a.strip().lower() for a in args.pool.split(",") if a.strip()} or None

    breaches = 0
    for name in wanted:
        try:
            rows = measure(name, args.size, only, args.quiet)
        except LookupError as exc:
            print(f"\n  {exc}")
            breaches += 1                # unmeasured is not the same as clean
            continue
        except Exception as exc:
            print(f"\n  {name}: {type(exc).__name__}: {str(exc)[:100]}")
            breaches += 1
            continue
        breaches += report(name, rows, args.tolerance)
    if breaches:
        print(f"\n  {breaches} measurement(s) past {args.tolerance} bp, or chains "
              f"that could not be measured")
    return 1 if breaches else 0


if __name__ == "__main__":
    raise SystemExit(main())
