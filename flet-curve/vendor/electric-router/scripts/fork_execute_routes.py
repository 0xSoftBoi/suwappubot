"""Route a spread of pairs, then execute every one through `ElectricRouter`.

`tests/forked/test_router_execution.py` runs four pairs and asserts.  This runs
many and reports, which is the other half: the assertions cannot tell you what
fraction of a venue actually executes, or which leg kinds have never been
through the contract at all.

The bounds are on.  A route that quotes and then trips its own minimum rate is
the thing worth finding, so nothing here relaxes them.  It found one already --
Curve's stETH pools hold raw ether and are paid in `msg.value`, which `get_dy`
prices exactly as it prices anything else.

    uv run python scripts/fork_execute_routes.py --private
    uv run python scripts/fork_execute_routes.py --chain base --source fuzz
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import time

from erouter.chain import chains as chain_table
from erouter.chain.crypto_lp_params import build_exact_crypto_lp
from erouter.chain.exact_probe import ExactQuoterClient
from erouter.chain.facts import FactsCache, apply_broken_facts
from erouter.chain.lp_params import build_exact_lp
from erouter.chain.probe_cache import CachedQuoterClient
from erouter.chain.stable_params import build_exact_pools
from erouter.chain.tricrypto_params import build_exact_tricrypto
from erouter.chain.twocrypto_params import build_exact_twocrypto
from erouter.chain.vault_params import build_exact_vaults
from erouter.chain.wrappers import build_node_map
from erouter.core.keccak import keccak256
from erouter.core.pipeline import RoutingError, build_arcs, route
from erouter.core.pools import parse_universe, volatile_pools
from erouter.core.routecall import EncodingError, encode_route
from erouter.core.types import ArcKind
from erouter.dev import config
from erouter.dev.boa_host import override_client
from erouter.dev.cli import _token_holders
from erouter.dev.curve_api import CurveApi, CurveApiError
from erouter.dev.executor import fork
from erouter.dev.router import deploy, send
from erouter.dev.rpc import JsonRpcTransport, RpcError
from erouter.dev.universe import read_balances, resolve_dialects, resolve_lp_tokens

#: `(from symbol, to symbol, human amount)`, chosen to reach different leg
#: kinds rather than to flatter the router: native both ways, a wrapper, a
#: vault, an LP token, a currency pair, and the plain swaps.  Mainnet symbols.
CURATED = [
    ("USDC", "WETH", 250_000), ("WETH", "USDC", 100),
    ("ETH", "USDC", 100), ("USDC", "ETH", 250_000),
    ("USDC", "USDT", 1_000_000), ("DAI", "USDC", 500_000),
    ("USDT", "DAI", 250_000), ("crvUSD", "WETH", 500_000),
    ("crvUSD", "sDOLA", 500_000), ("USDC", "crvUSD", 250_000),
    ("USDC", "wstETH", 100_000), ("wstETH", "USDC", 30),
    ("stETH", "USDC", 30), ("USDC", "scrvUSD", 100_000),
    ("USDC", "3Crv", 100_000), ("3Crv", "USDT", 100_000),
    ("WBTC", "USDC", 2), ("USDC", "WBTC", 100_000),
    ("USDC", "EURS", 50_000), ("USDC", "tBTC", 100_000),
]

ROUTER_PAIRS = pathlib.Path(__file__).resolve().parents[1] / "data" / "router-pairs.json"


def depths(pools) -> dict[str, tuple[str, int, float, int]]:
    """Every token by address: symbol, decimals, TVL behind it, units held.

    The units are what sizes a trade.  A share of what the venue actually holds
    needs no price for the token, which is the only way to size a pair on a
    chain nobody has curated.
    """
    out: dict[str, tuple[str, int, float, int]] = {}
    for pool in pools:
        for k, coin in enumerate(pool.coins):
            balance = pool.balances[k] if k < len(pool.balances) else 0
            if not balance:
                continue
            key = coin.address.lower()
            symbol, decimals, tvl, held = out.get(
                key, (coin.symbol, coin.decimals, 0.0, 0))
            out[key] = (symbol, decimals, tvl + pool.tvl_usd, held + balance)
    return out


def from_curated(pools, chain) -> list[tuple[str, str, int]]:
    """The hand-written list, resolved to addresses by depth."""
    known = depths(pools)
    by_symbol: dict[str, tuple[str, int]] = {}
    for address, (symbol, decimals, _tvl, _held) in sorted(
            known.items(), key=lambda kv: -kv[1][2]):
        by_symbol.setdefault(symbol.upper(), (address, decimals))
    for pool in pools:
        if pool.lp_token:
            by_symbol.setdefault(pool.name.split()[-1].upper(),
                                 (pool.lp_token.lower(), pool.lp_decimals))
    by_symbol.setdefault(chain.native_symbol.upper(),
                         (chain_table.NATIVE_SENTINEL.lower(), 18))

    out = []
    for src_sym, dst_sym, human in CURATED:
        src, dst = by_symbol.get(src_sym.upper()), by_symbol.get(dst_sym.upper())
        if src and dst:
            out.append((src[0], dst[0], int(human * 10**src[1])))
    return out


def from_router(pools, chain) -> list[tuple[str, str, int]]:
    """Pairs the deployed Router was really asked for, at what it was asked.

    `scripts/router_pairs.py` writes the file.  The size is that pair's median
    trade, so the sweep is sized the way the venue is rather than the way a
    round number looks.
    """
    if not ROUTER_PAIRS.is_file():
        return []
    known = depths(pools)
    out = []
    for row in json.loads(ROUTER_PAIRS.read_text()):
        src, dst = row["src"].lower(), row["dst"].lower()
        if row["chain"] != chain.name or src not in known or dst not in known:
            continue
        # `router_pairs.py` divides by the decimals before writing, so the file
        # is in human units and every amount here has to be put back.
        out.append((src, dst, int(row["median_amount"] * 10**known[src][1])))
    return out


def fuzzed(pools, count: int, seed: int, top: int = 14) -> list[tuple[str, str, int]]:
    """Ordered pairs over the chain's deepest tokens, sized to what they hold.

    Deepest first, because a pair with nothing behind it tests the universe
    filter rather than the router.
    """
    known = depths(pools)
    ranked = sorted(known, key=lambda a: -known[a][2])[:top]
    rng = random.Random(seed)
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str, int]] = []
    attempts = 0
    while ranked and len(out) < count and attempts < count * 40:
        attempts += 1
        src, dst = rng.choice(ranked), rng.choice(ranked)
        if src == dst or (src, dst) in seen:
            continue
        seen.add((src, dst))
        out.append((src, dst, max(1, known[src][3] // 400)))    # 0.25% of holdings
    return out


def sweep(chain, args) -> tuple[int, int, int, set[str], list[str]]:
    """Route and execute every pair for one chain.  Never raises; reports."""
    url = config.rpc_url(chain.rpc_attr) if args.private else chain.public_rpc
    started = time.monotonic()
    try:
        rpc = JsonRpcTransport(url, block=args.block, chain_id=chain.chain_id)
        base = CachedQuoterClient(override_client(rpc), rpc.chain_id, rpc.block)
        specs = parse_universe(CurveApi().list_pools(chain.chain_id,
                                                     min_tvl=args.min_tvl))
    except (RpcError, CurveApiError, OSError) as exc:
        print(f"{chain.name}: unreachable -- {str(exc)[:80]}\n")
        return 0, 0, 0, set(), set(), []
    if not specs:
        print(f"{chain.name}: no pools above the floor\n")
        return 0, 0, 0, set(), set(), []

    resolve_dialects(specs, base, chain)
    read_balances(specs, base, None, chain.chain_id, token_client=base)
    resolve_lp_tokens(specs, base, chain.chain_id, token_client=base)
    # The same arcs `erouter route` withholds.  Without this the sweep offers
    # the solver arcs production never would -- it routed USDC->USDT through a
    # recorded STBT arc, whose transfers are permissioned, and called the
    # revert a finding.  Said out loud, because silently routing around a
    # withheld arc is how a fact stops being visible.
    facts = FactsCache.load(chain.chain_id, chain.name.lower())
    withheld = apply_broken_facts(specs, facts)
    nodes, wrappers = build_node_map(specs, chain, base, facts=facts)
    # The LP models matter here.  A legacy pool's own `calc_token_amount` omits
    # the fee `add_liquidity` charges, so a deposit quoted from the chain is
    # quoted too high and trips its own bound on the way out.
    stable = build_exact_pools(specs, base)
    crypto = build_exact_tricrypto(specs, base)
    with_lp = [p for p in specs if p.lp_token]
    # A vault has no curve, so one ratio per direction prices every size --
    # and without these an ERC4626 leg costs a request and is priced by the
    # chain rather than by the model production uses.  Collected the way
    # `cli.py` collects them: the arcs, plus the vaults merged into nodes,
    # because arcs alone miss the merged ones.
    vault_arcs = {a.pool for a in build_arcs(specs, nodes)[0]
                  if a.kind in (ArcKind.ERC4626_DEPOSIT, ArcKind.ERC4626_REDEEM)}
    vault_arcs |= {v.token for v in wrappers.merged_vaults}
    client = ExactQuoterClient(
        base, stable, build_exact_twocrypto(specs, base), crypto,
        build_exact_vaults(vault_arcs, base),
        lp=build_exact_lp(with_lp, stable, base),
        crypto_lp=build_exact_crypto_lp(with_lp, crypto, base))
    loose = volatile_pools(specs, chain.stables + chain.forex)

    pairs = []
    if args.source in ("auto", "router"):
        pairs = from_router(specs, chain)
    if not pairs and args.source in ("auto", "curated"):
        pairs = from_curated(specs, chain)
    if args.fuzz and (not pairs or args.source in ("auto", "fuzz")):
        pairs += fuzzed(specs, args.fuzz, args.seed)
    known = depths(specs)

    if withheld:
        print(f"  withholding {withheld} arc(s) recorded as unexecutable")
    print(f"{chain.name} block {rpc.block:,}, {len(specs)} pools, "
          f"{len(pairs)} pairs, warmed in {time.monotonic() - started:.0f}s")
    print(f"{'pair':<24}{'legs':>5}  {'kinds':<30}{'drift bp':>10}{'gas':>11}  verdict")

    quoted = []
    for src, dst, amount in pairs:
        label = f"{known[src][0]}->{known[dst][0]}"[:23]
        try:
            quoted.append((label, route(specs, nodes, client, src_token=src,
                                        dst_token=dst, amount_in=amount)))
        except RoutingError as exc:
            quoted.append((label, f"no route: {exc}"))

    fork(url, rpc.block)
    router = deploy()
    # Which router, said out loud.  `deploy` prefers the deployed address and
    # silently compiles a copy where the fork has no code at it -- which is
    # right, and indistinguishable in the results, so a sweep that claims to
    # test the deployment has to show that it did.
    from erouter.core.schema import ROUTER_ADDRESS
    at_deployed = ROUTER_ADDRESS and str(router.address).lower() == ROUTER_ADDRESS.lower()
    print(f"  router {router.address} "
          f"{'(deployed)' if at_deployed else '(compiled here)'}")
    by_address = {p.address.lower(): p for p in specs}
    ok = failed = skipped = 0
    kinds_seen: set[str] = set()
    types_seen: set[str] = set()
    problems: list[str] = []
    for label, result in quoted:
        if isinstance(result, str):
            print(f"{label:<24}{'':>5}  {result[:60]}")
            skipped += 1
            continue
        kinds = sorted({leg.kind.name for leg in result.route.legs})
        kinds_seen |= set(kinds)
        types_seen |= {by_address[leg.target.lower()].key
                       for leg in result.route.legs
                       if leg.target.lower() in by_address}
        short = ",".join(k.split("_")[0].lower()[:6] for k in kinds)[:28]
        try:
            call = encode_route(result.route, receiver="0x" + "11" * 20,
                                volatile=loose, quoted_out=result.verified_out)
        except EncodingError as exc:
            print(f"{label:<24}{len(result.route.legs):>5}  {short:<30}"
                  f"{'':>10}{'':>11}  cannot encode: {exc}")
            problems.append(f"{chain.name} {label}: cannot encode: {exc}")
            failed += 1
            continue
        if call.unbounded:
            weak = ", ".join(str(i) for i in call.unbounded)
            problems.append(f"{chain.name} {label}: legs {weak} carry a bound "
                            f"too coarse to mean anything")
        report = send(call, router=router, quoted_out=result.verified_out,
                      wrapped=chain.wrapped, expect_block=rpc.block,
                      holders=_token_holders(specs, call.token_in,
                                             avoid=result.route.pools_used))
        if not report.ok:
            print(f"{label:<24}{len(result.route.legs):>5}  {short:<30}"
                  f"{'':>10}{'':>11}  FAILED: {report.error[:46]}")
            problems.append(f"{chain.name} {label}: {report.error[:90]}")
            if "minimum rate" in report.error:
                for line in why_the_bound_tripped(result, call, router, chain,
                                                  specs, by_address):
                    print(f"      {line}")
            failed += 1
            continue
        ok += 1
        note = "; ".join(report.warnings)[:52]
        print(f"{label:<24}{len(result.route.legs):>5}  {short:<30}"
              f"{report.drift_bp:>+10.4f}{report.gas:>11,}  ok"
              f"{'  ' + note if note else ''}")
    print(f"  {ok} executed, {failed} failed, {skipped} not routed")
    print(f"  pool types: {', '.join(sorted(types_seen)) or 'none'}\n")
    return ok, failed, skipped, kinds_seen, types_seen, problems


TRANSFER_TOPIC = int.from_bytes(
    keccak256(b"Transfer(address,address,uint256)"), "big")


def why_the_bound_tripped(result, call, router, chain, specs, by_address):
    """Per leg: the size its rate was measured at, against the size it got.

    Taken now rather than later, because the route is not reproducible: the
    shape follows the block, and the next run picks a different one.
    """
    from dataclasses import replace as _replace

    from erouter.core.routecall import leg_in

    loose = _replace(call, params=tuple(_replace(s, min_rate=0).pack()
                                        for s in call.steps()))
    got = send(loose, router=router, quoted_out=result.verified_out,
               wrapped=chain.wrapped,
               holders=_token_holders(specs, call.token_in,
                                      avoid=result.route.pools_used))
    if not got.ok:
        return [f"with the bounds off it still fails: {got.error[:60]}"]

    me = str(router.address).lower()
    moved: dict[str, list[int]] = {}
    for entry in router._computation.get_raw_log_entries():
        address, topics, data = entry[1], entry[2], entry[3]
        if not topics or topics[0] != TRANSFER_TOPIC:
            continue
        token = address.hex() if isinstance(address, bytes) else str(address)
        token = ("0x" + token).lower() if not token.startswith("0x") else token.lower()
        if ("0x" + f"{topics[1]:064x}"[24:]).lower() != me:
            continue
        value = int.from_bytes(data, "big") if isinstance(data, bytes) else int(data)
        moved.setdefault(token, []).append(value)

    out = [f"bounds off: {got.amount_out:,} out ({got.drift_bp:+.4f} bp) -- "
           f"the route is fine, a bound is not"]
    for k, leg in enumerate(result.route.legs):
        queue = moved.get(leg.token_in.lower(), [])
        real = queue.pop(0) if queue else 0
        priced = leg_in(leg)
        if not priced or not real:
            continue
        off = (real / priced - 1) * 1e4
        if abs(off) > 1.0:
            spec = by_address.get(leg.target.lower())
            out.append(f"leg {k} {(spec.name[:24] if spec else leg.target[:24]):<26}"
                       f"priced at {priced:,} handed {real:,} ({off:+.2f} bp)")
    if len(out) == 1:
        out.append("every leg was handed the size it was priced at")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chains", nargs="*", default=None,
                        help="chains to sweep (default: every one configured)")
    parser.add_argument("--block", default="latest")
    parser.add_argument("--min-tvl", type=float, default=10_000.0)
    parser.add_argument("--source", default="auto",
                        choices=("auto", "router", "curated", "fuzz"),
                        help="where pairs come from; auto prefers the Router's "
                             "own history and falls back to the universe")
    parser.add_argument("--fuzz", type=int, default=10,
                        help="how many fuzzed pairs when there is no history")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--private", action="store_true",
                        help="use networks.py; a fork needs it")
    args = parser.parse_args()

    names = args.chains or [n for n in chain_table.CHAINS
                            if config.have_networks()]
    total = [0, 0, 0]
    kinds: set[str] = set()
    types: set[str] = set()
    problems: list[str] = []
    for name in names:
        try:
            chain = chain_table.get(name)
        except KeyError:
            print(f"{name}: unknown chain\n")
            continue
        ok, failed, skipped, seen, seen_types, bad = sweep(chain, args)
        total = [total[0] + ok, total[1] + failed, total[2] + skipped]
        kinds |= seen
        types |= seen_types
        problems += bad

    print(f"across {len(names)} chain(s): {total[0]} executed, {total[1]} failed, "
          f"{total[2]} not routed")
    print(f"leg kinds exercised: {', '.join(sorted(kinds)) or 'none'}")
    print(f"pool types exercised: {', '.join(sorted(types)) or 'none'}")
    for line in problems:
        print(f"  ! {line}")
    return 1 if total[1] else 0


if __name__ == "__main__":
    raise SystemExit(main())
