"""Curve Prices v2 client (stdlib urllib).

The API supplies only the *universe and the TVL bootstrap*.  Every number that
enters the solve is read on-chain at the pinned block, because the API is
demonstrably wrong about some of them (`pool_type` mis-types 6 mainnet arcs
today) and unreliable about others (`tvl_usd` on dust pools).  An outage should
degrade to a stale universe, never to a wrong route.

Two quirks worth knowing: the default urllib User-Agent gets a **403**, and
`pagination` is hard-capped at 50.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

PRICES_V2 = "https://prices.curve.finance/v2"
PRICES_V1 = "https://prices.curve.finance/v1"
MAX_PAGE_SIZE = 50  # anything larger is a 422
DEFAULT_MIN_TVL = 10_000.0
CACHE_TTL = 300.0  # matches the edge cache

USER_AGENT = "electric-router/0.1 (+https://curve.finance)"


class CurveApiError(RuntimeError):
    pass


RETRIES = 3
BACKOFF = 0.75


def _get(url: str, timeout: float = 30.0, retries: int = RETRIES) -> Any:
    """GET with a short retry on transient failures.

    The API returns 502 often enough to matter (seen live during development),
    and a single blip must not take down a route that is otherwise fully
    determined by on-chain state.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last = ""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            last = f"{exc.code} {exc.reason}"
            if exc.code < 500 and exc.code != 429:
                break  # 4xx will not fix itself; 403 means the UA is missing
        except (urllib.error.URLError, TimeoutError) as exc:
            last = str(getattr(exc, "reason", exc))
        if attempt + 1 < retries:
            time.sleep(BACKOFF * (2**attempt))
    raise CurveApiError(f"{last} for {url}")


class CurveApi:
    def __init__(self, ttl: float = CACHE_TTL) -> None:
        self.ttl = ttl
        self._cache: dict[str, tuple[float, Any]] = {}

    def _cached(self, key: str, produce) -> Any:
        hit = self._cache.get(key)
        now = time.monotonic()
        if hit and now - hit[0] < self.ttl:
            return hit[1]
        value = produce()
        self._cache[key] = (now, value)
        return value

    def chains(self) -> dict[str, int]:
        """API chain name -> chain id.  Note Gnosis is served as 'xdai'."""

        def produce():
            payload = _get(f"{PRICES_V2}/pools/chains/")
            return {row["name"]: int(row["chain_id"]) for row in payload["data"]}

        return self._cached("chains", produce)

    def list_pools(
        self,
        chain_id: int,
        *,
        min_tvl: float = DEFAULT_MIN_TVL,
        limit: int | None = None,
    ) -> list[dict]:
        """Every pool on the chain above `min_tvl`, newest page order preserved."""

        def produce():
            pools: list[dict] = []
            page = 1
            total = None
            while True:
                query = urllib.parse.urlencode(
                    {
                        "chain_id": chain_id,
                        "page": page,
                        "pagination": MAX_PAGE_SIZE,
                        "sort_by": "tvl",
                        "sort_direction": "desc",
                        "min_tvl": min_tvl,
                    }
                )
                payload = _get(f"{PRICES_V2}/pools/?{query}")
                batch = payload.get("pools") or []
                total = payload.get("count") if total is None else total
                pools.extend(batch)
                if not batch or (total is not None and len(pools) >= total):
                    break
                if limit is not None and len(pools) >= limit:
                    break
                page += 1
            return pools[:limit] if limit else pools

        return self._cached(f"pools:{chain_id}:{min_tvl}:{limit}", produce)

    def llamma_markets(self, chain: str) -> list[dict]:
        """crvUSD mint markets and Curve Lending markets, as raw entries.

        LLAMMA is the AMM inside a crvUSD or lending market -- collateral on one
        side, the borrowed token on the other, spread across bands.  It is not
        in `/v2/pools`, which is why 61 mainnet venues were invisible to us,
        including a sDOLA/crvUSD market on a pair we were losing by 13 bp.

        It quotes with `get_dy(uint256,uint256,uint256)`, the crypto spelling,
        so downstream needs no special case.  It has no `balances()` getter,
        though, so the reserves have to come from here rather than the chain.
        """

        def produce():
            out: list[dict] = []
            for kind in ("crvusd/markets", "lending/markets"):
                try:
                    payload = _get(
                        f"{PRICES_V1}/{kind}/{chain}"
                        "?fetch_on_chain=true&page=1&per_page=500"
                    )
                except CurveApiError:
                    continue  # one family missing is not a reason to lose both
                for entry in payload.get("data", []):
                    entry["_llamma_kind"] = kind
                    out.append(entry)
            return out

        try:
            return self._cached(f"llamma:{chain}", produce)
        except CurveApiError:
            return []

    def pool_filters(self, chain_id: int) -> set[str]:
        """Curve's own list of pools that do not do what they advertise.

        Same list curve_solver loads at startup.  These are not merely illiquid
        -- illiquidity the router prices correctly by itself -- they are pools
        whose quote and execution disagree: rebasing or fee-on-transfer coins,
        broken oracles, deprecated implementations.  A quoter cannot tell the
        difference, so `get_dy` looks perfectly healthy right up until the swap
        delivers something else.

        Returns lowercase addresses.  An unreachable endpoint yields an empty
        set: routing on the full universe is worse than routing on a filtered
        one, but much better than not routing at all, and every quote is still
        verified on-chain.
        """

        def produce():
            payload = _get(f"{PRICES_V1}/chains/pool_filters")
            for entry in payload.get("data", []):
                if entry.get("chain_id") == chain_id:
                    return {
                        pool["address"].lower()
                        for pool in entry.get("pools", [])
                        if pool.get("address")
                    }
            return set()

        try:
            return self._cached(f"filters:{chain_id}", produce)
        except CurveApiError:
            return set()

    def pool_detail(self, chain_id: int, address: str) -> dict:
        return self._cached(
            f"detail:{chain_id}:{address.lower()}",
            lambda: _get(f"{PRICES_V2}/pools/{chain_id}/{address}"),
        )
