"""Curve Lite: the small deployments, on a different API.

The Prices API indexes trades, so it can report volume and TVL and history.
**Curve Lite** is the other kind of deployment -- factory contracts and a gauge,
without any of that indexing -- and is served by `api2.curve.finance`.

**It cannot replace the main API**, which was worth checking rather than
assuming: `get_pools/1` and `get_pools/42161` both answer 404.  Of the 26 Lite
deployments only sonic is also a Prices chain, and there Prices wins because Lite
reports a fraction of the deployment.  So this is a second source for the chains
the first one does not have, not a migration.

Two differences that matter to the router:

* **The floor comes down, but not to zero.**  A whole Lite deployment is smaller
  than mainnet's $10,000 pool floor, so that cut returns an empty universe --
  which reads as "chain not supported" rather than "chain is small".  But these
  deployments are also mostly scam and dust, so no floor at all admits far more
  junk than liquidity.  $1,000 is the knee; see `LITE_MIN_TVL`.
* **No paging.**  The whole chain arrives in one response, which is why there is
  no `min_tvl` in the request: it is filtered here.

Field names differ throughout and are translated to what `PoolSpec.from_api`
reads, so nothing downstream needs to know which API a pool came from.
"""

from __future__ import annotations

from typing import Any

from .curve_api import CurveApiError, _get

LITE_API = "https://api2.curve.finance"

#: The list floor for a Lite chain: $1,000, where the main chains use $10,000.
#
# Zero was wrong in the other direction.  These deployments are mostly scam and
# dust -- plasma lists 56 pools and has 4 real ones, monad 37 and 7, xlayer 39
# and 4, celo 55 and 2 -- and admitting the rest costs a probe each, feeds the
# reference-price fit tokens it cannot anchor, and on unichain produced a
# universe whose curvature spanned 1e21 and tripped the §9.7 guard.
#
# Measured, TVL separates them cleanly and the gap is not subtle.  Celo's two
# real pools hold $151,393 and $107,243; the third is $35.  Counting pools over
# each floor against the deployments' real pool counts:
#
#     chain      all  >$0  >$1k  >$10k  >$100k   real
#     plasma      56   16     4      4       4      4
#     monad       37   18     6      6       5      7
#     xlayer      39    8     4      4       4      4
#     celo        55   13     2      2       2      2
#     avalanche  175   55    11      6       5      -
#
# $1,000 is the knee.  It misses one of monad's seven, which sits below it --
# and a pool with under $1,000 of liquidity cannot serve a trade worth routing
# anyway, so that is the right side to err on.
LITE_MIN_TVL = 1_000.0

#: Deployments that are not real chains.  `get_platforms` mixes testnets and
#: devnets in with the rest, and a router that offers to quote on `bsc_testnet`
#: is offering something nobody wants.
NOT_MAINNET = ("sepolia", "testnet", "devnet:", "megaeth", "expchain")


def _is_mainnet(name: str) -> bool:
    lowered = name.lower()
    return not any(mark in lowered for mark in NOT_MAINNET)


def platforms() -> dict[str, dict[str, Any]]:
    """Every Lite deployment: name -> its metadata, testnets excluded.

    Failure is not fatal to the caller: a chain served by the Prices API does
    not need this at all, so an outage here should cost the Lite chains and
    nothing else.
    """
    try:
        payload = _get(f"{LITE_API}/get_platforms")
    except CurveApiError:
        return {}
    data = payload.get("data") or {}
    meta = data.get("platforms_metadata") or {}
    return {
        name: meta.get(name, {})
        for name in (data.get("platforms") or {})
        if _is_mainnet(name)
    }


def chain_ids() -> dict[str, int]:
    """Lite deployment name -> chain id, for the ones that report one."""
    out: dict[str, int] = {}
    for name, meta in platforms().items():
        chain_id = meta.get("chain_id")
        if chain_id is not None:
            out[name] = int(chain_id)
    return out


def _coin(raw: dict) -> dict:
    """One coin, in the shape `Coin.from_api` reads.

    `decimals` arrives as a string here and as a number on the Prices API, so
    it is normalised rather than left for the parser to guess.
    """
    return {
        "address": raw.get("address") or "",
        "symbol": raw.get("symbol") or "",
        "decimals": int(raw.get("decimals") or 18),
        "pool_balance": raw.get("pool_balance"),
        "usd_price": raw.get("usd_price"),
    }


def _pool(raw: dict) -> dict:
    """One pool, translated into what `PoolSpec.from_api` reads.

    The names differ on almost every field that matters: `registry_id` for the
    pool type, `tvl` for `tvl_usd`, `is_meta_pool` for `is_metapool`.  A pool
    the API marks `is_broken` is dropped by the caller, not renamed here.
    """
    return {
        "address": raw.get("address") or "",
        "name": raw.get("name") or raw.get("symbol") or "",
        "pool_type": raw.get("registry_id") or "",
        "coins": [_coin(c) for c in (raw.get("coins") or [])],
        "tvl_usd": float(raw.get("tvl") or 0.0),
        "is_metapool": bool(raw.get("is_meta_pool")),
        "base_pool": raw.get("base_pool") or "",
        "lp_token_address": raw.get("lp_token_address") or "",
    }


def list_pools(chain_id: int, *, min_tvl: float = LITE_MIN_TVL) -> list[dict]:
    """Every usable pool on a Lite chain, in one request.

    Broken pools are dropped here rather than downstream: the API knows which
    of its own pools cannot be read, and a pool that cannot be read is worse
    than a pool that is absent -- it costs a probe to discover and shows up as
    a mysteriously unroutable token.
    """
    payload = _get(f"{LITE_API}/get_pools/{chain_id}")
    data = payload.get("data") or {}
    raw_pools = data.get("pool_data") or []
    out = []
    for raw in raw_pools:
        if raw.get("is_broken"):
            continue
        if float(raw.get("tvl") or 0.0) < min_tvl:
            continue
        translated = _pool(raw)
        if translated["address"] and len(translated["coins"]) >= 2:
            out.append(translated)
    out.sort(key=lambda entry: -entry["tvl_usd"])
    return out
