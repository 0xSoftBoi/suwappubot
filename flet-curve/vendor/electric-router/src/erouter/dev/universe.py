"""Load the pool universe and resolve each pool's ABI dialect.

Splits cleanly: the Curve API supplies *which pools exist* and a TVL bootstrap,
and the chain supplies every number that enters the solve.  An API outage
therefore degrades to a slightly stale pool list, never to a wrong route.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..chain.cache import UniverseCache
from ..chain.chains import Chain

# The chain-side half lives in `erouter.chain` so a browser can run it, and is
# re-exported here because every caller in this tree asks for the whole of
# universe loading in one import, and which half a name lives in is not their
# business.
from ..chain.universe import (  # noqa: F401
    COIN_PROBE_SLACK,
    DEPOSIT_GATE_FLAG,
    HELD_TOLERANCE,
    DialectAudit,
    arc_refs,
    check_reserves_are_real,
    check_the_invariant_answers,
    count_swap_arcs,
    read_balances,
    resolve_coin_counts,
    resolve_deposit_gates,
    resolve_dialects,
    resolve_lp_tokens,
)
from ..core.pools import Coin, PoolSpec, parse_universe
from ..core.types import Dialect
from . import lite
from .curve_api import DEFAULT_MIN_TVL, CurveApi, CurveApiError


@dataclass(slots=True)
class UniverseLoad:
    pools: list[PoolSpec]
    source: str  # "api" | "cache" | "stale" | "pinned"
    age: float = 0.0
    warnings: list[str] = field(default_factory=list)
    filtered: int = 0

    @property
    def fingerprint(self) -> str:
        """Which pool set this is, in eight characters.

        The pool list comes from an API on a five-minute TTL, so it is the one
        input to a quote that `--block` does not pin.  Two runs that disagree are
        only comparable if this matches.
        """
        import hashlib

        joined = "".join(sorted(p.address.lower() for p in self.pools))
        return hashlib.sha256(joined.encode()).hexdigest()[:8]


def _list_pools(chain: Chain, api: CurveApi, min_tvl: float) -> list[dict]:
    """The pool list, from whichever API serves this chain.

    Lite deployments answer on `api2.curve.finance` and are not in the Prices
    API at all -- asking it for one returns a 404, not an empty list.  The
    floor comes down with them: see `lite.LITE_MIN_TVL`.
    """
    if chain.lite:
        # The Lite floor is a *default*, not a ceiling on what the caller may
        # ask for.  Taking `min()` of the two made `--min-tvl` unable to raise it
        # at all, which hid unichain tripping the §9.7 conditioning guard with no
        # floor the caller passed able to thin it out.
        floor = lite.LITE_MIN_TVL if min_tvl == DEFAULT_MIN_TVL else min_tvl
        return lite.list_pools(chain.chain_id, min_tvl=floor)
    return api.list_pools(chain.chain_id, min_tvl=min_tvl)


def load_pools(
    chain: Chain,
    *,
    min_tvl: float = 10_000.0,
    api: CurveApi | None = None,
    cache: UniverseCache | None = None,
    refresh: bool = False,
    pool_filters: bool = False,
    llamma: bool = False,
    pin: bool = False,
) -> UniverseLoad:
    api = api or CurveApi()
    cache = cache or UniverseCache()
    warnings: list[str] = []

    if pin:
        # Whatever is on disk, however old, and never a request.  A pinned
        # block with an unpinned pool list is not a pinned quote: the list is
        # what decides which pools exist and what the price fit is weighted by.
        held = cache.get(chain.chain_id, min_tvl, allow_stale=True)
        if held is not None:
            pools, dropped = _apply_filters(
                parse_universe(held), chain, api, warnings, enabled=pool_filters
            )
            pools += _llamma(chain, api, min_tvl, warnings) if llamma else []
            load = UniverseLoad(pools, "pinned",
                                cache.age(chain.chain_id, min_tvl), warnings)
            load.filtered = dropped
            return load
        warnings.append("no cached universe to pin to; fetching one")

    if not refresh:
        fresh = cache.get(chain.chain_id, min_tvl)
        if fresh is not None:
            pools, dropped = _apply_filters(
                parse_universe(fresh), chain, api, warnings, enabled=pool_filters
            )
            pools += _llamma(chain, api, min_tvl, warnings) if llamma else []
            load = UniverseLoad(pools, "cache", cache.age(chain.chain_id, min_tvl), warnings)
            load.filtered = dropped
            return load

    try:
        raw = _list_pools(chain, api, min_tvl)
    except CurveApiError as exc:
        stale = cache.get(chain.chain_id, min_tvl, allow_stale=True)
        if stale is None:
            raise
        age = cache.age(chain.chain_id, min_tvl)
        warnings.append(f"Curve API unavailable ({exc}); using a universe {age / 60:.0f} min old")
        pools, dropped = _apply_filters(
            parse_universe(stale), chain, api, warnings, enabled=pool_filters
        )
        pools += _llamma(chain, api, min_tvl, warnings) if llamma else []
        load = UniverseLoad(pools, "stale", age, warnings)
        load.filtered = dropped
        return load

    cache.put(chain.chain_id, min_tvl, raw)
    pools = parse_universe(raw)
    pools, dropped = _apply_filters(pools, chain, api, warnings, enabled=pool_filters)
    pools += _llamma(chain, api, min_tvl, warnings) if llamma else []
    load = UniverseLoad(pools, "api", 0.0, warnings)
    load.filtered = dropped
    return load


def _llamma(chain, api, min_tvl, warnings) -> list[PoolSpec]:
    found = llamma_pools(chain, api, min_tvl=min_tvl)
    if found:
        warnings.append(
            f"{len(found)} LLAMMA market(s) added "
            f"(${sum(p.tvl_usd for p in found):,.0f} of collateral and debt)"
        )
    return found


def llamma_pools(
    chain: Chain, api: CurveApi | None = None, *, min_tvl: float = 10_000.0
) -> list[PoolSpec]:
    """LLAMMA markets as ordinary two-coin crypto pools.

    **Off by default: enabling this today makes routes much worse.**  Measured at
    block 25,738,767, adding the 11 markets that clear a $10k floor cost
    USDC->sUSDS 67% and crvUSD->sDOLA 57%, and made USDC->WETH and crvUSD->CRV
    fail the §12.4 conservation and pin-detachment guards outright.

    The cause is calibration, not plumbing.  LLAMMA is a *banded* AMM, and the
    reserve we size probes from is the market's borrowed balance -- 3.40 crvUSD
    on the sUSDS market -- so the whole grid lands inside a single band where the
    curve is nearly linear.  It fits no cap, the model computes `G ~ 171`, and the
    solver posts millions through a three-crvUSD venue.  This is §2.5's "most
    dangerous single mis-calibration" with the peg replaced by a band.

    Making it usable needs band-aware capacity -- a real `cap` from the liquidity
    actually standing in reachable bands, so §2.3's clamp can bound it -- not a
    wider probe grid.  The plumbing here is correct and stays, so that work has
    somewhere to land.

    Everything downstream treats them like any other pool, because after this they
    *are* one: the only differences are that they quote with the `uint256`
    spelling (so the dialect is set here rather than probed) and that they have no
    `balances()` getter, so the reserves come from the API.

    Markets with nothing on one side are dropped: an arc with a zero reserve
    produces a zero probe grid and then a zero `a`, which looks like a valid quote
    and poisons the reference-price fit (§R3).
    """
    api = api or CurveApi()
    out: list[PoolSpec] = []
    for entry in api.llamma_markets(chain.api_name):
        address = (entry.get("llamma") or "").strip()
        borrowed, collateral = entry.get("borrowed_token"), entry.get("collateral_token")
        if not address or not borrowed or not collateral:
            continue
        amounts = (entry.get("borrowed_balance") or 0.0, entry.get("collateral_balance") or 0.0)
        if min(amounts) <= 0:
            continue
        usd = (entry.get("borrowed_balance_usd") or 0.0) + (
            entry.get("collateral_balance_usd") or 0.0
        )
        if usd < min_tvl:
            continue
        coins = []
        balances = []
        for index, (token, amount) in enumerate(
            zip((borrowed, collateral), amounts, strict=True)
        ):
            decimals = int(token.get("decimals") or 18)
            coins.append(
                Coin(
                    index=index,
                    address=(token.get("address") or "").lower(),
                    symbol=token.get("symbol") or "?",
                    decimals=decimals,
                )
            )
            balances.append(int(amount * 10**decimals))
        if not all(c.address for c in coins):
            continue
        out.append(
            PoolSpec(
                address=address,
                name=entry.get("name") or f"LLAMMA {coins[1].symbol}",
                # A registry key of its own, so the dialect table and any
                # pool-type special-casing cannot mistake it for a stableswap.
                pool_type="llamma",
                coins=tuple(coins),
                tvl_usd=usd,
                dialect=Dialect.CRYPTO,
                balances=tuple(balances),
                note=entry.get("_llamma_kind", ""),
            )
        )
    return out


def _probed_dead_pools(chain) -> set[str]:
    """Pools the facts file says cannot be traded at all.

    Deliberately narrow.  A recorded revert bans a *direction*, not a pool: both
    Compound pools have a reverting `exchange_underlying` and healthy
    `cDAI`/`cUSDC` arcs routed through daily, and the first version of this would
    have deleted them outright.

    Nothing here bans a pool.  Pool-level removal stays with the hand-written
    list, where a human decided it.
    """
    return set()


def _apply_filters(
    pools: list[PoolSpec],
    chain: Chain,
    api: CurveApi,
    warnings: list[str],
    *,
    enabled: bool = False,
) -> tuple[list[PoolSpec], int]:
    """Drop pools Curve itself flags as not honouring their quotes.

    Off by default, because measured against the live API it drops nothing:
    `/v2/pools` already excludes all 185 flagged mainnet pools, even at
    min_tvl=0.  Turn it on for the case it is written for -- a universe cached
    before a pool was flagged -- which is why it is applied on the cache and
    stale paths too, not only a fresh load.
    """
    # The hand-written list plus everything a `facts` run found reverting.
    # Measured beats hand-written: the probed list is regenerated with the gas
    # figures and committed beside them, so the hand-written one is now only for
    # pools we want gone for reasons no probe would find.
    banned = {a.lower() for a in getattr(chain, "blacklist", ())}
    banned |= _probed_dead_pools(chain)   # empty by design -- see the docstring
    dropped_here = 0
    if banned:
        before = len(pools)
        pools = [p for p in pools if p.address.lower() not in banned]
        dropped_here = before - len(pools)
        if dropped_here:
            warnings.append(
                f"{dropped_here} pool(s) on {chain.name}'s blacklist skipped: a quote "
                "that cannot execute, or a pool with no solvable invariant"
            )
    if not enabled:
        return pools, dropped_here
    blocked = api.pool_filters(chain.chain_id)
    if not blocked:
        return pools, dropped_here
    kept = [p for p in pools if p.address.lower() not in blocked]
    dropped = len(pools) - len(kept)
    if dropped:
        warnings.append(
            f"{dropped} pool(s) excluded by Curve's pool_filters list "
            f"({len(blocked)} flagged on this chain)"
        )
    return kept, dropped + dropped_here


