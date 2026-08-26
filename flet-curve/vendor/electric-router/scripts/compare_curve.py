#!/usr/bin/env python3
"""Quote the same trades through Curve's own solver and through this one.

Curve's solver answers from a periodically-warmed snapshot rather than from
chain head, so the first thing this does is ask it which block it is on and pin
our side there.  Without that the comparison measures its snapshot age: measured,
the snapshot has run 4-11 blocks behind head, worth 1.8-27.7 bp on ETH pairs and
always in the direction of flattering us.  A row whose block moved under it is
dropped rather than reported.

The hosted deployment serves one host per chain -- `ethereum`, `arbitrum`,
`gnosis`, `base`, `optimism` at `<chain>.router.curve.finance` -- and those five
are the whole comparable set.  A host can be up and still have no universe: it
then answers every pair with "no routes found" and `snapshot_block` 0, which is
reported as a dead deployment rather than as a routing verdict.

Pairs come from each chain's own universe rather than a hardcoded list, so a
chain whose pools move does not quietly stop being tested.  One volatile pair per
chain is quoted too, marked `*` and excluded from the tally.

    python scripts/compare_curve.py [--chain all|ethereum|...] [--sizes 10000,100000]

`--sizes` are amounts of the *source* token and may be fractional, which is what
a token worth more than a dollar needs to be compared at a sane trade size.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from itertools import pairwise
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

#: The hosted deployment, one host per chain.
HOSTED = "https://{chain}.router.curve.finance/quote"
SUPPORTED = ("ethereum", "arbitrum", "gnosis", "base", "optimism")
#: Small, medium, large.  The large end is where it matters: the model's
#: error grows with how much of a pool a leg takes, so a pair that ties at
#: $10k can still diverge at $1M.
DEFAULT_SIZES = (10_000, 100_000, 1_000_000)
#: Sizes are in units of the source token, which is always a stable here, so
#: they read as dollars.  A chain thinner than this simply reports the loss.
TIMEOUT_S = 180
#: Past this the row is not a comparison.  One side has returned something no
#: one would execute -- 21,689 USDC for 200,336 USDai, on a pair the other side
#: routes at 6.6 bp of impact -- and averaging it in would flatter whoever
#: happened to survive.  Set well above an ordinary large-trade gap: 100 bp on a
#: thin pair is a real difference, not a failure.
BLOWOUT_BP = 1_000.0


def ask_curve(api: str, src: str, dst: str, wei: int) -> tuple[dict, float]:
    body = json.dumps({"input_token": src, "output_token": dst,
                       "amount_in": str(wei), "exact": True}).encode()
    # A User-Agent, because the hosted ingress answers 403 to urllib's
    # default one -- the same trap the Curve API sets (E10).
    request = urllib.request.Request(
        api, data=body, headers={"content-type": "application/json",
                                 "User-Agent": "erouter/compare"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        # It answers a routing failure with 404 and a body that says which.
        # Reporting the status code instead reads as "the host is missing".
        body = exc.read()
        try:
            payload = json.loads(body)
        except ValueError:
            raise
    return payload, (time.perf_counter() - started) * 1000


def _resolve(symbol: str, holders: dict) -> str:
    """A symbol or address to an address, preferring the deepest on a clash."""
    wanted = symbol.strip()
    if wanted.lower() in holders:
        return wanted.lower()
    matches = [a for a, (sym, _, _) in holders.items()
               if sym.upper().replace("\u20ae", "T") == wanted.upper()]
    if not matches:
        raise KeyError(f"{symbol!r} is not a coin of any pool in the universe")
    return max(matches, key=lambda a: holders[a][2])


ROUTER_PAIRS = REPO / "data" / "router-pairs.json"

#: Symbols whose price moves against a dollar between the solver's snapshot and
#: our block, which is worth 1.8-27.7 bp and always flatters us.  Their rows are
#: shown and not scored.  Cross-currency counts too: EURe against USDC is a real
#: pair and still not a like-for-like unit.
VOLATILE = {"WETH", "ETH", "WBTC", "CBBTC", "CRV", "CVX", "OP", "GNO", "OSGNO",
            "CBETH", "SUPEROETHB", "YB", "EURE", "WSTETH", "STETH"}


def router_pairs_for(name: str, holders: dict, multiples: tuple[float, ...]):
    """Pairs the deployed Router was really asked for, at what it was asked.

    `scripts/router_pairs.py` writes the file; the size is that pair's median
    router trade, so the benchmark is sized the way the venue actually is.
    """
    if not ROUTER_PAIRS.is_file():
        raise SystemExit("no data/router-pairs.json -- run scripts/router_pairs.py")
    out = []
    for row in json.loads(ROUTER_PAIRS.read_text()):
        if row["chain"] != name:
            continue
        src, dst = row["src"].lower(), row["dst"].lower()
        if src not in holders or dst not in holders:
            continue
        units = {holders[src][0].upper(), holders[dst][0].upper()}
        volatile = bool(units & VOLATILE)
        for multiple in multiples:
            out.append((src, dst, row["median_amount"] * multiple, volatile))
    return out


def pairs_for(chain, pools, sizes: tuple[float, ...], pair: str = ""):
    """(src, dst, amount, volatile) for one chain, from its own universe.

    `pair` names one explicitly as `SRC->DST`, by symbol or address, for asking
    about a pair the curated list does not reach.  A cross-currency pair is
    marked volatile: the row still pins to their block, but the two sides are
    not the same unit and a tally over them would be adding francs to dollars.
    """
    holders: dict[str, tuple[str, int, float]] = {}
    for pool in pools:
        for coin in pool.coins:
            key = coin.address.lower()
            symbol, decimals, tvl = holders.get(key, (coin.symbol, coin.decimals, 0.0))
            holders[key] = (symbol, decimals, tvl + pool.tvl_usd)

    if pair:
        left, _, right = pair.partition("->")
        src, dst = _resolve(left, holders), _resolve(right, holders)
        units = {holders[src][0].upper(), holders[dst][0].upper()}
        crosses = not all("USD" in u.replace("\u20ae", "T") or u == "DAI" for u in units)
        return [(src, dst, size, crosses) for size in sizes], holders

    stables = [s.lower() for s in chain.stables if s.lower() in holders]
    if not stables:
        # Only mainnet carries a curated list; elsewhere the symbol is the
        # evidence available.  Folding U+20AE first catches tac's and xlayer's
        # Tether spelling, and "USD" alone covers USDC, USDT, crvUSD, frxUSD,
        # USDe and the rest without naming any of them.
        stables = [a for a, (symbol, _, _) in holders.items()
                   if "USD" in symbol.upper().replace("\u20ae", "T")
                   or symbol.upper() in {"DAI", "EURE", "EURC.E"}]
    stables.sort(key=lambda a: -holders[a][2])
    out = []
    for size in sizes:
        for src, dst in pairwise(stables[:4]):
            out.append((src, dst, size, False))
    # And one volatile leg, for watching rather than scoring.
    wrapped = chain.wrapped.lower()
    if stables and wrapped in holders:
        out.append((stables[0], wrapped, sizes[0], True))
    return out, holders


def compare_chain(name: str, sizes: tuple[float, ...], rows: list[dict],
                  pair: str = "", from_router: bool = False) -> None:
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
        load_pools,
        read_balances,
        resolve_deposit_gates,
        resolve_dialects,
        resolve_lp_tokens,
    )

    api = HOSTED.format(chain=name)
    chain = chain_table.CHAINS[name]

    # Its block, not ours.  The `eth_call`s below need the private endpoint --
    # the scoped key answers 403 to anything that is not the quoter.
    args = argparse.Namespace(rpc=None, block=None, private=True)
    load = load_pools(chain, min_tvl=10_000.0 if not chain.lite else 1_000.0)
    cases, holders = pairs_for(chain, load.pools, sizes, pair)
    if from_router:
        cases = router_pairs_for(name, holders, sizes)
    if not cases:
        print(f"  {name}: no stable pair in the universe to compare")
        return

    facts = FactsCache.load(chain.chain_id, name)
    bound: dict = {"block": 0}

    def bind(block: int):
        """Our side, at *their* block.

        Rebuilt whenever the snapshot moves, which on mainnet is most rows: a
        12-second block against several seconds per quote means a single pin for
        the whole chain would reject nearly everything.  Balances are the part
        that must be re-read; the pool list and dialects are not block-sensitive.
        """
        if bound["block"] == block:
            return bound
        rpc = JsonRpcTransport(_rpc_url(chain, args), block=block,
                               chain_id=chain.chain_id)
        client = QuoterClient(rpc, chain.quoter)
        resolve_dialects(load.pools, client, chain)
        read_balances(load.pools, client, None, chain.chain_id)
        resolve_lp_tokens(load.pools, client, chain.chain_id)
        # The same three filters the CLI applies, or this compares their router
        # against a universe ours does not offer: a pool holding less than it
        # reports, a deposit behind an allowlist, an arc known to revert.
        # Winning a row on one of those would be winning on a quote nobody can
        # execute, which is the opposite of what this script is for.
        list(check_reserves_are_real(load.pools, client, rpc))
        resolve_deposit_gates(load.pools, client)
        apply_broken_facts(load.pools, facts)
        nodes, _ = build_node_map(load.pools, chain, client, facts=facts)
        stake = (build_stake_arcs(nodes, chain, client)
                 + build_transmuter_arcs(nodes, chain, client))
        local = _local_quoter(rpc, chain, load, nodes, quiet=True)
        # Memoised per block, as the CLI does.  Without it every probe inside
        # `route` is recomputed and the `ms` column reads 1,186 ms on mainnet
        # against the 167 ms a warm quote actually takes -- it would be
        # measuring this script rather than the router.
        bound.update(block=block, nodes=nodes, stake=stake,
                     client=CachedQuoterClient(local or client, chain.chain_id, block))
        return bound

    print(f"  {name}: {len(load.pools)} pools, {len(cases)} cases")

    for src, dst, amount, volatile in cases:
        src_symbol, src_decimals, _ = holders[src]
        dst_symbol, dst_decimals, _ = holders[dst]
        # Sizes are in units of the *source* token, so a token worth more than a
        # dollar needs a fraction of one to be a comparable trade.  Asking for
        # `1,000,000 WBTC` is not a hard routing problem, it is an impossible
        # one, and both routers answer it with noise -- which reads as a 69,045
        # bp win if nobody checks what was asked.
        wei = int(amount * 10**src_decimals)
        shown = f"{amount:,.6g}" if amount != int(amount) else f"{int(amount):,}"
        label = f"{src_symbol}->{dst_symbol} {shown}" + (" *" if volatile else "")
        row = {"chain": name, "case": label, "volatile": volatile}
        try:
            theirs, their_ms = ask_curve(api, src, dst, wei)
        except Exception as exc:
            rows.append(row | {"note": f"solver: {str(exc)[:38]}"})
            continue
        block = int(theirs.get("snapshot_block") or 0)
        their_out = int(theirs.get("expected_out") or 0)
        if block <= 0:
            # Block 0 is not a routing answer.  The deployment has no snapshot,
            # so it says "no routes found" to every pair on the chain -- which
            # reads exactly like a verdict on the pair and is not one.
            rows.append(row | {"note": "solver: no snapshot on this deployment"})
            continue
        if their_out == 0:
            rows.append(row | {"note": f"solver: {theirs.get('error', 'no route')}"[:44]})
            continue
        try:
            here = bind(block)
            client, nodes, stake = here["client"], here["nodes"], here["stake"]
            prepare(load.pools, nodes, client, src_token=src, dst_token=dst,
                    extra_arcs=stake)
            started = time.perf_counter()
            # At the chain's own gas price, which the solver reports.  Quoting
            # with gas free is not a like-for-like comparison: it lets our side
            # spend legs it would never spend in production.
            result = route(load.pools, nodes, client, src_token=src, dst_token=dst,
                           amount_in=wei, extra_arcs=stake,
                           gas_price_wei=int(float(theirs.get("gas_price_gwei") or 0) * 1e9))
        except RoutingError as exc:
            rows.append(row | {"note": f"ours: {str(exc)[:38]}"})
            continue
        our_ms = (time.perf_counter() - started) * 1000
        our_out = result.verified_out or 0
        rows.append(row | {
            "theirs": their_out / 10**dst_decimals,
            "ours": our_out / 10**dst_decimals,
            "bp": (our_out / their_out - 1) * 1e4,
            "legs": f"{theirs.get('legs', 0)}/{len(result.route.legs)}",
            "ms": f"{their_ms:.0f}/{our_ms:.0f}",
            "block": block,
        })


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chain", default="all",
                        help="'all', one chain, or a comma-separated list")
    parser.add_argument("--sizes", default=",".join(str(s) for s in DEFAULT_SIZES))
    parser.add_argument("--pair", default="",
                        help="one pair as SRC->DST, by symbol or address, "
                             "instead of the chain's curated stables")
    parser.add_argument("--from-router", action="store_true",
                        help="quote the pairs the deployed Curve Router was "
                             "really asked for; --sizes become multiples of "
                             "each pair's median router trade")
    args = parser.parse_args()

    sizes = tuple(float(s) for s in args.sizes.split(","))
    wanted = (SUPPORTED if args.chain == "all"
              else tuple(c.strip() for c in args.chain.split(",") if c.strip()))
    rows: list[dict] = []
    for name in wanted:
        try:
            compare_chain(name, sizes, rows, args.pair, args.from_router)
        except Exception as exc:
            print(f"  {name}: failed: {str(exc)[:70]}")

    # Which solver the `ms` column was measured with.  Reported rather than
    # forced: `EROUTER_ACCEL=1` is how production is run and it is 4x on the
    # quote, so a table that does not say leaves its own timings unreadable.
    import os

    from erouter.core import accel

    on = os.environ.get("EROUTER_ACCEL", "") == "1" and accel.available()
    print(f"\n  our solver: {'compiled (rust)' if on else 'python'}"
          f"{'' if on else '  -- set EROUTER_ACCEL=1 for the one production uses'}")
    header = (f"\n  {'chain':<10}{'case':<30}{'curve_solver':>17}{'electric':>17}"
              f"{'diff':>10}{'legs':>7}{'ms t/e':>11}")
    print(header)
    print("  " + "-" * (len(header) - 3))
    better = tied = worse = 0
    for row in rows:
        if "note" in row:
            print(f"  {row['chain']:<10}{row['case']:<30}{row['note']:>58}")
            continue
        bp = row["bp"]
        if not row["volatile"]:
            better += bp > 1
            tied += -1 <= bp <= 1
            worse += bp < -1
        print(f"  {row['chain']:<10}{row['case']:<30}{row['theirs']:>17,.6f}"
              f"{row['ours']:>17,.6f}{bp:>+9.1f}bp{row['legs']:>7}{row['ms']:>11}")
    print(f"\n  scored rows: {better} better, {tied} tied (<1 bp), {worse} worse")
    for name in wanted:
        scored = [r["bp"] for r in rows
                  if r["chain"] == name and "bp" in r and not r["volatile"]
                  and abs(r["bp"]) < BLOWOUT_BP]
        if scored:
            print(f"    {name:<10} {len(scored):>2} rows   "
                  f"mean {sum(scored) / len(scored):+7.2f} bp   "
                  f"worst {min(scored):+7.2f} bp   best {max(scored):+7.2f} bp")
    blown = [r for r in rows if "bp" in r and abs(r["bp"]) >= BLOWOUT_BP]
    if blown:
        print(f"\n  {len(blown)} row(s) past {BLOWOUT_BP:,.0f} bp, kept out of every "
              f"mean: at that distance one side\n  returned a quote nobody would "
              f"sign, so the row measures a failure and not a route.")
        for row in blown:
            print(f"    {row['chain']:<10}{row['case']:<30}"
                  f"{row['theirs']:>17,.6f}{row['ours']:>17,.6f}{row['bp']:>+11.0f}bp")
    print("  * volatile pair, excluded from the tally: its row measures the "
          "solver's snapshot age\n    as much as routing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
